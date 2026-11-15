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
  const core9 = ['Seize the Initiative', 'Flurry of Blows', 'Test the Foe', 'Guard Up', 'Taunt and Bait', 'Grandstand', 'Feint and Riposte', 'Withdraw', 'Finishing Blow'];
  // a Legion model also has its Legion's gambit
  assert.deepEqual(names(unit('sons-of-horus', 'tactical-squad')), [...core9, 'Merciless Strike']);
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
  assert.deepEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(core.snapHit), [2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);
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
  assert.deepEqual(core.perils(scripted([1]), 8), { result: 'Warp Rupture', wounds: 5, invulnOnly: true });
  assert.deepEqual(core.perils(scripted([3]), 8), { result: 'Ætheric Feedback', status: 'Stunned' });
  // the face of the double that caused it decides the result
  assert.equal(core.perils(scripted([3]), 8, 6).result, 'Warp Rupture');
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
  // Swift of Action: +2 Movement in the White Scars' own Player Turns only; Cult Arcana: every unit a Psyker with +1 Willpower
  const ws = tac('white-scars'), moveOf = require('../sim/lib/ai.cjs').moveOf;
  ws.swiftOn = true;
  assert.equal(moveOf(ws), +tac('ultramarines').models[0].p.M + 2);
  ws.swiftOn = false;
  assert.equal(moveOf(ws), +tac('ultramarines').models[0].p.M);
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
  const st = { units: [uh], dice: { d6: () => 6, twoD6: () => 12 }, log: () => {} };
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

/** A Rhino and three Predators from the World Eaters strength list, on an empty table with nothing else on it. */
function moveScene() {
  const { buildArmy } = require('../sim/lib/army.cjs');
  const a = buildArmy(path.join(LISTS, 'strong', 'world-eaters.json'), 0);
  const rhino = a.units.find((u) => u.name === 'Rhino');
  const preds = a.units.filter((u) => u.name === 'Predator').slice(0, 3);
  for (const u of [rhino, ...preds]) Object.assign(u, { arrived: true, destroyed: false, embarkedIn: null, passengers: [], statuses: new Set(), lockedWith: new Set(), turn: {} });
  const st = { units: [rhino, ...preds], table: { pieces: [], objectives: [] }, mission: { sectors: [], has: () => false } };
  return { st, rhino, preds };
}

test('moves: a unit goes round a friendly tank in its way instead of stopping behind it, measured along the way', () => {
  const move = require('../sim/lib/move.cjs');
  const { st, rhino, preds } = moveScene();
  st.units = [rhino, preds[0]];
  Object.assign(rhino, { x: 10, y: 24 });
  Object.assign(preds[0], { x: 10 + rhino.r + preds[0].r + 0.5, y: 24 });
  const to = { x: 22, y: 24 };
  const end = move.simulateMove(st, rhino, to, 12);
  // straight it would barely move; round the Predator it gets well past it
  assert.ok(end.x > preds[0].x + preds[0].r, `ended at ${end.x.toFixed(1)}`);
  assert.ok(Math.hypot(end.x - preds[0].x, end.y - preds[0].y) >= preds[0].r + rhino.r - 0.05, 'not on top of the Predator');
  const moved = move.moveUnit(st, rhino, to, 12);
  // the way round is longer than the straight line, and never longer than the move
  assert.ok(moved <= 12 + 1e-6 && moved > Math.hypot(rhino.x - 10, rhino.y - 24) + 0.1, `${moved}`);
});

test('moves: through a gap in a wall, but never through the wall, and a charge still goes straight', () => {
  const move = require('../sim/lib/move.cjs');
  const { st, rhino, preds } = moveScene();
  st.units = [rhino, preds[0]];
  // a wall across the table from y=0 to y=40 at x=20, open above y=40
  st.table.pieces = [{ x: 20, y: 0, w: 2, h: 40, impassable: true }];
  Object.assign(rhino, { x: 16, y: 34 });
  Object.assign(preds[0], { x: 60, y: 10 });
  const end = move.simulateMove(st, rhino, { x: 26, y: 34 }, 16);
  assert.ok(end.x > 22, `got past the wall: ${end.x.toFixed(1)}`);
  assert.ok(!(end.x >= 20 && end.x <= 22 && end.y <= 40), 'not inside the wall');
  // with too short a move to reach the gap and come back down, it gets as close as it can on its own side
  const short = move.simulateMove(st, rhino, { x: 26, y: 34 }, 4);
  assert.ok(short.x < 20, `${short.x.toFixed(1)}`);
  // a charge at the Predator, with a friend in the way, stops at the friend (charges move straight)
  st.table.pieces = [];
  Object.assign(preds[1], { x: 22, y: 34 });
  Object.assign(preds[0], { x: 30, y: 34 });
  st.units = [rhino, preds[0], preds[1]];
  const charged = move.simulateMove(st, rhino, preds[0], 12, { charging: true, target: preds[0] });
  assert.ok(charged.x < preds[1].x - preds[1].r - rhino.r + 0.1, `${charged.x.toFixed(1)}`);
});

test('moves: going round into difficult terrain costs its 2" once', () => {
  const { route } = require('../sim/lib/path.cjs');
  const { st, rhino } = moveScene();
  Object.assign(rhino, { x: 10, y: 24 });
  const env = (difficult) => ({ tableView: { pieces: [] }, blockers: [], difficultAt: (p) => difficult && p.x > 12, penalty: 2 });
  const open = route(rhino, { x: 30, y: 24 }, 12, env(false));
  const rough = route(rhino, { x: 30, y: 24 }, 12, env(true));
  assert.ok(Math.abs(open.x - 22) < 0.6, `${open.x}`);
  assert.ok(Math.abs(rough.x - 20) < 0.6, `${rough.x}`);
  assert.ok(st);
});

test('AI weights: a side can play with its own, and the other side keeps the defaults', () => {
  const ai = require('../sim/lib/ai.cjs');
  const { runBattle } = require('../sim/lib/battle.cjs');
  const st = { aiParams: [{ risk: 0.1 }, null] };
  assert.equal(ai.K(st, 0, 'risk'), 0.1);
  assert.equal(ai.K(st, 1, 'risk'), ai.DEFAULTS.risk);
  assert.equal(ai.K({}, 0, 'vp'), ai.VP_WORTH);
  // a battle with no change is the same battle; a reckless side plays a different one
  const a = path.join(LISTS, 'strong', 'blood-angels.json'), b = path.join(LISTS, 'strong', 'iron-hands.json');
  const base = runBattle(a, b, { seed: 3, log: true }).log.join('\n');
  assert.equal(runBattle(a, b, { seed: 3, log: true, ai: [{ risk: ai.DEFAULTS.risk }, null] }).log.join('\n'), base);
  assert.notEqual(runBattle(a, b, { seed: 3, log: true, ai: [{ risk: 0, chargeBar: -50 }, null] }).log.join('\n'), base);
});

test('rules audit: Heavy (RS), reaction fire uses the last Movement Phase, vehicles react with Defensive weapons', () => {
  const { rangedGroup } = require('../sim/lib/attack.cjs');
  const core = require('../sim/lib/core.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  // Heavy (RS) raises ranged Strength like Heavy (S)
  const model = { p: { BS: 4 }, rules: [], traits: [] }, target = buildArmy(path.join(LISTS, 'legions', 'ultramarines.json'), 1).units.find((u) => u.name === 'Tactical Squad');
  const w = { name: 'test lascannon', R: 48, FP: 1, RS: 9, AP: 2, D: 1, specialRules: ['Heavy (RS)'], traits: [] };
  assert.equal(rangedGroup(model, w, target, { stationary: true }).S, rangedGroup(model, w, target, { stationary: false }).S + 1);
  // in the enemy's turn a unit counts what it did in its own last Movement Phase
  const u = { side: 0, turn: {}, lastMove: { stationary: true } };
  assert.equal(core.still({ active: 1 }, u).stationary, true);
  assert.equal(!!core.still({ active: 0 }, u).stationary, false);
  // vehicles' reaction Shooting Attacks use Defensive weapons, unless they have Automated Fire Protocols
  assert.equal(core.reactionDefensiveOnly({ vehicle: true, rules: [] }), true);
  assert.equal(core.reactionDefensiveOnly({ vehicle: true, rules: ['Automated Fire Protocols'] }), false);
  assert.equal(core.reactionDefensiveOnly({ vehicle: false, rules: [] }), false);
});

test('rules audit: vehicles take no Leadership or Cool Checks, and block Line of Sight', () => {
  const { check, passChance } = require('../sim/lib/checks.cjs');
  const { lineOfSight } = require('../sim/lib/table.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const a = buildArmy(path.join(LISTS, 'strong', 'world-eaters.json'), 0).units;
  const rhino = a.find((u) => u.name === 'Rhino'), desp = a.filter((u) => u.name === 'Despoiler Squad');
  const st = { dice: { d6: () => 6, twoD6: () => 12 }, units: a };
  for (const u of [rhino, ...desp]) Object.assign(u, { arrived: true, destroyed: false, embarkedIn: null, statuses: new Set(), lockedWith: new Set() });
  assert.equal(check(st, rhino, 'LD', 5, ''), true);
  assert.equal(passChance(st, rhino, 'CL', 3), 1);
  assert.equal(check(st, desp[0], 'LD', 0, ''), false);
  // a Rhino squarely between two squads hides one from the other
  Object.assign(desp[0], { x: 10, y: 24, r: 1 }); Object.assign(desp[1], { x: 30, y: 24, r: 1 }); Object.assign(rhino, { x: 20, y: 24, r: 3 });
  assert.equal(lineOfSight({ pieces: [], hulls: [rhino] }, desp[0], desp[1]), false);
  assert.equal(lineOfSight({ pieces: [], hulls: [] }, desp[0], desp[1]), true);
  rhino.y = 40;
  assert.equal(lineOfSight({ pieces: [], hulls: [rhino] }, desp[0], desp[1]), true);
});

test('rules audit: the Set-up Move ignores difficult terrain; Heedless units count in Sectors but not on markers', () => {
  const move = require('../sim/lib/move.cjs');
  const scoring = require('../sim/lib/scoring.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const a = buildArmy(path.join(LISTS, 'strong', 'world-eaters.json'), 0).units, b = buildArmy(path.join(LISTS, 'legions', 'ultramarines.json'), 1).units;
  const desp = a.find((u) => u.name === 'Despoiler Squad'), tac = b.find((u) => u.name === 'Tactical Squad');
  for (const u of [desp, tac]) Object.assign(u, { arrived: true, destroyed: false, embarkedIn: null, passengers: [], statuses: new Set(), lockedWith: new Set(), turn: {}, r: 2 });
  Object.assign(desp, { x: 10, y: 24 }); Object.assign(tac, { x: 20, y: 24 });
  const st = { units: [desp, tac], table: { pieces: [{ x: 16, y: 18, w: 8, h: 12, difficult: true }], objectives: [] }, mission: { sectors: [], has: () => false } };
  const plain = move.simulateMove(st, desp, tac, 3, { charging: true, target: tac });
  const setup = move.simulateMove(st, desp, tac, 3, { charging: true, target: tac, ignoreDifficult: true });
  assert.ok(setup.x > plain.x + 1.5, `${plain.x} vs ${setup.x}`);
  // Heedless: no markers, but Sectors yes (MISSION lists only statuses, combat, embarked and Automata for Sectors)
  desp.rules = [...desp.rules, 'Heedless'];
  const area = { poly: [[0, 0], [72, 0], [72, 48], [0, 48]] };
  const sst = { units: [desp], mission: { sectors: [{ id: 1, area, inZone: {}, value: 3 }], has: () => false }, zoneName: ['A', 'B'] };
  assert.equal(scoring.canControl(desp), false);
  assert.equal(scoring.sectorControl(sst)[0].side, 0);
});

test('rulebook: Morale checks merge per status, Routed first and clearing the rest', () => {
  const { moraleSubPhase } = require('../sim/lib/shoot.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const u = buildArmy(path.join(LISTS, 'legions', 'ultramarines.json'), 0).units.find((x) => x.name === 'Tactical Squad');
  Object.assign(u, { destroyed: false, statuses: new Set(['Suppressed']), lockedWith: new Set() });
  let rolls = 0;
  const st = { units: [u], dice: { d6: () => { rolls++; return 6; } }, log: () => {}, pendingMorale: [
    { unit: u, type: 'Pinning', x: 1 }, { unit: u, type: 'Pinning', x: 2 }, { unit: u, type: 'Casualties', x: 0 }, { unit: u, type: 'Panic', x: 1 }] };
  moraleSubPhase(st);
  // one Leadership Check for Routed (failed on double 6), so the Pinning check is never made and Routed clears Suppressed
  assert.equal(rolls, 2);
  assert.deepEqual([...u.statuses], ['Routed']);
});

test('rulebook: sponson and pintle weapons are Defensive; cover only for a unit standing in Area Terrain; Heavy Area Terrain hides', () => {
  const core = require('../sim/lib/core.cjs');
  const { inCover, lineOfSight } = require('../sim/lib/table.cjs');
  const { buildArmy } = require('../sim/lib/army.cjs');
  const pred = buildArmy(path.join(LISTS, 'strong', 'world-eaters.json'), 0).units.find((u) => u.name === 'Predator');
  const def = pred.models[0].ranged.map((w) => [w.name, core.isDefensive(w)]);
  assert.deepEqual(def, [['Twin lascannon', false], ['Lascannon', true]]);
  const a = { x: 10, y: 24, r: 1 }, b = { x: 30, y: 24, r: 1 };
  const wood = { x: 18, y: 20, w: 4, h: 8, cover: true, coverSave: 6 };
  assert.equal(inCover({ pieces: [wood] }, a, b), null);
  assert.equal(inCover({ pieces: [Object.assign({}, wood, { x: 28 })] }, a, b), 6);
  const heavy = { x: 28, y: 20, w: 6, h: 8, cover: true, coverSave: 4, blocksLoS: true };
  assert.equal(lineOfSight({ pieces: [heavy] }, a, b), false);
});

test('rulebook: Thousand Sons sorcerers carry their disciplines; Warp Rupture is the Perils that wounds', () => {
  const { buildArmy } = require('../sim/lib/army.cjs');
  const s = buildArmy(path.join(LISTS, 'strong', 'thousand-sons.json'), 0).units.find((u) => /Sorcerer/.test(u.name)).models[0];
  assert.ok(s.rules.includes('Shrouded (4+)') && s.rules.includes('Impact (Strength)'));
  assert.ok(s.melee.some((w) => w.name === 'Conflagration'));
  assert.equal(s.ranged.find((w) => w.name === 'Wildfire').R, 18);
});

// ---------- the Assault Phase and reactions, checked against the rulebook ----------
const assault = require('../sim/lib/assault.cjs');
const { footprint, CCW } = require('../sim/lib/army.cjs');
/** The unit with n models, copies of its own (the last one repeated). */
const sized = (u, n) => { u.models = Array.from({ length: n }, (_, i) => Object.assign({}, u.models[Math.min(i, u.models.length - 1)])); u.r = footprint(u); return u; };
const lock = (a, b) => { a.lockedWith.add(b); b.lockedWith.add(a); };
/** Enough of a battle's state to fight and resolve a combat (zones: side 0 at the top edge, side 1 at the bottom). */
const fightState = (units, dice, lines = []) => ({
  dice, units, log: (s) => lines.push(s), cache: { melee: new Map(), shoot: new Map() }, active: 0, round: 1, pendingMorale: [], armies: [{ name: 'Blue' }, { name: 'Red' }],
  table: { pieces: [], objectives: [] }, zoneOf: [{ poly: [[0, 0], [72, 0], [72, 12], [0, 12]] }, { poly: [[0, 36], [72, 36], [72, 48], [0, 48]] }],
  onCasualty: () => {}, afterDamage: (u) => { if (!u.models.some((m) => m.wounds > 0)) u.destroyed = true; else u.r = footprint(u); },
});

test('rulebook: only Engaged models fight, estimated from the footprints, the 2" band and the Pile-in', () => {
  const tac = (side, n) => sized(unit(side ? 'ultramarines' : 'sons-of-horus', 'tactical-squad', {}, side), n);
  const count = (a, b) => { lock(a, b); return assault.engagedModels(new Map([[a, { order: [b], list: a.models.map((m) => ({ m })) }]])).count.get(a); };
  assert.deepEqual(count(tac(0, 10), tac(1, 10)), [10, 10]);
  // forty against ten: the back ranks can't reach the band round the enemy, which holds only so many bases
  const [k] = count(tac(0, 40), tac(1, 10));
  assert.ok(k > 15 && k < 30, `${k}`);
  // a lone model in combat is always Engaged
  assert.deepEqual(count(unit('death-guard', 'mortarion'), tac(1, 10)), [1, 1]);
  // in the Fight Sub-Phase only the Engaged ones attack
  const big = Object.assign(tac(0, 40), { x: 20, y: 24 }), small = tac(1, 10);
  Object.assign(small, { x: 20 + big.r + small.r, y: 24 });
  lock(big, small);
  const lines = [];
  assault.fight(fightState([big, small], createDice(3), lines), [[big], [small]]);
  assert.ok(lines.some((l) => /Tactical Squad: \d+ of 40 models Engaged/.test(l)), lines.join('\n'));
});

test("rulebook: a combat's Panic Check is one Leadership Check for the losing side, on its best Leadership, and a failure routs them all", () => {
  const win = Object.assign(unit('sons-of-horus', 'tactical-squad', {}, 0), { x: 36, y: 20 });
  const l1 = Object.assign(unit('ultramarines', 'tactical-squad', {}, 1), { x: 36, y: 26 }), l2 = Object.assign(unit('ultramarines', 'tactical-squad', {}, 1), { x: 42, y: 24 });
  lock(win, l1); lock(win, l2);
  win.statuses.add('Pinned'); // it can't Pursue
  const lines = [];
  const st = Object.assign(fightState([win, l1, l2], scripted([6, 6]), lines), { mission: { has: (m) => m === 'No Quarter' }, award: () => {} });
  assault.resolve(st, [[win], [l1, l2]], { kills: [6, 0], glory: [0, 0] });
  assert.ok(lines.includes('    combat resolution 6–1'), lines.join('\n'));
  const checks = lines.filter((l) => /Panic Check, lost the combat/.test(l));
  assert.equal(checks.length, 1);
  // the Sergeant's Leadership 8 (the majority have 7), less the difference of 5
  assert.match(checks[0], /against 3, failed/);
  assert.ok(l1.statuses.has('Routed') && l2.statuses.has('Routed') && !l1.lockedWith.size && !l2.lockedWith.size);
});

test('rulebook: a Routed unit Falls Back at the end of the Resolution Sub-Phase even when its side won or drew', () => {
  for (const kills of [[3, 0], [0, 0]]) {
    const a = Object.assign(unit('sons-of-horus', 'tactical-squad', {}, 0), { x: 36, y: 20 });
    const b = Object.assign(unit('ultramarines', 'tactical-squad', {}, 1), { x: 36, y: 25.4 });
    lock(a, b); a.statuses.add('Routed');
    const lines = [];
    // when b loses, it passes its Panic Check on a double 1 and stays
    assault.resolve(fightState([a, b], scripted([1, 1]), lines), [[a], [b]], { kills, glory: [0, 0] });
    assert.ok(lines.some((l) => /^ {2}Tactical Squad falls back/.test(l)), lines.join('\n'));
    assert.ok(!a.lockedWith.size && a.y < 20 && !b.statuses.has('Routed'));
  }
});

test('rulebook: Outside Support counts Engaged friends from every unit in the combat, not statused ones; a Walker counts five; alone, +2 per five or part', () => {
  const champ = unit('sons-of-horus', 'legion-champion', {}, 0), friends = unit('sons-of-horus', 'tactical-squad', {}, 0);
  const foes = unit('ultramarines', 'tactical-squad', {}, 1), praetor = unit('ultramarines', 'praetor', {}, 1);
  for (const u of [champ, friends]) lock(u, foes);
  lock(praetor, champ);
  champ.models[0].inChallenge = praetor.models[0].inChallenge = true;
  const x = { u: champ, m: champ.models[0] };
  // the duellist's own unit has no one else: the ten from the other unit give +2
  assert.equal(assault.outsideSupport({}, [[champ, friends], [praetor, foes]], x), 2);
  friends.statuses.add('Pinned');
  assert.equal(assault.outsideSupport({}, [[champ, friends], [praetor, foes]], x), 0);
  friends.statuses.clear();
  // five models and a Walker: 5 + 5
  sized(friends, 6);
  friends.models[5] = Object.assign({}, friends.models[5], { unitType: 'Walker' });
  assert.equal(assault.outsideSupport({}, [[champ, friends], [praetor, foes]], x), 2);
  // the enemy has no one but its duellist: +2 for every five or part of five, statuses or not
  const six = sized(unit('sons-of-horus', 'tactical-squad', {}, 0), 6);
  six.statuses.add('Pinned');
  assert.equal(assault.outsideSupport({}, [[champ, six], [praetor]], x), 4);
  assert.equal(assault.outsideSupport({}, [[champ], [praetor, foes]], { u: praetor, m: praetor.models[0] }), 4);
});

test('rulebook: Grandstand trades Outside Support for Attacks; Feint and Riposte names a gambit; a picked gambit is barred to the other; Withdraw', () => {
  const g = (n) => gambits.GAMBITS.find((x) => x.name === n);
  assert.deepEqual(g('Grandstand').make(null, { support: 3 }), { focusDice: 'low', noSupport: true, attacks: 3 });
  const me = { u: { models: [{ wounds: 1 }], statuses: new Set() }, m: { traits: [], rules: [], wounds: 1, p: {} } };
  // picking first against an opponent whose best gambit is far better than its next: Feint and Riposte, naming it
  const rival = () => [{ g: g('Finishing Blow'), v: 5 }, { g: g('Seize the Initiative'), v: 0.1 }];
  const pick = gambits.choose(null, me, me, () => 0, { lead: true, rival });
  assert.deepEqual([pick.name, pick.named], ['Feint and Riposte', 'Finishing Blow']);
  // picking second: no Feint and Riposte, and not the gambit already picked
  const names = gambits.rank(null, me, me, () => 0, { banned: new Set(['Seize the Initiative']) }).map((x) => x.g.name);
  assert.ok(!names.includes('Feint and Riposte') && !names.includes('Seize the Initiative') && names.includes('Withdraw'));
  // Withdraw: worth it when well behind on wounds, not when the model would fall anyway
  assert.equal(gambits.choose(null, me, me, (e) => (e.single ? -0.1 : 0), { behind: 4 }).name, 'Withdraw');
  assert.notEqual(gambits.choose(null, me, me, (e) => (e.single ? -0.1 : 0), { behind: 4, wouldFall: true }).name, 'Withdraw');
});

test('rulebook: Withdraw ends a losing challenge with no Combat Resolution; Never Back Down must challenge and accept', () => {
  const duel = (withdraw) => {
    const a = Object.assign(unit('sons-of-horus', 'legion-champion', {}, 0), { x: 30, y: 20 }), b = Object.assign(unit('sons-of-horus', 'legion-champion', {}, 1), { x: 32, y: 20 });
    // a hits hard but b can't fall in one round, and b can't wound a: whoever holds Challenge Advantage stops after one
    Object.assign(a.models[0], { melee: [CCW], p: Object.assign({}, a.models[0].p, { A: 10, WS: 10, T: 10 }) });
    Object.assign(b.models[0], { wounds: 200, maxWounds: 200, melee: [CCW], p: Object.assign({}, b.models[0].p, { W: 200, S: 1, SAV: '–', INV: '–' }) });
    lock(a, b);
    const lines = [];
    const choose = gambits.choose;
    gambits.choose = (st, me) => g(me.m === b.models[0] && withdraw ? 'Withdraw' : 'Seize the Initiative');
    try { return { tally: assault.fight(fightState([a, b], createDice(5), lines), [[a], [b]]), lines }; } finally { gambits.choose = choose; }
  };
  const g = (n) => gambits.GAMBITS.find((x) => x.name === n);
  // neither would challenge on its own (a's edge against 200 Wounds is tiny): Never Back Down makes a declare it
  const r = duel(true);
  assert.ok(r.lines.some((l) => /Legion Champion challenges, Legion Champion accepts/.test(l)) && r.lines.some((l) => /withdraws from the challenge/.test(l)), r.lines.join('\n'));
  assert.deepEqual(r.tally.glory, [0, 0]);
  assert.ok(duel(false).tally.glory[0] > 0);
  // a Legion Champion must accept even Mortarion's challenge, which it would otherwise refuse
  const meet = (nbd) => {
    const m = Object.assign(unit('death-guard', 'mortarion', {}, 0), { x: 30, y: 20 }), c = Object.assign(unit('sons-of-horus', 'legion-champion', {}, 1), { x: 32, y: 20 });
    if (!nbd) c.models[0].rules = [];
    lock(m, c);
    const lines = [];
    assault.fight(fightState([m, c], createDice(2), lines), [[m], [c]]);
    return lines.join('\n');
  };
  assert.match(meet(true), /Mortarion challenges, Legion Champion accepts/);
  assert.match(meet(false), /refused/);
});

test('rulebook: Selfless Burden wounds are automatic (no Wound Test, so no Promethean Endurance), saves allowed', () => {
  // the group battle.cjs makes for Selfless Burden's 1s: every hit of Rending (1+) wounds automatically
  const sal = unit('salamanders', 'tactical-squad', {}, 0);
  for (const m of sal.models) Object.assign(m, { wounds: 100, maxWounds: 100, p: Object.assign({}, m.p, { SAV: '–', INV: '–' }) });
  const r = resolveGroup({ attacks: 60, S: 1, AP: 7, D: 1, hitNeed: 1, rules: ['Rending (1+)'], melee: true }, sal, { dice: createDice(8) });
  assert.equal(r.damage, 60);
});

test("rulebook: Violence Incarnate and Flawless Execution last the phase of the charge, so a Shooting Phase charge (Brutal Tide) gives nothing in the Assault Phase", () => {
  const we = unit('world-eaters', 'tactical-squad', {}, 1), ec = unit('emperors-children', 'tactical-squad', {}, 1);
  const m = ec.models[0], w = m.melee[0];
  for (const u of [we, ec]) u.turn = { charged: true };
  assert.equal(assault.meleeMods(we).attacks, 1);
  const ci = assault.combatInitiative(ec, m, w);
  for (const u of [we, ec]) u.turn.chargePhase = 'shooting';
  assert.equal(assault.meleeMods(we).attacks, 0);
  assert.equal(assault.combatInitiative(ec, m, w), ci - 1);
});

test('rulebook: Lies and Obfuscation adds 2" to an Alpha Legion charger for a reaction Charge Roll (Furious Charge)', () => {
  const al = Object.assign(unit('alpha-legion', 'tactical-squad', {}, 0), { x: 30, y: 20, arrived: true });
  const we = Object.assign(unit('world-eaters', 'rampager-squad', {}, 1), { x: 30, y: 28, arrived: true, rite: 'Hereticus' });
  for (const m of we.models) m.ranged = [];
  const lines = [];
  const st = Object.assign(fightState([al, we], createDice(4), lines), { reactionsLeft: [0, 3], reactionSet: [new Set(), new Set(['Overwatch', 'Furious Charge'])], usedOnce: [new Set(), new Set()], reactionCount: [{}, {}] });
  const pick = reactions.onCharge(st, al, we);
  assert.equal(pick && pick.name, 'Furious Charge');
  const need = gap(we, al) + 2;
  pick.apply({ volleyKills: 1 });
  assert.ok(lines.some((l) => l.includes(`Furious Charge: charge roll`) && l.includes(`needed ${need.toFixed(1)}"`)), lines.join('\n'));
});

test('rulebook: Master of War gives Horus\'s army +1 Reaction Point each turn while he lives', () => {
  const spent = (withHorus) => {
    const host = Object.assign(unit('sons-of-horus', 'tactical-squad', {}, 1), { arrived: true }), other = Object.assign(unit('sons-of-horus', 'tactical-squad', {}, 1), { arrived: true });
    const units = [host, other, ...(withHorus ? [unit('sons-of-horus', 'horus-lupercal', {}, 1)] : [])];
    const st = Object.assign(fightState(units, createDice(1)), { reactionsLeft: [0, 1], reactionSet: [new Set(), new Set(['Heroic Intervention'])], usedOnce: [new Set(), new Set()], reactionCount: [{}, {}] });
    const made = [reactions.heroicIntervention(st, 1, host, 1), reactions.heroicIntervention(st, 1, other, 1)];
    return { made, left: st.reactionsLeft[1] };
  };
  // one point without him; two with him, the extra added once in the turn
  assert.deepEqual(spent(false), { made: [true, false], left: 0 });
  assert.deepEqual(spent(true), { made: [true, true], left: 0 });
});

// ---------- shooting rules from the rulebook: Blast scatter, Barrage, firing arcs, Skyfire and the rest ----------
/** A state a Shooting Attack can run in, on a table with nothing on it. */
const shootState = (dice, units, extra = {}) => Object.assign({ dice, units, table: { pieces: [], hulls: [], objectives: [] }, log: () => {}, pendingMorale: [], active: 0, onCasualty: () => {}, afterDamage: () => {} }, extra);
const place = (u, x, y, more = {}) => Object.assign(u, { x, y, arrived: true, destroyed: false, embarkedIn: null, statuses: new Set(), lockedWith: new Set(), turn: {} }, more);
// dice that always roll 1, and 0 for a direction or fraction (scatter along +x, no rounding up)
const ones = () => ({ d6: () => 1, d3: () => 1, twoD6: () => 2, rnd: () => 0 });

test('rulebook: missed Blasts scatter once per Fire Group and hit every unit under the marker, friend or foe', () => {
  const { modelsUnder, blastCount } = require('../sim/lib/attack.cjs');
  const { shootingAttack } = require('../sim/lib/shoot.cjs');
  // a centred marker covers the usual 3 or 5 models; half off the unit, fewer; clear of it, none; a lone model if touched
  const t = place(unit('sons-of-horus', 'tactical-squad', {}, 1), 30, 24);
  assert.equal(modelsUnder(t, t, 3), blastCount(10, false, 3));
  const edge = modelsUnder(t, { x: 30 + t.r, y: 24 }, 3);
  assert.ok(edge > 0.5 && edge < 2.5, `${edge}`);
  assert.equal(modelsUnder(t, { x: 30 + t.r + 1.6, y: 24 }, 3), 0);
  const tank = place(unit('sons-of-horus', 'predator', {}, 1), 50, 24);
  assert.equal(modelsUnder(tank, { x: 50 + 2.5 + 1.4, y: 24 }, 3), 1);
  // ten frag shots all miss (every die a 1): one Scatter Roll of 1" along +x; the marker still covers 3 of the target's
  // models, so 10 misses x 3 hits, and the shooter's own Rhino beside the target takes 10 hits as friendly fire
  const sq = place(unit('sons-of-horus', 'tactical-squad', {}, 0), 10, 24);
  const frag = { name: 'Test frag', base: 'Test frag', R: 30, FP: 1, RS: 3, AP: 7, D: 1, specialRules: ['Blast (3")'], traits: [] };
  for (const m of sq.models) m.ranged = [frag];
  const rhino = place(unit('sons-of-horus', 'rhino', {}, 0), 34.5, 24);
  const lines = [];
  shootingAttack(shootState(ones(), [sq, t, rhino], { log: (l) => lines.push(l) }), sq, t, {});
  assert.ok(lines.some((l) => /Test frag: 30 hits/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /scattered Test frag hits Rhino \(friendly fire\): 10 hits/.test(l)), lines.join('\n'));
});

test('rulebook: a Barrage Blast out of sight makes no Hit Test but an Indirect Scatter Roll per attack; Reactions need sight', () => {
  const { shootingAttack } = require('../sim/lib/shoot.cjs');
  const { planVolley } = require('../sim/lib/fire.cjs');
  const { armourFacing, rangedGroup, expectedGroup } = require('../sim/lib/attack.cjs');
  const sq = place(unit('sons-of-horus', 'tactical-squad', {}, 0), 10, 24);
  const mortar = { name: 'Test mortar', base: 'Test mortar', R: 48, FP: 1, RS: 4, AP: 5, D: 1, specialRules: ['Blast (3")', 'Barrage (1)'], traits: [] };
  const bolter = { name: 'Test bolter', base: 'Test bolter', R: 48, FP: 2, RS: 4, AP: 5, D: 1, specialRules: [], traits: [] };
  for (const m of sq.models) m.ranged = [mortar, bolter];
  const t = place(unit('sons-of-horus', 'tactical-squad', {}, 1), 40, 24);
  const st = shootState(ones(), [sq, t]);
  st.table.pieces.push({ x: 24, y: 0, w: 2, h: 48, blocksLoS: true, kind: 'building', impassable: true });
  const plan = planVolley(sq, t, st, {});
  assert.equal(plan.los, false);
  assert.ok(plan.picks.length === 10 && plan.picks.every((p) => p.weapon === mortar));
  assert.equal(planVolley(sq, t, st, { reaction: true }).picks.length, 0);
  // every die a 1 would fail every Hit Test, but none is made: the Scatter Dice shows HIT (rnd 0), so every marker
  // stays on the target and covers 3 models
  const lines = [];
  st.log = (l) => lines.push(l);
  shootingAttack(st, sq, t, {});
  assert.ok(lines.some((l) => /out of sight.*Test mortar: 30 hits/.test(l)), lines.join('\n'));
  assert.equal(shootingAttack(st, sq, t, { reaction: true }).damage, 0);
  // its hits on a vehicle take the Side Armour whichever way it faces; the AI expects a share of a centred marker
  const pred = place(unit('sons-of-horus', 'predator', {}, 1), 40, 24, { facing: Math.PI });
  assert.equal(armourFacing(pred, sq, false, true), 12);
  assert.equal(armourFacing(pred, sq, false, false), 13);
  const g = rangedGroup(sq.models[0], mortar, t, { indirect: true });
  assert.equal(g.hitNeed, null);
  assert.ok(g.pIndirect > 1 / 3 && g.pIndirect < 1, `${g.pIndirect}`);
  assert.ok(expectedGroup(g, t) < 3 * expectedGroup(rangedGroup(sq.models[0], mortar, t, {}), t));
});

test('rulebook: vehicle weapons fire only into their arcs, by the mount the item or its option names', () => {
  const { planVolley, parseMount, mountsOf } = require('../sim/lib/fire.cjs');
  assert.deepEqual(parseMount('Hull (Front) Mounted Hunter-killer missile'), { kind: 'hull', arcs: ['front'] });
  assert.deepEqual(parseMount('Hull (Side) Mounted x'), { kind: 'hull', arcs: ['left', 'right'] });
  assert.deepEqual(parseMount('Two Sponson Mounted lascannon arrays'), { kind: 'sponson', arcs: ['left', 'right'] });
  assert.deepEqual(parseMount('Sponson (right) Mounted x'), { kind: 'sponson', arcs: ['right'], single: true });
  assert.deepEqual(parseMount('Centreline (front, rear) Mounted x'), { kind: 'centreline', arcs: ['front', 'rear'] });
  assert.deepEqual(parseMount('Co-axial (Baneblade cannon) Mounted Autocannon'), { kind: 'coaxial', link: 'baneblade cannon' });
  assert.equal(parseMount('Pintle Mounted Bolter').kind, 'any');
  assert.equal(parseMount('Twin lascannon'), null);
  // a Land Raider's twin heavy bolter is Hull (Front) by its option; its twin lascannons are a pair of sponsons
  const lr = place(unit('sons-of-horus', 'land-raider-carrier', {}, 0), 36, 24, { facing: 0 });
  const mounts = mountsOf(lr, lr.models[0]);
  assert.deepEqual(lr.models[0].ranged.map((w) => mounts.get(w).kind), ['sponson', 'hull']);
  // a Predator's turret comes from the option that exchanges its cannon, its sponsons from their option group
  const pred = place(unit('sons-of-horus', 'predator', { options: { 'predator-legion-sponson-weapons': 'Lascannon' } }, 0), 10, 10);
  assert.deepEqual(pred.models[0].ranged.map((w) => mountsOf(pred, pred.models[0]).get(w).kind), ['any', 'sponson']);
  const fire = (x, y) => {
    const t = place(unit('sons-of-horus', 'tactical-squad', {}, 1), x, y);
    return planVolley(lr, t, shootState(createDice(1), [lr, t]), {}).picks.map((p) => `${p.weapon.name} x${p.weapon.count}`).sort();
  };
  // ahead, on the line between the sponsons: the heavy bolter and both sponsons; to either side: one sponson only
  assert.deepEqual(fire(50, 24), ['Sponson Mounted Twin Lascannon x2', 'Twin heavy bolter x1']);
  assert.deepEqual(fire(36, 40), ['Sponson Mounted Twin Lascannon x1']);
  assert.deepEqual(fire(36, 8), ['Sponson Mounted Twin Lascannon x1']);
  // turned to face the unit at the side, the heavy bolter can fire at it
  lr.facing = Math.PI / 2;
  assert.deepEqual(fire(36, 40), ['Sponson Mounted Twin Lascannon x2', 'Twin heavy bolter x1']);
});

test('rulebook: a vehicle splits its fire when it costs nothing, Defensive Weapons at a second unit', () => {
  const { shootingAttack } = require('../sim/lib/shoot.cjs');
  // the Land Raider's weapons are all Defensive (sponsons, and a Strength 5 bolter): its sponsons shoot the unit at its
  // side, then its front heavy bolter, out of arc for that one, shoots the unit ahead
  const lr = place(unit('sons-of-horus', 'land-raider-carrier', {}, 0), 36, 24, { facing: 0 });
  const side = place(unit('sons-of-horus', 'predator', {}, 1), 36, 40);
  const ahead = place(unit('sons-of-horus', 'tactical-squad', {}, 1), 52, 24);
  const lines = [];
  shootingAttack(shootState(createDice(3), [lr, side, ahead], { log: (l) => lines.push(l) }), lr, side, { phaseAttack: true });
  assert.ok(lines.some((l) => /shoots at Predator: Sponson Mounted Twin Lascannon/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /splits its fire at Tactical Squad/.test(l) && /Twin heavy bolter/.test(l) && !/Lascannon/.test(l)), lines.join('\n'));
  // a Predator's turret is a Battle Weapon: having fired it, the Predator doesn't split
  const pred = place(unit('sons-of-horus', 'predator', { options: { 'predator-turret': 'Twin lascannon' } }, 0), 36, 24, { facing: 0 });
  const lines2 = [];
  shootingAttack(shootState(createDice(3), [pred, side, ahead], { log: (l) => lines2.push(l) }), pred, side, { phaseAttack: true });
  assert.ok(lines2.some((l) => /shoots at Predator/.test(l)) && !lines2.some((l) => /splits its fire/.test(l)), lines2.join('\n'));
});

test('rulebook: Skyfire is per weapon and lost to a Tactical Status; Super-Heavy and Stable count as Stationary; Ordnance (R)', () => {
  const { rangedGroup } = require('../sim/lib/attack.cjs');
  const { steady, reachOf } = require('../sim/lib/fire.cjs');
  const model = { p: { BS: 4 }, rules: [], traits: [] };
  const t = place(unit('sons-of-horus', 'tactical-squad', {}, 1), 30, 24);
  const aa = { name: 'aa', FP: 1, RS: 7, AP: 4, D: 1, specialRules: ['Skyfire'], traits: [] };
  const gun = { name: 'gun', FP: 1, RS: 7, AP: 4, D: 1, specialRules: [], traits: [] };
  assert.equal(rangedGroup(model, aa, t, { vsFlyer: true }).snap, false);
  assert.equal(rangedGroup(model, gun, t, { vsFlyer: true }).snap, true);
  assert.equal(rangedGroup(model, aa, t, { vsFlyer: true, statused: true }).snap, true);
  assert.equal(rangedGroup(model, gun, t, {}).snap, false);
  // Super-Heavy and Stable: Stationary whatever they did, unless they Rushed or have a status
  const sh = { unitType: 'Vehicle (Super-heavy)', statuses: new Set(), side: 0, turn: {} };
  assert.equal(steady({ active: 0 }, sh), true);
  assert.equal(steady({ active: 0 }, Object.assign({}, sh, { unitType: 'Vehicle (Stable, Flyer)' })), true);
  assert.equal(steady({ active: 0 }, Object.assign({}, sh, { turn: { rushed: true } })), false);
  assert.equal(steady({ active: 0 }, Object.assign({}, sh, { statuses: new Set(['Pinned']) })), false);
  assert.equal(steady({ active: 0 }, Object.assign({}, sh, { unitType: 'Vehicle' })), false);
  // Ordnance (R) doubles the range when Stationary; a rule naming two Characteristics applies to both
  const mortar = { name: 'm', R: 36, FP: 1, RS: 6, AP: 5, D: 1, specialRules: ['Ordnance (R)', 'Blast (5")', 'Barrage (1)'], traits: [] };
  assert.equal(reachOf(mortar, model, true), 72);
  assert.equal(reachOf(mortar, model, false), 36);
  const smasha = { name: 's', R: 24, FP: 1, RS: 7, AP: 4, D: 1, specialRules: ['Ordnance (RS & AP)'], traits: [] };
  const g = rangedGroup(model, smasha, t, { stationary: true });
  assert.deepEqual([g.S, g.AP], [14, 2]);
});

test('rulebook: Poisoned needs a 6 against Walkers and Automata; Shock needs a Hit Test; Paragons allocate their hits', () => {
  const { resolveGroup, expectedGroup } = require('../sim/lib/attack.cjs');
  const walker = { models: [{ wounds: 10, maxWounds: 10, p: { T: 7, W: 10, SAV: '–' }, rules: [], unitType: 'Walker' }], statuses: new Set() };
  const infantry = { models: [{ wounds: 10, maxWounds: 10, p: { T: 7, W: 10, SAV: '–' }, rules: [], unitType: 'Infantry' }], statuses: new Set() };
  const venom = { attacks: 6, S: 1, AP: 7, D: 1, hitNeed: null, rules: ['Poisoned (2+)'], melee: true };
  assert.ok(Math.abs(expectedGroup(venom, walker) - 1) < 1e-9);
  assert.ok(Math.abs(expectedGroup(venom, infantry) - 5) < 1e-9);
  // a wound roll of 5 poisons infantry but not a walker
  assert.equal(resolveGroup(Object.assign({}, venom, { attacks: 1 }), walker, { dice: scripted([5]) }).wounds, 0);
  assert.equal(resolveGroup(Object.assign({}, venom, { attacks: 1 }), infantry, { dice: scripted([5]) }).wounds, 1);
  // Shock: a Template makes no Hit Test, so it never triggers; a Hit Test of 5 does, even one that misses
  const pred = place(unit('sons-of-horus', 'predator', {}, 1), 30, 24);
  const flux = { attacks: 1, S: 5, AP: 4, D: 1, hitNeed: null, rules: ['Template', 'Shock (Pinned)'], melee: false, from: { x: 30, y: 10 } };
  assert.equal(resolveGroup(flux, pred, { dice: scripted([1]) }).shockRolls, 0);
  assert.equal(resolveGroup(Object.assign({}, flux, { hitNeed: 6, rules: ['Shock (Pinned)'] }), pred, { dice: scripted([5]) }).shockRolls, 1);
  // a Paragon's hit goes where its player wants it (the Sergeant); otherwise the defender keeps the Sergeant back
  const kill = { attacks: 1, S: 10, AP: 2, D: 1, hitNeed: null, rules: [], melee: true };
  const a = unit('sons-of-horus', 'tactical-squad', {}, 1), b = unit('sons-of-horus', 'tactical-squad', {}, 1);
  resolveGroup(Object.assign({}, kill, { attackerModel: { unitType: 'Paragon (Unique)', rules: [] } }), a, { dice: scripted([6]) });
  resolveGroup(Object.assign({}, kill, { attackerModel: { unitType: 'Infantry', rules: [] } }), b, { dice: scripted([6]) });
  assert.equal(a.models.find((m) => m.sergeant).wounds, 0);
  assert.equal(b.models.find((m) => m.sergeant).wounds, 1);
});

// ---------- Flyers, the core disciplines' powers and Sudden Death ----------
/** A battle state on an open table, Dawn of War (side 0's zone along the top edge, side 1's along the bottom). */
function openScene(units, opts = {}) {
  const table = { pieces: [], objectives: [], hulls: [] };
  const m = mission.setupMission(createDice(1), table, { mission: opts.mission || 'no-quarter', deployment: 'dawn-of-war' });
  table.objectives = opts.objectives || [];
  const st = {
    dice: opts.dice || createDice(opts.seed || 5), table, mission: m, units, round: opts.round || 2, active: opts.active || 0, turnsLeft: 3, vp: [0, 0], vpLog: [],
    armies: [{ name: 'A', pointsLimit: 3000 }, { name: 'B', pointsLimit: 3000 }], pendingMorale: [], cache: { shoot: new Map(), melee: new Map() },
    reactionsLeft: opts.reactionsLeft || [0, 0], zoneOf: [m.zones.A, m.zones.B], zoneName: ['A', 'B'], destroyedUnits: [], firstStrike: [false, false],
    vanguardScored: new Set(), annihilate: [false, false], coordinate: [null, null], umFlex: [false, false], lines: [],
  };
  st.log = (s) => st.lines.push(s);
  st.award = (side, vp, why) => { st.vp[side] += vp; st.vpLog.push({ side, vp, why }); };
  st.onCasualty = () => {};
  st.afterDamage = (u) => { if (!u.destroyed && !u.models.some((x) => x.wounds > 0)) { u.destroyed = true; st.destroyedUnits.push(u); } };
  st.onArrive = (u) => reactions.onArrive(st, u);
  reactions.setup(st);
  psychic.setup(st);
  for (const u of units) Object.assign(u, { turn: {}, reacted: false });
  return st;
}
const onTable = (u, x, y) => Object.assign(u, { x, y, arrived: true, destroyed: false, reserve: null, embarkedIn: null, statuses: new Set(), lockedWith: new Set(), turn: {} });
const airList = () => require('../sim/lib/army.cjs').buildArmy(path.join(LISTS, 'ultramarines-air.json'), 0).units;
const foeList = () => require('../sim/lib/army.cjs').buildArmy(path.join(LISTS, 'legions', 'sons-of-horus.json'), 1).units;

test('Flyers: Aerial Reserves Tests from 3+ to 6+ and never automatic; the Combat Assignment, its move, its weapons, and back to Aerial Reserves', () => {
  const flyers = require('../sim/lib/flyers.cjs');
  const a = airList();
  const xiphon = a.find((u) => u.name === 'Xiphon Interceptor'), raptor = a.find((u) => u.name === 'Fire Raptor');
  const foe = foeList().find((u) => u.name === 'Tactical Squad');
  assert.equal(flyers.reservesTarget(xiphon), 3);
  xiphon.aerialReturns = 2; assert.equal(flyers.reservesTarget(xiphon), 5);
  xiphon.aerialReturns = 9; assert.equal(flyers.reservesTarget(xiphon), 6);
  xiphon.aerialReturns = 0;
  // a Strike Mission fires Centreline Mounted (or Guided Missile) weapons, as Snap Shots; a Drop Mission Defensive ones
  const rm = raptor.models[0], gravis = rm.ranged.find((w) => /Gravis/.test(w.name)), cannon = rm.ranged.find((w) => /avenger/.test(w.name));
  const strike = flyers.fireOptions(raptor, 'strike')[0], drop = flyers.fireOptions(raptor, 'drop')[0];
  assert.ok(strike.snap && strike.filter(rm, cannon) && !strike.filter(rm, gravis), 'sponsons are not Centreline Mounted');
  assert.ok(drop.filter(rm, gravis) && !drop.filter(rm, rm.ranged.find((w) => /Tempest/.test(w.name))), 'sponsons are Defensive, a Strength 7 rocket is not');
  // attacks at a Flyer are Snap Shots, except on a Strafing Run
  assert.equal(flyers.snapAgainst({ unitType: 'Vehicle (Flyer)', assignment: 'strike' }), true);
  assert.equal(flyers.snapAgainst({ unitType: 'Vehicle (Flyer)', assignment: 'strafing' }), false);
  assert.equal(flyers.snapAgainst(foe), false);
  // a pass in Battle Turn 4 needs the roll: a 2 fails
  onTable(foe, 36, 40);
  Object.assign(xiphon, { reserve: 'aerial', arrived: false });
  const st = openScene([xiphon, foe], { dice: scripted([2]), round: 4 });
  flyers.reservesSubPhase(st, 0);
  assert.equal(xiphon.arrived, false);
  // a 3 passes: it takes an assignment and comes on at its own zone's edge
  st.dice = scripted([3]);
  flyers.reservesSubPhase(st, 0);
  assert.ok(xiphon.arrived && ['strike', 'strafing'].includes(xiphon.assignment), xiphon.assignment);
  assert.ok(xiphon.y <= xiphon.r + 0.01, `at the top edge: ${xiphon.y}`);
  const from = { x: xiphon.x, y: xiphon.y };
  assert.deepEqual(flyers.moveSubPhase(st, 0), [xiphon]);
  assert.ok(Math.hypot(xiphon.x - from.x, xiphon.y - from.y) <= (xiphon.assignment === 'strafing' ? 10 : 20) + 0.01);
  flyers.shoot(st, xiphon);
  assert.ok(st.lines.some((l) => /Xiphon Interceptor shoots at Tactical Squad/.test(l)), st.lines.join('\n'));
  flyers.endShootingPhase(st, 0);
  assert.deepEqual([xiphon.reserve, xiphon.arrived, xiphon.assignment, flyers.reservesTarget(xiphon)], ['aerial', false, null, 4]);
  // the next test needs a 4+, in Battle Turn 5 as well
  st.round = 5; st.dice = scripted([3]);
  flyers.reservesSubPhase(st, 0);
  assert.equal(xiphon.arrived, false);
});

test('Flyers: a Drop Mission lands its squad, fires only Defensive Weapons, and a Flyer in Aerial Reserves at the end is not destroyed', () => {
  const flyers = require('../sim/lib/flyers.cjs');
  const a = airList();
  const eagle = a.find((u) => u.name === 'Storm Eagle'), tac = a.find((u) => u.name === 'Tactical Squad' && u.models.length === 10), xiphon = a.find((u) => u.name === 'Xiphon Interceptor');
  const foe = foeList().find((u) => u.name === 'Tactical Squad');
  onTable(foe, 36, 40);
  Object.assign(eagle, { reserve: 'aerial', arrived: false, passengers: [tac] });
  Object.assign(tac, { embarkedIn: eagle, arrived: false, statuses: new Set(), lockedWith: new Set() });
  const st = openScene([eagle, tac, foe], { dice: scripted([4]) });
  flyers.reservesSubPhase(st, 0);
  assert.equal(eagle.assignment, 'drop');
  flyers.moveSubPhase(st, 0);
  assert.equal(tac.embarkedIn, null);
  assert.ok(tac.arrived && gap(tac, eagle) < 1 && tac.turn.disembarked);
  assert.equal(tac.turn.disordered, false, 'the Storm Eagle is an Assault Vehicle');
  flyers.shoot(st, eagle);
  const shot = st.lines.find((l) => /^ {2}Storm Eagle shoots/.test(l)) || '';
  assert.ok(!/Vengeance|Tempest/.test(shot), shot);
  flyers.endShootingPhase(st, 0);
  assert.equal(eagle.reserve, 'aerial');
  // shot down by an Intercept on a Drop Mission: each model aboard takes an AP 2, Damage 2 wound on a 1
  const before = tac.models.filter((m) => m.wounds > 0).length;
  st.dice = scripted([1, 1, 1, 6, 6, 6, 6, 6, 6, 6]);
  flyers.crashWounds(st, tac);
  assert.equal(tac.models.filter((m) => m.wounds > 0).length, before - 3);
  // at the end: Aerial Reserves (and the units aboard) count for nothing; other Reserves are destroyed
  const est = openScene([xiphon, eagle, tac, foe]);
  Object.assign(xiphon, { reserve: 'aerial', arrived: false });
  Object.assign(eagle, { reserve: 'aerial', arrived: false, passengers: [tac] });
  Object.assign(tac, { embarkedIn: eagle, arrived: false });
  Object.assign(foe, { reserve: 'deep', arrived: false });
  scoring.endOfBattle(est);
  assert.equal(est.vp[1], 0, JSON.stringify(est.vpLog));
  assert.ok(est.vpLog.some((v) => v.side === 0 && /Tactical Squad still in Reserves/.test(v.why)));
});

test('Flyers: Combat Air Patrol sends an Interceptor from Aerial Reserves at an arriving Flyer', () => {
  const flyers = require('../sim/lib/flyers.cjs');
  const mine = airList().filter((u) => u.name === 'Xiphon Interceptor');
  const theirs = require('../sim/lib/army.cjs').buildArmy(path.join(LISTS, 'ultramarines-air.json'), 1).units.find((u) => u.name === 'Xiphon Interceptor');
  const foe = foeList().find((u) => u.name === 'Tactical Squad');
  onTable(foe, 36, 40);
  const [attacker] = mine;
  Object.assign(attacker, { reserve: 'aerial', arrived: false });
  Object.assign(theirs, { reserve: 'aerial', arrived: false });
  assert.ok(theirs.models.every((m) => m.traits.includes('Interceptor')));
  const st = openScene([attacker, theirs, foe], { dice: scripted([5]), reactionsLeft: [0, 3] });
  flyers.reservesSubPhase(st, 0);
  assert.ok(attacker.assignment);
  flyers.moveSubPhase(st, 0);
  assert.equal(st.reactionCount[1]['Combat Air Patrol'], 1, st.lines.join('\n'));
  assert.ok(st.lines.some((l) => /Xiphon Interceptor patrols and shoots at Xiphon Interceptor/.test(l)));
  assert.deepEqual([theirs.reserve, theirs.arrived, theirs.aerialReturns], ['aerial', false, 1]);
});

test('Sudden Death: off in the pack, and when played, a battle with no models left on the battlefield ends', () => {
  const lone = { version: 2, faction: 'ultramarines', name: 'Lone Xiphon', pointsLimit: 3000, sequelae: [], config: { allegiance: ['Loyalist'] },
    detachments: [{ kind: 'primary', name: 'Crusade Primary Detachment', slots: [{ role: 'Fast Attack', unit: { unitId: 'xiphon-interceptor', counts: {}, options: {} } }] }] };
  assert.equal(mission.setupMission(createDice(1), { pieces: [], objectives: [] }, { mission: 'no-quarter' }).suddenDeath, false);
  // its Flyer is in Aerial Reserves at the end of every Battle Turn, so a lone Flyer is never on the battlefield
  const both = runBattle(lone, lone, { seed: 3, suddenDeath: true, log: true });
  assert.equal(both.turns, 1);
  assert.deepEqual(both.vp, [0, 0]);
  assert.ok(both.log.some((l) => /Sudden Death: neither army/.test(l)));
  const vs = runBattle(lone, path.join(LISTS, 'legions', 'sons-of-horus.json'), { seed: 3, suddenDeath: true, mission: 'high-ground' });
  assert.equal(vs.turns, 1);
  assert.ok(vs.vpLog.some((v) => v.side === 1 && v.vp === 3 && /Sudden Death/.test(v.why)));
  // the pack's battles play on
  assert.ok(runBattle(lone, lone, { seed: 3 }).turns >= 5);
});

test('Pyromancy: the Pyromancer explodes when he dies (4+), on every unit within 6" of him', () => {
  const a = airList();
  const lib = a.find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Pyromancy'));
  const [near, far] = a.filter((u) => u.name === 'Tactical Squad');
  assert.ok(!lib.rules.some((r) => /^Explodes/.test(r)), 'not a rule of his unit: battle.cjs would blow up a whole unit');
  onTable(lib, 20, 20); onTable(near, 20 + lib.r + near.r + 3, 20); onTable(far, 60, 40);
  const count = (u) => u.models.filter((m) => m.wounds > 0).length;
  const n0 = count(near), f0 = count(far);
  // a 5 explodes; three hits at Strength 8: wound on 6s, armour saves fail on 1s
  const st = openScene([lib, near, far], { dice: scripted([5, 6, 1, 6, 1, 6, 1]) });
  lib.models[0].wounds = 0;
  st.onCasualty(lib.models[0], lib, null);
  st.afterDamage(lib);
  assert.ok(st.lines.some((l) => /Librarian explodes \(Explodes \(4\+\)\): 3 hits/.test(l)), st.lines.join('\n'));
  assert.equal(count(near), n0 - 3);
  assert.equal(count(far), f0);
  assert.equal(lib.destroyed, true);
  // on a 3 nothing happens
  const lib2 = airList().find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Pyromancy'));
  onTable(lib2, 20, 20);
  const st2 = openScene([lib2, near], { dice: scripted([3]) });
  lib2.models[0].wounds = 0; st2.onCasualty(lib2.models[0], lib2, null); st2.afterDamage(lib2);
  assert.ok(!st2.lines.some((l) => /explodes/.test(l)));
});

test('psychic: Conflagration and Cursed Whispers roll their dice, and a Diviner may pick Every Strike Foreseen', () => {
  const a = airList();
  const pyro = a.find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Pyromancy')).models[0];
  const tele = a.find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Telepathy')).models[0];
  const conf = pyro.melee.find((w) => w.name === 'Conflagration'), cw = tele.ranged.find((w) => w.name === 'Cursed Whispers');
  assert.deepEqual([conf.AM, conf.dice.AM, cw.FP, cw.dice.FP, cw.R, xOf(cw.specialRules, 'Stun')], ['8', '6+D3', '7', '2D6', 18, 0]);
  const st = { dice: createDice(4) };
  let am = 0, fp = 0;
  for (let i = 0; i < 3000; i++) {
    const a1 = +psychic.rollDice(st, conf).AM, f1 = +psychic.rollDice(st, cw).FP;
    assert.ok(a1 >= 7 && a1 <= 9 && f1 >= 2 && f1 <= 12, `${a1} ${f1}`);
    am += a1; fp += f1;
  }
  assert.ok(Math.abs(am / 3000 - 8) < 0.1 && Math.abs(fp / 3000 - 7) < 0.2, `${am / 3000} ${fp / 3000}`);
  const bolter = a.find((u) => u.name === 'Tactical Squad').models[0].ranged[0];
  assert.equal(psychic.rollDice(st, bolter), bolter);
  // Divination: Duellist's Edge (2) and the Every Strike Foreseen gambit
  assert.ok(tele.rules.includes("Duellist's Edge (2)") && tele.rules.includes('Fear (1)'));
  assert.ok(gambits.available(tele).some((g) => g.name === 'Every Strike Foreseen'));
  assert.ok(psychic.POWERS.filter((p) => ['Divination', 'Telepathy', 'Thaumaturgy'].includes(p.discipline)).every((p) => p.played));
});

test("psychic: Foresight's Blessing gives a shooting unit Precision (5+) for the attack", () => {
  const a = airList();
  const div = a.find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Divination'));
  const tac = a.find((u) => u.name === 'Tactical Squad' && u.models.length === 20);
  const foe = foeList().find((u) => u.name === 'Tactical Squad');
  onTable(div, 10, 12); onTable(tac, 16, 12); onTable(foe, 16, 30);
  const st = openScene([div, tac, foe], { dice: scripted([2, 3]) });
  const end = psychic.foresightsBlessing(st, tac, foe);
  assert.ok(end, st.lines.join('\n'));
  assert.ok(tac.models.every((m) => m.ranged.every((w) => xOf(w.specialRules, 'Precision') === 5)));
  assert.equal(div.turn.power, true);
  end();
  assert.ok(tac.models.every((m) => m.ranged.every((w) => xOf(w.specialRules, 'Precision') == null)));
  // one power for the Diviner's unit in a turn
  assert.equal(psychic.foresightsBlessing(st, tac, foe), null);
});

test('psychic: Mind-burst throws a unit off its marker and may Rout it, from a Telepath whose unit stays put', () => {
  const tele = airList().find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Telepathy'));
  const foe = foeList().find((u) => u.name === 'Tactical Squad');
  onTable(tele, 30, 10); onTable(foe, 30, 26);
  const objectives = [{ id: 0, x: 30, y: 26, value: 2 }];
  // a unit that moved can't
  const moved = openScene([tele, foe], { mission: 'crucial-supplies', objectives });
  tele.turn.moved = true;
  psychic.movementPhase(moved, 0);
  assert.ok(!tele.turn.power);
  // passed (5), a Fall Back Move of I + 3, then the unmodified Leadership Check: a double 6 fails
  const st = openScene([tele, foe], { mission: 'crucial-supplies', objectives, dice: scripted([2, 3, 3, 6, 6]) });
  psychic.movementPhase(st, 0);
  assert.equal(tele.turn.power, true, st.lines.join('\n'));
  assert.ok(foe.y > 26 + 3, `fell back towards its own edge: ${foe.y}`);
  assert.ok(foe.statuses.has('Routed'));
});

test('psychic: Resurrection brings a casualty back on a 4+, and Tranquillity calms an enemy Psyker until the next turn', () => {
  const a = airList();
  const thaum = a.find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Thaumaturgy'));
  const tac = a.find((u) => u.name === 'Tactical Squad' && u.models.length === 10);
  const foe = foeList().find((u) => u.name === 'Tactical Squad');
  // the Thaumaturge stands with the squad and falls with two of its men to the enemy's shooting
  const lm = thaum.models[0];
  tac.models.push(lm);
  onTable(tac, 20, 12); onTable(foe, 20, 30);
  const st = openScene([tac, foe], { dice: scripted([2, 3, 5]), reactionsLeft: [3, 0], active: 1 });
  // an AI that spends its reactions readily (ai.cjs's weights)
  Object.assign(st, { phase: 'shooting', aiParams: [{ react: 0.2 }, null] });
  for (const m of [tac.models[0], tac.models[1], lm]) { m.wounds = 0; st.onCasualty(m, tac, foe); }
  st.afterDamage(tac);
  assert.equal(st.reactionCount[0].Resurrection, 1, st.lines.join('\n'));
  assert.equal(lm.wounds, lm.maxWounds, 'the most valuable casualty, himself, rises');
  // a Reaction like any other: the Ultramarines' first of the turn is free (Tactical Flexibility)
  assert.deepEqual([st.reactionsLeft[0], st.umFlex[0], tac.reacted], [3, true, true]);
  // Tranquillity on a Prosperine Sorcerer: -1 Strength to his Psychic Weapons, -2 Willpower to manifest
  const sorc = require('../sim/lib/army.cjs').buildArmy(path.join(LISTS, 'strong', 'thousand-sons.json'), 1).units.find((u) => /Sorcerer/.test(u.name));
  const lib = airList().find((u) => u.name === 'Librarian' && u.models[0].disciplines.includes('Thaumaturgy'));
  onTable(lib, 20, 10); onTable(sorc, 20, 24);
  const sm = sorc.models[0], rs = sm.ranged.find((w) => w.name === 'Wildfire').RS, sl = sm.melee.find((w) => w.name === 'Biomantic Slam').SM;
  const t = openScene([lib, sorc], { dice: scripted([2, 3, 2, 4]) });
  psychic.startPhase(t, 0);
  assert.ok(sorc.tranquil, t.lines.join('\n'));
  assert.equal(sm.ranged.find((w) => w.name === 'Wildfire').RS, rs - 1);
  assert.equal(sm.melee.find((w) => w.name === 'Biomantic Slam').SM, sl - 1);
  psychic.manifest(t, sorc, sm, 'Force Barrier');
  assert.ok(t.lines.some((l) => new RegExp(`Force Barrier\\): rolled 6 against ${+sm.p.WP - 2},`).test(l)), t.lines.join('\n'));
  // it lasts until the start of the Thaumaturge's side's next turn
  psychic.startPhase(Object.assign(t, { dice: scripted([6, 5]) }), 0);
  assert.equal(sorc.tranquil, null);
  assert.equal(sm.ranged.find((w) => w.name === 'Wildfire').RS, rs);
});

test('Flyers and psykers play through a battle: Flyers come and go, the Storm Eagle drops its squad', () => {
  const r = runBattle(path.join(LISTS, 'ultramarines-air.json'), path.join(LISTS, 'strong', 'thousand-sons.json'), { seed: 2, log: true });
  assert.ok(r.log.some((l) => /comes in from Aerial Reserves on a Drop Mission/.test(l)));
  assert.ok(r.log.some((l) => /disembarks from Storm Eagle/.test(l)));
  assert.ok(r.log.some((l) => /returns to Aerial Reserves/.test(l)));
  // a Flyer is never on the battlefield in the Assault Phase: nobody charges one
  assert.ok(!r.log.some((l) => /declares a charge at (Storm Eagle|Xiphon|Fire Raptor)/.test(l)));
});
