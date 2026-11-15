'use strict';
// Decisions. Every choice is scored in expected points: damage the unit can deal, damage it will take, and
// objectives it can hold (one Victory Point is worth VP_WORTH points). The AI looks one step ahead: where
// will this unit be safest and most useful when the enemy acts next?
const { num, xOf, has, p2d6AtMost } = require('./rules.cjs');
const { meleeGroup, expectedGroup } = require('./attack.cjs');
const { planVolley, valuePerWound, rangeOf, GUNS_OF_THE_CONQUEROR } = require('./fire.cjs');
const { dist, gap, lineOfSight, inCover, inside, W, H } = require('./table.cjs');
const { alive, passChance, canHold } = require('./checks.cjs');
const core = require('./core.cjs');
const scoring = require('./scoring.cjs');
const legions = require('./legions.cjs');
const plan = require('./plan.cjs');

const VP_WORTH = 45;          // points of value per Victory Point
/**
 * The AI's weights, which a side can override for that side alone (runBattle's opts.ai, for playing one AI against
 * another: sim/tune.cjs). vp: points per Victory Point; line: how much more Line units weigh markers; mission: the
 * weight of mission value early on; soonMelee/soonShoot: next turn's charge or shot; risk: what the enemy can do to
 * the unit next turn; bold: risk accepted by Vanguard units and transports carrying assault troops; chargeGain/
 * chargeTake: a charge's damage dealt and taken; incoming: fire taken going in; chargeFail: the cost of a failed
 * charge; chargeBar: the least a charge must be worth; shootBar: the least a target must be worth; react: the bars
 * for spending reactions; share: split each enemy's threat between the units it could reach (1) or not (0).
 * The play a human would add (each 0 = off, 1 = as written): endgame: weigh next turn's threats and chances by the
 * odds there is one; tieup: a charge is worth the enemy's shooting it stops (less the charger's own) while they're
 * locked; shelter: a charge is worth the enemy fire the charger escapes while locked; screen: standing in an enemy's
 * charge lane to a friend is worth the charge it makes less likely; lanes: shooting a unit that stands in a friend's
 * charge lane is worth the charge it opens; counter: a melee unit within reach of a friend an enemy could charge is
 * worth the counter-charge it threatens; concede: a unit weighs the Victory Points the enemy scores for destroying it
 * (Kill Points, Slay the Warlord, Giant Killer, a Vanguard prize for a marker holder) against the risk it runs, and
 * shooting and charges count the Warlord and Giant Killer prizes; retfire: a shot is worth less by the Return Fire it
 * will likely draw; ride: passengers stay in while their transport can carry them closer, rather than get out first.
 */
const DEFAULTS = { vp: VP_WORTH, line: 1.5, mission: 0.6, soonMelee: 0.45, soonShoot: 0.3, risk: 0.35, bold: 0.5, chargeGain: 1.6, chargeTake: 1.0, incoming: 0.35, chargeFail: 10, chargeBar: 3, shootBar: 0.5, react: 1, share: 1,
  endgame: 0, tieup: 0, shelter: 0, screen: 0, lanes: 0, counter: 0, concede: 1, retfire: 1, ride: 1 };
const K = (state, side, key) => { const o = state.aiParams && state.aiParams[side]; return o && o[key] != null ? o[key] : DEFAULTS[key]; };
const BANDS = [0, 3, 6, 9, 12, 15, 18, 24, 30, 36, 48, 72];

// ---------- precomputed matchups ----------
/** Expected points a unit deals with its guns to another, by range band (ignoring Line of Sight and cover). */
function shootTable(state, a, b) {
  const key = `${a.uid}>${b.uid}:${alive(a).length}:${alive(b).length}:${core.snapOnly(a) ? 1 : 0}`;
  const c = state.cache.shoot;
  if (c.has(key)) return c.get(key);
  const out = BANDS.map((d) => {
    const fake = { x: 0, y: 0, r: 0 };
    const tgt = Object.assign(Object.create(Object.getPrototypeOf(b)), b, { x: d, y: 0, r: 0 });
    const src = Object.assign(Object.create(Object.getPrototypeOf(a)), a, fake);
    return planVolley(src, tgt, state, { losOK: true, coverSave: null, stationary: !a.statuses.size, snap: core.snapOnly(a) }).expectedPts;
  });
  c.set(key, out);
  return out;
}
const evAt = (table, d) => { let v = 0; for (let i = BANDS.length - 1; i >= 0; i--) if (d <= BANDS[i]) v = table[i]; return v; };
// (the Guns of the Conqueror are fired only through their reaction)
// remembered per unit until a model dies (it's asked for every enemy on every candidate move)
const maxRange = (u) => {
  const a = alive(u);
  if (u._mr && u._mr.n === a.length) return u._mr.v;
  const v = Math.max(0, ...a.flatMap((m) => m.ranged.filter((w) => !GUNS_OF_THE_CONQUEROR.test(w.name)).map((w) => rangeOf(w, m))));
  u._mr = { n: a.length, v };
  return v;
};

/** Expected points a unit deals in one round of combat against another. */
function meleeEV(state, a, b) {
  const key = `${a.uid}x${b.uid}:${alive(a).length}:${alive(b).length}`;
  const c = state.cache.melee;
  if (c.has(key)) return c.get(key);
  let e = 0;
  for (const m of alive(a)) {
    if (m.vehicle || !m.melee.length) continue;
    let best = 0;
    for (const w of m.melee) { if (has(w.specialRules, 'Detonation') && !b.vehicle) continue; best = Math.max(best, expectedGroup(meleeGroup(m, w, b, {}), b)); }
    e += best;
  }
  const v = e * valuePerWound(b);
  c.set(key, v);
  return v;
}

// ---------- movement reach ----------
// a unit moves at the pace of its slowest model (a joined character included)
const moveOf = (u) => { const a = alive(u); return a.length ? Math.min(...a.map((m) => num(m.p.M, 0) + (m.swift && u.swiftOn ? 2 : 0))) : 0; };
/** Chance a Charge Roll (2D6 keep highest, + Fast) covers `need` inches. */
function chargeChance(u, need) {
  const fast = Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0));
  if (need <= fast + 1) return 1;
  let p = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (Math.max(a, b) + fast >= need) p++;
  return p / 36;
}
/** Chance this unit, standing at `pos`, makes a charge into `t` this turn (after its Set-up Move). */
function chargeOdds(u, pos, t) {
  const g = Math.max(0, Math.hypot(pos.x - t.x, pos.y - t.y) - u.r - t.r) + legions.rangePenalty(t);
  if (g > core.CHARGE_DECLARE_RANGE) return 0;
  const left = g - (u.turn.disordered || u.statuses.size ? 0 : core.setupMove(u));
  return left <= 0 ? 1 : chargeChance(u, left);
}
/**
 * chargeOdds for a charge declared now, with the Charge Move's real route (move.cjs chargeRoute: round other units and
 * Impassable Terrain), which only differs from the straight line when something stands in the way.
 */
function chargeOddsNow(state, u, t) {
  const straight = chargeOdds(u, u, t);
  if (straight <= 0) return 0;
  const way = require('./move.cjs').chargeRoute(state, u, t);
  if (!way.pts) return way.len < Infinity ? straight : 0;
  const left = way.len + legions.rangePenalty(t) - (u.turn.disordered || u.statuses.size ? 0 : core.setupMove(u));
  return left <= 0 ? 1 : chargeChance(u, left);
}
/** pos moved towards t by `d` inches, stopping `stop` inches short of its centre. */
const toward = (pos, t, d, stop = 0) => { const L = Math.hypot(t.x - pos.x, t.y - pos.y); const k = L > 0 ? Math.max(0, Math.min(d, L - stop)) / L : 0; return { x: pos.x + (t.x - pos.x) * k, y: pos.y + (t.y - pos.y) * k }; };
const canCharge = (u) => !u.vehicle && !u.statuses.has('Pinned') && !u.statuses.has('Routed') && alive(u).some((m) => m.melee.length && !m.vehicle) && !/Flyer/.test(u.unitType);

// ---------- Vanguard: hunting the units that hold objectives ----------
const pointsLeft = (e) => (e.pts || 0) * alive(e).length / Math.max(1, e.models.length);
/** The marker a unit is controlling or contesting right now, if any. */
function markerHeld(state, e) {
  if (!state.table.objectives?.length || !canHold(e)) return null;
  return state.table.objectives.find((o) => Math.hypot(o.x - e.x, o.y - e.y) - e.r <= scoring.CONTROL_RANGE) || null;
}
/** Chance an attack worth `pts` removes the last model of e. */
const finishChance = (pts, e) => Math.max(0, Math.min(0.85, pts / Math.max(1, pointsLeft(e)) - 0.3));
/** Chance a fight wipes e out or breaks it: winning the combat makes a failed Panic Check likely. */
function breakChance(state, u, e) {
  const give = meleeEV(state, u, e), take = meleeEV(state, e, u);
  const r = give / Math.max(1, pointsLeft(e));
  return Math.max(0, Math.min(0.9, give > take ? 0.35 + r : r * 0.5));
}
/**
 * What attacking e is worth to u beyond the points it destroys. A unit with a majority of Vanguard (X) scores X
 * Victory Points for removing the last model of, or breaking in combat, an enemy unit that holds or contests a
 * marker (CONFIRMED; once per marker per Player Turn), so it goes after those units: the prize times the chance
 * `p` of earning it, and a little extra for every point it takes off a unit holding a marker.
 */
function huntValue(state, u, e, pts, p) {
  if (!scoring.majority(u, 'Vanguard')) return 0;
  const o = markerHeld(state, e);
  if (!o) return 0;
  const scored = state.vanguardScored?.has(`${state.round}:${state.active}:${o.id + 1}`);
  return (scored ? 0 : scoring.maxX(u, 'Vanguard') * K(state, u.side, 'vp') * p) + 0.3 * pts;
}

// ---------- what a human would weigh too ----------
/**
 * The chance `side` gets another Player Turn after the one being played: five Battle Turns and a sixth on a 4+ (as
 * battle.cjs), so a side whose turn comes later in this Battle Turn certainly does, and otherwise it depends on the turn.
 */
function nextTurnOdds(state, side) {
  if (side !== state.active && state.first === state.active) return 1;
  const T = state.mission?.turns || 5;
  return state.round < T ? 1 : state.round === T ? 0.5 : 0;
}
/** endgame: how much next turn counts for `side` (1 while there surely is one; less near the end). */
const endFactor = (state, side) => { const w = K(state, side, 'endgame'); return w ? 1 - w * (1 - nextTurnOdds(state, side)) : 1; };
/**
 * The Victory Points the enemy scores if u is destroyed (the mission's, as scoring.cjs awards them): its Kill Points and
 * those of characters with it (in Destroy the Enemy missions, with kp), Slay the Warlord for the side's first Command or
 * High Command unit lost, Giant Killer for its first Lord of War or Warlord, and (with vanguard) the Vanguard (X) prize
 * an enemy Vanguard unit that could reach it next turn would take for a marker it holds.
 */
function concedeVP(state, u, { kp = true, vanguard = true } = {}) {
  const m = state.mission;
  const chars = [u, ...(u.joined || []).filter((c) => !c.dead)];
  let vp = 0;
  if (kp && m.primary === 'destroy') vp += chars.reduce((t, c) => t + scoring.killPoints(c), 0);
  const lost = (state.destroyedUnits || []).filter((x) => x.side === u.side);
  if (m.secondaries && !lost.some((x) => /Command/.test(x.role || ''))) {
    if (chars.some((c) => /High Command/.test(c.role || ''))) vp += m.secondaries.warlord + 1;
    else if (chars.some((c) => /^Command/.test(c.role || ''))) vp += m.secondaries.warlord;
  }
  if (m.secondaries && !lost.some((x) => /Lord of War|Warlord/.test(x.role || '')) && chars.some((c) => /Lord of War|Warlord/.test(c.role || ''))) vp += m.secondaries.giant;
  if (vanguard && markerHeld(state, u)) {
    let vg = 0;
    for (const e of state.units) {
      if (e.side === u.side || e.destroyed || !e.arrived || !scoring.majority(e, 'Vanguard')) continue;
      if (gap(e, u) <= moveOf(e) + Math.max(maxRange(e), canCharge(e) ? core.setupMove(e) + 6 : 0)) vg = Math.max(vg, scoring.maxX(e, 'Vanguard'));
    }
    vp += vg;
  }
  return vp;
}
/** What x would most likely shoot next turn, in points: its best target among `side`'s units, after a move. */
function bestShot(state, x, side) {
  if (!alive(x).some((m) => m.ranged.length)) return 0;
  let best = 0;
  for (const y of state.units) {
    if (y.side !== side || y.destroyed || !y.arrived || y.embarkedIn) continue;
    best = Math.max(best, evAt(shootTable(state, x, y), Math.max(0, gap(x, y) - moveOf(x))));
  }
  return best;
}
/** The shooting u would take next turn from the enemy units other than `except` (each split as positionScore's risk). */
function fireOn(state, u, except) {
  let risk = 0;
  for (const e of state.units) {
    if (e.side === u.side || e === except || e.destroyed || !e.arrived || e.embarkedIn || e.lockedWith.size) continue;
    const s = evAt(shootTable(state, e, u), Math.max(0, gap(u, e) - moveOf(e)));
    if (s > 0) risk += s * 0.5;
  }
  return Math.min(risk, pointsLeft(u));
}
/**
 * How much further a unit going from A to B must go round a circle (centre C, radius R) in the way: the tangents and
 * the arc, less the straight line. 0 if the line misses it.
 */
function detour(A, B, C, R) {
  const abx = B.x - A.x, aby = B.y - A.y, ab = Math.hypot(abx, aby);
  if (ab < 1e-6) return 0;
  const k = Math.max(0, Math.min(1, ((C.x - A.x) * abx + (C.y - A.y) * aby) / (ab * ab)));
  if (Math.hypot(A.x + abx * k - C.x, A.y + aby * k - C.y) >= R) return 0;
  const a = Math.hypot(A.x - C.x, A.y - C.y), b = Math.hypot(B.x - C.x, B.y - C.y);
  // touching one end already: the way round is at least half the circle's width
  if (a <= R || b <= R) return R;
  const ang = Math.acos(Math.max(-1, Math.min(1, ((A.x - C.x) * (B.x - C.x) + (A.y - C.y) * (B.y - C.y)) / (a * b))));
  const arc = ang - Math.acos(R / a) - Math.acos(R / b);
  return arc <= 0 ? 0 : Math.sqrt(a * a - R * R) + Math.sqrt(b * b - R * R) + R * arc - ab;
}
/** Chance an enemy unit e moves and charges something `d` inches away next turn. */
function threatChance(e, d) {
  const left = d - moveOf(e) - core.setupMove(e);
  return left <= 0 ? 1 : chargeChance(e, left);
}
/**
 * screen: what u standing at pos is worth in charges it makes less likely: for each enemy that could charge one of
 * u's friends next turn, the most it takes off one such charge (the enemy charges one target). A charge goes round
 * units in the way (move.cjs chargeRoute), so a unit in the lane lengthens it. Only what u adds counts: a lane another
 * friend already blocks is worth nothing more (scored alone, every unit claimed the same lane and the army bunched up;
 * that version lost 38% to 62% in self-play). It's a loss avoided, so it's weighed as the risk is.
 */
function screenValue(state, u, pos, enemies) {
  let total = 0;
  const friends = state.units.filter((f) => f !== u && f.side === u.side && !f.destroyed && f.arrived && !f.embarkedIn && !f.lockedWith.size);
  for (const E of enemies) {
    if (!canCharge(E) || E.lockedWith.size) continue;
    const reach = moveOf(E) + core.setupMove(E) + 6 + Math.min(...alive(E).map((m) => xOf(m.rules, 'Fast') || 0));
    let best = 0;
    for (const F of friends) {
      const g = gap(E, F);
      if (g > reach) continue;
      if (threatChance(E, g) <= 0) continue;
      const d = Math.hypot(E.x - F.x, E.y - F.y) || 1, k = (E.r + F.r) / d;
      const touch = { x: F.x + (E.x - F.x) * k, y: F.y + (E.y - F.y) * k };
      const extra = detour(E, touch, pos, u.r + E.r);
      if (extra <= 0) continue;
      // what the other friends already add to this charge's way
      let had = 0;
      for (const G of friends) if (G !== F) had = Math.max(had, detour(E, touch, G, G.r + E.r));
      if (extra <= had) continue;
      best = Math.max(best, meleeEV(state, E, F) * (threatChance(E, g + had) - threatChance(E, g + extra)));
    }
    total += best;
  }
  return total * K(state, u.side, 'risk');
}

/**
 * lanes: what shooting e is worth to the charges after it: for each friendly unit that could charge this turn and
 * whose way to an enemy e stands in, the charge that killing e would open (straight odds against the odds round e)
 * times the chance the shooting removes e.
 */
function laneValue(state, shooter, e, pts) {
  const p = finishChance(pts, e);
  if (p <= 0) return 0;
  let best = 0;
  for (const c of state.units) {
    if (c.side !== shooter.side || c === shooter || c.destroyed || !c.arrived || c.embarkedIn || c.lockedWith.size || !canCharge(c) || c.turn.rushed || c.turn.noCharge) continue;
    for (const T of state.units) {
      if (T.side === c.side || T === e || T.destroyed || !T.arrived || T.embarkedIn) continue;
      const straight = chargeOdds(c, c, T);
      if (straight <= 0) continue;
      const d = Math.hypot(c.x - T.x, c.y - T.y) || 1, k = (c.r + T.r) / d;
      if (detour(c, { x: T.x + (c.x - T.x) * k, y: T.y + (c.y - T.y) * k }, e, c.r + e.r) <= 0) continue;
      const gain = (straight - chargeOddsNow(state, c, T)) * meleeEV(state, c, T);
      if (gain > best) best = gain;
    }
  }
  return best * p;
}
/**
 * counter: what a melee unit u standing at pos is worth as a threat to enemies that charge its friends: for each
 * enemy that could charge a friend next turn, the fight u could start with it afterwards (it ends beside the
 * friend), times the chance it charges and u reaches it then.
 */
function counterValue(state, u, pos, enemies) {
  if (!canCharge(u)) return 0;
  const reach = moveOf(u) + core.setupMove(u);
  let best = 0;
  for (const E of enemies) {
    if (!canCharge(E) || E.lockedWith.size) continue;
    for (const F of state.units) {
      if (F === u || F.side !== u.side || F.destroyed || !F.arrived || F.embarkedIn) continue;
      const p0 = threatChance(E, gap(E, F));
      if (p0 <= 0.1) continue;
      // E would end touching F: u's way to it is about its way to F's edge on E's side
      const d = Math.max(0, Math.hypot(pos.x - F.x, pos.y - F.y) - F.r - u.r - E.r);
      const left = d - reach;
      const p1 = left <= 0 ? 1 : chargeChance(u, left);
      best = Math.max(best, p0 * p1 * meleeEV(state, u, E));
    }
  }
  return best;
}

// ---------- what a unit is for ----------
const shootValue = (state, u, enemies) => Math.max(0, ...enemies.map((e) => evAt(shootTable(state, u, e), 18)));
const meleeValue = (state, u, enemies) => Math.max(0, ...enemies.map((e) => meleeEV(state, u, e)));

// ---------- scoring a position ----------
function positionScore(state, u, pos, opts = {}) {
  const enemies = state.units.filter((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn);
  // the army's plan (plan.cjs): this unit's target, or its passengers', and whether the assault waits for its wave
  const pl = opts.consolidating ? null : plan.of(state, u);
  const waiting = !!(pl && pl.waiting);
  const saved = { x: u.x, y: u.y };
  u.x = pos.x; u.y = pos.y;
  let score = 0;
  // the mission: markers it could control or Sector strength it adds here, and progress towards the next.
  // Escalation scores every turn; Hammerblow only at the end, so position matters most late on
  const mv = scoring.missionValueAt(state, u, pos);
  const turnsLeft = Math.max(1, state.turnsLeft);
  const w = state.mission.variant === 'hammerblow' ? (turnsLeft <= 2 ? 1.2 : 0.35) : K(state, u.side, 'mission') * Math.min(2, turnsLeft);
  // Line units are there to hold markers: they weigh them more, and press on to the next one when theirs is held.
  // Vanguard units score 1 VP at most for a marker; they're there to take markers from the enemy
  const line = scoring.majority(u, 'Line'), vanguard = scoring.majority(u, 'Vanguard');
  score += mv.here * K(state, u.side, 'vp') * w * (line ? K(state, u.side, 'line') : vanguard ? 0.5 : 1) + mv.near * K(state, u.side, 'vp') * (line ? 0.4 : vanguard ? 0.1 : 0.25);
  // offence: the best shot from here, and the best charge from here
  let shoot = 0, melee = 0;
  for (const e of enemies) {
    const g = gap(u, e);
    if (alive(u).some((m) => m.ranged.length)) {
      let v = evAt(shootTable(state, u, e), g);
      if (v > 0) v += huntValue(state, u, e, v, finishChance(v, e));
      if (v > shoot && (v > 0) && lineOfSight(state.table, u, e)) shoot = v;
    }
    if (opts.charging !== false && !waiting && canCharge(u) && !u.turn.rushed && !u.turn.noCharge) {
      const odds = chargeOdds(u, pos, e);
      const v = odds > 0 ? (meleeEV(state, u, e) + huntValue(state, u, e, meleeEV(state, u, e), breakChance(state, u, e))) * odds : 0;
      if (v > melee) melee = v;
    }
  }
  // next turn: closing in for a charge, or getting guns into range
  let soon = 0;
  for (const e of enemies) {
    const g = gap(u, e);
    if (canCharge(u)) {
      const reachNext = moveOf(u) + core.setupMove(u) + 4.5;
      const ev = meleeEV(state, u, e) + huntValue(state, u, e, meleeEV(state, u, e), breakChance(state, u, e));
      soon = Math.max(soon, ev * Math.max(0, Math.min(1, 1 - (g - reachNext) / 24)) * K(state, u.side, 'soonMelee'));
    }
    if (alive(u).some((m) => m.ranged.length)) {
      const v = evAt(shootTable(state, u, e), Math.max(0, g - moveOf(u)));
      soon = Math.max(soon, (v > 0 ? v + huntValue(state, u, e, v, finishChance(v, e)) : 0) * K(state, u.side, 'soonShoot'));
    }
  }
  if (waiting) soon *= 0.5;
  // endgame: next turn's chances only count if there is a next turn
  soon *= endFactor(state, u.side);
  score += Math.max(shoot, melee) + 0.3 * Math.min(shoot, melee) + soon;
  // the plan's target: while the assault waits for its wave, keep the target within next turn's reach (from cover,
  // weighed by the risk below); once it goes, a little extra for charging the planned target
  if (pl && pl.assault === u) {
    const T = pl.target, ev = meleeEV(state, u, T);
    if (waiting) { const d = gap(u, T), r = plan.reach(state, u, module.exports); score += ev * 0.6 * (d <= r ? 1 : Math.max(0, 1 - (d - r) / 24)); }
    else if (canCharge(u) && opts.charging !== false && !u.turn.rushed) score += 0.25 * ev * chargeOdds(u, pos, T);
  }
  // Vanguard: closing on the enemy units that hold markers, from across the table if need be
  if (vanguard && !opts.consolidating) {
    const reach = moveOf(u) + (canCharge(u) ? core.setupMove(u) + 4.5 : maxRange(u));
    let hunt = 0;
    for (const e of enemies) if (markerHeld(state, e)) hunt = Math.max(hunt, Math.max(0, Math.min(1, 1 - (gap(u, e) - reach) / 36)));
    score += hunt * scoring.maxX(u, 'Vanguard') * K(state, u.side, 'vp');
  }
  // risk: what the enemy can do to this unit next turn from where it stands now. Each enemy unit's shooting and
  // charge are split between this unit and the other units of its side that enemy could reach next turn (it shoots
  // one target and charges one). Counting every enemy as aiming everything at this one unit (share 0) made nearly
  // every unit in range lose all it had left, so the AI hid instead of scoring: the shared version beat it 59% of
  // the time in self-play (sim/tune.cjs, 120 pairs of battles)
  let risk = 0;
  const share = K(state, u.side, 'share');
  const mine = share ? state.units.filter((x) => x !== u && x.side === u.side && !x.destroyed && x.arrived && !x.embarkedIn) : [];
  for (const e of enemies) {
    const reach = moveOf(e);
    const g = Math.max(0, gap(u, e) - reach);
    const s = evAt(shootTable(state, e, u), g);
    const charger = canCharge(e);
    let split = 1;
    if (share) {
      const far = reach + Math.max(maxRange(e), charger ? core.setupMove(e) + 6 : 0);
      split = 1 + mine.filter((x) => gap(x, e) <= far).length;
    }
    if (s > 0 && lineOfSight(state.table, e, u)) risk += s * (inCover(state.table, e, u) ? 0.7 : 1) / split;
    if (charger) {
      // the enemy moves its full Movement towards this unit, then charges
      const ge = Math.max(0, gap(u, e) - reach), left = ge - core.setupMove(e);
      const p = ge > core.CHARGE_DECLARE_RANGE ? 0 : left <= 0 ? 1 : chargeChance(e, left);
      risk += meleeEV(state, e, u) * p * 0.8 / split;
    }
  }
  // a unit can't lose more than it has left; assault troops (Vanguard), and transports carrying assault troops,
  // accept more of it to reach the enemy
  const assaultCargo = (u.passengers || []).some((p) => canCharge(p) && meleeValue(state, p, enemies) > shootValue(state, p, enemies));
  // while waiting for the wave an assault group hides: more weight on risk, and no Vanguard or cargo boldness
  // endgame: the enemy's next turn only threatens if it gets one
  risk *= endFactor(state, 1 - u.side);
  // concede: the Victory Points its destruction would give away, by the chance this risk destroys it
  if (K(state, u.side, 'concede') && !opts.passenger) score -= K(state, u.side, 'concede') * concedeVP(state, u) * K(state, u.side, 'vp') * finishChance(risk, u);
  // screen: standing in the way of enemy charges at friends
  if (K(state, u.side, 'screen') && !opts.passenger && !opts.consolidating) score += K(state, u.side, 'screen') * screenValue(state, u, pos, enemies);
  // counter: threatening the enemies that would charge a friend (only worth it if there's a turn to do it in)
  if (K(state, u.side, 'counter') && !opts.passenger && !opts.consolidating && !waiting) score += K(state, u.side, 'counter') * 0.5 * counterValue(state, u, pos, enemies) * endFactor(state, u.side);
  score -= Math.min(risk, pointsLeft(u)) * K(state, u.side, 'risk') * (opts.cautious ?? 1) * (waiting ? 1.5 : (scoring.majority(u, 'Vanguard') || assaultCargo) && !opts.consolidating ? K(state, u.side, 'bold') : 1);
  // standing still with heavy weapons is worth something
  if (pos.x === saved.x && pos.y === saved.y && alive(u).some((m) => m.ranged.some((w) => has(w.specialRules, 'Heavy') || has(w.specialRules, 'Ordnance')))) score += shoot * 0.15;
  u.x = saved.x; u.y = saved.y;
  // a transport is worth what its passengers can do from where it stops: they get out beside it and charge,
  // shoot or hold from there (after a Rush they stay in, so only next turn counts). Inside, they're safe
  if (u.passengers?.length && !opts.passenger) {
    for (const p of u.passengers) {
      const r0 = p.r, d0 = p.turn.disordered;
      p.r = p.r || 2;
      // getting out of anything but an Assault Vehicle makes this turn's charge Disordered: no Set-up Move
      p.turn.disordered = d0 || !has(u.rules, 'Assault Vehicle');
      score += Math.max(0, positionScore(state, p, pos, { cautious: 0.3, passenger: true, charging: opts.charging }));
      // delivery: an assault unit wants carrying to the enemy it fights best, from across the table if need be
      if (canCharge(p) && meleeValue(state, p, enemies) > shootValue(state, p, enemies)) {
        // the transport's move, then the unit's own normal move after getting out, then the charge
        const reach = moveOf(u) + moveOf(p) + (p.turn.disordered ? 0 : core.setupMove(p)) + 4.5 + p.r;
        const pp = plan.of(state, p);
        let best = 0;
        for (const e of enemies) {
          const d = Math.hypot(pos.x - e.x, pos.y - e.y) - u.r - e.r;
          // waiting for the wave: only within next turn's reach counts (from far off, no pull); the planned target counts more
          const near = pp?.waiting ? (d <= reach ? 0.6 : Math.max(0, 1 - (d - reach) / 24) * 0.6) : Math.max(0, Math.min(1, 1 - (d - reach) / 36));
          best = Math.max(best, meleeEV(state, p, e) * near * (pp && pp.target === e ? 1.3 : 1));
        }
        score += best;
      }
      p.r = r0; p.turn.disordered = d0;
    }
  }
  return score;
}

/** Candidate destinations for a move of `reach` inches. */
function candidates(state, u, reach) {
  const pts = [{ x: u.x, y: u.y }];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 2 * Math.PI;
    for (const f of [0.5, 1]) pts.push({ x: u.x + Math.cos(a) * reach * f, y: u.y + Math.sin(a) * reach * f });
  }
  const toward = (p) => { const d = Math.hypot(p.x - u.x, p.y - u.y); if (d < 0.1) return; const f = Math.min(1, reach / d); pts.push({ x: u.x + (p.x - u.x) * f, y: u.y + (p.y - u.y) * f }); };
  for (const o of state.table.objectives) toward(o);
  for (const e of state.units) if (e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn) toward(e);
  for (const r of state.table.pieces) if (r.cover && !r.impassable) toward({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  return pts.map((p) => ({ x: Math.min(W - u.r, Math.max(u.r, p.x)), y: Math.min(H - u.r, Math.max(u.r, p.y)) }));
}

/**
 * Choose a move: stay, move or Rush, and where. Returns { kind: 'stay'|'move'|'rush', to }.
 */
function chooseMove(state, u) {
  const M = moveOf(u);
  const best = { kind: 'stay', to: { x: u.x, y: u.y }, score: positionScore(state, u, { x: u.x, y: u.y }) };
  // each candidate is scored where the unit would really stop: a straight move halts at impassable terrain and at
  // other units, so a spot behind a blocker isn't worth what it would be if the unit got there
  const { simulateMove } = require('./move.cjs');
  const seen = new Set();
  const reach = (p, budget) => { const e = simulateMove(state, u, p, budget); const k = `${e.x.toFixed(1)},${e.y.toFixed(1)}`; if (seen.has(k + budget)) return null; seen.add(k + budget); return e; };
  if (M > 0 && !u.statuses.has('Pinned')) {
    for (const c of candidates(state, u, M)) {
      const p = reach(c, M); if (!p) continue;
      const s = positionScore(state, u, p);
      if (s > best.score + 0.5) Object.assign(best, { kind: 'move', to: p, score: s });
    }
    // a unit that disembarked makes a normal move, never a Rush (CONFIRMED)
    const rb = u.turn.disembarked ? null : core.rushBonus(u);
    if (rb != null) {
      // a Rush gives up shooting (except Light/Rapid Snap Shots) and charging this turn
      const rushed = u.turn.rushed; u.turn.rushed = true;
      const R = M + rb + (Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0)));
      for (const c of candidates(state, u, R)) {
        const p = reach(c, R); if (!p) continue;
        const s = positionScore(state, u, p, { charging: false }) - (alive(u).some((m) => m.ranged.length) && !/Light|Rapid/.test(u.unitType) ? 5 : 0);
        if (s > best.score + 2) Object.assign(best, { kind: 'rush', to: p, score: s });
      }
      u.turn.rushed = rushed;
    }
  }
  return best;
}

// ---------- shooting ----------
/** The value of probably giving a target a status: stopping its charge, its shooting, or its scoring. */
function statusValue(state, shooter, target, plan) {
  let v = 0;
  const wpns = plan.picks.map((p) => p.weapon.specialRules || []);
  const xs = (name) => Math.max(-1, ...wpns.map((r) => xOf(r, name) ?? -1));
  const enemiesOfTarget = state.units.filter((e) => e.side !== target.side && !e.destroyed);
  const threat = Math.max(0, ...enemiesOfTarget.map((e) => meleeEV(state, target, e))) + Math.max(0, ...enemiesOfTarget.map((e) => evAt(shootTable(state, target, e), 24)));
  const holding = !canHold(target) ? 0 : state.mission.primary === 'claim' ? (state.table.objectives.some((o) => Math.hypot(o.x - target.x, o.y - target.y) - target.r <= scoring.CONTROL_RANGE) ? 2 * K(state, shooter.side, 'vp') : 0)
    : state.mission.primary === 'seize' ? K(state, shooter.side, 'vp') : 0;
  const prey = state.units.some((e) => e.side === shooter.side && e.rules.includes('Prey Instinct')) ? 15 : 0;
  const fail = (key, x) => (x < 0 ? 0 : 1 - passChance(state, target, key, x));
  const p = xs('Pinning'); if (p >= 0 && !target.statuses.has('Pinned')) v += fail('CL', p) * (0.5 * threat + holding + prey) * 0.8;
  const s = xs('Suppressive'); if (s >= 0 && !target.statuses.has('Suppressed')) v += fail('CL', s) * (0.4 * threat + holding + prey);
  const st = xs('Stun'); if (st >= 0 && !target.statuses.has('Stunned')) v += fail('CL', st) * (0.5 * threat + holding + prey);
  const pa = xs('Panic'); if (pa >= 0 && !target.statuses.has('Routed')) v += fail('LD', pa) * (threat + holding + prey) * 0.7;
  return v;
}
/** Pick a target for a unit's Shooting Attack, or null. */
function chooseTarget(state, u, opts = {}) {
  let best = null;
  for (const e of state.units) {
    if (e.side === u.side || e.destroyed || !e.arrived || e.embarkedIn || e.lockedWith.size) continue;
    const plan = planVolley(u, e, state, { stationary: !!u.turn.stationary && !u.statuses.size, snap: opts.snap || core.snapOnly(u) || (legions.is(e, 'Raven Guard') && gap(u, e) >= 18) });
    if (!plan.picks.length) continue;
    let v = plan.expectedPts + statusValue(state, u, e, plan);
    // Destroy the Enemy: finishing a unit scores its Kill Points
    if (state.mission.primary === 'destroy') {
      const left = alive(e).reduce((t, m) => t + m.wounds, 0);
      const r = plan.expectedDamage / Math.max(1, left);
      v += (r >= 1.2 ? 0.8 : r >= 0.8 ? 0.5 : r >= 0.5 ? 0.2 : 0) * scoring.killPoints(e) * K(state, u.side, 'vp') * 0.8;
    }
    // Vanguard: the units holding markers come first
    v += huntValue(state, u, e, plan.expectedPts, finishChance(plan.expectedPts, e));
    // lanes: clearing the way for this turn's charges
    if (K(state, u.side, 'lanes') && state.phase === 'shooting') v += K(state, u.side, 'lanes') * laneValue(state, u, e, plan.expectedPts);
    // concede: the Warlord and Giant Killer prizes for destroying it (Kill Points are above, Vanguard in huntValue)
    if (K(state, u.side, 'concede')) v += K(state, u.side, 'concede') * concedeVP(state, e, { kp: false, vanguard: false }) * K(state, u.side, 'vp') * finishChance(plan.expectedPts, e);
    // retfire: a target that will likely Return Fire hits back first (before casualties are removed)
    if (K(state, u.side, 'retfire') && state.phase === 'shooting' && canReturnFire(state, e)) {
      const back = evAt(shootTable(state, e, u), gap(u, e));
      if (back > 0 && worthReacting(state, e.side, back, 'shooting')) v -= K(state, u.side, 'retfire') * back;
    }
    if (!best || v > best.v) best = { target: e, v };
  }
  return best && best.v > K(state, u.side, 'shootBar') ? best.target : null;
}

// ---------- charges ----------
/** Should this unit charge, and whom? Returns a target or null. */
function chooseCharge(state, u) {
  if (!canCharge(u) || u.turn.rushed || u.turn.noCharge || u.lockedWith.size) return null;
  const pl = plan.of(state, u);
  let best = null;
  for (const e of state.units) {
    if (e.side === u.side || e.destroyed || !e.arrived || e.embarkedIn || /Flyer/.test(e.unitType)) continue;
    // SHEET: the target must be within 12" and in Line of Sight
    if (chargeOdds(u, u, e) <= 0 || !lineOfSight(state.table, u, e)) continue;
    const odds = chargeOddsNow(state, u, e);
    if (odds <= 0) continue;
    // waiting for the wave (plan.cjs): no charge unless the enemy is already on top of the unit
    if (pl?.waiting && !(odds >= 0.9 && gap(u, e) <= 3)) continue;
    const gain = meleeEV(state, u, e) * K(state, u.side, 'chargeGain') - meleeEV(state, e, u) * K(state, u.side, 'chargeTake');
    // Overwatch and volleys cost something on the way in
    const incoming = evAt(shootTable(state, e, u), gap(u, e)) * K(state, u.side, 'incoming');
    // tying up a unit on an objective is worth something, unless the fight is hopeless
    const hopeless = meleeEV(state, e, u) > 2 * meleeEV(state, u, e) + 10;
    const obj = !hopeless && canHold(e) && (state.mission.primary === 'seize' || state.table.objectives.some((o) => Math.hypot(o.x - e.x, o.y - e.y) - e.r <= scoring.CONTROL_RANGE)) ? K(state, u.side, 'vp') : 0;
    // a unit locked in combat controls nothing, so a charge costs what the unit scores where it stands (a marker, or
    // its share of a Sector), unless the target scores in the same place and is locked out of it too
    const held = markerHeld(state, u);
    let leave = held && Math.hypot(held.x - e.x, held.y - e.y) - e.r > scoring.CONTROL_RANGE ? scoring.markerWorth(state, u, held, held.value || 2) * K(state, u.side, 'vp') : 0;
    if (state.mission.primary === 'seize' && canHold(u)) {
      const s = scoring.sectorOf(state, u), se = scoring.sectorOf(state, e);
      if (s) leave = Math.max(leave, scoring.missionValueAt(state, u, { x: u.x, y: u.y }).here * K(state, u.side, 'vp') * (se === s && canHold(e) ? 0.3 : 1));
    }
    // tieup and shelter: while the two are locked neither shoots, and the charger can't be shot; the lock lasts as
    // long as the weaker side holds out, two turns at most, and only while there are turns left
    let lock = 0;
    const tw = K(state, u.side, 'tieup'), sw = K(state, u.side, 'shelter');
    if ((tw || sw) && !e.vehicle) {
      const rounds = Math.min(2, pointsLeft(u) / Math.max(5, meleeEV(state, e, u)), pointsLeft(e) / Math.max(5, meleeEV(state, u, e))) * endFactor(state, 1 - u.side);
      if (tw) lock += tw * (bestShot(state, e, u.side) - bestShot(state, u, e.side)) * rounds;
      if (sw) lock += sw * fireOn(state, u, e) * Math.min(1, rounds);
    }
    // concede: the Warlord and Giant Killer prizes (and Kill Points) for wiping it out
    const prize = K(state, u.side, 'concede') ? K(state, u.side, 'concede') * concedeVP(state, e, { vanguard: false }) * K(state, u.side, 'vp') * finishChance(meleeEV(state, u, e), e) : 0;
    const v = odds * (gain + obj + lock + prize + huntValue(state, u, e, meleeEV(state, u, e), breakChance(state, u, e))) - incoming - (1 - odds) * K(state, u.side, 'chargeFail') - leave;
    if (v > K(state, u.side, 'chargeBar') && (!best || v > best.v)) best = { target: e, v };
  }
  return best ? best.target : null;
}

/** Could e Return Fire if shot now (a point of its allotment left, not yet reacted, guns, free to act)? */
function canReturnFire(state, e) {
  return (state.reactionsLeft?.[e.side] || 0) > 0 && !e.reacted && !e.lockedWith.size && !e.statuses.has('Stunned') && !e.statuses.has('Routed')
    && alive(e).some((m) => m.ranged.length);
}

// ---------- reactions ----------
/**
 * Decide whether a reaction is worth one point of the allotment, given what is left this turn. Before the
 * Assault Phase the last point is kept for a charge reaction (Overwatch and the like) when enemy assault units
 * are close enough to charge.
 */
const worthReacting = (state, side, value, phase) => {
  const left = state.reactionsLeft[side];
  if (left <= 0) return false;
  let bar = K(state, side, 'react') * (left >= 3 ? 8 : left === 2 ? 14 : 22);
  if (left === 1 && phase !== 'assault') bar = Math.max(bar, keepForCharges(state, side));
  return value >= bar;
};
/** What the last reaction point is likely worth against this turn's charges. */
function keepForCharges(state, side) {
  let best = 0;
  for (const e of state.units) {
    if (e.side === side || e.destroyed || !e.arrived || e.embarkedIn || !canCharge(e) || e.turn.rushed || e.turn.noCharge) continue;
    const reach = (e.turn.moved ? 0 : moveOf(e)) + core.setupMove(e) + 6;
    for (const u of state.units) {
      if (u.side !== side || u.destroyed || !u.arrived || u.embarkedIn || u.reacted || gap(e, u) > reach) continue;
      best = Math.max(best, meleeEV(state, e, u) * 0.4);
    }
  }
  return best;
}

// ---------- challenges ----------
/** Expected wounds a model inflicts on another in one Strike Step. */
function duelEV(a, b) {
  const tgt = { models: [b] };
  let best = 0;
  for (const w of a.melee) best = Math.max(best, expectedGroup(meleeGroup(a, w, tgt, {}), tgt));
  return best;
}

module.exports = { concedeVP, nextTurnOdds, detour, screenValue, toward, DEFAULTS, K, huntValue, markerHeld, VP_WORTH, shootTable, evAt, meleeEV, maxRange, chargeChance, chargeOdds, chargeOddsNow, canCharge, positionScore, candidates, chooseMove, chooseTarget, chooseCharge, statusValue, worthReacting, duelEV, moveOf, shootValue, meleeValue };
