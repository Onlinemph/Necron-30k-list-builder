'use strict';
// Characteristic Checks, Fear, Tactical Statuses and who may hold objectives.
const { num, xOf, has, p2d6AtMost } = require('./rules.cjs');
const { dist } = require('./table.cjs');
const core = require('./core.cjs');

const alive = (u) => u.models.filter((m) => m.wounds > 0);
const isMalefic = (u) => alive(u).length > 0 && alive(u).every((m) => /Malefic/.test(m.unitType));

/** The unit's characteristic for a check: a Command, Sergeant or Paragon model may lend its value (CONFIRMED). */
function charOf(unit, key) {
  const a = alive(unit);
  if (!a.length) return 0;
  const leaders = a.filter((m) => /Command|Sergeant|Paragon|Champion/.test(m.unitType) || m.sergeant);
  const pool = leaders.length ? leaders : a;
  // Disgraced: the model's Leadership is halved (SHEET)
  const v = Math.max(...pool.map((m) => Math.floor(num(m.p[key], 7) / (m.disgraced && key === 'LD' ? 2 : 1))));
  // Lost to the Nails: Leadership, Cool and Willpower count as 10 (CONFIRMED)
  return unit.cond?.has('Lost to the Nails') && ['LD', 'CL', 'WP'].includes(key) ? Math.max(10, v) : v;
}

/** Highest Fear (X) among enemy models within 12" (CONFIRMED: doesn't stack; Malefic ignores it). */
function fearOn(state, unit) {
  if (isMalefic(unit)) return 0;
  let f = 0;
  for (const e of state.units) {
    if (e.side === unit.side || e.destroyed || !e.arrived || e.embarkedIn) continue;
    const x = Math.max(0, ...alive(e).map((m) => xOf(m.rules, 'Fear') || 0));
    if (x > f && dist(e, unit) - e.r - unit.r <= 12) f = x;
  }
  return f;
}

/**
 * Neural Collars (Rangdan): a unit made only of collared models is 'near' while any friendly Rangda model is within
 * 12" (18" for the Iron Chain war-moon), otherwise 'far'; null for anyone else.
 */
function collarState(state, unit) {
  const a = alive(unit);
  if (!a.length || !a.every((m) => has(m.rules, 'Neural Collars'))) return null;
  // Iron Chain war-moon and the Collared Legion Prime Advantage: the masters reach 18"
  const reach = a.every((m) => (m.traits || []).includes('Iron Chain')) || unit.primeAdvantage === 'Collared Legion' ? 18 : 12;
  const near = state.units.some((r) => r.side === unit.side && r !== unit && !r.destroyed && r.arrived && !r.embarkedIn
    && alive(r).some((m) => (m.traits || []).includes('Rangda')) && dist(r, unit) - r.r - unit.r <= reach);
  return near ? 'near' : 'far';
}
/** Leadership or Cool for a check, with Neural Collars' 5 when the masters are out of reach. */
const checkValue = (state, unit, key) => (['LD', 'CL'].includes(key) && collarState(state, unit) === 'far' ? 5 : charOf(unit, key));

/** Make a Characteristic Check: 2D6, pass at or under the modified value (CONFIRMED). */
function check(state, unit, key, penalty = 0, why = '') {
  // Neural Collars: near a Rangda model, Leadership and Cool Checks pass automatically
  if (['LD', 'CL'].includes(key) && collarState(state, unit) === 'near') {
    if (state.log && why) state.log(`    ${unit.name} ${key} check (${why}): passed automatically (Neural Collars)`);
    return true;
  }
  const malefic = isMalefic(unit);
  const value = checkValue(state, unit, key) - (malefic ? 0 : fearOn(state, unit) + Math.max(0, penalty)) + (penalty < 0 ? -penalty : 0);
  const roll = state.dice.twoD6();
  const pass = roll <= value;
  if (state.log && why) state.log(`    ${unit.name} ${key} check${why ? ` (${why})` : ''}: rolled ${roll} against ${value}, ${pass ? 'passed' : 'failed'}`);
  return pass;
}
/** Chance to pass, for the AI. */
function passChance(state, unit, key, penalty = 0) {
  if (['LD', 'CL'].includes(key) && collarState(state, unit) === 'near') return 1;
  const value = checkValue(state, unit, key) - (isMalefic(unit) ? 0 : fearOn(state, unit) + penalty);
  return p2d6AtMost(value);
}

/** Units that never gain statuses (CONFIRMED): Automata, Flyers, Fortifications, Titans. */
const statusImmune = (unit) => alive(unit).every((m) => /Automata|Flyer|Fortification|Titan|Ordinatus/.test(m.unitType));

/**
 * Give a unit a Tactical Status. Duplicates do nothing (CONFIRMED). Malefic units take D3 wounds with no saves
 * instead (CONFIRMED). Returns true if the status was gained.
 */
function addStatus(state, unit, status, why = '') {
  if (unit.destroyed) return false;
  if (statusImmune(unit)) return false;
  // Stupefied units can't gain Tactical Statuses (CONFIRMED)
  if (unit.cond?.has('Stupefied')) return false;
  if (isMalefic(unit)) {
    const n = state.dice.d3();
    let lost = 0;
    for (let i = 0; i < n; i++) {
      const t = unit.models.find((m) => m.wounds > 0);
      if (!t) break;
      const fnp = xOf(t.rules, 'Feel No Pain');
      if (fnp && state.dice.d6() >= fnp) continue;
      t.wounds -= 1; lost++;
      if (t.wounds <= 0 && state.onCasualty) state.onCasualty(t, unit, null);
    }
    if (state.log) state.log(`    ${unit.name} is Malefic: instead of ${status}, takes ${n} automatic wounds (${lost} not ignored)`);
    if (state.afterDamage) state.afterDamage(unit);
    return false;
  }
  if (unit.statuses.has(status)) return false;
  unit.statuses.add(status);
  if (state.log) state.log(`    ${unit.name} is ${status}${why ? ` (${why})` : ''}`);
  return true;
}

/** Check made to avoid a status: Cool (Pinned, Suppressed, Stunned) or Leadership (Routed); Heavy gets +1 Cool. */
function statusCheck(state, unit, status, x, why) {
  if (statusImmune(unit)) return true;
  if (isMalefic(unit) && false) return true;
  const key = status === 'Routed' ? 'LD' : 'CL';
  const heavy = key === 'CL' && alive(unit).every((m) => /Heavy/.test(m.unitType)) ? -1 : 0;
  const pass = check(state, unit, key, x + heavy, why);
  if (!pass) addStatus(state, unit, status, why);
  return pass;
}

/**
 * Can this unit Control or Contest an Objective Marker or Sector? (MISSION) Not if any model is Stunned,
 * Suppressed, Pinned or Routed, it's Locked in Combat or Embarked, all its models have Move 0, or it includes
 * Automata; never with Heedless (CONFIRMED). Vehicles and Cavalry can.
 */
const BLOCKING = ['Stunned', 'Suppressed', 'Pinned', 'Routed'];
function canHold(unit) {
  if (unit.destroyed || !unit.arrived || unit.embarkedIn || unit.reserve) return false;
  if (BLOCKING.some((s) => unit.statuses.has(s)) || unit.lockedWith.size) return false;
  const a = alive(unit);
  if (!a.length || a.every((m) => num(m.p.M, 0) === 0) || a.some((m) => /Automata/.test(m.unitType))) return false;
  return !has(unit.rules, 'Heedless');
}

module.exports = { alive, charOf, fearOn, collarState, check, passChance, addStatus, statusCheck, statusImmune, canHold, isMalefic };
