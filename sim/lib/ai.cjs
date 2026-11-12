'use strict';
// Decisions. Every choice is scored in expected points: damage the unit can deal, damage it will take, and
// objectives it can hold (one Victory Point is worth VP_WORTH points). The AI looks one step ahead: where
// will this unit be safest and most useful when the enemy acts next?
const { num, xOf, has, p2d6AtMost } = require('./rules.cjs');
const { meleeGroup, expectedGroup } = require('./attack.cjs');
const { planVolley, valuePerWound, rangeOf } = require('./fire.cjs');
const { dist, gap, lineOfSight, inCover, inside, W, H } = require('./table.cjs');
const { alive, passChance, canHold } = require('./checks.cjs');
const core = require('./core.cjs');

const VP_WORTH = 45;          // points of value per Victory Point
const BANDS = [0, 3, 6, 9, 12, 15, 18, 24, 30, 36, 48, 72];

// ---------- precomputed matchups ----------
/** Expected points a unit deals with its guns to another, by range band (ignoring Line of Sight and cover). */
function shootTable(state, a, b) {
  const key = `${a.uid}>${b.uid}:${alive(a).length}:${alive(b).length}:${a.statuses.has('Suppressed') ? 1 : 0}`;
  const c = state.cache.shoot;
  if (c.has(key)) return c.get(key);
  const out = BANDS.map((d) => {
    const fake = { x: 0, y: 0, r: 0 };
    const tgt = Object.assign(Object.create(Object.getPrototypeOf(b)), b, { x: d, y: 0, r: 0 });
    const src = Object.assign(Object.create(Object.getPrototypeOf(a)), a, fake);
    return planVolley(src, tgt, state, { losOK: true, coverSave: null, stationary: true, snap: a.statuses.has('Suppressed') }).expectedPts;
  });
  c.set(key, out);
  return out;
}
const evAt = (table, d) => { let v = 0; for (let i = BANDS.length - 1; i >= 0; i--) if (d <= BANDS[i]) v = table[i]; return v; };
const maxRange = (u) => Math.max(0, ...alive(u).flatMap((m) => m.ranged.map(rangeOf)));

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
const moveOf = (u) => num(alive(u)[0]?.p.M, 0);
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
  const g = Math.max(0, Math.hypot(pos.x - t.x, pos.y - t.y) - u.r - t.r);
  if (g > core.CHARGE_DECLARE_RANGE) return 0;
  const left = g - (u.turn.disordered ? 0 : core.setupMove(u));
  return left <= 0 ? 1 : chargeChance(u, left);
}
const canCharge = (u) => !u.vehicle && !u.statuses.has('Pinned') && !u.statuses.has('Routed') && alive(u).some((m) => m.melee.length && !m.vehicle) && !/Flyer/.test(u.unitType);

// ---------- what a unit is for ----------
const shootValue = (state, u, enemies) => Math.max(0, ...enemies.map((e) => evAt(shootTable(state, u, e), 18)));
const meleeValue = (state, u, enemies) => Math.max(0, ...enemies.map((e) => meleeEV(state, u, e)));

// ---------- scoring a position ----------
function positionScore(state, u, pos, opts = {}) {
  const enemies = state.units.filter((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn);
  const saved = { x: u.x, y: u.y };
  u.x = pos.x; u.y = pos.y;
  let score = 0;
  // objectives: Victory Points this unit could hold here, and progress towards the nearest
  if (core.canHoldObjectives(u) && !u.statuses.size) {
    for (const o of state.table.objectives) {
      const d = Math.hypot(o.x - pos.x, o.y - pos.y) - u.r;
      const turnsLeft = Math.max(1, state.turnsLeft);
      if (d <= core.CONTROL_RANGE) score += o.value * VP_WORTH * 0.6 * Math.min(2, turnsLeft) * (1 + (xOf(u.rules, 'Line') || 0) * 0.5);
      else score += o.value * VP_WORTH * 0.25 * Math.max(0, 1 - d / 36);
    }
  }
  // offence: the best shot from here, and the best charge from here
  let shoot = 0, melee = 0;
  for (const e of enemies) {
    const g = gap(u, e);
    if (alive(u).some((m) => m.ranged.length)) {
      const v = evAt(shootTable(state, u, e), g);
      if (v > shoot && (v > 0) && lineOfSight(state.table, u, e)) shoot = v;
    }
    if (opts.charging !== false && canCharge(u) && !u.turn.rushed) {
      const v = meleeEV(state, u, e) * chargeOdds(u, pos, e);
      if (v > melee) melee = v;
    }
  }
  // next turn: closing in for a charge, or getting guns into range
  let soon = 0;
  for (const e of enemies) {
    const g = gap(u, e);
    if (canCharge(u)) {
      const reachNext = moveOf(u) + core.setupMove(u) + 4.5;
      soon = Math.max(soon, meleeEV(state, u, e) * Math.max(0, Math.min(1, 1 - (g - reachNext) / 24)) * 0.45);
    }
    if (alive(u).some((m) => m.ranged.length)) soon = Math.max(soon, evAt(shootTable(state, u, e), Math.max(0, g - moveOf(u))) * 0.3);
  }
  score += Math.max(shoot, melee) + 0.3 * Math.min(shoot, melee) + soon;
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
  score -= risk * 0.35 * (opts.cautious ?? 1);
  // standing still with heavy weapons is worth something
  if (pos.x === saved.x && pos.y === saved.y && alive(u).some((m) => m.ranged.some((w) => has(w.specialRules, 'Heavy') || has(w.specialRules, 'Ordnance')))) score += shoot * 0.15;
  u.x = saved.x; u.y = saved.y;
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
  if (M > 0 && !u.statuses.has('Pinned')) {
    for (const p of candidates(state, u, M)) {
      const s = positionScore(state, u, p);
      if (s > best.score + 0.5) Object.assign(best, { kind: 'move', to: p, score: s });
    }
    const rb = core.rushBonus(u);
    if (rb != null) {
      // a Rush gives up shooting (except Light/Rapid Snap Shots) and charging this turn
      const rushed = u.turn.rushed; u.turn.rushed = true;
      for (const p of candidates(state, u, M + rb + (Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0))))) {
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
  const holding = canHold(target) && state.table.objectives.some((o) => Math.hypot(o.x - target.x, o.y - target.y) - target.r <= core.CONTROL_RANGE) ? 2 * VP_WORTH : 0;
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
    const plan = planVolley(u, e, state, { stationary: !!u.turn.stationary, snap: opts.snap || u.statuses.has('Suppressed') });
    if (!plan.picks.length) continue;
    const v = plan.expectedPts + statusValue(state, u, e, plan);
    if (!best || v > best.v) best = { target: e, v };
  }
  return best && best.v > 0.5 ? best.target : null;
}

// ---------- charges ----------
/** Should this unit charge, and whom? Returns a target or null. */
function chooseCharge(state, u) {
  if (!canCharge(u) || u.turn.rushed || u.turn.noCharge || u.lockedWith.size) return null;
  let best = null;
  for (const e of state.units) {
    if (e.side === u.side || e.destroyed || !e.arrived || e.embarkedIn || /Flyer/.test(e.unitType)) continue;
    const odds = chargeOdds(u, u, e);
    if (odds <= 0) continue;
    const gain = meleeEV(state, u, e) * 1.6 - meleeEV(state, e, u) * 1.0;
    // Overwatch and volleys cost something on the way in
    const incoming = evAt(shootTable(state, e, u), gap(u, e)) * 0.35;
    // tying up a unit on an objective is worth something, unless the fight is hopeless
    const hopeless = meleeEV(state, e, u) > 2 * meleeEV(state, u, e) + 10;
    const obj = !hopeless && canHold(e) && state.table.objectives.some((o) => Math.hypot(o.x - e.x, o.y - e.y) - e.r <= core.CONTROL_RANGE) ? VP_WORTH : 0;
    const v = odds * (gain + obj) - incoming - (1 - odds) * 10;
    if (v > 3 && (!best || v > best.v)) best = { target: e, v };
  }
  return best ? best.target : null;
}

// ---------- reactions ----------
/** Decide whether a reaction is worth one point of the allotment, given what is left this turn. */
const worthReacting = (state, side, value) => {
  const left = state.reactionsLeft[side];
  if (left <= 0) return false;
  return value >= (left >= 3 ? 8 : left === 2 ? 14 : 22);
};

// ---------- challenges ----------
/** Expected wounds a model inflicts on another in one Strike Step. */
function duelEV(a, b) {
  const tgt = { models: [b] };
  let best = 0;
  for (const w of a.melee) best = Math.max(best, expectedGroup(meleeGroup(a, w, tgt, {}), tgt));
  return best;
}

module.exports = { VP_WORTH, shootTable, evAt, meleeEV, maxRange, chargeChance, chargeOdds, canCharge, positionScore, candidates, chooseMove, chooseTarget, chooseCharge, statusValue, worthReacting, duelEV, moveOf, shootValue, meleeValue };
