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
 * for spending reactions.
 */
const DEFAULTS = { vp: VP_WORTH, line: 1.5, mission: 0.6, soonMelee: 0.45, soonShoot: 0.3, risk: 0.35, bold: 0.5, chargeGain: 1.6, chargeTake: 1.0, incoming: 0.35, chargeFail: 10, chargeBar: 3, shootBar: 0.5, react: 1 };
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
const maxRange = (u) => Math.max(0, ...alive(u).flatMap((m) => m.ranged.filter((w) => !GUNS_OF_THE_CONQUEROR.test(w.name)).map((w) => rangeOf(w, m))));

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
const moveOf = (u) => { const a = alive(u); return a.length ? Math.min(...a.map((m) => num(m.p.M, 0))) : 0; };
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
    if (opts.charging !== false && !waiting && canCharge(u) && !u.turn.rushed) {
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
  // risk: what the enemy can do to this unit next turn from where it stands now
  let risk = 0;
  for (const e of enemies) {
    const reach = moveOf(e);
    const g = Math.max(0, gap(u, e) - reach);
    const s = evAt(shootTable(state, e, u), g);
    if (s > 0 && lineOfSight(state.table, e, u)) risk += s * (inCover(state.table, e, u) ? 0.7 : 1);
    if (canCharge(e)) {
      // the enemy moves its full Movement towards this unit, then charges
      const ge = Math.max(0, gap(u, e) - reach), left = ge - core.setupMove(e);
      const p = ge > core.CHARGE_DECLARE_RANGE ? 0 : left <= 0 ? 1 : chargeChance(e, left);
      risk += meleeEV(state, e, u) * p * 0.8;
    }
  }
  // a unit can't lose more than it has left; assault troops (Vanguard), and transports carrying assault troops,
  // accept more of it to reach the enemy
  const assaultCargo = (u.passengers || []).some((p) => canCharge(p) && meleeValue(state, p, enemies) > shootValue(state, p, enemies));
  // while waiting for the wave an assault group hides: more weight on risk, and no Vanguard or cargo boldness
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
        const reach = moveOf(u) + (p.turn.disordered ? 0 : core.setupMove(p)) + 4.5 + p.r;
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
    const rb = core.rushBonus(u);
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
    const odds = chargeOdds(u, u, e);
    // SHEET: the target must be within 12" and in Line of Sight
    if (odds <= 0 || !lineOfSight(state.table, u, e)) continue;
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
    const v = odds * (gain + obj + huntValue(state, u, e, meleeEV(state, u, e), breakChance(state, u, e))) - incoming - (1 - odds) * K(state, u.side, 'chargeFail') - leave;
    if (v > K(state, u.side, 'chargeBar') && (!best || v > best.v)) best = { target: e, v };
  }
  return best ? best.target : null;
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

module.exports = { DEFAULTS, K, huntValue, markerHeld, VP_WORTH, shootTable, evAt, meleeEV, maxRange, chargeChance, chargeOdds, canCharge, positionScore, candidates, chooseMove, chooseTarget, chooseCharge, statusValue, worthReacting, duelEV, moveOf, shootValue, meleeValue };
