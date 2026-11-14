'use strict';
// Psychic: Willpower Checks for Psykers, Perils of the Warp, and the Psychic Powers whose full texts are in the
// repo. Psychic Weapons are ordinary weapons with the Psychic Trait and usually Force (X); they're fired and
// swung like any other (shoot.cjs, assault.cjs), with the Force check made here.
//
// CONFIRMED (data/bsdata/common.json): Force (X) doubles X on a passed Willpower Check (AP becomes 2) and any
// double is Perils of the Warp; Fear (X) lowers Willpower; Psy-Shock inflicts Warp Rupture on a Psyker or Malefic
// unit it wounds; Anathema ignores Psychic damage and Perils, and is only wounded by Psychic or Immaterial weapons
// on a 5+; Titans and Ordinatus ignore Psychic Weapons, Powers and Reactions.
// SHEET: Perils is a D6 table (core.cjs): 13 minus WP wounds with only Invulnerable Saves, or Stunned.
// ASSUMPTION: a Manifestation Check is the same Willpower Check (a double is Perils).
//
// Psychic Disciplines: a discipline chosen for a model, or granted by a rule (Prosperine Sorcery, Witchblood,
// Arch-Magister of the Corvidae, Magister of Dust, Echoes of Fate), gives the model its Psychic Weapon (army.cjs);
// Conduit adds 1 to their Strength. Every other psychic power the army data names is listed in POWERS below with
// whether it's played; the ones marked `text: false` have no rules text in the repo (the core rulebook's
// disciplines and the Prosperine Arcana), so they wait for it. Each power goes through manifest(): a Manifestation
// Check, Perils on a double, and a count for the battle report.
const { num, xOf, argOf, has, save } = require('./rules.cjs');
const { gap, lineOfSight } = require('./table.cjs');
const { alive, fearOn, isMalefic, addStatus } = require('./checks.cjs');
const core = require('./core.cjs');

/**
 * Every psychic power the army data names. kind: weapon (fired or swung like any weapon, Force checked), blessing,
 * curse, reaction, gambit, arcana (a Prosperine Arcana) or ability; played: whether the simulator plays it; text:
 * false when the repo has no rules text for it.
 */
const POWERS = [
  { name: 'Biomantic Slam', discipline: 'Biomancy', kind: 'weapon', played: true },
  { name: 'Biomantic Rage', discipline: 'Biomancy', kind: 'blessing', played: true },
  { name: 'Conflagration', discipline: 'Pyromancy', kind: 'weapon', played: true },
  { name: 'Force Barrier', discipline: 'Telekinesis', kind: 'reaction', played: true },
  { name: 'Wildfire', discipline: 'Pyromancy', kind: 'weapon', played: true },
  { name: 'Immovable Force', discipline: 'Telekinesis', kind: 'weapon', played: true },
  { name: 'Stormcalling', discipline: 'Stormcalling', kind: 'weapon', played: true },
  { name: 'Runecasting', discipline: 'Runecasting', kind: 'weapon', played: true },
  { name: 'Warpath', discipline: 'Power of the Waaagh!', kind: 'blessing', played: true },
  { name: 'Conduit', kind: 'ability', played: true },
  // in the rulebook, not played (no strength list fields these disciplines)
  { name: "Foresight's Blessing", discipline: 'Divination', kind: 'blessing' },
  { name: 'Every Strike Foreseen', discipline: 'Divination', kind: 'gambit' },
  { name: 'Cursed Whispers', discipline: 'Telepathy', kind: 'weapon' },
  { name: 'Mind-burst', discipline: 'Telepathy', kind: 'curse' },
  { name: 'Resurrection', discipline: 'Thaumaturgy', kind: 'reaction' },
  { name: 'Tranquillity', discipline: 'Thaumaturgy', kind: 'curse' },
  // named in the army data, with no rules text in the repo or the rulebook
  { name: 'Bladeweaving', discipline: 'Khenetai', kind: 'reaction', text: false },
  { name: 'Mindsong of Blades', discipline: 'Khenetai', kind: 'blessing', text: false },
  { name: 'Soul Binding', discipline: 'Zardu Layak', kind: 'ability', text: false },
  { name: 'Breach the Veil', discipline: 'Zardu Layak', kind: 'ability', text: false },
  { name: 'Stoneform', discipline: 'Magnus the Red', kind: 'ability', text: false },
  { name: 'Kine Shield', discipline: 'Magnus the Red', kind: 'ability', text: false },
  { name: 'Seal the Veil', discipline: 'Lorgar Aurelian', kind: 'ability', text: false },
  ...['Raptora', 'Pyrae', 'Pavoni', 'Corvidae', 'Athanaean'].map((name) => ({ name, discipline: 'Prosperine Arcana', kind: 'arcana', text: false })),
];

function setup(state) {
  state.powerCount = [{}, {}];
  for (const u of state.units) u.powers = powersOf(u);
}
/** Psychic Powers a unit can manifest, from its models' Traits, rules and Psychic Weapons. */
function powersOf(u) {
  const out = new Set();
  if (u.models.some((m) => (m.traits || []).includes('Warphead'))) out.add('Warpath');
  for (const m of u.models) for (const w of [...m.ranged, ...m.melee]) if (POWERS.some((p) => p.kind === 'weapon' && p.played && p.name === (w.base || w.name).replace(/\s*\(.*\)$/, ''))) out.add(w.base || w.name);
  return [...out];
}
/** Manifest a power: a Manifestation Check (a Willpower Check; Perils on a double), counted for the report. */
function manifest(state, unit, model, power) {
  state.powerCount[unit.side][power] = (state.powerCount[unit.side][power] || 0) + 1;
  return willpowerCheck(state, unit, model, `Manifestation Check, ${power}`);
}
const immune = (u) => alive(u).length > 0 && alive(u).every((m) => /Titan|Ordinatus/.test(m.unitType));
const anathema = (m) => has(m.rules, 'Anathema');

/** A Psyker's Willpower Check (2D6 at or under WP, less Fear). Returns { pass, double }. */
function willpowerCheck(state, unit, model, why) {
  let wp = num(model.p.WP, 7);
  if (unit.cond?.has('Lost to the Nails')) wp = Math.max(10, wp);
  wp -= isMalefic(unit) ? 0 : fearOn(state, unit);
  const a = state.dice.d6(), b = state.dice.d6();
  // double 1 always passes, double 6 always fails (CONFIRMED); any double is Perils, its face the result
  const pass = a === 1 && b === 1 ? true : a === 6 && b === 6 ? false : a + b <= wp;
  state.log(`    ${model.name} Willpower Check (${why}): rolled ${a + b} against ${wp}, ${pass ? 'passed' : 'failed'}${a === b ? ', a double' : ''}`);
  if (a === b) perils(state, unit, model, null, a);
  return { pass, double: a === b };
}

/**
 * Perils of the Warp on a unit (model: the Focus, if any; forced: a named result; face: the double that caused it).
 * Warp Rupture's 13 - Willpower wounds use the unit's Willpower for checks and are allocated across the unit like a
 * Shooting Attack's, with only Invulnerable Saves (CONFIRMED).
 */
function perils(state, unit, model, forced, face) {
  const m = model || alive(unit).find((x) => (x.traits || []).includes('Psyker')) || alive(unit)[0];
  const wp = require('./checks.cjs').charOf(unit, 'WP');
  const p = forced === 'Warp Rupture' ? { result: forced, wounds: Math.max(0, 13 - wp) } : forced ? { result: forced, status: 'Stunned' } : core.perils(state.dice, wp, face);
  state.powerCount[unit.side].Perils = (state.powerCount[unit.side].Perils || 0) + 1;
  if (p.wounds && m && !alive(unit).every(anathema)) {
    const { pickModel } = require('./attack.cjs');
    let taken = 0;
    for (let i = 0; i < p.wounds; i++) {
      const v = pickModel(unit, false);
      if (!v) break;
      const inv = save(v.p.INV);
      if (anathema(v) || (inv <= 6 && state.dice.d6() >= inv)) continue;
      v.wounds--; taken++;
      if (v.wounds === 0 && state.onCasualty) state.onCasualty(v, unit, null);
    }
    state.log(`    ${unit.name}: Perils of the Warp (${p.result}): ${p.wounds} wounds, ${taken} not saved`);
  } else state.log(`    ${unit.name}: Perils of the Warp (${p.result})`);
  if (p.status && !alive(unit).every(anathema)) addStatus(state, unit, p.status, 'Perils of the Warp');
  if (state.afterDamage) state.afterDamage(unit);
}

const FORCE_KEY = { FP: 'FP', Firepower: 'FP', S: 'RS', RS: 'RS', Strength: 'RS', D: 'D', Damage: 'D', AP: 'AP', SM: 'SM', AM: 'AM', Attacks: 'AM' };
/**
 * Force (X): the model may take a Willpower Check to double X. Returns the weapon to use. The AI only takes the
 * check, and its risk of Perils, when doubling X would change something against this target: more Damage than one
 * of its models has Wounds, or AP 2 against a save AP alone doesn't beat, does nothing.
 */
function forceCheck(state, unit, model, weapon, target) {
  const x = argOf(weapon.specialRules, 'Force');
  if (!x || !unit.psyker) return weapon;
  if (target && forceUseless(FORCE_KEY[x] || x, weapon, target)) return weapon;
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

function forceUseless(key, weapon, target) {
  const t = alive(target);
  if (!t.length) return true;
  if (key === 'D') return t.every((m) => m.maxWounds <= num(weapon.D, 1));
  if (key === 'AP') { const ap = num(weapon.AP, 7); return ap <= 2 || t.every((m) => save(m.p.SAV) >= ap); }
  return false;
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
/** Step 4 of a charge, before Volleys: Warpath or Biomantic Rage; true if the charger makes no Volley. */
function onChargeStep4(state, u, t) {
  return warpath(state, u, t) || biomanticRage(state, u, t);
}
/**
 * Biomantic Rage (Biomancy, a Blessing; CONFIRMED, rulebook): at Step 4 of a charge, before Volleys, a Biomancer in
 * the charging unit or within 18" and in sight of it manifests it; passed, the charger makes no Volley and has +2
 * Strength and +2 Toughness until the end of the Assault Phase. One Psychic Power per unit per Player Turn.
 */
function biomanticRage(state, u, t) {
  if (u.vehicle || u.turn.rage) return false;
  const ai = require('./ai.cjs');
  for (const f of state.units) {
    if (f.side !== u.side || f.destroyed || !f.arrived || f.embarkedIn || f.turn.power || f.statuses.has('Stunned')) continue;
    if (f !== u && !(gap(f, u) <= 18 && lineOfSight(state.table, f, u))) continue;
    const m = alive(f).find((x) => (x.disciplines || []).includes('Biomancy'));
    if (!m) continue;
    const volley = ai.evAt(ai.shootTable(state, u, t), gap(u, t)) * 0.25;
    const gain = ai.meleeEV(state, u, t) * 0.3 + ai.meleeEV(state, t, u) * 0.25;
    if (gain <= volley + 3) return false;
    u.turn.rage = true; f.turn.power = true;
    const r = manifest(state, f, m, 'Biomantic Rage');
    if (!r.pass) return false;
    require('./reactions.cjs').addBuff(u, { str: 2, tough: 2 }, 'phase');
    state.log(`    Biomantic Rage: ${u.name} gains +2 Strength and +2 Toughness and makes no Volley`);
    return true;
  }
  return false;
}
function warpath(state, u, t) {
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
  const r = manifest(state, focus, m, 'Warpath');
  if (!r.pass) return false;
  require('./reactions.cjs').addBuff(u, { attacks: 2 }, 'phase');
  state.log(`    Warpath: ${u.name} gains +2 Attacks and makes no Volley`);
  return true;
}

module.exports = { POWERS, setup, powersOf, manifest, willpowerCheck, perils, forceCheck, blockedPsychic, afterWounds, onChargeStep4, immune };
