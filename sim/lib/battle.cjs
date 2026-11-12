'use strict';
// One battle between two lists, turn by turn: deployment, then each Battle Turn's Player Turns with their
// Start, Movement, Shooting, Assault and End Phases, reactions from the other side, objective scoring and
// secondary objectives. Returns the result and a readable log.
const { num, xOf, has } = require('./rules.cjs');
const { createDice } = require('./dice.cjs');
const { makeTable, gap, dist, inside, lineOfSight, W, H } = require('./table.cjs');
const { setupMission, zone } = require('./mission.cjs');
const { buildArmy, footprint } = require('./army.cjs');
const { alive, check, addStatus, canHold, charOf } = require('./checks.cjs');
const { shootingAttack, moraleSubPhase } = require('./shoot.cjs');
const { reservesSubPhase, moveSubPhase, routSubPhase, moveUnit } = require('./move.cjs');
const { assaultPhase, canReact, unlock } = require('./assault.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const reactions = require('./reactions.cjs');
const psychic = require('./psychic.cjs');

function runBattle(listA, listB, opts = {}) {
  const dice = createDice(opts.seed ?? 1);
  const table = makeTable(dice, opts.table);
  const mission = setupMission(opts.mission || 'standard', table);
  const armies = [buildArmy(listA, 0), buildArmy(listB, 1)];
  const lines = [];
  const state = {
    dice, table, mission, armies, units: [...armies[0].units, ...armies[1].units],
    round: 0, active: 0, turnsLeft: mission.turns, vp: [0, 0], pendingMorale: [],
    cache: { shoot: new Map(), melee: new Map() }, reactionsLeft: [0, 0], vpLog: [],
    log: opts.log ? (s) => lines.push(s) : () => {},
  };
  hooks(state);
  reactions.setup(state);
  state.reactions = reactions;
  psychic.setup(state);
  // nothing is on the table until it's deployed
  for (const u of state.units) u.arrived = false;
  // warlords: each side's High Command (or Warlord) choice
  for (const s of [0, 1]) {
    const w = state.units.find((u) => u.side === s && /Warlord/.test(u.role)) || state.units.find((u) => u.side === s && /High Command/.test(u.role));
    if (w) w.warlord = true;
  }
  // roll off: the winner deploys first and takes the first turn, unless the other player Seizes the Initiative
  let first = dice.d6() >= 4 ? 0 : 1;
  state.log(`Battle: ${armies[0].name} (bottom) vs ${armies[1].name} (top). ${armies[first].name} deploys first.`);
  deploy(state, first); deploy(state, 1 - first);
  if (dice.d6() >= core.SEIZE_ON) { first = 1 - first; state.log(`${armies[first].name} Seizes the Initiative and goes first.`); }
  for (let round = 1; round <= mission.turns; round++) {
    state.round = round; state.turnsLeft = mission.turns - round + 1;
    for (const side of [first, 1 - first]) {
      if (!state.units.some((u) => u.side === side && !u.destroyed)) continue;
      playerTurn(state, side);
    }
  }
  const res = finish(state, lines);
  res.first = first;
  return res;
}

// ---------- hooks used by the phases ----------
function hooks(state) {
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
  // reactions to an enemy ending a move (Reposition, The Hunt Closes, ...) and to arrivals from Reserves (Moonfall)
  state.onEnemyMoved = (mover) => reactions.onMoved(state, mover);
  state.onArrive = (unit) => reactions.onArrive(state, unit);
  // Vanguard: breaking a unit that was near an objective
  state.onBrokeFromCombat = (unit, winners, nearObjective) => {
    if (!nearObjective) return;
    const v = winners.map((w) => xOf(w.rules, 'Vanguard') || 0).reduce((a, b) => Math.max(a, b), 0);
    if (v) award(state, winners[0].side, v, `Vanguard: ${unit.name} broken near an objective`);
  };
}

function award(state, side, vp, why) {
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
  if (!by || by.side === unit.side) return;
  const side = by.side;
  // secondaries (names CONFIRMED, values ASSUMPTION)
  const exp = Math.max(0, ...unit.models.map((m) => xOf(m.rules, 'Expendable') || 0));
  const pay = (v) => Math.max(1, v - exp);
  if (unit.warlord) award(state, side, pay(core.secondaries.slayTheWarlord), `Slay the Warlord (${unit.name})`);
  if (/Lord of War|Warlord/.test(unit.role)) award(state, side, pay(core.secondaries.giantKiller), `Giant Killer (${unit.name})`);
  if (state.round === 1 && !state.firstStrike?.[side]) { state.firstStrike = state.firstStrike || {}; state.firstStrike[side] = true; award(state, side, pay(core.secondaries.firstStrike), `First Strike (${unit.name})`); }
  // Vanguard (X): killing the last model of a unit holding or contesting an objective (CONFIRMED)
  const v = xOf(by.rules, 'Vanguard');
  if (v && unit.heldObjective) award(state, side, pay(v), `Vanguard: destroyed ${unit.name} on an objective`);
}

// ---------- deployment ----------
function deploy(state, side) {
  const units = state.units.filter((u) => u.side === side);
  const z = zone(state.mission, side);
  // embark: an Infantry or Paragon unit rides in a transport that fits it
  for (const t of units.filter((u) => u.capacity > 0)) {
    let room = t.capacity;
    const light = has(t.rules, 'Light Transport');
    const fits = (u) => !u.vehicle && !u.embarkedIn && !u.passengers.length && u !== t && alive(u).every((m) => /Infantry|Paragon/.test(m.unitType) && (!light || !(xOf(m.rules, 'Bulky') > 1)))
      && alive(u).reduce((s, m) => s + (xOf(m.rules, 'Bulky') || 1), 0) <= room
      && !alive(u).some((m) => m.ranged.some((w) => has(w.specialRules, 'Heavy') || has(w.specialRules, 'Ordnance')));
    const cand = units.filter(fits).sort((a, b) => ai.meleeValue(state, b, state.units.filter((e) => e.side !== side)) - ai.meleeValue(state, a, state.units.filter((e) => e.side !== side)));
    const p = cand[0];
    if (p) { t.passengers.push(p); p.embarkedIn = t; room -= alive(p).reduce((s, m) => s + (xOf(m.rules, 'Bulky') || 1), 0); }
  }
  // reserves: assault units that can Deep Strike or Outflank wait to strike where it hurts
  const enemies = state.units.filter((e) => e.side !== side);
  for (const u of units) {
    if (u.embarkedIn) continue;
    const assault = ai.meleeValue(state, u, enemies) > ai.shootValue(state, u, enemies);
    if (/Flyer/.test(u.unitType)) u.reserve = 'aerial';
    else if (has(u.rules, 'Deep Strike') && assault) u.reserve = 'deep';
    else if (has(u.rules, 'Outflank') && assault) u.reserve = 'outflank';
    if (u.reserve) { u.arrived = false; for (const p of u.passengers) p.arrived = false; }
  }
  // place the rest: transports and big models first, then infantry
  const toPlace = units.filter((u) => !u.reserve && !u.embarkedIn).sort((a, b) => b.r - a.r);
  for (const u of toPlace) {
    u.facing = side === 0 ? Math.PI / 2 : -Math.PI / 2;
    const inf = xOf(u.rules, 'Infiltrate');
    const cands = [];
    for (let x = u.r + 1; x <= W - u.r - 1; x += 3) for (let y = z.y0 + u.r + 0.5; y <= z.y1 - u.r - 0.5; y += 2.5) cands.push({ x, y });
    if (inf) {
      // Infiltrate (X): anywhere outside the enemy zone, X" from enemies (CONFIRMED)
      const ez = zone(state.mission, 1 - side);
      for (let x = u.r + 1; x <= W - u.r - 1; x += 3) for (let y = u.r + 1; y <= H - u.r - 1; y += 3) {
        if (y + u.r >= ez.y0 && y - u.r <= ez.y1) continue;
        if (state.units.some((e) => e.side !== side && e.arrived && !e.reserve && !e.embarkedIn && e.x && Math.hypot(e.x - x, e.y - y) - e.r - u.r < inf)) continue;
        cands.push({ x, y });
      }
    }
    let best = null;
    for (const p of cands) {
      if (state.table.pieces.some((r) => r.impassable && inside(p, r))) continue;
      if (state.units.some((o) => o !== u && o.placed && !o.embarkedIn && Math.hypot(o.x - p.x, o.y - p.y) < o.r + u.r + 0.5)) continue;
      const s = ai.positionScore(state, u, p, { cautious: 1.2 });
      if (!best || s > best.s) best = { p, s };
    }
    const p = best ? best.p : { x: W / 2, y: (z.y0 + z.y1) / 2 };
    u.x = p.x; u.y = p.y; u.placed = true; u.arrived = true;
    for (const q of u.passengers) { q.x = u.x; q.y = u.y; q.arrived = true; }
  }
  state.log(`${state.armies[side].name} deploys: ${toPlace.map((u) => `${u.name}${u.passengers.length ? ` (carrying ${u.passengers.map((p) => p.name).join(', ')})` : ''}`).join(', ')}${units.some((u) => u.reserve) ? `; in Reserves: ${units.filter((u) => u.reserve).map((u) => `${u.name} (${u.reserve})`).join(', ')}` : ''}`);
}

// ---------- a Player Turn ----------
function playerTurn(state, side) {
  state.active = side;
  // matchup tables are keyed by models left, so they stay valid across turns
  state.log(`\nBattle Turn ${state.round}, ${state.armies[side].name}`);
  // turn flags (moved, charged, disembarked) belong to one Player Turn; a unit may react once per Player Turn
  for (const u of state.units) { u.turn = {}; u.reacted = false; }
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
  for (const u of state.units) if (!u.destroyed) u.heldObjective = canHold(u) && state.table.objectives.some((o) => Math.hypot(o.x - u.x, o.y - u.y) - u.r <= core.CONTROL_RANGE);
  assaultPhase(state, side);
  reactions.clearBuffs(state, 'phase');
  // ---- End Phase ----
  effectsSubPhase(state, side);
  statusesSubPhase(state, side);
  if (state.round >= core.SCORE_FROM_TURN) victorySubPhase(state, side);
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
    for (const e of state.units) if (!e.destroyed) e.heldObjective = canHold(e) && state.table.objectives.some((o) => Math.hypot(o.x - e.x, o.y - e.y) - e.r <= core.CONTROL_RANGE);
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

/** Victory Sub-Phase: the Active Player scores each objective they control. */
function victorySubPhase(state, side) {
  for (const o of state.table.objectives) {
    const ts = [0, 0], units = [[], []];
    for (const u of state.units) {
      if (!canHold(u)) continue;
      if (Math.hypot(o.x - u.x, o.y - u.y) - u.r > core.CONTROL_RANGE) continue;
      ts[u.side] += alive(u).reduce((t, m) => t + core.tacticalStrength(m), 0);
      units[u.side].push(u);
    }
    if (ts[side] <= ts[1 - side]) continue;
    // Line (X) adds X; a Vanguard unit scores at most 1; Support Unit (X) caps at X (CONFIRMED)
    const majority = (u, name) => { const a = alive(u); return a.filter((m) => xOf(m.rules, name) != null).length * 2 > a.length; };
    const holders = units[side];
    let vp = o.value + Math.max(0, ...holders.filter((u) => majority(u, 'Line')).map((u) => Math.max(...alive(u).map((m) => xOf(m.rules, 'Line') || 0))));
    if (holders.every((u) => majority(u, 'Vanguard'))) vp = Math.min(vp, 1);
    const sup = holders.filter((u) => majority(u, 'Support Unit')).map((u) => Math.max(...alive(u).map((m) => xOf(m.rules, 'Support Unit') || 0)));
    if (sup.length && sup.length === holders.length) vp = Math.min(vp, Math.max(...sup));
    award(state, side, vp, `holds the objective at (${o.x.toFixed(0)}, ${o.y.toFixed(0)}) with ${holders.map((u) => u.name).join(', ')}`);
  }
}

function finish(state, lines) {
  // Last Man Standing: the side with more units left on the battlefield
  const left = [0, 1].map((s) => state.units.filter((u) => u.side === s && !u.destroyed && (u.arrived || u.embarkedIn)).length);
  if (left[0] !== left[1]) award(state, left[0] > left[1] ? 0 : 1, core.secondaries.lastManStanding, 'Last Man Standing');
  const winner = state.vp[0] === state.vp[1] ? null : state.vp[0] > state.vp[1] ? 0 : 1;
  state.log(`\nResult: ${state.armies[0].name} ${state.vp[0]} – ${state.vp[1]} ${state.armies[1].name}${winner === null ? ' (draw)' : `, ${state.armies[winner].name} wins`}`);
  const pointsKilled = [0, 1].map((s) => state.units.filter((u) => u.side !== s).reduce((t, u) => t + (u.stats?.lost || 0), 0));
  const units = [0, 1].map((s) => state.units.filter((u) => u.side === s).map((u) => ({ name: u.name, pts: u.pts, pointsKilled: u.stats?.killed || 0, pointsLost: u.stats?.lost || 0, survived: !u.destroyed })));
  return { winner, vp: state.vp, pointsKilled, units, vpLog: state.vpLog, reactions: state.reactionCount, powers: state.powerCount, log: lines };
}

module.exports = { runBattle };
