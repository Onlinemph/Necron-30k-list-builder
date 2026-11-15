'use strict';
// Psychic: Willpower Checks for Psykers, Perils of the Warp, and the Psychic Powers whose full texts are in the
// rulebook or the repo. Psychic Weapons are ordinary weapons with the Psychic Trait and usually Force (X); they're
// fired and swung like any other (shoot.cjs, assault.cjs), with the Force check and dice rolls made here.
//
// CONFIRMED (data/bsdata/common.json): Force (X) doubles X on a passed Willpower Check (AP becomes 2) and any
// double is Perils of the Warp; Fear (X) lowers Willpower; Psy-Shock inflicts Warp Rupture on a Psyker or Malefic
// unit it wounds; Anathema ignores Psychic damage and Perils, and is only wounded by Psychic or Immaterial weapons
// on a 5+; Titans and Ordinatus ignore Psychic Weapons, Powers and Reactions.
// SHEET: Perils is a D6 table (core.cjs): 13 minus WP wounds with only Invulnerable Saves, or Stunned.
// ASSUMPTION: a Manifestation Check is the same Willpower Check (a double is Perils).
//
// Psychic Disciplines: a discipline chosen for a model, or granted by a rule (Prosperine Sorcery, Witchblood,
// Arch-Magister of the Corvidae, Magister of Dust, Echoes of Fate), gives the model its Psychic Weapons and rules
// (army.cjs); Conduit adds 1 to their Strength. The model has the discipline's Trait (Biomancer, Pyromancer, ...),
// read here from its disciplines. Every psychic power the army data names is listed in POWERS below with whether
// it's played; the ones marked `text: false` have no rules text in the repo or the rulebook. Each power goes through
// manifest(): a Manifestation Check, Perils on a double, and a count for the battle report. One Psychic Power per
// unit in its own Player Turn, one Psychic Reaction (a Reaction, so once a turn anyway) in the enemy's.
//
// The core disciplines' powers (CONFIRMED, rulebook pp. 340-347): Biomantic Rage, Force Barrier, Foresight's Blessing,
// Every Strike Foreseen (gambits.cjs), Mind-burst, Resurrection and Tranquillity; Pyromancy's Explodes (4+) on the
// Pyromancer himself; Conflagration's 6+D3 Attacks and Cursed Whispers' 2D6 shots rolled for each attack (rollDice).
// ASSUMPTION: Mind-burst and Tranquillity are Curses, which the rulebook resolves with the target's Resistance Check,
// but their own Processes say "make a Manifestation Check" and apply the power when it's passed, so the Focus makes a
// Manifestation Check as written (Perils on a double, either way, falls on the Focus's unit).
const { num, xOf, argOf, has, save, p2d6AtMost } = require('./rules.cjs');
const { gap, lineOfSight } = require('./table.cjs');
const { alive, fearOn, isMalefic, addStatus, canHold, charOf } = require('./checks.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');

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
  { name: "Foresight's Blessing", discipline: 'Divination', kind: 'blessing', played: true },
  { name: 'Every Strike Foreseen', discipline: 'Divination', kind: 'gambit', played: true },
  { name: 'Cursed Whispers', discipline: 'Telepathy', kind: 'weapon', played: true },
  { name: 'Mind-burst', discipline: 'Telepathy', kind: 'curse', played: true },
  { name: 'Resurrection', discipline: 'Thaumaturgy', kind: 'reaction', played: true },
  { name: 'Tranquillity', discipline: 'Thaumaturgy', kind: 'curse', played: true },
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
  watchCasualties(state);
}
const hasDiscipline = (m, d) => (m.disciplines || []).includes(d);
const hasDisciplineIn = (u, d) => u.models.some((m) => hasDiscipline(m, d));
/** Psychic Powers a unit can manifest, from its models' Traits, rules and Psychic Weapons. */
function powersOf(u) {
  const out = new Set();
  if (u.models.some((m) => (m.traits || []).includes('Warphead'))) out.add('Warpath');
  for (const m of u.models) for (const w of [...m.ranged, ...m.melee]) if (POWERS.some((p) => p.kind === 'weapon' && p.played && p.name === (w.base || w.name).replace(/\s*\(.*\)$/, ''))) out.add(w.base || w.name);
  return [...out];
}
/**
 * Manifest a power: a Manifestation Check (a Willpower Check; Perils on a double), counted for the report.
 * Tranquillity takes 2 off the Willpower (CONFIRMED). opts.deferPerils: the caller resolves Perils (Resurrection).
 */
function manifest(state, unit, model, power, opts = {}) {
  state.powerCount[unit.side][power] = (state.powerCount[unit.side][power] || 0) + 1;
  return willpowerCheck(state, unit, model, `Manifestation Check, ${power}`, Object.assign({ penalty: unit.tranquil ? 2 : 0 }, opts));
}
/** The Willpower a model's Manifestation Check needs to roll under (for the AI). */
const manifestValue = (state, unit, model) => num(model.p.WP, 7) - (isMalefic(unit) ? 0 : fearOn(state, unit)) - (unit.tranquil ? 2 : 0);
/** Chance a Manifestation Check passes (the Rule of Doubles included). */
const manifestChance = (state, unit, model) => Math.min(35 / 36, Math.max(1 / 36, p2d6AtMost(manifestValue(state, unit, model))));
/** What a Manifestation Check's Perils may cost the Focus's unit, in points, for the AI: Warp Rupture on a double 1 or 6. */
const perilsCost = (unit) => (2 / 36) * Math.max(0, 13 - charOf(unit, 'WP')) * require('./fire.cjs').valuePerWound(unit) + (4 / 36) * 3;
const immune = (u) => alive(u).length > 0 && alive(u).every((m) => /Titan|Ordinatus/.test(m.unitType));
const anathema = (m) => has(m.rules, 'Anathema');

/**
 * A Psyker's Willpower Check (2D6 at or under WP, less Fear and opts.penalty). Returns { pass, double, face }; a double
 * is Perils of the Warp at once unless opts.deferPerils.
 */
function willpowerCheck(state, unit, model, why, opts = {}) {
  let wp = num(model.p.WP, 7);
  if (unit.cond?.has('Lost to the Nails')) wp = Math.max(10, wp);
  wp -= (isMalefic(unit) ? 0 : fearOn(state, unit)) + (opts.penalty || 0);
  const a = state.dice.d6(), b = state.dice.d6();
  // double 1 always passes, double 6 always fails (CONFIRMED); any double is Perils, its face the result
  const pass = a === 1 && b === 1 ? true : a === 6 && b === 6 ? false : a + b <= wp;
  state.log(`    ${model.name} Willpower Check (${why}): rolled ${a + b} against ${wp}, ${pass ? 'passed' : 'failed'}${a === b ? ', a double' : ''}`);
  if (a === b && !opts.deferPerils) perils(state, unit, model, null, a);
  return { pass, double: a === b, face: a };
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

// ---------- dice in a weapon's profile ----------
/** Roll an expression like "6+D3" or "2D6". */
function rollExpr(dice, expr) {
  let t = 0;
  for (const part of String(expr).replace(/\s+/g, '').split('+')) {
    const m = part.match(/^(\d*)D(3|6)$/i);
    if (m) for (let i = 0; i < (+m[1] || 1); i++) t += m[2] === '3' ? dice.d3() : dice.d6();
    else t += num(part, 0);
  }
  return t;
}
/**
 * A weapon whose Attacks or Firepower are a dice roll (Conflagration's 6+D3 Attacks, Cursed Whispers' 2D6 shots;
 * CONFIRMED profiles, army.cjs): a copy with this attack's roll in place of the average its profile keeps for the AI.
 * Made where an attack is resolved (shoot.cjs's Fire Groups, assault.cjs's Strike Groups).
 */
function rollDice(state, w) {
  if (!w || !w.dice) return w;
  const out = Object.assign({}, w);
  for (const [key, expr] of Object.entries(w.dice)) out[key] = String(rollExpr(state.dice, expr));
  return out;
}

// ---------- Reactions ----------
/** Spend a point of the Reaction Allotment, as reactions.cjs does (Tactical Flexibility: one a turn is free). */
function spendReaction(state, side, unit, name) {
  if (legions.is(unit, 'Ultramarines') && state.umFlex && !state.umFlex[side]) { state.umFlex[side] = true; state.log('    (Tactical Flexibility: no Reaction Point spent)'); } else state.reactionsLeft[side] -= 1;
  unit.reacted = true;
  if (state.reactionCount) state.reactionCount[side][name] = (state.reactionCount[side][name] || 0) + 1;
}

// ---------- casualties: Explodes (Pyromancy) and Resurrection (Thaumaturgy) ----------
/**
 * Casualties the disciplines care about, worked by wrapping battle.cjs's hooks: a model is noted when it falls
 * (state.onCasualty) and dealt with once the attack is over, before its unit is checked for destruction
 * (state.afterDamage): Resurrection may bring one back, then a fallen Pyromancer may explode. A Tranquillity whose
 * Thaumaturge falls ends (CONFIRMED: a power's ongoing effect ends when its user is removed as a casualty).
 */
function watchCasualties(state) {
  const onCasualty = state.onCasualty, afterDamage = state.afterDamage, onFled = state.onFled;
  if (!onCasualty || !afterDamage) return;
  state.blasts = [];
  state.onCasualty = (m, unit, by) => {
    onCasualty(m, unit, by);
    if (m.calming) { for (const t of m.calming) calm(state, t, null); m.calming = null; }
    if (state.fleeing === unit) return;
    if (!m.vehicle && hasDiscipline(m, 'Pyromancy')) state.blasts.push({ unit, m });
    // a casualty of the Active Player's Shooting Attack in the Shooting Phase, for Resurrection; a joined character
    // can't be brought back (ASSUMPTION: battle.cjs scores him the moment he falls)
    if (state.phase === 'shooting' && by && by.side === state.active && unit.side !== state.active && !m.vehicle && !m.joinedFrom && hasDisciplineIn(unit, 'Thaumaturgy')) (unit.fallen = unit.fallen || []).push({ m, by });
  };
  state.afterDamage = (unit) => {
    if (unit.fallen) { const f = unit.fallen; unit.fallen = null; resurrection(state, unit, f); }
    if (state.blasts.length && !state.blasting) {
      state.blasting = true;
      try { while (state.blasts.length) explode(state, state.blasts.shift()); } finally { state.blasting = false; }
    }
    afterDamage(unit);
  };
  // a model that flees doesn't explode (as battle.cjs's vehicles)
  if (onFled) state.onFled = (unit) => { state.fleeing = unit; try { onFled(unit); } finally { state.fleeing = null; } };
}
/**
 * Pyromancy's Explodes (4+), the Pyromancer's own (CONFIRMED, rulebook and data/bsdata/common.json): before he is
 * Removed as a Casualty a D6; on a 4+ every unit with a model within 6" of him, his own included, takes Hits equal to
 * his base Wounds, Strength 8, AP -, Damage 1 (as battle.cjs explodes a vehicle). ASSUMPTION: he explodes once the
 * attack that killed him is resolved, measured from his unit's footprint; a resurrected Pyromancer doesn't.
 */
function explode(state, { unit, m }) {
  if (m.wounds > 0) return;
  const roll = state.dice.d6();
  if (roll < 4) return;
  const hits = Math.max(1, num(m.p.W, 1));
  state.log(`    ${m.name} explodes (Explodes (4+)): ${hits} hits on every unit within 6"`);
  const { resolveGroup } = require('./attack.cjs');
  const from = { x: unit.x, y: unit.y, r: unit.r };
  for (const u of state.units) {
    if (u.destroyed || !u.arrived || u.embarkedIn || !alive(u).length || (u !== unit && gap(u, from) > 6)) continue;
    const r = resolveGroup({ attacks: hits, S: 8, AP: 7, D: 1, hitNeed: null, rules: [], melee: false, from }, u, { dice: state.dice, onKill: (x) => state.onCasualty(x, u, null) });
    if (r.unsaved) state.log(`      ${u.name}: ${r.unsaved} unsaved, ${r.kills} killed`);
    state.afterDamage(u);
  }
}
/**
 * Resurrection (Thaumaturgy, a Psychic Reaction and Blessing; CONFIRMED, rulebook): at the start of Step 11 of the
 * Active Player's Shooting Attack in the Shooting Phase, for 1 point of the allotment, a Thaumaturge in the target unit
 * manifests it; passed, one model being Removed as a Casualty comes back on a 4+ with its Wounds restored, and Perils
 * comes after. The AI picks the casualty with the most Wounds and reacts when what it may save is worth the point
 * (ai.worthReacting). ASSUMPTION: the Thaumaturge may be one of the models being removed (they're still in the unit
 * until Step 11).
 */
function resurrection(state, unit, fallen) {
  const side = unit.side;
  if (unit.destroyed || !state.reactionsLeft || state.reactionsLeft[side] <= 0 || unit.reacted || !unit.arrived || unit.embarkedIn) return;
  if (unit.statuses.has('Stunned') || unit.statuses.has('Routed') || unit.cond?.has('Stupefied')) return;
  const dead = fallen.filter((f) => f.m.wounds <= 0 && f.m.maxWounds > 0);
  const focus = unit.models.find((m) => hasDiscipline(m, 'Thaumaturgy') && (m.wounds > 0 || fallen.some((f) => f.m === m)));
  if (!dead.length || !focus) return;
  const pick = dead.reduce((b, f) => (f.m.maxWounds > b.m.maxWounds || (f.m.maxWounds === b.m.maxWounds && f.m.sergeant && !b.m.sergeant) ? f : b), dead[0]);
  const ai = require('./ai.cjs');
  const { valuePerWound } = require('./fire.cjs');
  // a unit that would be wiped out also keeps its Kill Points
  const wiped = !alive(unit).length && state.mission?.primary === 'destroy';
  const worth = valuePerWound(unit) * pick.m.maxWounds + (wiped ? require('./mission.cjs').killPoints(unit) * ai.K(state, side, 'vp') : 0);
  const value = manifestChance(state, unit, focus) * 0.5 * worth - perilsCost(unit);
  if (!(value > 0) || !ai.worthReacting(state, side, value)) return;
  spendReaction(state, side, unit, 'Resurrection');
  state.log(`    ${state.armies[side].name} reacts: Resurrection (${unit.name})`);
  const r = manifest(state, unit, focus, 'Resurrection', { deferPerils: true });
  if (r.pass) {
    const roll = state.dice.d6();
    if (roll >= 4) {
      pick.m.wounds = pick.m.maxWounds;
      // the battle report's points lost and killed (battle.cjs's onCasualty) take it back
      const ppm = (unit.kpPts ?? unit.pts) / (unit.models.filter((x) => !x.joinedFrom).length || 1);
      if (unit.stats) unit.stats.lost -= ppm;
      if (pick.by.stats) pick.by.stats.killed -= ppm;
      state.log(`    ${pick.m.name} rises again (Resurrection: rolled ${roll})`);
    } else state.log(`    ${pick.m.name} stays down (Resurrection: rolled ${roll})`);
  }
  if (r.double) perils(state, unit, focus, null, r.face);
}

// ---------- Foresight's Blessing (Divination) ----------
/**
 * Foresight's Blessing (Divination, a Blessing; CONFIRMED, rulebook): at Step 4 of the Active Player's Shooting
 * Attack, a Diviner in the shooting unit or within 18" and in sight of it manifests it; passed, the unit's models have
 * Precision (5+) for the attack. Returns a function that ends it, or null. The AI uses it when the attack isn't Snap
 * Shots, the target has a model worth picking out (a sergeant or character, or one with more Wounds than the rest),
 * and the hits it expects on a 5 or 6 are worth the Perils. ASSUMPTION: decided just before the attack (so before the
 * target's reactions at Step 3); the Precision goes on the unit's guns for the attack.
 */
function foresightsBlessing(state, u, t) {
  if (!t || u.vehicle || alive(t).length < 2 || core.snapOnly(u) || (legions.is(t, 'Raven Guard') && gap(u, t) >= 18)) return null;
  const ta = alive(t);
  const wounds = ta.map((m) => m.maxWounds);
  if (!ta.some((m) => !m.vehicle && (m.sergeant || /Command|Paragon/.test(m.unitType))) && Math.max(...wounds) === Math.min(...wounds)) return null;
  let focus = null;
  for (const f of state.units) {
    if (f.side !== u.side || f.destroyed || !f.arrived || f.embarkedIn || f.turn?.power) continue;
    const m = alive(f).find((x) => hasDiscipline(x, 'Divination'));
    if (m && (f === u || (gap(f, u) <= 18 && lineOfSight(state.table, f, u)))) { focus = { f, m }; break; }
  }
  if (!focus) return null;
  const { planVolley, valuePerWound } = require('./fire.cjs');
  const { rangedGroup } = require('./attack.cjs');
  const stationary = !!u.turn.stationary && !u.statuses.size;
  let precise = 0;
  for (const p of planVolley(u, t, state, { stationary }).picks) {
    const r = p.weapon.specialRules;
    if (has(r, 'Blast') || has(r, 'Barrage') || has(r, 'Template') || (xOf(r, 'Precision') || 7) <= 5) continue;
    const g = rangedGroup(p.model, p.weapon, t, { stationary });
    if (g.hitNeed != null && g.hitNeed <= 6) precise += g.attacks * Math.min(2, 7 - g.hitNeed) / 6;
  }
  // a Precision hit is worth about four tenths of a wound more, on the model the attacker picks (ASSUMPTION: the AI's
  // rule of thumb)
  if (manifestChance(state, focus.f, focus.m) * precise * 0.4 * valuePerWound(t) < perilsCost(focus.f) + 3) return null;
  focus.f.turn.power = true;
  if (!manifest(state, focus.f, focus.m, "Foresight's Blessing").pass) return null;
  state.log(`    Foresight's Blessing: ${u.name} has Precision (5+) for the attack`);
  const saved = u.models.map((m) => m.ranged);
  for (const m of u.models) m.ranged = m.ranged.map((w) => ((xOf(w.specialRules, 'Precision') || 7) <= 5 ? w : Object.assign({}, w, { specialRules: [...(w.specialRules || []).filter((x) => !/^Precision/.test(x)), 'Precision (5+)'] })));
  return () => u.models.forEach((m, i) => { m.ranged = saved[i]; });
}

// ---------- Mind-burst (Telepathy) ----------
/** A unit's characteristic for a check no effect or rule may modify: the lowest, or a leader's. */
function plainValue(unit, key) {
  const a = alive(unit);
  if (!a.length) return 0;
  const leaders = a.filter((m) => /Command|Sergeant|Paragon/.test(m.unitType) || m.sergeant);
  return Math.max(Math.min(...a.map((m) => num(m.p[key], 7))), ...leaders.map((m) => num(m.p[key], 7)));
}
const plainChance = (unit, key) => Math.min(35 / 36, Math.max(1 / 36, p2d6AtMost(plainValue(unit, key))));
function plainCheck(state, unit, key, why) {
  const v = plainValue(unit, key);
  const a = state.dice.d6(), b = state.dice.d6();
  const pass = a === 1 && b === 1 ? true : a === 6 && b === 6 ? false : a + b <= v;
  state.log(`    ${unit.name} ${key} check (${why}, unmodified): rolled ${a + b} against ${v}, ${pass ? 'passed' : 'failed'}`);
  return pass;
}
/**
 * Mind-burst (Telepathy, a Curse; CONFIRMED, rulebook): in the Movement Phase, when its unit is chosen to move, a
 * Telepath manifests it at an enemy unit within 18" that it can see (not Locked in Combat, no Vehicles); passed, the
 * target loses its Tactical Statuses, makes a Fall Back Move (move.cjs), then an unmodified Leadership Check, and is
 * Routed if it fails. Passed or not, the Telepath's unit doesn't move or Rush this Movement Phase. ASSUMPTION: the AI
 * manifests it with a unit that stayed put in the Move Sub-Phase (as if chosen to move last), at the enemy it most
 * wants moved: the Victory Points it holds, and its threat and holding if it Routs, less the statuses it would lose.
 */
function movementPhase(state, side) {
  let ai = null;
  for (const u of state.units) {
    if (u.side !== side || u.destroyed || !u.arrived || u.embarkedIn || u.turn.power || u.turn.moved || u.turn.rushed || u.turn.disembarked || u.turn.fromReserves) continue;
    const m = alive(u).find((x) => hasDiscipline(x, 'Telepathy'));
    if (!m) continue;
    ai = ai || require('./ai.cjs');
    const mine = state.units.filter((x) => x.side === side && !x.destroyed && x.arrived && !x.embarkedIn);
    let best = null;
    for (const e of state.units) {
      if (e.side === side || e.destroyed || !e.arrived || e.embarkedIn || e.lockedWith.size || !alive(e).length || alive(e).some((x) => x.vehicle) || immune(e)) continue;
      if (gap(u, e) > 18 || !lineOfSight(state.table, u, e)) continue;
      const v = mindBurstValue(state, ai, e, mine);
      if (!best || v > best.v) best = { e, v };
    }
    if (!best || manifestChance(state, u, m) * best.v - perilsCost(u) < 5) continue;
    const e = best.e;
    u.turn.power = true;
    state.log(`  ${m.name} turns Mind-burst on ${e.name}`);
    if (!manifest(state, u, m, 'Mind-burst').pass || e.destroyed) continue;
    e.statuses.clear();
    for (const x of e.models) x.disgraced = false;
    require('./move.cjs').fallBack(state, e);
    if (!e.destroyed && !plainCheck(state, e, 'LD', 'Mind-burst')) addStatus(state, e, 'Routed', 'Mind-burst');
  }
}
/** What Mind-burst at e is worth to the AI, in points. */
function mindBurstValue(state, ai, e, mine) {
  const vp = ai.K(state, 1 - e.side, 'vp');
  const m = state.mission;
  const holding = !canHold(e) ? 0 : m.primary === 'claim' ? (state.table.objectives.some((o) => Math.hypot(o.x - e.x, o.y - e.y) - e.r <= 3) ? 2 * vp : 0) : m.primary === 'seize' ? vp : 0;
  const threat = Math.max(0, ...mine.map((x) => ai.meleeEV(state, e, x))) + Math.max(0, ...mine.map((x) => ai.evAt(ai.shootTable(state, e, x), 24)));
  const lost = !e.statuses.size ? 0 : e.statuses.has('Routed') ? threat + 2 * vp : 0.4 * threat + vp;
  return 0.7 * holding + (1 - plainChance(e, 'LD')) * (0.5 * threat + holding) - lost;
}

// ---------- Tranquillity (Thaumaturgy) ----------
const psychicWeapon = (w) => (w.traits || []).includes('Psychic');
/** One less Strength: a number, or the model's own ("S", "+1") less one. */
const weaker = (v) => {
  const s = String(v ?? '');
  if (/^-?\d+$/.test(s)) return +s - 1;
  if (s === 'S' || s === '') return '-1';
  if (/^[+-]\d+$/.test(s)) { const n = +s - 1; return n >= 0 ? `+${n}` : `${n}`; }
  return v;
};
/** Tranquillity on a unit (by: the side whose Thaumaturge cast it, focus: his model), or off (by null). */
function calm(state, u, by, focus) {
  if (by != null) {
    u.tranquil = { by, focus };
    for (const m of u.models) {
      m.calmBase = { ranged: m.ranged, melee: m.melee };
      m.ranged = m.ranged.map((w) => (psychicWeapon(w) ? Object.assign({}, w, { RS: weaker(w.RS) }) : w));
      m.melee = m.melee.map((w) => (psychicWeapon(w) ? Object.assign({}, w, { SM: weaker(w.SM) }) : w));
    }
    if (focus) focus.calming = [...(focus.calming || []), u];
    return;
  }
  if (!u.tranquil) return;
  if (u.tranquil.focus?.calming) u.tranquil.focus.calming = u.tranquil.focus.calming.filter((x) => x !== u);
  u.tranquil = null;
  for (const m of u.models) if (m.calmBase) { m.ranged = m.calmBase.ranged; m.melee = m.calmBase.melee; m.calmBase = null; }
  if (state.log) state.log(`    ${u.name} is free of Tranquillity`);
}
/** What the enemy's psychic powers and Psychic Weapons in a unit are worth calming, for the AI (points). */
function psychicWorth(e) {
  const a = alive(e);
  const per = e.pts / Math.max(1, e.models.length);
  return a.reduce((t, m) => t + ([...m.ranged, ...m.melee].some(psychicWeapon) ? 0.2 * per : 0) + ((m.disciplines || []).length ? 6 : 0), 0);
}
/**
 * Tranquillity (Thaumaturgy, a Curse; CONFIRMED, rulebook): in the Effects Sub-Phase of the Start Phase, a
 * Thaumaturge manifests it at an enemy unit with a Psyker in it, with a model within 18" that can see him; passed,
 * until the start of the Active Player's next turn the target's models are at -2 Willpower to manifest Psychic Powers
 * and Reactions, and their Psychic Weapons hit at -1 Strength. ASSUMPTION: the Strength comes off the weapon's profile
 * (before Force doubles it). The AI calms the enemy unit whose psychic powers and weapons are worth most, when that
 * outweighs the Perils it risks. Called at the start of the Active Player's turn, when its last one wears off.
 */
function startPhase(state, side) {
  for (const u of state.units) if (u.tranquil && u.tranquil.by === side) calm(state, u, null);
  for (const f of state.units) {
    if (f.side !== side || f.destroyed || !f.arrived || f.embarkedIn || f.turn.power) continue;
    const m = alive(f).find((x) => hasDiscipline(x, 'Thaumaturgy'));
    if (!m) continue;
    let best = null;
    for (const e of state.units) {
      if (e.side === side || e.destroyed || !e.arrived || e.embarkedIn || e.tranquil || !e.psyker || !alive(e).length || immune(e)) continue;
      if (gap(f, e) > 18 || !lineOfSight(state.table, e, f)) continue;
      const v = psychicWorth(e);
      if (!best || v > best.v) best = { e, v };
    }
    if (!best || manifestChance(state, f, m) * best.v < perilsCost(f) + 5) continue;
    f.turn.power = true;
    state.log(`  ${m.name} calls Tranquillity on ${best.e.name}`);
    if (!manifest(state, f, m, 'Tranquillity').pass || best.e.destroyed) continue;
    calm(state, best.e, side, m);
    state.log(`    ${best.e.name}: -2 Willpower to manifest, Psychic Weapons at -1 Strength (Tranquillity)`);
  }
}

module.exports = { POWERS, setup, powersOf, manifest, manifestChance, willpowerCheck, perils, forceCheck, blockedPsychic, afterWounds, onChargeStep4, immune, rollDice, rollExpr, foresightsBlessing, movementPhase, startPhase, resurrection, explode, calm, plainCheck, hasDiscipline };

