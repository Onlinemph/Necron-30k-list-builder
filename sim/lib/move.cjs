'use strict';
// The Movement Phase: Reserves, moving and Rushing, disembarking, the Reposition reaction, and Fall Back Moves
// for Routed units in the Rout Sub-Phase.
const { num, xOf, has } = require('./rules.cjs');
const { dist, gap, inside, lineOfSight, moveToward, W, H } = require('./table.cjs');
const { alive, check, addStatus } = require('./checks.cjs');
const { footprint } = require('./army.cjs');
const { inArea, EDGE } = require('./mission.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');
const scoring = require('./scoring.cjs');

const enemiesOf = (state, u) => state.units.filter((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn);
const ignoresTerrain = (u) => alive(u).every((m) => /Antigrav|Flyer|Super-[Hh]eavy|Knight|Titan|Jump/.test(m.unitType)) || has(u.rules, 'Move Through Cover');

/**
 * Move a unit towards a point by up to `budget` inches, keeping 1" from enemy units (unless charging) and losing
 * 2" if the path crosses difficult terrain (CONFIRMED).
 */
/** Where a move of this unit towards `to` would really stop (terrain and other units block a straight path). */
function simulateMove(state, u, to, budget, opts = {}) {
  const shadow = { x: u.x, y: u.y, r: u.r };
  const { tableView, b, blockers } = moveSetup(state, u, to, budget, opts);
  shadow.ignoresTerrain = true;
  moveToward(tableView, shadow, to, b, blockers);
  return { x: shadow.x, y: shadow.y };
}
function moveSetup(state, u, to, budget, opts) {
  // Tectonic Instability: this turn's Sector counts as Difficult Terrain (MISSION)
  const quake = state.tectonic && state.mission.sectors.find((s) => s.id === state.tectonic);
  const inQuake = quake && [0, 0.5, 1].some((f) => inArea(quake.area, { x: u.x + (to.x - u.x) * f, y: u.y + (to.y - u.y) * f }));
  // Remorseless Advance (Death Guard): difficult terrain doesn't slow them
  const crossesDifficult = !ignoresTerrain(u) && !legions.is(u, 'Death Guard') && (inQuake || state.table.pieces.some((r) => r.difficult && segThrough(u, to, r)));
  const b = Math.max(0, budget - (crossesDifficult ? core.DIFFICULT_PENALTY : 0));
  const blockers = opts.charging ? state.units.filter((x) => x !== u && !x.destroyed && x.arrived && !x.embarkedIn && x !== opts.target).map((x) => ({ x: x.x, y: x.y, r: x.r + (x.side !== u.side ? 1 : 0) }))
    : state.units.filter((x) => x !== u && !x.destroyed && x.arrived && !x.embarkedIn).map((x) => ({ x: x.x, y: x.y, r: x.r + (x.side !== u.side ? 1 : 0) }));
  const tableView = ignoresTerrain(u) ? { pieces: state.table.pieces.filter((r) => r.impassable && !alive(u).some((m) => /Flyer/.test(m.unitType))).map((r) => Object.assign({}, r, { difficult: false })) } : state.table;
  return { tableView, b, blockers };
}
function moveUnit(state, u, to, budget, opts = {}) {
  const from = { x: u.x, y: u.y };
  const { tableView, b, blockers } = moveSetup(state, u, to, budget, opts);
  u.ignoresTerrain = true; // difficult terrain is handled by the flat penalty above
  const moved = moveToward(tableView, u, to, b, blockers);
  u.ignoresTerrain = false;
  if (u.passengers.length) for (const p of u.passengers) { p.x = u.x; p.y = u.y; }
  // a vehicle ends facing the way it drove
  if (u.vehicle && moved > 0.5) u.facing = Math.atan2(u.y - from.y, u.x - from.x);
  return moved;
}
/** Points on the battlefield edge of this side's Deployment Zone (where reserves walk on, and the Routed run). */
const homeEdge = (state, side) => {
  const z = state.zoneOf[side];
  const pts = EDGE.filter((p) => inArea(z, p));
  return pts.length ? pts : EDGE;
};
const segThrough = (a, b, r) => require('./table.cjs').segHitsRect(a, b, r) || inside(a, r) || inside(b, r);

const hasItem = (u, re) => alive(u).some((m) => (m.items || []).some((i) => re.test(i)));
/**
 * Chosen of the Khagan (Qin Xa): once per battle, at the start of a Reserves Sub-Phase, one White Scars unit in Reserves
 * arrives without a roll (CONFIRMED). The AI uses it the first time a roll is needed, on the most expensive such unit.
 */
function chosenOfTheKhagan(state, side, reserves) {
  if (state.khaganUsed?.[side] || !state.units.some((x) => x.side === side && !x.destroyed && alive(x).some((m) => has(m.rules, 'Chosen of the Khagan')))) return null;
  const elig = reserves.filter((x) => alive(x).length && alive(x).every((m) => (m.traits || []).includes('White Scars')));
  if (!elig.length) return null;
  state.khaganUsed = state.khaganUsed || [false, false];
  state.khaganUsed[side] = true;
  const pick = elig.reduce((b, x) => (x.pts > b.pts ? x : b), elig[0]);
  state.log(`  ${pick.name} needs no Reserves Test (Chosen of the Khagan)`);
  return pick;
}

/** Reserves Sub-Phase: units in Reserves test to arrive (Deep Strike, Outflank, other reserves). */
function reservesSubPhase(state, side) {
  if (state.round < core.RESERVES_FROM_TURN) return;
  let deepStrikes = 0;
  // MISSION: from the start of Battle Turn 4 Reserves Tests pass automatically
  const auto = state.round >= core.RESERVES_AUTO_TURN;
  let reserves = state.units.filter((x) => x.side === side && x.reserve && !x.destroyed);
  const chosen = auto ? null : chosenOfTheKhagan(state, side, reserves);
  if (chosen) reserves = [chosen, ...reserves.filter((x) => x !== chosen)];
  // Corax's Shame (Deliverers): -1 to their Reserves Tests in a Sub-Phase that began with Corvus Corax in Reserves (CONFIRMED)
  const corax = reserves.some((x) => alive(x).some((m) => /^Corvus Corax/.test(m.name)));
  for (const u of reserves) {
    if (!auto && u !== chosen) {
      let roll = state.dice.d6();
      // Vox-interlink (Remus Ventanus): +1 while a model with one is on the battlefield (CONFIRMED)
      if (state.units.some((x) => x.side === side && !x.destroyed && x.arrived && !x.reserve && hasItem(x, /^Vox-interlink/i))) roll += 1;
      if (corax && has(u.rules, 'Corax’s Shame')) roll -= 1;
      // Coordinate (Lotara Sarrin's Shadow of the Conquerer, battle.cjs): +1 to one Aerial Reserves Test this turn
      if (u.reserve === 'aerial' && state.coordinate?.[side] === state.round) { roll += 1; state.coordinate[side] = null; }
      if (roll < core.RESERVES_TEST) continue;
    }
    if (u.reserve === 'deep') {
      if (deepStrikes >= core.DEEP_STRIKES_PER_TURN) continue;
      deepStrikes++;
      placeDeepStrike(state, u);
      u.turn.arrivedDeep = true;
      u.turn.noCharge = true;
      // Void Commander (Alexis Polux), Master of the Justaerin (Ezekyle Abaddon): deployed by Deep Strike, his unit has
      // Feel No Pain (5+) until the controlling player's next Effects Sub-Phase (CONFIRMED; ASSUMPTION: the End Phase's,
      // this turn, battle.cjs)
      if (alive(u).some((m) => has(m.rules, 'Void Commander') || has(m.rules, 'Master of the Justaerin'))) {
        require('./reactions.cjs').addBuff(u, { fnp: 5 }, 'effects');
        state.log(`  ${u.name} has Feel No Pain (5+) after its Deep Strike`);
      }
    } else if (u.reserve === 'outflank') {
      // SHEET: an outflanking unit may charge; models embarked in it may not
      placeOutflank(state, u);
      for (const p of u.passengers) p.turn.noCharge = true;
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
  // any battlefield edge outside the enemy Deployment Zone and 7" from enemy models (SHEET)
  const ez = state.zoneOf[1 - u.side];
  const edge = EDGE.filter((p) => !inArea(ez, p));
  const cands = [];
  for (let i = 0; i < 40; i++) cands.push(inset(edge[Math.floor(state.dice.rnd() * edge.length)], u.r));
  let best = null;
  for (const p of cands) {
    if (enemiesOf(state, u).some((e) => Math.hypot(e.x - p.x, e.y - p.y) - e.r - u.r < 7)) continue;
    const s = ai.positionScore(state, u, p);
    if (!best || s > best.s) best = { p, s };
  }
  const p = freeSpot(state, u, [best ? best.p : cands[0], ...cands]);
  u.x = p.x; u.y = p.y;
}
/** A point on the edge pulled in so a unit of radius r stands on the table. */
const inset = (p, r) => ({ x: Math.min(W - r, Math.max(r, p.x)), y: Math.min(H - r, Math.max(r, p.y)) });
function placeFromEdge(state, u) {
  u.r = footprint(u);
  // from the battlefield edge of the player's own Deployment Zone (SHEET)
  const edge = homeEdge(state, u.side);
  const cands = [];
  for (let i = 0; i < 16; i++) cands.push(inset(edge[Math.floor(state.dice.rnd() * edge.length)], u.r));
  const p = freeSpot(state, u, cands);
  u.x = p.x; u.y = p.y;
}

/**
 * Battlesmith (X) (CONFIRMED, data/bsdata/common.json; N'rik Dreygur, Shadrak Meduson and Cassian Dracos Reborn have
 * it): in its Movement Phase a model with it may pick a friendly Vehicle, Automata or Walker model within 6" and make an
 * Intelligence Check; passed, the target gains X Wounds or Hull Points (+1 with a servo-arm, CONFIRMED) or loses X
 * Statuses. The AI picks whichever is worth more points: the wounds back, or about a sixth of the unit per status.
 * ASSUMPTION: done at the start of the Move Sub-Phase; the model can't pick itself; a status comes off its whole unit.
 */
function battlesmith(state, side) {
  for (const u of state.units) {
    if (u.side !== side || u.destroyed || !u.arrived || u.embarkedIn) continue;
    for (const m of alive(u)) {
      const x = xOf(m.rules, 'Battlesmith');
      if (!x) continue;
      const repair = x + ((m.items || []).some((i) => /^Servo-arm/i.test(i)) ? 1 : 0);
      let best = null;
      for (const t of state.units) {
        if (t.side !== side || t.destroyed || !t.arrived || t.embarkedIn || (t !== u && gap(u, t) > 6)) continue;
        const vpw = t.pts / Math.max(1, t.models.reduce((s, q) => s + q.maxWounds, 0));
        for (const tm of alive(t)) {
          if (tm === m || !(tm.vehicle || /Automata|Walker/.test(tm.unitType))) continue;
          const heal = Math.min(repair, tm.maxWounds - tm.wounds) * vpw;
          const restore = Math.min(x, t.statuses.size) * t.pts / 6;
          const v = Math.max(heal, restore);
          if (v > 0 && (!best || v > best.v)) best = { t, tm, v, kind: heal >= restore ? 'repair' : 'restore' };
        }
      }
      if (!best || !check(state, u, 'IN', 0, `Battlesmith on ${best.t.name}`)) continue;
      if (best.kind === 'repair') {
        const n = Math.min(repair, best.tm.maxWounds - best.tm.wounds);
        best.tm.wounds += n;
        state.log(`  ${m.name} repairs ${best.tm.name}: ${n} back (Battlesmith)`);
      } else {
        const gone = [...best.t.statuses].slice(0, x);
        for (const s of gone) best.t.statuses.delete(s);
        state.log(`  ${m.name} restores ${best.t.name}: no longer ${gone.join(', ')} (Battlesmith)`);
      }
    }
  }
}

/** Move Sub-Phase: each unit moves, Rushes, stays or disembarks; the opponent may Reposition in reply. */
function moveSubPhase(state, side) {
  battlesmith(state, side);
  const units = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn);
  const road = state.mission.has('Supply Road') && state.mission.sectors.find((s) => s.id === 3);
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
    let budget = d.kind === 'rush' ? M + core.rushBonus(u) + Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0)) : M;
    // Supply Road: a vehicle moving entirely within Sector 3 adds 2" to its Move (MISSION)
    if (road && u.vehicle && inArea(road.area, u) && inArea(road.area, d.to)) budget += 2;
    const moved = moveUnit(state, u, d.to, budget);
    u.turn.stationary = moved < 0.25;
    u.turn.moved = true;
    // a move no longer than the unit's Movement isn't a Rush, whatever was planned
    if (d.kind === 'rush' && moved > M + 0.25) u.turn.rushed = true; else if (d.kind === 'rush') d.kind = 'move';
    // Remorseless Advance (Death Guard): Heavy weapons still count after a move of 4" or less that wasn't a Rush
    if (!u.turn.rushed && moved <= 4 && legions.is(u, 'Death Guard')) u.turn.heavyOK = true;
    if (moved >= 0.25) state.log(`  ${u.name} ${d.kind === 'rush' ? 'Rushes' : 'moves'} ${moved.toFixed(1)}" to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
    // Reposition (core Reaction): an enemy unit within 12" and in sight may move up to its Initiative
    if (moved >= 0.25 && state.onEnemyMoved) state.onEnemyMoved(u);
    // passengers may get out after the transport moved (not after a Rush)
    if (u.passengers.length && d.kind !== 'rush') disembarkIfWorth(state, u, true);
  }
}

/** Passengers disembark next to their transport when that puts them somewhere better. */
function disembarkIfWorth(state, t, afterMove = false) {
  // a unit that disembarked charges Disordered (no Set-up Move) unless its transport is an Assault Vehicle
  // (CONFIRMED), so it weighs getting out that way
  const disordered = !has(t.rules, 'Assault Vehicle');
  for (const p of [...t.passengers]) {
    const d0 = p.turn.disordered;
    p.turn.disordered = d0 || disordered;
    const pos = getOutAt(state, t, p, afterMove);
    p.turn.disordered = d0;
    if (!pos) continue;
    t.passengers = t.passengers.filter((x) => x !== p);
    p.embarkedIn = null; p.arrived = true;
    p.x = pos.x; p.y = pos.y;
    p.turn.disembarked = true;
    p.turn.stationary = false;
    p.turn.disordered = d0 || disordered;
    if (afterMove) p.turn.noMove = true;
    state.log(`  ${p.name} disembarks from ${t.name}`);
  }
}
/** Where passenger p would get out of t, or null if it's better off staying in. */
function getOutAt(state, t, p, afterMove) {
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
  if (!best) return null;
  // stay in while far from anything worth doing
  const near = enemiesOf(state, p).some((e) => gap(t, e) < 18) || state.round >= 3;
  if (!near && best.s < 25) return null;
  // while the transport can still carry them closer, get out only to charge or hold a marker from here; an
  // assault unit only to charge, or to hold a marker if it's a Line unit, before or after the transport moves
  // (ASSUMPTION: the AI's rule of thumb)
  const mobile = ai.moveOf(t) > 0 && !t.statuses.has('Pinned') && !t.statuses.has('Stunned');
  // an assault unit waiting for its wave (plan.cjs) stays in its transport
  if (mobile && require('./plan.cjs').of(state, p)?.waiting) return null;
  if (mobile) {
    const foes = enemiesOf(state, p);
    const charge = ai.canCharge(p) && foes.some((e) => ai.chargeOdds(p, best.pos, e) >= 0.5);
    const assault = ai.meleeValue(state, p, foes) > ai.shootValue(state, p, foes);
    const holds = scoring.missionValueAt(state, p, best.pos).here > 0;
    if (!charge && (assault ? !(holds && scoring.majority(p, 'Line')) : !afterMove && !holds)) return null;
  }
  return best.pos;
}

/** Rout Sub-Phase: Routed units Fall Back towards their own table edge; off the table means destroyed. */
function routSubPhase(state, side) {
  for (const u of state.units.filter((x) => x.side === side && !x.destroyed && x.arrived && !x.embarkedIn && x.statuses.has('Routed') && !x.lockedWith.size)) fallBack(state, u);
}
function fallBack(state, u) {
  const d = core.fallBackDistance(u, state.dice);
  // towards the nearest point on the edge of the player's own Deployment Zone (SHEET)
  const target = homeEdge(state, u.side).reduce((b, p) => (Math.hypot(p.x - u.x, p.y - u.y) < Math.hypot(b.x - u.x, b.y - u.y) ? p : b));
  u.ignoresTerrain = true;
  moveToward({ pieces: state.table.pieces.filter((r) => r.impassable) }, u, target, d, []);
  u.ignoresTerrain = false;
  const dist2edge = Math.min(u.x - u.r, W - u.x - u.r, u.y - u.r, H - u.y - u.r);
  state.log(`  ${u.name} falls back ${d}"`);
  // SHEET: reaching the table edge, it tests Leadership: a fail removes it, a pass leaves it Suppressed
  if (dist2edge <= 0.6) {
    if (check(state, u, 'LD', 0, 'at the table edge')) addStatus(state, u, 'Suppressed', 'rallied at the table edge');
    else { state.log(`  ${u.name} flees the battlefield`); if (state.onFled) state.onFled(u); }
  }
  return d;
}

module.exports = { moveUnit, reservesSubPhase, moveSubPhase, routSubPhase, fallBack, disembarkIfWorth, enemiesOf, homeEdge, simulateMove, battlesmith };
