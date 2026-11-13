'use strict';
// Scoring from the Core Mission Pack: Imperium at War (MISSION): controlling Objective Markers (Claim Supplies),
// Kill Points (Destroy the Enemy), controlling Sectors (Seize Ground), the Secondary Objectives and the
// scoring Mission Special Rules. Line, Vanguard, Support Unit and Expendable follow their rule texts (CONFIRMED).
const { xOf, has, num } = require('./rules.cjs');
const { alive, canHold } = require('./checks.cjs');
const { inArea, touches, killPoints } = require('./mission.cjs');

const CONTROL_RANGE = 3; // MISSION: a model within 3" of the marker, measured from its centre
const BLOCKING = ['Stunned', 'Suppressed', 'Pinned', 'Routed'];

// eligibility to Control or Contest lives in checks.cjs (canHold)
const canControl = canHold;
const majority = (u, name) => { const a = alive(u); return a.filter((m) => xOf(m.rules, name) != null).length * 2 > a.length; };
const maxX = (u, name) => Math.max(0, ...alive(u).map((m) => xOf(m.rules, name) || 0));

// ---------- Claim Supplies ----------
/** Models of a unit within 3" of a marker: the share of its footprint in range. */
function modelsNear(u, o) {
  const d = Math.hypot(u.x - o.x, u.y - o.y);
  if (d - u.r > CONTROL_RANGE) return 0;
  const n = alive(u).length;
  if (d + u.r <= CONTROL_RANGE || u.r < 0.01) return n;
  return Math.max(1, Math.round(n * Math.min(1, (CONTROL_RANGE + u.r - d) / (2 * u.r))));
}
/** Tactical Strength at a marker (MISSION): models within 3" (Bulky counts once), plus Line (X) for each. */
function tacticalStrength(u, o) {
  const n = modelsNear(u, o);
  if (!n) return 0;
  const lineEach = alive(u).filter((m) => xOf(m.rules, 'Line')).length / Math.max(1, alive(u).length);
  return n + Math.round(n * lineEach * maxX(u, 'Line'));
}
/**
 * Who Controls each marker (MISSION): each side puts its strongest free unit on each marker, most valuable first;
 * a unit controls or contests one marker only; the higher Tactical Strength controls, a tie means nobody does.
 * Returns [{ o, side, unit }].
 */
function claimControl(state, valueFor = (o) => o.value || 2) {
  const used = new Set();
  const out = [];
  const order = [...state.table.objectives].sort((a, b) => valueFor(b) - valueFor(a));
  for (const o of order) {
    const best = [null, null];
    for (const u of state.units) {
      if (used.has(u) || !canControl(u)) continue;
      const ts = tacticalStrength(u, o);
      if (ts > 0 && (!best[u.side] || ts > best[u.side].ts)) best[u.side] = { u, ts };
    }
    for (const b of best) if (b) used.add(b.u);
    const [a, b] = best;
    let side = null, unit = null;
    if (a && (!b || a.ts > b.ts)) { side = 0; unit = a.u; } else if (b && (!a || b.ts > a.ts)) { side = 1; unit = b.u; }
    out.push({ o, side, unit, contested: !!(a && b) });
  }
  return out;
}
/** Victory Points a unit scores for controlling a marker of this value: Line adds, Vanguard and Support Unit cap. */
function markerVP(u, value) {
  let vp = value + (majority(u, 'Line') ? maxX(u, 'Line') : 0);
  if (majority(u, 'Vanguard')) vp = Math.min(vp, 1);
  if (alive(u).some((m) => xOf(m.rules, 'Support Unit') != null)) vp = Math.min(vp, maxX(u, 'Support Unit'));
  return vp;
}
/** Unknown Munitions: a marker's value for a side, rolled the first time that side would score it. */
function munitionsValue(state, o, side) {
  o.valueFor = o.valueFor || [null, null];
  if (o.valueFor[side] == null) {
    const own = inArea(state.zoneOf[side], o), theirs = inArea(state.zoneOf[1 - side], o);
    const r = state.dice.d3();
    o.valueFor[side] = own ? Math.max(1, r - 1) : theirs ? Math.min(3, r + 1) : r;
    state.log(`    ${state.armies[side].name} opens the munitions at (${o.x.toFixed(0)}, ${o.y.toFixed(0)}): worth ${o.valueFor[side]}`);
  }
  return o.valueFor[side];
}
function scoreClaim(state, side) {
  const m = state.mission;
  for (const c of claimControl(state)) {
    if (c.side !== side) continue;
    // Hidden Caches: the marker may shift 3" before it scores, and must still be controlled
    if (m.has('Hidden Caches')) {
      const roll = state.dice.d6();
      if (roll > 2) {
        const t = state.dice.rnd() * 2 * Math.PI;
        c.o.x = Math.min(71, Math.max(1, c.o.x + 3 * Math.cos(t))); c.o.y = Math.min(47, Math.max(1, c.o.y + 3 * Math.sin(t)));
        const again = claimControl(state).find((x) => x.o === c.o);
        if (!again || again.side !== side) { state.log(`    the cache at (${c.o.x.toFixed(0)}, ${c.o.y.toFixed(0)}) shifts out of ${c.unit.name}'s reach`); continue; }
        c.unit = again.unit;
      }
    }
    const value = m.has('Unknown Munitions') ? munitionsValue(state, c.o, side) : c.o.value;
    state.award(side, markerVP(c.unit, value), `controls the objective at (${c.o.x.toFixed(0)}, ${c.o.y.toFixed(0)}) with ${c.unit.name}`);
  }
}

// ---------- Seize Ground ----------
const sectorOf = (state, p) => state.mission.sectors.find((s) => inArea(s.area, p));
/** Sector values this turn (Shattered Earth: 5 while under Tectonic Instability). */
const sectorValue = (state, s) => (state.mission.has('Tectonic Instability') && state.tectonic === s.id ? 5 : s.value);
/**
 * Who Controls each Sector (MISSION): Tactical Strength is every eligible model a side has in it, plus Line (X) where
 * the Sector is partly in that side's Deployment Zone and Vanguard (X) where it's partly in the enemy's. A unit's
 * models count in the Sector holding its centre.
 */
function sectorControl(state) {
  return state.mission.sectors.map((s) => {
    const ts = [0, 0];
    for (const u of state.units) {
      if (!canControl(u) || !inArea(s.area, u)) continue;
      const a = alive(u);
      let t = a.length;
      if (s.inZone[state.zoneName[u.side]]) t += a.reduce((x, mm) => x + (xOf(mm.rules, 'Line') || 0), 0);
      if (s.inZone[state.zoneName[1 - u.side]]) t += a.reduce((x, mm) => x + (xOf(mm.rules, 'Vanguard') || 0), 0);
      ts[u.side] += t;
    }
    return { s, ts, side: ts[0] > ts[1] ? 0 : ts[1] > ts[0] ? 1 : null };
  });
}
function scoreSeize(state, side) {
  for (const c of sectorControl(state)) if (c.side === side) state.award(side, sectorValue(state, c.s), `controls Sector ${c.s.id} (strength ${c.ts[side]} to ${c.ts[1 - side]})`);
}

/** The Victory Sub-Phase (Escalation: the Active Player scores from Battle Turn 2). */
function victorySubPhase(state, side) {
  const m = state.mission;
  if (m.variant !== 'escalation' || state.round < 2) return;
  if (m.primary === 'claim') scoreClaim(state, side);
  if (m.primary === 'seize') scoreSeize(state, side);
}

// ---------- units destroyed ----------
/** Expendable (X): the opponent scores X fewer Victory Points for this unit, to a minimum of 1 (CONFIRMED). */
const expendable = (u) => (u.models.every((m) => xOf(m.rules, 'Expendable') != null) ? Math.min(...u.models.map((m) => xOf(m.rules, 'Expendable'))) : 0);
const pay = (u, vp) => Math.max(1, vp - expendable(u));

/** A unit has lost its last model: Kill Points, Thin the Ranks, First Strike. `by` is the unit that did it, if any. */
function onDestroyed(state, unit, by) {
  const side = 1 - unit.side;
  const m = state.mission;
  state.destroyedUnits.push(unit);
  if (m.primary === 'destroy') {
    let vp = killPoints(unit);
    if (m.has('Thin the Ranks')) {
      if (/Elites|Retinue|Heavy Assault/.test(unit.role)) vp += 1;
      if (unit.primeStats) vp += 1;
      vp += Math.max(0, ...unit.models.map((x) => xOf(x.rules, 'Line') || 0));
    }
    state.award(side, pay(unit, vp), `destroyed ${unit.name} (${killPoints(unit)} Kill Points${vp > killPoints(unit) ? ', Thin the Ranks' : ''})`);
  }
  // First Strike: during that player's own first Player Turn
  if (state.round === 1 && state.active === side && !state.firstStrike[side]) {
    state.firstStrike[side] = true;
    state.award(side, pay(unit, m.secondaries.firstStrike), `First Strike (${unit.name})`);
  }
  // Vanguard (X): the last model of a unit controlling or contesting an objective (CONFIRMED), once per objective per turn
  if (by && by.side === side && majority(by, 'Vanguard') && unit.heldObjective) {
    const key = `${state.round}:${state.active}:${unit.heldObjective}`;
    if (!state.vanguardScored.has(key)) { state.vanguardScored.add(key); state.award(side, pay(unit, maxX(by, 'Vanguard')), `Vanguard: destroyed ${unit.name} on an objective`); }
  }
}

// ---------- end of the battle ----------
function endOfBattle(state) {
  const m = state.mission;
  // Hammerblow: the primary is scored once, now
  if (m.variant === 'hammerblow') for (const side of [0, 1]) { if (m.primary === 'claim') scoreClaim(state, side); if (m.primary === 'seize') scoreSeize(state, side); }
  // units still in Reserves count as Removed as Casualties (MISSION); Aerial Reserves don't for Destroy the Enemy
  const inReserve = state.units.filter((u) => !u.destroyed && u.reserve && !u.arrived);
  for (const u of inReserve) {
    state.log(`    ${u.name} never arrived and counts as destroyed`);
    if (m.primary === 'destroy' && u.reserve !== 'aerial') state.award(1 - u.side, pay(u, killPoints(u)), `${u.name} still in Reserves`);
    // characters who joined it count as destroyed with it
    for (const c of (u.joined || []).filter((x) => !x.dead)) {
      inReserve.push(Object.assign({}, c, { reserve: u.reserve, joined: null, statuses: new Set(), lockedWith: new Set() }));
      if (m.primary === 'destroy' && u.reserve !== 'aerial') state.award(1 - u.side, pay(c, killPoints(c)), `${c.name} still in Reserves`);
    }
  }
  const gone = (side) => [...state.destroyedUnits.filter((u) => u.side === side), ...inReserve.filter((u) => u.side === side)];
  for (const side of [0, 1]) {
    const lost = gone(1 - side);
    // Slay the Warlord (X): X for a Command unit, X+1 for High Command; one of the two
    const hc = lost.find((u) => /High Command/.test(u.role)), cmd = lost.find((u) => /^Command/.test(u.role));
    if (hc) state.award(side, pay(hc, m.secondaries.warlord + 1), `Slay the Warlord (${hc.name})`);
    else if (cmd) state.award(side, pay(cmd, m.secondaries.warlord), `Slay the Warlord (${cmd.name})`);
    // Giant Killer (X): any Lord of War or Warlord, once
    const giant = lost.find((u) => /Lord of War|Warlord/.test(u.role));
    if (giant) state.award(side, pay(giant, m.secondaries.giant), `Giant Killer (${giant.name})`);
    // Breakthrough (X): a unit with models in the enemy Deployment Zone, plus its Vanguard (X)
    const deep = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn && touches(state.zoneOf[1 - side], u, u.r));
    if (deep.length) {
      const best = deep.reduce((b, u) => (maxX(u, 'Vanguard') > maxX(b, 'Vanguard') ? u : b), deep[0]);
      state.award(side, m.secondaries.breakthrough + maxX(best, 'Vanguard'), `Breakthrough (${best.name})`);
    }
  }
}

// ---------- for the AI ----------
/**
 * Mission value of a unit standing at `pos`, in Victory Points per scoring turn: markers it could control, or the
 * Sector it would add strength to. Used by the AI with its own weights.
 */
function missionValueAt(state, u, pos) {
  const m = state.mission;
  if (!canControlIgnoringPlace(u)) return { here: 0, near: 0 };
  let here = 0, near = 0;
  if (m.primary === 'claim') {
    for (const o of state.table.objectives) {
      const v = m.has('Unknown Munitions') ? (o.valueFor?.[u.side] ?? 2) : o.value;
      const d = Math.hypot(o.x - pos.x, o.y - pos.y) - u.r;
      const w = markerWorth(state, u, o, v);
      if (d <= CONTROL_RANGE) here = Math.max(here, w);
      else near = Math.max(near, w * Math.max(0, 1 - d / 36));
    }
  } else if (m.primary === 'seize') {
    const s = sectorOf(state, pos);
    if (s) {
      // a sector already held by friends needs this unit less
      const friends = state.units.filter((x) => x !== u && x.side === u.side && canControl(x) && inArea(s.area, x)).length;
      here = sectorValue(state, s) / (1 + friends);
    }
    for (const t of m.sectors) if (t !== s) near = Math.max(near, sectorValue(state, t) * Math.max(0, 1 - Math.hypot(t.centre.x - pos.x, t.centre.y - pos.y) / 36));
  }
  // Breakthrough: in the last turns, being in the enemy Deployment Zone is worth its secondary
  if (state.turnsLeft <= 2 && touches(state.zoneOf[1 - u.side], pos, u.r)) here += (m.secondaries.breakthrough + maxX(u, 'Vanguard')) / 2;
  return { here, near };
}
/**
 * What a marker is worth to unit u, for the AI. A marker a friendly unit already holds is worth little more to u
 * unless u would hold it better (a Line unit takes over from one without Line; between two Line units the bigger
 * Line value, then the bigger unit, keeps it), so the other moves on to the next marker. A marker the enemy holds
 * is also worth contesting, for the Victory Points it denies them.
 */
function markerWorth(state, u, o, v) {
  const rank = (x) => (majority(x, 'Line') ? 1000 + 100 * maxX(x, 'Line') : 0) + alive(x).length + (x.uid || 0) * 1e-6;
  const on = (x) => x !== u && !x.destroyed && x.arrived !== false && !x.embarkedIn && canControl(x) && Math.hypot(o.x - x.x, o.y - x.y) - x.r <= CONTROL_RANGE;
  let worth = markerVP(u, v);
  const friend = state.units.filter((x) => x.side === u.side && on(x)).sort((a, b) => rank(b) - rank(a))[0];
  if (friend && rank(friend) > rank(u)) worth *= 0.15;
  const foe = state.units.filter((x) => x.side !== u.side && on(x)).sort((a, b) => rank(b) - rank(a))[0];
  if (foe) worth += markerVP(foe, v) * 0.5;
  return worth;
}
const canControlIgnoringPlace = (u) => !u.destroyed && !BLOCKING.some((s) => u.statuses.has(s)) && !alive(u).some((m) => /Automata/.test(m.unitType)) && !has(u.rules, 'Heedless') && alive(u).some((m) => num(m.p.M, 0) > 0);

module.exports = { CONTROL_RANGE, canControl, majority, maxX, markerWorth, claimControl, markerVP, tacticalStrength, sectorControl, sectorOf, sectorValue, scoreClaim, scoreSeize, victorySubPhase, onDestroyed, endOfBattle, missionValueAt, killPoints, expendable };
