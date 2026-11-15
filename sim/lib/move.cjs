'use strict';
// The Movement Phase: Reserves, moving and Rushing, embarking and disembarking, the Reposition reaction, and Fall Back
// Moves for Routed units in the Rout Sub-Phase. Also what a move meets on the way: Antigrav units passing over terrain
// and units, vehicles driving through enemy infantry (and the Death or Glory reaction that allows), Dangerous Terrain.
const { xOf, has, save } = require('./rules.cjs');
const { gap, inside, rectGap, segHitsRect, moveToward, W, H } = require('./table.cjs');
const { alive, check, addStatus } = require('./checks.cjs');
const { footprint } = require('./army.cjs');
const { inArea, EDGE } = require('./mission.cjs');
const ai = require('./ai.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');
const scoring = require('./scoring.cjs');
const path = require('./path.cjs');

const enemiesOf = (state, u) => state.units.filter((e) => e.side !== u.side && !e.destroyed && e.arrived && !e.embarkedIn);
const ignoresTerrain = (u) => alive(u).every((m) => /Antigrav|Flyer|Super-[Hh]eavy|Knight|Titan|Jump/.test(m.unitType)) || has(u.rules, 'Move Through Cover');
const isFlyer = (u) => alive(u).some((m) => /Flyer/.test(m.unitType));
/** Antigrav (CONFIRMED, rulebook p178): a unit of only Antigrav models moves over terrain and over other units. */
const isAntigrav = (u) => { const a = alive(u); return a.length > 0 && a.every((m) => /Antigrav/.test(m.unitType)); };
const hasVehicleModel = (x) => x.models.some((m) => m.wounds > 0 && m.vehicle);
/** Orbital Assault Vehicle (CONFIRMED): the model is always deployed by Deep Strike. */
const mustDeepStrike = (u) => has(u.rules, 'Orbital Assault Vehicle');
// Objective Markers are tokens or 32mm bases (MISSION): models may never be deployed overlapping one
const MARKER_R = 0.63;
const onMarker = (state, p, r) => (state.table.objectives || []).some((o) => Math.hypot(o.x - p.x, o.y - p.y) < r + MARKER_R);
/** The point a straight move of `budget` inches from u towards `to` would reach. */
const clipTo = (u, to, budget) => {
  const d = Math.hypot(to.x - u.x, to.y - u.y);
  return d <= budget || d < 1e-9 ? to : { x: u.x + (to.x - u.x) * budget / d, y: u.y + (to.y - u.y) * budget / d };
};

/** Where a move of this unit towards `to` would really stop: straight, or round what's in the way (lib/path.cjs). */
function simulateMove(state, u, to, budget, opts = {}) {
  const d = destination(state, u, to, budget, opts);
  return { x: d.x, y: d.y };
}
function moveSetup(state, u, to, budget, opts) {
  // only terrain the move could reach counts (a Fall Back aims at a distant table edge, CONFIRMED: models that "could
  // potentially enter" it); a charge pays for the terrain on its way to the target, as it declared it would cross it
  const aim = opts.charging ? to : clipTo(u, to, budget);
  // Tectonic Instability: this turn's Sector counts as Difficult Terrain (MISSION)
  const quake = state.tectonic && state.mission.sectors.find((s) => s.id === state.tectonic);
  const inQuake = quake && [0, 0.5, 1].some((f) => inArea(quake.area, { x: u.x + (aim.x - u.x) * f, y: u.y + (aim.y - u.y) * f }));
  // Remorseless Advance (Death Guard): difficult terrain doesn't slow them
  // the Set-up Move and Consolidation ignore difficult terrain (SHEET); so does Remorseless Advance (Death Guard)
  const slowed = !opts.ignoreDifficult && !ignoresTerrain(u) && !legions.is(u, 'Death Guard');
  const crossesDifficult = slowed && (inQuake || state.table.pieces.some((r) => r.difficult && segThrough(u, aim, r)));
  const b = Math.max(0, budget - (crossesDifficult ? core.DIFFICULT_PENALTY : 0));
  // the Line of Movement may not cross a vehicle's hull, or come within 1" of an enemy model or of a model Locked in
  // Combat (CONFIRMED); friendly models that aren't vehicles may be moved through (and vehicles may drive through
  // them), but not ended on: those are `soft`, as are the units an Antigrav unit or a vehicle driving through passes
  // over (tol: how far a move may end into one, friends being only roughly packed)
  const antigrav = isAntigrav(u), through = !!opts.through && u.vehicle && !isFlyer(u);
  const blockers = [], soft = [];
  for (const x of state.units) {
    if (x === u || x.destroyed || !x.arrived || x.embarkedIn || x === opts.target) continue;
    const enemy = x.side !== u.side, locked = x.lockedWith.size > 0;
    // Antigrav: may move over any unit, friend or foe, but ends at least 1" from enemy models (and from friendly ones
    // Locked in Combat, as any move), and from all other models after moving over a friendly unit (destination)
    if (antigrav) soft.push({ x: x.x, y: x.y, r: x.r + (enemy || locked ? 1 : 0), unit: x, enemy, tol: enemy || locked ? 0.01 : 0.3 });
    // a vehicle may drive through enemy units that have no Vehicle models, ending at least 1" from them (CONFIRMED,
    // p217; ASSUMPTION: not through a unit Locked in Combat)
    else if (enemy && through && !locked && !hasVehicleModel(x)) soft.push({ x: x.x, y: x.y, r: x.r + 1, unit: x, enemy, tol: 0.01 });
    else if (enemy || locked) blockers.push({ x: x.x, y: x.y, r: x.r + 1 });
    else if (x.vehicle) blockers.push({ x: x.x, y: x.y, r: x.r });
    else soft.push({ x: x.x, y: x.y, r: x.r, unit: x, enemy, tol: 0.3 });
  }
  // Antigrav and Flyers pass over every piece (an Antigrav unit may not end in Impassable Terrain: destinationWith);
  // other units that ignore terrain still go round Impassable Terrain
  const tableView = antigrav || isFlyer(u) ? { pieces: [] }
    : ignoresTerrain(u) ? { pieces: state.table.pieces.filter((r) => r.impassable).map((r) => Object.assign({}, r, { difficult: false })) } : state.table;
  const difficultAt = (p) => slowed && (state.table.pieces.some((r) => r.difficult && inside(p, r)) || !!(quake && inArea(quake.area, p)));
  return { tableView, b, blockers, soft, difficultAt, antigrav };
}
/**
 * Where a move towards `to` of up to `budget` inches ends, and how far the unit goes: { x, y, len, from, pts, soft }.
 * Straight if nothing stops it short; otherwise the way round if that gets closer (not for charges, which go
 * straight). pts: the path's corners; soft: the units it may pass over (for what a vehicle drove through).
 */
function destination(state, u, to, budget, opts = {}) {
  const setup = moveSetup(state, u, to, budget, opts);
  // a move may pass through friendly units but not end on one: if it would (or aims to), they block it after all
  const onSoft = (p) => setup.soft.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + u.r - s.tol);
  const all = [...setup.blockers, ...setup.soft];
  let d;
  if (setup.soft.length && onSoft(to)) d = destinationWith(state, u, to, budget, opts, setup, all);
  else {
    d = destinationWith(state, u, to, budget, opts, setup, setup.blockers);
    if (setup.soft.length && onSoft(d)) d = destinationWith(state, u, to, budget, opts, setup, all);
  }
  // an Antigrav unit that moved over a friendly unit ends at least 1" from every model not its own (CONFIRMED)
  if (setup.antigrav) {
    const friends = setup.soft.filter((s) => !s.enemy);
    if (friends.some((s) => crossAt(d.pts, s, s.r + u.r - s.tol) != null) && friends.some((s) => Math.hypot(s.x - d.x, s.y - d.y) < s.r + u.r + 1 - 0.01)) {
      const far = setup.soft.map((s) => (s.enemy ? s : Object.assign({}, s, { r: s.r + 1 })));
      d = destinationWith(state, u, to, budget, opts, setup, [...setup.blockers, ...far]);
    }
  }
  d.soft = setup.soft;
  return d;
}
function destinationWith(state, u, to, budget, opts, { tableView, b, difficultAt, antigrav }, blockers) {
  const shadow = { x: u.x, y: u.y, r: u.r, ignoresTerrain: true }; // difficult terrain is the flat penalty above
  const len = moveToward(tableView, shadow, to, b, blockers);
  const start = { x: u.x, y: u.y };
  const straight = { x: shadow.x, y: shadow.y, len, from: start, pts: [start, { x: shadow.x, y: shadow.y }] };
  const want = Math.hypot(to.x - u.x, to.y - u.y);
  let d = straight;
  if (!opts.charging && len < Math.min(want, b) - 0.25) {
    // the way round, from a field of path costs kept for this unit's position until something on the table moves
    const sig = blockers.map((x) => `${x.x.toFixed(2)},${x.y.toFixed(2)},${x.r}`).join(';') + (state.tectonic || '') + (antigrav ? '|ag' : '');
    // a few path-cost fields kept per set of obstacles (with and without friends in the way)
    state.pathCaches = state.pathCaches || new Map();
    let cache = state.pathCaches.get(sig);
    if (!cache) { if (state.pathCaches.size > 6) state.pathCaches.clear(); cache = new Map(); state.pathCaches.set(sig, cache); }
    const around = path.route(u, to, budget, { tableView, blockers, difficultAt, penalty: core.DIFFICULT_PENALTY }, cache);
    const dTo = (p) => Math.hypot(to.x - p.x, to.y - p.y);
    if (around && dTo(around) < dTo(straight) - 0.25) d = around;
  }
  // an Antigrav unit passes over Impassable Terrain but may not end in it (CONFIRMED): it stops short of it
  return antigrav ? clearOfImpassable(state, d) : d;
}
/**
 * The Charge Move's way into base contact with t (CONFIRMED, rulebook: the Set-up Move and the Charge Move take the
 * shortest possible route, going round Impassable Terrain, friendly models and enemy models in other units, and a
 * charge that doesn't end in base contact fails; neither loses distance to difficult terrain). Straight when nothing is
 * in the way, as before; otherwise round it, so a unit standing in the lane makes the charge longer or stops it.
 * Antigrav units pass over units and terrain (as their moves). Returns { len, x, y, pts }, len Infinity if no route
 * within `budget` inches touches t.
 */
function chargeRoute(state, u, t, budget = core.CHARGE_DECLARE_RANGE + 6) {
  const straight = { len: gap(u, t), ...contactPoint(u, t), pts: null };
  if (isAntigrav(u) || isFlyer(u)) return straight;
  const { tableView } = moveSetup(state, u, t, budget, { charging: true, target: t, ignoreDifficult: true });
  const blockers = [];
  for (const x of state.units) if (x !== u && !x.destroyed && x.arrived && !x.embarkedIn) blockers.push({ x: x.x, y: x.y, r: x.r + (x === t ? 0 : 0.05) });
  const env = { tableView, blockers, difficultAt: () => false, penalty: 0 };
  const R = path.rules(u, env);
  if (R.clear({ x: u.x, y: u.y }, straight, true)) return straight;
  const r = path.toContact(u, t, budget, env);
  return r || { len: Infinity, x: u.x, y: u.y, pts: null };
}
/** Where u touches t coming straight at it. */
function contactPoint(u, t) {
  const d = Math.hypot(u.x - t.x, u.y - t.y) || 1, k = (u.r + t.r) / d;
  return { x: t.x + (u.x - t.x) * k, y: t.y + (u.y - t.y) * k };
}
/** A move ending in Impassable Terrain pulled back along its path until it doesn't. */
function clearOfImpassable(state, d) {
  const imp = state.table.pieces.filter((r) => r.impassable);
  const blocked = (p) => imp.some((r) => inside(p, r));
  if (!imp.length || !blocked(d)) return d;
  let len = d.len;
  for (let k = d.pts.length - 1; k > 0; k--) {
    const a = d.pts[k - 1], b = d.pts[k], L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0.25; s <= L + 1e-9; s += 0.25) {
      const p = { x: b.x + (a.x - b.x) * s / L, y: b.y + (a.y - b.y) * s / L };
      if (!blocked(p)) return { x: p.x, y: p.y, len: Math.max(0, len - s), from: a, pts: [...d.pts.slice(0, k), p] };
    }
    len -= L;
  }
  const s0 = d.pts[0];
  return { x: s0.x, y: s0.y, len: 0, from: s0, pts: [s0, s0] };
}

// ---------- paths ----------
/** How far along a path (inches from its start) its centre line first comes within `rad` of point c, or null. */
function crossAt(pts, c, rad) {
  if (Math.hypot(pts[0].x - c.x, pts[0].y - c.y) < rad) return null; // already there at the start: not crossed
  let run = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    if (L < 1e-9) continue;
    const fx = a.x - c.x, fy = a.y - c.y, A = L * L, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - rad * rad;
    const disc = B * B - 4 * A * C;
    if (disc >= 0) { const t = (-B - Math.sqrt(disc)) / (2 * A); if (t >= 0 && t <= 1) return run + t * L; }
    run += L;
  }
  return null;
}
/** The first `s` inches of a path, as its corners. */
function pathTo(pts, s) {
  const out = [pts[0]];
  let run = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + L >= s) { const t = L > 1e-9 ? (s - run) / L : 0; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); return out; }
    out.push(b); run += L;
  }
  return out;
}

// ---------- vehicles driving through enemy units ----------
/**
 * The enemy units a vehicle's move drove through, in the order it met them. CONFIRMED (p217): its path must cross a
 * model's base; ASSUMPTION: a hull that comes within 1" of the unit's footprint counts, since it may not pass that
 * close otherwise.
 */
function drivenThrough(u, d) {
  const out = [];
  for (const s of d.soft || []) {
    if (!s.enemy) continue;
    const at = crossAt(d.pts, s, s.r + u.r - s.tol); // s.r already has the 1"
    if (at != null) out.push({ unit: s.unit, at });
  }
  return out.sort((a, b) => a.at - b.at);
}
/**
 * Death or Glory as the vehicle meets each unit (reactions.cjs): the vehicle halts in base contact with it while the
 * reaction is made. Destroyed, it goes no further and inflicts no hits; Pinned, it stops there, 1" short of the unit
 * (ASSUMPTION: a Pinned vehicle may not move on, and it may not end a move in base contact with an enemy model).
 * Returns the move as it now ends and the units it drove through.
 */
function deathOrGloryAlong(state, u, d, crossed) {
  const R = require('./reactions.cjs');
  if (!R.deathOrGlory) return { d, crossed };
  for (let i = 0; i < crossed.length; i++) {
    const x = crossed[i].unit;
    if (x.destroyed) continue;
    const contact = crossAt(d.pts, x, x.r + u.r) ?? crossed[i].at;
    const halt = pathTo(d.pts, contact).pop();
    const from = { x: u.x, y: u.y };
    u.x = halt.x; u.y = halt.y;
    for (const p of u.passengers) { p.x = u.x; p.y = u.y; }
    const out = R.deathOrGlory(state, u, x);
    if (u.destroyed) return { d: null, crossed: [] };
    u.x = from.x; u.y = from.y;
    for (const p of u.passengers) { p.x = u.x; p.y = u.y; }
    if (out === 'pinned') {
      const pts = pathTo(d.pts, Math.max(0, crossed[i].at - 0.05)), end = pts[pts.length - 1];
      state.log(`    ${u.name} is Pinned and stops short of ${x.name}`);
      return { d: { x: end.x, y: end.y, len: Math.max(0, crossed[i].at - 0.05), from: pts[pts.length - 2] || pts[0], pts }, crossed: crossed.slice(0, i + 1) };
    }
  }
  return { d, crossed };
}
/**
 * The hits a unit takes from a vehicle that drove through it (CONFIRMED, p217): D6 hits at Strength 6, AP -, allocated
 * by the unit's own player, once the vehicle's move is over. Not a Shooting Attack: no cover, Shrouded or Panic Check.
 */
const RUN_OVER = (n) => ({ attacks: n, S: 6, AP: 7, D: 1, hitNeed: null, rules: [], melee: true });
function runOver(state, u, x) {
  if (x.destroyed || u.destroyed) return;
  const { resolveGroup } = require('./attack.cjs');
  const n = state.dice.d6();
  const r = resolveGroup(Object.assign(RUN_OVER(n), { from: u }), x, { dice: state.dice, onKill: (m) => state.onCasualty && state.onCasualty(m, x, u) });
  state.log(`    ${u.name} drives through ${x.name}: ${n} hits, ${r.unsaved} unsaved, ${r.kills} killed`);
  if (state.afterDamage) state.afterDamage(x);
}
const runOverValue = (x) => require('./attack.cjs').expectedGroup(RUN_OVER(3.5), x) * require('./fire.cjs').valuePerWound(x);
/**
 * The AI's use of driving through (ASSUMPTION): a vehicle drives through enemy infantry only where that gets it
 * somewhere it rates better than the best move it found going round them (by 2 points), counting the hits it
 * inflicts and what the worst Death or Glory it would meet could cost it. Returns { to, s } or null.
 */
function throughMove(state, u, d) {
  if (isFlyer(u) || isAntigrav(u) || u.statuses.has('Pinned')) return null;
  const M = ai.moveOf(u);
  if (M <= 0 || !enemiesOf(state, u).some((e) => !e.lockedWith.size && !hasVehicleModel(e) && gap(u, e) < M)) return null;
  const R = require('./reactions.cjs');
  const gain = new Map(), dog = new Map(), seen = new Set();
  let best = null;
  for (const c of ai.candidates(state, u, M)) {
    const e = destination(state, u, c, M, { through: true });
    const crossed = drivenThrough(u, e);
    if (!crossed.length) continue;
    const k = `${e.x.toFixed(1)},${e.y.toFixed(1)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let s = ai.positionScore(state, u, e), worst = 0;
    for (const { unit: x } of crossed) {
      if (!gain.has(x)) gain.set(x, runOverValue(x));
      if (!dog.has(x)) dog.set(x, R.deathOrGlory ? R.deathOrGlory(state, u, x, { estimate: true }) : 0);
      s += gain.get(x);
      worst = Math.max(worst, dog.get(x));
    }
    s -= worst;
    if (!best || s > best.s) best = { to: { x: e.x, y: e.y }, s };
  }
  return best && best.s > d.score + 2 ? best : null;
}

// ---------- Dangerous Terrain ----------
/**
 * Dangerous Terrain (CONFIRMED, rulebook p236): each model that enters, leaves or moves through it, or begins a move in
 * it, tests once per Phase: on a 1 it suffers a wound at AP 2, Damage 1, against which only an Invulnerable Save may be
 * taken; a vehicle loses a Hull Point instead, with no save of any kind (p217). An Antigrav unit tests only when it
 * begins or ends its move in it (p178); a Flyer never. The pack's battlefield has no Dangerous Terrain (table.cjs),
 * so this plays only on tables that mark pieces `dangerous`. ASSUMPTION: a unit is in or crossing a piece when its
 * centre is, and every model tests; the moves made after the Movement Phase in a Player Turn share one test.
 */
function dangerousTerrain(state, u, pts) {
  const pieces = state.table.pieces.filter((r) => r.dangerous);
  if (!pieces.length || u.destroyed || !pts || isFlyer(u)) return 0;
  const key = `${state.round}:${state.active}:${state.inMovementPhase ? 'm' : 'x'}`;
  if (u.dangerousTested === key) return 0;
  const a = pts[0], b = pts[pts.length - 1], antigrav = isAntigrav(u);
  if (!pieces.some((r) => inside(a, r) || inside(b, r) || (!antigrav && pts.some((p, k) => k > 0 && segHitsRect(pts[k - 1], p, r))))) return 0;
  u.dangerousTested = key;
  let lost = 0;
  for (const m of alive(u)) {
    if (state.dice.d6() !== 1) continue;
    const inv = m.vehicle ? 7 : Math.min(save(m.p.INV), u.buff?.inv || 7);
    if (inv <= 6 && state.dice.d6() >= inv) continue;
    m.wounds -= 1; lost++;
    if (m.wounds <= 0 && state.onCasualty) state.onCasualty(m, u, null);
  }
  state.log(`    ${u.name} tests for Dangerous Terrain${lost ? `: ${lost} ${u.vehicle ? 'Hull Point' : 'wound'}${lost > 1 ? 's' : ''} lost` : ''}`);
  if (lost && state.afterDamage) state.afterDamage(u);
  return lost;
}

/**
 * Move a unit towards a point by up to `budget` inches, keeping 1" from enemy units (unless charging) and losing
 * 2" if the path crosses difficult terrain (CONFIRMED). opts.through: a vehicle may drive through enemy infantry.
 * Returns the inches moved.
 */
function moveUnit(state, u, to, budget, opts = {}) {
  let d = destination(state, u, to, budget, opts);
  let crossed = opts.through ? drivenThrough(u, d) : [];
  if (crossed.length) {
    ({ d, crossed } = deathOrGloryAlong(state, u, d, crossed));
    if (!d) return 0;
  }
  u.x = d.x; u.y = d.y;
  if (u.passengers.length) for (const p of u.passengers) { p.x = u.x; p.y = u.y; }
  // a vehicle ends facing the way it drove its last leg
  if (u.vehicle && d.len > 0.5 && Math.hypot(u.x - d.from.x, u.y - d.from.y) > 0.1) u.facing = Math.atan2(u.y - d.from.y, u.x - d.from.x);
  dangerousTerrain(state, u, d.pts);
  // once its move is over, each unit it drove through takes its hits
  for (const c of crossed) runOver(state, u, c.unit);
  return d.len;
}
/** Points on the battlefield edge of this side's Deployment Zone (where reserves walk on, and the Routed run). */
const homeEdge = (state, side) => {
  const z = state.zoneOf[side];
  const pts = EDGE.filter((p) => inArea(z, p));
  return pts.length ? pts : EDGE;
};
const segThrough = (a, b, r) => segHitsRect(a, b, r) || inside(a, r) || inside(b, r);

const hasItem = (u, re) => alive(u).some((m) => (m.items || []).some((i) => re.test(i)));
/**
 * Chosen of the Khagan (Qin Xa): once per battle, at the start of a Reserves Sub-Phase, one White Scars unit in Reserves
 * arrives without a roll (CONFIRMED). The AI uses it the first time a roll is needed, on the most expensive such unit.
 */
function chosenOfTheKhagan(state, side, reserves) {
  if (state.khaganUsed?.[side] || !state.units.some((x) => x.side === side && !x.destroyed && alive(x).some((m) => has(m.rules, 'Chosen of the Khagan')))) return null;
  const elig = reserves.filter((x) => alive(x).length && alive(x).every((m) => (m.traits || []).includes('White Scars')));
  if (!elig.length) return null;
  state.khaganUsed = state.khaganUsed || [false, false];
  state.khaganUsed[side] = true;
  const pick = elig.reduce((b, x) => (x.pts > b.pts ? x : b), elig[0]);
  state.log(`  ${pick.name} needs no Reserves Test (Chosen of the Khagan)`);
  return pick;
}

/** Reserves Sub-Phase: units in Reserves test to arrive (Deep Strike, Outflank, other reserves). */
function reservesSubPhase(state, side) {
  // the Movement Phase begins (Dangerous Terrain Tests are once per model per Phase)
  state.inMovementPhase = true;
  // Reserves Tests are made from the first Battle Turn (CONFIRMED, rulebook and mission pack); only Deep Strike waits
  // for the second
  let deepStrikes = 0;
  // MISSION: from the start of Battle Turn 4 Reserves Tests pass automatically
  const auto = state.round >= core.RESERVES_AUTO_TURN;
  let reserves = state.units.filter((x) => x.side === side && x.reserve && !x.destroyed);
  const chosen = auto ? null : chosenOfTheKhagan(state, side, reserves);
  if (chosen) reserves = [chosen, ...reserves.filter((x) => x !== chosen)];
  // Corax's Shame (Deliverers): -1 to their Reserves Tests in a Sub-Phase that began with Corvus Corax in Reserves (CONFIRMED)
  const corax = reserves.some((x) => alive(x).some((m) => /^Corvus Corax/.test(m.name)));
  for (const u of reserves) {
    // a unit waiting to Deep Strike doesn't test in the first Battle Turn
    if (u.reserve === 'deep' && state.round < core.RESERVES_FROM_TURN) continue;
    if (!auto && u !== chosen) {
      let roll = state.dice.d6();
      // Vox-interlink (Remus Ventanus): +1 while a model with one is on the battlefield (CONFIRMED)
      if (state.units.some((x) => x.side === side && !x.destroyed && x.arrived && !x.reserve && hasItem(x, /^Vox-interlink/i))) roll += 1;
      if (corax && has(u.rules, 'Corax’s Shame')) roll -= 1;
      // Coordinate (Lotara Sarrin's Shadow of the Conquerer, battle.cjs): +1 to one Aerial Reserves Test this turn
      if (u.reserve === 'aerial' && state.coordinate?.[side] === state.round) { roll += 1; state.coordinate[side] = null; }
      if (roll < core.RESERVES_TEST) continue;
    }
    // one Deep Strike per Player Turn (CONFIRMED); a unit that passed but can't Deep Strike may still enter from the
    // edge instead, which the AI does from Battle Turn 3 rather than keep waiting (ASSUMPTION: the AI's choice), except
    // an Orbital Assault Vehicle, which may only arrive by Deep Strike (CONFIRMED)
    if (u.reserve === 'deep' && deepStrikes >= core.DEEP_STRIKES_PER_TURN) {
      if (state.round < 3 || mustDeepStrike(u)) continue;
      u.reserve = 'edge';
    }
    if (u.reserve === 'deep') {
      deepStrikes++;
      placeDeepStrike(state, u);
      u.turn.arrivedDeep = true;
      u.turn.noCharge = true;
      // a unit embarked on it may get out in the Move Sub-Phase, but makes no other move and may not charge
      // (CONFIRMED, Deep Strike)
      for (const p of u.passengers) p.turn.noCharge = true;
      // Void Commander (Alexis Polux), Master of the Justaerin (Ezekyle Abaddon): deployed by Deep Strike, his unit has
      // Feel No Pain (5+) until the controlling player's next Effects Sub-Phase (CONFIRMED; ASSUMPTION: the End Phase's,
      // this turn, battle.cjs)
      if (alive(u).some((m) => has(m.rules, 'Void Commander') || has(m.rules, 'Master of the Justaerin'))) {
        require('./reactions.cjs').addBuff(u, { fnp: 5 }, 'effects');
        state.log(`  ${u.name} has Feel No Pain (5+) after its Deep Strike`);
      }
    } else if (u.reserve === 'outflank') {
      // a unit entering from outside its own Deployment Zone, and any units embarked on it, may not charge that turn
      // (CONFIRMED, Outflank; it outranks the sheet's summary)
      placeOutflank(state, u);
      if (!inArea(state.zoneOf[u.side], u)) { u.turn.noCharge = true; for (const p of u.passengers) p.turn.noCharge = true; }
    } else {
      placeFromEdge(state, u);
    }
    u.reserve = null; u.arrived = true;
    // entering play from Reserves counts as moving (CONFIRMED)
    u.turn.fromReserves = true;
    for (const p of u.passengers) { p.arrived = true; p.x = u.x; p.y = u.y; }
    state.log(`  ${u.name} arrives from Reserves${u.turn.arrivedDeep ? ' by Deep Strike' : ''} at (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
    // models deployed from Reserves within 2" of an enemy model are Removed as Casualties (CONFIRMED, rulebook p306);
    // the AI only does that when there's nowhere else to go
    removeWithin(state, u, 2, 'deployed within 2" of the enemy');
    if (u.destroyed) continue;
    // Intercept-style reactions are offered by the battle loop through this hook
    if (state.onArrive) state.onArrive(u);
  }
}
/** Area shared by two circles of radii r1 and r2 whose centres are d apart. */
function lens(r1, r2, d) {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1)), b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return a + b - 0.5 * Math.sqrt(Math.max(0, (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)));
}
/**
 * Remove the models of unit u that stand within `d` inches of an enemy model, as Casualties (CONFIRMED: arrivals from
 * Reserves at 2", p306; an Emergency Disembarkation's models that can't be placed 1" away, p232). ASSUMPTION: a unit's
 * models are spread evenly over its footprint, so that share of them goes, troopers before sergeants and characters.
 */
function removeWithin(state, u, d, why) {
  if (u.destroyed || !u.r) return 0;
  const foes = enemiesOf(state, u).filter((e) => e !== u && gap(u, e) < d - 1e-9);
  if (!foes.length) return 0;
  const A = Math.PI * u.r * u.r;
  let keep = 1;
  for (const e of foes) keep *= 1 - Math.min(1, lens(u.r, e.r + d, Math.hypot(e.x - u.x, e.y - u.y)) / A);
  const ms = alive(u);
  const n = Math.min(ms.length, Math.ceil((1 - keep) * ms.length - 1e-9));
  if (n <= 0) return 0;
  const order = [...ms].sort((a, b) => (a.sergeant ? 1 : 0) - (b.sergeant ? 1 : 0) || a.maxWounds - b.maxWounds);
  for (const m of order.slice(0, n)) { m.wounds = 0; if (state.onCasualty) state.onCasualty(m, u, null); }
  state.log(`    ${n === ms.length ? `all of ${u.name}` : `${n} of ${u.name}`} Removed as Casualties: ${why}`);
  if (state.afterDamage) state.afterDamage(u);
  return n;
}
/**
 * Where a unit from Reserves may be put down (CONFIRMED, p306 and the pack): at least 2" from enemy models, not in
 * Impassable Terrain (by Deep Strike, 1" clear of it, CONFIRMED) and not on an Objective Marker; clear of friends.
 * `loose`: the enemy's 2" waived (when there's nowhere else; removeWithin then takes the models that are too close).
 */
function spotOK(state, u, p, deep, loose = false) {
  return state.units.every((x) => x === u || x.destroyed || !x.arrived || x.embarkedIn || Math.hypot(x.x - p.x, x.y - p.y) >= x.r + u.r + (x.side !== u.side ? (loose ? 0 : 2) : 0.3))
    && !state.table.pieces.some((r) => r.impassable && (deep ? rectGap(p, r) < u.r + 1 : inside(p, r)))
    && !onMarker(state, p, u.r);
}
function freeSpot(state, u, cands, deep = false) {
  return cands.find((p) => spotOK(state, u, p, deep)) || cands.find((p) => spotOK(state, u, p, deep, true)) || cands[cands.length - 1];
}
function placeDeepStrike(state, u) {
  // the best spot within reach of a juicy target or an objective, at least 2" from enemies
  u.r = footprint(u);
  const cands = [];
  for (let i = 0; i < 40; i++) cands.push({ x: u.r + 1 + state.dice.rnd() * (W - 2 * u.r - 2), y: u.r + 1 + state.dice.rnd() * (H - 2 * u.r - 2) });
  let best = null;
  for (const p of cands) {
    if (!spotOK(state, u, p, true)) continue;
    const s = ai.positionScore(state, u, p);
    if (!best || s > best.s) best = { p, s };
  }
  const p = freeSpot(state, u, [best ? best.p : cands[0], ...cands], true);
  u.x = p.x; u.y = p.y;
}
function placeOutflank(state, u) {
  u.r = footprint(u);
  // any battlefield edge outside the enemy Deployment Zone and 7" from enemy models (SHEET)
  const ez = state.zoneOf[1 - u.side];
  const edge = EDGE.filter((p) => !inArea(ez, p));
  const cands = [];
  for (let i = 0; i < 40; i++) cands.push(inset(edge[Math.floor(state.dice.rnd() * edge.length)], u.r));
  let best = null;
  for (const p of cands) {
    if (enemiesOf(state, u).some((e) => Math.hypot(e.x - p.x, e.y - p.y) - e.r - u.r < 7)) continue;
    const s = ai.positionScore(state, u, p);
    if (!best || s > best.s) best = { p, s };
  }
  const p = freeSpot(state, u, [best ? best.p : cands[0], ...cands]);
  u.x = p.x; u.y = p.y;
}
/** A point on the edge pulled in so a unit of radius r stands on the table. */
const inset = (p, r) => ({ x: Math.min(W - r, Math.max(r, p.x)), y: Math.min(H - r, Math.max(r, p.y)) });
function placeFromEdge(state, u) {
  u.r = footprint(u);
  // from the battlefield edge of the player's own Deployment Zone (SHEET)
  const edge = homeEdge(state, u.side);
  const cands = [];
  for (let i = 0; i < 16; i++) cands.push(inset(edge[Math.floor(state.dice.rnd() * edge.length)], u.r));
  const p = freeSpot(state, u, cands);
  u.x = p.x; u.y = p.y;
}

/**
 * Battlesmith (X) (CONFIRMED, data/bsdata/common.json; N'rik Dreygur, Shadrak Meduson and Cassian Dracos Reborn have
 * it): in its Movement Phase a model with it may pick a friendly Vehicle, Automata or Walker model within 6" and make an
 * Intelligence Check; passed, the target gains X Wounds or Hull Points (+1 with a servo-arm, CONFIRMED) or loses X
 * Statuses. The AI picks whichever is worth more points: the wounds back, or about a sixth of the unit per status.
 * ASSUMPTION: done at the start of the Move Sub-Phase; the model can't pick itself; a status comes off its whole unit.
 */
function battlesmith(state, side) {
  for (const u of state.units) {
    if (u.side !== side || u.destroyed || !u.arrived || u.embarkedIn) continue;
    for (const m of alive(u)) {
      const x = xOf(m.rules, 'Battlesmith');
      if (!x) continue;
      const repair = x + ((m.items || []).some((i) => /^Servo-arm/i.test(i)) ? 1 : 0);
      let best = null;
      for (const t of state.units) {
        if (t.side !== side || t.destroyed || !t.arrived || t.embarkedIn || (t !== u && gap(u, t) > 6)) continue;
        const vpw = t.pts / Math.max(1, t.models.reduce((s, q) => s + q.maxWounds, 0));
        for (const tm of alive(t)) {
          if (tm === m || !(tm.vehicle || /Automata|Walker/.test(tm.unitType))) continue;
          const heal = Math.min(repair, tm.maxWounds - tm.wounds) * vpw;
          const restore = Math.min(x, t.statuses.size) * t.pts / 6;
          const v = Math.max(heal, restore);
          if (v > 0 && (!best || v > best.v)) best = { t, tm, v, kind: heal >= restore ? 'repair' : 'restore' };
        }
      }
      if (!best || !check(state, u, 'IN', 0, `Battlesmith on ${best.t.name}`)) continue;
      if (best.kind === 'repair') {
        const n = Math.min(repair, best.tm.maxWounds - best.tm.wounds);
        best.tm.wounds += n;
        state.log(`  ${m.name} repairs ${best.tm.name}: ${n} back (Battlesmith)`);
      } else {
        const gone = [...best.t.statuses].slice(0, x);
        for (const s of gone) best.t.statuses.delete(s);
        state.log(`  ${m.name} restores ${best.t.name}: no longer ${gone.join(', ')} (Battlesmith)`);
      }
    }
  }
}

// ---------- embarking ----------
/**
 * Can transport t carry unit p at all (CONFIRMED, rulebook p230 and the rule texts)? Only Infantry or Paragon models,
 * one per point of Transport Capacity (Bulky (X) counts X), none with Bulky on a Light Transport, all of the same
 * Faction as the transport (ASSUMPTION: the army list a unit comes from stands for its Faction), one unit at a time
 * (checked by the callers); a Drop Transport or Heavy Drop Transport may take one Walker (Bulky (6) or (7) at most)
 * instead, and a Dreadnought Transport only that. Lair of the Iron Tyrant: only Perturabo or Domitar-ferrum models.
 */
function canCarry(t, p) {
  if (!t.capacity || t === p || p.vehicle || t.side !== p.side || p.passengers.length || p.armyId !== t.armyId) return false;
  const ms = alive(p);
  if (!ms.length) return false;
  const walkerMax = has(t.rules, 'Dreadnought Transport') || has(t.rules, 'Heavy Drop Transport') ? 7 : has(t.rules, 'Drop Transport') ? 6 : 0;
  if (walkerMax && ms.length === 1 && /Walker/.test(ms[0].unitType)) return (xOf(ms[0].rules, 'Bulky') || 1) <= walkerMax;
  if (has(t.rules, 'Dreadnought Transport') || !ms.every((m) => /Infantry|Paragon/.test(m.unitType))) return false;
  if (has(t.rules, 'Light Transport') && ms.some((m) => xOf(m.rules, 'Bulky') != null)) return false;
  if (has(t.rules, 'Lair of the Iron Tyrant') && !ms.every((m) => /^Perturabo|Domitar-ferrum/.test(m.name))) return false;
  return ms.reduce((s, m) => s + (xOf(m.rules, 'Bulky') || 1), 0) <= t.capacity;
}
/**
 * May p embark on t in this Move Sub-Phase (CONFIRMED, p230-232)? The transport must be empty and on the battlefield,
 * and not one that Impact Reactive Doors have opened; the unit must be free to be selected to move (not Locked in
 * Combat, Pinned or Routed, nor just arrived from Reserves) and may not have disembarked in this Movement Phase. A
 * unit moving as a Reaction may embark too (`reaction`). It must then be within 2" of an Access Point (the callers).
 */
function canEmbark(state, p, t, reaction = false) {
  if (!canCarry(t, p) || t.passengers.length || t.noEmbark || t.destroyed || !t.arrived || t.embarkedIn || t.lockedWith.size || isFlyer(t)) return false;
  if (p.destroyed || !p.arrived || p.embarkedIn || p.lockedWith.size || p.statuses.has('Pinned') || p.statuses.has('Routed')) return false;
  return !p.turn.disembarked && (reaction || !(p.turn.fromReserves || p.turn.arrivedDeep || p.turn.noMove));
}
function embark(state, p, t, why = '') {
  t.passengers.push(p);
  p.embarkedIn = t; p.x = t.x; p.y = t.y;
  p.turn.embarked = true; p.heldObjective = null;
  state.log(`  ${p.name} embarks on ${t.name}${why}`);
}
/**
 * Bring p within 2" of an Access Point on t, moving up to `budget` inches if need be; true if it got there.
 * ASSUMPTION: every point of a hull is an Access Point (the data doesn't say where the doors are, and units are
 * circles here).
 */
function walkTo(state, p, t, budget) {
  if (gap(p, t) <= 2) return true;
  if (budget <= 0) return false;
  const D = Math.hypot(p.x - t.x, p.y - t.y) || 1;
  const aim = { x: t.x + (p.x - t.x) / D * (t.r + p.r + 0.5), y: t.y + (p.y - t.y) / D * (t.r + p.r + 0.5) };
  const e = simulateMove(state, p, aim, budget);
  if (Math.hypot(e.x - t.x, e.y - t.y) - t.r - p.r > 2) return false;
  const moved = moveUnit(state, p, aim, budget);
  if (moved >= 0.25) { p.turn.moved = true; p.turn.stationary = false; }
  return !p.destroyed && gap(p, t) <= 2 + 1e-6;
}
/**
 * The AI's first use of embarking (ASSUMPTION): before anything moves, an assault unit on foot with no enemy in reach
 * this turn gets into an empty transport that it can reach and that hasn't moved, when the transport's best move with
 * it aboard would leave it at least 4" nearer its target than walking; the transport then moves with it. Not in the
 * last Battle Turn, with no turn left to get out and charge.
 */
function embarkToRide(state, units) {
  if (state.turnsLeft != null && state.turnsLeft < 2) return;
  for (const t of units) {
    if (!t.capacity || t.passengers.length || t.noEmbark || t.turn.fromReserves || t.turn.arrivedDeep || t.statuses.has('Pinned') || t.lockedWith.size || isFlyer(t)) continue;
    const Mt = ai.moveOf(t);
    if (Mt <= 0) continue;
    for (const p of units) {
      if (p === t || p.vehicle || p.statuses.size || p.turn.selected) continue;
      const Mp = ai.moveOf(p);
      if (Mt < Mp + 3 || gap(p, t) > Mp + 2 || !canEmbark(state, p, t)) continue;
      const foes = enemiesOf(state, p);
      if (!foes.length || !ai.canCharge(p) || ai.meleeValue(state, p, foes) <= ai.shootValue(state, p, foes)) continue;
      if (foes.some((e) => gap(p, e) <= Mp + core.setupMove(p) + 7)) continue;
      const pl = require('./plan.cjs').of(state, p);
      const target = pl?.target && !pl.target.destroyed ? pl.target : foes.reduce((b, e) => (ai.meleeEV(state, p, e) > ai.meleeEV(state, p, b) ? e : b), foes[0]);
      // where the transport would take it: its best move with the unit aboard (no charge for it this turn)
      t.passengers = [p];
      let best = null;
      for (const c of ai.candidates(state, t, Mt)) {
        const e = simulateMove(state, t, c, Mt);
        const s = ai.positionScore(state, t, e, { charging: false });
        if (!best || s > best.s) best = { e, s };
      }
      t.passengers = [];
      const walk = Math.max(0, Math.hypot(target.x - p.x, target.y - p.y) - Mp), ride = Math.hypot(target.x - best.e.x, target.y - best.e.y);
      if (walk - ride < 4) continue;
      const ok = walkTo(state, p, t, Mp);
      p.turn.selected = true;
      if (!ok) continue;
      embark(state, p, t, ` to be carried towards ${target.name}`);
      break;
    }
  }
}
/**
 * The AI's other use (ASSUMPTION): a unit with no status gets into an empty friendly transport it can reach when,
 * wherever it was going to go (`d`, the AI's chosen move; its position, after a Reaction), what the enemy could do to
 * it next weighs more than one and a half times all it could do there. Returns true if it embarked.
 */
function escapeInto(state, u, d, reaction = false) {
  if (u.vehicle || u.statuses.size || !alive(u).every((m) => /Infantry|Paragon|Walker/.test(m.unitType))) return false;
  const M = reaction ? 0 : ai.moveOf(u);
  const ts = state.units.filter((t) => t.side === u.side && t.capacity > 0 && !t.passengers.length && gap(u, t) <= M + 2 && canEmbark(state, u, t, reaction));
  if (!ts.length) return false;
  const at = d ? d.to : { x: u.x, y: u.y }, o = d && d.kind === 'rush' ? { charging: false } : {};
  const s0 = ai.positionScore(state, u, at, Object.assign({ cautious: 0 }, o)), risk = s0 - ai.positionScore(state, u, at, o);
  if (risk < 10 || risk < 1.5 * Math.max(0, s0)) return false;
  for (const t of ts.sort((a, b) => gap(u, a) - gap(u, b))) {
    if (!walkTo(state, u, t, M)) continue;
    embark(state, u, t, reaction ? ' after its Reaction' : ' out of the enemy\'s reach');
    return true;
  }
  return false;
}
/** The enemy's reactions to a move; a unit that moved as a Reaction may embark (CONFIRMED, p232). */
function reactTo(state, mover) {
  const side = 1 - mover.side;
  const before = state.units.filter((r) => r.side === side && !r.reacted && !r.destroyed && r.arrived && !r.embarkedIn).map((r) => [r, r.x, r.y]);
  state.onEnemyMoved(mover);
  for (const [r, x, y] of before) if (r.reacted && !r.destroyed && !r.embarkedIn && (r.x !== x || r.y !== y)) escapeInto(state, r, null, true);
}

/** Move Sub-Phase: each unit moves, Rushes, stays, embarks or disembarks; the opponent may Reposition in reply. */
function moveSubPhase(state, side) {
  battlesmith(state, side);
  const units = state.units.filter((u) => u.side === side && !u.destroyed && u.arrived && !u.embarkedIn);
  const road = state.mission.has('Supply Road') && state.mission.sectors.find((s) => s.id === 3);
  // fast and far units first, so the slower ones can respond to where they ended up
  units.sort((a, b) => ai.moveOf(b) - ai.moveOf(a));
  // assault units that an empty transport would carry towards their target get in before it moves
  embarkToRide(state, units);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.destroyed || u.embarkedIn || u.turn.selected) continue;
    u.turn.selected = true;
    // a transport that arrived by Deep Strike doesn't move, but its passengers may get out (CONFIRMED)
    if (u.turn.arrivedDeep) { if (u.passengers.length) deepStrikeDisembark(state, u); u.turn.stationary = false; continue; }
    if (u.lockedWith.size || u.statuses.has('Routed')) { u.turn.stationary = true; continue; }
    // out of a transport that arrived by Deep Strike: no move but the one out of it (deepStrikeDisembark)
    if (u.turn.noMove) continue;
    if (u.statuses.has('Pinned')) { u.turn.stationary = true; continue; }
    // passengers get out when a transport is selected to move; one that came on from Reserves this turn may not be
    // (its move onto the table was its move, CONFIRMED), so nobody gets out of it this turn
    const unload = u.passengers.length > 0 && state.round >= 1 && !u.turn.fromReserves;
    // passengers: get out if the AI likes the spot they'd have outside better than staying in. A unit that gets out
    // before its transport moves then makes its own move (INFERRED from Deep Strike, whose passengers "may not make
    // any move other than the move made to Disembark"); one that gets out after the transport moved doesn't
    if (unload) {
      const inside = [...u.passengers];
      disembarkIfWorth(state, u);
      units.splice(i + 1, 0, ...inside.filter((p) => !u.passengers.includes(p)));
    }
    const d = ai.chooseMove(state, u);
    // a unit that would be badly exposed wherever it goes gets into an empty transport within reach instead
    if (!u.vehicle && escapeInto(state, u, d)) continue;
    // a vehicle may drive through enemy infantry where that gets it somewhere better (throughMove)
    let through = false;
    if (u.vehicle && d.kind !== 'rush') { const alt = throughMove(state, u, d); if (alt) { d.kind = 'move'; d.to = alt.to; through = true; } }
    if (d.kind === 'stay') { u.turn.stationary = !u.turn.disembarked && !u.turn.fromReserves; continue; }
    const M = ai.moveOf(u);
    let budget = d.kind === 'rush' ? M + core.rushBonus(u) + Math.min(...alive(u).map((m) => xOf(m.rules, 'Fast') || 0)) : M;
    // Supply Road: a vehicle moving entirely within Sector 3 adds 2" to its Move (MISSION)
    if (road && u.vehicle && inArea(road.area, u) && inArea(road.area, d.to)) budget += 2;
    const moved = moveUnit(state, u, d.to, budget, { through });
    if (u.destroyed) continue;
    u.turn.stationary = moved < 0.25 && !u.turn.disembarked && !u.turn.fromReserves;
    u.turn.moved = true;
    // a move no longer than the unit's Movement isn't a Rush, whatever was planned
    if (d.kind === 'rush' && moved > M + 0.25) u.turn.rushed = true; else if (d.kind === 'rush') d.kind = 'move';
    // Remorseless Advance (Death Guard): Heavy weapons still count after a move of 4" or less that wasn't a Rush
    if (!u.turn.rushed && moved <= 4 && legions.is(u, 'Death Guard')) u.turn.heavyOK = true;
    if (moved >= 0.25) state.log(`  ${u.name} ${through ? 'drives' : d.kind === 'rush' ? 'Rushes' : 'moves'} ${moved.toFixed(1)}" to (${u.x.toFixed(0)}, ${u.y.toFixed(0)})`);
    // Reposition (core Reaction): an enemy unit within 12" and in sight may move up to its Initiative; not after a
    // unit's move onto the table from Reserves, which belongs to the Reserves Sub-Phase (CONFIRMED: Reposition is
    // declared in the Move Sub-Phase)
    if (moved >= 0.25 && state.onEnemyMoved && !u.turn.fromReserves) reactTo(state, u);
    // passengers may get out after the transport moved (not after a Rush)
    // (they then make their own normal move, CONFIRMED: only the transport may not move further)
    if (unload && u.passengers.length && d.kind !== 'rush') {
      const inside = [...u.passengers];
      disembarkIfWorth(state, u, true);
      units.splice(i + 1, 0, ...inside.filter((p) => !u.passengers.includes(p)));
    }
  }
  // what each unit did in this Movement Phase, for its Heavy and Ordnance weapons in the enemy's turn (core.still)
  for (const u of state.units) if (u.side === side) u.lastMove = { stationary: !!u.turn.stationary, heavyOK: !!u.turn.heavyOK };
  // a vehicle can end its move facing any way, and a Pivot doesn't count as moving (CONFIRMED): it turns its front
  // armour to the nearest enemy
  const foes = state.units.filter((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn);
  for (const u of state.units) {
    if (u.side !== side || !u.vehicle || u.destroyed || !u.arrived || u.embarkedIn || u.lockedWith.size || !foes.length) continue;
    const e = foes.reduce((b, x) => (gap(u, x) < gap(u, b) ? x : b), foes[0]);
    u.facing = Math.atan2(e.y - u.y, e.x - u.x);
  }
}

// ---------- disembarking ----------
function getOut(state, t, p, pos, disordered) {
  t.passengers = t.passengers.filter((x) => x !== p);
  p.embarkedIn = null; p.arrived = true;
  p.x = pos.x; p.y = pos.y;
  p.turn.disembarked = true;
  p.turn.stationary = false;
  p.turn.disordered = p.turn.disordered || disordered;
  state.log(`  ${p.name} disembarks from ${t.name}`);
}
/** Passengers disembark next to their transport when that puts them somewhere better. */
function disembarkIfWorth(state, t, afterMove = false) {
  // a unit that disembarked charges Disordered (no Set-up Move) unless its transport is an Assault Vehicle
  // (CONFIRMED), so it weighs getting out that way
  const disordered = !has(t.rules, 'Assault Vehicle');
  for (const p of [...t.passengers]) {
    // no unit embarks and disembarks in the same Movement Phase (CONFIRMED)
    if (p.turn.embarked) continue;
    const d0 = p.turn.disordered;
    p.turn.disordered = d0 || disordered;
    const pos = getOutAt(state, t, p, afterMove);
    p.turn.disordered = d0;
    if (!pos) continue;
    getOut(state, t, p, pos, disordered);
  }
}
/**
 * Passengers of a transport that arrived by Deep Strike may get out in the Move Sub-Phase, placed beside it, and make
 * no other move and no charge that turn (CONFIRMED; ASSUMPTION: "the move made to Disembark" is that placement, not
 * the normal move a unit getting out may otherwise make). Impact Reactive Doors make them get out: a unit that can't is
 * Removed as Casualties, and nobody may embark on the model again (CONFIRMED).
 */
function deepStrikeDisembark(state, t) {
  const forced = has(t.rules, 'Impact Reactive Doors'), disordered = !has(t.rules, 'Assault Vehicle');
  for (const p of [...t.passengers]) {
    const d0 = p.turn.disordered;
    p.turn.disordered = d0 || disordered;
    const pos = getOutAt(state, t, p, true, forced ? { forced: true } : { stuck: true });
    p.turn.disordered = d0;
    if (pos) { getOut(state, t, p, pos, disordered); p.turn.noMove = true; p.turn.noCharge = true; continue; }
    if (!forced) continue;
    t.passengers = t.passengers.filter((x) => x !== p);
    p.embarkedIn = null; p.arrived = true;
    state.log(`  ${p.name} can't get out of ${t.name}: Removed as Casualties`);
    for (const m of alive(p)) { m.wounds = 0; if (state.onCasualty) state.onCasualty(m, p, null); }
    if (state.afterDamage) state.afterDamage(p); else p.destroyed = true;
  }
  if (forced) t.noEmbark = true;
}
/**
 * Where passenger p would get out of t, or null if it's better off staying in. opts.forced: wherever is best, if
 * anywhere (Impact Reactive Doors); opts.stuck: the transport can't move again this turn.
 */
function getOutAt(state, t, p, afterMove, opts = {}) {
  p.r = footprint(p);
  const outside = [], n = opts.forced ? 24 : 12;
  for (let k = 0; k < n; k++) { const a = (k / n) * 2 * Math.PI; outside.push({ x: t.x + Math.cos(a) * (t.r + p.r + 0.2), y: t.y + Math.sin(a) * (t.r + p.r + 0.2) }); }
  let best = null;
  for (const pos of outside) {
    if (pos.x < p.r || pos.x > W - p.r || pos.y < p.r || pos.y > H - p.r) continue;
    // never within 1" of an enemy model or in Impassable Terrain (CONFIRMED), nor on top of a friend
    if (state.units.some((x) => x !== t && x !== p && !x.destroyed && x.arrived && !x.embarkedIn && Math.hypot(x.x - pos.x, x.y - pos.y) < x.r + p.r + (x.side !== p.side ? 1 : 0.3))) continue;
    if (state.table.pieces.some((r) => r.impassable && inside(pos, r))) continue;
    const s = ai.positionScore(state, p, pos);
    if (!best || s > best.s) best = { pos, s };
  }
  if (!best) return null;
  if (opts.forced) return best.pos;
  // stay in while far from anything worth doing
  const near = enemiesOf(state, p).some((e) => gap(t, e) < 18) || state.round >= 3;
  if (!near && best.s < 25) return null;
  // while the transport can still carry them closer, get out only to charge or hold a marker from here; an
  // assault unit only to charge, or to hold a marker if it's a Line unit, before or after the transport moves
  // (ASSUMPTION: the AI's rule of thumb)
  const mobile = !opts.stuck && ai.moveOf(t) > 0 && !t.statuses.has('Pinned') && !t.statuses.has('Stunned');
  // an assault unit waiting for its wave (plan.cjs) stays in its transport
  if (mobile && require('./plan.cjs').of(state, p)?.waiting) return null;
  if (mobile) {
    const foes = enemiesOf(state, p);
    // the unit makes a normal move after getting out, then may charge (Disordered unless from an Assault Vehicle)
    const charge = ai.canCharge(p) && foes.some((e) => ai.chargeOdds(p, ai.toward(best.pos, e, ai.moveOf(p), p.r + e.r + 1), e) >= 0.5);
    const assault = ai.meleeValue(state, p, foes) > ai.shootValue(state, p, foes);
    const holds = scoring.missionValueAt(state, p, best.pos).here > 0;
    // a Line assault unit gets out onto an Objective Marker, not just anywhere in a Sector (in Seize Ground missions
    // that's almost anywhere, and the whole army would walk from its own Deployment Zone)
    const onObj = holds && (state.table.objectives || []).some((o) => Math.hypot(o.x - best.pos.x, o.y - best.pos.y) - p.r <= scoring.CONTROL_RANGE);
    if (!charge && (assault ? !(onObj && scoring.majority(p, 'Line')) : !afterMove && !holds)) return null;
  }
  return best.pos;
}
/**
 * Where a unit makes its Emergency Disembarkation from a destroyed transport t (CONFIRMED, p232): touching the hull,
 * never within 1" of an enemy model or in Impassable Terrain. ASSUMPTION: its player puts it where it's furthest from
 * the enemy; with no such place, the spot that comes closest, and removeWithin takes the models that can't be placed.
 */
function emergencySpot(state, t, p) {
  let best = null;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * 2 * Math.PI, pos = { x: t.x + Math.cos(a) * (t.r + p.r + 0.1), y: t.y + Math.sin(a) * (t.r + p.r + 0.1) };
    if (pos.x < p.r || pos.x > W - p.r || pos.y < p.r || pos.y > H - p.r || state.table.pieces.some((r) => r.impassable && inside(pos, r))) continue;
    const foe = Math.min(Infinity, ...enemiesOf(state, p).map((e) => Math.hypot(e.x - pos.x, e.y - pos.y) - e.r - p.r));
    if (!best || foe > best.foe) best = { pos, foe };
  }
  return best ? best.pos : { x: t.x, y: t.y };
}

/** Rout Sub-Phase: Routed units Fall Back towards their own table edge; off the table means destroyed. */
function routSubPhase(state, side) {
  for (const u of state.units.filter((x) => x.side === side && !x.destroyed && x.arrived && !x.embarkedIn && x.statuses.has('Routed') && !x.lockedWith.size)) fallBack(state, u);
  // the Movement Phase ends
  state.inMovementPhase = false;
}
/**
 * A Fall Back Move (CONFIRMED, rulebook p246): I + D6 (Cavalry 2D6) towards the nearest point on the edge of the
 * unit's own Deployment Zone, as far towards it as the unit can get: slowed by terrain as a normal move, going round
 * what it may not cross, and ending at least 1" from enemy models (stopping short where that's the only way).
 */
function fallBack(state, u) {
  const d = core.fallBackDistance(u, state.dice);
  const homePts = homeEdge(state, u.side);
  const target = homePts.reduce((b, p) => (Math.hypot(p.x - u.x, p.y - u.y) < Math.hypot(b.x - u.x, b.y - u.y) ? p : b));
  moveUnit(state, u, target, d);
  if (u.destroyed) return d;
  // only reaching the edge of its own Deployment Zone counts (CONFIRMED)
  const dist2edge = Math.min(...homePts.map((p) => Math.hypot(p.x - u.x, p.y - u.y))) - u.r - 0.5;
  state.log(`  ${u.name} falls back ${d}"`);
  // SHEET: reaching the table edge, it tests Leadership: a fail removes it, a pass leaves it Suppressed
  if (dist2edge <= 0.6) {
    if (check(state, u, 'LD', 0, 'at the table edge')) { u.statuses.delete('Routed'); addStatus(state, u, 'Suppressed', 'rallied at the table edge'); }
    else { state.log(`  ${u.name} flees the battlefield`); if (state.onFled) state.onFled(u); }
  }
  return d;
}

module.exports = {
  moveUnit, reservesSubPhase, moveSubPhase, routSubPhase, fallBack, disembarkIfWorth, enemiesOf, homeEdge, simulateMove, battlesmith,
  destination, drivenThrough, throughMove, dangerousTerrain, canCarry, canEmbark, embark, embarkToRide, escapeInto, deepStrikeDisembark,
  removeWithin, emergencySpot, freeSpot, spotOK, onMarker, mustDeepStrike, isAntigrav, MARKER_R, chargeRoute,
};
