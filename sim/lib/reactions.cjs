'use strict';
// Reactions: the Reactive Player's answers to the Active Player's moves, shots and charges.
//
// Each trigger (an enemy move, a Shooting Attack, a charge, an arrival from Reserves, the end of a combat, a
// challenge) collects the reactions the Reactive Player could make, prices each one in expected points, and
// makes the best if it is worth a point of the Reaction Allotment (ai.worthReacting). A unit reacts at most once
// per Player Turn, and once-per-battle reactions are tracked per side.
//
// Texts: the three Core Reactions and the Advanced Reactions come from data/bsdata/common.json; the Rangdan ones
// from the Rangdan army data. Interpretations are marked ASSUMPTION; see sim/README.md.
const { num, xOf, has } = require('./rules.cjs');
const { planVolley, valuePerWound } = require('./fire.cjs');
const { meleeGroup, expectedGroup, rangedGroup, resolveGroup } = require('./attack.cjs');
const { gap, dist, lineOfSight, W, H } = require('./table.cjs');
const { alive, passChance, check, addStatus, collarState } = require('./checks.cjs');
const ai = require('./ai.cjs');
const legions = require('./legions.cjs');
const core = require('./core.cjs');

// ---------- which side has which reactions ----------
const LEGION_REACTIONS = {
  'Sons of Horus': ['Warrior Pride'], 'World Eaters': ['Furious Charge', 'Brutal Tide'], "Emperor's Children": ['Perfect Counter', 'Twisted Desire'],
  'Iron Hands': ['Spite of the Gorgon'], 'Iron Warriors': ['Bitter Fury'], 'Imperial Fists': ['Bastion of Fire'], 'White Scars': ['Chasing the Wind'],
  Salamanders: ['Selfless Burden'], Ultramarines: ['Retribution Strike'], 'Raven Guard': ['Shadow Veil'], 'Space Wolves': ['Bestial Savagery'],
  'Blood Angels': ['Wrath of Angels'], 'Dark Angels': ['Vengeance of the First Legion'], 'Death Guard': ['Barbaran Endurance'],
  'Word Bearers': ['Glorious Martyrdom'], 'Alpha Legion': ['Smoke and Mirrors'], 'Night Lords': ['Better Part of Valour'],
};
// Advanced Reactions every army has, gated by the reacting unit's Traits or Type
const GENERIC = ['Smokescreen', 'Shieldwall!', 'Evade'];
// ASSUMPTION: Take Cover belongs to the Imperialis Militia and Solar Auxilia
const ARMY_REACTIONS = { 'imperialis-militia': ['Take Cover'], 'solar-auxilia': ['Take Cover'] };
const ONCE_PER_BATTLE = new Set(['Moonfall', 'Perfect Counter', 'Spite of the Gorgon', 'Bitter Fury', 'Bastion of Fire', 'Selfless Burden', 'Retribution Strike',
  'Shadow Veil', 'Bestial Savagery', 'Wrath of Angels', 'Vengeance of the First Legion', 'Barbaran Endurance', 'Glorious Martyrdom', 'Brutal Tide']);

function setup(state) {
  const { loadArmyData } = require('./army.cjs');
  state.reactionSet = [0, 1].map((side) => {
    const set = new Set(['Reposition', 'Intercept', 'Return Fire', 'Overwatch', 'Heroic Intervention', ...GENERIC]);
    const ids = new Set(state.units.filter((u) => u.side === side).map((u) => u.armyId));
    for (const id of ids) {
      for (const n of ARMY_REACTIONS[id] || []) set.add(n);
      // fan armies list their reactions in their own rules
      try { for (const r of loadArmyData(id).D.rules?.reactions || []) set.add(r.name || r); } catch (e) { /* no data: no extra reactions */ }
    }
    // the Legion's Advanced Reaction; Emperor's Children and World Eaters have one per version (CONFIRMED)
    const VERSION = { 'Brutal Tide': 'Astartes', 'Perfect Counter': 'Astartes', 'Furious Charge': 'Hereticus', 'Twisted Desire': 'Hereticus' };
    for (const u of state.units.filter((x) => x.side === side && x.legion)) for (const n of LEGION_REACTIONS[u.legion] || []) if (!VERSION[n] || VERSION[n] === u.rite) set.add(n);
    return set;
  });
  state.usedOnce = [new Set(), new Set()];
  state.reactionCount = [{}, {}];
}

// ---------- helpers ----------
const allTrait = (u, t) => alive(u).length > 0 && alive(u).every((m) => (m.traits || []).includes(t));
const mostTrait = (u, t) => { const a = alive(u); return a.filter((m) => (m.traits || []).includes(t)).length * 2 > a.length; };
const isVeh = (u) => alive(u).some((m) => m.vehicle);
// SHEET: a unit can't react while Stunned, Routed, in combat or if it has already reacted this turn (reactions
// that are made in combat by definition pass inCombatOK)
const canReact = (u, inCombatOK = false) => !u.destroyed && u.arrived && !u.embarkedIn && !u.reacted && !u.statuses.has('Stunned') && !u.statuses.has('Routed')
  && (inCombatOK || !u.lockedWith.size) && !u.cond?.has('Stupefied') && !alive(u).every((m) => /Automata|Flyer|Fortification/.test(m.unitType));
const available = (state, side, name) => state.reactionSet?.[side]?.has(name) && !(ONCE_PER_BATTLE.has(name) && state.usedOnce[side].has(name));

/** Pay for a reaction and mark the reacting unit. */
function spend(state, side, name, unit) {
  // Tactical Flexibility (Ultramarines): one reaction a turn costs nothing
  if (unit && legions.is(unit, 'Ultramarines') && state.umFlex && !state.umFlex[side]) { state.umFlex[side] = true; state.log(`    (Tactical Flexibility: no Reaction Point spent)`); }
  else state.reactionsLeft[side]--;
  if (unit) unit.reacted = true;
  if (ONCE_PER_BATTLE.has(name)) state.usedOnce[side].add(name);
  state.reactionCount[side][name] = (state.reactionCount[side][name] || 0) + 1;
}
/** Pick the best option worth a reaction point, pay for it, and return it (the caller applies it). */
function choose(state, side, options, phase) {
  if (state.reactionsLeft[side] <= 0) return null;
  // Neural Collars: a collared unit out of its masters' reach can't react
  const ok = options.filter((o) => o && o.value > 0 && available(state, side, o.name) && (!o.unit || (canReact(o.unit, o.inCombat) && collarState(state, o.unit) !== 'far')));
  if (!ok.length) return null;
  const best = ok.reduce((b, o) => (o.value > b.value ? o : b), ok[0]);
  const free = best.unit && legions.is(best.unit, 'Ultramarines') && state.umFlex && !state.umFlex[side];
  if (!(free ? best.value > 3 : ai.worthReacting(state, side, best.value, phase))) return null;
  if (!best.deferred) spend(state, side, best.name, best.unit);
  return best;
}

// ---------- buffs from reactions and conditions ----------
/** Give a unit temporary modifiers until the end of the attack or the phase. */
function addBuff(u, fx, until) {
  u.buffs = u.buffs || [];
  u.buffs.push(Object.assign({ until }, fx));
  refresh(u);
}
function refresh(u) {
  const b = { tough: 0, fnp: 7, shrouded: 7, ew: 0, attacks: 0, str: 0, ws: 0 };
  const fx = [...(u.buffs || [])];
  if (u.cond?.has('Stupefied')) fx.push({ fnp: 6, str: 1 });
  if (u.cond?.has('Lost to the Nails')) fx.push({ attacks: 1 });
  for (const f of fx) {
    b.tough += f.tough || 0; b.attacks += f.attacks || 0; b.str += f.str || 0; b.ws += f.ws || 0;
    if (f.fnp) b.fnp = Math.min(b.fnp, f.fnp);
    if (f.shrouded) b.shrouded = Math.min(b.shrouded, f.shrouded);
    if (f.ew) b.ew = Math.max(b.ew, f.ew);
  }
  u.buff = fx.length ? b : null;
}
function clearBuffs(state, until) {
  for (const u of state.units) if (u.buffs?.length) { u.buffs = u.buffs.filter((b) => b.until !== until); refresh(u); }
}
/** A unit gains a condition (Stupefied, Lost to the Nails): both remove its Tactical Statuses (CONFIRMED). */
function addCondition(state, u, c) {
  u.cond = u.cond || new Set();
  u.cond.add(c);
  u.statuses.clear();
  refresh(u);
  state.log(`    ${u.name} becomes ${c}`);
}
const meleeMods = (u) => u.buff && { attacks: u.buff.attacks, str: u.buff.str, ws: u.buff.ws };

/** Expected points a shooter's attack would take off a target, optionally with a buff on the target. */
function incoming(state, shooter, target, fx, opts = {}) {
  const saved = target.buff;
  if (fx) { const prev = target.buffs || []; target.buffs = [...prev, fx]; refresh(target); target.buffs = prev; }
  const v = planVolley(shooter, target, state, { stationary: !!shooter.turn.stationary, snap: opts.snap, losOK: opts.losOK }).expectedPts;
  target.buff = saved;
  return v;
}
/** Expected points one round of combat would cost the target, optionally with buffs (uncached, unlike ai.meleeEV). */
function meleeIncoming(state, a, b, fxA, fxB) {
  const savedA = a.buff, savedB = b.buff;
  if (fxB) { const p = b.buffs || []; b.buffs = [...p, fxB]; refresh(b); b.buffs = p; }
  let e = 0;
  for (const m of alive(a)) {
    if (m.vehicle || !m.melee.length) continue;
    let best = 0;
    for (const w of m.melee) best = Math.max(best, expectedGroup(meleeGroup(m, w, b, { mods: fxA || meleeMods(a) }), b));
    e += best;
  }
  a.buff = savedA; b.buff = savedB;
  return e * valuePerWound(b);
}
/** Move a into base contact with b and lock them (a reaction charge). */
function lockInto(state, a, b, why) {
  const d = dist(a, b) || 1;
  const k = (a.r + b.r) / d;
  a.x = b.x + (a.x - b.x) * k; a.y = b.y + (a.y - b.y) * k;
  a.lockedWith.add(b); b.lockedWith.add(a);
  a.turn.charged = true;
  state.log(`    ${a.name} ${why}: Locked in Combat with ${b.name}`);
}
/** A reaction Charge Roll for a unit against a target; true if it reaches. */
function reactionCharge(state, u, t, why) {
  const need = gap(u, t);
  const roll = core.chargeRoll(u, state.dice);
  state.log(`    ${u.name} ${why}: charge roll ${roll} (needed ${need.toFixed(1)}")`);
  if (roll >= need) { lockInto(state, u, t, why); return true; }
  return false;
}
const maxChargeRange = (u) => 6 + Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0)) + (u.turn.disordered ? 0 : core.setupMove(u));
const say = (state, side, name, unit, extra = '') => state.log(`    ${state.armies[side].name} reacts: ${name}${unit ? ` (${unit.name})` : ''}${extra}`);

// ---------- Shooting Attacks ----------
/**
 * The Active Player has declared a Shooting Attack in the Shooting Phase. Returns
 * { target, cancel, ctx: {martyr, precisionMin}, martyrGroup, beforeStep11: [fn], after: [fn] }.
 */
function onShot(state, shooter, target) {
  const side = target.side;
  const out = { target, cancel: false, ctx: {}, beforeStep11: [], after: [] };
  if (state.reactionsLeft[side] <= 0) return out;
  const before = alive(target).slice();
  const base = incoming(state, shooter, target);
  const opts = [];
  const self = canReact(target) ? target : null;
  // Return Fire (Core, SHEET): before Step 11 (casualties still in place) the target makes a Shooting Attack back
  if (self) {
    const v = planVolley(target, shooter, state, { snap: core.snapOnly(target) }).expectedPts;
    opts.push({ name: 'Return Fire', unit: target, value: v, apply: () => out.beforeStep11.push(() => withModels(before, () => shoot(state, target, shooter, { reaction: true, models: before, label: 'Returns Fire' }))) });
  }
  if (self) {
    const buffOpt = (name, fx, mult, until, extra = 0) => ({ name, unit: target, value: (base - incoming(state, shooter, target, fx)) * mult + extra, apply: () => addBuff(target, fx, until) });
    if (mostTrait(target, 'Smokescreen')) opts.push(buffOpt('Smokescreen', { shrouded: 5 }, 1.3, 'phase'));
    if (mostTrait(target, 'Shield')) opts.push(buffOpt('Shieldwall!', { tough: 1 }, 1.2, 'phase'));
    if (allTrait(target, 'Space Wolves')) opts.push(buffOpt('Bestial Savagery', { fnp: 5 }, 1.3, 'phase'));
    if (allTrait(target, 'Death Guard') && !isVeh(target)) {
      const o = buffOpt('Barbaran Endurance', { fnp: 5 }, 1.3, 'phase', target.statuses.size * 15);
      const ap = o.apply; o.apply = () => { target.statuses.clear(); ap(); };
      opts.push(o);
    }
    // Brutal Tide (World Eaters, Legiones Astartes)
    if (allTrait(target, 'World Eaters') && !legions.hereticus(target) && !isVeh(target)) {
      const o = buffOpt('Brutal Tide', { ew: 1 }, 1.3, 'phase', ai.chargeChance(target, gap(target, shooter)) * ai.meleeEV(state, target, shooter) * 0.8);
      const ap = o.apply;
      o.apply = () => { ap(); out.after.push(() => { if (!target.destroyed && !shooter.destroyed && !target.lockedWith.size) reactionCharge(state, target, shooter, 'Brutal Tide'); }); };
      opts.push(o);
    }
    // Take Cover: move D6", then Shrouded (6+) for this attack; Shadow Veil: move I", then Shrouded (5+) for the phase
    if (has(target.rules, 'Take Cover') || state.reactionSet[side].has('Take Cover')) {
      opts.push({ name: 'Take Cover', unit: target, value: base * 0.25, apply: () => { dodge(state, shooter, target, state.dice.d6()); addBuff(target, { shrouded: 6 }, 'attack'); } });
    }
    if (allTrait(target, 'Raven Guard') && !isVeh(target)) {
      opts.push({ name: 'Shadow Veil', unit: target, value: (base - incoming(state, shooter, target, { shrouded: 5 })) * 1.3 + base * 0.2,
        apply: () => { dodge(state, shooter, target, num(alive(target)[0]?.p.I, 3)); addBuff(target, { shrouded: 5 }, 'phase'); } });
    }
    if (allTrait(target, 'Iron Warriors')) {
      // Bitter Fury: before Step 11, shoot back at full BS with +1 Firepower, even with the models just killed
      const v = planVolley(target, shooter, state, { fpBonus: 1 }).expectedPts;
      opts.push({ name: 'Bitter Fury', unit: target, value: v, apply: () => out.beforeStep11.push(() => withModels(before, () => shoot(state, target, shooter, { reaction: true, fpBonus: 1, models: before, label: 'answers with Bitter Fury' }))) });
    }
    if (allTrait(target, 'Blood Angels')) {
      const p = 1 - passChance(state, shooter, 'CL', 0);
      opts.push({ name: 'Wrath of Angels', unit: target, value: p * 20 + ai.meleeEV(state, target, shooter) * 0.3,
        apply: () => out.after.push(() => {
          if (target.destroyed || shooter.destroyed) return;
          require('./move.cjs').moveUnit(state, target, shooter, ai.moveOf(target));
          state.log(`    ${target.name} surges towards ${shooter.name} (Wrath of Angels)`);
          if (gap(target, shooter) <= 6) state.pendingMorale.push({ unit: shooter, type: 'Pinning', x: 0, from: target.name });
        }) });
    }
    if (allTrait(target, 'Word Bearers')) {
      // Glorious Martyrdom: the cheapest model soaks the most dangerous Fire Group
      const plan = planVolley(shooter, target, state, { stationary: !!shooter.turn.stationary });
      const byGroup = new Map();
      for (const p of plan.picks) byGroup.set(p.weapon.name, (byGroup.get(p.weapon.name) || 0) + p.e);
      const top = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0];
      const martyr = alive(target).find((m) => !m.sergeant) || alive(target)[0];
      if (top && martyr) {
        const v = (top[1] - martyr.maxWounds) * valuePerWound(target);
        opts.push({ name: 'Glorious Martyrdom', unit: target, value: v, apply: () => { out.martyrGroup = top[0]; out.ctx.martyr = martyr; } });
      }
    }
    if (allTrait(target, 'Alpha Legion')) {
      const plan = planVolley(shooter, target, state, { stationary: !!shooter.turn.stationary });
      const v = plan.picks.filter((p) => (xOf(p.weapon.specialRules, 'Precision') || 7) < 6).reduce((t, p) => t + p.e, 0) * valuePerWound(target) * 0.3;
      opts.push({ name: 'Smoke and Mirrors', unit: target, value: v, apply: () => { out.ctx.precisionMin = 6; } });
    }
  }
  // Living Shields (Rangdan): a collared Thrall unit within 3" takes the attack instead
  if (allTrait(target, 'Rangda') && !isVeh(target)) {
    for (const c of state.units) {
      if (c.side !== side || c === target || !canReact(c) || !has(c.rules, 'Neural Collars') || gap(c, target) > 3) continue;
      const v = base - incoming(state, shooter, c, null, { losOK: true });
      opts.push({ name: 'Living Shields', unit: c, value: v, apply: () => { out.target = c; out.losOK = true; } });
    }
  }
  // Retribution Strike (Ultramarines): another unit shoots the attacker before Step 11
  if (allTrait(target, 'Ultramarines')) {
    for (const r of state.units) {
      if (r.side !== side || r === target || !canReact(r) || r.lockedWith.size || !allTrait(r, 'Ultramarines') || !lineOfSight(state.table, r, shooter)) continue;
      const v = planVolley(r, shooter, state, {}).expectedPts;
      opts.push({ name: 'Retribution Strike', unit: r, value: v, apply: () => out.beforeStep11.push(() => shoot(state, r, shooter, { reaction: true, label: 'makes a Retribution Strike' })) });
    }
  }
  const pick = choose(state, side, opts);
  if (!pick) return out;
  say(state, side, pick.name, pick.unit);
  pick.apply();
  // a target that got out of sight or range can't be shot this phase (Shadow Veil) or this attack (Take Cover)
  if (out.target === target && !planVolley(shooter, target, state, {}).picks.length) { out.cancel = true; state.log(`    ${shooter.name} no longer has a shot at ${target.name}`); }
  return out;
}
/** Move a unit up to `reach` inches to where the shooter hurts it least. */
function dodge(state, shooter, u, reach) {
  const { moveUnit } = require('./move.cjs');
  let best = null;
  for (const p of ai.candidates(state, u, reach)) {
    const saved = { x: u.x, y: u.y };
    u.x = p.x; u.y = p.y;
    const v = planVolley(shooter, u, state, {}).expectedPts - 0.02 * ai.positionScore(state, u, p);
    u.x = saved.x; u.y = saved.y;
    if (!best || v < best.v) best = { p, v };
  }
  if (best) moveUnit(state, u, best.p, reach);
  state.log(`    ${u.name} moves to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
}
/** Let models killed in this attack shoot anyway (Return Fire, Bitter Fury use the models the unit started with). */
function withModels(models, fn) {
  const dead = models.filter((m) => m.wounds <= 0);
  const saved = dead.map((m) => m.wounds);
  for (const m of dead) m.wounds = 1;
  try { return fn(); } finally { dead.forEach((m, i) => { m.wounds = saved[i]; }); }
}
const shoot = (state, a, b, opts) => require('./shoot.cjs').shootingAttack(state, a, b, opts);

// ---------- moves ----------
/** An enemy unit ended a move in the Move Sub-Phase. */
function onMoved(state, mover) {
  const side = 1 - mover.side;
  if (state.reactionsLeft[side] <= 0) return;
  const { moveUnit } = require('./move.cjs');
  const opts = [];
  const moveOption = (name, u, reach, filter) => {
    const here = ai.positionScore(state, u, { x: u.x, y: u.y });
    let best = null;
    for (const p of ai.candidates(state, u, reach)) {
      if (filter && !filter(p)) continue;
      if (state.units.some((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn && Math.hypot(e.x - p.x, e.y - p.y) < e.r + u.r + 1)) continue;
      const v = ai.positionScore(state, u, p) - here;
      if (!best || v > best.v) best = { p, v };
    }
    if (best) opts.push({ name, unit: u, value: best.v, apply: () => { moveUnit(state, u, best.p, reach); state.log(`    ${u.name} moves to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`); } });
  };
  for (const u of state.units) {
    if (u.side !== side || !canReact(u) || u.lockedWith.size || u.statuses.has('Pinned')) continue;
    const g = gap(u, mover) + legions.rangePenalty(mover);
    const los = g <= 12 && lineOfSight(state.table, u, mover);
    // Reposition (Core): up to Initiative, if within 12" and in sight
    if (los) { const I = num(alive(u)[0]?.p.I, 0); if (I > 0) moveOption('Reposition', u, I); }
    // Chasing the Wind (White Scars): a normal move, no Rush
    if (los && allTrait(u, 'White Scars')) moveOption('Chasing the Wind', u, ai.moveOf(u));
    // The Hunt Closes (Rangdan): towards a statused enemy within 12", up to Movement, ending closer
    if (g <= 12 && mover.statuses.size && allTrait(u, 'Rangda') && alive(u).every((m) => /Infantry|Paragon/.test(m.unitType))) {
      const d0 = dist(u, mover);
      moveOption('The Hunt Closes', u, ai.moveOf(u), (p) => Math.hypot(p.x - mover.x, p.y - mover.y) < d0 - 0.5);
    }
    // Bastion of Fire (Imperial Fists): shoot a unit that ended a move within 10" and in sight
    if (g <= 10 && los && allTrait(u, 'Imperial Fists') && !isVeh(u)) {
      const v = planVolley(u, mover, state, {}).expectedPts;
      opts.push({ name: 'Bastion of Fire', unit: u, value: v, apply: () => shoot(state, u, mover, { reaction: true, label: 'holds the line (Bastion of Fire)' }) });
    }
  }
  const pick = choose(state, side, opts);
  if (!pick) return;
  say(state, side, pick.name, pick.unit);
  pick.apply();
}

// ---------- arrivals from Reserves ----------
const MOONFALL = { name: 'Moonfall', base: 'Moonfall', R: 999, FP: 1, RS: 8, AP: 3, D: 1, specialRules: ['Blast (3")', 'Pinning (1)'], traits: [] };
function onArrive(state, arrival) {
  const side = 1 - arrival.side;
  if (state.reactionsLeft[side] <= 0) return;
  const opts = [];
  for (const u of state.units) {
    if (u.side !== side || !canReact(u)) continue;
    // Intercept (Core, SHEET): Snap Shots at a unit arriving from Reserves; Vehicles use Defensive weapons
    const iv = planVolley(u, arrival, state, { snap: true, exclude: (w) => u.vehicle && !core.isDefensive(w) }).expectedPts;
    if (iv > 0) opts.push({ name: 'Intercept', unit: u, value: iv, apply: () => shoot(state, u, arrival, { snap: true, reaction: true, defensiveOnly: u.vehicle, label: 'Intercepts' }) });
    if (!available(state, side, 'Moonfall')) continue;
    const m = alive(u).find((x) => (x.traits || []).includes('Burning Sky') && /Command|Paragon/.test(x.unitType));
    if (!m || gap(u, arrival) > 18) continue;
    const g = rangedGroup(m, MOONFALL, arrival, {});
    const v = expectedGroup(g, arrival) * valuePerWound(arrival) + 8; // plus the Pinning check
    opts.push({ name: 'Moonfall', unit: u, value: v, apply: () => {
      const r = resolveGroup(Object.assign(g, { from: u }), arrival, { dice: state.dice, onKill: (x) => state.onCasualty && state.onCasualty(x, arrival, u) });
      state.log(`    Moonfall strikes ${arrival.name}: ${r.hits} hits, ${r.unsaved} unsaved, ${r.kills} killed`);
      for (const st of r.vehicleStatuses) require('./shoot.cjs').vehicleDamage(state, arrival, st);
      if (r.wounds > 0 && !arrival.destroyed) state.pendingMorale.push({ unit: arrival, type: 'Pinning', x: 1, from: 'Moonfall' });
      if (state.afterDamage) state.afterDamage(arrival);
    } });
  }
  const pick = choose(state, side, opts);
  if (!pick) return;
  say(state, side, pick.name, pick.unit);
  pick.apply();
}

// ---------- charges ----------
/**
 * The Active Player declared a charge from u at t. Returns the chosen reaction (or null) with the Charge step it
 * happens in: { name, step, apply(ctx) -> 'fail' | 'locked' | undefined, noVolley }.
 * Steps: 2 = after the declaration, 3 = before the Set-up Move, 3.5 = after it, 4 = before Volleys,
 * 4.5 = after Volleys.
 */
function onCharge(state, u, t) {
  const side = t.side;
  if (state.reactionsLeft[side] <= 0 || !canReact(t)) return null;
  const { fallBack, moveUnit } = require('./move.cjs');
  const hurt = ai.meleeEV(state, u, t);
  const back = ai.meleeEV(state, t, u);
  const opts = [];
  // Overwatch (Core, SHEET): a normal Shooting Attack at the charger instead of the target's Volley, so it's only
  // paid for if the charge gets to Step 4
  opts.push({ name: 'Overwatch', unit: t, step: 'volley', replacesVolley: true, deferred: true,
    value: planVolley(t, u, state, { snap: core.snapOnly(t) }).expectedPts - planVolley(t, u, state, { snap: true, exclude: (w) => !(w.traits || []).includes('Assault') }).expectedPts,
    apply: () => {
      if (state.reactionsLeft[side] <= 0 || !canReact(t)) return;
      spend(state, side, 'Overwatch', t); say(state, side, 'Overwatch', t);
      shoot(state, t, u, { reaction: true, label: 'fires Overwatch' });
    } });
  // The Choir Answers (Rangdan): the charger tests Cool with Fear; failing, it is Pinned and the charge fails
  if ((t.traits || []).includes('Silent Choir')) {
    const p = 1 - passChance(state, u, 'CL', 0);
    opts.push({ name: 'The Choir Answers', unit: t, step: 2, value: p * (hurt + 10),
      apply: () => { if (!check(state, u, 'CL', 0, 'The Choir Answers')) { addStatus(state, u, 'Pinned', 'The Choir Answers'); return 'fail'; } } });
  }
  // Twisted Desire (Emperor's Children, Legiones Hereticus): Stupefied, and Feel No Pain (5+) this Assault Phase
  if (allTrait(t, "Emperor's Children") && legions.hereticus(t)) {
    opts.push({ name: 'Twisted Desire', unit: t, step: 2, value: hurt * 0.33 + t.statuses.size * 10, apply: () => { addCondition(state, t, 'Stupefied'); addBuff(t, { fnp: 5 }, 'phase'); } });
  }
  // Perfect Counter (Emperor's Children, Legiones Astartes): after the Set-up Move, the target charges the charger
  // and takes the charge bonuses
  if (allTrait(t, "Emperor's Children") && !legions.hereticus(t)) {
    opts.push({ name: 'Perfect Counter', unit: t, step: 3.5, value: ai.chargeChance(t, Math.max(0, gap(u, t) - core.setupMove(u))) * 0.35 * (hurt + back),
      apply: () => (reactionCharge(state, t, u, 'Perfect Counter') ? 'locked' : undefined) });
  }
  // Spite of the Gorgon (Iron Hands): full-BS shooting with +1 Firepower before the Set-up Move; no Volley later
  if (allTrait(t, 'Iron Hands')) {
    opts.push({ name: 'Spite of the Gorgon', unit: t, step: 3, noVolley: true, value: planVolley(t, u, state, { fpBonus: 1 }).expectedPts,
      apply: () => { shoot(state, t, u, { reaction: true, fpBonus: 1, label: 'answers with Spite of the Gorgon' }); } });
  }
  // Selfless Burden (Salamanders): +1 WS, S and A this Assault Phase; a wound on each 1 in the Statuses Sub-Phase
  if (allTrait(t, 'Salamanders') && !isVeh(t)) {
    const gain = meleeIncoming(state, t, u, { attacks: 1, str: 1, ws: 1 }) - meleeIncoming(state, t, u) + (hurt - meleeIncoming(state, u, t, null, { ws: 1 }));
    opts.push({ name: 'Selfless Burden', unit: t, step: 3, value: gain - alive(t).length / 6 * valuePerWound(t) * 0.4,
      apply: () => { addBuff(t, { attacks: 1, str: 1, ws: 1 }, 'phase'); t.selflessBurden = true; } });
  }
  // Shieldwall!: +1 Toughness for the phase, declared before Volleys
  if (mostTrait(t, 'Shield')) {
    opts.push({ name: 'Shieldwall!', unit: t, step: 4, value: (hurt - meleeIncoming(state, u, t, null, { tough: 1 })) * 1.1, apply: () => addBuff(t, { tough: 1 }, 'phase') });
  }
  // Evade (Light Cavalry): after Volleys move up to I"; out of the charger's best possible roll, the charge fails
  if (alive(t).every((m) => /Cavalry/.test(m.unitType) && /Light/.test(m.unitType))) {
    const I = num(alive(t)[0]?.p.I, 3);
    const p = gap(u, t) + I > maxChargeRange(u) - core.setupMove(u) ? 0.8 : 0.2;
    opts.push({ name: 'Evade', unit: t, step: 4.5, value: p * hurt, apply: () => {
      const away = { x: t.x + (t.x - u.x), y: t.y + (t.y - u.y) };
      moveUnit(state, t, away, I);
      if (gap(u, t) > 6 + Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0))) { state.log(`    ${t.name} evades out of reach`); return 'fail'; }
    } });
  }
  // Better Part of Valour (Night Lords): Fall Back as if Routed, without becoming Routed
  if (allTrait(t, 'Night Lords')) {
    const I = num(alive(t)[0]?.p.I, 3);
    const toEdge = t.side === 0 ? t.y - t.r : H - t.y - t.r;
    const escape = 1 - ai.chargeChance(u, Math.max(0, gap(u, t) - core.setupMove(u)) + I + 3.5);
    opts.push({ name: 'Better Part of Valour', unit: t, step: 4.5, value: toEdge > I + 7 ? escape * hurt - (t.heldObjective ? ai.VP_WORTH : 0) : 0,
      apply: () => { fallBack(state, t); } });
  }
  // Furious Charge (World Eaters, Legiones Hereticus): if Volleys killed any of the target, it counter-charges,
  // Lost to the Nails
  if (allTrait(t, 'World Eaters') && legions.hereticus(t)) {
    const v = ai.chargeChance(t, Math.max(0, gap(u, t) - core.setupMove(u))) * 0.35 * (hurt + back) + back * 0.15;
    opts.push({ name: 'Furious Charge', unit: t, step: 4.5, deferred: true, value: v * 0.6,
      apply: (ctx) => {
        if (!ctx.volleyKills) return 'skip';
        spend(state, side, 'Furious Charge', t);
        say(state, side, 'Furious Charge', t);
        // ASSUMPTION: the text says the Target Unit becomes Lost to the Nails; read as the reacting unit
        addCondition(state, t, 'Lost to the Nails');
        return reactionCharge(state, t, u, 'Furious Charge') ? 'locked' : undefined;
      } });
  }
  const pick = choose(state, side, opts, 'assault');
  if (pick && !pick.deferred) say(state, side, pick.name, pick.unit);
  return pick;
}

// ---------- combats ----------
/** Vengeance of the First Legion: after the last Initiative Step, the Dark Angels fight the combat again. */
function vengeance(state, c, crp) {
  const side = 1 - state.active;
  if (!available(state, side, 'Vengeance of the First Legion') || state.reactionsLeft[side] <= 0) return null;
  const da = c[side].find((u) => !u.destroyed && canReact(u, true) && allTrait(u, 'Dark Angels'));
  if (!da) return null;
  const mine = c[side].filter((u) => !u.destroyed), theirs = c[1 - side].filter((u) => !u.destroyed);
  if (!theirs.length) return null;
  const give = mine.reduce((t, u) => t + Math.max(0, ...theirs.map((e) => ai.meleeEV(state, u, e))), 0);
  const take = theirs.reduce((t, e) => t + Math.max(0, ...mine.map((u) => ai.meleeEV(state, e, u))), 0);
  const losing = crp[side] < crp[1 - side] ? 25 : 0;
  const pick = choose(state, side, [{ name: 'Vengeance of the First Legion', unit: da, inCombat: true, value: give - take + losing }], 'assault');
  if (!pick) return null;
  say(state, side, pick.name, da);
  return true;
}
/** Heroic Intervention (Core, SHEET): if the Active Player declares no challenge, the Reactive Player may. */
function heroicIntervention(state, side, unit, edge) {
  if (!available(state, side, 'Heroic Intervention') || state.reactionsLeft[side] <= 0 || !canReact(unit, true)) return false;
  const pick = choose(state, side, [{ name: 'Heroic Intervention', unit, inCombat: true, value: edge * 25 }], 'assault');
  if (!pick) return false;
  say(state, side, 'Heroic Intervention', unit);
  return true;
}
/** Warrior Pride: a challenger with lower base WS than every eligible Son of Horus may be refused without disgrace. */
function warriorPride(state, challenger, candidates, side, duelValue) {
  if (!available(state, side, 'Warrior Pride') || state.reactionsLeft[side] <= 0) return false;
  const ws = num(challenger.m.p.WS, 4);
  const elig = candidates.filter((b) => allTrait(b.u, 'Sons of Horus'));
  if (!elig.length || !elig.every((b) => num(b.m.p.WS, 4) > ws)) return false;
  const unit = elig[0].u;
  if (!canReact(unit, true)) return false;
  const pick = choose(state, side, [{ name: 'Warrior Pride', unit, inCombat: true, value: duelValue < 0 ? 12 - duelValue * 10 : 0 }], 'assault');
  if (!pick) return false;
  say(state, side, 'Warrior Pride', unit, ': the challenge is refused without disgrace');
  return true;
}

module.exports = { setup, onShot, onMoved, onArrive, onCharge, vengeance, warriorPride, heroicIntervention, addBuff, clearBuffs, addCondition, refresh, meleeMods, canReact, allTrait, mostTrait, lockInto, LEGION_REACTIONS, ONCE_PER_BATTLE };
