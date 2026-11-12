// The battle simulator's building blocks: dice, list loading, geometry and attack resolution.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDice } = require('../sim/lib/dice.cjs');
const { buildUnit, itemCount } = require('../sim/lib/army.cjs');
const { resolveGroup, meleeGroup, rangedGroup, expectedGroup } = require('../sim/lib/attack.cjs');
const { makeTable, lineOfSight, gap, segHitsRect } = require('../sim/lib/table.cjs');
const { hitNeedWS } = require('../sim/lib/rules.cjs');

const list = (faction) => ({ version: 2, faction, pointsLimit: 3000, sequelae: [], config: {}, detachments: [] });
const unit = (faction, unitId, extra = {}, side = 0) => buildUnit(faction, list(faction), { role: 'Troops', unit: Object.assign({ unitId }, extra) }, { name: 'test' }, side);

test('dice: seeded, repeatable and evenly spread (no short cycle)', () => {
  const a = createDice(5), b = createDice(5);
  for (let i = 0; i < 100; i++) assert.equal(a.d6(), b.d6());
  const d = createDice(1), counts = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 60000; i++) counts[d.d6()]++;
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(counts[f] - 10000) < 400, `face ${f}: ${counts[f]}`);
  const seen = new Set(); const e = createDice(3);
  for (let i = 0; i < 50000; i++) seen.add(e.rnd());
  assert.ok(seen.size > 49900, 'no short cycle');
});

test('the HH3 melee chart', () => {
  assert.deepEqual([hitNeedWS(4, 4), hitNeedWS(5, 4), hitNeedWS(4, 5), hitNeedWS(8, 4), hitNeedWS(3, 6)], [4, 3, 5, 2, 6]);
});

test('lists load through the builder engine with real weapons', () => {
  const hp = unit('rangdan', 'hunt-pack', { arkana: 'Iron Chain' });
  assert.equal(hp.models.length, 3);
  assert.equal(hp.pts, 240);
  assert.ok(hp.models.every((m) => m.melee.some((w) => w.name === 'Spine Glaive') && m.ranged.some((w) => w.name === 'Hunting Cry')));
  assert.equal(itemCount('2 Hull Mounted Shadow Blasters'), 2);
  assert.equal(itemCount('Two Sponson Mounted Lascannons'), 2);
  assert.equal(itemCount('Twin lascannon'), 1);
  const tac = unit('sons-of-horus', 'tactical-squad', {}, 1);
  assert.equal(tac.models.length, 10);
  assert.ok(tac.r > 1 && tac.r < 5);
});

test('attack resolution matches the expected value', () => {
  const dice = createDice(11);
  const hp = unit('rangdan', 'hunt-pack', { arkana: 'Iron Chain' });
  let kills = 0, exp = 0; const N = 3000;
  for (let i = 0; i < N; i++) {
    const t = unit('sons-of-horus', 'tactical-squad', {}, 1);
    for (const m of hp.models) { const g = meleeGroup(m, m.melee[0], t, {}); if (!i) exp += expectedGroup(g, t); kills += resolveGroup(g, t, { dice }).kills; }
  }
  assert.ok(Math.abs(kills / N - exp) < 0.25, `${kills / N} vs ${exp}`);
  // a lascannon against AV13: penetrates on 5-6, glances on 4
  const pred = unit('sons-of-horus', 'predator', {}, 1);
  const hss = unit('sons-of-horus', 'heavy-support-squad', { options: { 'unit-legion-heavy-weapons-list': 'Lascannon' } }, 1);
  let hp2 = 0;
  for (let i = 0; i < N; i++) {
    const p = unit('sons-of-horus', 'predator', {}, 1);
    const m = hss.models[0]; const w = m.ranged.find((x) => x.name === 'Lascannon');
    const g = rangedGroup(m, w, p, {}); g.from = { x: p.x, y: p.y - 10 };
    hp2 += resolveGroup(g, p, { dice }).damage;
  }
  assert.ok(Math.abs(hp2 / N - (4 / 6) * (3 / 6)) < 0.04, `${hp2 / N}`);
  assert.equal(pred.vehicle, true);
});

test('table geometry: symmetric terrain, edge-to-edge ranges and blocked sight lines', () => {
  const t = makeTable(createDice(2));
  assert.equal(t.pieces.length % 2, 0);
  const a = { x: 10, y: 10, r: 2 }, b = { x: 20, y: 10, r: 3 };
  assert.equal(gap(a, b), 5);
  assert.ok(segHitsRect({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 4, y: 4, w: 2, h: 2 }));
  assert.ok(!segHitsRect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 4, w: 2, h: 2 }));
  const wall = { pieces: [{ x: 14, y: 0, w: 2, h: 48, blocksLoS: true, kind: 'building' }] };
  assert.equal(lineOfSight(wall, { x: 5, y: 20, r: 1 }, { x: 30, y: 20, r: 1 }), false);
  assert.equal(lineOfSight({ pieces: [] }, { x: 5, y: 20, r: 1 }, { x: 30, y: 20, r: 1 }), true);
});
