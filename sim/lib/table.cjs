'use strict';
// The battlefield: a 72" x 48" table, terrain pieces as rectangles, objectives as points.
// Units are circles (centre + radius), which is all the geometry the simulator needs: ranges are measured
// edge to edge, line of sight is three sight lines between the circles, and terrain gives cover or blocks sight.

const W = 72, H = 48;

// terrain kinds. SHEET: Light terrain 6+ cover; Medium 5+ cover and sight through at most 3" of it; Heavy 4+ cover
// and blocks sight; Difficult -2" of movement. MISSION: Area Terrain is Light or Medium (Heavy at most once);
// Terrain Features are Impassable and block sight, or are ruins counted as Medium Area Terrain.
// ASSUMPTION: Medium Area Terrain is difficult, Light isn't.
const KINDS = {
  light: { density: 'light', coverSave: 6, blocksLoS: false, cover: true, difficult: false, impassable: false },
  medium: { density: 'medium', coverSave: 5, blocksLoS: false, losDepth: 3, cover: true, difficult: true, impassable: false },
  heavy: { density: 'heavy', coverSave: 4, blocksLoS: true, cover: true, difficult: true, impassable: false },
  ruin: { density: 'medium', coverSave: 5, blocksLoS: false, losDepth: 3, cover: true, difficult: true, impassable: false },
  building: { density: 'impassable', coverSave: null, blocksLoS: true, cover: false, difficult: false, impassable: true },
};

/**
 * The Core Mission terrain (MISSION): two 8" x 8" and four 6" x 6" zones of Area Terrain, and six Terrain
 * Features no larger than 4" x 4", evenly spread. Laid out point-symmetrically so neither side gets the better
 * table. opts.forbid: rectangles where no terrain may go (Supply Road).
 */
function makeTable(dice, opts = {}) {
  const pieces = [];
  const forbid = opts.forbid || [];
  const half = [[8, 'area'], [6, 'area'], [6, 'area'], [4, 'feature'], [4, 'feature'], [4, 'feature']];
  for (const [size, type] of half) {
    for (let guard = 0; guard < 300; guard++) {
      const x = 1 + dice.rnd() * (W - 2 - size), y = 1 + dice.rnd() * (H - 2 - size);
      const kind = type === 'area' ? (dice.rnd() < 0.6 ? 'medium' : 'light') : dice.rnd() < 0.5 ? 'building' : 'ruin';
      const a = { x, y, w: size, h: size, kind }, b = { x: W - x - size, y: H - y - size, w: size, h: size, kind };
      if (overlap(a, b, 2)) continue;
      if ([a, b].some((p) => pieces.some((q) => overlap(p, q, 2)) || forbid.some((f) => overlap(p, f, 0)))) continue;
      pieces.push(a, b);
      break;
    }
  }
  return { W, H, pieces: pieces.map((p, i) => Object.assign({ id: i }, p, KINDS[p.kind])), objectives: [] };
}
const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// ---------- geometry ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Edge-to-edge distance between two units (0 when touching or overlapping). */
const gap = (a, b) => Math.max(0, dist(a, b) - a.r - b.r);
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** How far (in inches) the segment p-q runs inside rectangle r. */
function segInside(p, q, r) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]]) {
    if (pp === 0) { if (qq < 0) return 0; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return 0; if (t > t0) t0 = t; } else { if (t < t0) return 0; if (t < t1) t1 = t; }
  }
  return t1 > t0 ? (t1 - t0) * Math.hypot(dx, dy) : 0;
}
/** Does the segment p-q pass through rectangle r? (Liang-Barsky clipping) */
function segHitsRect(p, q, r) {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const clip = (pp, qq) => {
    if (pp === 0) return qq >= 0;
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, p.x - r.x) && clip(dx, r.x + r.w - p.x) && clip(-dy, p.y - r.y) && clip(dy, r.y + r.h - p.y) && t0 < t1;
}

/**
 * Line of sight from unit a to unit b: true if any of three sight lines (centre to centre and the two edges)
 * misses every sight-blocking piece that neither unit stands in. Big models (vehicles, walkers) see over ruins
 * that infantry can't, and can be seen over them.
 */
function lineOfSight(table, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const lines = [[0, 0], [a.r * 0.8, b.r * 0.8], [-a.r * 0.8, -b.r * 0.8]];
  const tall = (u) => u.r >= 2.5 && u.vehicle;
  return lines.some(([oa, ob]) => {
    const p = { x: a.x + nx * oa, y: a.y + ny * oa }, q = { x: b.x + nx * ob, y: b.y + ny * ob };
    return !table.pieces.some((r) => {
      if (inside(a, r) || inside(b, r)) return false;
      if (r.blocksLoS) return !(tall(a) && tall(b) && !r.impassable) && segHitsRect(p, q, r);
      // Medium terrain: units see up to 3" into or through it
      return r.losDepth != null && !(tall(a) || tall(b)) && segInside(p, q, r) > r.losDepth;
    });
  });
}
/** The best cover save unit b has against unit a (standing in cover terrain, or seen through it), or null. */
function inCover(table, a, b) {
  let best = null;
  for (const r of table.pieces) {
    if (!r.cover) continue;
    if (inside(b, r) || (!r.blocksLoS && !inside(a, r) && segHitsRect(a, b, r))) best = best == null ? r.coverSave : Math.min(best, r.coverSave);
  }
  return best;
}

/**
 * Move a unit up to `budget` inches towards a point, stopping short of impassable terrain, losing extra distance
 * in difficult terrain (each inch inside counts double) and staying on the table. Returns the distance moved.
 */
function moveToward(table, unit, target, budget, blockers = []) {
  const start = { x: unit.x, y: unit.y };
  const d = Math.hypot(target.x - unit.x, target.y - unit.y);
  if (d < 0.01 || budget <= 0) return 0;
  const step = 0.5;
  let used = 0, x = unit.x, y = unit.y;
  const ux = (target.x - x) / d, uy = (target.y - y) / d;
  let travelled = 0;
  while (used < budget - 1e-9 && travelled < d - 1e-9) {
    const nx = x + ux * step, ny = y + uy * step;
    const p = { x: nx, y: ny };
    if (table.pieces.some((r) => r.impassable && inside(p, r))) break;
    // a unit may slide past or away from what it touches, but not push further into it
    if (blockers.some((b) => { const dn = Math.hypot(b.x - nx, b.y - ny); return dn < b.r + unit.r - 0.01 && dn < Math.hypot(b.x - x, b.y - y) - 0.01; })) break;
    const cost = table.pieces.some((r) => r.difficult && inside(p, r)) && !unit.ignoresTerrain ? 2 * step : step;
    if (used + cost > budget + 1e-9) break;
    used += cost; travelled += step; x = nx; y = ny;
  }
  unit.x = Math.min(W - unit.r, Math.max(unit.r, x));
  unit.y = Math.min(H - unit.r, Math.max(unit.r, y));
  return Math.hypot(unit.x - start.x, unit.y - start.y);
}

module.exports = { W, H, KINDS, makeTable, dist, gap, inside, segHitsRect, segInside, lineOfSight, inCover, moveToward };
