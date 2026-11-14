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
  // a Legion model also has its Legion's gambit
  assert.deepEqual(names(unit('sons-of-horus', 'tactical-squad')), [...core7, 'Merciless Strike']);
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
  const su = (M, I, type = 'Infantry') => core.setupMove({ unitType: type, models: [{ wounds: 1, unitType: type, p: { M, I } }] });
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

test('units whose default weapons live in their options still get armed', () => {
  const names = (u) => new Set(u.models.flatMap((m) => [...m.melee, ...m.ranged].map((w) => w.name)));
  const varagyr = names(unit('space-wolves', 'varagyr-wolf-guard-terminators'));
  assert.ok(varagyr.has('Frost axe') && varagyr.has('Combi-bolter'), [...varagyr].join());
  assert.ok(names(unit('world-eaters', 'red-butchers')).has('Butcher power axes'));
  assert.ok(names(unit('space-wolves', 'grey-slayer-pack')).has('Fenrisian axe'));
  const gorgon = unit('iron-hands', 'gorgon-terminator-squad');
  assert.ok(gorgon.models.every((m) => m.melee.some((w) => w.name !== 'Close combat weapon')));
  // a weapon the player chose is kept as chosen
  const chosen = names(unit('sons-of-horus', 'justaerin-terminator-squad', { options: { 'justaerin-options': { 'Power fist': 5 } } }));
  assert.ok(chosen.has('Power fist') && !chosen.has('Power sword'));
});

test('characters join units before deployment and still score as their own units', () => {
  const { joinCharacters, canJoin } = require('../sim/lib/characters.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const ai = require('../sim/lib/ai.cjs');
  const a = buildArmy(path.join(LISTS, 'legions', 'sons-of-horus.json'), 0);
  const b = buildArmy(path.join(LISTS, 'rangdan-iron-wall.json'), 1);
  const st = { units: [...a.units, ...b.units], armies: [a, b], cache: { shoot: new Map(), melee: new Map() }, log: () => {}, table: { objectives: [] } };
  const before = st.units.length;
  const joins = joinCharacters(st);
  assert.ok(joins.some((j) => j.character === 'Praetor'));
  assert.equal(st.units.length, before - joins.length);
  // a joined character is a model of its unit, remembered for scoring
  const host = st.units.find((u) => u.joined && u.joined.some((c) => c.name === 'Praetor'));
  assert.ok(host.models.some((m) => m.joinedFrom && m.joinedFrom.role === 'High Command'));
  assert.equal(require('../sim/lib/mission.cjs').killPoints(host), Math.max(1, Math.round(host.kpPts / 100)));
  // a Rangda master never joins a collared unit (it would break Neural Collars)
  for (const u of st.units.filter((x) => x.side === 1 && x.joined)) {
    const collared = u.models.filter((m) => !m.joinedFrom).every((m) => m.rules.includes('Neural Collars'));
    if (collared) assert.ok(u.joined.every((c) => c.models[0].rules.includes('Neural Collars')), u.name);
  }
  // nobody joins a vehicle; a unit moves at its slowest model's pace
  const rhino = st.units.find((u) => u.name === 'Rhino');
  assert.equal(canJoin({ side: 0, models: [{ unitType: 'Infantry (Command)', rules: [] }], rules: [] }, rhino), false);
  const slow = Object.assign({}, host, { models: host.models.map((m, i) => (i ? m : Object.assign({}, m, { p: Object.assign({}, m.p, { M: 3 }) }))) });
  assert.equal(ai.moveOf(slow), 3);
});

test('builder data: default weapons that BSData lists only inside options', () => {
  const { loadArmyData } = require('../sim/lib/army.cjs');
  const { E, D } = loadArmyData('space-wolves');
  const items = E.effectiveModels(E.newSelection('varagyr-wolf-guard-terminators'), {}).flatMap((r) => r.items);
  assert.ok(items.includes('Frost axe') && items.includes('Combi-bolter'), items.join());
  // picking another weapon swaps the default out
  const s = E.newSelection('varagyr-wolf-guard-terminators');
  s.options['varagyr-may-exchange-frost-axe-with'] = { 'Power fist': 4 };
  const rows = E.effectiveModels(s, {});
  assert.ok(rows.filter((r) => r.name === 'Varagyr').every((r) => r.items.includes('Power fist') && !r.items.includes('Frost axe')));
  // a weapon group with no default is a required pick, and "choose 2" lets each model take two
  const soh = loadArmyData('sons-of-horus');
  const praetor = soh.E.newSelection('praetor');
  assert.ok(soh.E.unitIssues(praetor).some((i) => /must take/.test(i.msg)));
  const just = soh.D.units.find((u) => u.id === 'justaerin-terminator-squad').options.find((o) => /choose 2/.test(o.text));
  assert.equal(just.perModelPicks, 2);
  const js = soh.E.newSelection('justaerin-terminator-squad');
  js.options[just.id] = { 'Power axe': 5, 'Combi-bolter': 5 };
  assert.ok(!soh.E.unitIssues(js).some((i) => /too many|must take/.test(i.msg)));
  // "choose 2" is two weapons for every model, so five swords between five Justaerin isn't enough
  js.options[just.id] = { 'Power axe': 5 };
  assert.ok(soh.E.unitIssues(js).some((i) => /must take 10/.test(i.msg)));
  void D;
});

test('AI: Line units hold markers and move on when a friend holds theirs; Vanguard hunts the holders', () => {
  const ai = require('../sim/lib/ai.cjs');
  const near = { x: 20, y: 20, value: 2, id: 0 }, far = { x: 40, y: 20, value: 2, id: 1 };
  const line = (n, x, y, X = 2) => fakeUnit(0, n, x, y, { modelRules: [`Line (${X})`] });
  const holder = line(10, 20, 20), second = line(5, 23, 20);
  const st = { table: { objectives: [near, far] }, units: [holder, second], mission: { primary: 'claim', has: () => false, secondaries: { breakthrough: 0 } }, turnsLeft: 4, zoneOf: [{}, {}] };
  // the bigger Line unit keeps the marker; the smaller one is worth little there and more at the free marker
  assert.equal(scoring.markerWorth(st, holder, near, 2), 4);
  assert.ok(scoring.markerWorth(st, second, near, 2) < 1);
  assert.equal(scoring.markerWorth(st, second, far, 2), 4);
  // a Line unit takes over from a unit without Line
  const plain = fakeUnit(0, 10, 20, 21);
  st.units = [plain, second];
  assert.equal(scoring.markerWorth(st, second, near, 2), 4);
  assert.ok(scoring.markerWorth(st, plain, near, 2) < 1);
  // an enemy on a marker makes it worth contesting
  const foe = fakeUnit(1, 5, 40, 21, { modelRules: ['Line (1)'] });
  st.units = [second, foe];
  assert.equal(scoring.markerWorth(st, second, far, 2), 4 + 1.5);
  // Vanguard: an enemy unit holding a marker is worth its Vanguard VP to finish, nobody else's
  const hunter = fakeUnit(0, 5, 35, 20, { modelRules: ['Vanguard (3)'] });
  const loose = fakeUnit(1, 5, 60, 40);
  Object.assign(st, { round: 2, active: 0, vanguardScored: new Set() });
  st.units = [hunter, foe, loose];
  foe.pts = loose.pts = 100;
  assert.ok(ai.huntValue(st, hunter, foe, 50, 0.5) > ai.huntValue(st, hunter, loose, 50, 0.5));
  assert.equal(ai.huntValue(st, hunter, loose, 50, 0.5), 0);
  assert.equal(ai.huntValue(st, second, foe, 50, 0.5), 0);
  // once Vanguard has scored on that marker this Player Turn, only the wearing-down is left
  st.vanguardScored.add('2:0:2');
  assert.equal(ai.huntValue(st, hunter, foe, 50, 0.5), 15);
});

test('the Legion lists and the strength lists are legal in the builder at 3,000 points', () => {
  const fs = require('fs');
  const { loadArmyData } = require('../sim/lib/army.cjs');
  for (const dir of ['legions', 'strong']) {
    const files = fs.readdirSync(path.join(LISTS, dir)).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 18, dir);
    for (const f of files) {
      const list = JSON.parse(fs.readFileSync(path.join(LISTS, dir, f), 'utf8'));
      // list files leave out empty option and count maps
      for (const d of list.detachments) for (const s of d.slots) if (s.unit) { s.unit.options = s.unit.options || {}; s.unit.counts = s.unit.counts || {}; }
      const { E } = loadArmyData(list.faction);
      E.setArmy(list);
      const pts = list.detachments.reduce((t, d) => t + d.slots.filter((s) => s.unit).reduce((x, s) => x + E.unitPoints(s.unit, s), 0), 0);
      assert.ok(pts <= 3000 && pts >= 2750, `${dir}/${f}: ${pts}`);
      assert.deepEqual(E.armyIssues(list).filter((i) => i.level === 'error').map((i) => i.msg), [], `${dir}/${f}`);
    }
  }
});

test('AI: a transport carries its assault unit to the enemy, and the unit stays in until it can charge', () => {
  const ai = require('../sim/lib/ai.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  // the World Eaters' second plan: Rampagers in a Spartan
  const file = path.join(require('os').tmpdir(), 'we-strike.json');
  require('../sim/lists/strong/make.cjs').build('world-eaters', 'strike', file);
  const a = buildArmy(file, 0);
  const b = buildArmy(path.join(LISTS, 'legions', 'ultramarines.json'), 1);
  const spartan = a.units.find((u) => /Spartan/.test(u.name)), rampagers = a.units.find((u) => /Rampager/.test(u.name));
  const tac = b.units.find((u) => u.name === 'Tactical Squad');
  for (const u of [spartan, rampagers, tac]) Object.assign(u, { arrived: true, destroyed: false, embarkedIn: null, statuses: new Set(), lockedWith: new Set(), turn: {} });
  Object.assign(spartan, { x: 10, y: 24, passengers: [rampagers] });
  Object.assign(rampagers, { embarkedIn: spartan, x: 10, y: 24, r: 3 });
  Object.assign(tac, { x: 50, y: 24, r: 3 });
  const st = { units: [spartan, rampagers, tac], table: { pieces: [], objectives: [] }, cache: { shoot: new Map(), melee: new Map() }, mission: { primary: 'destroy', has: () => false, secondaries: { breakthrough: 0 } }, turnsLeft: 4, zoneOf: [{}, {}], round: 2, active: 0 };
  const near = { x: 20, y: 24 }, far = { x: 0 + spartan.r, y: 24 };
  // loaded, the Spartan wants to close in; empty, the forward move is worth much less to it
  const loaded = ai.positionScore(st, spartan, near) - ai.positionScore(st, spartan, far);
  spartan.passengers = [];
  const empty = ai.positionScore(st, spartan, near) - ai.positionScore(st, spartan, far);
  assert.ok(loaded > empty + 50, `${loaded} vs ${empty}`);
});

/** Despoilers in a Rhino (the World Eaters strength list) and an Ultramarines Tactical Squad, on an empty table. */
function rhinoScene(mission) {
  const { buildArmy } = require('../sim/lib/army.cjs');
  const a = buildArmy(path.join(LISTS, 'strong', 'world-eaters.json'), 0);
  const b = buildArmy(path.join(LISTS, 'legions', 'ultramarines.json'), 1);
  const rhino = a.units.find((u) => u.name === 'Rhino'), desp = a.units.find((u) => u.name === 'Despoiler Squad');
  const tac = b.units.find((u) => u.name === 'Tactical Squad');
  for (const u of [rhino, desp, tac]) Object.assign(u, { arrived: true, destroyed: false, embarkedIn: null, statuses: new Set(), lockedWith: new Set(), turn: {}, passengers: [] });
  Object.assign(rhino, { x: 20, y: 24, passengers: [desp] });
  Object.assign(desp, { embarkedIn: rhino, x: 20, y: 24, r: 3 });
  Object.assign(tac, { x: 60, y: 24, r: 3 });
  const st = { units: [rhino, desp, tac], table: { pieces: [], objectives: [] }, cache: { shoot: new Map(), melee: new Map() }, zoneOf: [{ x: 0, y: 0, w: 12, h: 48 }, { x: 60, y: 0, w: 12, h: 48 }], zoneName: ['a', 'b'],
    mission: Object.assign({ primary: 'destroy', has: () => false, secondaries: { breakthrough: 0 } }, mission), turnsLeft: 3, round: 3, active: 0, dice: null, log: () => {} };
  return { st, rhino, desp, tac };
}

test('AI: getting out of a Rhino means a Disordered charge, and the AI counts it that way', () => {
  const ai = require('../sim/lib/ai.cjs'), plan = require('../sim/lib/plan.cjs'), core = require('../sim/lib/core.cjs');
  const { st, rhino, desp, tac } = rhinoScene();
  // 7" from the target: a Charge Roll alone makes it about one time in six; with a Set-up Move it would be likely
  const pos = { x: tac.x - tac.r - desp.r - 7, y: 24 };
  const steady = ai.chargeOdds(desp, pos, tac);
  desp.turn.disordered = true;
  const disordered = ai.chargeOdds(desp, pos, tac);
  desp.turn.disordered = false;
  assert.ok(disordered < 0.25 && steady > disordered + 0.3, `${steady} vs ${disordered}`);
  // the plan's reach from inside: no Set-up Move out of a Rhino, the full one out of an Assault Vehicle
  const fromRhino = plan.reach(st, desp, ai);
  rhino.rules = [...rhino.rules, 'Assault Vehicle'];
  assert.equal(plan.reach(st, desp, ai), fromRhino + core.setupMove(desp));
});

test('AI: Despoilers (Line) get out of a moving Rhino to hold a marker, but not just to stand in a Sector', () => {
  const move = require('../sim/lib/move.cjs');
  const scoring = require('../sim/lib/scoring.cjs');
  // a Sector covering the whole table: anywhere would add strength, but there's no marker to hold
  const seize = rhinoScene({ primary: 'seize', sectors: [{ id: 1, area: {}, centre: { x: 36, y: 24 }, value: 3 }] });
  assert.ok(scoring.missionValueAt(seize.st, seize.desp, { x: 20, y: 30 }).here > 0);
  move.disembarkIfWorth(seize.st, seize.rhino);
  assert.equal(seize.desp.embarkedIn, seize.rhino, 'stays in for a Sector');
  // a marker right beside the Rhino: they get out and hold it
  const claim = rhinoScene({ primary: 'claim' });
  claim.st.table.objectives = [{ id: 0, x: 20, y: 24 + claim.rhino.r + 4, value: 3 }];
  move.disembarkIfWorth(claim.st, claim.rhino);
  assert.equal(claim.desp.embarkedIn, null, 'gets out onto the marker');
  assert.equal(claim.desp.turn.disordered, true, 'and any charge this turn is Disordered');
});

test("Legiones Astartes or Hereticus: the army's choice decides the Tactica and the reaction", () => {
  const fs = require('fs');
  const legions = require('../sim/lib/legions.cjs');
  const reactions = require('../sim/lib/reactions.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const { check } = require('../sim/lib/checks.cjs');
  const we = JSON.parse(fs.readFileSync(path.join(LISTS, 'legions', 'world-eaters.json'), 'utf8'));
  const ast = JSON.parse(JSON.stringify(we)); ast.config['rite-of-war'] = ['Legiones Astartes World Eaters'];
  const her = JSON.parse(JSON.stringify(we)); her.config['rite-of-war'] = ['Legiones Hereticus World Eaters'];
  const ua = buildArmy(ast, 0).units.find((u) => u.name === 'Tactical Squad'), uh = buildArmy(her, 0).units.find((u) => u.name === 'Tactical Squad');
  assert.equal(legions.tactica(ua, 'World Eaters'), true);
  assert.equal(legions.tactica(uh, 'World Eaters'), false);
  // reactions follow the version
  const sets = (u) => { const st = { units: [u], armies: [{ faction: 'world-eaters', units: [u] }, { faction: 'ultramarines', units: [] }] }; reactions.setup(st); return st.reactionSet[0]; };
  assert.ok(sets(ua).has('Brutal Tide') && !sets(ua).has('Furious Charge'));
  assert.ok(sets(uh).has('Furious Charge') && !sets(uh).has('Brutal Tide'));
  // The Nails' Bite: a Hereticus unit that fails a Leadership Check becomes Lost to the Nails instead
  uh.statuses = new Set(['Pinned']); uh.cond = null;
  const st = { units: [uh], dice: { twoD6: () => 12 }, log: () => {} };
  assert.equal(check(st, uh, 'LD', 0, 'test'), true);
  assert.ok(uh.cond.has('Lost to the Nails') && uh.statuses.size === 0);
  ua.statuses = new Set(); ua.cond = null;
  assert.equal(check(Object.assign({}, st, { units: [ua] }), ua, 'LD', 0, 'test'), false);
});

test('Legion gambits: each Legion gets its own, by version, and first-round gambits only in the first Face-Off', () => {
  const gambits = require('../sim/lib/gambits.cjs');
  const names = (trait, rite, round = 1) => gambits.available({ traits: [trait], rules: [] }, { u: { rite, models: [{ wounds: 1 }, { wounds: 1 }] }, m: {} }, round).map((g) => g.name);
  assert.ok(names('World Eaters', 'Hereticus').includes('Brutal Dismemberment') && !names('World Eaters', 'Hereticus').includes('Violent Overkill'));
  assert.ok(names('World Eaters', 'Astartes').includes('Violent Overkill'));
  assert.ok(names("Emperor's Children", 'Astartes').includes('Paragon of Excellence') && !names("Emperor's Children", 'Astartes', 2).includes('Paragon of Excellence'));
  assert.ok(names('Alpha Legion').includes('I Am Alpharius') && !names('Alpha Legion', undefined, 2).includes('I Am Alpharius'));
  for (const [legion, g] of [['Blood Angels', 'Thrall of the Red Thirst'], ['Dark Angels', 'Sword of the Order'], ['Death Guard', 'Death Guard Gambit'], ['Imperial Fists', 'A Wall Unyielding'],
    ['Iron Hands', 'Legion of One'], ['Iron Warriors', 'Spiteful Demise'], ['Night Lords', 'Nostraman Courage'], ['Raven Guard', 'Decapitation Strike'], ['Salamanders', 'Duty is Sacrifice'],
    ['Sons of Horus', 'Merciless Strike'], ['Space Wolves', 'No Prey Escapes'], ['Thousand Sons', 'Prophetic Duellist'], ['Ultramarines', 'Aegis of Wisdom'], ['White Scars', 'The Path of the Warrior'], ['Word Bearers', 'Beseech the Gods']]) {
    assert.ok(names(legion).includes(g), `${legion}: ${g}`);
    assert.ok(!names('Rangda').includes(g));
  }
});

test('unit rules: Fury of the Legion, Ravening Madmen, curly apostrophes, Bitter Duty', () => {
  const { meleeGroup, rangedGroup } = require('../sim/lib/attack.cjs');
  const { canJoin } = require('../sim/lib/characters.cjs');
  // the data writes "Duellist’s Edge (1)" with a curly apostrophe
  assert.equal(xOf(['Duellist’s Edge (1)'], "Duellist's Edge"), 1);
  // Fury of the Legion: a bolter gains Heavy (FP) when the unit stood still
  const tac = { p: { BS: 4 }, rules: ['Fury of the Legion'] }, bolter = { name: 'Bolter', base: 'Bolter', FP: 2, RS: 4, AP: 5, D: 1, specialRules: [] };
  const tgt = { models: [{ wounds: 1, p: { T: 4 } }] };
  assert.equal(rangedGroup(tac, bolter, tgt, { stationary: true }).attacks, 3);
  assert.equal(rangedGroup(Object.assign({}, tac, { rules: [] }), bolter, tgt, { stationary: true }).attacks, 2);
  // Ravening Madmen: Hit Tests against them count their Weapon Skill as 3
  const sword = { name: 'Power sword', AM: 'A', SM: 'S', AP: 3, D: 1, specialRules: [] };
  const atk = { p: { WS: 4, A: 2, S: 4 }, rules: [] };
  const madmen = { rules: ['Ravening Madmen'], models: [{ wounds: 2, p: { WS: 6, T: 5 } }] };
  assert.equal(meleeGroup(atk, sword, madmen, {}).hitNeed, meleeGroup(atk, sword, { models: [{ wounds: 2, p: { WS: 3, T: 5 } }] }, {}).hitNeed);
  // Bitter Duty: only with others that have it
  const char = { side: 0, models: [{ unitType: 'Infantry (Command)', rules: [] }], rules: [] };
  const host = { side: 0, models: [{ unitType: 'Infantry', rules: ['Bitter Duty'] }, { unitType: 'Infantry', rules: ['Bitter Duty'] }], rules: ['Bitter Duty'] };
  assert.equal(canJoin(char, host), false);
});

test('Primarchs: a Warlord Detachment in lists, joining, Shadow of the Reaper, and Slay the Warlord', () => {
  const { createBuilder } = require('../sim/lists/builder.cjs');
  const core = require('../sim/lib/core.cjs');
  const { canJoin } = require('../sim/lib/characters.cjs');
  const b = createBuilder('death-guard');
  assert.ok(b.add(['Warlord', 'mortarion']));
  assert.ok(b.dets.some((d) => d.name === 'Warlord Detachment'));
  // Mortarion's Set-up Move counts his Movement as 12 (M 12 + I 6 = 18: 5")
  const mort = unit('death-guard', 'mortarion', {}, 0);
  assert.equal(core.setupMove(mort), 5);
  // Lorgar may join Malefic units
  const lorgar = { side: 0, models: [{ unitType: 'Paragon (Unique)', rules: ['The Power of the Word'] }], rules: [] };
  const malefic = { side: 0, models: [{ unitType: 'Infantry (Malefic)', rules: [] }, { unitType: 'Infantry (Malefic)', rules: [] }], rules: [] };
  assert.equal(canJoin(lorgar, malefic), true);
  assert.equal(canJoin(Object.assign({}, lorgar, { models: [{ unitType: 'Paragon (Unique)', rules: [] }] }), malefic), false);
});

test('named characters: their gambits, cheating death, Drakenscale, The Blood Crow, Jealous Command, Sworn Loyalty', () => {
  const { buildArmy } = require('../sim/lib/army.cjs');
  const { passChance } = require('../sim/lib/checks.cjs');
  const { planVolley } = require('../sim/lib/fire.cjs');
  const { canJoin } = require('../sim/lib/characters.cjs');
  const me = (u) => ({ u, m: u.models[0] });
  const own = (u, opp) => gambits.available(u.models[0], me(u), 1, opp ? me(opp) : null).map((g) => g.name);
  // each character's gambit goes to him alone; Dirty Fighter only in the first Face-Off
  const sevatar = unit('night-lords', 'sevatar');
  assert.ok(own(sevatar).includes('Dirty Fighter'));
  assert.ok(!own(unit('night-lords', 'praetor')).includes('Dirty Fighter'));
  assert.ok(!gambits.available(sevatar.models[0], me(sevatar), 2).some((g) => g.name === 'Dirty Fighter'));
  for (const [legion, id, g] of [['imperial-fists', 'sigismund', "Death's Champion"], ['imperial-fists', 'fafnir-rann', "Executioner's Tax"], ['imperial-fists', 'alexis-polux', 'Hammerblow'],
    ['white-scars', 'hibou-khan', 'Seeker of Atonement'], ['space-wolves', 'hvarl-red-blade', 'Head-taker'], ['blood-angels', 'chapter-master-raldoron', 'Archein of Wisdom'],
    ['death-guard', 'calas-typhon', 'Witchblood'], ['thousand-sons', 'ahzek-ahriman', 'Every Strike Foreseen']]) assert.ok(own(unit(legion, id)).includes(g), `${id}: ${g}`);
  // Bite of the Betrayed only against the Legions that betrayed Saul Tarvitz
  const tarvitz = unit('emperors-children', 'saul-tarvitz');
  assert.ok(own(tarvitz, unit('sons-of-horus', 'praetor', {}, 1)).includes('Bite of the Betrayed'));
  assert.ok(!own(tarvitz, unit('ultramarines', 'praetor', {}, 1)).includes('Bite of the Betrayed'));
  // The Faultless Blade: Paragon of Excellence gives Lucius +4; Head-taker shuts out Outside Support
  const paragon = gambits.GAMBITS.find((g) => g.name === 'Paragon of Excellence');
  assert.equal(paragon.make(null, me(unit('emperors-children', 'captain-lucius'))).focus, 4);
  assert.equal(paragon.make(null, me(unit('emperors-children', 'praetor'))).focus, 2);
  assert.equal(gambits.GAMBITS.find((g) => g.name === 'Head-taker').make().oppSupportCap, 0);
  // Born Survivor: Loken takes a killing wound (wound roll 6, failed save 1) and stands with 1 Wound on a 4+
  const blow = { attacks: 1, S: 10, AP: 2, D: 4, hitNeed: null, rules: [], melee: true };
  const loken = unit('sons-of-horus', 'garviel-loken', {}, 1);
  resolveGroup(blow, loken, { dice: scripted([6, 1, 4]) });
  assert.equal(loken.models[0].wounds, 1);
  assert.equal(resolveGroup(blow, unit('sons-of-horus', 'garviel-loken', {}, 1), { dice: scripted([6, 1, 3]) }).kills, 1);
  // The Ghost of Saiph works only the first time
  const crohne = unit('blood-angels', 'aster-chrone', {}, 1);
  resolveGroup(Object.assign({}, blow, { attacks: 2 }), crohne, { dice: scripted([6, 1, 6, 6, 1, 6]) });
  assert.equal(crohne.models[0].wounds, 0);
  // Seeker of Atonement (ctx.lastStand from the challenge): stands back up and takes Challenge Advantage
  let seized = false;
  const hibou = unit('white-scars', 'hibou-khan', {}, 1);
  resolveGroup(blow, hibou, { dice: scripted([6, 1, 5]), lastStand: { model: hibou.models[0], n: 4, onSave: () => { seized = true; } } });
  assert.ok(seized && hibou.models[0].wounds === 1);
  // Drakenscale Armour: a plasma wound does 1 Damage to Cassian Dracos
  const dracos = unit('salamanders', 'cassian-dracos-reborn', {}, 1);
  resolveGroup({ attacks: 1, S: 8, AP: 2, D: 3, hitNeed: null, rules: [], melee: false, weaponTraits: ['Plasma'] }, dracos, { dice: scripted([6, 1]) });
  assert.equal(dracos.models[0].wounds, dracos.models[0].maxWounds - 1);
  // The Blood Crow: Kaedes Nex never fires Snap Shots (unless at a Flyer)
  const nex = unit('raven-guard', 'kaedes-nex');
  const cannons = nex.models[0].ranged.find((w) => /Fulcrum/.test(w.name));
  const g = rangedGroup(nex.models[0], cannons, unit('sons-of-horus', 'tactical-squad', {}, 1), { snap: true });
  assert.equal(g.snap, false);
  assert.equal(g.hitNeed, 2);
  // the Guns of the Conqueror fire only through their reaction
  const lotara = Object.assign(unit('world-eaters', 'lotara-sarrin'), { x: 10, y: 10 });
  const tgt = Object.assign(unit('ultramarines', 'tactical-squad', {}, 1), { x: 10, y: 25 });
  assert.ok(!planVolley(lotara, tgt, { table: { pieces: [], objectives: [] } }, { losOK: true }).picks.some((p) => /Guns of the Conquer/.test(p.weapon.name)));
  // Jealous Command: Kor Phaeron as the army's only Unique model has +1 Wounds and Leadership
  const kor = (extra) => buildArmy({ version: 2, faction: 'word-bearers', pointsLimit: 3000, config: {}, detachments: [{ kind: 'primary', name: 'p', slots: [{ role: 'High Command', unit: { unitId: 'kor-phaeron' } }, ...extra] }] }, 0).units[0].models[0];
  assert.deepEqual([kor([]).maxWounds, kor([]).p.LD], [4, 11]);
  const withErebus = kor([{ role: 'Command', unit: { unitId: 'erebus' } }]);
  assert.deepEqual([withErebus.maxWounds, withErebus.p.LD], [3, 10]);
  // Sworn Loyalty: Atramentar test Leadership on Sevatar's 10 while he, from the Primary Detachment, is on the battlefield
  const nl = list('night-lords');
  const sev = buildUnit('night-lords', nl, { role: 'High Command', unit: { unitId: 'sevatar' } }, { name: 'p', kind: 'primary' }, 0);
  const atr = buildUnit('night-lords', nl, { role: 'Heavy Assault', unit: { unitId: 'atramentar-flay-clade' } }, { name: 'p', kind: 'primary' }, 0);
  assert.ok(passChance({ units: [sev, atr] }, atr, 'LD', 3) > passChance({ units: [atr] }, atr, 'LD', 3));
  // Lord of the Blessed lets Erebus join Malefic units; Corvus Corax can't join Deliverers (Corax's Shame)
  const malefic = { side: 0, models: [{ unitType: 'Infantry (Malefic)', rules: [] }, { unitType: 'Infantry (Malefic)', rules: [] }], rules: [] };
  assert.equal(canJoin(unit('word-bearers', 'erebus'), malefic), true);
  const corax = { side: 0, models: [{ name: 'Corvus Corax', unitType: 'Paragon (Unique)', rules: [] }], rules: [] };
  assert.equal(canJoin(corax, { side: 0, models: [{ unitType: 'Infantry', rules: [] }, { unitType: 'Infantry', rules: [] }], rules: ['Corax’s Shame'] }), false);
});

test('psychic: disciplines give their Psychic Weapons, Conduit adds Strength, and Force is skipped when it changes nothing', () => {
  const psychic = require('../sim/lib/psychic.cjs');
  const sorc = unit('thousand-sons', 'prosperine-sorcerer');
  const m = sorc.models[0];
  const wf = m.ranged.find((w) => w.name === 'Wildfire'), imf = m.ranged.find((w) => w.name === 'Immovable Force'), bs = m.melee.find((w) => w.name === 'Biomantic Slam');
  assert.ok(wf && imf && bs, 'Prosperine Sorcery gives all three');
  assert.equal(wf.RS, 5); // 4, +1 for the Prosperine Spirestave's Conduit
  assert.ok(sorc.psyker);
  assert.ok(psychic.powersOf(sorc).includes('Wildfire'));
  // Magnus gets the weapons of the disciplines chosen for him
  const magnus = unit('thousand-sons', 'magnus-the-red', { options: { 'magnus-the-red-psychic-disciplines': ['Telekinesis'] } });
  assert.ok(magnus.models[0].ranged.some((w) => w.name === 'Immovable Force'));
  // Force (D) against one-Wound models changes nothing, so no Willpower Check is taken
  const st = { dice: { d6: () => { throw new Error('no check expected'); } }, log: () => {}, powerCount: [{}, {}] };
  const oneWound = { models: [{ wounds: 1, maxWounds: 1, p: { SAV: '3+' } }] };
  assert.equal(psychic.forceCheck(st, sorc, m, bs, oneWound), bs);
  // the registry lists the powers still waiting for their rules text
  assert.ok(psychic.POWERS.some((p) => p.name === 'Raptora' && p.text === false));
});

test('plans: an assault unit keeps its target from turn to turn unless another is clearly better', () => {
  const plan = require('../sim/lib/plan.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const a = buildArmy(path.join(LISTS, 'strong', 'world-eaters.json'), 0), b = buildArmy(path.join(LISTS, 'legions', 'ultramarines.json'), 1);
  const ramp = a.units.find((u) => u.name === 'Despoiler Squad');
  const foes = b.units.filter((u) => u.name === 'Tactical Squad').slice(0, 2);
  for (const u of [ramp, ...foes]) Object.assign(u, { arrived: true, destroyed: false, embarkedIn: null, statuses: new Set(), lockedWith: new Set(), turn: {}, r: 3 });
  Object.assign(ramp, { x: 20, y: 24 }); Object.assign(foes[0], { x: 30, y: 24 }); Object.assign(foes[1], { x: 31, y: 30 });
  const st = { units: [ramp, ...foes], table: { pieces: [], objectives: [] }, cache: { shoot: new Map(), melee: new Map() }, mission: { primary: 'destroy', has: () => false, secondaries: { breakthrough: 0 } }, turnsLeft: 4, round: 1, active: 0 };
  plan.update(st, 0);
  const first = plan.of(st, ramp).target;
  assert.ok(first);
  // the other squad edges a little closer: not enough to switch
  const other = foes.find((f) => f !== first);
  other.x = first.x; other.y = first.y + 7;
  st.round = 2; plan.update(st, 0);
  assert.equal(plan.of(st, ramp).target, first);
  assert.equal(plan.of(st, ramp).waiting, false);
});
