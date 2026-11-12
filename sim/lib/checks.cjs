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

/** Make a Characteristic Check: 2D6, pass at or under the modified value (CONFIRMED). */
function check(state, unit, key, penalty = 0, why = '') {
  const malefic = isMalefic(unit);
  const value = charOf(unit, key) - (malefic ? 0 : fearOn(state, unit) + Math.max(0, penalty)) + (penalty < 0 ? -penalty : 0);
  const roll = state.dice.twoD6();
  const pass = roll <= value;
  if (state.log && why) state.log(`    ${unit.name} ${key} check${why ? ` (${why})` : ''}: rolled ${roll} against ${value}, ${pass ? 'passed' : 'failed'}`);
  return pass;
}
/** Chance to pass, for the AI. */
function passChance(state, unit, key, penalty = 0) {
  const value = charOf(unit, key) - (isMalefic(unit) ? 0 : fearOn(state, unit) + penalty);
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

/** Can this unit control or contest objectives right now? (CONFIRMED: no status; plus the type rules in core.) */
const canHold = (unit) => !unit.destroyed && unit.arrived && !unit.embarkedIn && unit.statuses.size === 0 && core.canHoldObjectives(unit);

module.exports = { alive, charOf, fearOn, check, passChance, addStatus, statusCheck, statusImmune, canHold, isMalefic };
