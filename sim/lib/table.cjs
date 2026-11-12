'use strict';
// The battlefield: a 72" x 48" table, terrain pieces as rectangles, objectives as points.
// Units are circles (centre + radius), which is all the geometry the simulator needs: ranges are measured
// edge to edge, line of sight is three sight lines between the circles, and terrain gives cover or blocks sight.

const W = 72, H = 48;

// terrain kinds: what each blocks or gives
const KINDS = {
  ruin: { blocksLoS: true, cover: true, difficult: true, impassable: false },
  building: { blocksLoS: true, cover: true, difficult: false, impassable: true },
  wood: { blocksLoS: false, cover: true, difficult: true, impassable: false },
  crater: { blocksLoS: false, cover: true, difficult: true, impassable: false },
  barricade: { blocksLoS: false, cover: true, difficult: false, impassable: false },
};

/** A point-symmetric layout of terrain, so neither side gets a better table. */
function makeTable(dice, opts = {}) {
  const pieces = [];
  const n = opts.pieces ?? 5; // pieces per half; mirrored through the centre
  const kinds = opts.kinds || ['ruin', 'ruin', 'wood', 'crater', 'building', 'ruin', 'barricade'];
  let guard = 0;
  while (pieces.length < n * 2 && guard++ < 400) {
    const w = 4 + Math.floor(dice.rnd() * 6), h = 3 + Math.floor(dice.rnd() * 5);
    const x = 4 + dice.rnd() * (W - 8 - w), y = 6 + dice.rnd() * (H / 2 - 6 - h / 2);
    const kind = kinds[Math.floor(dice.rnd() * kinds.length)];
    const a = { x, y, w, h, kind }, b = { x: W - x - w, y: H - y - h, w, h, kind };
    if ([a, b].some((p) => pieces.some((q) => overlap(p, q, 3)))) continue;
    pieces.push(a, b);
  }
  return { W, H, pieces: pieces.map((p, i) => Object.assign({ id: i }, p, KINDS[p.kind])), objectives: [] };
}
const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// ---------- geometry ----------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Edge-to-edge distance between two units (0 when touching or overlapping). */
const gap = (a, b) => Math.max(0, dist(a, b) - a.r - b.r);
const inside = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

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
    return !table.pieces.some((r) => r.blocksLoS && !(tall(a) && tall(b) && r.kind === 'ruin') && !inside(a, r) && !inside(b, r) && segHitsRect(p, q, r));
  });
}
/** Is unit b in cover from unit a: standing in cover terrain, or seen through it? */
function inCover(table, a, b) {
  if (table.pieces.some((r) => r.cover && inside(b, r))) return true;
  return table.pieces.some((r) => r.cover && !r.blocksLoS && !inside(a, r) && segHitsRect(a, b, r));
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

module.exports = { W, H, KINDS, makeTable, dist, gap, inside, segHitsRect, lineOfSight, inCover, moveToward };
