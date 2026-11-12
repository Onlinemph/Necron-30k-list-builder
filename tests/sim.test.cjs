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
  const core7 = ['Seize the Initiative', 'Flurry of Blows', 'Test the Foe', 'Guard Up', 'Taunt and Bait', 'Grandstand', 'Finishing Blow'];
  assert.deepEqual(names(unit('sons-of-horus', 'tactical-squad')), core7);
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

test('quick reference tables: snap shots, BS Critical Hits, Set-up Move, allotment, vehicle damage, Perils', () => {
  const core = require('../sim/lib/core.cjs');
  assert.deepEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(core.snapHit), [2, 3, 4, 4, 4, 5, 5, 6, 6, 7]);
  assert.deepEqual([10, 9, 8, 7, 6, 5].map(core.bsCrit), [1, 3, 4, 5, 6, null]);
  const su = (M, I, type = 'Infantry') => core.setupMove({ unitType: type, models: [{ wounds: 1, p: { M, I } }] });
  assert.deepEqual([su(3, 3), su(5, 4), su(7, 4), su(8, 5), su(12, 4), su(14, 7), su(6, 4, 'Infantry (Heavy)')], [1, 2, 3, 4, 5, 6, 1]);
  assert.deepEqual([core.reactionAllotment(1500), core.reactionAllotment(3000), core.reactionAllotment(3000, true), core.reactionAllotment(4000)], [1, 2, 3, 3]);
  // a Glancing result the vehicle already has costs a Hull Point
  const { vehicleDamage } = require('../sim/lib/shoot.cjs');
  const pred = unit('sons-of-horus', 'predator', {}, 1);
  const st = quietState(createDice(1));
  vehicleDamage(st, pred, 'Pinned');
  assert.ok(pred.statuses.has('Pinned'));
  const hp = pred.models[0].wounds;
  vehicleDamage(st, pred, 'Pinned');
  assert.equal(pred.models[0].wounds, hp - 1);
  // Perils: a 1 or 6 is 13 - WP wounds (Invulnerable Saves only), 2-5 Stunned
  assert.deepEqual(core.perils(scripted([1]), 8), { result: 'Ætheric Feedback', wounds: 5, invulnOnly: true });
  assert.equal(core.perils(scripted([3]), 8).status, 'Stunned');
  // BS 7 hits on 2+ and crits on 5+; BS 4 snap shots need 5s
  const bs7 = { p: { BS: 7 } }, w = { FP: 1, RS: 4, AP: 7, D: 1, specialRules: [], traits: [] };
  const t = unit('sons-of-horus', 'tactical-squad', {}, 1);
  const g7 = rangedGroup(bs7, w, t, {});
  assert.deepEqual([g7.hitNeed, g7.bsCrit], [2, 5]);
  assert.equal(rangedGroup({ p: { BS: 4 } }, w, t, { snap: true }).hitNeed, 5);
});

// ---------- the Core Mission Pack ----------
const mission = require('../sim/lib/mission.cjs');
const scoring = require('../sim/lib/scoring.cjs');

test('missions: nine Core Missions, six point-symmetric Deployment Maps, Kill Points', () => {
  assert.equal(Object.keys(mission.MISSIONS).length, 9);
  assert.equal(Object.keys(mission.DEPLOYMENTS).length, 6);
  const d = createDice(3);
  for (const [id, dep] of Object.entries(mission.DEPLOYMENTS)) {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const p = { x: d.rnd() * 72, y: d.rnd() * 48 };
      if (!mission.inArea(dep.A, p)) continue;
      n++;
      assert.ok(mission.inArea(dep.B, { x: 72 - p.x, y: 48 - p.y }), `${id}: mirror of (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
      assert.ok(!mission.inArea(dep.B, p), `${id}: zones overlap`);
    }
    assert.ok(n > 20, `${id}: zone A is tiny`);
  }
  // Search and Destroy cuts an 18" circle out of the middle
  assert.equal(mission.inArea(mission.DEPLOYMENTS['search-and-destroy'].A, { x: 33, y: 22 }), false);
  assert.deepEqual([176, 126, 40, 250, 349].map((pts) => mission.killPoints({ pts })), [2, 1, 1, 3, 3]);
});

const fakeUnit = (side, n, x, y, extra = {}) => Object.assign({
  side, x, y, r: 1, arrived: true, destroyed: false, embarkedIn: null, reserve: null, statuses: new Set(), lockedWith: new Set(), rules: [], unitType: 'Infantry', name: `unit ${side}`,
  models: Array.from({ length: n }, () => ({ wounds: 1, maxWounds: 1, p: { M: 7 }, rules: extra.modelRules || [], unitType: extra.unitType || 'Infantry' })),
}, extra);

test("Claim Supplies: the strongest single unit controls; vehicles can, statused units can't", () => {
  const o = { x: 30, y: 20, value: 2, id: 0 };
  // two units of 3 against one of 5: the 5 wins, because units aren't added together
  const st = { table: { objectives: [o] }, units: [fakeUnit(0, 3, 30, 21), fakeUnit(0, 3, 31, 20), fakeUnit(1, 5, 29, 20)] };
  assert.equal(scoring.claimControl(st)[0].side, 1);
  // Line (X) adds X per model to Tactical Strength
  st.units[0].models.forEach((m) => { m.rules = ['Line (2)']; });
  assert.equal(scoring.claimControl(st)[0].side, 0);
  // a tie controls nothing; Pinned can't contest; a vehicle can control; Disgraced doesn't stop it
  const tie = { table: { objectives: [o] }, units: [fakeUnit(0, 4, 30, 21), fakeUnit(1, 4, 29, 20)] };
  assert.equal(scoring.claimControl(tie)[0].side, null);
  tie.units[1].statuses.add('Pinned');
  assert.equal(scoring.claimControl(tie)[0].side, 0);
  assert.equal(scoring.canControl(fakeUnit(0, 1, 0, 0, { vehicle: true, unitType: 'Vehicle' })), true);
  assert.equal(scoring.canControl(fakeUnit(0, 3, 0, 0, { statuses: new Set(['Disgraced']) })), true);
  assert.equal(scoring.canControl(fakeUnit(0, 3, 0, 0, { rules: ['Heedless'] })), false);
  assert.equal(scoring.canControl(fakeUnit(0, 3, 0, 0, { unitType: 'Automata', modelRules: [], extra: 1, models: [{ wounds: 1, p: { M: 6 }, rules: [], unitType: 'Automata' }] })), false);
  // Vanguard caps a marker at 1 VP; Support Unit (X) caps at X
  assert.equal(scoring.markerVP(fakeUnit(0, 3, 0, 0, { modelRules: ['Vanguard (2)'] }), 3), 1);
  assert.equal(scoring.markerVP(fakeUnit(0, 3, 0, 0, { modelRules: ['Line (2)', 'Support Unit (2)'] }), 3), 2);
});

test('Seize Ground: models in the Sector, plus Line at home and Vanguard in the enemy zone', () => {
  const d = createDice(1);
  const m = mission.setupMission(d, { pieces: [], objectives: [] }, { mission: 'secure-the-highway', deployment: 'dawn-of-war' });
  const st = { mission: m, zoneName: ['A', 'B'], units: [fakeUnit(0, 3, 30, 5, { modelRules: ['Line (1)'] }), fakeUnit(1, 5, 40, 5)] };
  // Sector 1 (y 0-10) lies in zone A: side 0 has 3 + 3 Line, side 1 has 5
  const c = scoring.sectorControl(st).find((x) => x.s.id === 1);
  assert.deepEqual(c.ts, [6, 5]);
  assert.equal(c.side, 0);
  // Vanguard counts in the enemy's zone instead
  st.units[1].models.forEach((x) => { x.rules = ['Vanguard (1)']; });
  assert.deepEqual(scoring.sectorControl(st).find((x) => x.s.id === 1).ts, [6, 10]);
});

test('each Archetype plays through', () => {
  const a = path.join(LISTS, 'rangdan.json'), b = path.join(LISTS, 'sons-of-horus.json');
  for (const m of ['crucial-supplies', 'thin-the-ranks', 'high-ground']) {
    const r = runBattle(a, b, { seed: 11, mission: m });
    assert.equal(r.mission, m);
    assert.ok(r.turns === 5 || r.turns === 6);
    assert.ok(r.vp[0] + r.vp[1] > 0, m);
  }
});

test('Rangdan rules: Neural Collars, Medusa Shroud, Burning Sky range', () => {
  const { check, passChance, collarState } = require('../sim/lib/checks.cjs');
  const { planVolley } = require('../sim/lib/fire.cjs');
  const thralls = unit('rangdan', 'thrall-cohort', { arkana: 'Silent Choir' }, 0);
  const hunters = unit('rangdan', 'hunt-pack', { arkana: 'Silent Choir' }, 0);
  thralls.x = 10; thralls.y = 10; hunters.x = 20; hunters.y = 10;
  const st = { units: [thralls, hunters], dice: createDice(1), log: () => {} };
  // near a Rangda model: Leadership and Cool Checks always pass, even at -10
  assert.equal(collarState(st, thralls), 'near');
  for (let i = 0; i < 20; i++) assert.equal(check(st, thralls, 'LD', 10), true);
  // out of reach (12" for Silent Choir thralls): Leadership and Cool become 5
  hunters.x = 40;
  assert.equal(collarState(st, thralls), 'far');
  assert.ok(Math.abs(passChance(st, thralls, 'CL') - 10 / 36) < 1e-9);
  // the Iron Chain war-moon reaches 18"
  const iron = unit('rangdan', 'thrall-cohort', { arkana: 'Iron Chain' }, 0);
  iron.x = 10; iron.y = 10; hunters.x = 10 + iron.r + hunters.r + 15;
  assert.equal(collarState({ units: [iron, hunters] }, iron), 'near');
  // Medusa Shroud: an Iron Medusa saves glancing and penetrating hits from shooting on a 5+
  const medusa = unit('rangdan', 'iron-medusa', { arkana: 'Iron Chain' }, 1);
  const g = { attacks: 1, S: 20, AP: 2, D: 1, hitNeed: null, rules: [], melee: false, from: { x: 0, y: -10 } };
  const s1 = expectedGroup(g, medusa), s2 = expectedGroup(Object.assign({}, g, { melee: true }), medusa);
  assert.ok(Math.abs(s1 / s2 - 4 / 6) < 1e-9);
  // Burning Sky: Rangda weapons reach 6" further
  const lancersBS = unit('rangdan', 'shadow-lancers', { arkana: 'Burning Sky' }, 0);
  const lancersIC = unit('rangdan', 'shadow-lancers', { arkana: 'Iron Chain' }, 0);
  const target = unit('sons-of-horus', 'tactical-squad', {}, 1);
  const at = (u) => { u.x = 0; u.y = 0; target.x = u.r + target.r + 27; target.y = 0; return planVolley(u, target, { table: { pieces: [] } }, { losOK: true }).picks.length; };
  assert.equal(at(lancersIC), 0);
  assert.ok(at(lancersBS) > 0);
});

test('the Iron Wall list loads and plays', () => {
  const r = runBattle(path.join(LISTS, 'rangdan-iron-wall.json'), path.join(LISTS, 'sons-of-horus-3000.json'), { seed: 2, mission: 'crucial-supplies' });
  assert.ok(r.vp[0] + r.vp[1] > 0);
  assert.equal(r.units[0].length, 17);
});

test('Legion Tacticas', () => {
  const legions = require('../sim/lib/legions.cjs');
  const core = require('../sim/lib/core.cjs');
  const { planVolley } = require('../sim/lib/fire.cjs');
  const { passChance } = require('../sim/lib/checks.cjs');
  const tac = (l) => unit(l, 'tactical-squad', {}, 1);
  assert.equal(legions.legionOf(tac('sons-of-horus')), 'Sons of Horus');
  // The Hunter's Strike: +2" Set-up Move
  assert.equal(core.setupMove(tac('space-wolves')), core.setupMove(tac('ultramarines')) + 2);
  // Promethean Endurance: an S8 hit wounds T4 on 3+ instead of 2+; The Gorgon's Scales: S4 shooting needs 5+
  const g8 = { attacks: 60, S: 8, AP: 7, D: 1, hitNeed: null, rules: [], melee: false };
  assert.ok(Math.abs(expectedGroup(g8, tac('salamanders')) / expectedGroup(g8, tac('ultramarines')) - 4 / 5) < 1e-9);
  const g4 = Object.assign({}, g8, { S: 4 });
  assert.ok(Math.abs(expectedGroup(g4, tac('iron-hands')) / expectedGroup(g4, tac('ultramarines')) - 2 / 3) < 1e-9);
  assert.equal(expectedGroup(Object.assign({}, g4, { melee: true }), tac('iron-hands')), expectedGroup(Object.assign({}, g4, { melee: true }), tac('ultramarines')));
  // Lies and Obfuscation: a 24" gun can't reach an Alpha Legion unit 23" away
  const shooter = unit('ultramarines', 'heavy-support-squad', { options: { 'unit-legion-heavy-weapons-list': 'Lascannon' } }, 0);
  const at = (t) => { shooter.x = 0; shooter.y = 0; t.x = shooter.r + t.r + 47; t.y = 0; return planVolley(shooter, t, { table: { pieces: [] } }, { losOK: true }).picks.length; };
  assert.ok(at(tac('ultramarines')) > 0);
  assert.equal(at(tac('alpha-legion')), 0);
  // The Angel of Death: Fear takes off at most 1
  const fearful = { units: [], log: () => {} };
  const da = tac('dark-angels'), um = tac('ultramarines');
  const scary = unit('rangdan', 'hunt-sovereign', { arkana: 'Silent Choir' }, 0);
  for (const u of [da, um]) { u.x = 0; u.y = 0; }
  scary.x = 5; scary.y = 0; fearful.units = [da, um, scary];
  assert.ok(passChance(fearful, da, 'CL') > passChance(fearful, um, 'CL'));
  // Swift of Action: +2 Movement; Cult Arcana: every unit a Psyker with +1 Willpower
  assert.equal(+tac('white-scars').models[0].p.M, +tac('ultramarines').models[0].p.M + 2);
  const ts = tac('thousand-sons');
  assert.equal(ts.psyker, true);
  const raw = require('../sim/lib/army.cjs').loadArmyData('thousand-sons').D.units.find((u) => u.id === 'tactical-squad').models[0].profile;
  assert.equal(+ts.models[0].p.WP, +raw.WP + 1);
});
