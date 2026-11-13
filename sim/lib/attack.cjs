'use strict';
// Attack resolution: Hit Tests, Wound Tests or Armour Penetration, saves, Damage Mitigation and damage, for both
// Shooting Attacks and Strike Groups in combat. Rule wording follows the HH3 texts in data/bsdata/common.json.
const { num, save, xOf, argOf, has, rel, hitNeedBS, hitNeedWS, woundNeed } = require('./rules.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');

const STATUSES = ['Pinned', 'Suppressed', 'Stunned', 'Routed'];

/** Which model in the target takes the next wound: the defender's choice, or the attacker's for a Precision hit. */
function pickModel(target, precision) {
  const alive = target.models.filter((m) => m.wounds > 0);
  if (!alive.length) return null;
  if (precision) {
    // the attacker picks: a character or sergeant first, then the most valuable model
    return alive.find((m) => m.sergeant && !m.vehicle) || alive.reduce((b, m) => (m.maxWounds > b.maxWounds ? m : b), alive[0]);
  }
  // the defender keeps wounds on models that are already hurt, and protects sergeants and characters
  const hurt = alive.find((m) => m.wounds < m.maxWounds);
  if (hurt) return hurt;
  return alive.find((m) => !m.sergeant) || alive[0];
}

/** Facing of a vehicle hit from attacker position: front, side or rear armour. */
function armourFacing(target, from) {
  const p = target.models[0].p;
  if (p.SIDE == null && p.REAR == null) return num(p.FRONT, 10);
  const facing = target.facing ?? (target.side === 0 ? Math.PI / 2 : -Math.PI / 2);
  const ang = Math.atan2(from.y - target.y, from.x - target.x);
  let d = Math.abs(ang - facing) % (2 * Math.PI); if (d > Math.PI) d = 2 * Math.PI - d;
  if (d <= Math.PI / 4) return num(p.FRONT, 10);
  if (d >= (3 * Math.PI) / 4) return num(p.REAR ?? p.SIDE ?? p.FRONT, 10);
  return num(p.SIDE ?? p.FRONT, 10);
}

/**
 * Resolve one group of identical attacks (a Fire Group or Strike Group) against a unit.
 * g: { weapon, attacks, S, AP, D, hitNeed (or null for automatic hits), rules, melee, attackerModel, from, count }
 * ctx: { dice, statusesOnTarget, prey, cover, hatred, log }
 * Returns { hits, wounds, unsaved, damage, kills, naturalHits: [rolls], killedModels: [] }.
 */
function resolveGroup(g, target, ctx) {
  const { dice } = ctx;
  const rules = g.rules || [];
  const out = { hits: 0, wounds: 0, unsaved: 0, damage: 0, kills: 0, killed: [], shockRolls: 0, precisionHits: 0, vehicleStatuses: [], misfires: 0, used: 0 };
  const psychic = (g.weaponTraits || []).includes('Psychic'), immaterial = (g.weaponTraits || []).includes('Immaterial');
  const rend = xOf(rules, 'Rending'), breach = xOf(rules, 'Breaching'), shred = xOf(rules, 'Shred'), poison = xOf(rules, 'Poisoned');
  const precision = xOf(rules, 'Precision');
  let crit = xOf(rules, 'Critical Hit');
  if (ctx.preyCrit) crit = crit ? Math.min(crit, ctx.preyCrit) : ctx.preyCrit;
  if (g.bsCrit) crit = crit ? Math.min(crit, g.bsCrit) : g.bsCrit;
  const melta = xOf(rules, 'Melta');
  const inMelta = melta != null && ctx.range != null && ctx.range <= melta;
  const bane = has(rules, 'Armourbane') || inMelta;
  const murderous = xOf(rules, 'Murderous'), bypass = xOf(rules, 'Bypass');
  const vehicleTarget = target.models.some((m) => m.wounds > 0 && m.vehicle);
  for (let i = 0; i < g.attacks; i++) {
    const t = target.models.find((m) => m.wounds > 0);
    if (!t) break;
    out.used = i + 1; // attacks made before the target ran out (Violent Overkill passes the rest on)
    // Glorious Martyrdom: once the chosen model falls, the rest of the Fire Group is discarded
    if (ctx.martyr && ctx.martyr.wounds <= 0) break;
    // ---- hit ----
    let nat = 6;
    if (g.hitNeed != null) {
      nat = dice.d6();
      // Overload (X): an unmodified Hit Test of X or less is a Misfire, hit or miss (CONFIRMED)
      if (g.overload && nat <= g.overload) out.misfires++;
      if (nat < g.hitNeed) continue;
    }
    // Blast (X): one Hit Test, and every model under the marker takes a hit (CONFIRMED); a miss scatters away
    // (ASSUMPTION: a scattered marker hits nothing)
    for (let rep = 0; rep < (g.blastN || 1); rep++) {
      if (ctx.martyr && ctx.martyr.wounds <= 0) break;
      out.hits++;
      if (nat >= 5) out.shockRolls++;
      const isPrecision = precision && nat >= Math.max(precision, ctx.precisionMin || 0) && g.hitNeed != null;
      if (isPrecision) out.precisionHits++;
      const victim = ctx.martyr && ctx.martyr.wounds > 0 ? ctx.martyr : pickModel(target, isPrecision);
      if (!victim) break;
      // Anathema: Psychic Weapons have no effect on the model (CONFIRMED)
      if (psychic && has(victim.rules, 'Anathema')) continue;
      let autoWound = false, extraD = 0, wroll = 6;
      if (g.hitNeed != null && crit && nat >= crit) { autoWound = true; extraD = 1; } else if (g.hitNeed != null && rend && nat >= rend && !victim.vehicle) autoWound = true;
      // ---- vehicles: Armour Penetration ----
      if (victim.vehicle) {
        const av = armourFacing(target, g.from || target);
        const pen = g.S + dice.d6();
        const pens = pen > av || (bane && pen >= av);
        const glance = !pens && pen === av;
        if (!pens && !glance) continue;
        out.wounds++;
        // a vehicle's Invulnerable Save, including the Medusa Shroud's 5+ against shooting (Rangdan wargear)
        const vinv = Math.min(save(victim.p.INV), !g.melee && (victim.items || []).includes('Medusa Shroud') ? 5 : 7);
        if (vinv <= 6 && dice.d6() >= vinv) continue;
        const shr = Math.min(ctx.shrouded || 7, target.buff?.shrouded || 7, xOf(victim.rules, 'Shrouded') || 7);
        if (!g.melee && shr <= 6 && dice.d6() >= shr) continue;
        out.unsaved++;
        if (pens) {
          // a Penetrating Hit removes Hull Points equal to its Damage (doubled by Melta in range)
          applyDamage(victim, Math.max(1, (g.D + extraD) * (inMelta ? 2 : 1)), target, out, ctx);
        } else if (/Super-[Hh]eavy|Flyer/.test(victim.unitType)) {
          // Super-Heavy and Flyer: no roll on the Vehicle Damage Table, the model loses a single Hull Point
          applyDamage(victim, 1 + (has(victim.rules, 'Third-Line') ? 1 : 0), target, out, ctx);
        } else {
          // a Glancing Hit rolls on the Vehicle Damage Table (resolved at the end of the attack)
          out.vehicleStatuses.push(core.vehicleDamage(dice));
          if (has(victim.rules, 'Third-Line')) applyDamage(victim, 1, target, out, ctx);
        }
        continue;
      }
      // ---- wound ----
      if (!autoWound) {
        wroll = dice.d6();
        // The Gorgon's Scales (Iron Hands): -1 Strength to wound them with shooting
        const sPen = !g.melee && legions.is(target, 'Iron Hands') ? 1 : 0;
        let need = woundNeed(g.S - sPen, num(victim.p.T, 4) + (target.buff?.tough || 0));
        if (ctx.hatred) need = Math.max(2, need - 1);
        const ok = (need <= 6 && wroll >= need) || (poison && wroll >= poison);
        if (!ok) continue;
        // Promethean Endurance (Salamanders): an unmodified 1 or 2 never wounds them
        if (wroll <= 2 && legions.is(target, 'Salamanders')) continue;
        // Anathema: Immaterial weapons wound only on a 5+ (INFERRED from the rule's summary line)
        if (immaterial && has(victim.rules, 'Anathema') && wroll < 5) continue;
      }
      out.wounds++;
      let ap = g.AP;
      if (breach && wroll >= breach) ap = 2;
      if (shred && wroll >= shred) extraD += 1;
      const through = bypass && wroll >= bypass;
      // ---- save: the best of Armour, Invulnerable and Cover ----
      if (!through) {
        const arm = save(victim.p.SAV), inv = save(victim.p.INV);
        let best = Math.min(ap <= arm ? 7 : arm, inv);
        if (ctx.coverSave && !g.melee) best = Math.min(best, ctx.coverSave);
        if (best <= 6 && dice.d6() >= best) continue;
        // ---- damage mitigation: Feel No Pain, Shrouded against shooting ----
        const fnp = Math.min(xOf(victim.rules, 'Feel No Pain') || 7, target.buff?.fnp || 7, has(victim.rules, 'The Blood is Forever') ? ctx.outnumberFnp || 7 : 7, psychic ? xOf(victim.rules, 'Adamantium Will') || 7 : 7, has(victim.rules, 'Worm Gestalt') && !(g.weaponTraits || []).includes('Flame') && !has(rules, 'Aflame') ? 5 : 7,
          !g.melee ? Math.min(xOf(victim.rules, 'Shrouded') || 7, ctx.shrouded || 7, target.buff?.shrouded || 7) : 7);
        if (fnp <= 6 && dice.d6() >= fnp) continue;
      }
      out.unsaved++;
      const ew = murderous && wroll >= murderous ? 0 : Math.max(xOf(victim.rules, 'Eternal Warrior') || 0, target.buff?.ew || 0);
      const dmg = ew ? Math.max(1, g.D + extraD - ew) : g.D + extraD;
      applyDamage(victim, dmg, target, out, ctx);
    }
  }
  return out;
}

function applyDamage(model, dmg, unit, out, ctx) {
  const before = model.wounds;
  model.wounds = Math.max(0, model.wounds - dmg);
  out.damage += before - model.wounds;
  if (before > 0 && model.wounds === 0) {
    out.kills++;
    out.killed.push(model);
    if (ctx.onKill) ctx.onKill(model, unit);
  }
}

/** Build the attacks a model makes with a ranged weapon at a target (Heavy, Ordnance, Blast, Template handled here). */
function rangedGroup(model, w, target, opts) {
  const rules = w.specialRules || [];
  const stationary = opts.stationary;
  let FP = (num(w.FP, 1) + (opts.fpBonus || 0)) * (w.count || 1);
  let S = num(w.RS, 4), AP = num(w.AP, 7), D = Math.max(1, num(w.D, 1));
  let BS = num(model.p.BS, 4);
  // Fury of the Legion (Tactical Squads): a bolter gains Heavy (FP) for the attack (CONFIRMED)
  const heavy = argOf(rules, 'Heavy') || (has(model.rules, 'Fury of the Legion') && /^bolter$/i.test(w.base || w.name) ? 'FP' : null), ord = argOf(rules, 'Ordnance');
  if ((stationary || opts.heavyOK) && heavy) { if (heavy === 'FP') FP += 1; else if (heavy === 'S') S += 1; else if (heavy === 'D') D += 1; else if (heavy === 'AP') AP = Math.max(2, AP - 1); else if (heavy === 'BS') BS += 1; }
  if (stationary && ord) { if (ord === 'FP') FP *= 2; else if (ord === 'S') S *= 2; else if (ord === 'D') D *= 2; else if (ord === 'AP') AP = 2; }
  const aliveN = target.models.filter((m) => m.wounds > 0).length;
  const vehicleTarget = target.models.some((m) => m.wounds > 0 && m.vehicle);
  const bs = BS + (opts.bsMod || 0);
  let attacks = FP, hitNeed = hitNeedBS(bs), blastN = 0;
  const snap = !!opts.snap;
  // Snap Shots use their own column of the Hit Test table; BS 6+ scores Critical Hits, BS 10+ always does
  const bsCrit = snap ? null : core.bsCrit(bs);
  if (snap) hitNeed = core.snapHit(bs);
  else if (bsCrit === 1) hitNeed = 1;
  if (has(rules, 'Template')) {
    // a flame template catches several models of a packed unit
    attacks = FP * Math.min(aliveN, vehicleTarget ? 1 : 4);
    hitNeed = null;
  } else {
    // ASSUMPTION: a 3" marker covers 3 models of a packed unit, a 5" marker 5; a vehicle is one model
    const blast = xOf(rules, 'Blast');
    if (blast) blastN = Math.min(aliveN, vehicleTarget ? 1 : blast >= 5 ? 5 : 3);
  }
  return { weapon: w, attacks, blastN, S, AP, D, hitNeed, bsCrit: hitNeed == null ? null : bsCrit, snap, rules, melee: false, attackerModel: model, weaponTraits: w.traits || [] };
}

/** A model's melee attacks with a weapon (Impact on the charge, Reaping Blow when outnumbered). */
function meleeGroup(model, w, target, opts) {
  const rules = w.specialRules || [];
  let A = Math.max(1, rel(w.AM, num(model.p.A, 1)));
  let S = rel(w.SM, num(model.p.S, 4));
  let ws = num(model.p.WS, 4);
  if (opts.charged) {
    const imps = [argOf(model.rules, 'Impact'), argOf(rules, 'Impact')].filter(Boolean);
    for (const x of imps) { if (x === 'A' || x === 'AM') A += 1; else if (x === 'S' || x === 'SM') S += 1; else if (x === 'WS') ws += 1; }
  }
  if (opts.mods) { A += opts.mods.attacks || 0; S += opts.mods.str || 0; ws += opts.mods.ws || 0; }
  // Disgraced: the model's Weapon Skill is halved (SHEET)
  if (model.disgraced) ws = Math.floor(ws / 2);
  const reap = Math.max(xOf(model.rules, 'Reaping Blow') || 0, xOf(rules, 'Reaping Blow') || 0);
  if (reap && opts.outnumbered) A += reap;
  const def = target.models.find((m) => m.wounds > 0) || target.models[0];
  // Ravening Madmen (Red Butchers): Hit Tests against the unit count its Weapon Skill as 3 (CONFIRMED)
  const defWS = has(target.rules || [], 'Ravening Madmen') ? 3 : Math.floor((num(def.p.WS, 4) + (target.buff?.ws || 0)) / (def.disgraced ? 2 : 1));
  return { weapon: w, attacks: A, S, AP: num(w.AP, 7), D: Math.max(1, num(w.D, 1)), hitNeed: hitNeedWS(ws, defWS), rules, melee: true, attackerModel: model, weaponTraits: w.traits || [] };
}

/** Expected unsaved damage of one group against a unit, for the AI to compare weapons and targets. */
function expectedGroup(g, target, ctx = {}) {
  const t = target.models.find((m) => m.wounds > 0);
  if (!t) return 0;
  const pHit = (g.hitNeed == null ? 1 : Math.max(0, (7 - Math.max(1, g.hitNeed)) / 6)) * (g.blastN || 1);
  // share of hits that are Critical Hits (they wound automatically with +1 Damage)
  let crit = xOf(g.rules, 'Critical Hit');
  if (ctx.preyCrit) crit = crit ? Math.min(crit, ctx.preyCrit) : ctx.preyCrit;
  if (g.bsCrit) crit = crit ? Math.min(crit, g.bsCrit) : g.bsCrit;
  const pCrit = g.hitNeed == null || !crit ? 0 : Math.min(1, (7 - Math.max(crit, g.hitNeed)) / (7 - Math.max(1, g.hitNeed)));
  if (t.vehicle) {
    const av = num(t.p.SIDE ?? t.p.FRONT, 10);
    let p = 0; for (let r = 1; r <= 6; r++) if (g.S + r > av || (has(g.rules, 'Armourbane') && g.S + r >= av)) p += 1 / 6; else if (g.S + r === av) p += 0.5 / 6;
    const shr = g.melee ? 7 : Math.min(xOf(t.rules, 'Shrouded') || 7, target.buff?.shrouded || 7);
    const vinv = Math.min(save(t.p.INV), !g.melee && (t.items || []).includes('Medusa Shroud') ? 5 : 7);
    return g.attacks * pHit * p * Math.min(g.D, num(t.p.HP, 1)) * (shr <= 6 ? (shr - 1) / 6 : 1) * (vinv <= 6 ? (vinv - 1) / 6 : 1);
  }
  const need = woundNeed(g.S - (!g.melee && legions.is(target, 'Iron Hands') ? 1 : 0), num(t.p.T, 4) + (target.buff?.tough || 0));
  const breach = xOf(g.rules, 'Breaching'), poison = xOf(g.rules, 'Poisoned');
  const arm = save(t.p.SAV), inv = save(t.p.INV);
  const sal = legions.is(target, 'Salamanders');
  let e = 0;
  for (let r = 1; r <= 6; r++) {
    if (!((need <= 6 && r >= need) || (poison && r >= poison))) continue;
    if (sal && r <= 2) continue;
    const ap = breach && r >= breach ? 2 : g.AP;
    let sv = Math.min(ap <= arm ? 7 : arm, inv);
    if (ctx.coverSave && !g.melee) sv = Math.min(sv, ctx.coverSave);
    e += (1 / 6) * (sv <= 6 ? (sv - 1) / 6 : 1);
  }
  const fnp = Math.min(xOf(t.rules, 'Feel No Pain') || 7, target.buff?.fnp || 7, has(t.rules, 'Worm Gestalt') ? 5 : 7, !g.melee ? Math.min(xOf(t.rules, 'Shrouded') || 7, target.buff?.shrouded || 7) : 7);
  const ew = Math.max(xOf(t.rules, 'Eternal Warrior') || 0, target.buff?.ew || 0);
  const dmg = (x) => Math.min(num(t.p.W, 1), ew ? Math.max(1, x - ew) : x);
  // a Critical Hit skips the Wound Test (its natural roll counts as the wound roll for Breaching)
  const apC = breach && breach <= 6 ? 2 : g.AP;
  let svC = Math.min(apC <= arm ? 7 : arm, inv);
  if (ctx.coverSave && !g.melee) svC = Math.min(svC, ctx.coverSave);
  const eC = svC <= 6 ? (svC - 1) / 6 : 1;
  const mit = fnp <= 6 ? (fnp - 1) / 6 : 1;
  return g.attacks * pHit * ((1 - pCrit) * e * dmg(g.D) + pCrit * eC * dmg(g.D + 1)) * mit;
}

module.exports = { STATUSES, resolveGroup, rangedGroup, meleeGroup, expectedGroup, pickModel, armourFacing };
