'use strict';
// Psychic: Willpower Checks for Psykers, Perils of the Warp, and the Psychic Powers whose full texts are in the
// repo. Psychic Weapons are ordinary weapons with the Psychic Trait and usually Force (X); they're fired and
// swung like any other (shoot.cjs, assault.cjs), with the Force check made here.
//
// CONFIRMED (data/bsdata/common.json): Force (X) doubles X on a passed Willpower Check (AP becomes 2) and any
// double is Perils of the Warp; Fear (X) lowers Willpower; Psy-Shock inflicts Warp Rupture on a Psyker or Malefic
// unit it wounds; Anathema ignores Psychic damage and Perils, and is only wounded by Psychic or Immaterial weapons
// on a 5+; Titans and Ordinatus ignore Psychic Weapons, Powers and Reactions.
// ASSUMPTION: a Manifestation Check is the same Willpower Check (a double is Perils); the Perils table (core.cjs).
// The core rulebook's Disciplines (Biomancy, Pyromancy, ...) aren't in the repo, so their Powers and Psychic
// Reactions aren't simulated; their Psychic Weapons are.
const { num, xOf, argOf, has } = require('./rules.cjs');
const { gap, lineOfSight } = require('./table.cjs');
const { alive, fearOn, isMalefic, addStatus } = require('./checks.cjs');
const core = require('./core.cjs');

function setup(state) {
  state.powerCount = [{}, {}];
  for (const u of state.units) u.powers = powersOf(u);
}
/** Psychic Powers a unit can manifest, from its models' Traits and rules. */
function powersOf(u) {
  const out = [];
  if (u.models.some((m) => (m.traits || []).includes('Warphead'))) out.push('Warpath');
  return out;
}
const immune = (u) => alive(u).length > 0 && alive(u).every((m) => /Titan|Ordinatus/.test(m.unitType));
const anathema = (m) => has(m.rules, 'Anathema');

/** A Psyker's Willpower Check (2D6 at or under WP, less Fear). Returns { pass, double }. */
function willpowerCheck(state, unit, model, why) {
  let wp = num(model.p.WP, 7);
  if (unit.cond?.has('Lost to the Nails')) wp = Math.max(10, wp);
  wp -= isMalefic(unit) ? 0 : fearOn(state, unit);
  const a = state.dice.d6(), b = state.dice.d6();
  const pass = a + b <= wp;
  state.log(`    ${model.name} Willpower Check (${why}): rolled ${a + b} against ${wp}, ${pass ? 'passed' : 'failed'}${a === b ? ', a double' : ''}`);
  if (a === b) perils(state, unit, model);
  return { pass, double: a === b };
}

/** Perils of the Warp on a unit (the model is the one that suffers Ætheric Feedback). */
function perils(state, unit, model, forced) {
  const p = forced ? { result: forced, status: 'Stunned' } : core.perils(state.dice);
  state.log(`    ${unit.name}: Perils of the Warp (${p.result})`);
  state.powerCount[unit.side].Perils = (state.powerCount[unit.side].Perils || 0) + 1;
  const m = model || alive(unit)[0];
  if (p.wounds && m && !anathema(m)) {
    m.wounds = Math.max(0, m.wounds - p.wounds);
    if (m.wounds === 0 && state.onCasualty) state.onCasualty(m, unit, null);
  }
  if (p.status && !alive(unit).every(anathema)) addStatus(state, unit, p.status, 'Perils of the Warp');
  if (state.afterDamage) state.afterDamage(unit);
}

const FORCE_KEY = { FP: 'FP', Firepower: 'FP', S: 'RS', RS: 'RS', Strength: 'RS', D: 'D', Damage: 'D', AP: 'AP', SM: 'SM', AM: 'AM', Attacks: 'AM' };
/** Force (X): the model may take a Willpower Check to double X. Returns the weapon to use. */
function forceCheck(state, unit, model, weapon) {
  const x = argOf(weapon.specialRules, 'Force');
  if (!x || !unit.psyker) return weapon;
  const r = willpowerCheck(state, unit, model, `Force (${x})`);
  state.powerCount[unit.side].Force = (state.powerCount[unit.side].Force || 0) + 1;
  if (!r.pass) return weapon;
  const w = Object.assign({}, weapon);
  const key = FORCE_KEY[x] || x;
  if (key === 'AP') w.AP = 2;
  else if (key === 'SM' || key === 'AM') { const v = String(weapon[key] ?? ''); w[key] = /^[+-]\d+$/.test(v) ? `+${2 * Math.max(0, num(v, 0))}` : String(2 * num(v, 1)); }
  else w[key] = 2 * num(weapon[key], 1);
  return w;
}

/** A weapon with the Psychic Trait can't affect Titans or Ordinatus. */
const blockedPsychic = (w, target) => (w.traits || []).includes('Psychic') && immune(target);

/** After a Fire Group wounds a unit: Psy-Shock inflicts Warp Rupture on Psyker or Malefic units. */
function afterWounds(state, w, target, wounds) {
  if (!wounds || !has(w.specialRules, 'Psy-Shock')) return;
  if (target.psyker || isMalefic(target)) perils(state, target, null, 'Warp Rupture');
}

// ---------- Psychic Powers ----------
/**
 * Warpath (Power of the Waaagh!, Blessing): at Step 4 of a charge, before Volleys, a Warphead within 12" and in
 * sight of the charging unit (or part of it) may manifest it. On a pass the charger makes no Volley Attacks but
 * gains +2 Attacks until the end of the Assault Phase. Returns true if the charger gave up its Volley.
 */
function onChargeStep4(state, u, t) {
  const focus = state.units.find((f) => f.side === u.side && !f.destroyed && f.arrived && !f.embarkedIn && f.powers?.includes('Warpath') && !f.statuses.has('Stunned')
    && (f === u || (gap(f, u) <= 12 && lineOfSight(state.table, f, u))));
  if (!focus || u.turn.warpath) return false;
  const m = alive(focus).find((x) => (x.traits || []).includes('Warphead'));
  if (!m) return false;
  const ai = require('./ai.cjs');
  const volley = ai.evAt(ai.shootTable(state, u, t), gap(u, t)) * 0.25;
  const gain = ai.meleeEV(state, u, t) * 0.5; // +2 Attacks on a typical 2-4 Attack profile
  if (gain <= volley) return false;
  u.turn.warpath = true;
  state.powerCount[u.side].Warpath = (state.powerCount[u.side].Warpath || 0) + 1;
  const r = willpowerCheck(state, focus, m, 'Manifestation Check, Warpath');
  if (!r.pass) return false;
  require('./reactions.cjs').addBuff(u, { attacks: 2 }, 'phase');
  state.log(`    Warpath: ${u.name} gains +2 Attacks and makes no Volley`);
  return true;
}

module.exports = { setup, powersOf, willpowerCheck, perils, forceCheck, blockedPsychic, afterWounds, onChargeStep4, immune };
