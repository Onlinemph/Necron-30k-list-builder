'use strict';
// Missions: where objectives sit, how much each is worth, where each side deploys, and how many battle turns.
// The default is a plain Dawn of War style mission: two long-edge deployment zones and five objectives.
const { W, H } = require('./table.cjs');

const MISSIONS = {
  // five objectives: one in the centre worth more, one in each half, two on the flanks of no man's land
  'standard': {
    name: 'Standard engagement',
    turns: 5,
    deployDepth: 12,
    objectives: [
      { x: W / 2, y: H / 2, value: 3 },
      { x: W * 0.25, y: H * 0.25, value: 2 }, { x: W * 0.75, y: H * 0.75, value: 2 },
      { x: W * 0.2, y: H / 2, value: 1 }, { x: W * 0.8, y: H / 2, value: 1 },
    ],
    controlRange: 3,
    scoreFromTurn: 2,
    killPoints: false,
    slayTheWarlord: 2,
  },
};

/** Deployment zone for a side: side 0 the bottom long edge, side 1 the top. */
const zone = (mission, side) => (side === 0 ? { x0: 0, x1: W, y0: 0, y1: mission.deployDepth } : { x0: 0, x1: W, y0: H - mission.deployDepth, y1: H });

function setupMission(name, table) {
  const m = MISSIONS[name] || MISSIONS.standard;
  table.objectives = m.objectives.map((o, i) => Object.assign({ id: i }, o));
  // objectives inside impassable terrain move to its nearest edge
  for (const o of table.objectives) {
    for (const r of table.pieces) if (r.impassable && o.x >= r.x && o.x <= r.x + r.w && o.y >= r.y && o.y <= r.y + r.h) o.y = o.y < H / 2 ? r.y - 1 : r.y + r.h + 1;
  }
  return m;
}

module.exports = { MISSIONS, zone, setupMission };
