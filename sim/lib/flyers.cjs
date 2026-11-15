'use strict';
// Flyers (CONFIRMED, rulebook pp. 224-228, and the Flyer Sub-Type text in data/bsdata/common.json). A Flyer begins
// the battle in Aerial Reserves and never moves or fights like other models: once its Aerial Reserves Test is passed
// it must take a Combat Assignment, is placed at once on the battlefield edge in its own Deployment Zone (which may
// be Intercepted), makes the assignment's move in the Move Sub-Phase (which may draw a Combat Air Patrol), shoots
// with the weapons the assignment allows, and goes back to Aerial Reserves at the end of its Shooting Phase. It is
// never on the battlefield in the Assault Phase, the Victory Sub-Phase or the enemy's turn, so it never holds
// objectives, charges or is charged.
//
// CONFIRMED (rulebook):
// - Aerial Reserves Tests start in the first Battle Turn at 3+, one higher (to 6+ at most) for each time the Flyer
//   has gone back to Aerial Reserves; only rules that name Aerial Reserves change them, so the pack's automatic pass
//   from Battle Turn 4 doesn't apply, nor does Chosen of the Khagan. Vox-interlink (it names them) and Lotara
//   Sarrin's Coordinate do.
// - Drop Mission: up to its Movement straight forwards, then the units aboard may disembark; Defensive Weapons only.
//   If an Intercept destroys it, each model aboard rolls a D6 and takes an AP 2, Damage 2 wound on a 1 (only
//   Invulnerable Saves), besides the Emergency Disembarkation.
// - Extraction Mission: a Transport with nobody aboard; up to its Movement straight forwards, then a friendly unit
//   with all its models within 2" may embark (whatever its statuses); Defensive Weapons only; back in Aerial Reserves
//   the unit loses its Tactical Statuses.
// - Strike Mission: up to its Movement straight forwards; only Centreline Mounted or Guided Missile weapons, the
//   Centreline ones as Snap Shots.
// - Strafing Run: up to half its Movement in any direction; any weapon.
// - Attacks at a Flyer on a Drop, Extraction or Strike assignment are Snap Shots; on a Strafing Run they aren't
//   (Skyfire ignores the Snap Shots).
// - Combat Air Patrol (Advanced Reaction, 1 point): when the Active Player brings a unit in from Aerial Reserves, a
//   unit of the Reactive Player's made entirely of Interceptor models, waiting in Aerial Reserves, is placed on any
//   battlefield edge after the target's move, moves up to its Movement straight forwards, shoots the target, and goes
//   back to Aerial Reserves.
// - A Flyer's move ignores terrain but may not end in Impassable Terrain, a Terrain Feature or a Building; it moves
//   through models, and doesn't block Line of Sight (table.cjs) or the movement of others.
// - The Stable Sub-Type counts as Stationary for shooting after any move but a Rush.
// - A Flyer in Aerial Reserves at the end of the battle isn't destroyed (scoring.cjs).
//
// ASSUMPTIONS: a weapon's mount is read from the wargear item's name ("Centreline Mounted ..."); a Centreline Mounted
// weapon with the Guided Missile Trait still fires Snap Shots in a Strike Mission (the text makes every Centreline
// weapon fire Snap Shots); "any attacks made at the Model" covers every attack while it's on that assignment, not just
// the Intercept's; going back to Aerial Reserves after a Combat Air Patrol also raises the Flyer's Reserves target;
// the units aboard a Flyer in Aerial Reserves share its Aerial Reserves; a unit can embark on an Extraction if its
// footprint is within 2" of the Flyer's. The AI never removes a Flyer from the battle instead of returning it, and
// never embarks a unit on a Flyer waiting in Aerial Reserves during the battle (only at deployment, battle.cjs).
const { has, xOf } = require('./rules.cjs');
const { gap, inside, W, H } = require('./table.cjs');
const { alive, canHold } = require('./checks.cjs');
const { planVolley, rangeOf } = require('./fire.cjs');
const { EDGE, inArea } = require('./mission.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');

const AERIAL_TEST = 3, AERIAL_MAX = 6;
const isFlyer = (u) => /Flyer/.test(u.unitType || '');
/** The Aerial Reserves Test's target number: 3+, one higher for each return, 6+ at most (CONFIRMED). */
const reservesTarget = (u) => Math.min(AERIAL_MAX, AERIAL_TEST + (u.aerialReturns || 0));
const strafing = (u) => !!u && u.assignment === 'strafing';
/**
 * Must attacks at this unit be Snap Shots because it's a Flyer? Yes on a Drop, Extraction or Strike assignment (or
 * none), not on a Strafing Run (CONFIRMED). Skyfire is the shooter's business (shoot.cjs).
 */
const snapAgainst = (target) => isFlyer(target) && !strafing(target);

const enemiesOn = (state, side) => state.units.filter((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn);
const inset = (p, r) => ({ x: Math.min(W - r, Math.max(r, p.x)), y: Math.min(H - r, Math.max(r, p.y)) });
/** Edge points of a side's Deployment Zone, where its Flyers come on. */
const zoneEdge = (state, side) => { const pts = EDGE.filter((p) => inArea(state.zoneOf[side], p)); return pts.length ? pts : EDGE; };
const nearest = (pts, p) => pts.reduce((b, q) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? q : b), pts[0]);

/** Can a Flyer end a move at p? Not in Impassable Terrain, a Terrain Feature or a Building, nor on another unit. */
function freeAt(state, f, p) {
  if (p.x < f.r - 1e-6 || p.x > W - f.r + 1e-6 || p.y < f.r - 1e-6 || p.y > H - f.r + 1e-6) return false;
  if (state.table.pieces.some((r) => (r.impassable || r.kind === 'ruin' || r.kind === 'building') && inside(p, r))) return false;
  return state.units.every((x) => x === f || x.destroyed || !x.arrived || x.embarkedIn || Math.hypot(x.x - p.x, x.y - p.y) >= x.r + f.r + (x.side !== f.side ? 1 : 0.3));
}
/** Where a move from `from` towards `to` of at most `reach` inches can end: the farthest free point on the way. */
function landing(state, f, from, to, reach) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const k = d > 0 ? Math.min(1, reach / d) : 0;
  const end = inset({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }, f.r);
  const len = Math.hypot(end.x - from.x, end.y - from.y);
  for (let back = 0; back <= len; back += 1) {
    const t = len > 0 ? (len - back) / len : 0;
    const p = { x: from.x + (end.x - from.x) * t, y: from.y + (end.y - from.y) * t };
    if (freeAt(state, f, p)) return p;
  }
  return null;
}
/** Run fn with unit u standing at p (for the AI's estimates). */
function at(u, p, fn) {
  const sx = u.x, sy = u.y;
  u.x = p.x; u.y = p.y;
  try { return fn(); } finally { u.x = sx; u.y = sy; }
}

// ---------- weapons by Combat Assignment ----------
/** The base names of the weapons a model carries Centreline Mounted, from its wargear items (ASSUMPTION). */
function centrelineOf(u, m) {
  if (m._centreline) return m._centreline;
  const out = new Set();
  const items = (m.items || []).filter((i) => /Centreline Mounted/i.test(i));
  if (items.length) {
    const { loadArmyData, resolveItem } = require('./army.cjs');
    const { weapons } = loadArmyData(u.armyId);
    for (const i of items) for (const w of resolveItem(weapons, i.replace(/^(\d+|one|two|three|four|five|six)\s+/i, '')).ranged) out.add(w.base || w.name);
  }
  m._centreline = out;
  return out;
}
const guided = (w) => (w.traits || []).some((t) => /^Guided/i.test(t));
/**
 * What a Flyer on this assignment may fire: { filter(model, weapon), snap }. A Strike Mission fires its Centreline
 * Mounted weapons as Snap Shots; if it only has Guided Missile weapons that aren't Centreline Mounted, those fire
 * normally. Returns options to compare for a Strike Mission.
 */
function fireOptions(u, kind) {
  if (kind === 'strafing') return [{ filter: () => true, snap: false }];
  if (kind === 'drop' || kind === 'extraction') return [{ filter: (m, w) => core.isDefensive(w), snap: false }];
  if (kind !== 'strike') return [];
  const centre = (m, w) => centrelineOf(u, m).has(w.base || w.name);
  return [
    { filter: (m, w) => centre(m, w) || guided(w), snap: true },
    { filter: (m, w) => guided(w) && !centre(m, w), snap: false },
  ];
}
/** Run fn while each model of u carries only the weapons `filter` allows. */
function withWeapons(u, filter, fn) {
  const saved = u.models.map((m) => m.ranged);
  for (const m of u.models) m.ranged = m.ranged.filter((w) => filter(m, w));
  try { return fn(); } finally { u.models.forEach((m, i) => { m.ranged = saved[i]; }); }
}

/** The best target for unit u from where it stands, with these weapons: { target, v } or null. */
function bestTarget(state, u, snap) {
  const ai = require('./ai.cjs');
  let best = null;
  for (const e of enemiesOn(state, u.side)) {
    if (e.lockedWith.size) continue;
    const plan = planVolley(u, e, state, { stationary: !!u.turn.stationary, snap: snap || core.snapOnly(u) || (legions.is(e, 'Raven Guard') && gap(u, e) >= 18) });
    if (!plan.picks.length) continue;
    let v = plan.expectedPts + ai.statusValue(state, u, e, plan);
    // Destroy the Enemy: finishing a unit scores its Kill Points (as ai.chooseTarget)
    if (state.mission.primary === 'destroy') {
      const left = alive(e).reduce((t, m) => t + m.wounds, 0);
      const r = plan.expectedDamage / Math.max(1, left);
      v += (r >= 1.2 ? 0.8 : r >= 0.8 ? 0.5 : r >= 0.5 ? 0.2 : 0) * require('./mission.cjs').killPoints(e) * ai.K(state, u.side, 'vp') * 0.8;
    }
    if (!best || v > best.v) best = { target: e, v };
  }
  return best;
}
/**
 * Expected points the enemy takes off a Flyer placed at p: the best Intercept among the units that may react (Snap
 * Shots unless it's a Strafing Run; vehicles fire Defensive Weapons, as reactions.cjs). memo: answers kept for one
 * choice of assignment.
 */
function exposure(state, f, p, kind, shooters, memo) {
  if (!shooters.length) return 0;
  const snap = kind !== 'strafing';
  const key = `${snap}:${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (memo && memo.has(key)) return memo.get(key);
  const v = at(f, p, () => Math.max(0, ...shooters.map((e) => planVolley(e, f, state, { snap: snap && !has(e.rules, 'Skyfire'), stationary: true, exclude: (w) => e.vehicle && !core.isDefensive(w) }).expectedPts)));
  if (memo) memo.set(key, v);
  return v;
}

// ---------- the AI's Combat Assignment ----------
/** Units the Flyer could carry (as deployment embarks them, battle.cjs). */
function canCarry(f, u) {
  if (u.vehicle || u.embarkedIn || u.passengers.length || u.lockedWith.size || u === f) return false;
  const light = has(f.rules, 'Light Transport');
  const a = alive(u);
  return a.length > 0 && a.every((m) => /Infantry|Paragon/.test(m.unitType) && (!light || !(xOf(m.rules, 'Bulky') > 1)))
    && a.reduce((s, m) => s + (xOf(m.rules, 'Bulky') || 1), 0) <= f.capacity;
}
/**
 * Pick a Combat Assignment and where the Flyer goes. Returns { kind, edge, to, value } or null to leave it in Aerial
 * Reserves (the rulebook lets a passed unit stay there). Units aboard: a Drop Mission to where they do most. An empty
 * Transport may extract a friendly unit with Tactical Statuses that is going nowhere. Otherwise a Strike Mission or a
 * Strafing Run, whichever shoots best for what the enemy can shoot back at it (an Intercept on arrival, and Return
 * Fire from its target).
 */
function chooseAssignment(state, f) {
  const ai = require('./ai.cjs');
  const M = ai.moveOf(f);
  const edge = zoneEdge(state, f.side).map((p) => inset(p, f.r));
  const foes = enemiesOn(state, f.side);
  const memo = new Map();
  // what it risks is weighed as the AI weighs any unit's risk (ai.cjs)
  const riskW = ai.K(state, f.side, 'risk');
  const reactors = state.reactionsLeft[1 - f.side] > 0 ? foes.filter((e) => require('./reactions.cjs').canReact(e) && alive(e).some((m) => m.ranged.length)) : [];
  const route = (to, reach) => {
    // from the edge point nearest the destination, as far as the move allows; the edge spot must be free too
    const byDist = [...edge].sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y));
    for (const e of byDist.slice(0, 6)) {
      if (!freeAt(state, f, e)) continue;
      const p = landing(state, f, e, to, reach);
      if (p) return { edge: e, to: p };
    }
    return null;
  };
  // Drop Mission: carry the units aboard to where they do most, near objectives or enemies
  if (f.passengers.length) {
    let best = null;
    const spots = [...state.table.objectives, ...foes, ...state.mission.sectors.map((s) => s.centre)];
    for (const s of spots) {
      const r = route(s, M);
      if (!r) continue;
      let v = 0;
      // they get out Disordered unless the Flyer is an Assault Vehicle (CONFIRMED), and the AI counts it that way
      for (const p of f.passengers) {
        const d0 = p.turn.disordered;
        p.r = p.r || 1; p.turn.disordered = d0 || !has(f.rules, 'Assault Vehicle');
        v += ai.positionScore(state, p, r.to, { cautious: 0.6 });
        p.turn.disordered = d0;
      }
      if (!best || v > best.value) best = Object.assign({ kind: 'drop', value: v }, r);
    }
    return best;
  }
  const options = [];
  // Extraction Mission: an empty Transport picks up a unit that is Routed, or held down by statuses and holding
  // nothing (ASSUMPTION: the AI's rule of thumb)
  if (f.capacity > 0 && /Transport/.test(f.unitType)) {
    for (const u of state.units) {
      if (u.side !== f.side || u.destroyed || !u.arrived || u.embarkedIn || !canCarry(f, u) || !u.statuses.size) continue;
      const routed = u.statuses.has('Routed');
      if (!routed && (canHold(u) || u.statuses.size < 2)) continue;
      const pts = u.pts * alive(u).length / Math.max(1, u.models.length);
      const toward = nearest(edge, u);
      const d = Math.hypot(toward.x - u.x, toward.y - u.y) || 1;
      const stop = { x: u.x + ((toward.x - u.x) / d) * (u.r + f.r + 1), y: u.y + ((toward.y - u.y) / d) * (u.r + f.r + 1) };
      const r = route(stop, M);
      if (!r || at(f, r.to, () => gap(f, u)) > 2) continue;
      options.push(Object.assign({ kind: 'extraction', unit: u, value: pts * (routed ? 0.6 : 0.25) - exposure(state, f, r.edge, 'extraction', reactors, memo) * riskW }, r));
    }
  }
  // Strike Mission or Strafing Run: the best shot from where it can get to, less what it risks
  for (const kind of ['strike', 'strafing']) {
    const reach = kind === 'strafing' ? M / 2 : M;
    for (const fo of fireOptions(f, kind)) {
      withWeapons(f, fo.filter, () => {
        if (!f.models.some((m) => m.ranged.length)) return;
        const range = Math.max(0, ...f.models.flatMap((m) => m.ranged.map((w) => rangeOf(w, m))));
        const seen = new Set();
        for (const e of foes) {
          for (const want of [e.r + f.r + 1.2, Math.max(e.r + f.r + 1.2, range + e.r + f.r - 2)]) {
            const toward = nearest(edge, e);
            const d = Math.hypot(e.x - toward.x, e.y - toward.y) || 1;
            const to = { x: e.x + ((toward.x - e.x) / d) * want, y: e.y + ((toward.y - e.y) / d) * want };
            const r = route(to, reach);
            if (!r) continue;
            const key = `${r.to.x.toFixed(1)},${r.to.y.toFixed(1)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const shot = at(f, r.to, () => bestTarget(state, f, fo.snap));
            if (!shot) continue;
            // Return Fire from the target (as likely as not), and the best Intercept at the edge
            const back = at(f, r.to, () => planVolley(shot.target, f, state, { snap: kind !== 'strafing' && !has(shot.target.rules, 'Skyfire'), stationary: true }).expectedPts) * 0.5;
            const risk = (exposure(state, f, r.edge, kind, reactors, memo) + back) * riskW;
            options.push(Object.assign({ kind, filter: fo.filter, snap: fo.snap, value: shot.v - risk }, r));
          }
        }
      });
    }
  }
  const best = options.reduce((b, o) => (!b || o.value > b.value ? o : b), null);
  return best && best.value > ai.K(state, f.side, 'shootBar') ? best : null;
}

// ---------- the Reserves Sub-Phase ----------
const hasItem = (u, re) => alive(u).some((m) => (m.items || []).some((i) => re.test(i)));
/**
 * The Active Player's Aerial Reserves Tests (CONFIRMED: from Battle Turn 1; 3+, raised by returns; never automatic).
 * A Flyer that passes takes its Combat Assignment and is placed on its zone's edge, where it may be Intercepted.
 */
function reservesSubPhase(state, side) {
  for (const f of state.units.filter((x) => x.side === side && x.reserve === 'aerial' && !x.destroyed)) {
    let roll = state.dice.d6();
    // Vox-interlink (Remus Ventanus): +1 to Reserves Tests, Aerial Reserves included (CONFIRMED)
    if (state.units.some((x) => x.side === side && !x.destroyed && x.arrived && !x.reserve && hasItem(x, /^Vox-interlink/i))) roll += 1;
    // Coordinate (Lotara Sarrin's Shadow of the Conquerer, battle.cjs): +1 to one Aerial Reserves Test this turn
    if (state.coordinate?.[side] === state.round) { roll += 1; state.coordinate[side] = null; }
    const need = reservesTarget(f);
    if (roll < need) { state.log(`  ${f.name} stays in Aerial Reserves (rolled ${roll}, needed ${need}+)`); continue; }
    const plan = chooseAssignment(state, f);
    if (!plan) { state.log(`  ${f.name} passes its Aerial Reserves Test but stays in Aerial Reserves`); continue; }
    arrive(state, f, plan);
  }
}
/** Bring a Flyer in on its Combat Assignment: placed at the edge, then Intercept and the like (reactions.cjs). */
function arrive(state, f, plan) {
  f.reserve = null; f.arrived = true; f.assignment = plan.kind; f.plan = plan;
  f.x = plan.edge.x; f.y = plan.edge.y;
  f.facing = Math.atan2(plan.to.y - f.y, plan.to.x - f.x);
  f.turn.fromReserves = true;
  f.statuses.clear(); f.lockedWith.clear();
  for (const p of f.passengers) { p.arrived = true; p.x = f.x; p.y = f.y; }
  const NAMES = { drop: 'a Drop Mission', extraction: 'an Extraction Mission', strike: 'a Strike Mission', strafing: 'a Strafing Run' };
  state.log(`  ${f.name} comes in from Aerial Reserves on ${NAMES[plan.kind]} at (${f.x.toFixed(0)}, ${f.y.toFixed(0)})${f.passengers.length ? ` carrying ${f.passengers.map((p) => p.name).join(', ')}` : ''}`);
  const aboard = [...f.passengers];
  if (state.onArrive) state.onArrive(f);
  // shot down by the Intercept on a Drop Mission: each model aboard takes an AP 2, Damage 2 wound on a 1 (CONFIRMED)
  if (f.destroyed && plan.kind === 'drop') for (const p of aboard) crashWounds(state, p);
}
/** The wounds a unit aboard a Drop Mission takes when its Flyer is shot down by an Intercept. */
function crashWounds(state, u) {
  if (u.destroyed) return;
  const { pickModel } = require('./attack.cjs');
  const { save } = require('./rules.cjs');
  let n = 0;
  for (const m of alive(u)) if (state.dice.d6() === 1) n++;
  let taken = 0;
  for (let i = 0; i < n; i++) {
    const v = pickModel(u, false);
    if (!v) break;
    const inv = save(v.p.INV);
    if (inv <= 6 && state.dice.d6() >= inv) continue;
    v.wounds = Math.max(0, v.wounds - 2); taken++;
    if (v.wounds === 0 && state.onCasualty) state.onCasualty(v, u, null);
  }
  if (n) state.log(`    ${u.name} is hurt in the crash: ${n} wounds, ${taken} not saved`);
  if (state.afterDamage) state.afterDamage(u);
}

// ---------- the Move Sub-Phase ----------
/**
 * Each Flyer on a Combat Assignment makes its move (CONFIRMED: straight forwards up to its Movement, or half of it in
 * any direction on a Strafing Run), then the Reactive Player may answer: Combat Air Patrol, then the other reactions to
 * a move (Reposition and the like, reactions.cjs). A Drop Mission's units get out; an Extraction picks its unit up.
 * Returns the Flyers on the battlefield, which then sit out move.cjs's Move Sub-Phase (battle.cjs).
 */
function moveSubPhase(state, side) {
  const flying = state.units.filter((f) => f.side === side && f.assignment && !f.destroyed && f.arrived);
  for (const f of flying) {
    const plan = f.plan || {};
    const reach = require('./ai.cjs').moveOf(f) / (f.assignment === 'strafing' ? 2 : 1);
    const to = plan.to ? landing(state, f, { x: f.x, y: f.y }, plan.to, reach) : null;
    if (to) {
      const moved = Math.hypot(to.x - f.x, to.y - f.y);
      if (moved > 0.1) f.facing = Math.atan2(to.y - f.y, to.x - f.x);
      f.x = to.x; f.y = to.y;
      state.log(`  ${f.name} flies ${moved.toFixed(1)}" to (${f.x.toFixed(0)}, ${f.y.toFixed(0)})`);
    }
    for (const p of f.passengers) { p.x = f.x; p.y = f.y; }
    f.turn.moved = true;
    // Stable: counts as Stationary for shooting after any move but a Rush (CONFIRMED)
    f.turn.stationary = /Stable/.test(f.unitType);
    combatAirPatrol(state, f);
    if (f.destroyed) continue;
    if (state.onEnemyMoved) state.onEnemyMoved(f);
    if (f.destroyed) continue;
    if (f.assignment === 'drop') dropOff(state, f);
    if (f.assignment === 'extraction' && plan.unit) pickUp(state, f, plan.unit);
  }
  return flying.filter((f) => !f.destroyed);
}
/** Drop Mission: the units aboard get out beside the Flyer (it uses its base edge as the Access Point). */
function dropOff(state, f) {
  const ai = require('./ai.cjs');
  for (const p of [...f.passengers]) {
    p.r = require('./army.cjs').footprint(p);
    let best = null;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * 2 * Math.PI;
      const pos = { x: f.x + Math.cos(a) * (f.r + p.r + 0.2), y: f.y + Math.sin(a) * (f.r + p.r + 0.2) };
      if (pos.x < p.r || pos.x > W - p.r || pos.y < p.r || pos.y > H - p.r) continue;
      if (state.table.pieces.some((r) => r.impassable && inside(pos, r))) continue;
      if (state.units.some((x) => x !== f && x !== p && !x.destroyed && x.arrived && !x.embarkedIn && Math.hypot(x.x - pos.x, x.y - pos.y) < x.r + p.r + (x.side !== p.side ? 1 : 0.3))) continue;
      const s = ai.positionScore(state, p, pos);
      if (!best || s > best.s) best = { pos, s };
    }
    if (!best) continue;
    f.passengers = f.passengers.filter((x) => x !== p);
    p.embarkedIn = null; p.arrived = true;
    p.x = best.pos.x; p.y = best.pos.y;
    // a disembarked unit makes a normal move in the Move Sub-Phase (move.cjs) and charges Disordered unless it got out
    // of an Assault Vehicle (CONFIRMED); entering play from Reserves counts as moving (CONFIRMED)
    p.turn.disembarked = true; p.turn.fromReserves = true; p.turn.stationary = false;
    p.turn.disordered = !has(f.rules, 'Assault Vehicle');
    state.log(`  ${p.name} disembarks from ${f.name}`);
  }
}
/** Extraction Mission: the chosen unit embarks if all of it is within 2" of the Flyer. */
function pickUp(state, f, u) {
  if (u.destroyed || !u.arrived || u.embarkedIn || f.passengers.length || !canCarry(f, u) || gap(f, u) > 2) return;
  f.passengers.push(u);
  u.embarkedIn = f; u.x = f.x; u.y = f.y;
  state.log(`  ${u.name} embarks on ${f.name} (Extraction Mission)`);
}

// ---------- Combat Air Patrol ----------
/** Spend a point of the Reaction Allotment, as reactions.cjs does (Tactical Flexibility: one a turn is free). */
function spend(state, side, unit, name) {
  if (legions.is(unit, 'Ultramarines') && state.umFlex && !state.umFlex[side]) { state.umFlex[side] = true; state.log('    (Tactical Flexibility: no Reaction Point spent)'); } else state.reactionsLeft[side] -= 1;
  unit.reacted = true;
  if (state.reactionCount) state.reactionCount[side][name] = (state.reactionCount[side][name] || 0) + 1;
}
/**
 * Combat Air Patrol (CONFIRMED, Advanced Reaction): an Interceptor unit waiting in Aerial Reserves comes in from the
 * battlefield edge nearest the target, flies up to its Movement straight at it, shoots it and goes back.
 */
function combatAirPatrol(state, target) {
  const side = 1 - target.side;
  if (!state.reactionsLeft || state.reactionsLeft[side] <= 0) return;
  const ai = require('./ai.cjs');
  let best = null;
  for (const u of state.units) {
    if (u.side !== side || u.destroyed || u.reserve !== 'aerial' || u.reacted) continue;
    const a = alive(u);
    if (!a.length || !a.every((m) => (m.traits || []).includes('Interceptor'))) continue;
    const start = inset(nearest(EDGE, target), u.r);
    const d = Math.hypot(target.x - start.x, target.y - start.y) || 1;
    const go = Math.min(ai.moveOf(u), Math.max(0, d - target.r - u.r - 1.2));
    const pos = { x: start.x + ((target.x - start.x) / d) * go, y: start.y + ((target.y - start.y) / d) * go };
    // it flies straight at the target, so its Centreline and Hull weapons bear on it (firing arcs, fire.cjs)
    const face = Math.atan2(target.y - pos.y, target.x - pos.x), f0 = u.facing;
    u.facing = face;
    const v = at(u, pos, () => planVolley(u, target, state, { snap: snapAgainst(target), stationary: true }).expectedPts);
    u.facing = f0;
    if (v > 0 && (!best || v > best.v)) best = { u, pos, v, face };
  }
  if (!best || !ai.worthReacting(state, side, best.v)) return;
  const u = best.u;
  spend(state, side, u, 'Combat Air Patrol');
  state.log(`    ${state.armies[side].name} reacts: Combat Air Patrol (${u.name})`);
  u.reserve = null; u.arrived = true; u.x = best.pos.x; u.y = best.pos.y; u.facing = best.face; u.turn = u.turn || {};
  require('./shoot.cjs').shootingAttack(state, u, target, { reaction: true, label: 'patrols and shoots' });
  if (!u.destroyed) toAerialReserves(state, u);
}

// ---------- the Shooting Phase ----------
/** A Flyer's Shooting Attack, with the weapons its assignment allows. */
function shoot(state, f) {
  const opts = fireOptions(f, f.assignment);
  let best = null;
  for (const fo of opts) {
    const pick = withWeapons(f, fo.filter, () => bestTarget(state, f, fo.snap));
    if (pick && (!best || pick.v > best.pick.v)) best = { fo, pick };
  }
  const ai = require('./ai.cjs');
  if (!best || best.pick.v <= ai.K(state, f.side, 'shootBar')) return;
  withWeapons(f, best.fo.filter, () => require('./shoot.cjs').shootingAttack(state, f, best.pick.target, { phaseAttack: true, snap: best.fo.snap }));
}
/** Back to Aerial Reserves: the Reserves target goes up by 1, and the units aboard stay aboard. */
function toAerialReserves(state, f) {
  const extracted = f.assignment === 'extraction';
  f.reserve = 'aerial'; f.arrived = false; f.assignment = null; f.plan = null;
  f.aerialReturns = (f.aerialReturns || 0) + 1;
  f.statuses.clear(); f.lockedWith.clear();
  for (const p of f.passengers) {
    p.arrived = false;
    // an Extraction's unit loses its Tactical Statuses (CONFIRMED)
    if (extracted && p.statuses.size) { p.statuses.clear(); for (const m of p.models) m.disgraced = false; }
  }
  state.log(`  ${f.name} returns to Aerial Reserves${f.passengers.length ? ` with ${f.passengers.map((p) => p.name).join(', ')}` : ''} (next test ${reservesTarget(f)}+)`);
}
/** End of the Active Player's Shooting Phase: every Flyer on a Combat Assignment goes back to Aerial Reserves. */
function endShootingPhase(state, side) {
  for (const f of state.units) if (f.side === side && f.assignment && !f.destroyed) toAerialReserves(state, f);
}

module.exports = { isFlyer, reservesTarget, snapAgainst, strafing, fireOptions, centrelineOf, chooseAssignment, reservesSubPhase, arrive, moveSubPhase, combatAirPatrol, shoot, endShootingPhase, toAerialReserves, crashWounds, freeAt, landing, canCarry };
