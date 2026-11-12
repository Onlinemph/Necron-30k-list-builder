'use strict';
// The Assault Phase: Charge Sub-Phase (the five-step charge with Overwatch and Volleys), Challenge Sub-Phase
// (Focus Roll and Strike Step), Fight Sub-Phase (Initiative Steps) and Resolution Sub-Phase (Panic Checks,
// Fall Back, Pursue).
const { num, xOf, argOf, has, rel, hitNeedWS } = require('./rules.cjs');
const { resolveGroup, meleeGroup, expectedGroup } = require('./attack.cjs');
const { shootingAttack, preyCrit, forceCheck } = require('./shoot.cjs');
const gambits = require('./gambits.cjs');
const psychic = require('./psychic.cjs');
const { gap, dist } = require('./table.cjs');
const { alive, check, addStatus, charOf } = require('./checks.cjs');
const { moveUnit, fallBack } = require('./move.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const { canReact, meleeMods } = require('./reactions.cjs');

// ---------- Charge Sub-Phase ----------
/** Make a charge from u at t. Returns true if the units end Locked in Combat. */
function charge(state, u, t) {
  state.log(`  ${u.name} declares a charge at ${t.name} (${gap(u, t).toFixed(1)}" away${u.turn.disordered ? ', Disordered' : ''})`);
  // the target's reaction, if any, and the step of the charge it happens in (reactions.cjs)
  const pick = state.reactions ? state.reactions.onCharge(state, u, t) : null;
  const ctx = { volleyKills: 0 };
  const at = (step) => (pick && pick.step === step ? pick.apply(ctx) : undefined);
  // Step 2: Overwatch, The Choir Answers, Twisted Desire
  if (at(2) === 'fail' || u.destroyed || t.destroyed) return false;
  // Step 3: Spite of the Gorgon, Selfless Burden; then the Set-up Move (skipped by a Disordered Charge)
  at(3);
  if (u.destroyed || t.destroyed) return false;
  if (!u.turn.disordered) {
    const g = gap(u, t);
    const step = Math.min(core.setupMove(u) + (u.cond?.has('Lost to the Nails') ? 1 : 0), Math.max(0, g - 1));
    if (step > 0) moveUnit(state, u, t, step, { charging: true, target: t });
  }
  if (at(3.5) === 'locked') return true; // Perfect Counter
  // Step 4: Shieldwall!; Volley Attacks (Snap Shots, Assault weapons only): the charger, then the target
  at(4);
  const warpath = psychic.onChargeStep4(state, u, t);
  const before = alive(t).length;
  if (!warpath && alive(u).some((m) => m.ranged.length)) shootingAttack(state, u, t, { snap: !has(u.rules, 'Firestorm'), assaultOnly: true, label: 'volleys' });
  if (t.destroyed) return false;
  ctx.volleyKills = before - alive(t).length;
  if (!pick?.noVolley && !t.statuses.has('Routed') && alive(t).some((m) => m.ranged.length)) shootingAttack(state, t, u, { snap: !has(t.rules, 'Firestorm'), assaultOnly: true, label: 'volleys' });
  if (u.destroyed) return false;
  // end of Step 4: Evade, Better Part of Valour, Furious Charge
  const r4 = at(4.5);
  if (r4 === 'fail' || t.destroyed) return false;
  if (r4 === 'locked') return true;
  // Step 5: Charge Roll (2D6, discard the lowest, plus Fast)
  const need = gap(u, t);
  const roll = core.chargeRoll(u, state.dice);
  if (roll >= need) {
    // charge move into base contact
    const d = dist(u, t) || 1;
    const k = (u.r + t.r) / d;
    u.x = t.x + (u.x - t.x) * k; u.y = t.y + (u.y - t.y) * k;
    u.lockedWith.add(t); t.lockedWith.add(u);
    u.turn.charged = true;
    state.log(`    charge roll ${roll} (needed ${need.toFixed(1)}"): ${u.name} is Locked in Combat with ${t.name}`);
    return true;
  }
  state.log(`    charge roll ${roll} (needed ${need.toFixed(1)}"): the charge fails`);
  // a failed Charge Roll forces a Cool Check (CONFIRMED); the status is an ASSUMPTION
  if (!check(state, u, 'CL', 0, 'failed charge')) addStatus(state, u, core.failedChargeStatus, 'failed charge');
  return false;
}

function chargeSubPhase(state, side) {
  const units = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn && !u.lockedWith.size);
  // the most dangerous chargers go first
  units.sort((a, b) => ai.meleeValue(state, b, state.units.filter((e) => e.side !== side && !e.destroyed)) - ai.meleeValue(state, a, state.units.filter((e) => e.side !== side && !e.destroyed)));
  for (const u of units) {
    if (u.destroyed || u.lockedWith.size) continue;
    // Lost to the Nails: must charge the closest enemy within 12", or the condition ends (CONFIRMED)
    if (u.cond?.has('Lost to the Nails')) {
      const near = state.units.filter((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn && gap(u, e) <= 12).sort((a, b) => gap(u, a) - gap(u, b));
      if (near.length && ai.canCharge(u)) { charge(state, u, near[0]); continue; }
      if (!near.length) { u.cond.delete('Lost to the Nails'); require('./reactions.cjs').refresh(u); }
    }
    const t = ai.chooseCharge(state, u);
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
const modelCount = (units) => units.reduce((t, u) => t + alive(u).reduce((s, m) => s + (/Walker|Paragon/.test(m.unitType) ? num(m.p.W, 1) : xOf(m.rules, 'Bulky') || 1), 0), 0);
const canChallenge = (m) => /Command|Champion|Paragon/.test(m.unitType);
const combatInitiative = (unit, m, w) => (unit.statuses.size && core.status.anyFightsAtI1 ? 1 : rel(w.IM, num(m.p.I, 1)));
function bestWeapon(m, target) {
  let best = m.melee.find((w) => target.vehicle || !has(w.specialRules, 'Detonation')) || m.melee[0], bv = -1;
  for (const w of m.melee) {
    if (has(w.specialRules, 'Detonation') && !target.vehicle) continue;
    const v = expectedGroup(meleeGroup(m, w, target, {}), target);
    if (v > bv) { bv = v; best = w; }
  }
  return best;
}

// ---------- Challenge Sub-Phase ----------
function challenge(state, c, crp) {
  const active = state.active;
  const mine = c[active].flatMap((u) => alive(u).filter(canChallenge).map((m) => ({ u, m })));
  const theirs = c[1 - active].flatMap((u) => alive(u).filter(canChallenge).map((m) => ({ u, m })));
  if (!mine.length || !theirs.length) return;
  // the challenger with the best duel against whoever is most likely to accept
  let best = null;
  for (const a of mine) for (const b of theirs) {
    const v = ai.duelEV(a.m, b.m) / Math.max(1, b.m.wounds) - ai.duelEV(b.m, a.m) / Math.max(1, a.m.wounds);
    if (!best || v > best.v) best = { a, b, v };
  }
  if (!best || best.v <= 0.1) return;
  // the opponent accepts with their best duellist, or refuses (the refuser is Disgraced and sits this fight out: ASSUMPTION)
  let acc = null;
  for (const b of theirs) { const v = ai.duelEV(b.m, best.a.m) / Math.max(1, best.a.m.wounds) - ai.duelEV(best.a.m, b.m) / Math.max(1, b.m.wounds); if (!acc || v > acc.v) acc = { b, v }; }
  // Warrior Pride (Sons of Horus): refuse a lesser challenger without becoming Disgraced
  if (acc.v < 0 && state.reactions && state.reactions.warriorPride(state, best.a, theirs, 1 - active, acc.v)) return;
  if (acc.v < -0.6) {
    acc.b.m.disgraced = true;
    state.log(`    ${best.a.m.name} issues a challenge; ${acc.b.m.name} refuses and is Disgraced`);
    return;
  }
  const A = best.a, B = acc.b;
  state.log(`    ${A.m.name} challenges, ${B.m.name} accepts`);
  // Focus Roll: D6 + Combat Initiative - wounds lost - 1 if Heavy (+ Outside Support: ASSUMPTION +1 per 5 friendly models, max 2)
  const wA = bestWeapon(A.m, { models: [B.m], vehicle: false }), wB = bestWeapon(B.m, { models: [A.m], vehicle: false });
  const support = (side) => Math.min(2, Math.floor(modelCount(c[side]) / 5));
  // Face-Off: each duellist may pick a Gambit (gambits.cjs)
  const fx = new Map();
  for (const [me, opp] of [[A, B], [B, A]]) {
    const duel = (e) => duelWith(me, opp, e, {}) - duelWith(opp, me, {}, e);
    const g = gambits.choose(state, me, opp, duel);
    if (!g) { fx.set(me, {}); continue; }
    state.log(`      ${me.m.name} picks the ${g.name} Gambit`);
    fx.set(me, Object.assign({ name: g.name }, g.make(state, me, opp)));
  }
  const focus = (x, w, side) => state.dice.d6() + combatInitiative(x.u, x.m, w) - (x.m.maxWounds - x.m.wounds) - (/Heavy/.test(x.m.unitType) ? 1 : 0) + support(side) + (xOf(w.specialRules, "Duellist's Edge") || 0) + (fx.get(x).focus || 0);
  let fa = focus(A, wA, active), fb = focus(B, wB, 1 - active);
  while (fa === fb) { fa = focus(A, wA, active); fb = focus(B, wB, 1 - active); }
  const order = fa > fb ? [A, B] : [B, A];
  const before = [A.m.wounds, B.m.wounds];
  for (const [x, y] of [[order[0], order[1]], [order[1], order[0]]]) {
    if (x.m.wounds <= 0 || y.m.wounds <= 0) continue;
    const ex = fx.get(x), ey = fx.get(y);
    const tgt = { models: [y.m], statuses: y.u.statuses, vehicle: false, name: y.m.name, buff: gambitBuff(y, ey) };
    let w = gambitWeapon(bestWeapon(x.m, tgt), ex);
    if (has(w.specialRules, 'Force')) w = forceCheck(state, x.u, x.m, w);
    const mods = Object.assign({}, meleeMods(x.u) || {}); mods.attacks = (mods.attacks || 0) + (ex.attacks || 0);
    const g = meleeGroup(x.m, w, tgt, { charged: x.u.turn.charged, mods });
    const r = resolveGroup(g, tgt, { dice: state.dice, preyCrit: preyCrit(x.u, y.u), hatred: hatredAgainst(x.u, y.u), onKill: (m) => state.onCasualty && state.onCasualty(m, y.u, x.u) });
    crp[x.u.side] += r.damage;
    if (y.m.wounds <= 0 && ex.onKill) ex.onKill(state, x, y);
  }
  A.m.inChallenge = B.m.inChallenge = true;
  state.log(`      ${A.m.name} ${before[0]}→${A.m.wounds} wounds, ${B.m.name} ${before[1]}→${B.m.wounds} wounds`);
  for (const u of [A.u, B.u]) if (state.afterDamage) state.afterDamage(u);
}
// a gambit's effects on a duellist's weapon and on the opponent's Toughness
const gambitWeapon = (w, e) => (e && e.extraRules ? Object.assign({}, w, { specialRules: [...(w.specialRules || []), ...e.extraRules(w)] }) : w);
function gambitBuff(x, e) {
  if (!e || (!e.tough && !e.toughSet)) return x.u.buff;
  const b = Object.assign({ tough: 0, fnp: 7, shrouded: 7, ew: 0, attacks: 0, str: 0, ws: 0 }, x.u.buff || {});
  b.tough += e.toughSet ? Math.max(0, e.toughSet - num(x.m.p.T, 4)) : e.tough;
  return b;
}
/** Expected wounds `me` deals `opp` in one Strike Step with these gambit effects (for choosing a gambit). */
function duelWith(me, opp, eMe, eOpp) {
  const tgt = { models: [opp.m], vehicle: false, buff: gambitBuff(opp, eOpp) };
  let best = 0;
  for (const w0 of me.m.melee) {
    const w = gambitWeapon(w0, eMe);
    best = Math.max(best, expectedGroup(meleeGroup(me.m, w, tgt, { mods: { attacks: eMe.attacks || 0 } }), tgt));
  }
  return Math.min(best, opp.m.wounds);
}
const hatredAgainst = (a, b) => { const x = argOf(a.rules, 'Hatred'); return !!x && ((b.traits || []).includes(x) || new RegExp(x).test(b.unitType)); };

// ---------- Fight Sub-Phase ----------
function fight(state, c) {
  const crp = [0, 0];
  challenge(state, c, crp);
  // each unit attacks the locked enemy unit it hurts most
  const strikers = [];
  for (const side of [0, 1]) for (const u of c[side]) {
    if (u.destroyed) continue;
    const foes = [...u.lockedWith].filter((e) => !e.destroyed);
    if (!foes.length) continue;
    const t = foes.reduce((b, e) => (ai.meleeEV(state, u, e) > ai.meleeEV(state, u, b) ? e : b), foes[0]);
    for (const m of alive(u)) {
      if (m.inChallenge || m.disgraced || m.vehicle || !m.melee.length) continue;
      const w = bestWeapon(m, t);
      strikers.push({ u, m, t, w, step: combatInitiative(u, m, w) + (u.turn.charged && argOf(w.specialRules, 'Impact') === 'IM' ? 1 : 0) });
    }
  }
  const outnumbered = (side) => modelCount(c[side]) < modelCount(c[1 - side]);
  const steps = [...new Set(strikers.map((s) => s.step))].sort((a, b) => b - a);
  for (const step of steps) {
    // everyone at this step strikes, even if killed by another blow at the same step
    const now = strikers.filter((s) => s.step === step && s.m.wounds > 0);
    for (const s of now) {
      let t = s.t;
      if (t.destroyed || !alive(t).length) { const alt = [...s.u.lockedWith].find((e) => !e.destroyed && alive(e).length); if (!alt) continue; t = alt; }
      let w = s.w;
      if (has(w.specialRules, 'Force')) w = forceCheck(state, s.u, s.m, w);
      const g = meleeGroup(s.m, w, t, { charged: s.u.turn.charged, outnumbered: outnumbered(s.u.side), mods: meleeMods(s.u) });
      const r = resolveGroup(g, t, { dice: state.dice, preyCrit: preyCrit(s.u, t), hatred: hatredAgainst(s.u, t), onKill: (m) => state.onCasualty && state.onCasualty(m, t, s.u) });
      crp[s.u.side] += r.damage;
      for (const st of r.vehicleStatuses) addStatus(state, t, st, 'Vehicle Damage');
      s.hit = (s.hit || 0) + r.damage;
    }
    for (const side of [0, 1]) for (const u of c[side]) if (state.afterDamage) state.afterDamage(u);
  }
  for (const side of [0, 1]) for (const u of c[side]) for (const m of u.models) { m.inChallenge = false; m.disgraced = false; }
  return crp;
}

// ---------- Resolution Sub-Phase ----------
function resolve(state, c, crp) {
  const live = [c[0].filter((u) => !u.destroyed), c[1].filter((u) => !u.destroyed)];
  if (!live[0].length || !live[1].length) { for (const s of [0, 1]) for (const u of live[s]) unlock(u); return; }
  const score = [crp[0], crp[1]];
  const mc = [modelCount(live[0]), modelCount(live[1])];
  if (mc[0] > mc[1]) score[0] += core.outnumberBonus; else if (mc[1] > mc[0]) score[1] += core.outnumberBonus;
  state.log(`    combat resolution ${score[0]}–${score[1]}`);
  if (score[0] === score[1]) return;
  const w = score[0] > score[1] ? 0 : 1, l = 1 - w;
  const diff = Math.abs(score[0] - score[1]);
  for (const u of live[l]) {
    if (u.destroyed) continue;
    const pass = check(state, u, 'LD', diff, 'Panic Check, lost the combat');
    if (pass) continue;
    if (!addStatus(state, u, 'Routed', 'lost the combat') && !u.statuses.has('Routed')) continue;
    // the loser Falls Back; a winner may Pursue and catch it (Massacred: ASSUMPTION)
    const nearObjective = state.table.objectives.some((o) => Math.hypot(o.x - u.x, o.y - u.y) - u.r <= core.CONTROL_RANGE);
    const pursuers = live[w].filter((x) => !x.destroyed && !has(x.rules, 'Slow and Purposeful') && !x.vehicle);
    unlock(u);
    const fled = fallBack(state, u);
    if (u.destroyed) continue;
    const p = pursuers[0];
    if (p) {
      const pr = core.pursueDistance(p, state.dice);
      if (pr >= fled) {
        state.log(`    ${p.name} pursues (${pr}") and cuts ${u.name} down`);
        for (const m of u.models) if (m.wounds > 0) { m.wounds = 0; if (state.onCasualty) state.onCasualty(m, u, p); }
        if (state.afterDamage) state.afterDamage(u);
      } else state.log(`    ${p.name} pursues (${pr}") but ${u.name} gets away`);
    }
    if (state.onBrokeFromCombat) state.onBrokeFromCombat(u, live[w], nearObjective);
  }
  for (const s of [0, 1]) for (const u of c[s]) if (!u.destroyed && ![...u.lockedWith].some((e) => !e.destroyed)) unlock(u);
}
function unlock(u) {
  for (const e of u.lockedWith) e.lockedWith.delete(u);
  u.lockedWith.clear();
}

function assaultPhase(state, side) {
  chargeSubPhase(state, side);
  for (const c of combats(state)) {
    state.log(`  Combat: ${c[0].map((u) => u.name).join(', ')} vs ${c[1].map((u) => u.name).join(', ')}`);
    let crp = fight(state, c);
    // Vengeance of the First Legion: the combat is fought again and only the second round's points count
    if (state.reactions && state.reactions.vengeance(state, c, crp)) { state.log('    the combat is fought a second time'); crp = fight(state, c); }
    resolve(state, c, crp);
  }
}

module.exports = { assaultPhase, charge, chargeSubPhase, combats, fight, resolve, canReact, unlock };
