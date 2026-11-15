'use strict';
// The Assault Phase: Charge Sub-Phase (the five-step charge), Challenge Sub-Phase (rounds of Face-Off, Focus
// Roll and Strike, then Glory), Fight Sub-Phase (Initiative Steps) and Resolution Sub-Phase (Combat Resolution,
// Panic Checks and the aftermath: Fall Back, Pursue, Gun Down, Disengage, Hold, Consolidate).
// Procedure from the HH3 rule texts in the repo and the How to Play quick reference (SHEET in core.cjs).
const { num, xOf, argOf, has, rel } = require('./rules.cjs');
const { resolveGroup, meleeGroup, expectedGroup, rangedGroup } = require('./attack.cjs');
const { planVolley } = require('./fire.cjs');
const { shootingAttack, moraleSubPhase, preyCrit, forceCheck, vehicleDamage } = require('./shoot.cjs');
const gambits = require('./gambits.cjs');
const psychic = require('./psychic.cjs');
const { gap, dist, lineOfSight } = require('./table.cjs');
const { alive, check, addStatus, passChance, statusCheck } = require('./checks.cjs');
const { moveUnit, fallBack, chargeRoute, dangerousTerrain } = require('./move.cjs');
const { along } = require('./path.cjs');
const { footprint } = require('./army.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const { canReact, meleeMods: buffMods, lockInto } = require('./reactions.cjs');
const legions = require('./legions.cjs');
// Violence Incarnate and Flawless Execution last "until the end of the Phase" of the charge (CONFIRMED), so a charge
// made in the Shooting Phase (Brutal Tide, Bestial Savagery: reactions.cjs marks it) gives them nothing in the Assault
// Phase; Encarmine Fury lasts until the end of the Turn, so it still does
const chargedThisPhase = (u) => !!u.turn?.charged && u.turn.chargePhase !== 'shooting';
/**
 * Melee modifiers for a unit: reaction and condition buffs, plus Legion Tacticas: Violence Incarnate (World Eaters,
 * +1 A) in the phase they charged and Encarmine Fury (Blood Angels, +1 S) on a turn they charged; A Talent for Murder
 * (Night Lords, +1 WS) against units with a Tactical Status.
 */
function meleeMods(u) {
  const m = Object.assign({ attacks: 0, str: 0, ws: 0 }, buffMods(u) || {});
  if (chargedThisPhase(u) && legions.tactica(u, 'World Eaters')) m.attacks += 1;
  if (u.turn?.charged && legions.is(u, 'Blood Angels')) m.str += 1;
  if (legions.is(u, 'Night Lords') && [...u.lockedWith].some((e) => !e.destroyed && e.statuses.size)) m.ws += 1;
  return m;
}
// Death Dealers (Sons of Horus): Volleys at full Ballistic Skill
const volleySnap = (u) => !has(u.rules, 'Firestorm') && !legions.is(u, 'Sons of Horus');

// ---------- Charge Sub-Phase ----------
/** Make a charge from u at t. Returns true if the units end Locked in Combat. */
function charge(state, u, t) {
  // SHEET: a unit with any Tactical Status, or that disembarked, makes a Disordered Charge: no Set-up Move, no Volley
  const disordered = !!u.turn.disordered || u.statuses.size > 0;
  state.log(`  ${u.name} declares a charge at ${t.name} (${gap(u, t).toFixed(1)}" away${disordered ? ', Disordered' : ''})`);
  const locked = chargeSteps(state, u, t, disordered);
  // ASSUMPTION: checks from a reaction's Shooting Attack (Overwatch) are taken straight after the charge
  if (state.pendingMorale.length) moraleSubPhase(state);
  return locked;
}
function chargeSteps(state, u, t, disordered) {
  // the target's reaction, if any, and the step of the charge it happens in (reactions.cjs)
  const pick = state.reactions ? state.reactions.onCharge(state, u, t) : null;
  const ctx = { volleyKills: 0 };
  const at = (step) => (pick && pick.step === step ? pick.apply(ctx) : undefined);
  // Step 2: The Choir Answers, Twisted Desire
  if (at(2) === 'fail' || u.destroyed || t.destroyed) return false;
  // Step 3: Spite of the Gorgon, Selfless Burden; then the Set-up Move. Reaching base contact completes the charge
  at(3);
  if (u.destroyed || t.destroyed) return false;
  // the shortest route into contact, round Impassable Terrain and other units (move.cjs chargeRoute), found once: the
  // Set-up Move follows it and the Charge Move carries on along it (re-finding it part-way could only lengthen it on
  // the 1" grid, or lose it hugging a unit). Found again only if something moved off it (the target, or a reaction)
  let way = chargeRoute(state, u, t);
  const anchor = { tx: t.x, ty: t.y, ux: u.x, uy: u.y };
  let gone = 0;
  if (!disordered) {
    // Templar Assault: +2" after getting out of an Assault Vehicle; Cloaked in Murder: +1" (to 6") against a unit
    // already locked in combat (CONFIRMED)
    let s = core.setupMove(u) + (u.cond?.has('Lost to the Nails') ? 1 : 0) + (has(u.rules, 'Templar Assault') && u.turn.disembarked && !u.turn.disordered ? 2 : 0);
    if (has(u.rules, 'Cloaked in Murder') && t.lockedWith.size) s = Math.max(s, Math.min(6, s + 1));
    // Lies and Obfuscation: an Alpha Legion target counts as 2" further away
    if (s >= way.len + legions.rangePenalty(t)) { lockInto(state, u, t, `reaches ${t.name} with its Set-up Move`, way); return true; }
    if (way.len < Infinity) {
      const pts = way.pts || [{ x: u.x, y: u.y }, { x: way.x, y: way.y }];
      const p = along(pts, s);
      dangerousTerrain(state, u, [{ x: u.x, y: u.y }, p]);
      if (u.destroyed) return false;
      u.x = p.x; u.y = p.y; gone = s;
      anchor.ux = u.x; anchor.uy = u.y;
    }
  }
  if (at(3.5) === 'locked') return true; // Perfect Counter
  // Step 4: Shieldwall!, Warpath; Volley Attacks (Snap Shots, Assault weapons only, never statuses): the charger,
  // then the target, whose Overwatch replaces its Volley with a normal Shooting Attack
  at(4);
  const warpath = psychic.onChargeStep4(state, u, t);
  const before = alive(t).length;
  // neither unit volleys when the target is already Locked in Combat (CONFIRMED)
  if (!disordered && !warpath && !t.lockedWith.size && alive(u).some((m) => m.ranged.length)) shootingAttack(state, u, t, { snap: volleySnap(u), assaultOnly: true, volley: true, label: 'volleys' });
  if (t.destroyed) return false;
  ctx.volleyKills = before - alive(t).length;
  if (pick?.replacesVolley) pick.apply(ctx);
  // a target already Locked in Combat makes no Volley (a Volley is a Shooting Attack; INFERRED)
  else if (!pick?.noVolley && !t.lockedWith.size && alive(t).some((m) => m.ranged.length)) shootingAttack(state, t, u, { snap: volleySnap(t), assaultOnly: true, volley: true, label: 'volleys' });
  if (u.destroyed || t.destroyed) return false;
  // end of Step 4: Evade, Better Part of Valour, Furious Charge
  const r4 = at(4.5);
  if (r4 === 'fail' || t.destroyed || u.destroyed) return false;
  if (r4 === 'locked') return true;
  // Step 5: Charge Roll (2D6, keep the highest, plus Fast), then the Charge Move, which must reach base contact by
  // the shortest route round what's in the way (CONFIRMED)
  const moved = t.x !== anchor.tx || t.y !== anchor.ty || u.x !== anchor.ux || u.y !== anchor.uy;
  if (moved || way.len === Infinity) way = chargeRoute(state, u, t);
  else way = { ...way, len: Math.max(0, way.len - gone) };
  const need = way.len + legions.rangePenalty(t);
  const roll = core.chargeRoll(u, state.dice);
  const round = way.pts ? ', round what is in the way' : '';
  // a Disordered Charge never gains bonuses for having Charged (CONFIRMED: Impact, the Legion charge Tacticas)
  if (roll >= need) { lockInto(state, u, t, `charge roll ${roll} (needed ${need.toFixed(1)}"${round})`, way); if (disordered) u.turn.charged = false; return true; }
  state.log(`    charge roll ${roll} (needed ${need < Infinity ? need.toFixed(1) + '"' : 'a way through'}${round}): the charge fails`);
  // a failed charge forces a Cool Check (CONFIRMED); failing gives Stunned (SHEET)
  // (statusCheck: Heavy units get +1 Cool to avoid a status, CONFIRMED)
  if (!statusCheck(state, u, core.failedChargeStatus, 0, 'failed charge')) addStatus(state, u, core.failedChargeStatus, 'failed charge');
  return false;
}

function chargeSubPhase(state, side) {
  const units = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn && !u.lockedWith.size);
  // the most dangerous chargers go first
  const foes = state.units.filter((e) => e.side !== side && !e.destroyed);
  units.sort((a, b) => ai.meleeValue(state, b, foes) - ai.meleeValue(state, a, foes));
  for (const u of units) {
    if (u.destroyed || u.lockedWith.size) continue;
    // Lost to the Nails: must charge the closest enemy within 12", or the condition ends (CONFIRMED)
    if (u.cond?.has('Lost to the Nails')) {
      const near = state.units.filter((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn && gap(u, e) <= 12).sort((a, b) => gap(u, a) - gap(u, b));
      if (near.length && ai.canCharge(u)) { charge(state, u, near[0]); continue; }
      if (!near.length) { u.cond.delete('Lost to the Nails'); require('./reactions.cjs').refresh(u); }
    }
    let t = ai.chooseCharge(state, u);
    // Long Hunt war-moon: within 12" of an enemy it can see, it must charge if it can
    if (!t && ai.canCharge(u) && !u.turn.rushed && !u.turn.noCharge && alive(u).every((m) => (m.traits || []).includes('Long Hunt'))) {
      const near = state.units.filter((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn && !/Flyer/.test(e.unitType) && gap(u, e) <= 12 && lineOfSight(state.table, u, e)).sort((a, b) => gap(u, a) - gap(u, b));
      if (near.length) { t = near[0]; state.log(`  ${u.name} must charge (Long Hunt)`); }
    }
    if (t) charge(state, u, t);
  }
}

// ---------- combats ----------
/** Group locked units into separate combats. */
function combats(state) {
  const seen = new Set(), out = [];
  for (const u of state.units) {
    if (u.destroyed || !u.lockedWith.size || seen.has(u)) continue;
    const c = [[], []];
    const stack = [u];
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x) || x.destroyed) continue;
      seen.add(x); c[x.side].push(x);
      for (const y of x.lockedWith) if (!seen.has(y)) stack.push(y);
    }
    if (c[0].length && c[1].length) out.push(c);
  }
  return out;
}
// models for outnumbering in Combat Resolution: Walkers and Paragons count their Wounds (CONFIRMED), every other model
// counts 1 (Bulky (X) is for Transport Capacity and Reaping Blow only, CONFIRMED by their texts)
const modelCount = (units) => units.reduce((t, u) => t + alive(u).reduce((s, m) => s + (/Walker|Paragon/.test(m.unitType) ? num(m.p.W, 1) : 1), 0), 0);
const canChallenge = (m) => /Command|Champion|Paragon/.test(m.unitType) && !m.vehicle;
// Flawless Execution (Emperor's Children): +1 Combat Initiative in the phase they charged
const combatInitiative = (unit, m, w) => (unit.statuses.size && core.status.anyFightsAtI1 ? 1 : rel(w.IM, num(m.p.I, 1)) + (chargedThisPhase(unit) && legions.tactica(unit, "Emperor's Children") ? 1 : 0));
/** The melee weapon a model does most with against a target, and its expected damage ({ w, v }). */
function weaponFor(m, target) {
  let best = m.melee.find((w) => target.vehicle || !has(w.specialRules, 'Detonation')) || m.melee[0], bv = -1;
  for (const w of m.melee) {
    if (has(w.specialRules, 'Detonation') && !target.vehicle) continue;
    const v = expectedGroup(meleeGroup(m, w, target, {}), target);
    if (v > bv) { bv = v; best = w; }
  }
  return { w: best, v: Math.max(0, bv) };
}
const bestWeapon = (m, target) => weaponFor(m, target).w;

// ---------- Engaged models ----------
// Only Engaged models attack in an Initiative Step: those in Base Contact with an enemy model of the combat, or within
// 2" of a model of their own unit that is, after a Pile-in Move of up to their Initiative (CONFIRMED, p265-266). Units
// are circles here with no model positions, so how many of a unit's models are Engaged is estimated (ASSUMPTION):
// - locked units count as touching: the charge and every Pile-in Move close them up again, though the footprints
//   shrink as models fall;
// - a model stands Engaged with its centre up to three base radii plus 2" from the enemy footprint's edge (a front
//   rank in Base Contact, then 2" behind the backs of their bases), and a Pile-in Move reaches that band from its
//   Initiative further back;
// - the unit's models are spread evenly over its footprint, so the share that can reach the band is the share of
//   its disc within that distance of the enemy disc;
// - the band holds only so many bases: the part of it within the unit's Pile-in reach, at the packing of a deployed
//   unit (army.cjs footprint);
// - a unit locked with several enemy units has each model Engaged with one or another independently;
// - the controlling player puts the models that fight best in front, so those are the Engaged ones.
/** Area where two discs (radii r1, r2, centres d apart) overlap. */
function lensArea(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const b = r2 * r2 * Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  return a + b - 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
}
// a model's base radius (army.cjs footprint of the model alone), remembered on the model
const baseOf = (m) => m.br ?? (m.br = footprint({ models: [Object.assign({}, m, { wounds: 1 })] }));
const majorityOf = (vals) => { const n = new Map(); let best = null, c = -1; for (const v of vals) n.set(v, (n.get(v) || 0) + 1); for (const [v, k] of n) if (k > c || (k === c && v > best)) { best = v; c = k; } return best; };
/** How many of unit u's n models (ms) can be Engaged with enemy unit e. */
function engageable(u, ms, e) {
  const n = ms.length;
  if (!n || e.destroyed || !alive(e).length) return 0;
  const br = majorityOf(ms.map(baseOf)), I = Math.max(0, majorityOf(ms.map((m) => num(m.p.I, 1))));
  const R = Math.max(u.r, br), Rb = Math.max(e.r, 0.5), d = R + Rb, band = 3 * br + 2;
  const share = d + R <= Rb + band + I ? 1 : lensArea(R, Rb + band + I, d) / (Math.PI * R * R);
  const room = (lensArea(Rb + band, R + I, d) - lensArea(Rb, R + I, d)) / (Math.PI * (br + 0.3) ** 2 * 1.1025);
  return Math.min(n * share, room);
}
/**
 * The Engaged models of each unit in a combat. ranks: Map unit -> { order: its locked enemy units, the one it hurts
 * most first; list: [{ m, v }] its models that can attack, best first }. Returns Map model -> the enemy unit it
 * attacks, and Map unit -> [engaged, of]. A model goes to the first enemy unit in the unit's order that still has
 * room for it among the models Engaged with that unit.
 */
function engagedModels(ranks) {
  const target = new Map(), count = new Map();
  for (const [u, { order, list }] of ranks) {
    if (u.destroyed) continue;
    const ms = list.filter((s) => s.m.wounds > 0 && !s.m.inChallenge);
    const foes = order.filter((e) => !e.destroyed && alive(e).length);
    if (!ms.length || !foes.length) continue;
    const n = ms.length, models = ms.map((s) => s.m);
    let miss = 1;
    const per = foes.map((e) => { const k = engageable(u, models, e); miss *= 1 - Math.min(1, k / n); return k; });
    const total = Math.min(n, Math.max(1, Math.round(n * (1 - miss))));
    count.set(u, [total, n]);
    let i = 0;
    for (let f = 0; f < foes.length && i < total; f++) for (let j = Math.min(Math.round(per[f]), total - i); j > 0; j--) target.set(ms[i++].m, foes[f]);
    while (i < total) target.set(ms[i++].m, foes[0]);
  }
  return { target, count };
}
/** Each unit's models that can attack in combat c, best fighters first, with the weapon each declares for the round. */
function rankFighters(state, c) {
  const ranks = new Map();
  for (const side of [0, 1]) for (const u of c[side]) {
    if (u.destroyed) continue;
    const foes = [...u.lockedWith].filter((e) => !e.destroyed);
    if (!foes.length) continue;
    // each unit attacks the locked enemy unit it hurts most, and the next best with models not Engaged with that one
    const ev = new Map(foes.map((e) => [e, ai.meleeEV(state, u, e)]));
    const order = foes.sort((a, b) => ev.get(b) - ev.get(a));
    const list = [];
    for (const m of alive(u)) {
      if (m.inChallenge || m.vehicle || !m.melee.length) continue;
      const { w, v } = weaponFor(m, order[0]);
      list.push({ u, m, t: order[0], w, v });
    }
    list.sort((a, b) => b.v - a.v);
    ranks.set(u, { order, list });
  }
  return ranks;
}
/**
 * Outside Support for duellist x ({u, m}) in combat c (CONFIRMED, p259): +1 to the Focus Roll for every five friendly
 * models in the combat, from any of its units, that are Engaged and not Pinned, Stunned, Routed or Suppressed. Vehicles
 * and Automata don't count, a Walker counts as five, a company standard five more and a Legion standard six more
 * (CONFIRMED). If the other side has no model in the combat but its duellist, +2 instead for every five, or part of
 * five, of the rest, Engaged or not and whatever their statuses. ASSUMPTION: models stand where the charge or the last
 * round's Final Pile-in Moves put them, so a unit's Engaged share is engagedModels' estimate, spread evenly over its
 * models, with any standard bearer in front.
 */
function outsideSupport(state, c, x) {
  const side = x.u.side;
  const rest = (s) => c[s].filter((u) => !u.destroyed).map((u) => [u, alive(u).filter((m) => !m.inChallenge)]);
  const weight = (m) => (m.vehicle || /Automata/.test(m.unitType) ? 0 : /Walker/.test(m.unitType) ? 5 : 1);
  const standards = (ms) => ms.reduce((t, m) => t + ((m.items || []).some((i) => /^Legion standard/i.test(i)) ? 6 : (m.items || []).some((i) => /^Company standard/i.test(i)) ? 5 : 0), 0);
  const count = (ms) => ms.reduce((t, m) => t + weight(m), 0) + standards(ms);
  const mine = rest(side);
  if (!rest(1 - side).some(([, ms]) => ms.length)) return 2 * Math.ceil(mine.reduce((t, [, ms]) => t + count(ms), 0) / 5);
  // the Engaged share of each friendly unit; no unit is ranked by weapon here, which leaves the share the same
  const ranks = new Map(mine.map(([u, ms]) => [u, { order: [...u.lockedWith].filter((e) => !e.destroyed), list: ms.filter((m) => !m.vehicle && m.melee.length).map((m) => ({ m })) }]));
  const engaged = engagedModels(ranks).count;
  let n = 0;
  for (const [u, ms] of mine) {
    const [k, of] = engaged.get(u) || [0, 1];
    if (!k || ['Pinned', 'Stunned', 'Routed', 'Suppressed'].some((s) => u.statuses.has(s))) continue;
    n += (k / of) * ms.reduce((t, m) => t + weight(m), 0) + standards(ms);
  }
  return core.focusSupport(Math.floor(n + 1e-9));
}
/**
 * Thunderstrike (Armillus Dynat's The Prince and the Prophet): three or more successful Hit Tests with it make a new
 * Strike Group of one attack with the weapon's The Prophet profile, in the same Initiative Step (CONFIRMED). Returns
 * that attack's result, or null.
 */
function thunderstrike(state, m, w, r, target, ctx, mods) {
  if (r.hits < 3 || !has(w.specialRules, 'Thunderstrike')) return null;
  const prophet = m.melee.find((x) => x !== w && x.base === w.base && /Prophet/.test(x.name));
  if (!prophet || !target.models.some((x) => x.wounds > 0)) return null;
  const r2 = resolveGroup(Object.assign(meleeGroup(m, prophet, target, { mods }), { attacks: 1 }), target, ctx);
  state.log(`      ${m.name} follows with The Prophet (Thunderstrike): ${r2.unsaved ? `${r2.damage} damage` : 'no wound'}`);
  return r2;
}
/** Carrion Feast (Rangdan): a wound back for each enemy model removed with a melee attack. */
const carrionFeast = (m, kills) => { if (kills && m.wounds > 0 && has(m.rules, 'Carrion Feast')) m.wounds = Math.min(m.maxWounds, m.wounds + kills); };
const hasItem = (u, re) => alive(u).some((m) => (m.items || []).some((i) => re.test(i)));
// Hatred (X) against unit b: a Trait or Sub-Type, or an allegiance (Hatred (Traitor) on Garviel Loken, Hatred (Traitors)
// on Saul Tarvitz, Hatred (Loyalist) on Zardu Layak), which units carry from their list's configuration
const hates = (x, b) => (/^Traitors?$/i.test(x) ? b.allegiance === 'Traitor' : /^Loyalists?$/i.test(x) ? b.allegiance === 'Loyalist' : (b.traits || []).includes(x) || new RegExp(x).test(b.unitType));
const HATRED = /^Hatred\s*\(([^)]*)\)/i;
/**
 * Does model m of unit u strike unit b with Hatred? Its own Hatred (X) (a joined character's Hatred is his alone),
 * plus what its unit gains: Ancient of War (Marduk Sedras: Hatred (Traitor) for every model of an all-Dark Angels unit
 * he is part of, CONFIRMED) and Kor Phaeron's Cruel Invective (u.hatredExtra, battle.cjs).
 */
function hatredAgainst(m, u, b) {
  const xs = [];
  for (const r of m.rules || []) { if (!String(r).startsWith('Hatred')) continue; const h = HATRED.exec(String(r)); if (h) xs.push(h[1].trim()); }
  if (u.hatredExtra) xs.push(...u.hatredExtra);
  if (legions.is(u, 'Dark Angels') && alive(u).some((x) => has(x.rules, 'Ancient of War'))) xs.push('Traitor');
  return xs.some((x) => hates(x, b));
}

// ---------- Challenge Sub-Phase ----------
// a duellist's strike, with its gambit's effects (expected: D3 counts as 2)
function strikeProfile(x, y, ex, ey, opts = {}) {
  const tgt = { models: [y.m], statuses: y.u.statuses, vehicle: false, name: y.m.name, buff: gambitBuff(y, ey) };
  // Hammerblow (Alexis Polux's gambit): the gambit's weapon profile and no other
  let w = ex.weapon || bestWeapon(x.m, tgt);
  if (ex.extraRules) w = Object.assign({}, w, { specialRules: [...(w.specialRules || []), ...ex.extraRules(w)] });
  const mods = meleeMods(x.u);
  // Sword of the Order (Dark Angels): a sword strikes once less but with Critical Hit (6+), or one better
  if (ex.ifSword && (/chainsword|power sword|force sword|paragon blade/i.test(w.name) || (w.traits || []).includes('Sword of the Order'))) {
    mods.attacks -= 1;
    const crit = xOf(w.specialRules || [], 'Critical Hit');
    w = Object.assign({}, w, { specialRules: [...(w.specialRules || []).filter((r) => !/^Critical Hit/.test(r)), `Critical Hit (${crit ? crit - 1 : 6}+)`] });
  }
  // Death's Champion (Sigismund), Executioner's Tax (Fafnir Rann): Critical Hit (X+), unless the weapon has a better one
  if (ex.crit) {
    const crit = xOf(w.specialRules || [], 'Critical Hit');
    w = Object.assign({}, w, { specialRules: [...(w.specialRules || []).filter((r) => !/^Critical Hit/.test(r)), `Critical Hit (${Math.min(crit || 7, ex.crit)}+)`] });
  }
  mods.attacks += (ex.attacks || 0) + (opts.focusWinner ? 1 : 0) + (ex.attacksD3 ? (opts.d3 ? opts.d3() : 2) : 0);
  // Sublime Swordsman (Fulgrim): with Challenge Advantage, +1 Attack per point of base Initiative over the opponent
  if (opts.advantage && has(x.m.rules, 'Sublime Swordsman')) mods.attacks += Math.max(0, num(x.m.p.I, 1) - num(y.m.p.I, 1));
  // Death by a Thousand Cuts (Jaghatai Khan's gambit): a wounded opponent strikes at -1 Strength
  if (ey.thousandCuts && x.m.wounds < x.m.maxWounds) mods.str -= 1;
  // Preternatural Resilience (Mortarion): in a challenge, Critical Hit against him only on a 6
  if (has(y.m.rules, 'Preternatural Resilience') && xOf(w.specialRules || [], 'Critical Hit')) w = Object.assign({}, w, { specialRules: (w.specialRules || []).map((r) => (/^Critical Hit/.test(r) ? 'Critical Hit (6+)' : r)) });
  mods.str += ex.str || 0; mods.ws += ex.ws || 0;
  // Taunt and Bait: Weapon Skill and Attacks down to the opponent's, or 1 lower where they're equal already (CONFIRMED)
  if (ex.matchOpp) { const o = num(y.m.p.WS, 4), s = num(x.m.p.WS, 4); mods.ws += o === s ? -1 : Math.min(0, o - s); }
  return { tgt, w, mods, finish: (g) => {
    if (ex.single) g.attacks = 1;
    g.S = Math.max(1, g.S);
    if (ex.matchOpp) { const o = num(y.m.p.A, 1), s = num(x.m.p.A, 1); g.attacks = o === s ? Math.max(1, g.attacks - 1) : Math.min(g.attacks, Math.max(1, o)); }
    if (ex.dmg) g.D += ex.dmg;
    if (ex.dmgCap1) g.D = 1;
    // Every Strike Foreseen: Hit Tests succeed on a 2+; the AI's estimate blends in the chance of passing the check
    if (ex.hitOn && g.hitNeed != null) { const h = Math.min(g.hitNeed, ex.hitOn); g.hitNeed = ex.hitOnP == null ? h : ex.hitOnP * h + (1 - ex.hitOnP) * g.hitNeed; }
    return g;
  } };
}
function gambitBuff(x, e) {
  if (!e || (!e.tough && !e.toughSet && !e.ew && !e.fnp)) return x.u.buff;
  const b = Object.assign({ tough: 0, fnp: 7, shrouded: 7, ew: 0, attacks: 0, str: 0, ws: 0 }, x.u.buff || {});
  // toughExact: the Toughness is replaced, even by a lower value (the Death Guard's gambit)
  if (e.toughSet) b.tough += e.toughExact ? e.toughSet - num(x.m.p.T, 4) : Math.max(0, e.toughSet - num(x.m.p.T, 4));
  else b.tough += e.tough || 0;
  if (e.ew) b.ew = Math.max(b.ew || 0, e.ew);
  if (e.fnp) b.fnp = Math.min(b.fnp || 7, e.fnp);
  return b;
}
/** Expected wounds `x` deals `y` in one Strike Step with these gambit effects. */
function duelWith(x, y, ex, ey) {
  const s = strikeProfile(x, y, ex, ey);
  const g = s.finish(meleeGroup(x.m, s.w, s.tgt, { mods: s.mods }));
  return Math.min(expectedGroup(g, s.tgt), y.m.wounds);
}
const duelEdge = (a, b) => duelWith(a, b, {}, {}) / Math.max(1, b.m.wounds) - duelWith(b, a, {}, {}) / Math.max(1, a.m.wounds);

/** Pick the best challenger against the best acceptor. */
function bestPairing(ours, theirs) {
  let best = null;
  for (const a of ours) {
    // they'll accept with whoever does best against this challenger
    let acc = null;
    for (const b of theirs) { const v = duelEdge(b, a); if (!acc || v > acc.v) acc = { b, v }; }
    const v = -acc.v;
    if (!best || v > best.v) best = { a, b: acc.b, v, accV: acc.v };
  }
  return best;
}

// Slayer of Kings (Sigismund): his player picks which eligible enemy model is the Challenged (CONFIRMED); the AI picks
// the one he does best against
const kingPair = (king, defenders) => {
  const b = defenders.reduce((best, d) => (duelEdge(king, d) > duelEdge(king, best) ? d : best), defenders[0]);
  return { a: king, b, v: duelEdge(king, b), accV: duelEdge(b, king), picked: true };
};
const isFulgrim = (m) => /^Fulgrim/.test(m.name);
// Broken in Body (Maloghurst): his player chooses, each time an enemy declares a challenge, whether he is eligible
const shy = (d) => has(d.m.rules, 'Broken in Body');
const neverBacksDown = (d) => has(d.m.rules, 'Never Back Down');

function challenge(state, c, tally) {
  const active = state.active;
  // Vengeful Hate (Rylanor the Unyielding): eligible for a challenge while locked with a unit that has Fulgrim or Fulgrim
  // Transfigured in it (CONFIRMED)
  const fulgrimIn = (side) => c[side].some((u) => !u.destroyed && alive(u).some(isFulgrim));
  const elig = (side) => c[side].filter((u) => !u.destroyed && !u.statuses.has('Routed'))
    .flatMap((u) => alive(u).filter((m) => canChallenge(m) || (has(m.rules, 'Vengeful Hate') && fulgrimIn(1 - side))).map((m) => ({ u, m })));
  const mine = elig(active), theirs = elig(1 - active);
  if (!mine.length || !theirs.length) return;
  let side = active, pair = bestPairing(mine, theirs);
  // Never Back Down (Legion Champions): an eligible model with it must be declared as the Challenger, or accept a
  // challenge (below); of several, its player picks which (CONFIRMED). ASSUMPTION: the Reactive Player's need not make
  // a Heroic Intervention (a Reaction, paid for) to declare one
  const champions = mine.filter(neverBacksDown);
  if (champions.length) pair = Object.assign(bestPairing(champions, theirs), { v: 1 });
  // Avatar of Perfection (Fulgrim Transfigured): he must have a challenge declared for him (CONFIRMED)
  const avatar = mine.find((x) => has(x.m.rules, 'Avatar of Perfection'));
  if (avatar) pair = Object.assign(bestPairing([avatar], theirs), { v: 1 });
  // Slayer of Kings: if Sigismund is eligible, he must be declared as the Challenger (CONFIRMED)
  const king = mine.find((x) => has(x.m.rules, 'Slayer of Kings'));
  if (king) pair = Object.assign(kingPair(king, theirs), { v: 1 });
  // the Active Player declares first; if they don't, the Reactive Player may make a Heroic Intervention (SHEET);
  // Sigismund picks the Challenged there too (CONFIRMED)
  if (!pair || pair.v <= 0.1) {
    const hking = theirs.find((x) => has(x.m.rules, 'Slayer of Kings'));
    // (a Never Back Down model of theirs must be the one declared, if they declare)
    const hChampions = theirs.filter(neverBacksDown);
    const hp = hking ? kingPair(hking, mine) : bestPairing(hChampions.length ? hChampions : theirs, mine);
    if (!hp || hp.v <= 0.1 || !state.reactions?.heroicIntervention(state, 1 - active, hp.a.u, hp.v)) return;
    side = 1 - active; pair = hp;
  }
  let defenders = side === active ? theirs : mine;
  const A = pair.a;
  // Vengeful Hate: when Fulgrim is the Challenger, Rylanor must be the Challenged (CONFIRMED; ASSUMPTION: so he can't
  // refuse)
  const rylanor = isFulgrim(A.m) && defenders.find((d) => has(d.m.rules, 'Vengeful Hate'));
  if (rylanor) { duel(state, c, A, rylanor, side, tally); return; }
  // Never Back Down: one of the defenders' models with it must accept, whichever does best; there's no refusing
  // (ASSUMPTION: Sigismund's pick under Slayer of Kings comes first)
  const mustAccept = pair.picked ? [] : defenders.filter(neverBacksDown);
  if (mustAccept.length) {
    const b = mustAccept.reduce((best, d) => (duelEdge(d, A) > duelEdge(best, A) ? d : best), mustAccept[0]);
    pair = { a: A, b, v: -duelEdge(b, A), accV: Infinity };
  }
  // Broken in Body: the AI keeps Maloghurst out of a challenge he'd refuse, so he's neither the Challenged nor the model
  // Disgraced for a refusal (ASSUMPTION: the AI's choice)
  if (defenders.some(shy) && pair.accV < -0.6) {
    defenders = defenders.filter((d) => !shy(d));
    if (!defenders.length) return;
    if (shy(pair.b)) {
      // Slayer of Kings: a picked model that can't be the Challenged gives Combat Resolution Points equal to its starting
      // Wounds, and Sigismund picks another (CONFIRMED)
      if (pair.picked) { tally.glory[side] += pair.b.m.maxWounds; state.log(`    ${pair.b.m.name} can't be the Challenged: +${pair.b.m.maxWounds} Combat Resolution (Slayer of Kings)`); pair = kingPair(A, defenders); }
      else { const b = defenders.reduce((best, d) => (duelEdge(d, A) > duelEdge(best, A) ? d : best), defenders[0]); pair = { a: A, b, v: -duelEdge(b, A), accV: duelEdge(b, A) }; }
    }
  }
  // Warrior Pride (Sons of Horus): refuse a lesser challenger without becoming Disgraced
  if (side === active && pair.accV < 0 && state.reactions?.warriorPride(state, A, defenders, 1 - side, pair.accV)) return;
  // refusing: the challenger's player picks a model to become Disgraced (SHEET)
  if (pair.accV < -0.6) {
    // Slayer of Kings: if the model Sigismund picked doesn't become the Challenged, Combat Resolution Points equal to its
    // starting Wounds, and he picks another eligible model to accept (ASSUMPTION: a refusal counts, and the second pick
    // must accept)
    const rest = pair.picked ? defenders.filter((d) => d !== pair.b) : [];
    if (rest.length) {
      tally.glory[side] += pair.b.m.maxWounds;
      state.log(`    ${A.m.name} challenges ${pair.b.m.name}; it is refused: +${pair.b.m.maxWounds} Combat Resolution (Slayer of Kings)`);
      duel(state, c, A, kingPair(A, rest).b, side, tally);
      return;
    }
    const victim = defenders.reduce((b, d) => (num(d.m.p.WS, 4) > num(b.m.p.WS, 4) ? d : b), defenders[0]);
    state.log(`    ${A.m.name} issues a challenge; it is refused and ${victim.m.name} is Disgraced`);
    victim.m.disgraced = true;
    addStatus(state, victim.u, 'Disgraced', 'refused a challenge');
    return;
  }
  duel(state, c, A, pair.b, side, tally);
  // Lord of the Red Sands (Angron): the challenger may declare another challenge against an enemy model that hasn't
  // fought one this sub-phase, and Combat Resolution counts them all (CONFIRMED)
  const fought = new Set([pair.b.m]);
  while (has(A.m.rules, 'Lord of the Red Sands') && A.m.wounds > 0) {
    const next = (side === active ? theirs : mine).filter((d) => d.m.wounds > 0 && !fought.has(d.m) && !d.u.destroyed);
    if (!next.length) break;
    const b = next.reduce((best, d) => (duelEdge(A, d) > duelEdge(A, best) ? d : best), next[0]);
    if (duelEdge(A, b) <= 0.1) break;
    fought.add(b.m);
    state.log(`    ${A.m.name} declares another challenge (Lord of the Red Sands)`);
    duel(state, c, A, b, side, tally);
  }
}

/** A challenge: rounds of Face-Off, Focus Roll and Strike until someone falls or the advantage holder stops. */
function duel(state, c, A, B, challengerSide, tally) {
  state.log(`    ${A.m.name} challenges, ${B.m.name} accepts`);
  A.m.inChallenge = B.m.inChallenge = true;
  const inflicted = new Map([[A, 0], [B, 0]]);
  const effects = new Map([[A, {}], [B, {}]]);
  const lasting = new Map([[A, {}], [B, {}]]);
  const guard = new Map([[A, 0], [B, 0]]);
  const other = (x) => (x === A ? B : A);
  let testFoe = null;
  // Outside Support, counted again each round (a Violent Overkill or The Breaker can thin the combat)
  const supportOf = new Map();
  const support = (x) => supportOf.get(x) ?? 0;
  const weaponOf = (x) => bestWeapon(x.m, { models: [other(x).m], vehicle: false });
  const ci = (x) => combatInitiative(x.u, x.m, weaponOf(x));
  // Aegis of Wisdom: the other friendly Ultramarines Command models on the battlefield
  const aegisCount = (x) => state.units.filter((u) => u.side === x.u.side && !u.destroyed && u.arrived && !u.embarkedIn)
    .reduce((t, u) => t + alive(u).filter((m) => m !== x.m && /Command/.test(m.unitType) && (m.traits || []).includes('Ultramarines')).length, 0);
  // the Focus Roll's terms, positive and negative, before the die
  const focusTerms = (x, e, eo) => {
    const w = weaponOf(x);
    const terms = [
      e.noCI ? 0 : eo.oppCI1 ? 1 : ci(x),
      e.noWoundPenalty ? 0 : -(x.m.maxWounds - x.m.wounds),
      // Shield Master (Fafnir Rann): no -1 for the Heavy Sub-Type (CONFIRMED)
      /Heavy/.test(x.m.unitType) && !has(x.m.rules, 'Shield Master') ? -1 : 0, /Light/.test(x.m.unitType) ? 1 : 0,
      // (a company standard counts as five models of Outside Support instead, CONFIRMED: outsideSupport)
      (x.m.traits || []).includes('Shield') ? 1 : 0,
      Math.min(e.noSupport ? 0 : support(x) * (e.supportMult || 1) + (e.supportBonus || 0), eo.oppSupportCap ?? Infinity),
      xOf(w.specialRules, "Duellist's Edge") || xOf(w.specialRules, "Duelist's Edge") || 0, e.focus || 0, guard.get(x), e.aegis ? aegisCount(x) : 0, e.sacrifice || 0,
      // Battle of the Wills (Magnus): + his base Willpower over the opponent's
      has(x.m.rules, 'Battle of the Wills') ? Math.max(0, num(x.m.p.WP, 7) - num(other(x).m.p.WP, 7)) : 0,
    ];
    // The Undying Fire (Vulkan's gambit): no positive modifiers
    return e.noPositive ? terms.map((t) => Math.min(0, t)) : terms;
  };
  // the expected change a gambit makes to the Focus Roll difference, for the AI
  const focusDelta = (x) => (e) => {
    const base = focusTerms(x, {}, {}).reduce((a, b) => a + b, 0), oBase = focusTerms(other(x), {}, {}).reduce((a, b) => a + b, 0);
    const mine = focusTerms(x, e, {}), theirs = focusTerms(other(x), {}, e).reduce((a, b) => a + b, 0);
    let d = mine.reduce((a, b) => a + b, 0) - base - (theirs - oBase) + gambits.focusShift(Object.assign({}, e, { focus: 0 }));
    if (e.predict) d += 0.5 * -mine.filter((t) => t < 0).reduce((a, b) => a + b, 0);
    if (e.wpFocus) d += Math.max(0, num(x.m.p.WP, 7) - (3.5 + base)) * 0.6;
    return d;
  };
  // the chance a wound at AP 5 isn't saved (Duty is Sacrifice)
  const saveFail = (m) => { const sv = Math.min(num(String(m.p.SAV).replace('+', ''), 7) < 5 ? num(String(m.p.SAV).replace('+', ''), 7) : 7, num(String(m.p.INV || '').replace('+', ''), 7)); return Math.min(1, (sv - 1) / 6); };
  const decapOK = new Map();
  // one attack, as if the model had 1 Attack (Decapitation Strike, Dirty Fighter); lastStand: the target's Seeker of
  // Atonement, if it picked it
  const oneBlow = (x, y, lastStand) => {
    const s = strikeProfile(x, y, effects.get(x), effects.get(y), {});
    const g = Object.assign(s.finish(meleeGroup(x.m, s.w, s.tgt, { mods: s.mods })), { attacks: 1 });
    const before = y.m.wounds;
    const r = resolveGroup(g, s.tgt, { dice: state.dice, log: state.log, lastStand, onKill: (m) => state.onCasualty && state.onCasualty(m, y.u, x.u) });
    inflicted.set(x, inflicted.get(x) + (before - y.m.wounds));
    /* challenge casualties score Glory, not Combat Resolution (CONFIRMED: only the Fight Sub-Phase's count) */
    return r;
  };
  // Archein of Wisdom counts the Hit Tests of this challenge's previous Strike Step only
  A.hitsTaken = B.hitsTaken = 0;
  // gambits each model may pick once per challenge (Decapitation Strike)
  const usedOnce = new Map([[A, new Set()], [B, new Set()]]);
  // Taunt and Bait: +1 Combat Resolution to a winner for each time it picked the gambit in this challenge (CONFIRMED)
  const taunts = new Map([[A, 0], [B, 0]]);
  // the expected wound difference of the coming Strike Step for x against y, with x's gambit effects e and y's ey
  const duelFn = (x, y, ey) => (e) => duelWith(x, y, e, ey) - duelWith(y, x, ey, e);
  // what the AI weighs a gambit by, besides that difference (gambits.choose)
  const gambitOpts = (me, opp, known, round) => ({
    moreRounds: round < 20, round, focusDelta: focusDelta(me),
    wouldFall: duelWith(opp, me, known, {}) >= me.m.wounds, favoured: duelEdge(me, opp) > 0, saveFail: saveFail(me.m),
    decap: 0.5 * duelWith(me, opp, {}, known) - 0.1 * duelWith(opp, me, known, {}),
    dirty: has(me.m.rules, 'Dirty Fighter') && round === 1 ? duelWith(me, opp, { single: true }, known) : 0,
    // Withdraw: how far behind on wounds inflicted this model expects to be after the coming Strike Step
    behind: inflicted.get(opp) - inflicted.get(me) + duelWith(opp, me, known, {}) - duelWith(me, opp, { single: true }, known),
    used: usedOnce.get(me),
  });
  // Face-Off (CONFIRMED, p257): the Challenger picks first in the first round, the holder of Challenge Advantage in
  // every round after; a gambit one duellist picked can't be picked by the other in the same Face-Off
  let lead = A;
  // rounds go on until a duellist falls or the side with Challenge Advantage stops (CONFIRMED: no limit; 20 here)
  for (let round = 1; round <= 20; round++) {
    for (const x of [A, B]) { supportOf.set(x, outsideSupport(state, c, x)); x.support = support(x); }
    const banned = new Set();
    for (const [me, opp] of [[lead, other(lead)], [other(lead), lead]]) {
      // Howl of the Death Wolf: while it lasts no other gambit may be picked
      if (lasting.get(me).howl) { effects.set(me, { name: 'Howl of the Death Wolf', focus: 5, howl: true }); continue; }
      // A Death Long Foreseen (Konrad Curze): the gambit is there to pick on a 5+
      me.foreseen = has(me.m.rules, 'A Death Long Foreseen') && state.dice.d6() >= 5;
      // the first gambit is applied before the second is picked (CONFIRMED), so the second picker knows it; the first
      // weighs what its pick (or Feint and Riposte's naming) takes away from the second
      const first = me === lead, known = first ? {} : effects.get(opp);
      const rival = first ? () => gambits.rank(state, opp, me, duelFn(opp, me, {}), gambitOpts(opp, me, {}, round)) : null;
      const g = gambits.choose(state, me, opp, duelFn(me, opp, known), Object.assign(gambitOpts(me, opp, known, round), { lead: first, banned, rival }));
      if (g) { banned.add(g.name); if (g.named) banned.add(g.named); }
      if (g && g.once) usedOnce.get(me).add(g.name);
      const e = g ? Object.assign({ name: g.name }, g.make(state, me, opp)) : {};
      if (e.crpIfWin) taunts.set(me, taunts.get(me) + e.crpIfWin);
      // Beseech the Gods lasts until the end of the Challenge Sub-Phase; Bite of the Betrayed (Saul Tarvitz) until the
      // challenge ends, with its WS and Toughness too
      const keep = lasting.get(me);
      if (e.howl) lasting.set(me, Object.assign({}, keep, { howl: true }));
      if (e.persist) lasting.set(me, { str: (keep.str || 0) + (e.str || 0), attacks: (keep.attacks || 0) + (e.attacks || 0), ws: (keep.ws || 0) + (e.ws || 0), tough: (keep.tough || 0) + (e.tough || 0) });
      else for (const k of ['str', 'attacks', 'ws', 'tough']) e[k] = (e[k] || 0) + (keep[k] || 0);
      effects.set(me, e);
      if (g) state.log(`      ${me.m.name} picks ${g.name}${g.named ? `, naming ${g.named}` : ''}`);
    }
    if (A.m.wounds <= 0 || B.m.wounds <= 0) break;
    // Nostraman Courage: another model of the unit steps into the challenge in this one's place
    for (const x of [A, B]) {
      if (!effects.get(x).swapOut) continue;
      const sub = alive(x.u).filter((m) => m !== x.m && !m.inChallenge).sort((a, b) => num(a.p.W, 1) - num(b.p.W, 1))[0];
      if (!sub) continue;
      state.log(`      ${x.m.name} steps back; ${sub.name} takes the challenge (Nostraman Courage)`);
      x.m.inChallenge = false; sub.inChallenge = true; x.m = sub;
      effects.set(x, {});
    }
    // Seeker of Atonement (Hibou Khan's gambit): once this Strike Step, a model reduced to 0 Wounds stays with 1 on an
    // n+ and takes Challenge Advantage (worked in attack.cjs through ctx.lastStand)
    let seized = null;
    const stand = new Map([A, B].filter((x) => effects.get(x).lastStand).map((x) => [x, { model: x.m, n: effects.get(x).lastStand, rule: 'Seeker of Atonement', onSave: () => { seized = x; } }]));
    // Dirty Fighter (Sevatar's gambit): at the start of the Focus Step, one attack as if he had 1 Attack (CONFIRMED)
    for (const x of [A, B]) {
      if (!effects.get(x).dirty || x.m.wounds <= 0 || other(x).m.wounds <= 0) continue;
      const r = oneBlow(x, other(x), stand.get(other(x)));
      state.log(`      ${x.m.name} fights dirty before the Focus Roll (Dirty Fighter): ${r.unsaved ? `${r.damage} wound${r.damage === 1 ? '' : 's'}` : 'no wound'}`);
    }
    if (A.m.wounds <= 0 || B.m.wounds <= 0) break;
    // Focus Roll: D6 + Combat Initiative - wounds lost, -1 Heavy, +1 Light, +1 Shield or Company Standard,
    // + Outside Support, + gambits; the winner gets +1 Attack and Challenge Advantage
    const focus = (x) => {
      const e = effects.get(x), eo = effects.get(other(x));
      if (e.decap) return -Infinity; // Decapitation Strike: no Focus Roll
      let d = state.dice.d6();
      if (e.focusDice) { const d2 = state.dice.d6(); d = e.focusDice === 'high' ? Math.max(d, d2) : Math.min(d, d2); }
      const terms = focusTerms(x, e, eo);
      // The Path of the Warrior: a correct Strike Low / Strike High guess ignores the negative modifiers
      const ignoreNeg = e.predict && (d >= 4) === (e.predict === 'high');
      let total = d + terms.reduce((a, t) => a + (ignoreNeg && t < 0 ? 0 : t), 0);
      // Prophetic Duellist: the Focus Roll may be replaced by the model's Willpower
      if (e.wpFocus) total = Math.max(total, num(x.m.p.WP, 7));
      return total;
    };
    let fa = focus(A), fb = focus(B);
    // ties roll again; two Decapitation Strikes make no Focus Roll at all, so a die decides
    for (let n = 0; fa === fb && n < 20; n++) { fa = focus(A); fb = focus(B); }
    if (fa === fb) { fa = state.dice.d6(); fb = fa >= 4 ? fa - 1 : fa + 1; }
    const winner = fa > fb ? A : B;
    const adv = testFoe || winner;
    testFoe = null;
    guard.set(A, 0); guard.set(B, 0);
    // Decapitation Strike: one attack at the end of the Focus Step; the rest only if it hits and wounds
    for (const x of [A, B]) {
      const ex = effects.get(x), y = other(x);
      if (!ex.decap || x.m.wounds <= 0 || y.m.wounds <= 0) continue;
      const r = oneBlow(x, y, stand.get(y));
      decapOK.set(x, r.wounds > 0);
      state.log(`      ${x.m.name} strikes first (Decapitation Strike): ${r.wounds > 0 ? 'it lands' : 'it fails, and no more attacks'}`);
    }
    // Strike: the side with Challenge Advantage first; the successful Hit Tests against each model are counted for
    // Archein of Wisdom
    const hitsNow = new Map([[A, 0], [B, 0]]);
    for (const [x, y] of [[adv, other(adv)], [other(adv), adv]]) {
      if (x.m.wounds <= 0 || y.m.wounds <= 0) continue;
      const ex = effects.get(x), ey = effects.get(y);
      if (ex.decap && !decapOK.get(x)) continue;
      // The Breaker (Perturabo): no attacks; a friendly Iron Warriors unit within 12" shoots the opponent instead,
      // Snap Shots, no Blast or Template, every wound on the model in the challenge
      if (ex.breaker) {
        const tgtY = { models: [y.m], statuses: y.u.statuses, vehicle: false, name: y.m.name, buff: gambitBuff(y, ey), x: y.u.x, y: y.u.y, r: 0, rules: y.u.rules };
        const gun = state.units.find((u) => u.side === x.u.side && !u.destroyed && u.arrived && !u.embarkedIn && !u.lockedWith.size && legions.is(u, 'Iron Warriors')
          && alive(u).some((m) => m.ranged.length) && gap(u, y.u) <= 12);
        if (gun) {
          const plan = planVolley(gun, tgtY, state, { snap: true, losOK: true, exclude: (w) => has(w.specialRules, 'Blast') || has(w.specialRules, 'Template') });
          const before = y.m.wounds;
          for (const pk of plan.picks) resolveGroup(rangedGroup(pk.model, pk.weapon, tgtY, { snap: true }), tgtY, { dice: state.dice, onKill: (m) => state.onCasualty && state.onCasualty(m, y.u, gun) });
          inflicted.set(x, inflicted.get(x) + (before - y.m.wounds));
          state.log(`      ${gun.name} shoots ${y.m.name} (The Breaker): ${before - y.m.wounds} wounds`);
        }
        continue;
      }
      const s = strikeProfile(x, y, ex, ey, { focusWinner: x === winner, advantage: x === adv, d3: () => state.dice.d3() });
      let w = s.w;
      if (has(w.specialRules, 'Force')) w = forceCheck(state, x.u, x.m, w, s.tgt);
      w = psychic.rollDice(state, w);
      const g = s.finish(meleeGroup(x.m, w, s.tgt, { charged: x.u.turn.charged, mods: s.mods }));
      if (ex.decap) g.attacks = Math.max(0, g.attacks - 1);
      const before = y.m.wounds;
      const ctx = { dice: state.dice, log: state.log, preyCrit: preyCrit(x.u, y.u), hatred: hatredAgainst(x.m, x.u, y.u), minWound: ey.woundFloor, lastStand: stand.get(y), onKill: (m) => state.onCasualty && state.onCasualty(m, y.u, x.u) };
      const r = resolveGroup(g, s.tgt, ctx);
      const r2 = thunderstrike(state, x.m, w, r, s.tgt, ctx, s.mods);
      if (r2) { r.kills += r2.kills; r.unsaved += r2.unsaved; }
      inflicted.set(x, inflicted.get(x) + (before - y.m.wounds));
      /* challenge casualties score Glory, not Combat Resolution (CONFIRMED: only the Fight Sub-Phase's count) */
      hitsNow.set(y, hitsNow.get(y) + r.hits);
      carrionFeast(x.m, r.kills);
      // Howl of the Death Wolf ends with a Strike Step that inflicts no unsaved wound
      if (ex.howl && !r.unsaved) { const k = lasting.get(x); lasting.set(x, Object.assign({}, k, { howl: false })); state.log(`      ${x.m.name}'s Howl of the Death Wolf fades`); }
      if (ey.guardUp) guard.set(y, guard.get(y) + Math.max(0, g.attacks - r.hits));
      if (y.m.wounds > 0) continue;
      if (ex.onKill) ex.onKill(state, x, y);
      // Brutal Dismemberment: Combat Resolution for the kill
      if (ex.crpOnKill) { tally.glory[x.u.side] += ex.crpOnKill; state.log(`      +${ex.crpOnKill} Combat Resolution (${ex.name})`); }
      // Violent Overkill: attacks left after the opponent falls go to the rest of its unit (ASSUMPTION: the
      // attacks not yet made, rather than wounds already rolled)
      if (ex.overkill && g.attacks > r.used) {
        const rest = alive(y.u).filter((m) => !m.inChallenge);
        if (rest.length) {
          const tgt2 = { models: rest, statuses: y.u.statuses, vehicle: false, name: y.u.name, buff: y.u.buff };
          const r2 = resolveGroup(Object.assign({}, g, { attacks: g.attacks - r.used }), tgt2, { dice: state.dice, onKill: (m) => state.onCasualty && state.onCasualty(m, y.u, x.u) });
          tally.kills[x.u.side] += r2.kills;
          state.log(`      ${x.m.name} carries on into ${y.u.name} (Violent Overkill): ${r2.kills} killed`);
        }
      }
      // Spiteful Demise: the fallen model strikes once more, automatically hitting
      if (ey.onDeath && x.m.wounds > 0) {
        const tgtX = { models: [x.m], statuses: x.u.statuses, vehicle: false, name: x.m.name, buff: x.u.buff };
        const g3 = Object.assign(meleeGroup(y.m, bestWeapon(y.m, tgtX), tgtX, {}), { attacks: 1, hitNeed: null });
        const b3 = x.m.wounds;
        resolveGroup(g3, tgtX, { dice: state.dice, onKill: (m) => state.onCasualty && state.onCasualty(m, x.u, y.u) });
        inflicted.set(y, inflicted.get(y) + (b3 - x.m.wounds));
        state.log(`      ${y.m.name} strikes as it falls (Spiteful Demise)${x.m.wounds <= 0 ? `: ${x.m.name} falls too` : ''}`);
      }
    }
    // The Undying Fire (Vulkan): D3 wounds back if he survived the Strike Step
    for (const x of [A, B]) {
      if (!effects.get(x).regen || x.m.wounds <= 0 || x.m.wounds >= x.m.maxWounds) continue;
      const back = Math.min(x.m.maxWounds - x.m.wounds, state.dice.d3());
      x.m.wounds += back;
      state.log(`      ${x.m.name} regains ${back} wound${back > 1 ? 's' : ''} (The Undying Fire)`);
    }
    // Duty is Sacrifice: the wounds paid for the Focus bonus, AP 5, Damage 1, armour and invulnerable saves allowed
    for (const x of [A, B]) {
      const k = effects.get(x).sacrifice;
      if (!k || x.m.wounds <= 0) continue;
      let lost = 0;
      for (let i = 0; i < k && x.m.wounds > 0; i++) if (state.dice.rnd() < saveFail(x.m)) { x.m.wounds -= 1; lost++; }
      if (lost) state.log(`      ${x.m.name} pays ${lost} wound${lost > 1 ? 's' : ''} (Duty is Sacrifice)`);
      if (x.m.wounds <= 0 && state.onCasualty) state.onCasualty(x.m, x.u, null);
    }
    if (effects.get(A).testFoe) testFoe = A; else if (effects.get(B).testFoe) testFoe = B;
    A.hitsTaken = hitsNow.get(A); B.hitsTaken = hitsNow.get(B);
    // Seeker of Atonement: the model that stood back up has Challenge Advantage (ASSUMPTION: from now, into the next round)
    if (seized) testFoe = seized;
    // whoever holds Challenge Advantage into the next round picks the first gambit there
    lead = testFoe || adv;
    if (A.m.wounds <= 0 || B.m.wounds <= 0) break;
    // the side with Challenge Advantage decides whether to fight another round, unless No Prey Escapes holds it
    const holder = seized || adv;
    if (duelEdge(holder, other(holder)) <= 0.05 && !effects.get(A).noEscape && !effects.get(B).noEscape) break;
  }
  // Glory (CONFIRMED): if one duellist fell, the other wins and scores the fallen model's base Wounds, +1 if it was
  // a Command or Paragon model; otherwise the one who inflicted more wounds wins and scores them
  const [ia, ib] = [inflicted.get(A), inflicted.get(B)];
  const fell = [A, B].filter((x) => x.m.wounds <= 0);
  // Withdraw (CONFIRMED, p258): a duellist that picked it in the last Face-Off, and wasn't Removed as a Casualty, may
  // end the challenge in the Glory Step with no Combat Resolution Points for either side; the AI does when it would
  // lose the challenge
  const quit = !fell.length && [A, B].find((x) => effects.get(x).withdraw && inflicted.get(x) < inflicted.get(other(x)));
  if (quit) state.log(`      ${quit.m.name} withdraws from the challenge: no Combat Resolution Points`);
  else if (fell.length === 1 || (!fell.length && ia !== ib)) {
    const [win, lose] = fell.length === 1 ? [other(fell[0]), fell[0]] : ia > ib ? [A, B] : [B, A];
    const glory = lose.m.wounds <= 0 ? num(lose.m.p.W, lose.m.maxWounds) + (/Command|Paragon/.test(lose.m.unitType) ? 1 : 0) : inflicted.get(win);
    tally.glory[win.u.side] += glory + taunts.get(win);
    state.log(`      ${win.m.name} wins the challenge: ${glory} Glory`);
    // Cut Off the Head (MISSION): winning a challenge by slaying the enemy model scores 2 VP
    if (lose.m.wounds <= 0 && state.mission?.has('Cut Off the Head')) state.award(win.u.side, 2, `Cut Off the Head (${lose.m.name})`);
  }
  // Haunted (Little Horus Aximand): 2 Victory Points if Garviel Loken is Removed as a Casualty in a challenge with him
  // (CONFIRMED)
  for (const x of [A, B]) if (has(x.m.rules, 'Haunted') && other(x).m.wounds <= 0 && /Loken/.test(other(x).m.name) && state.award) state.award(x.u.side, 2, `Haunted (${other(x).m.name})`);
  // Lordsbane (Varagyr Thegn): if the Thegn still stands, +1 Combat Resolution per Varagyr in its unit, up to 4
  for (const x of [A, B]) {
    if (!has(x.m.rules, 'Lordsbane') || x.m.wounds <= 0 || quit) continue;
    const n = Math.min(4, alive(x.u).filter((m) => /Varagyr/.test(m.name)).length);
    if (n) { tally.glory[x.u.side] += n; state.log(`      +${n} Combat Resolution (Lordsbane)`); }
  }
  state.log(`      ${A.m.name} ${A.m.wounds}/${A.m.maxWounds} wounds, ${B.m.name} ${B.m.wounds}/${B.m.maxWounds} wounds`);
  for (const u of [A.u, B.u]) if (state.afterDamage) state.afterDamage(u);
}

// ---------- Fight Sub-Phase ----------
function fight(state, c, again = null) {
  // again: Vengeance of the First Legion fights the combat a second time, keeping the challenge's points and leaving
  // the challenge itself as it was (CONFIRMED: "discarding any Combat Resolution Points gained during the first round
  // (but not Combat Resolution Points scored from any Challenges)")
  const tally = { kills: [0, 0], glory: again ? [...again.glory] : [0, 0] };
  if (again) for (const m of again.challengers) m.inChallenge = true;
  // Death Cloud (Grave Wardens): at the start of the Fight Sub-Phase each enemy unit locked with them takes a hit
  // per Death Cloud model, Strength 1, Poisoned (3+), AP 5, Damage 1, no cover (CONFIRMED)
  for (const side of [0, 1]) for (const u of again ? [] : c[side]) {
    const n = alive(u).filter((m) => has(m.rules, 'Death Cloud')).length;
    if (!n || u.destroyed) continue;
    for (const e of [...u.lockedWith].filter((x) => !x.destroyed)) {
      const r = resolveGroup({ attacks: n, S: 1, AP: 5, D: 1, hitNeed: null, rules: ['Poisoned (3+)'], melee: true }, e, { dice: state.dice, onKill: (m) => state.onCasualty && state.onCasualty(m, e, u) });
      tally.kills[side] += r.kills;
      if (r.unsaved) state.log(`    Death Cloud: ${e.name} takes ${r.unsaved} wounds`);
    }
  }
  if (!again) challenge(state, c, tally);
  // Declare Weapons: each model's weapon for the round, against the locked enemy unit its unit hurts most
  const ranks = rankFighters(state, c);
  const strikers = [];
  for (const { list } of ranks.values()) for (const s of list) strikers.push(Object.assign(s, { step: combatInitiative(s.u, s.m, s.w) + (s.u.turn.charged && argOf(s.w.specialRules, 'Impact') === 'IM' ? 1 : 0) }));
  const outnumbered = (side) => modelCount(c[side]) < modelCount(c[1 - side]);
  const steps = [...new Set(strikers.map((s) => s.step))].sort((a, b) => b - a);
  const told = new Set();
  for (const step of steps) {
    // Declare Combatants, Pile-in, Declare Engaged Models: only Engaged models attack (see engagedModels above)
    const { target, count } = engagedModels(ranks);
    for (const [u, [k, n]] of count) if (k < n && !told.has(u) && strikers.some((s) => s.u === u && s.step === step)) { told.add(u); state.log(`    ${u.name}: ${k} of ${n} models Engaged`); }
    // everyone at this step strikes, even if killed by another blow at the same step
    const now = strikers.filter((s) => s.step === step && s.m.wounds > 0 && target.has(s.m));
    for (const s of now) {
      let t = target.get(s.m);
      if (t.destroyed || !alive(t).length) { const alt = [...s.u.lockedWith].find((e) => !e.destroyed && alive(e).length); if (!alt) continue; t = alt; }
      let w = s.w;
      if (has(w.specialRules, 'Force')) w = forceCheck(state, s.u, s.m, w, t);
      w = psychic.rollDice(state, w);
      const g = meleeGroup(s.m, w, t, { charged: s.u.turn.charged, outnumbered: outnumbered(s.u.side), mods: meleeMods(s.u) });
      // The Blood is Forever (Crimson Paladins): Feel No Pain (5+) when outnumbered, (4+) when by more than double
      const own = modelCount([t]), them = modelCount([...t.lockedWith].filter((e) => !e.destroyed));
      const outnumberFnp = them > 2 * own ? 4 : them > own ? 5 : 7;
      const ctx = { dice: state.dice, log: state.log, preyCrit: preyCrit(s.u, t), hatred: hatredAgainst(s.m, s.u, t), outnumberFnp, onKill: (m) => state.onCasualty && state.onCasualty(m, t, s.u) };
      const r = resolveGroup(g, t, ctx);
      tally.kills[s.u.side] += r.kills;
      const r2 = thunderstrike(state, s.m, w, r, t, ctx, meleeMods(s.u));
      if (r2) { tally.kills[s.u.side] += r2.kills; r.kills += r2.kills; r.vehicleStatuses.push(...r2.vehicleStatuses); }
      carrionFeast(s.m, r.kills);
      for (const st of r.vehicleStatuses) vehicleDamage(state, t, st);
    }
    for (const side of [0, 1]) for (const u of c[side]) if (state.afterDamage) state.afterDamage(u);
  }
  tally.challengers = [];
  for (const side of [0, 1]) for (const u of c[side]) for (const m of u.models) { if (m.inChallenge) tally.challengers.push(m); m.inChallenge = false; }
  return tally;
}

// ---------- Resolution Sub-Phase ----------
const leads = (m) => /Command|Sergeant|Paragon/.test(m.unitType) || m.sergeant;
const hasLD = (m) => m.p.LD != null && m.p.LD !== '–' && m.p.LD !== '-';
/**
 * The losing side's Panic Check (CONFIRMED, p272): a single Leadership Check for all its units in the combat, on the
 * majority Leadership of one of them, or the Leadership of a Command or Sergeant model in any of them (or a Paragon's,
 * which may always lend its characteristics to its unit, CONFIRMED p175), less the difference in Combat Resolution
 * Points. The AI tests with whichever unit gives the best chance (Fear, Neural Collars and the like are the tested
 * unit's). Returns true if passed.
 */
function panicCheck(state, units, diff) {
  const val = (m) => Math.floor(num(m.p.LD, 7) / (m.disgraced ? 2 : 1));
  const testers = units.filter((u) => !u.destroyed && alive(u).some(hasLD));
  if (!testers.length) return true;
  const leader = Math.max(-Infinity, ...testers.flatMap((u) => alive(u).filter((m) => hasLD(m) && leads(m)).map(val)));
  let best = null;
  for (const u of testers) {
    const ms = alive(u).filter(hasLD);
    const v = Math.max(majorityOf(ms.map(val)), leader);
    // check() starts from the unit's own value (its lowest, or a leader's in it): the difference becomes a bonus
    const own = Math.max(Math.min(...ms.map(val)), ...ms.filter(leads).map(val));
    const pen = diff - (v - own);
    const p = u.buff?.autoPass ? 1 : passChance(state, u, 'LD', pen);
    if (!best || p > best.p) best = { u, pen, p };
  }
  return check(state, best.u, 'LD', best.pen, 'Panic Check, lost the combat');
}
/** Fall Back from a combat: unlocked first. */
function fallBackFrom(state, u) {
  unlock(u);
  fallBack(state, u);
}
function resolve(state, c, tally) {
  const live = [c[0].filter((u) => !u.destroyed), c[1].filter((u) => !u.destroyed)];
  // a unit that includes a Routed model in the Resolution Sub-Phase always Falls Back at its end, whichever side won
  // (CONFIRMED, p203 and p272); u.consolidated marks a unit that has taken its Aftermath option
  const routedFallBack = (units) => { for (const u of units) if (!u.destroyed && u.statuses.has('Routed')) { u.consolidated = true; fallBackFrom(state, u); } };
  const done = () => {
    for (const s of [0, 1]) for (const u of c[s]) if (!u.destroyed && u.lockedWith.size && ![...u.lockedWith].some((e) => !e.destroyed)) unlock(u);
    for (const s of [0, 1]) for (const u of c[s]) u.consolidated = false;
  };
  // Massacre: the enemy is wiped out; the winners Consolidate (SHEET), or take No Quarter (MISSION)
  if (!live[0].length || !live[1].length) {
    // Vanguard (X): a Massacred unit that was within 3" of an objective at the start of the Assault Phase (CONFIRMED)
    const w = live[0].length ? 0 : 1;
    if (live[w].length && state.onBrokeFromCombat) for (const u of c[1 - w]) if (u.nearObjective) state.onBrokeFromCombat(u, live[w], u.nearObjective);
    routedFallBack(live[w]);
    for (const u of live[w]) if (!u.destroyed && !u.consolidated) { unlock(u); if (!noQuarter(state, u)) consolidate(state, u); }
    done();
    return;
  }
  // Combat Resolution: models removed, Glory, outnumbering, standards (SHEET, CONFIRMED for the standards)
  // Unwavering Conviction (Word Bearers): +1 if any of their models are in the combat; the Panoply of Flame (Zardu
  // Layak's wargear): +1 for the unit that has it (CONFIRMED)
  const score = [0, 1].map((s) => tally.kills[s] + tally.glory[s] + live[s].reduce((t, u) => t + (hasItem(u, /^Vexilla/i) ? 1 : 0) + (hasItem(u, /^Legion standard/i) ? 2 : 0) + (hasItem(u, /^The Panoply of Flame/i) ? 1 : 0), 0)
    + (live[s].some((u) => legions.is(u, 'Word Bearers')) ? 1 : 0));
  const mc = [modelCount(live[0]), modelCount(live[1])];
  if (mc[0] > mc[1]) score[0] += core.outnumberBonus; else if (mc[1] > mc[0]) score[1] += core.outnumberBonus;
  state.log(`    combat resolution ${score[0]}–${score[1]}`);
  // a draw: no Panic Check; Routed units Fall Back and everyone else Holds
  if (score[0] === score[1]) { routedFallBack(live[state.active]); routedFallBack(live[1 - state.active]); done(); return; }
  const w = score[0] > score[1] ? 0 : 1, l = 1 - w;
  const diff = Math.abs(score[0] - score[1]);
  const winners = live[w], losers = live[l];
  // the losers' Panic Check; failed, all their units in the combat are Routed. None is made when they all are already
  if (!losers.every((u) => u.statuses.has('Routed')) && !panicCheck(state, losers, diff)) for (const u of losers) addStatus(state, u, 'Routed', 'lost the combat');
  // Aftermath, the losers first: a Routed unit Falls Back; the others Hold, or Disengage with a normal move away if
  // the next round looks bad (SHEET; not while Pinned)
  const fled = [], broken = [];
  for (const u of losers) {
    if (u.destroyed) continue;
    const foes = [...u.lockedWith].filter((e) => !e.destroyed);
    if (u.statuses.has('Routed')) {
      const nearObjective = u.nearObjective || null;
      fallBackFrom(state, u);
      fled.push(u);
      if (!u.destroyed) broken.push({ u, nearObjective });
      continue;
    }
    const give = foes.reduce((t, e) => t + ai.meleeEV(state, u, e), 0), take = foes.reduce((t, e) => t + ai.meleeEV(state, e, u), 0);
    if (foes.length && !u.vehicle && !u.statuses.has('Pinned') && take > 1.5 * give + 5) { disengage(state, u, foes); fled.push(u); }
  }
  // the winners' own Routed units Fall Back too
  routedFallBack(winners);
  // only once every enemy unit has Fallen Back or Disengaged may the winners Pursue, Gun Down or Consolidate (CONFIRMED,
  // p272); until then they Hold
  if (losers.every((u) => u.destroyed || fled.includes(u) || ![...u.lockedWith].some((e) => !e.destroyed))) {
    // Pursue (D6 + I; reaching it is a successful charge) or Gun Down (a Volley) a unit that Fell Back: each gets the
    // winning unit that does most against it, and each winning unit takes one option
    for (const { u } of broken) {
      if (u.destroyed) continue;
      const free = winners.filter((p) => !p.destroyed && !p.consolidated && !p.lockedWith.size && !p.vehicle && !p.statuses.has('Pinned') && !p.statuses.has('Routed'));
      let best = null;
      for (const p of free) {
        const I = num(alive(p)[0]?.p.I, 3);
        const reach = Math.max(0, Math.min(1, (I + 6 - gap(p, u) + 1) / 6));
        // Slow and Purposeful: can't Pursue (CONFIRMED)
        const pursue = has(p.rules, 'Slow and Purposeful') ? 0 : reach * (ai.meleeEV(state, p, u) + (u.heldObjective ? ai.VP_WORTH * 0.5 : 0));
        const gun = require('./fire.cjs').planVolley(p, u, state, { snap: true, exclude: (x) => !(x.traits || []).includes('Assault') }).expectedPts;
        if (!best || Math.max(pursue, gun) > best.v) best = { p, v: Math.max(pursue, gun), kind: pursue >= gun ? 'pursue' : 'gun' };
      }
      // No Quarter (MISSION): a Victory Point instead, when it's worth more than the chase
      if (!best || best.v <= 1 || (state.mission?.has('No Quarter') && best.v < ai.VP_WORTH)) continue;
      const p = best.p;
      p.consolidated = true;
      if (best.kind === 'pursue') {
        const d = core.pursueDistance(p, state.dice);
        if (d >= gap(p, u)) lockInto(state, p, u, `pursues ${d}" and catches it`);
        else { moveUnit(state, p, u, d, { charging: true, target: u }); state.log(`    ${p.name} pursues ${d}" but ${u.name} gets away`); }
      } else shootingAttack(state, p, u, { snap: volleySnap(p), assaultOnly: true, volley: true, label: 'guns down' });
    }
    for (const u of winners) if (!u.destroyed && !u.lockedWith.size && !u.consolidated && !noQuarter(state, u)) consolidate(state, u);
  }
  // Vanguard (X): breaking a unit that was near an objective (battle.cjs)
  if (state.onBrokeFromCombat) for (const { u, nearObjective } of broken) state.onBrokeFromCombat(u, winners, nearObjective);
  done();
}
/** No Quarter (MISSION): the unit takes this Aftermath option and its player scores 1 VP. */
function noQuarter(state, u) {
  if (!state.mission?.has('No Quarter') || u.consolidated || u.destroyed) return false;
  u.consolidated = true;
  state.award(u.side, 1, `No Quarter (${u.name})`);
  return true;
}
/** Consolidate: move up to base Initiative, ignoring difficult terrain (SHEET). */
function consolidate(state, u) {
  if (u.consolidated || u.destroyed) return;
  u.consolidated = true;
  const I = num(alive(u)[0]?.p.I, 0);
  if (I <= 0) return;
  // the enemy shoots next: consolidate for safety (cover, out of sight) and for markers and Sectors, not for the
  // next charge, and with no Vanguard boldness
  const opts = { charging: false, cautious: 2, consolidating: true };
  let best = { p: { x: u.x, y: u.y }, s: ai.positionScore(state, u, { x: u.x, y: u.y }, opts) };
  for (const p of ai.candidates(state, u, I)) {
    // a Consolidation ends at least 2" from enemy models (CONFIRMED)
    if (state.units.some((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn && Math.hypot(e.x - p.x, e.y - p.y) < e.r + u.r + 2)) continue;
    const s = ai.positionScore(state, u, p, opts);
    if (s > best.s + 0.5) best = { p, s };
  }
  if (best.p.x !== u.x || best.p.y !== u.y) { moveUnit(state, u, best.p, I, { ignoreDifficult: true }); state.log(`    ${u.name} consolidates to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`); }
}
/** Disengage: a normal move away from the combat (SHEET). */
function disengage(state, u, foes) {
  unlock(u);
  const cx = foes.reduce((t, e) => t + e.x, 0) / foes.length, cy = foes.reduce((t, e) => t + e.y, 0) / foes.length;
  const away = { x: u.x + (u.x - cx) * 10, y: u.y + (u.y - cy) * 10 };
  moveUnit(state, u, away, ai.moveOf(u));
  state.log(`    ${u.name} disengages to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
}
function unlock(u) {
  for (const e of u.lockedWith) e.lockedWith.delete(u);
  u.lockedWith.clear();
}

/**
 * Collar-master (Rangdan): at the start of the Fight Sub-Phase each master may overload a collared unit within 12"
 * that is in combat: +1 Strength and Attacks (Iron Chain: +1 WS too) for the phase, then D3 wounds (Iron Chain
 * D3+1) with no saves. The AI overloads units of five or more models.
 */
function collarMasters(state) {
  const chosen = [];
  for (const m of state.units) {
    if (m.destroyed || !m.arrived || m.embarkedIn || !alive(m).some((x) => has(x.rules, 'Collar-master'))) continue;
    const reach = alive(m).some((x) => (x.items || []).includes('Collar-key of Advex-Mors')) ? 18 : 12;
    const pick = state.units.filter((u) => u.side === m.side && !u.destroyed && u.lockedWith.size && !chosen.includes(u) && alive(u).length >= 5
      && alive(u).every((x) => has(x.rules, 'Neural Collars')) && gap(m, u) <= reach).sort((a, b) => alive(b).length - alive(a).length)[0];
    if (!pick) continue;
    const iron = alive(pick).every((x) => (x.traits || []).includes('Iron Chain'));
    require('./reactions.cjs').addBuff(pick, { str: 1, attacks: 1, ws: iron ? 1 : 0 }, 'phase');
    pick.overloaded = iron ? 'iron' : 'plain';
    chosen.push(pick);
    state.log(`  ${m.name} overloads ${pick.name}'s collars (Collar-master)`);
  }
  return chosen;
}
function overloadCost(state, units) {
  for (const u of units) {
    if (u.destroyed) continue;
    const n = state.dice.d3() + (u.overloaded === 'iron' ? 1 : 0);
    u.overloaded = null;
    let lost = 0;
    for (let i = 0; i < n; i++) { const m = alive(u).find((x) => x.wounds < x.maxWounds) || alive(u)[0]; if (!m) break; m.wounds--; lost++; if (m.wounds <= 0 && state.onCasualty) state.onCasualty(m, u, null); }
    state.log(`    ${u.name}'s collars burn out: ${lost} wounds`);
    if (state.afterDamage) state.afterDamage(u);
  }
}

function assaultPhase(state, side) {
  chargeSubPhase(state, side);
  const overloaded = collarMasters(state);
  state.inFight = true;
  for (const c of combats(state)) {
    state.log(`  Combat: ${c[0].map((u) => u.name).join(', ')} vs ${c[1].map((u) => u.name).join(', ')}`);
    let tally = fight(state, c);
    // Vengeance of the First Legion: the combat is fought again and only the second round's points count
    if (state.reactions && state.reactions.vengeance(state, c, [tally.kills[0] + tally.glory[0], tally.kills[1] + tally.glory[1]])) { state.log('    the combat is fought a second time'); tally = fight(state, c, tally); }
    resolve(state, c, tally);
    // a vehicle can't be, or keep anyone, Locked in Combat: it only Holds, and both sides are free next turn (CONFIRMED)
    if (c[0].every((u) => u.destroyed || u.vehicle) || c[1].every((u) => u.destroyed || u.vehicle)) for (const s of [0, 1]) for (const u of c[s]) if (!u.destroyed) unlock(u);
  }
  state.inFight = false;
  overloadCost(state, overloaded);
}

module.exports = { assaultPhase, charge, chargeSubPhase, combats, fight, resolve, canReact, unlock, duelWith, engagedModels, outsideSupport, meleeMods, combatInitiative };
