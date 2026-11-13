'use strict';
// Army plans, kept from one Player Turn to the next (ASSUMPTION: the AI's own planning, not a rule). At the start
// of each of its Player Turns a side
//  - gives each assault group (an assault unit, or one being carried in a transport) a target, and keeps it while it
//    lives and stays the better choice by a margin, so the group closes on one enemy instead of changing its mind;
//  - picks a wave turn: the first turn by which at least two of its assault groups (or its only one) can charge
//    their targets. Until then the groups stage: they keep their target within next turn's reach but stay out of
//    sight or in cover, and don't charge unless the enemy is already on top of them, so they strike together
//    rather than one at a time, each to be shot down after its fight. In the last two turns they go regardless.
// SIM_PLAN=off turns planning off, SIM_PLAN=focus keeps the targets but strikes at once (for measuring).
const { alive } = require('./checks.cjs');
const { gap } = require('./table.cjs');
const core = require('./core.cjs');

const MODE = () => process.env.SIM_PLAN || 'wave';
const CHARGE = 4.5; // the expected Charge Roll (2D6, keep the highest), less a little

function isAssault(state, u, foes, ai) {
  return !u.vehicle && ai.canCharge(u) && ai.meleeValue(state, u, foes) > ai.shootValue(state, u, foes);
}
/** How far a group can go and still charge this turn: its move (or its transport's), getting out, Set-up Move, charge. */
function reach(state, u, ai) {
  const t = u.embarkedIn;
  return (t ? ai.moveOf(t) + t.r + u.r + 1 : ai.moveOf(u)) + core.setupMove(u) + CHARGE;
}
/** Player Turns of this side until the group can charge the target (0: this turn). */
function eta(state, u, e, ai) {
  const from = u.embarkedIn || u;
  const d = Math.max(0, gap(from, e));
  const r = reach(state, u, ai);
  return d <= r ? 0 : Math.ceil((d - r) / Math.max(1, ai.moveOf(from)));
}

function update(state, side) {
  state.plans = state.plans || [null, null];
  if (MODE() === 'off') { state.plans[side] = null; return; }
  const ai = require('./ai.cjs');
  const P = state.plans[side] = state.plans[side] || { target: new Map(), wave: null };
  const foes = state.units.filter((e) => e.side !== side && !e.destroyed && e.arrived && !e.embarkedIn && !/Flyer/.test(e.unitType));
  P.groups = [];
  if (!foes.length) { P.wave = null; return; }
  const worth = (u, e) => (ai.meleeEV(state, u, e) + ai.huntValue(state, u, e, ai.meleeEV(state, u, e), 0.5)) / (1 + eta(state, u, e, ai));
  for (const u of state.units) {
    if (u.side !== side || u.destroyed || !u.arrived || u.lockedWith.size || !isAssault(state, u, foes, ai)) continue;
    const kept = foes.find((e) => e.uid === P.target.get(u.uid));
    let best = null;
    for (const e of foes) { const v = worth(u, e); if (!best || v > best.v) best = { e, v }; }
    // keep the old target unless another is clearly better
    const t = kept && (!best || best.e === kept || worth(u, kept) * 1.3 >= best.v) ? kept : best && best.e;
    if (!t) continue;
    P.target.set(u.uid, t.uid);
    P.groups.push({ u, t, eta: eta(state, u, t, ai) });
  }
  if (!P.groups.length) { P.wave = null; return; }
  const etas = P.groups.map((g) => g.eta).sort((a, b) => a - b);
  const waitFor = etas[Math.min(2, etas.length) - 1];
  P.wave = MODE() === 'focus' || state.turnsLeft <= 2 ? state.round : state.round + waitFor;
}

/** The plan for unit u (or for the assault unit it carries): { target, waiting } or null. */
function of(state, u) {
  const P = state.plans?.[u.side];
  if (!P || !P.groups) return null;
  const g = P.groups.find((x) => x.u === u) || (u.passengers?.length ? P.groups.find((x) => u.passengers.includes(x.u)) : null);
  if (!g || g.t.destroyed) return null;
  return { target: g.t, assault: g.u, waiting: P.wave != null && state.round < P.wave };
}

module.exports = { update, of, eta, reach, isAssault };
