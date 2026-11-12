'use strict';
// The Movement Phase: Reserves, moving and Rushing, disembarking, the Reposition reaction, and Fall Back Moves
// for Routed units in the Rout Sub-Phase.
const { num, xOf, has } = require('./rules.cjs');
const { dist, gap, inside, lineOfSight, moveToward, W, H } = require('./table.cjs');
const { alive } = require('./checks.cjs');
const { footprint } = require('./army.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');

const enemiesOf = (state, u) => state.units.filter((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn);
const ignoresTerrain = (u) => alive(u).every((m) => /Antigrav|Flyer|Super-[Hh]eavy|Knight|Titan|Jump/.test(m.unitType)) || has(u.rules, 'Move Through Cover');

/**
 * Move a unit towards a point by up to `budget` inches, keeping 1" from enemy units (unless charging) and losing
 * 2" if the path crosses difficult terrain (CONFIRMED).
 */
function moveUnit(state, u, to, budget, opts = {}) {
  const crossesDifficult = !ignoresTerrain(u) && state.table.pieces.some((r) => r.difficult && segThrough(u, to, r));
  const b = Math.max(0, budget - (crossesDifficult ? core.DIFFICULT_PENALTY : 0));
  const blockers = opts.charging ? state.units.filter((x) => x !== u && !x.destroyed && x.arrived && !x.embarkedIn && x !== opts.target).map((x) => ({ x: x.x, y: x.y, r: x.r + (x.side !== u.side ? 1 : 0) }))
    : state.units.filter((x) => x !== u && !x.destroyed && x.arrived && !x.embarkedIn).map((x) => ({ x: x.x, y: x.y, r: x.r + (x.side !== u.side ? 1 : 0) }));
  const tableView = ignoresTerrain(u) ? { pieces: state.table.pieces.filter((r) => r.impassable && !alive(u).some((m) => /Flyer/.test(m.unitType))).map((r) => Object.assign({}, r, { difficult: false })) } : state.table;
  u.ignoresTerrain = true; // difficult terrain is handled by the flat penalty above
  const moved = moveToward(tableView, u, to, b, blockers);
  u.ignoresTerrain = false;
  if (u.passengers.length) for (const p of u.passengers) { p.x = u.x; p.y = u.y; }
  return moved;
}
const segThrough = (a, b, r) => require('./table.cjs').segHitsRect(a, b, r) || inside(a, r) || inside(b, r);

/** Reserves Sub-Phase: units in Reserves test to arrive (Deep Strike, Outflank, other reserves). */
function reservesSubPhase(state, side) {
  if (state.round < core.RESERVES_FROM_TURN) return;
  let deepStrikes = 0;
  for (const u of state.units.filter((x) => x.side === side && x.reserve && !x.destroyed)) {
    const auto = state.round >= 4;
    if (!auto && state.dice.d6() < core.RESERVES_TEST) continue;
    if (u.reserve === 'deep') {
      if (deepStrikes >= core.DEEP_STRIKES_PER_TURN) continue;
      deepStrikes++;
      placeDeepStrike(state, u);
      u.turn.arrivedDeep = true;
      u.turn.noCharge = true;
    } else if (u.reserve === 'outflank') {
      placeOutflank(state, u);
      u.turn.noCharge = !inZone(state, u);
    } else {
      placeFromEdge(state, u);
    }
    u.reserve = null; u.arrived = true;
    for (const p of u.passengers) { p.arrived = true; p.x = u.x; p.y = u.y; }
    state.log(`  ${u.name} arrives from Reserves${u.turn.arrivedDeep ? ' by Deep Strike' : ''} at (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
    // Intercept-style reactions are offered by the battle loop through this hook
    if (state.onArrive) state.onArrive(u);
  }
}
const inZone = (state, u) => (u.side === 0 ? u.y <= state.mission.deployDepth : u.y >= H - state.mission.deployDepth);
function freeSpot(state, u, cands) {
  for (const p of cands) {
    const ok = state.units.every((x) => x === u || x.destroyed || !x.arrived || x.embarkedIn || Math.hypot(x.x - p.x, x.y - p.y) >= x.r + u.r + (x.side !== u.side ? 1 : 0.3))
      && !state.table.pieces.some((r) => r.impassable && inside(p, r));
    if (ok) return p;
  }
  return cands[cands.length - 1];
}
function placeDeepStrike(state, u) {
  // the best spot within reach of a juicy target or an objective, at least 1" from enemies
  u.r = footprint(u);
  const cands = [];
  for (let i = 0; i < 40; i++) cands.push({ x: u.r + 1 + state.dice.rnd() * (W - 2 * u.r - 2), y: u.r + 1 + state.dice.rnd() * (H - 2 * u.r - 2) });
  let best = null;
  for (const p of cands) {
    const s = ai.positionScore(state, u, p);
    const near = enemiesOf(state, u).some((e) => Math.hypot(e.x - p.x, e.y - p.y) < e.r + u.r + 1);
    if (near) continue;
    if (!best || s > best.s) best = { p, s };
  }
  const p = freeSpot(state, u, [best ? best.p : cands[0], ...cands]);
  u.x = p.x; u.y = p.y;
}
function placeOutflank(state, u) {
  u.r = footprint(u);
  const y0 = state.mission.deployDepth + 1, y1 = H - state.mission.deployDepth - 1;
  const cands = [];
  for (let i = 0; i < 20; i++) { const y = y0 + state.dice.rnd() * (y1 - y0); cands.push({ x: u.r, y }, { x: W - u.r, y }); }
  let best = null;
  for (const p of cands) {
    if (enemiesOf(state, u).some((e) => Math.hypot(e.x - p.x, e.y - p.y) - e.r - u.r < 7)) continue;
    const s = ai.positionScore(state, u, p);
    if (!best || s > best.s) best = { p, s };
  }
  const p = freeSpot(state, u, [best ? best.p : cands[0], ...cands]);
  u.x = p.x; u.y = p.y;
}
function placeFromEdge(state, u) {
  u.r = footprint(u);
  const y = u.side === 0 ? u.r : H - u.r;
  const cands = [];
  for (let i = 0; i < 12; i++) cands.push({ x: u.r + state.dice.rnd() * (W - 2 * u.r), y });
  const p = freeSpot(state, u, cands);
  u.x = p.x; u.y = p.y;
}

/** Move Sub-Phase: each unit moves, Rushes, stays or disembarks; the opponent may Reposition in reply. */
function moveSubPhase(state, side) {
  const units = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn);
  // fast and far units first, so the slower ones can respond to where they ended up
  units.sort((a, b) => ai.moveOf(b) - ai.moveOf(a));
  for (const u of units) {
    if (u.destroyed || u.lockedWith.size || u.statuses.has('Routed') || u.turn.arrivedDeep) { u.turn.stationary = !u.turn.arrivedDeep; continue; }
    if (u.statuses.has('Pinned')) { u.turn.stationary = true; continue; }
    // passengers: get out if the AI likes the spot they'd have outside better than staying in
    if (u.passengers.length && state.round >= 1) disembarkIfWorth(state, u);
    const d = ai.chooseMove(state, u);
    if (d.kind === 'stay') { u.turn.stationary = true; continue; }
    const M = ai.moveOf(u);
    const budget = d.kind === 'rush' ? M + core.rushBonus(u) + Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0)) : M;
    const moved = moveUnit(state, u, d.to, budget);
    u.turn.stationary = moved < 0.25;
    // a move no longer than the unit's Movement isn't a Rush, whatever was planned
    if (d.kind === 'rush' && moved > M + 0.25) u.turn.rushed = true; else if (d.kind === 'rush') d.kind = 'move';
    if (moved >= 0.25) state.log(`  ${u.name} ${d.kind === 'rush' ? 'Rushes' : 'moves'} ${moved.toFixed(1)}" to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
    // Reposition (core Reaction): an enemy unit within 12" and in sight may move up to its Initiative
    if (moved >= 0.25 && state.onEnemyMoved) state.onEnemyMoved(u);
    // passengers may get out after the transport moved (not after a Rush)
    if (u.passengers.length && d.kind !== 'rush') disembarkIfWorth(state, u, true);
  }
}

/** Passengers disembark next to their transport when that puts them somewhere better. */
function disembarkIfWorth(state, t, afterMove = false) {
  for (const p of [...t.passengers]) {
    p.r = footprint(p);
    const outside = [];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; outside.push({ x: t.x + Math.cos(a) * (t.r + p.r + 1), y: t.y + Math.sin(a) * (t.r + p.r + 1) }); }
    let best = null;
    for (const pos of outside) {
      if (pos.x < p.r || pos.x > W - p.r || pos.y < p.r || pos.y > H - p.r) continue;
      if (state.units.some((x) => x !== t && x !== p && !x.destroyed && x.arrived && !x.embarkedIn && Math.hypot(x.x - pos.x, x.y - pos.y) < x.r + p.r + (x.side !== p.side ? 1 : 0.3))) continue;
      const s = ai.positionScore(state, p, pos);
      if (!best || s > best.s) best = { pos, s };
    }
    if (!best) continue;
    // stay in while far from anything worth doing
    const near = enemiesOf(state, p).some((e) => gap(t, e) < 18) || state.round >= 3;
    if (!near && best.s < 25) continue;
    t.passengers = t.passengers.filter((x) => x !== p);
    p.embarkedIn = null; p.arrived = true;
    p.x = best.pos.x; p.y = best.pos.y;
    p.turn.disembarked = true;
    p.turn.stationary = false;
    // a unit that disembarked charges Disordered unless its transport is an Assault Vehicle (CONFIRMED)
    p.turn.disordered = !has(t.rules, 'Assault Vehicle');
    if (afterMove) p.turn.noMove = true;
    state.log(`  ${p.name} disembarks from ${t.name}`);
  }
}

/** Rout Sub-Phase: Routed units Fall Back towards their own table edge; off the table means destroyed. */
function routSubPhase(state, side) {
  for (const u of state.units.filter((x) => x.side === side && !x.destroyed && x.arrived && !x.embarkedIn && x.statuses.has('Routed') && !x.lockedWith.size)) fallBack(state, u);
}
function fallBack(state, u) {
  const d = core.fallBackDistance(u, state.dice);
  const edgeY = u.side === 0 ? 0 : H;
  const target = { x: u.x, y: edgeY };
  const before = u.y;
  u.ignoresTerrain = true;
  const moved = moveToward({ pieces: state.table.pieces.filter((r) => r.impassable) }, u, target, d, []);
  u.ignoresTerrain = false;
  const dist2edge = u.side === 0 ? u.y - u.r : H - u.y - u.r;
  state.log(`  ${u.name} falls back ${d}"`);
  if (dist2edge <= 0.6 && Math.abs(before - u.y) + 0.5 >= Math.abs(before - edgeY) - u.r - 0.5) {
    state.log(`  ${u.name} flees the battlefield`);
    if (state.onFled) state.onFled(u);
  }
  return d;
}

module.exports = { moveUnit, reservesSubPhase, moveSubPhase, routSubPhase, fallBack, disembarkIfWorth, enemiesOf, inZone };
