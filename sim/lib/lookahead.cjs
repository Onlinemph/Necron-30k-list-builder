'use strict';
// Looking ahead (ASSUMPTION: the AI's own planning, not a rule). At the start of each of its Player Turns a side with
// the `lookahead` weight tries a few plans for the whole army: its usual weights, and postures that push them one way
// (attack, hold back). For each it plays this Player Turn on a snapshot of the battle
// (snapshot.cjs), then the enemy's reply with the enemy's own AI, scores where that leaves the two armies (Victory
// Points, points of models left, markers held), puts the battle back and moves on to the next plan. Then it plays the
// best plan's turn for real. Every plan sees the same dice in its look ahead, so plans are compared on equal terms; the
// real turn rolls its own. The enemy's AI doesn't look ahead inside a look ahead.
// One look ahead is a single run of the dice, and a plan's value swings by 100-400 points between runs, about as much
// as plans differ, so each plan gets several runs (the lookahead weight is how many), and the side leaves its usual
// plan only for one that beats it by a margin. A posture of playing harder for the mission played the same as the
// usual weights nearly every turn, so it isn't tried.

const { snapshot, restore } = require('./snapshot.cjs');
const { createDice } = require('./dice.cjs');
const { alive } = require('./checks.cjs');
const scoring = require('./scoring.cjs');

/** The postures tried each turn: changes to the side's weights (ai.cjs DEFAULTS) for that turn. */
const PLANS = [
  { name: 'usual', w: {} },
  { name: 'attack', w: { risk: 0.15, bold: 0.25, chargeBar: 0, chargeFail: 5, soonMelee: 0.7 } },
  { name: 'hold back', w: { risk: 0.7, bold: 0.8, chargeBar: 8, soonMelee: 0.3 } },
];

/** Points of models a side has left (joined characters at their own points). */
function material(state, side) {
  let t = 0;
  for (const u of state.units) {
    if (u.side !== side || u.destroyed) continue;
    const own = u.models.filter((m) => !m.joinedFrom).length || 1;
    for (const m of alive(u)) t += m.joinedFrom ? m.joinedFrom.pts || 0 : (u.pts || 0) / own;
  }
  return t;
}
/** Markers and Sector strength a side holds right now, as positionScore counts them (each unit's share). */
function holding(state, side) {
  let t = 0;
  for (const u of state.units) if (u.side === side && !u.destroyed && u.arrived && !u.embarkedIn) t += scoring.missionValueAt(state, u, { x: u.x, y: u.y }).here;
  return t;
}
/** How good the battle looks for `side`: Victory Points ahead, points of models ahead, a little for what it holds. */
function evaluate(state, side, vpWorth) {
  const o = 1 - side;
  return (state.vp[side] - state.vp[o]) * vpWorth + (material(state, side) - material(state, o)) + 0.3 * vpWorth * (holding(state, side) - holding(state, o));
}

/**
 * Pick this turn's plan for `side` by looking ahead. play: { playerTurn(state, side), newRound(state), endOfBattle(state) }
 * from battle.cjs. Returns the plan's weights to play the turn with (merged over the side's own), or null to play as
 * usual. tries: look aheads per plan, each on its own dice.
 */
function choosePlan(state, side, play, { vpWorth = 45, tries = 1, margin = 0 } = {}) {
  if (state.lookingAhead) return null;
  const base = (state.aiParams && state.aiParams[side]) || {};
  // the look aheads' dice come from the real dice's position without rolling them, so looking ahead leaves the real
  // battle's rolls as they would have been
  const seeds = Array.from({ length: tries }, (_, k) => ((state.dice.state ^ Math.imul(state.round * 31 + side + 1, 0x9E3779B1) ^ Math.imul(k + 1, 0x85EBCA6B)) >>> 0));
  const results = [];
  for (const plan of PLANS) {
    let total = 0, ok = true;
    for (const seed of seeds) {
      const v = rollout(state, side, Object.assign({}, base, plan.w, { lookahead: 0 }), seed, play, vpWorth);
      if (v == null) { ok = false; break; }
      total += v;
    }
    if (ok) results.push({ plan, v: total / seeds.length });
  }
  if (!results.length) return null;
  const usual = results.find((r) => r.plan.name === 'usual');
  let best = results.reduce((b, r) => (r.v > b.v ? r : b));
  if (usual && best !== usual && best.v < usual.v + margin) best = usual;
  state.planLog = state.planLog || [];
  state.planLog.push({ round: state.round, side, plan: best.plan.name, values: results.map((r) => [r.plan.name, Math.round(r.v)]) });
  state.log(`  (looking ahead: ${results.map((r) => `${r.plan.name} ${r.v >= 0 ? '+' : ''}${Math.round(r.v)}`).join(', ')}; plays ${best.plan.name})`);
  return Object.assign({}, base, best.plan.w);
}

/** Play `side`'s turn with weights w, then the enemy's reply, on a snapshot; the value for side, or null if it broke. */
function rollout(state, side, w, seed, play, vpWorth) {
  const keep = { dice: state.dice, log: state.log, aiParams: state.aiParams };
  const snap = snapshot(state, new Set([state.dice]));
  try {
    state.lookingAhead = true;
    state.dice = createDice(seed);
    state.log = () => {};
    const params = state.aiParams ? state.aiParams.slice() : [null, null];
    params[side] = w;
    state.aiParams = params;
    play.playerTurn(state, side);
    const enemy = 1 - side, T = state.mission.turns;
    let over = false;
    if (state.first === side) play.playerTurn(state, enemy);
    else if (state.round < T) { play.newRound(state); play.playerTurn(state, enemy); }
    else over = true;
    if (over) play.endOfBattle(state);
    return evaluate(state, side, vpWorth);
  } catch (e) {
    if (process.env.SIM_DEBUG) console.error('look ahead failed:', e);
    return null;
  } finally {
    restore(snap);
    state.dice = keep.dice; state.log = keep.log; state.aiParams = keep.aiParams;
    state.lookingAhead = false;
  }
}

module.exports = { PLANS, choosePlan, evaluate, material };
