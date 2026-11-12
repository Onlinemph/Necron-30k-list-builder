'use strict';
// One battle between two lists, following the Core Mission Sequence of the Core Mission Pack: Imperium at War
// (MISSION): select the mission, prepare the battlefield, deploy objectives, select the Deployment Map, declare
// Reserves, deploy, play five Battle Turns (a sixth on a 4+), and decide the victor. Each Player Turn has its
// Start, Movement, Shooting, Assault and End Phases, with reactions from the other side. Returns the result and a
// readable log.
const { num, xOf, has } = require('./rules.cjs');
const { createDice } = require('./dice.cjs');
const { makeTable, gap, dist, inside, lineOfSight, W, H } = require('./table.cjs');
const { setupMission, rollMission, fits, touches } = require('./mission.cjs');
const { buildArmy, footprint } = require('./army.cjs');
const { alive, check, addStatus, canHold, charOf } = require('./checks.cjs');
const { shootingAttack, moraleSubPhase } = require('./shoot.cjs');
const { reservesSubPhase, moveSubPhase, routSubPhase, moveUnit } = require('./move.cjs');
const { assaultPhase, canReact, unlock } = require('./assault.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const reactions = require('./reactions.cjs');
const psychic = require('./psychic.cjs');
const scoring = require('./scoring.cjs');

/**
 * opts: { seed, log, mission: id | 'random', deployment: id | 'random', variant: 'escalation' | 'hammerblow' }
 */
function runBattle(listA, listB, opts = {}) {
  const dice = createDice(opts.seed ?? 1);
  // 1. Select Core Mission (a D3 for the Archetype, a D3 for the Mission, unless one is given)
  const missionId = !opts.mission || opts.mission === 'random' ? rollMission(dice) : opts.mission;
  // 3. Prepare the Battlefield (Supply Road: no terrain in Sector 3)
  const table = makeTable(dice, { forbid: missionId === 'secure-the-highway' ? [{ x: 0, y: 20, w: W, h: 8 }] : [] });
  // 4-5. Deploy Objectives, select the Deployment Map
  const mission = setupMission(dice, table, { mission: missionId, deployment: opts.deployment, variant: opts.variant });
  // 2. Select Armies
  const armies = [buildArmy(listA, 0), buildArmy(listB, 1)];
  const lines = [];
  const state = {
    dice, table, mission, armies, units: [...armies[0].units, ...armies[1].units],
    round: 0, active: 0, turnsLeft: mission.turns, vp: [0, 0], pendingMorale: [],
    cache: { shoot: new Map(), melee: new Map() }, reactionsLeft: [0, 0], vpLog: [],
    zoneOf: [null, null], zoneName: [null, null], destroyedUnits: [], firstStrike: [false, false], vanguardScored: new Set(), tectonic: null,
    log: opts.log ? (s) => lines.push(s) : () => {},
  };
  hooks(state);
  reactions.setup(state);
  state.reactions = reactions;
  psychic.setup(state);
  for (const u of state.units) u.arrived = false;
  // 7. Deploy Armies: the loser of the roll-off picks Deployment Zone A or B; the winner deploys first in the other
  // and takes the first Player Turn
  const winner = dice.d6() >= 4 ? 0 : 1, loser = 1 - winner;
  const pick = chooseZone(state, loser);
  state.zoneName[loser] = pick; state.zoneName[winner] = pick === 'A' ? 'B' : 'A';
  state.zoneOf = state.zoneName.map((n) => mission.zones[n]);
  state.log(`Mission: ${mission.name} (${mission.archetype}${mission.primary !== 'destroy' ? `, ${mission.variant}` : ''}) on ${mission.deployment}. ${armies[0].name} in Zone ${state.zoneName[0]}, ${armies[1].name} in Zone ${state.zoneName[1]}.`);
  if (table.objectives.length) state.log(`Objective Markers: ${table.objectives.map((o) => `(${o.x.toFixed(0)}, ${o.y.toFixed(0)})${o.value ? ` worth ${o.value}` : ''}`).join(', ')}`);
  deploy(state, winner); deploy(state, loser);
  // 8. Play: Seize the Initiative, then five Battle Turns, and a sixth if the first player rolls a 4+
  let first = winner;
  if (dice.d6() >= core.SEIZE_ON) { first = 1 - first; state.log(`${armies[first].name} Seizes the Initiative and goes first.`); }
  let turns = mission.turns;
  for (let round = 1; round <= turns; round++) {
    state.round = round; state.turnsLeft = Math.max(1, mission.turns - round + 1);
    if (mission.has('Tectonic Instability')) tectonic(state);
    for (const side of [first, 1 - first]) {
      if (!state.units.some((u) => u.side === side && !u.destroyed)) continue;
      playerTurn(state, side);
    }
    if (round === mission.turns && turns === mission.turns && dice.d6() >= 4) { turns++; state.log(`\nThe battle goes on: Battle Turn ${turns} is played.`); }
  }
  // 9. Decide Victor
  const res = finish(state, lines);
  res.first = first;
  res.mission = mission.id; res.deployment = mission.deploymentId; res.turns = turns;
  return res;
}

/** The roll-off loser's choice of zone: the one nearer the objectives that matter. */
function chooseZone(state, side) {
  const m = state.mission;
  const near = (z) => state.table.objectives.reduce((t, o) => t + (o.value || 2) * Math.max(0, 1 - Math.hypot(o.x - m.centroids[z].x, o.y - m.centroids[z].y) / 40), 0);
  return near('B') > near('A') + 0.01 ? 'B' : 'A';
}

/** Tectonic Instability: at the start of each Battle Turn a D6 picks a Sector that is Difficult Terrain this turn. */
function tectonic(state) {
  let r;
  do r = state.dice.d6(); while (r <= 4 && r === state.tectonic);
  state.tectonic = r <= 4 ? r : null;
  state.log(`\nTectonic Instability: ${state.tectonic ? `Sector ${state.tectonic} is Difficult Terrain this turn` : 'the ground is still'}`);
}

// ---------- hooks used by the phases ----------
function hooks(state) {
  state.award = (side, vp, why) => award(state, side, vp, why);
  state.onCasualty = (m, unit, by) => {
    const ppm = unit.pts / unit.models.length;
    unit.stats = unit.stats || { killed: 0, lost: 0 }; unit.stats.lost += ppm;
    if (by) { by.stats = by.stats || { killed: 0, lost: 0 }; by.stats.killed += ppm; unit.lastHitBy = by; }
  };
  state.afterDamage = (unit) => {
    if (unit.destroyed) return;
    if (!alive(unit).length) destroyed(state, unit, unit.lastHitBy);
    else unit.r = footprint(unit);
  };
  state.onFled = (unit) => {
    for (const m of unit.models) if (m.wounds > 0) { m.wounds = 0; state.onCasualty(m, unit, null); }
    destroyed(state, unit, unit.lastHitBy, true);
  };
  // reactions to an enemy ending a move (Reposition, The Hunt Closes, ...) and to arrivals from Reserves
  state.onEnemyMoved = (mover) => reactions.onMoved(state, mover);
  state.onArrive = (unit) => reactions.onArrive(state, unit);
  // Vanguard (X): breaking a unit that was near an objective, once per objective per Player Turn (CONFIRMED)
  state.onBrokeFromCombat = (unit, winners, nearObjective) => {
    if (!nearObjective) return;
    const v = Math.max(0, ...winners.filter((w) => alive(w).filter((m) => xOf(m.rules, 'Vanguard') != null).length * 2 > alive(w).length).map((w) => Math.max(...alive(w).map((m) => xOf(m.rules, 'Vanguard') || 0))));
    const key = `${state.round}:${state.active}:${nearObjective}`;
    if (v && !state.vanguardScored.has(key)) { state.vanguardScored.add(key); award(state, winners[0].side, v, `Vanguard: ${unit.name} broken near an objective`); }
  };
}

function award(state, side, vp, why) {
  if (!vp) return;
  state.vp[side] += vp;
  state.vpLog.push({ round: state.round, side, vp, why });
  state.log(`    +${vp} VP to ${state.armies[side].name}: ${why}`);
}

function destroyed(state, unit, by, fled = false) {
  if (unit.destroyed) return;
  unit.destroyed = true;
  state.log(`    ${unit.name} is ${fled ? 'gone (fled)' : 'destroyed'}`);
  // Explodes (X): a vehicle that dies may blow up (CONFIRMED profile: S8 AP- D1, base HP or W hits within 6")
  const ex = xOf(unit.rules, 'Explodes');
  if (ex && !fled && state.dice.d6() >= ex) {
    const hits = unit.models.reduce((t, m) => t + m.maxWounds, 0);
    state.log(`    ${unit.name} explodes`);
    const { resolveGroup } = require('./attack.cjs');
    for (const u of state.units) if (u !== unit && !u.destroyed && u.arrived && !u.embarkedIn && gap(u, unit) <= 6) {
      resolveGroup({ attacks: hits, S: 8, AP: 7, D: 1, hitNeed: null, rules: [], melee: false, from: unit }, u, { dice: state.dice, onKill: (m) => state.onCasualty(m, u, null) });
      state.afterDamage(u);
    }
  }
  // passengers of a destroyed transport get out where it was, shaken (ASSUMPTION: Pinned)
  for (const p of unit.passengers) {
    p.embarkedIn = null; p.arrived = true; p.x = unit.x; p.y = unit.y; p.r = footprint(p);
    addStatus(state, p, 'Pinned', 'transport destroyed');
  }
  unit.passengers = [];
  unlock(unit);
  // Horror of the Taken (Rangdan): destroying a unit in combat forces Leadership Checks on its friends within 6"
  if (state.inFight && by && by.side !== unit.side && alive(by).some((m) => has(m.rules, 'Horror of the Taken'))) {
    for (const o of state.units) {
      if (o.side !== unit.side || o === unit || o.destroyed || !o.arrived || o.embarkedIn || gap(o, unit) > 6) continue;
      if (!check(state, o, 'LD', 0, 'Horror of the Taken')) addStatus(state, o, 'Routed', 'Horror of the Taken');
    }
  }
  // Kill Points, Thin the Ranks, First Strike, Vanguard (scoring.cjs)
  scoring.onDestroyed(state, unit, by && by.side !== unit.side ? by : null);
}

/** Which objective (if any) a unit is controlling or contesting: within 3" and able to (for Vanguard). */
function markHeld(state) {
  for (const u of state.units) {
    if (u.destroyed) continue;
    const o = canHold(u) && state.table.objectives.find((x) => Math.hypot(x.x - u.x, x.y - u.y) - u.r <= scoring.CONTROL_RANGE);
    u.heldObjective = o ? o.id + 1 : null;
  }
}

// ---------- deployment ----------
function deploy(state, side) {
  const units = state.units.filter((u) => u.side === side);
  const z = state.zoneOf[side], ez = state.zoneOf[1 - side];
  const towards = state.mission.centroids[state.zoneName[1 - side]];
  // embark: an Infantry or Paragon unit rides in a transport that fits it
  for (const t of units.filter((u) => u.capacity > 0)) {
    let room = t.capacity;
    const light = has(t.rules, 'Light Transport');
    const ok = (u) => !u.vehicle && !u.embarkedIn && !u.passengers.length && u !== t && alive(u).every((m) => /Infantry|Paragon/.test(m.unitType) && (!light || !(xOf(m.rules, 'Bulky') > 1)))
      && alive(u).reduce((s, m) => s + (xOf(m.rules, 'Bulky') || 1), 0) <= room
      && !alive(u).some((m) => m.ranged.some((w) => has(w.specialRules, 'Heavy') || has(w.specialRules, 'Ordnance')));
    const cand = units.filter(ok).sort((a, b) => ai.meleeValue(state, b, state.units.filter((e) => e.side !== side)) - ai.meleeValue(state, a, state.units.filter((e) => e.side !== side)));
    const p = cand[0];
    if (p) { t.passengers.push(p); p.embarkedIn = t; room -= alive(p).reduce((s, m) => s + (xOf(m.rules, 'Bulky') || 1), 0); }
  }
  // 6. Declare Mission Reserves: assault units that can Deep Strike or Outflank wait to strike where it hurts
  const enemies = state.units.filter((e) => e.side !== side);
  for (const u of units) {
    if (u.embarkedIn) continue;
    const assault = ai.meleeValue(state, u, enemies) > ai.shootValue(state, u, enemies);
    if (/Flyer/.test(u.unitType)) u.reserve = 'aerial';
    else if (has(u.rules, 'Deep Strike') && assault) u.reserve = 'deep';
    else if (has(u.rules, 'Outflank') && assault) u.reserve = 'outflank';
    if (u.reserve) { u.arrived = false; for (const p of u.passengers) p.arrived = false; }
  }
  // place the rest in the zone (never within 2" of the enemy, nor in Impassable Terrain): big models first.
  // A unit with nowhere to stand goes into Reserves (MISSION).
  const toPlace = units.filter((u) => !u.reserve && !u.embarkedIn).sort((a, b) => b.r - a.r);
  const placedNow = [];
  for (const u of toPlace) {
    u.facing = Math.atan2(towards.y - (u.y || H / 2), towards.x - (u.x || W / 2));
    const inf = xOf(u.rules, 'Infiltrate');
    const cands = [];
    for (let x = 1 + u.r; x <= W - u.r - 1; x += 2) for (let y = 1 + u.r; y <= H - u.r - 1; y += 2) {
      const p = { x, y };
      if (fits(z, p, u.r)) cands.push(p);
      // Infiltrate (X): anywhere outside the enemy zone, X" from enemies (CONFIRMED)
      else if (inf && !touches(ez, p, u.r) && !state.units.some((e) => e.side !== side && e.placed && !e.embarkedIn && Math.hypot(e.x - x, e.y - y) - e.r - u.r < inf)) cands.push(p);
    }
    let best = null;
    for (const p of cands) {
      if (state.table.pieces.some((r) => r.impassable && inside(p, r))) continue;
      if (state.units.some((o) => o !== u && o.placed && !o.embarkedIn && Math.hypot(o.x - p.x, o.y - p.y) < o.r + u.r + (o.side !== side ? 2 : 0.5))) continue;
      const s = ai.positionScore(state, u, p, { cautious: 1.2 });
      if (!best || s > best.s) best = { p, s };
    }
    if (!best) { u.reserve = 'edge'; for (const q of u.passengers) q.arrived = false; continue; }
    u.x = best.p.x; u.y = best.p.y; u.placed = true; u.arrived = true;
    u.facing = Math.atan2(towards.y - u.y, towards.x - u.x);
    for (const q of u.passengers) { q.x = u.x; q.y = u.y; q.arrived = true; }
    placedNow.push(u);
  }
  state.log(`${state.armies[side].name} deploys: ${placedNow.map((u) => `${u.name}${u.passengers.length ? ` (carrying ${u.passengers.map((p) => p.name).join(', ')})` : ''}`).join(', ')}${units.some((u) => u.reserve) ? `; in Reserves: ${units.filter((u) => u.reserve).map((u) => `${u.name} (${u.reserve})`).join(', ')}` : ''}`);
}

// ---------- a Player Turn ----------
function playerTurn(state, side) {
  state.active = side;
  // matchup tables are keyed by models left, so they stay valid across turns
  state.log(`\nBattle Turn ${state.round}, ${state.armies[side].name}`);
  // turn flags (moved, charged, disembarked) belong to one Player Turn; a unit may react once per Player Turn
  for (const u of state.units) { u.turn = {}; u.reacted = false; }
  state.umFlex = [false, false];
  const master = state.units.some((u) => u.side === 1 - side && !u.destroyed && (u.traits || []).includes('Master of the Legion'));
  state.reactionsLeft[1 - side] = core.reactionAllotment(state.armies[1 - side].pointsLimit, master);
  // ---- Movement Phase ----
  reservesSubPhase(state, side);
  moveSubPhase(state, side);
  routSubPhase(state, side);
  // ---- Shooting Phase ----
  shootingPhase(state, side);
  moraleSubPhase(state);
  reactions.clearBuffs(state, 'phase');
  // ---- Assault Phase ----
  markHeld(state);
  assaultPhase(state, side);
  reactions.clearBuffs(state, 'phase');
  // ---- End Phase ----
  effectsSubPhase(state, side);
  statusesSubPhase(state, side);
  scoring.victorySubPhase(state, side);
}

function shootingPhase(state, side) {
  const units = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn && !u.lockedWith.size);
  for (const u of units) {
    // SHEET: units that Rushed, are locked in combat or embarked can't shoot; statuses only force Snap Shots
    if (u.destroyed) continue;
    if (u.turn.rushed && !/Light|Rapid/.test(u.unitType)) continue;
    if (!alive(u).some((m) => m.ranged.length)) continue;
    const t = ai.chooseTarget(state, u, { snap: core.snapOnly(u) });
    if (!t) continue;
    markHeld(state);
    // the target may react: Return Fire, Smokescreen, Living Shields and the rest (reactions.cjs)
    shootingAttack(state, u, t, { phaseAttack: true });
  }
}

/** Effects Sub-Phase of the End Phase: conditions that wear off and delayed costs of reactions. */
function effectsSubPhase(state, side) {
  for (const u of state.units) {
    if (u.destroyed) continue;
    // Stupefied: a Cool Check in the controlling player's End Phase ends it (CONFIRMED)
    if (u.side === side && u.cond?.has('Stupefied') && check(state, u, 'CL', 0, 'to shake off Stupefied')) { u.cond.delete('Stupefied'); reactions.refresh(u); }
    // Selfless Burden: in the following Statuses Sub-Phase, each 1 on a D6 per model is a wound (AP -, saves allowed)
    if (u.selflessBurden) {
      u.selflessBurden = false;
      let n = 0;
      for (const m of alive(u)) if (state.dice.d6() === 1) n++;
      if (n) {
        const { resolveGroup } = require('./attack.cjs');
        const r = resolveGroup({ attacks: n, S: 99, AP: 7, D: 1, hitNeed: null, rules: [], melee: true }, u, { dice: state.dice, onKill: (m) => state.onCasualty(m, u, null) });
        state.log(`    ${u.name} pays for Selfless Burden: ${r.unsaved} wounds`);
        state.afterDamage(u);
      }
    }
  }
}

/** Statuses Sub-Phase: Cool removes Pinned, Suppressed, Stunned; Leadership removes Routed; vehicles Repair (6+). */
function statusesSubPhase(state, side) {
  for (const u of state.units.filter((x) => x.side === side && !x.destroyed && x.statuses.size)) {
    if (u.vehicle) {
      const ar = xOf(u.rules, 'Auto-Repair') || xOf(u.rules, 'Auto-repair') || 6;
      if (state.dice.d6() >= ar) { const s = [...u.statuses][0]; u.statuses.delete(s); state.log(`    ${u.name} repairs: no longer ${s}`); }
      continue;
    }
    for (const s of [...u.statuses]) {
      if (!check(state, u, s === 'Routed' ? 'LD' : 'CL', 0, `to remove ${s}`)) continue;
      u.statuses.delete(s);
      if (s === 'Disgraced') for (const m of u.models) m.disgraced = false;
    }
  }
}

function finish(state, lines) {
  // Hammerblow scoring, units left in Reserves, and the Secondary Objectives (scoring.cjs)
  state.log('\nEnd of the battle');
  scoring.endOfBattle(state);
  const winner = state.vp[0] === state.vp[1] ? null : state.vp[0] > state.vp[1] ? 0 : 1;
  state.log(`\nResult: ${state.armies[0].name} ${state.vp[0]} – ${state.vp[1]} ${state.armies[1].name}${winner === null ? ' (draw)' : `, ${state.armies[winner].name} wins`}`);
  const pointsKilled = [0, 1].map((s) => state.units.filter((u) => u.side !== s).reduce((t, u) => t + (u.stats?.lost || 0), 0));
  const units = [0, 1].map((s) => state.units.filter((u) => u.side === s).map((u) => ({ name: u.name, pts: u.pts, pointsKilled: u.stats?.killed || 0, pointsLost: u.stats?.lost || 0, survived: !u.destroyed })));
  return { winner, vp: state.vp, pointsKilled, units, vpLog: state.vpLog, reactions: state.reactionCount, powers: state.powerCount, log: lines };
}

module.exports = { runBattle };
