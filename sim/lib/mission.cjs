'use strict';
// Core Missions from the Core Mission Pack: Imperium at War (marked MISSION in the comments): nine missions in
// three Archetypes, six Deployment Maps, three Primary Objectives (Claim Supplies, Destroy the Enemy, Seize
// Ground), the four Secondary Objectives and the Mission Special Rules.
//
// Coordinates: the battlefield is 72" x 48", x from the left edge, y from the top edge of the pack's maps.
const { W, H } = require('./table.cjs');

// ---------- areas: polygons, optionally with a circle cut out or a circle alone ----------
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function inPoly(poly, p) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) c = !c;
  }
  // points on the polygon's edge count as inside
  if (!c) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (onSeg(poly[j], poly[i], p)) return true;
  return c;
}
function onSeg([x1, y1], [x2, y2], p) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const t = ((p.x - x1) * (x2 - x1) + (p.y - y1) * (y2 - y1)) / (len * len);
  if (t < 0 || t > 1) return false;
  return Math.hypot(x1 + t * (x2 - x1) - p.x, y1 + t * (y2 - y1) - p.y) < 0.05;
}
/** Is point p in an area { poly?, circle?, notCircle? }? */
function inArea(a, p) {
  if (a.poly && !inPoly(a.poly, p)) return false;
  if (a.circle && Math.hypot(p.x - a.circle.x, p.y - a.circle.y) > a.circle.r) return false;
  if (a.notCircle && Math.hypot(p.x - a.notCircle.x, p.y - a.notCircle.y) <= a.notCircle.r) return false;
  return true;
}
/** Does a unit circle fit entirely inside an area (and the battlefield)? */
function fits(a, p, r) {
  if (p.x - r < 0 || p.x + r > W || p.y - r < 0 || p.y + r > H) return false;
  if (!inArea(a, p)) return false;
  for (let k = 0; k < 8; k++) { const t = (k / 8) * 2 * Math.PI; if (!inArea(a, { x: p.x + Math.cos(t) * r * 0.95, y: p.y + Math.sin(t) * r * 0.95 })) return false; }
  return true;
}
/** Does a unit circle touch an area at all? */
function touches(a, p, r) {
  if (inArea(a, p)) return true;
  for (let k = 0; k < 12; k++) { const t = (k / 12) * 2 * Math.PI; if (inArea(a, { x: p.x + Math.cos(t) * r, y: p.y + Math.sin(t) * r })) return true; }
  return false;
}
/** Points on the battlefield edge, every inch. */
const EDGE = (() => {
  const pts = [];
  for (let x = 0; x <= W; x++) pts.push({ x, y: 0 }, { x, y: H });
  for (let y = 1; y < H; y++) pts.push({ x: 0, y }, { x: W, y });
  return pts;
})();
const centroid = (a) => {
  let n = 0, x = 0, y = 0;
  for (let i = 0.5; i < W; i += 2) for (let j = 0.5; j < H; j += 2) if (inArea(a, { x: i, y: j })) { n++; x += i; y += j; }
  return n ? { x: x / n, y: y / n } : { x: W / 2, y: H / 2 };
};
/** Do two areas overlap (sampled on a 1" grid)? */
function overlaps(a, b) {
  for (let i = 0.5; i < W; i += 1) for (let j = 0.5; j < H; j += 1) { const p = { x: i, y: j }; if (inArea(a, p) && inArea(b, p)) return true; }
  return false;
}

// ---------- Deployment Maps (MISSION) ----------
const C = { x: W / 2, y: H / 2 };
const DEPLOYMENTS = {
  'search-and-destroy': { name: 'Search and Destroy', A: { poly: rect(0, 0, 36, 24), notCircle: { ...C, r: 9 } }, B: { poly: rect(36, 24, 72, 48), notCircle: { ...C, r: 9 } } },
  'hammer-and-anvil': { name: 'Hammer and Anvil', A: { poly: rect(0, 0, 24, 48) }, B: { poly: rect(48, 0, 72, 48) } },
  'dawn-of-war': { name: 'Dawn of War', A: { poly: rect(0, 0, 72, 12) }, B: { poly: rect(0, 36, 72, 48) } },
  'flanking-strike': { name: 'Flanking Strike', A: { poly: [[0, 0], [72, 0], [72, 24]] }, B: { poly: [[0, 24], [72, 48], [0, 48]] } },
  'determined-push': { name: 'Determined Push', A: { poly: rect(12, 0, 60, 15) }, B: { poly: rect(12, 33, 60, 48) } },
  'tip-of-the-spear': { name: 'Tip of the Spear', A: { poly: [[0, 0], [12, 0], [27, 24], [12, 48], [0, 48]] }, B: { poly: [[72, 0], [60, 0], [45, 24], [60, 48], [72, 48]] } },
};
const DEPLOYMENT_ROLL = ['search-and-destroy', 'hammer-and-anvil', 'dawn-of-war', 'flanking-strike', 'determined-push', 'tip-of-the-spear'];

// ---------- Sectors for Seize Ground (MISSION) ----------
const SECTORS = {
  'high-ground': [
    { id: 1, area: { poly: rect(0, 0, 36, 24), notCircle: { ...C, r: 12 } }, value: 3 },
    { id: 2, area: { poly: rect(36, 0, 72, 24), notCircle: { ...C, r: 12 } }, value: 3 },
    { id: 3, area: { poly: rect(0, 24, 36, 48), notCircle: { ...C, r: 12 } }, value: 3 },
    { id: 4, area: { poly: rect(36, 24, 72, 48), notCircle: { ...C, r: 12 } }, value: 3 },
    { id: 5, area: { circle: { ...C, r: 12 } }, value: 5 },
  ],
  'shattered-earth': [
    { id: 1, area: { poly: [[0, 0], [72, 0], [36, 24]] }, value: 4 },
    { id: 2, area: { poly: [[0, 0], [36, 24], [0, 48]] }, value: 4 },
    { id: 3, area: { poly: [[72, 0], [72, 48], [36, 24]] }, value: 4 },
    { id: 4, area: { poly: [[0, 48], [36, 24], [72, 48]] }, value: 4 },
  ],
  'secure-the-highway': [
    { id: 1, area: { poly: rect(0, 0, 72, 10) }, value: 3 },
    { id: 2, area: { poly: rect(0, 10, 72, 20) }, value: 4 },
    { id: 3, area: { poly: rect(0, 20, 72, 28) }, value: 6 },
    { id: 4, area: { poly: rect(0, 28, 72, 38) }, value: 4 },
    { id: 5, area: { poly: rect(0, 38, 72, 48) }, value: 3 },
  ],
};

// ---------- Objective Marker set-up (MISSION) ----------
/** Place a marker at random where `ok` allows, clear of impassable terrain and 9" from other markers. */
function placeMarker(dice, table, placed, ok) {
  for (let i = 0; i < 400; i++) {
    const p = { x: 1 + dice.rnd() * (W - 2), y: 1 + dice.rnd() * (H - 2) };
    if (!ok(p)) continue;
    if (placed.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 9)) continue;
    if (table.pieces.some((r) => r.impassable && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h)) continue;
    return p;
  }
  return { x: W / 2, y: H / 2 };
}
const nearCentre = (p) => Math.hypot(p.x - W / 2, p.y - H / 2) <= 12;
const anywhere = () => true;
const awayFromEdges = (p) => p.x >= 12 && p.x <= W - 12 && p.y >= 12 && p.y <= H - 12;
function markers(dice, table, specs) {
  const placed = [];
  for (const [value, where] of specs) placed.push(Object.assign(placeMarker(dice, table, placed, where), { value, id: placed.length }));
  return placed;
}

// ---------- the nine Core Missions (MISSION) ----------
const sec = (warlord, giant, breakthrough, firstStrike) => ({ warlord, giant, breakthrough, firstStrike });
const MISSIONS = {
  'crucial-supplies': { name: 'Crucial Supplies', archetype: 'Resupply', primary: 'claim', secondaries: sec(3, 3, 3, 3),
    objectives: (d, t) => markers(d, t, [[2, nearCentre], [2, nearCentre], [1, anywhere], [1, anywhere]]) },
  'hidden-caches': { name: 'Hidden Caches', archetype: 'Resupply', primary: 'claim', secondaries: sec(2, 4, 2, 4), rules: ['Hidden Caches'],
    objectives: (d, t) => markers(d, t, [[2, awayFromEdges], [2, awayFromEdges], [2, awayFromEdges], [2, awayFromEdges]]) },
  'unknown-munitions': { name: 'Unknown Munitions', archetype: 'Resupply', primary: 'claim', secondaries: sec(3, 2, 3, 4), rules: ['Unknown Munitions'],
    objectives: (d, t) => markers(d, t, [[null, nearCentre], [null, nearCentre], [null, anywhere], [null, anywhere]]) },
  'no-quarter': { name: 'No Quarter', archetype: 'Annihilation', primary: 'destroy', secondaries: sec(3, 4, 2, 3), rules: ['No Quarter'] },
  'cut-off-the-head': { name: 'Cut Off the Head', archetype: 'Annihilation', primary: 'destroy', secondaries: sec(5, 3, 2, 3), rules: ['Cut Off the Head'] },
  'thin-the-ranks': { name: 'Thin the Ranks', archetype: 'Annihilation', primary: 'destroy', secondaries: sec(2, 2, 4, 4), rules: ['Thin the Ranks'] },
  'high-ground': { name: 'High Ground', archetype: 'Conquest', primary: 'seize', secondaries: sec(3, 3, 3, 3), sectors: 'high-ground' },
  'shattered-earth': { name: 'Shattered Earth', archetype: 'Conquest', primary: 'seize', secondaries: sec(3, 2, 3, 4), sectors: 'shattered-earth', rules: ['Tectonic Instability'] },
  'secure-the-highway': { name: 'Secure the Highway', archetype: 'Conquest', primary: 'seize', secondaries: sec(3, 3, 4, 2), sectors: 'secure-the-highway', rules: ['Supply Road'] },
};
const ARCHETYPES = { Resupply: ['crucial-supplies', 'hidden-caches', 'unknown-munitions'], Annihilation: ['no-quarter', 'cut-off-the-head', 'thin-the-ranks'], Conquest: ['high-ground', 'shattered-earth', 'secure-the-highway'] };

/** Pick a mission the way the pack suggests: a D3 for the Archetype, then a D3 for the Mission. */
function rollMission(dice) {
  const arch = Object.values(ARCHETYPES)[dice.d3() - 1];
  return arch[dice.d3() - 1];
}

/**
 * Set up a mission on a table: objectives, sectors and the two Deployment Zones (A and B).
 * opts: { mission: id | 'random', deployment: id | 'random', variant: 'escalation' | 'hammerblow' }
 */
function setupMission(dice, table, opts = {}) {
  const id = !opts.mission || opts.mission === 'random' ? rollMission(dice) : opts.mission;
  const def = MISSIONS[id];
  if (!def) throw new Error(`Unknown mission "${id}". Missions: ${Object.keys(MISSIONS).join(', ')}`);
  const depId = !opts.deployment || opts.deployment === 'random' ? DEPLOYMENT_ROLL[dice.d6() - 1] : opts.deployment;
  const dep = DEPLOYMENTS[depId];
  if (!dep) throw new Error(`Unknown deployment map "${depId}". Maps: ${Object.keys(DEPLOYMENTS).join(', ')}`);
  table.objectives = def.objectives ? def.objectives(dice, table) : [];
  const sectors = def.sectors ? SECTORS[def.sectors].map((s) => Object.assign({}, s)) : [];
  const m = Object.assign({ id, deploymentId: depId, deployment: dep.name, variant: opts.variant || 'escalation', turns: 5, rules: [] }, def, { zones: { A: dep.A, B: dep.B }, sectors });
  m.has = (rule) => m.rules.includes(rule);
  m.centroids = { A: centroid(dep.A), B: centroid(dep.B) };
  // which sectors lie at least partly in which zone (Line and Vanguard in Seize Ground)
  for (const s of m.sectors) { s.inZone = { A: overlaps(s.area, dep.A), B: overlaps(s.area, dep.B) }; s.centre = centroid(s.area); }
  return m;
}

/** Kill Points (MISSION): the unit's points rounded to the nearest hundred, divided by 100, at least 1. */
// a unit that a character joined is worth its own points; the character counts separately
const killPoints = (u) => Math.max(1, Math.round((u.kpPts ?? u.pts) / 100));

module.exports = { MISSIONS, ARCHETYPES, DEPLOYMENTS, DEPLOYMENT_ROLL, SECTORS, setupMission, rollMission, inArea, fits, touches, EDGE, killPoints, rect };
