'use strict';
// Attack resolution: Hit Tests, Wound Tests or Armour Penetration, saves, Damage Mitigation and damage, for both
// Shooting Attacks and Strike Groups in combat. Rule wording follows the HH3 texts in data/bsdata/common.json.
const { num, save, xOf, argOf, has, rel, hitNeedBS, hitNeedWS, woundNeed } = require('./rules.cjs');

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
  const out = { hits: 0, wounds: 0, unsaved: 0, damage: 0, kills: 0, killed: [], shockRolls: 0, precisionHits: 0 };
  const rend = xOf(rules, 'Rending'), breach = xOf(rules, 'Breaching'), shred = xOf(rules, 'Shred'), poison = xOf(rules, 'Poisoned');
  const precision = xOf(rules, 'Precision');
  let crit = xOf(rules, 'Critical Hit');
  if (ctx.preyCrit) crit = crit ? Math.min(crit, ctx.preyCrit) : ctx.preyCrit;
  const bane = has(rules, 'Armourbane');
  const vehicleTarget = target.models.some((m) => m.wounds > 0 && m.vehicle);
  for (let i = 0; i < g.attacks; i++) {
    const t = target.models.find((m) => m.wounds > 0);
    if (!t) break;
    // ---- hit ----
    let nat = 6;
    if (g.hitNeed != null) {
      nat = dice.d6();
      if (nat < g.hitNeed && !(g.snap && nat === 6)) continue;
    }
    out.hits++;
    if (nat >= 5) out.shockRolls++;
    const isPrecision = precision && nat >= precision && g.hitNeed != null;
    if (isPrecision) out.precisionHits++;
    const victim = pickModel(target, isPrecision);
    if (!victim) break;
    let autoWound = false, extraD = 0, wroll = 6;
    if (g.hitNeed != null && crit && nat >= crit) { autoWound = true; extraD = 1; } else if (g.hitNeed != null && rend && nat >= rend && !victim.vehicle) autoWound = true;
    // ---- vehicles: Armour Penetration ----
    if (victim.vehicle) {
      const av = armourFacing(target, g.from || target);
      const pen = g.S + dice.d6();
      let pens = pen > av || (bane && pen >= av);
      const glance = !pens && pen === av;
      if (!pens && !glance) continue;
      out.wounds++;
      const dmg = pens ? Math.max(1, g.D + extraD) : 1;
      // penetrating hits use the weapon's Damage; a glancing hit costs one Hull Point
      applyDamage(victim, dmg, target, out, ctx);
      out.unsaved++;
      continue;
    }
    // ---- wound ----
    if (!autoWound) {
      wroll = dice.d6();
      let need = woundNeed(g.S, num(victim.p.T, 4));
      if (ctx.hatred) need = Math.max(2, need - 1);
      const ok = (need <= 6 && wroll >= need) || (poison && wroll >= poison);
      if (!ok) continue;
    }
    out.wounds++;
    let ap = g.AP;
    if (breach && wroll >= breach) ap = 2;
    if (shred && wroll >= shred) extraD += 1;
    // ---- save ----
    const arm = save(victim.p.SAV), inv = save(victim.p.INV);
    let best = Math.min(ap <= arm ? 7 : arm, inv);
    if (ctx.coverSave && !g.melee) best = Math.min(best, ctx.coverSave);
    if (best <= 6 && dice.d6() >= best) continue;
    // ---- damage mitigation: Feel No Pain, Shrouded against shooting ----
    const fnp = Math.min(xOf(victim.rules, 'Feel No Pain') || 7, has(victim.rules, 'Worm Gestalt') && !(g.weaponTraits || []).includes('Flame') && !has(rules, 'Aflame') ? 5 : 7,
      !g.melee ? (xOf(victim.rules, 'Shrouded') || 7) : 7);
    if (fnp <= 6 && dice.d6() >= fnp) continue;
    out.unsaved++;
    const ew = xOf(victim.rules, 'Eternal Warrior');
    const dmg = ew ? Math.max(1, g.D + extraD - ew) : g.D + extraD;
    applyDamage(victim, dmg, target, out, ctx);
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
  let FP = num(w.FP, 1) * (w.count || 1);
  let S = num(w.RS, 4), AP = num(w.AP, 7), D = Math.max(1, num(w.D, 1));
  let BS = num(model.p.BS, 4);
  const heavy = argOf(rules, 'Heavy'), ord = argOf(rules, 'Ordnance');
  if (stationary && heavy) { if (heavy === 'FP') FP += 1; else if (heavy === 'S') S += 1; else if (heavy === 'D') D += 1; else if (heavy === 'AP') AP = Math.max(2, AP - 1); else if (heavy === 'BS') BS += 1; }
  if (stationary && ord) { if (ord === 'FP') FP *= 2; else if (ord === 'S') S *= 2; else if (ord === 'D') D *= 2; else if (ord === 'AP') AP = 2; }
  const aliveN = target.models.filter((m) => m.wounds > 0).length;
  const vehicleTarget = target.models.some((m) => m.wounds > 0 && m.vehicle);
  let attacks = FP, hitNeed = hitNeedBS(BS + (opts.bsMod || 0));
  const snap = !!opts.snap;
  if (snap) hitNeed = 6;
  if (has(rules, 'Template')) {
    // a flame template catches several models of a packed unit
    attacks = FP * Math.min(aliveN, vehicleTarget ? 1 : 4);
    hitNeed = null;
  } else {
    const blast = xOf(rules, 'Blast');
    if (blast) attacks = FP * Math.min(aliveN, vehicleTarget ? 1 : blast >= 5 ? 5 : 3);
  }
  return { weapon: w, attacks, S, AP, D, hitNeed, snap, rules, melee: false, attackerModel: model, weaponTraits: w.traits || [] };
}

/** A model's melee attacks with a weapon (Impact on the charge, Reaping Blow when outnumbered). */
function meleeGroup(model, w, target, opts) {
  const rules = [...(w.specialRules || [])];
  let A = Math.max(1, rel(w.AM, num(model.p.A, 1)));
  let S = rel(w.SM, num(model.p.S, 4));
  let ws = num(model.p.WS, 4);
  if (opts.charged) {
    const imps = [argOf(model.rules, 'Impact'), argOf(rules, 'Impact')].filter(Boolean);
    for (const x of imps) { if (x === 'A' || x === 'AM') A += 1; else if (x === 'S' || x === 'SM') S += 1; else if (x === 'WS') ws += 1; }
  }
  const reap = Math.max(xOf(model.rules, 'Reaping Blow') || 0, xOf(rules, 'Reaping Blow') || 0);
  if (reap && opts.outnumbered) A += reap;
  const defWS = num((target.models.find((m) => m.wounds > 0) || target.models[0]).p.WS, 4);
  return { weapon: w, attacks: A, S, AP: num(w.AP, 7), D: Math.max(1, num(w.D, 1)), hitNeed: hitNeedWS(ws, defWS), rules, melee: true, attackerModel: model, weaponTraits: w.traits || [] };
}

/** Expected unsaved damage of one group against a unit, for the AI to compare weapons and targets. */
function expectedGroup(g, target, ctx = {}) {
  const t = target.models.find((m) => m.wounds > 0);
  if (!t) return 0;
  const pHit = g.hitNeed == null ? 1 : Math.max(0, (7 - g.hitNeed) / 6);
  if (t.vehicle) {
    const av = num(t.p.SIDE ?? t.p.FRONT, 10);
    let p = 0; for (let r = 1; r <= 6; r++) if (g.S + r > av || (has(g.rules, 'Armourbane') && g.S + r >= av)) p += 1 / 6; else if (g.S + r === av) p += 0.5 / 6;
    return g.attacks * pHit * p * Math.min(g.D, num(t.p.HP, 1));
  }
  const need = woundNeed(g.S, num(t.p.T, 4));
  const breach = xOf(g.rules, 'Breaching'), poison = xOf(g.rules, 'Poisoned');
  const arm = save(t.p.SAV), inv = save(t.p.INV);
  let e = 0;
  for (let r = 1; r <= 6; r++) {
    if (!((need <= 6 && r >= need) || (poison && r >= poison))) continue;
    const ap = breach && r >= breach ? 2 : g.AP;
    let sv = Math.min(ap <= arm ? 7 : arm, inv);
    if (ctx.coverSave && !g.melee) sv = Math.min(sv, ctx.coverSave);
    e += (1 / 6) * (sv <= 6 ? (sv - 1) / 6 : 1);
  }
  const fnp = Math.min(xOf(t.rules, 'Feel No Pain') || 7, has(t.rules, 'Worm Gestalt') ? 5 : 7, !g.melee ? (xOf(t.rules, 'Shrouded') || 7) : 7);
  const ew = xOf(t.rules, 'Eternal Warrior');
  const d = Math.min(num(t.p.W, 1), ew ? Math.max(1, g.D - ew) : g.D);
  return g.attacks * pHit * e * (fnp <= 6 ? (fnp - 1) / 6 : 1) * d;
}

module.exports = { STATUSES, resolveGroup, rangedGroup, meleeGroup, expectedGroup, pickModel, armourFacing };
