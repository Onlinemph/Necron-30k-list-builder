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

// ---------- rules added with the full battle loop ----------
const path = require('path');
const { xOf } = require('../sim/lib/rules.cjs');
const { runBattle } = require('../sim/lib/battle.cjs');
const reactions = require('../sim/lib/reactions.cjs');
const psychic = require('../sim/lib/psychic.cjs');
const gambits = require('../sim/lib/gambits.cjs');
const LISTS = path.join(__dirname, '..', 'sim', 'lists');
/** Dice that roll a script of results, then fall back to a seeded generator. */
const scripted = (rolls, seed = 1) => { const d = createDice(seed); return Object.assign({}, d, { d6: () => (rolls.length ? rolls.shift() : d.d6()) }); };
const quietState = (dice) => ({ dice, units: [], log: () => {}, powerCount: [{}, {}], onCasualty: () => {}, afterDamage: () => {} });

test('Blast (X") parses and makes one Hit Test per shot, hitting every model under the marker', () => {
  assert.equal(xOf(['Blast (3")'], 'Blast'), 3);
  assert.equal(xOf(['Blast (5")'], 'Blast'), 5);
  assert.equal(xOf(['Breaching (5+)'], 'Breaching'), 5);
  const dice = createDice(4);
  const shooter = unit('sons-of-horus', 'tactical-squad', {}, 0).models[0];
  const w = { name: 'Test blast', FP: 1, RS: 4, AP: 7, D: 1, specialRules: ['Blast (3")'], traits: [] };
  const counts = new Map();
  for (let i = 0; i < 400; i++) {
    const t = unit('sons-of-horus', 'tactical-squad', {}, 1);
    const g = rangedGroup(shooter, w, t, {});
    assert.equal(g.attacks, 1); assert.equal(g.blastN, 3);
    const h = resolveGroup(g, t, { dice }).hits;
    counts.set(h, (counts.get(h) || 0) + 1);
  }
  assert.deepEqual([...counts.keys()].sort(), [0, 3]);
});

test('Overload (X) makes Misfires on low Hit Tests; Anathema ignores Psychic Weapons', () => {
  const dice = createDice(9);
  const shooter = unit('sons-of-horus', 'tactical-squad', {}, 0).models[0];
  const t = unit('sons-of-horus', 'tactical-squad', {}, 1);
  const g = rangedGroup(shooter, { name: 'x', FP: 600, RS: 4, AP: 7, D: 1, specialRules: [], traits: [] }, t, {});
  g.overload = 1; g.attacks = 600;
  const target = { models: Array.from({ length: 600 }, () => ({ wounds: 99, maxWounds: 99, p: { T: 4, SAV: '3+' }, rules: [] })), statuses: new Set() };
  const r = resolveGroup(g, target, { dice });
  assert.ok(Math.abs(r.misfires - 100) < 30, `${r.misfires}`);
  const nulls = { models: [{ wounds: 1, maxWounds: 1, p: { T: 3, SAV: '–' }, rules: ['Anathema'] }], statuses: new Set() };
  const psy = { attacks: 50, S: 10, AP: 2, D: 3, hitNeed: 2, rules: [], melee: false, weaponTraits: ['Psychic'] };
  assert.equal(resolveGroup(psy, nulls, { dice }).damage, 0);
});

test('Force (X) doubles the value on a passed Willpower Check, and a double is Perils of the Warp', () => {
  const sorc = unit('thousand-sons', 'prosperine-sorcerer');
  assert.equal(sorc.psyker, true);
  const m = sorc.models[0];
  const staff = m.melee.find((w) => /Force/.test((w.specialRules || []).join()));
  // rolls 2 and 3: passes, no double
  const w = psychic.forceCheck(quietState(scripted([2, 3])), sorc, m, staff);
  assert.equal(+w.D, 2 * +staff.D);
  // rolls 6 and 6: fails and suffers Perils
  const st = quietState(scripted([6, 6, 1, 2]));
  const w2 = psychic.forceCheck(st, sorc, m, staff);
  assert.equal(w2, staff);
  assert.equal(st.powerCount[sorc.side].Perils, 1);
});

test('reactions: each side gets the Core, generic, Legion and army reactions', () => {
  const st = { units: [unit('sons-of-horus', 'tactical-squad', {}, 0), unit('rangdan', 'hunt-pack', { arkana: 'Iron Chain' }, 1)] };
  reactions.setup(st);
  for (const n of ['Reposition', 'Return Fire', 'Overwatch', 'Smokescreen', 'Warrior Pride']) assert.ok(st.reactionSet[0].has(n), n);
  for (const n of ['The Choir Answers', 'Living Shields', 'The Hunt Closes', 'Moonfall']) assert.ok(st.reactionSet[1].has(n), n);
  assert.ok(!st.reactionSet[1].has('Warrior Pride'));
  assert.ok(st.units[0].models.every((m) => m.traits.includes('Sons of Horus')));
  // buffs from reactions stack and wear off with their phase
  const u = st.units[0];
  reactions.addBuff(u, { tough: 1 }, 'phase'); reactions.addBuff(u, { shrouded: 5 }, 'attack');
  assert.deepEqual([u.buff.tough, u.buff.shrouded], [1, 5]);
  reactions.clearBuffs(st, 'attack');
  assert.deepEqual([u.buff.tough, u.buff.shrouded], [1, 7]);
  reactions.clearBuffs(st, 'phase');
  assert.equal(u.buff, null);
});

test('gambits: Rangda, Long Hunt and Slaugth models get their own', () => {
  const names = (u) => gambits.available(u.models[0]).map((g) => g.name);
  assert.ok(names(unit('rangdan', 'hunt-pack', { arkana: 'Iron Chain' })).includes("Hunter's Stare"));
  assert.ok(!names(unit('sons-of-horus', 'tactical-squad')).length);
  const th = gambits.GAMBITS.find((g) => g.name === 'Throat-Hunter').make(null, {}, { u: { statuses: new Set(['Pinned']) } });
  assert.deepEqual(th.extraRules({ AP: 3 }), ['Breaching (4+)']);
  assert.deepEqual(th.extraRules({ AP: 2 }), ['Shred (6+)']);
  assert.equal(th.focus, 1);
});

test('a full battle runs, is repeatable by seed, and uses reactions and psychic powers', () => {
  const a = path.join(LISTS, 'rangdan.json'), b = path.join(LISTS, 'sons-of-horus.json');
  const r1 = runBattle(a, b, { seed: 7, log: true });
  const r2 = runBattle(a, b, { seed: 7, log: true });
  assert.deepEqual(r1.vp, r2.vp);
  assert.equal(r1.log.length, r2.log.length);
  assert.ok(r1.log.some((l) => /Battle Turn 5/.test(l)));
  const used = [...Object.keys(r1.reactions[0]), ...Object.keys(r1.reactions[1])];
  assert.ok(used.length >= 3, used.join());
  const orks = runBattle(path.join(LISTS, 'orks-weirdboys.json'), b, { seed: 1 });
  assert.ok(orks.vp.every((v) => v >= 0));
});
