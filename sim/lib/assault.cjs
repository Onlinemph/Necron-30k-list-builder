'use strict';
// The Assault Phase: Charge Sub-Phase (the five-step charge), Challenge Sub-Phase (rounds of Face-Off, Focus
// Roll and Strike, then Glory), Fight Sub-Phase (Initiative Steps) and Resolution Sub-Phase (Combat Resolution,
// Panic Checks and the aftermath: Fall Back, Pursue, Gun Down, Disengage, Hold, Consolidate).
// Procedure from the HH3 rule texts in the repo and the How to Play quick reference (SHEET in core.cjs).
const { num, xOf, argOf, has, rel } = require('./rules.cjs');
const { resolveGroup, meleeGroup, expectedGroup } = require('./attack.cjs');
const { shootingAttack, moraleSubPhase, preyCrit, forceCheck, vehicleDamage } = require('./shoot.cjs');
const gambits = require('./gambits.cjs');
const psychic = require('./psychic.cjs');
const { gap, dist, lineOfSight } = require('./table.cjs');
const { alive, check, addStatus, passChance } = require('./checks.cjs');
const { moveUnit, fallBack } = require('./move.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const { canReact, meleeMods, lockInto } = require('./reactions.cjs');

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
  if (!disordered) {
    const s = core.setupMove(u) + (u.cond?.has('Lost to the Nails') ? 1 : 0);
    if (s >= gap(u, t)) { lockInto(state, u, t, `reaches ${t.name} with its Set-up Move`); return true; }
    moveUnit(state, u, t, s, { charging: true, target: t });
  }
  if (at(3.5) === 'locked') return true; // Perfect Counter
  // Step 4: Shieldwall!, Warpath; Volley Attacks (Snap Shots, Assault weapons only, never statuses): the charger,
  // then the target, whose Overwatch replaces its Volley with a normal Shooting Attack
  at(4);
  const warpath = psychic.onChargeStep4(state, u, t);
  const before = alive(t).length;
  if (!disordered && !warpath && alive(u).some((m) => m.ranged.length)) shootingAttack(state, u, t, { snap: !has(u.rules, 'Firestorm'), assaultOnly: true, volley: true, label: 'volleys' });
  if (t.destroyed) return false;
  ctx.volleyKills = before - alive(t).length;
  if (pick?.replacesVolley) pick.apply(ctx);
  else if (!pick?.noVolley && alive(t).some((m) => m.ranged.length)) shootingAttack(state, t, u, { snap: !has(t.rules, 'Firestorm'), assaultOnly: true, volley: true, label: 'volleys' });
  if (u.destroyed || t.destroyed) return false;
  // end of Step 4: Evade, Better Part of Valour, Furious Charge
  const r4 = at(4.5);
  if (r4 === 'fail' || t.destroyed || u.destroyed) return false;
  if (r4 === 'locked') return true;
  // Step 5: Charge Roll (2D6, keep the highest, plus Fast)
  const need = gap(u, t);
  const roll = core.chargeRoll(u, state.dice);
  if (roll >= need) { lockInto(state, u, t, `charge roll ${roll} (needed ${need.toFixed(1)}")`); return true; }
  state.log(`    charge roll ${roll} (needed ${need.toFixed(1)}"): the charge fails`);
  // a failed charge forces a Cool Check (CONFIRMED); failing gives Stunned (SHEET)
  if (!check(state, u, 'CL', 0, 'failed charge')) addStatus(state, u, core.failedChargeStatus, 'failed charge');
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
const modelCount = (units) => units.reduce((t, u) => t + alive(u).reduce((s, m) => s + (/Walker|Paragon/.test(m.unitType) ? num(m.p.W, 1) : xOf(m.rules, 'Bulky') || 1), 0), 0);
const canChallenge = (m) => /Command|Champion|Paragon/.test(m.unitType) && !m.vehicle;
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
/** Carrion Feast (Rangdan): a wound back for each enemy model removed with a melee attack. */
const carrionFeast = (m, kills) => { if (kills && m.wounds > 0 && has(m.rules, 'Carrion Feast')) m.wounds = Math.min(m.maxWounds, m.wounds + kills); };
const hasItem = (u, re) => alive(u).some((m) => (m.items || []).some((i) => re.test(i)));
const hatredAgainst = (a, b) => { const x = argOf(a.rules, 'Hatred'); return !!x && ((b.traits || []).includes(x) || new RegExp(x).test(b.unitType)); };

// ---------- Challenge Sub-Phase ----------
// a duellist's strike, with its gambit's effects (expected: D3 counts as 2)
function strikeProfile(x, y, ex, ey, opts = {}) {
  const tgt = { models: [y.m], statuses: y.u.statuses, vehicle: false, name: y.m.name, buff: gambitBuff(y, ey) };
  let w = bestWeapon(x.m, tgt);
  if (ex.extraRules) w = Object.assign({}, w, { specialRules: [...(w.specialRules || []), ...ex.extraRules(w)] });
  const mods = Object.assign({ attacks: 0, str: 0, ws: 0 }, meleeMods(x.u) || {});
  mods.attacks += (ex.attacks || 0) + (opts.focusWinner ? 1 : 0) + (ex.attacksD3 ? (opts.d3 ? opts.d3() : 2) : 0);
  mods.str += ex.str || 0; mods.ws += ex.ws || 0;
  if (ex.matchOpp) mods.ws += Math.min(0, num(y.m.p.WS, 4) - num(x.m.p.WS, 4));
  return { tgt, w, mods, finish: (g) => {
    if (ex.single) g.attacks = 1;
    if (ex.matchOpp) g.attacks = Math.min(g.attacks, Math.max(1, num(y.m.p.A, 1)));
    if (ex.dmg) g.D += ex.dmg;
    if (ex.dmgCap1) g.D = 1;
    return g;
  } };
}
function gambitBuff(x, e) {
  if (!e || (!e.tough && !e.toughSet)) return x.u.buff;
  const b = Object.assign({ tough: 0, fnp: 7, shrouded: 7, ew: 0, attacks: 0, str: 0, ws: 0 }, x.u.buff || {});
  b.tough += e.toughSet ? Math.max(0, e.toughSet - num(x.m.p.T, 4)) : e.tough;
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

function challenge(state, c, tally) {
  const active = state.active;
  const elig = (side) => c[side].filter((u) => !u.destroyed && !u.statuses.has('Routed')).flatMap((u) => alive(u).filter(canChallenge).map((m) => ({ u, m })));
  const mine = elig(active), theirs = elig(1 - active);
  if (!mine.length || !theirs.length) return;
  let side = active, pair = bestPairing(mine, theirs);
  // the Active Player declares first; if they don't, the Reactive Player may make a Heroic Intervention (SHEET)
  if (!pair || pair.v <= 0.1) {
    const hp = bestPairing(theirs, mine);
    if (!hp || hp.v <= 0.1 || !state.reactions?.heroicIntervention(state, 1 - active, hp.a.u, hp.v)) return;
    side = 1 - active; pair = hp;
  }
  const defenders = side === active ? theirs : mine;
  const A = pair.a;
  // Warrior Pride (Sons of Horus): refuse a lesser challenger without becoming Disgraced
  if (side === active && pair.accV < 0 && state.reactions?.warriorPride(state, A, defenders, 1 - side, pair.accV)) return;
  // refusing: the challenger's player picks a model to become Disgraced (SHEET)
  if (pair.accV < -0.6) {
    const victim = defenders.reduce((b, d) => (num(d.m.p.WS, 4) > num(b.m.p.WS, 4) ? d : b), defenders[0]);
    state.log(`    ${A.m.name} issues a challenge; it is refused and ${victim.m.name} is Disgraced`);
    victim.m.disgraced = true;
    addStatus(state, victim.u, 'Disgraced', 'refused a challenge');
    return;
  }
  duel(state, A, pair.b, side, tally);
}

/** A challenge: rounds of Face-Off, Focus Roll and Strike until someone falls or the advantage holder stops. */
function duel(state, A, B, challengerSide, tally) {
  state.log(`    ${A.m.name} challenges, ${B.m.name} accepts`);
  A.m.inChallenge = B.m.inChallenge = true;
  const inflicted = new Map([[A, 0], [B, 0]]);
  const effects = new Map([[A, {}], [B, {}]]);
  const guard = new Map([[A, 0], [B, 0]]);
  let testFoe = null;
  const support = (x) => core.focusSupport(alive(x.u).length - 1 + (hasItem(x.u, /^Legion standard/i) ? 6 : 0));
  for (let round = 1; round <= 5; round++) {
    // Face-Off: each picks a gambit (the side with Challenge Advantage first; it makes no difference to the AI)
    for (const [me, opp] of [[A, B], [B, A]]) {
      const g = gambits.choose(state, me, opp, (e) => duelWith(me, opp, e, {}) - duelWith(opp, me, {}, e), { moreRounds: round < 5 });
      const e = g ? Object.assign({ name: g.name }, g.make(state, me, opp)) : {};
      effects.set(me, e);
      if (g) state.log(`      ${me.m.name} picks ${g.name}`);
    }
    // Focus Roll: D6 + Combat Initiative - wounds lost, -1 Heavy, +1 Light, +1 Shield or Company Standard,
    // + Outside Support, + gambits; the winner gets +1 Attack and Challenge Advantage
    const focus = (x) => {
      const e = effects.get(x);
      const w = bestWeapon(x.m, { models: [x === A ? B.m : A.m], vehicle: false });
      let d = state.dice.d6();
      if (e.focusDice) { const d2 = state.dice.d6(); d = e.focusDice === 'high' ? Math.max(d, d2) : Math.min(d, d2); }
      return d + combatInitiative(x.u, x.m, w) - (x.m.maxWounds - x.m.wounds) - (/Heavy/.test(x.m.unitType) ? 1 : 0) + (/Light/.test(x.m.unitType) ? 1 : 0)
        + ((x.m.traits || []).includes('Shield') || hasItem(x.u, /Company Standard/i) ? 1 : 0) + support(x) + (xOf(w.specialRules, "Duellist's Edge") || 0)
        + (e.focus || 0) + guard.get(x);
    };
    let fa = focus(A), fb = focus(B);
    while (fa === fb) { fa = focus(A); fb = focus(B); }
    const winner = fa > fb ? A : B;
    const adv = testFoe || winner;
    testFoe = null;
    guard.set(A, 0); guard.set(B, 0);
    // Strike: the side with Challenge Advantage first
    for (const [x, y] of [[adv, adv === A ? B : A], [adv === A ? B : A, adv]]) {
      if (x.m.wounds <= 0 || y.m.wounds <= 0) continue;
      const ex = effects.get(x), ey = effects.get(y);
      const s = strikeProfile(x, y, ex, ey, { focusWinner: x === winner, d3: () => state.dice.d3() });
      let w = s.w;
      if (has(w.specialRules, 'Force')) w = forceCheck(state, x.u, x.m, w);
      const g = s.finish(meleeGroup(x.m, w, s.tgt, { charged: x.u.turn.charged, mods: s.mods }));
      const before = y.m.wounds;
      const r = resolveGroup(g, s.tgt, { dice: state.dice, preyCrit: preyCrit(x.u, y.u), hatred: hatredAgainst(x.u, y.u), onKill: (m) => state.onCasualty && state.onCasualty(m, y.u, x.u) });
      inflicted.set(x, inflicted.get(x) + (before - y.m.wounds));
      tally.kills[x.u.side] += r.kills;
      carrionFeast(x.m, r.kills);
      if (ey.guardUp) guard.set(y, guard.get(y) + Math.max(0, g.attacks - r.hits));
      if (y.m.wounds <= 0 && ex.onKill) ex.onKill(state, x, y);
    }
    if (effects.get(A).testFoe) testFoe = A; else if (effects.get(B).testFoe) testFoe = B;
    if (A.m.wounds <= 0 || B.m.wounds <= 0) break;
    // the side with Challenge Advantage decides whether to fight another round
    const other = adv === A ? B : A;
    if (duelEdge(adv, other) <= 0.05) break;
  }
  // Glory: the duellist who inflicted the most wounds scores them, or the slain enemy's full Wounds (SHEET)
  const [ia, ib] = [inflicted.get(A), inflicted.get(B)];
  if (ia !== ib) {
    const [win, lose] = ia > ib ? [A, B] : [B, A];
    const glory = lose.m.wounds <= 0 ? lose.m.maxWounds : inflicted.get(win);
    tally.glory[win.u.side] += glory + (effects.get(win).crpIfWin || 0);
    state.log(`      ${win.m.name} wins the challenge: ${glory} Glory`);
    // Cut Off the Head (MISSION): winning a challenge by slaying the enemy model scores 2 VP
    if (lose.m.wounds <= 0 && state.mission?.has('Cut Off the Head')) state.award(win.u.side, 2, `Cut Off the Head (${lose.m.name})`);
  }
  state.log(`      ${A.m.name} ${A.m.wounds}/${A.m.maxWounds} wounds, ${B.m.name} ${B.m.wounds}/${B.m.maxWounds} wounds`);
  for (const u of [A.u, B.u]) if (state.afterDamage) state.afterDamage(u);
}

// ---------- Fight Sub-Phase ----------
function fight(state, c) {
  const tally = { kills: [0, 0], glory: [0, 0] };
  challenge(state, c, tally);
  // each unit attacks the locked enemy unit it hurts most
  const strikers = [];
  for (const side of [0, 1]) for (const u of c[side]) {
    if (u.destroyed) continue;
    const foes = [...u.lockedWith].filter((e) => !e.destroyed);
    if (!foes.length) continue;
    const t = foes.reduce((b, e) => (ai.meleeEV(state, u, e) > ai.meleeEV(state, u, b) ? e : b), foes[0]);
    for (const m of alive(u)) {
      if (m.inChallenge || m.vehicle || !m.melee.length) continue;
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
      tally.kills[s.u.side] += r.kills;
      carrionFeast(s.m, r.kills);
      for (const st of r.vehicleStatuses) vehicleDamage(state, t, st);
    }
    for (const side of [0, 1]) for (const u of c[side]) if (state.afterDamage) state.afterDamage(u);
  }
  for (const side of [0, 1]) for (const u of c[side]) for (const m of u.models) m.inChallenge = false;
  return tally;
}

// ---------- Resolution Sub-Phase ----------
function resolve(state, c, tally) {
  const live = [c[0].filter((u) => !u.destroyed), c[1].filter((u) => !u.destroyed)];
  // Massacre: the enemy is wiped out; the winners Consolidate (SHEET), or take No Quarter (MISSION)
  if (!live[0].length || !live[1].length) {
    for (const s of [0, 1]) for (const u of live[s]) { unlock(u); if (!noQuarter(state, u)) consolidate(state, u); }
    return;
  }
  // Combat Resolution: models removed, Glory, outnumbering, standards (SHEET, CONFIRMED for the standards)
  const score = [0, 1].map((s) => tally.kills[s] + tally.glory[s] + live[s].reduce((t, u) => t + (hasItem(u, /^Vexilla/i) ? 1 : 0) + (hasItem(u, /^Legion standard/i) ? 2 : 0), 0));
  const mc = [modelCount(live[0]), modelCount(live[1])];
  if (mc[0] > mc[1]) score[0] += core.outnumberBonus; else if (mc[1] > mc[0]) score[1] += core.outnumberBonus;
  state.log(`    combat resolution ${score[0]}–${score[1]}`);
  if (score[0] === score[1]) return; // a draw: everyone Holds
  const w = score[0] > score[1] ? 0 : 1, l = 1 - w;
  const diff = Math.abs(score[0] - score[1]);
  const winners = live[w];
  for (const u of live[l]) {
    if (u.destroyed) continue;
    const foes = [...u.lockedWith].filter((e) => !e.destroyed);
    if (check(state, u, 'LD', diff, 'Panic Check, lost the combat')) {
      // passed: Hold, or Disengage with a normal move away if the next round looks bad (SHEET; not while Pinned)
      const give = foes.reduce((t, e) => t + ai.meleeEV(state, u, e), 0), take = foes.reduce((t, e) => t + ai.meleeEV(state, e, u), 0);
      if (!u.statuses.has('Pinned') && take > 1.5 * give + 5) disengage(state, u, foes);
      continue;
    }
    // failed: Routed, and it Falls Back
    addStatus(state, u, 'Routed', 'lost the combat');
    const nearObjective = u.heldObjective || null;
    unlock(u);
    fallBack(state, u);
    if (u.destroyed) continue;
    // the winners' aftermath: Pursue (D6 + I; reaching it is a successful charge) or Gun Down (a Volley)
    const free = foes.filter((p) => !p.destroyed && !p.lockedWith.size && !p.vehicle && !p.statuses.has('Pinned') && !p.statuses.has('Routed'));
    let best = null;
    for (const p of free) {
      const I = num(alive(p)[0]?.p.I, 3);
      const reach = Math.max(0, Math.min(1, (I + 6 - gap(p, u) + 1) / 6));
      const pursue = reach * (ai.meleeEV(state, p, u) + (u.heldObjective ? ai.VP_WORTH * 0.5 : 0));
      const gun = require('./fire.cjs').planVolley(p, u, state, { snap: true, exclude: (x) => !(x.traits || []).includes('Assault') }).expectedPts;
      if (!best || Math.max(pursue, gun) > best.v) best = { p, v: Math.max(pursue, gun), kind: pursue >= gun ? 'pursue' : 'gun' };
    }
    // No Quarter (MISSION): a Victory Point instead, when it's worth more than the chase
    const nq = state.mission?.has('No Quarter') && foes.every((f) => f.destroyed || !f.lockedWith.size || f === u);
    if (best && best.v > 1 && !(nq && best.v < ai.VP_WORTH)) {
      const p = best.p;
      if (best.kind === 'pursue') {
        const d = core.pursueDistance(p, state.dice);
        if (d >= gap(p, u)) lockInto(state, p, u, `pursues ${d}" and catches it`);
        else { moveUnit(state, p, u, d, { charging: true, target: u }); state.log(`    ${p.name} pursues ${d}" but ${u.name} gets away`); }
      } else shootingAttack(state, p, u, { snap: true, assaultOnly: true, volley: true, label: 'guns down' });
    }
    if (state.onBrokeFromCombat) state.onBrokeFromCombat(u, winners, nearObjective);
  }
  // winners with nobody left to fight Consolidate, or take No Quarter once every enemy has fallen back or disengaged
  for (const s of [0, 1]) for (const u of c[s]) if (!u.destroyed && u.lockedWith.size && ![...u.lockedWith].some((e) => !e.destroyed)) unlock(u);
  const allGone = live[l].every((u) => u.destroyed || !u.lockedWith.size);
  for (const u of winners) if (!u.destroyed && !u.lockedWith.size && !u.consolidated && !(allGone && noQuarter(state, u))) consolidate(state, u);
  for (const s of [0, 1]) for (const u of c[s]) u.consolidated = false;
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
  let best = { p: { x: u.x, y: u.y }, s: ai.positionScore(state, u, { x: u.x, y: u.y }) };
  for (const p of ai.candidates(state, u, I)) {
    if (state.units.some((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn && Math.hypot(e.x - p.x, e.y - p.y) < e.r + u.r + 1)) continue;
    const s = ai.positionScore(state, u, p);
    if (s > best.s + 0.5) best = { p, s };
  }
  if (best.p.x !== u.x || best.p.y !== u.y) { moveUnit(state, u, best.p, I); state.log(`    ${u.name} consolidates to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`); }
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
    if (state.reactions && state.reactions.vengeance(state, c, [tally.kills[0] + tally.glory[0], tally.kills[1] + tally.glory[1]])) { state.log('    the combat is fought a second time'); tally = fight(state, c); }
    resolve(state, c, tally);
  }
  state.inFight = false;
  overloadCost(state, overloaded);
}

module.exports = { assaultPhase, charge, chargeSubPhase, combats, fight, resolve, canReact, unlock, duelWith };
