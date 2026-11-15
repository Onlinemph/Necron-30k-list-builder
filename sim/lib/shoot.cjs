'use strict';
// A Shooting Attack, following the HH3 sequence: declare target, check Line of Sight and range, declare weapons,
// resolve Fire Groups (with Deflagrate making new ones, and missed Blasts scattering), then remove casualties, apply
// Shock and Vehicle Damage statuses, and leave markers for the checks made in the Morale Sub-Phase (Pinning,
// Suppressive, Stun, Panic, and the Panic Check for heavy casualties). Units under a scattered marker take a Shooting
// Attack of their own afterwards, and a vehicle may go on to split its fire.
const { num, xOf, argOf, has } = require('./rules.cjs');
const { resolveGroup, rangedGroup, modelsUnder, SCATTER_HIT } = require('./attack.cjs');
const { planVolley, valuePerWound, steady, STEADY } = require('./fire.cjs');
const { gap, inCover } = require('./table.cjs');
const { alive, addStatus, check, passChance } = require('./checks.cjs');
const core = require('./core.cjs');
const psychic = require('./psychic.cjs');
const legions = require('./legions.cjs');

/** The Critical Hit that Prey Instinct grants against a unit with Tactical Statuses (Rangdan rule). */
function preyCrit(shooter, target) {
  if (!shooter.rules.includes('Prey Instinct')) return null;
  const n = target.statuses.size;
  return n > 0 ? Math.max(4, 7 - n) : null;
}

// Force (X) and Perils of the Warp live in psychic.cjs
const { forceCheck, perils } = psychic;

/**
 * Cameleoline (wargear of Kaedes Nex, Corvus Corax and Mor Deythan): a unit that includes it, shot from 12" or more
 * away, has Shrouded (5+), or one better than the Shrouded it has, to 4+ (CONFIRMED). Returns the Shrouded value for
 * the attack, or null. ASSUMPTION: the text's "+1" to an existing Shrouded means one step better (it caps at 4+); the
 * range is the attack's measured range (closest models).
 */
function cameleoline(target, range) {
  if (range == null || range < 12 || !alive(target).some((m) => (m.items || []).some((i) => /^Cameleoline/i.test(i)))) return null;
  const now = Math.min(7, target.buff?.shrouded || 7, ...alive(target).map((m) => xOf(m.rules, 'Shrouded') || 7));
  return now <= 6 ? Math.max(4, now - 1) : 5;
}

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
  // a unit with any Tactical Status never counts as Stationary (SHEET)
  // a unit shooting as a Reaction counts as Stationary (CONFIRMED), unless it has a status
  const still = opts.reaction ? { stationary: true, heavyOK: true } : core.still(state, shooter);
  // Super-Heavy and Stable models count as Stationary unless they Rushed (fire.cjs)
  const stationary = (!!still.stationary || steady(state, shooter)) && !shooter.statuses.size;
  // Shadow Walkers (Raven Guard): shots from 18" or more away are Snap Shots. Against a Flyer only weapons with
  // Skyfire fire normally (rangedGroup, per weapon)
  // a Flyer on a Combat Assignment other than a Strafing Run is shot at with Snap Shots only (flyers.cjs)
  const snap = opts.snap || require('./flyers.cjs').snapAgainst(target) || (legions.is(target, 'Raven Guard') && gap(shooter, target) >= 18) || shooter.cond?.has('Stupefied') || core.snapOnly(shooter) || (shooter.turn.rushed && /Light|Rapid/.test(shooter.unitType));
  const vsFlyer = /Flyer/.test(target.unitType || ''), statused = shooter.statuses.size > 0;
  const exclude = (w) => psychic.blockedPsychic(w, target) || (opts.defensiveOnly && !core.isDefensive(w)) || (opts.assaultOnly && !(w.traits || []).includes('Assault') && !has(shooter.rules, 'Implacable Advance')) || (opts.assaultOnly && has(shooter.rules, 'Implacable Advance') && (has(w.specialRules, 'Heavy') || has(w.specialRules, 'Ordnance'))) || (opts.split && !opts.split.may(w));
  const plan = planVolley(shooter, target, state, { stationary, snap, exclude, models: opts.models, fpBonus: opts.fpBonus, losOK: react?.losOK ? true : undefined, ignoreCover: !!opts.noCover, reaction: !!opts.reaction });
  // a Barrage weapon fired at a unit out of Line of Sight: no Hit Test for a Blast, Side Armour for a vehicle
  const indirect = !plan.los;
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
  // hits a Blast Marker scattered onto other units: new Fire Groups, resolved once this attack is over
  const spill = [];
  // group identical weapons into Fire Groups
  const groups = new Map();
  for (const p of plan.picks) {
    if (opts.models && !opts.models.includes(p.model)) continue;
    const key = p.weapon.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const ctx = { dice: state.dice, log: state.log, preyCrit: preyCrit(shooter, target), coverSave: plan.coverSave, range: plan.range, precisionMin: react?.ctx.precisionMin,
    shrouded: cameleoline(target, plan.range), noShrouded: !!opts.noCover, onKill: (m, u) => state.onCasualty && state.onCasualty(m, u, shooter) };
  const parts = [];
  // Fire Discipline (Imperial Fists): +1 to hit for Bolt or Auto Fire Groups of more than five dice
  const fireDiscipline = legions.is(shooter, 'Imperial Fists');
  for (const [name, picks] of groups) {
    const groupDice = fireDiscipline ? picks.reduce((t, p) => t + rangedGroup(p.model, p.weapon, target, { stationary, snap }).attacks, 0) : 0;
    const disciplined = fireDiscipline && groupDice > 5 && (picks[0].weapon.traits || []).some((t) => /^(Bolt|Auto)$/.test(t));
    let hits = 0, wounds = 0, dmg = 0, k = 0, unsaved = 0;
    // the Fire Group's missed Blast attacks, for its one Scatter Roll
    const missed = { n: 0, g: null, w: null, martyr: null };
    for (const p of picks) {
      if (target.destroyed || !alive(target).length) break;
      let w = p.weapon;
      if (has(w.specialRules, 'Force')) w = forceCheck(state, shooter, p.model, w, target);
      w = psychic.rollDice(state, w);
      if (has(w.specialRules, 'Limited')) { shooter.limitedUsed = shooter.limitedUsed || {}; shooter.limitedUsed[w.name] = (shooter.limitedUsed[w.name] || 0) + 1; }
      const g = rangedGroup(p.model, w, target, { stationary, snap, vsFlyer, statused, indirect, fpBonus: opts.fpBonus, heavyOK: !!still.heavyOK && !shooter.statuses.size });
      g.from = shooter;
      if (disciplined && g.hitNeed != null) g.hitNeed = Math.max(2, g.hitNeed - 1);
      // Overload (X), raised by 1 for Spite of the Gorgon and Bitter Fury (fpBonus); templates roll FP dice for it
      g.overload = (xOf(w.specialRules, 'Overload') || 0) + (opts.fpBonus ? 1 : 0);
      // Glorious Martyrdom: one model soaks this Fire Group (and any it splits into)
      const martyr = react?.martyrGroup === name ? react.ctx.martyr : null;
      if (martyr && martyr.wounds <= 0) break;
      const gctx = martyr ? Object.assign({}, ctx, { martyr }) : ctx;
      // a Barrage Blast out of sight: an Indirect Scatter Roll for each attack instead of Hit Tests
      const r = g.pIndirect != null ? resolveGroup(autoHits(g, indirectScatter(state, shooter, target, g, spill)), target, gctx) : resolveGroup(g, target, gctx);
      if (r.blastMisses) Object.assign(missed, { n: missed.n + r.blastMisses, g, w, martyr });
      let mis = r.misfires;
      if (g.overload && has(w.specialRules, 'Template')) for (let i = 0; i < num(w.FP, 1); i++) if (state.dice.d6() <= g.overload) mis++;
      if (mis) misfires.push({ attacks: mis, S: g.S, AP: g.AP, D: g.D, hitNeed: null, rules: (w.specialRules || []).filter((x) => !/^Overload/.test(x)), melee: false, weaponTraits: g.weaponTraits, from: shooter });
      absorb(r, w, martyr);
    }
    // Blast (X): once the hits are counted, a single Scatter Roll for all of the Fire Group's missed Hit Tests; each
    // miss then hits every model the moved marker covers, the target's or any other unit's, friend or foe (CONFIRMED)
    if (missed.n) {
      const onTarget = blastScatter(state, shooter, target, missed.g, missed.n, spill);
      if (onTarget && alive(target).length) absorb(resolveGroup(autoHits(missed.g, onTarget), target, missed.martyr ? Object.assign({}, ctx, { martyr: missed.martyr }) : ctx), missed.w, missed.martyr);
    }
    damage += dmg; kills += k;
    if (hits) parts.push(`${name}: ${hits} hits, ${unsaved} unsaved, ${k} killed`);
    /** What one resolved group adds to the attack: damage, Step 11 statuses and the Morale Sub-Phase's checks. */
    function absorb(r, w, martyr) {
      hits += r.hits; wounds += r.wounds; dmg += r.damage; k += r.kills; unsaved += r.unsaved;
      psychic.afterWounds(state, w, target, r.wounds);
      vehicleStatuses.push(...r.vehicleStatuses);
      const rules = w.specialRules || [];
      // Pinning and Panic trigger on a wound, Suppressive and Stun on a hit (CONFIRMED, rulebook). Blood of Fire
      // (Salamanders): Panic from Flame weapons doesn't touch them. Vehicles can't be Routed (CONFIRMED)
      const flameVsSal = (w.traits || []).includes('Flame') && legions.is(target, 'Salamanders');
      const noPanic = flameVsSal || target.models.every((m) => m.vehicle);
      if (r.wounds > 0) for (const t of ['Pinning', 'Panic']) { const x = xOf(rules, t); if (x != null && !(t === 'Panic' && noPanic)) triggers[t] = Math.max(triggers[t] ?? -1, x); }
      if (r.hits > 0) for (const t of ['Suppressive', 'Stun']) { const x = xOf(rules, t); if (x != null) triggers[t] = Math.max(triggers[t] ?? -1, x); }
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
  }
  // reactions resolved just before Step 11 (Bitter Fury, Retribution Strike)
  if (react) for (const f of react.beforeStep11) f();
  // Step 11: statuses from Shock and Glancing Hits on vehicles; Volley Attacks and Reactions' Shooting Attacks never
  // inflict statuses or checks (SHEET, CONFIRMED)
  if (!opts.volley && !opts.reaction) {
    for (const st of shock) addStatus(state, target, st, 'Shock');
    for (const st of vehicleStatuses) vehicleDamage(state, target, st);
  }
  if (phage.size) { target.phage = target.phage || new Set(); for (const ph of phage) target.phage.add(ph); }
  // markers for the Morale Sub-Phase
  const morale = state.pendingMorale;
  if (!opts.volley && !opts.reaction) {
    for (const [t, x] of Object.entries(triggers)) if (x != null && !target.destroyed) morale.push({ unit: target, type: t, x, from: shooter.name });
    if (!target.destroyed && startModels > 1 && kills / startModels >= core.panicCasualtyFraction) morale.push({ unit: target, type: 'Casualties', x: 0, from: shooter.name });
  }
  // Lords of Profligacy (Emperor's Children, Legiones Hereticus): after the attack the target may become Stupefied,
  // losing its statuses and gaining none while it lasts (CONFIRMED). The AI takes it when the unit already has a
  // status, faces a check it will likely fail, or fights better than it shoots (Stupefied shoots Snap Shots)
  if (!target.destroyed && !target.vehicle && legions.hereticus(target) && legions.is(target, "Emperor's Children") && !target.cond?.has('Stupefied')) {
    const ai = require('./ai.cjs');
    const foes = state.units.filter((e) => e.side !== target.side && !e.destroyed);
    const failing = Math.max(0, ...morale.filter((p) => p.unit === target).map((p) => 1 - passChance(state, target, p.type === 'Casualties' || p.type === 'Panic' ? 'LD' : 'CL', p.x)));
    if (target.statuses.size || failing > 0.3 || ai.meleeValue(state, target, foes) > 1.5 * ai.shootValue(state, target, foes)) {
      require('./reactions.cjs').addCondition(state, target, 'Stupefied');
      state.log(`    ${target.name} is Stupefied (Lords of Profligacy)`);
    }
  }
  const pts = damage * vpw;
  state.log(`  ${shooter.name} ${label} at ${target.name}${snap ? ' (Snap Shots)' : ''}${indirect ? ' (out of sight)' : ''}: ${parts.join('; ') || 'no hits'}${target.destroyed ? ' — destroyed' : ''}`);
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
  // then a new Shooting Attack for each unit other than the target that a scattered Blast Marker covered
  for (const s of spill) spillAttack(state, shooter, s, opts);
  if (opts.phaseAttack && !opts.reaction) splitFire(state, shooter, target, plan, opts);
  return { damage, kills, pts, target };
}

/**
 * A vehicle of one model may divide its weapons between several Shooting Attacks in the Shooting Phase, each at a
 * different unit and each weapon in one of them; the player declares it first, and then every attack is Snap Shots
 * except a Defensive Weapon's or a Super-Heavy or Stable model's (CONFIRMED, rulebook). A Rapid vehicle that Rushed
 * can't (CONFIRMED). The AI splits only when that costs nothing: the first attack (the one battle.cjs chose) fired no
 * weapon that would have had to Snap Shot, and each later attack fires only weapons that don't have to, at the unit
 * they expect to take the most points from. ASSUMPTION/simplification: a pair of sponsons that fired at one side
 * counts as used, so its other sponson doesn't fire at a second unit.
 */
function splitFire(state, shooter, target, plan, opts) {
  const ms = alive(shooter);
  if (shooter.destroyed || shooter.side !== state.active || ms.length !== 1 || !ms[0].vehicle || shooter.turn?.rushed || !plan.picks.length) return;
  const firm = STEADY.test(ms[0].unitType || '');
  const free = (w) => firm || core.isDefensive(w);
  if (!opts.split && !plan.picks.every((p) => free(p.weapon))) return;
  const split = opts.split || { fired: new Set(), targets: new Set(), may: null };
  for (const p of plan.picks) split.fired.add(p.weapon.copyOf || p.weapon);
  split.targets.add(target);
  split.may = (w) => !split.fired.has(w) && free(w);
  if (!ms[0].ranged.some(split.may)) return;
  const stationary = (!!core.still(state, shooter).stationary || steady(state, shooter)) && !shooter.statuses.size;
  let best = null;
  for (const e of state.units) {
    if (e.side === shooter.side || e.destroyed || !e.arrived || e.embarkedIn || e.lockedWith.size || split.targets.has(e)) continue;
    const v = planVolley(shooter, e, state, { stationary, snap: core.snapOnly(shooter), exclude: (w) => !split.may(w) }).expectedPts;
    if (v > 0 && (!best || v > best.v)) best = { e, v };
  }
  if (best) shootingAttack(state, shooter, best.e, { phaseAttack: true, split, label: 'splits its fire' });
}

// ---------- scattered Blast Markers ----------
/** A Blast attack's group turned into `n` automatic hits (no Hit Test, so no Critical Hit, Precision or Shock). */
const autoHits = (g, n) => Object.assign({}, g, { attacks: n, hitNeed: null, blastN: 0, bsCrit: null, pIndirect: null });
/** The point `dist` inches from `from` in the direction the Scatter Dice shows (uniformly random). */
function scatterPoint(dice, from, dist) {
  const a = dice.rnd() * 2 * Math.PI;
  return { x: from.x + dist * Math.cos(a), y: from.y + dist * Math.sin(a) };
}
/**
 * The units a Blast Marker of diameter X centred at p covers, with how many of their models: attack.cjs's share of a
 * centred marker's models, a part model counted by the dice (rounded up with the chance of its fraction).
 */
function underMarker(state, p, X, target) {
  const out = [];
  const units = state.units && state.units.includes(target) ? state.units : [target, ...(state.units || [])];
  for (const u of units) {
    if (u.destroyed || u.arrived === false || u.embarkedIn || !u.r) continue;
    const c = modelsUnder(u, p, X);
    if (c <= 0) continue;
    const n = Math.floor(c) + (state.dice.rnd() < c % 1 ? 1 : 0);
    if (n) out.push({ unit: u, n });
  }
  return out;
}
/**
 * Share out the hits of a marker at p: `per` hits for each model covered. Returns the target's hits; other units'
 * go to `spill`, one Fire Group per unit and weapon. ASSUMPTION: a marker placed over the target (a hit) covers only
 * the target, as the attacker places it, so only a scattered marker reaches other units.
 */
function shareMarker(state, shooter, target, g, p, per, spill) {
  let onTarget = 0;
  for (const { unit, n } of underMarker(state, p, xOf(g.rules, 'Blast') || 3, target)) {
    if (unit === target) { onTarget += n * per; continue; }
    const s = spill.find((x) => x.unit === unit && x.g.weapon === g.weapon);
    if (s) s.hits += n * per; else spill.push({ unit, g, hits: n * per });
  }
  return onTarget;
}
/** A Fire Group's missed Blast attacks: one Scatter Roll (D6", the direction even on a HIT, CONFIRMED) for all of them. */
function blastScatter(state, shooter, target, g, misses, spill) {
  const p = scatterPoint(state.dice, target, state.dice.d6());
  return shareMarker(state, shooter, target, g, p, misses, spill);
}
/**
 * A Barrage Blast out of sight: for each attack an Indirect Scatter Roll, the Scatter Dice and X D6 (Barrage (X)); on
 * a HIT the marker stays where it was placed, otherwise it moves the dice's total (CONFIRMED). Returns the target's hits.
 */
function indirectScatter(state, shooter, target, g, spill) {
  const x = xOf(g.rules, 'Barrage') || 0;
  let onTarget = 0;
  for (let i = 0; i < g.attacks; i++) {
    let dist = 0;
    if (state.dice.rnd() >= SCATTER_HIT) for (let k = 0; k < x; k++) dist += state.dice.d6();
    onTarget += shareMarker(state, shooter, target, g, dist ? scatterPoint(state.dice, target, dist) : target, 1, spill);
  }
  return onTarget;
}
/**
 * Hits a scattered Blast Marker put on a unit other than the target: a new Shooting Attack on that unit once the
 * first is over (CONFIRMED), with its own saves, statuses and Morale Sub-Phase checks (none from a Volley or a
 * Reaction, as for the first). A friendly unit's losses aren't credited to the shooter.
 */
function spillAttack(state, shooter, s, opts) {
  const u = s.unit;
  if (u.destroyed || !alive(u).length) return;
  const start = alive(u).length, range = gap(shooter, u);
  const coverSave = opts.noCover || !state.table ? null : core.coverSave(u, inCover(state.table, shooter, u));
  const by = u.side !== shooter.side ? shooter : null;
  const r = resolveGroup(autoHits(s.g, s.hits), u, { dice: state.dice, log: state.log, coverSave, range, shrouded: cameleoline(u, range), noShrouded: !!opts.noCover, onKill: (m, x) => state.onCasualty && state.onCasualty(m, x, by) });
  state.log(`    the scattered ${s.g.weapon.name} hits ${u.name}${by ? '' : ' (friendly fire)'}: ${r.hits} hits, ${r.unsaved} unsaved, ${r.kills} killed`);
  const rules = s.g.rules || [];
  if (!opts.volley && !opts.reaction) {
    for (const st of r.vehicleStatuses) vehicleDamage(state, u, st);
    const noPanic = ((s.g.weaponTraits || []).includes('Flame') && legions.is(u, 'Salamanders')) || u.models.every((m) => m.vehicle);
    const marks = [];
    if (r.wounds > 0) marks.push('Pinning', ...(noPanic ? [] : ['Panic']));
    if (r.hits > 0) marks.push('Suppressive', 'Stun');
    for (const t of marks) { const x = xOf(rules, t); if (x != null && !u.destroyed) state.pendingMorale.push({ unit: u, type: t, x, from: shooter.name }); }
    if (!u.destroyed && start > 1 && r.kills / start >= core.panicCasualtyFraction) state.pendingMorale.push({ unit: u, type: 'Casualties', x: 0, from: shooter.name });
  }
  if (r.unsaved > 0) { const ph = argOf(rules, 'Phage'); if (ph) { u.phage = u.phage || new Set(); u.phage.add(ph); } }
  if (state.afterDamage) state.afterDamage(u);
}

/** A Vehicle Damage Table result: the status, or a Hull Point if the vehicle already has it (SHEET). */
function vehicleDamage(state, target, st) {
  if (target.destroyed) return;
  if (!target.statuses.has(st)) { addStatus(state, target, st, 'Vehicle Damage'); return; }
  const v = target.models.find((m) => m.wounds > 0 && m.vehicle);
  if (!v) return;
  v.wounds -= 1;
  state.log(`    ${target.name} is already ${st}: loses a Hull Point instead`);
  if (v.wounds <= 0 && state.onCasualty) state.onCasualty(v, target, null);
  if (state.afterDamage) state.afterDamage(target);
}

/** Resolve every marker left by this phase's Shooting Attacks (the Morale Sub-Phase). */
function moraleSubPhase(state) {
  const pending = state.pendingMorale.splice(0);
  // no unit makes more than one Check for a given Status: of several, the Active Player picks one (here the hardest)
  // and the rest are ignored; checks against Routed come first, and failing one cancels the rest (CONFIRMED)
  const STATUS = { Pinning: 'Pinned', Suppressive: 'Suppressed', Stun: 'Stunned', Panic: 'Routed', Casualties: 'Routed' };
  const by = new Map();
  for (const p of pending) {
    if (p.unit.destroyed) continue;
    const k = p.unit.uid + ':' + STATUS[p.type];
    if (!by.has(k) || by.get(k).x < p.x) by.set(k, p);
  }
  const ordered = [...by.values()].sort((a, b) => (STATUS[b.type] === 'Routed') - (STATUS[a.type] === 'Routed'));
  for (const p of ordered) {
    if (p.unit.statuses.has('Routed') && STATUS[p.type] !== 'Routed') continue;
    const u = p.unit;
    if (u.destroyed) continue;
    const status = { Pinning: 'Pinned', Suppressive: 'Suppressed', Stun: 'Stunned', Panic: 'Routed', Casualties: 'Routed' }[p.type];
    if (u.statuses.has(status)) continue;
    const key = status === 'Routed' ? 'LD' : 'CL';
    const heavy = key === 'CL' && alive(u).every((m) => /Heavy/.test(m.unitType)) ? 1 : 0;
    // The Bitter End (Iron Warriors): the weapon rule's penalty is ignored
    const x = legions.is(u, 'Iron Warriors') && p.type !== 'Casualties' ? 0 : p.x;
    const pass = check(state, u, key, x - heavy, `${p.type === 'Casualties' ? 'Panic Check for casualties' : `${p.type} (${p.x})`}`);
    if (!pass) addStatus(state, u, status, p.type === 'Casualties' ? 'heavy casualties' : p.type);
  }
}

module.exports = { shootingAttack, moraleSubPhase, vehicleDamage, preyCrit, forceCheck, perils };
