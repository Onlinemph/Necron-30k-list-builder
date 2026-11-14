'use strict';
// Moving round what's in the way. A straight move stops at impassable terrain and at other units; when it stops
// short, the unit takes the shortest way round instead, found on a 1" grid and then pulled straight, and measured
// along the path it takes (ASSUMPTION: the simulator's stand-in for a player moving models round obstacles; the rules
// measure the distance each model actually moves). Difficult terrain still costs its flat 2" once, if the path
// enters it. Charges stay straight lines (they move directly at the target).
const { W, H, inside, segHitsRect } = require('./table.cjs');

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** A small binary heap of [cost, node] pairs. */
function heap() {
  const a = [];
  return {
    get size() { return a.length; },
    push(c, n) { a.push([c, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } },
    pop() {
      const top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
      return top;
    },
  };
}

/**
 * Where the unit can stand, and what entering a point costs it.
 * env: { tableView, blockers, difficultAt(p), penalty }
 */
function rules(u, env) {
  const start = { x: u.x, y: u.y };
  // a unit may move past or away from what it already touches, but not further into it (as moveToward)
  const lim = env.blockers.map((b) => Math.min(b.r + u.r - 0.01, Math.hypot(b.x - start.x, b.y - start.y) - 0.01));
  const impassable = env.tableView.pieces.filter((r) => r.impassable);
  const free = (p) => p.x >= u.r && p.x <= W - u.r && p.y >= u.r && p.y <= H - u.r
    && !impassable.some((r) => inside(p, r))
    && env.blockers.every((b, i) => Math.hypot(b.x - p.x, b.y - p.y) >= lim[i]);
  /** Can the unit go straight from a to b (every half inch free; no difficult terrain unless `paid`)? */
  const clear = (a, b, paid) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / 0.5));
    for (let k = 1; k <= n; k++) { const p = { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }; if (!free(p) || (!paid && env.difficultAt(p))) return false; }
    return !impassable.some((r) => segHitsRect(a, b, r));
  };
  return { start, free, clear };
}

/** Shortest-path costs from the unit to the points of a 1" grid round it, out to `budget` inches. */
function field(u, budget, env, R) {
  const N = Math.ceil(budget) + 1, S = 2 * N + 1;
  const pt = (i) => ({ x: u.x + (Math.floor(i / S) - N), y: u.y + ((i % S) - N) });
  const cost = new Float64Array(2 * S * S).fill(Infinity), prev = new Int32Array(2 * S * S).fill(-1);
  const freeAt = new Int8Array(S * S); // 0 unknown, 1 free, 2 blocked
  const isFree = (i) => { if (!freeAt[i]) freeAt[i] = R.free(pt(i)) ? 1 : 2; return freeAt[i] === 1; };
  const origin = N * S + N;
  const startPaid = env.difficultAt(R.start) ? 1 : 0;
  const s0 = origin * 2 + startPaid;
  cost[s0] = startPaid ? env.penalty : 0;
  const q = heap(); q.push(cost[s0], s0);
  while (q.size) {
    const [c, s] = q.pop();
    if (c > cost[s]) continue;
    const i = s >> 1, paid = s & 1, gx = Math.floor(i / S), gy = i % S;
    for (const [dx, dy] of NB) {
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
      const j = nx * S + ny;
      if (!isFree(j)) continue;
      const a = pt(i), b = pt(j);
      // no cutting the corner of an impassable piece
      if (dx && dy && !R.free({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) continue;
      const enters = !paid && env.difficultAt(b);
      const nc = c + (dx && dy ? Math.SQRT2 : 1) + (enters ? env.penalty : 0);
      if (nc > budget + 1e-9) continue;
      const t = j * 2 + (paid || enters ? 1 : 0);
      if (nc < cost[t]) { cost[t] = nc; prev[t] = s; q.push(nc, t); }
    }
  }
  return { N, S, pt, cost, prev };
}

/**
 * The way round to `to` for a move of `budget` inches: the end of the shortest path that gets closest to the point,
 * then straight on with what's left. Returns { x, y, len, from } (len: inches moved, from: the start of the last
 * leg, for a vehicle's facing) or null if no grid point gets closer than the start.
 */
function route(u, to, budget, env, cache) {
  const R = rules(u, env);
  const key = `${u.x},${u.y},${u.r},${budget}`;
  let F = cache && cache.get(key);
  if (!F) { F = field(u, budget, env, R); if (cache) cache.set(key, F); }
  let best = -1, bd = Math.hypot(to.x - u.x, to.y - u.y) - 0.25;
  for (let s = 0; s < F.cost.length; s++) {
    if (!(F.cost[s] <= budget)) continue;
    const p = F.pt(s >> 1), d = Math.hypot(to.x - p.x, to.y - p.y) + F.cost[s] * 1e-3;
    if (d < bd) { bd = d; best = s; }
  }
  if (best < 0) return null;
  // the grid path back to the start, then pulled straight: each leg goes as far along it as a straight line can
  const path = [];
  for (let s = best; s >= 0; s = F.prev[s]) path.unshift({ p: F.pt(s >> 1), paid: !!(s & 1) });
  const pts = [R.start];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !R.clear(path[i].p, path[j].p, path[i].paid)) j--;
    pts.push(path[j].p); i = j;
  }
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  const paid = path[path.length - 1].paid;
  // straight on towards the point with whatever is left (not into difficult terrain unless it's paid for)
  let end = pts[pts.length - 1];
  let left = budget - len - (paid ? env.penalty : 0);
  const d = Math.hypot(to.x - end.x, to.y - end.y);
  if (left > 0.25 && d > 0.25) {
    const ux = (to.x - end.x) / d, uy = (to.y - end.y) / d;
    let go = 0;
    const cap = Math.min(left, d);
    while (go + 0.25 <= cap) { const p = { x: end.x + ux * (go + 0.25), y: end.y + uy * (go + 0.25) }; if (!R.free(p) || (!paid && env.difficultAt(p))) break; go += 0.25; }
    if (go > 0) { pts.push({ x: end.x + ux * go, y: end.y + uy * go }); len += go; end = pts[pts.length - 1]; }
  }
  return { x: end.x, y: end.y, len, from: pts.length > 1 ? pts[pts.length - 2] : R.start };
}

module.exports = { route, field };
