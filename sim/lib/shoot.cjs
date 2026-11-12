'use strict';
// A Shooting Attack, following the HH3 sequence: declare target, check Line of Sight and range, declare weapons,
// resolve Fire Groups (with Deflagrate making new ones), then remove casualties, apply Shock and Vehicle Damage
// statuses, and leave markers for the checks made in the Morale Sub-Phase (Pinning, Suppressive, Stun, Panic,
// and the Panic Check for heavy casualties).
const { num, xOf, argOf, has } = require('./rules.cjs');
const { resolveGroup, rangedGroup } = require('./attack.cjs');
const { planVolley, valuePerWound } = require('./fire.cjs');
const { gap } = require('./table.cjs');
const { alive, addStatus, check } = require('./checks.cjs');
const core = require('./core.cjs');
const psychic = require('./psychic.cjs');

/** The Critical Hit that Prey Instinct grants against a unit with Tactical Statuses (Rangdan rule). */
function preyCrit(shooter, target) {
  if (!shooter.rules.includes('Prey Instinct')) return null;
  const n = target.statuses.size;
  return n > 0 ? Math.max(4, 7 - n) : null;
}

// Force (X) and Perils of the Warp live in psychic.cjs
const { forceCheck, perils } = psychic;

/**
 * Make a Shooting Attack. opts: { phaseAttack, snap, reaction, volley, defensiveOnly, assaultOnly, models (subset),
 * fpBonus, label }. A phaseAttack is the Active Player's attack in the Shooting Phase, which the Reactive Player
 * may answer with a reaction (see reactions.cjs). Returns { damage, kills, pts, target }.
 */
function shootingAttack(state, shooter, target, opts = {}) {
  if (shooter.destroyed || target.destroyed) return { damage: 0, kills: 0, pts: 0 };
  let react = null;
  if (opts.phaseAttack && state.reactions && shooter.side === state.active) {
    react = state.reactions.onShot(state, shooter, target);
    if (react.cancel || shooter.destroyed) {
      for (const f of react.after) f();
      state.reactions.clearBuffs(state, 'attack');
      return { damage: 0, kills: 0, pts: 0, target };
    }
    target = react.target;
  }
  const snap = opts.snap || shooter.cond?.has('Stupefied') || shooter.statuses.has('Suppressed') || (shooter.turn.rushed && /Light|Rapid/.test(shooter.unitType)) || (/Flyer/.test(target.unitType) && !has(shooter.rules, 'Skyfire'));
  const exclude = (w) => psychic.blockedPsychic(w, target) || (opts.defensiveOnly && !core.isDefensive(w)) || (opts.assaultOnly && !(w.traits || []).includes('Assault') && !has(shooter.rules, 'Implacable Advance')) || (opts.assaultOnly && has(shooter.rules, 'Implacable Advance') && (has(w.specialRules, 'Heavy') || has(w.specialRules, 'Ordnance')));
  const plan = planVolley(shooter, target, state, { stationary: !!shooter.turn.stationary, snap, exclude, models: opts.models, fpBonus: opts.fpBonus, losOK: react?.losOK ? true : undefined });
  if (!plan.picks.length) {
    if (react) { for (const f of react.after) f(); state.reactions.clearBuffs(state, 'attack'); }
    return { damage: 0, kills: 0, pts: 0, target };
  }
  const startModels = alive(target).length;
  const vpw = valuePerWound(target);
  let damage = 0, kills = 0;
  const triggers = { Pinning: null, Suppressive: null, Stun: null, Panic: null };
  const shock = new Set();
  const vehicleStatuses = [];
  const phage = new Set();
  const label = opts.label || 'shoots';
  const misfires = [];
  // group identical weapons into Fire Groups
  const groups = new Map();
  for (const p of plan.picks) {
    if (opts.models && !opts.models.includes(p.model)) continue;
    const key = p.weapon.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const ctx = { dice: state.dice, preyCrit: preyCrit(shooter, target), coverSave: plan.coverSave, range: plan.range, precisionMin: react?.ctx.precisionMin,
    onKill: (m, u) => state.onCasualty && state.onCasualty(m, u, shooter) };
  const parts = [];
  for (const [name, picks] of groups) {
    let hits = 0, wounds = 0, dmg = 0, k = 0, unsaved = 0;
    for (const p of picks) {
      if (target.destroyed || !alive(target).length) break;
      let w = p.weapon;
      if (has(w.specialRules, 'Force')) w = forceCheck(state, shooter, p.model, w);
      if (has(w.specialRules, 'Limited')) { shooter.limitedUsed = shooter.limitedUsed || {}; shooter.limitedUsed[w.name] = (shooter.limitedUsed[w.name] || 0) + 1; }
      const g = rangedGroup(p.model, w, target, { stationary: !!shooter.turn.stationary, snap, fpBonus: opts.fpBonus });
      g.from = shooter;
      // Overload (X), raised by 1 for Spite of the Gorgon and Bitter Fury (fpBonus); templates roll FP dice for it
      g.overload = (xOf(w.specialRules, 'Overload') || 0) + (opts.fpBonus ? 1 : 0);
      // Glorious Martyrdom: one model soaks this Fire Group (and any it splits into)
      const martyr = react?.martyrGroup === name ? react.ctx.martyr : null;
      if (martyr && martyr.wounds <= 0) break;
      const r = resolveGroup(g, target, martyr ? Object.assign({}, ctx, { martyr }) : ctx);
      hits += r.hits; wounds += r.wounds; dmg += r.damage; k += r.kills; unsaved += r.unsaved;
      let mis = r.misfires;
      if (g.overload && g.hitNeed == null) for (let i = 0; i < num(w.FP, 1); i++) if (state.dice.d6() <= g.overload) mis++;
      if (mis) misfires.push({ attacks: mis, S: g.S, AP: g.AP, D: g.D, hitNeed: null, rules: (w.specialRules || []).filter((x) => !/^Overload/.test(x)), melee: false, weaponTraits: g.weaponTraits, from: shooter });
      psychic.afterWounds(state, w, target, r.wounds);
      vehicleStatuses.push(...r.vehicleStatuses);
      const rules = w.specialRules || [];
      if (r.wounds > 0) { const x = xOf(rules, 'Pinning'); if (x != null) triggers.Pinning = Math.max(triggers.Pinning ?? -1, x); }
      if (r.hits > 0) for (const t of ['Suppressive', 'Stun', 'Panic']) { const x = xOf(rules, t); if (x != null) triggers[t] = Math.max(triggers[t] ?? -1, x); }
      if (r.shockRolls > 0 && target.models.some((m) => m.wounds > 0 && (m.vehicle || /Walker/.test(m.unitType)))) {
        const s = argOf(rules, 'Shock'); if (s) for (const st of s.split(/,\s*/)) shock.add(st);
      }
      if (r.unsaved > 0) { const ph = argOf(rules, 'Phage'); if (ph) phage.add(ph); }
      // Deflagrate (X): a new Fire Group of hits at Strength X, AP -, Damage 1 for each unsaved wound
      const defl = xOf(rules, 'Deflagrate');
      if (defl && r.unsaved > 0 && !target.models.some((m) => m.wounds > 0 && m.vehicle) && !(martyr && martyr.wounds <= 0)) {
        const r2 = resolveGroup({ attacks: r.unsaved, S: defl, AP: 7, D: 1, hitNeed: null, rules: [], melee: false, from: shooter }, target, Object.assign({}, ctx, { preyCrit: null }));
        dmg += r2.damage; k += r2.kills;
      }
    }
    damage += dmg; kills += k;
    if (hits) parts.push(`${name}: ${hits} hits, ${unsaved} unsaved, ${k} killed`);
  }
  // reactions resolved just before Step 11 (Bitter Fury, Retribution Strike)
  if (react) for (const f of react.beforeStep11) f();
  // Step 11: statuses from Shock and Glancing Hits on vehicles
  for (const st of shock) addStatus(state, target, st, 'Shock');
  for (const st of vehicleStatuses) addStatus(state, target, st, 'Vehicle Damage');
  if (phage.size) { target.phage = target.phage || new Set(); for (const ph of phage) target.phage.add(ph); }
  // markers for the Morale Sub-Phase
  const morale = state.pendingMorale;
  for (const [t, x] of Object.entries(triggers)) if (x != null && !target.destroyed) morale.push({ unit: target, type: t, x, from: shooter.name });
  if (!target.destroyed && startModels > 1 && kills / startModels >= core.panicCasualtyFraction) morale.push({ unit: target, type: 'Casualties', x: 0, from: shooter.name });
  const pts = damage * vpw;
  state.log(`  ${shooter.name} ${label} at ${target.name}${snap ? ' (Snap Shots)' : ''}: ${parts.join('; ') || 'no hits'}${target.destroyed ? ' — destroyed' : ''}`);
  if (state.afterDamage) state.afterDamage(target);
  // reactions resolved once the attack is over (Return Fire, Brutal Tide, Wrath of Angels)
  if (react) { state.reactions.clearBuffs(state, 'attack'); for (const f of react.after) f(); }
  // then the Misfire Groups hit the shooter (Overload)
  for (const g of misfires) {
    if (shooter.destroyed) break;
    const r = resolveGroup(g, shooter, { dice: state.dice, onKill: (m) => state.onCasualty && state.onCasualty(m, shooter, null) });
    state.log(`    ${shooter.name} overloads: ${g.attacks} Misfire hits, ${r.unsaved} unsaved, ${r.kills} killed`);
    if (state.afterDamage) state.afterDamage(shooter);
  }
  return { damage, kills, pts, target };
}

/** Resolve every marker left by this phase's Shooting Attacks (the Morale Sub-Phase). */
function moraleSubPhase(state) {
  const pending = state.pendingMorale.splice(0);
  // one check per unit per kind: the highest X counts
  const by = new Map();
  for (const p of pending) {
    if (p.unit.destroyed) continue;
    const k = p.unit.uid + ':' + p.type;
    if (!by.has(k) || by.get(k).x < p.x) by.set(k, p);
  }
  for (const p of by.values()) {
    const u = p.unit;
    if (u.destroyed) continue;
    const status = { Pinning: 'Pinned', Suppressive: 'Suppressed', Stun: 'Stunned', Panic: 'Routed', Casualties: 'Routed' }[p.type];
    if (u.statuses.has(status)) continue;
    const key = status === 'Routed' ? 'LD' : 'CL';
    const heavy = key === 'CL' && alive(u).every((m) => /Heavy/.test(m.unitType)) ? 1 : 0;
    const pass = check(state, u, key, p.x - heavy, `${p.type === 'Casualties' ? 'Panic Check for casualties' : `${p.type} (${p.x})`}`);
    if (!pass) addStatus(state, u, status, p.type === 'Casualties' ? 'heavy casualties' : p.type);
  }
}

module.exports = { shootingAttack, moraleSubPhase, preyCrit, forceCheck, perils };
