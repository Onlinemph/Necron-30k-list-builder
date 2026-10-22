// Necron house rules (data/parts/house-rules.json): off by default, the printed codex untouched,
// every change applied only while the army's "House rules" configuration choice is on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('../data/necrons.json');
const { createEngine } = require('../js/engine.js');

const E = createEngine(data);
const sel = (id) => E.newSelection(id);
const army = (house, units = [], extra = {}) => {
  const det = E.makeDetachment('primary', 'Primary', units.map(([role]) => ({ role })));
  units.forEach(([, id], i) => { det.slots[i].unit = typeof id === 'string' ? sel(id) : id; });
  return Object.assign({ version: 2, faction: 'necrons', pointsLimit: 3000, sequelae: [], config: house ? { 'house-rules': ['House rules'] } : {}, detachments: [det] }, extra);
};
const on = () => E.setArmy(army(true));
const off = () => E.setArmy(army(false));
const pts = (id, f) => { const s = sel(id); if (f) f(s); return E.unitPoints(s); };
const model = (id, f) => { const s = sel(id); if (f) f(s); return E.effectiveModels(s)[0]; };

test('house rules are off by default and the printed data files are untouched', () => {
  off();
  for (const u of data.units) assert.equal(pts(u.id), u.basePoints, u.id);
  // the overlay lives in its own file; no printed part carries house fields
  const parts = path.join(__dirname, '..', 'data', 'parts');
  for (const f of fs.readdirSync(parts).filter((x) => x.endsWith('.json') && x !== 'house-rules.json')) {
    assert.ok(!/"house(Changed|Rules)?"\s*:/.test(fs.readFileSync(path.join(parts, f), 'utf8')), f);
  }
  assert.ok(data.armyConfig.groups.some((g) => g.id === 'house-rules'));
  assert.equal(E.unit('triarch-praetorians').basePoints, 175);
  assert.ok(!E.unitsForSlot({ role: 'Warlord' }, null).some((u) => u.id === 'necron-phaeron'));
});

test('Canoptek Tomb Crawlers swap to the Exile Beamer (printed data fix, either way)', () => {
  for (const f of [off, on]) {
    f();
    const u = E.unit('canoptek-tomb-crawlers');
    assert.deepEqual(u.options[0].choices.map((c) => c.name), ['Exile Beamer']);
    assert.match(u.note, /Transdimensional Beamer/);
  }
  assert.ok(data.weapons.ranged.some((w) => w.name === 'Exile Beamer'));
});

test('A. points changes', () => {
  on();
  assert.equal(pts('hexmark-destroyers', (s) => { s.counts['Hexmark Destroyer'] = 3; }), 100 + 2 * 90);
  assert.equal(pts('ghost-ark'), 80);
  assert.equal(pts('royal-warden', (s) => { s.options.officer = true; }), 40 + 25);
  assert.equal(pts('necron-lord'), 55);
  assert.equal(pts('necron-lord-on-barge'), 85);
  assert.equal(pts('night-shroud'), 170);
  assert.equal(pts('canoptek-doom-stalker'), 125);
  assert.equal(pts('necron-warriors', (s) => { s.counts['Necron Warrior'] = 15; }), 90 + 5 * 9);
  const lord = sel('necron-lord');
  const orb = E.choicesFor(E.unit('necron-lord').options.find((o) => o.id === 'wargear'), lord).find((c) => c.name === 'Resurrection Orb');
  assert.deepEqual([orb.points, orb.was], [25, 40]);
  // and the printed prices with the switch off
  off();
  assert.equal(pts('hexmark-destroyers', (s) => { s.counts['Hexmark Destroyer'] = 3; }), 80 + 2 * 70);
  assert.equal(pts('necron-warriors', (s) => { s.counts['Necron Warrior'] = 15; }), 100 + 5 * 10);
  assert.equal(pts('royal-warden', (s) => { s.options.officer = true; }), 50);
});

test('Dark Harvest extra Necron Warriors cost +9 under house rules', () => {
  E.setArmy(army(true, [], { sequelae: ['Dark Harvest'] }));
  const u = E.unit('necron-warriors');
  assert.equal(E.modelMax(u, u.models[0]), 30);
  assert.equal(pts('necron-warriors', (s) => { s.counts['Necron Warrior'] = 30; }), 90 + 20 * 9);
});

test('B. changed profiles show against the printed value', () => {
  on();
  const tb = model('tomb-blades');
  assert.equal(tb.profile.BS, 4);
  assert.equal(tb.baseProfile.BS, 3);
  assert.ok(tb.changed.BS);
  assert.ok(tb.added.includes('Shrouded (5+)') && tb.added.includes('Evasion Engrams'));
  const dl = model('destroyer-lord-skorpekh-frame');
  assert.deepEqual([dl.profile.INV, dl.changed.INV], ['5+', true]);
  assert.ok(model('deathmarks').added.includes('Hunters from Hyperspace'));
  assert.ok(model('lychguard').added.includes('Guardian Protocols'));
  assert.ok(model('canoptek-wraiths').added.includes('Sentinel Protocols'));
  assert.ok(model('canoptek-spyders').added.includes('Sentinel Protocols'));
  assert.match(E.unit('hexmark-destroyers').note, /Breaching \(6\+\)/);
  const node = E.unit('convergence-of-dominion').unitRules.find((r) => r.name === 'Resurrection Node');
  assert.match(node.text, /if at least one model equipped with a Resurrection Node/);
  assert.ok(data.house.rules.find((r) => r.name === 'Resurrection Node').printed.includes('for each model'));
  assert.match(data.house.wargear.find((w) => w.name === 'Resurrection Orb').text, /Resurrection \(4\+\) Tests/);
  off();
  const printed = model('tomb-blades');
  assert.deepEqual([printed.profile.BS, printed.added], [3, []]);
});

test('house weapon profiles are scoped to their units', () => {
  const w = data.house.weapons;
  assert.deepEqual(w.melee.find((x) => x.name === 'Paired Flensing Claws (house)').units, ['flayed-ones']);
  assert.deepEqual(w.ranged.find((x) => x.replaces === 'Synaptic Disintegrator').specialRules.find((r) => /Pinning/.test(r)), 'Pinning (1)');
  assert.ok(w.ranged.concat(w.melee).filter((x) => /Rod of Covenant/.test(x.name)).every((x) => x.units.join() === 'triarch-praetorians'));
  assert.deepEqual(w.melee.find((x) => x.name === 'Tesseract Labyrinth (generic)').exceptUnits, ['trazyn-the-infinite']);
});

test('Phase Shifter grants the Phase Shift trait, with or without house rules', () => {
  for (const f of [off, on]) {
    f();
    assert.ok(model('necron-overlord', (s) => { s.options['any-of'] = ['Phase Shifter']; }).traits.includes('Phase Shift'));
    assert.ok(model('canoptek-wraiths').traits.includes('Phase Shift'));
    const c = model('cryptek', (s) => { s.arkana = 'Chronomancy'; s.options['techno-arkana'] = 'Timesplinter Mantle'; });
    assert.ok(c.traits.includes('Phase Shift'));
  }
  E.setArmy(army(false, [], { sequelae: ['Awoken Vaults'] }));
  assert.ok(model('ghost-ark', (s) => { s.options['sq-awoken-phase-shifter'] = true; }).traits.includes('Phase Shift'));
  assert.match(data.house.wargear.find((w) => w.name === 'Phase Shifter').note, /Phase Shift Trait/);
});

test('C. Triarch Praetorians rework, and Servants of the Ankh gives them Vanguard (3)', () => {
  on();
  const u = E.unit('triarch-praetorians');
  assert.equal(pts('triarch-praetorians', (s) => { s.counts.Praetorian = 10; }), 225 + 5 * 40);
  assert.equal(E.modelMax(u, u.models[0]), 10);
  const p = model('triarch-praetorians');
  assert.deepEqual([p.profile.WS, p.profile.A, p.profile.LD], [5, 3, 12]);
  assert.ok(p.changed.WS && p.changed.A);
  assert.ok(p.rules.includes('Vanguard (2)') && p.rules.includes('Impact (A)'));
  E.setArmy(army(true, [], { sequelae: ['Servants of the Ankh'] }));
  const ankh = model('triarch-praetorians');
  assert.ok(ankh.rules.includes('Vanguard (3)') && !ankh.rules.includes('Vanguard (2)'), ankh.rules.join());
  E.setArmy(army(false, [], { sequelae: ['Servants of the Ankh'] }));
  assert.ok(model('triarch-praetorians').rules.includes('Vanguard (2)'));
});

test('D. Necron Phaeron: house rules only, Warlord slot, barge, Nemesor', () => {
  const ph = (f) => { const s = sel('necron-phaeron'); if (f) f(s); return s; };
  const a = army(true, [['Warlord', ph()]]);
  assert.deepEqual(E.armyIssues(a).filter((i) => /Phaeron/.test(i.msg)), []);
  assert.ok(E.armyIssues(army(false, [['Warlord', ph()]])).some((i) => /Necron Phaeron needs House rules/.test(i.msg)));
  on();
  assert.ok(E.unitsForSlot({ role: 'Warlord' }, null).some((u) => u.id === 'necron-phaeron'));
  assert.equal(pts('necron-phaeron'), 250);
  const barge = ph((s) => { s.options.barge = 1; s.options.cannon = 'Tesla Cannon'; });
  assert.equal(E.unitPoints(barge), 290);
  const m = E.effectiveModels(barge)[0];
  assert.deepEqual([m.profile.M, m.profile.T, m.unitType], [12, 7, 'Cavalry (Antigrav, Command)']);
  assert.ok(m.items.includes('Tesla Cannon') && !m.items.includes('Gauss Cannon'));
  assert.ok(m.rules.includes('Command Barge') && m.rules.includes('Bulky (8)'));
  // a Nemesor: two Sequelae, and the Royal Burial Site Weapon Skill bonus
  assert.equal(E.sequelaAllowance(army(true, [['Warlord', ph()]])), 2);
  E.setArmy(army(true, [], { sequelae: ['Royal Burial Site'] }));
  assert.equal(model('necron-phaeron').profile.WS, 7);
  // the 25% Warlord and Lord of War cap
  assert.ok(E.armyIssues(army(true, [['Warlord', ph()]], { pointsLimit: 900 })).some((i) => /25%/.test(i.msg)));
});

test('E. wargear additions', () => {
  on();
  const lord = sel('necron-lord');
  const names = E.choicesFor(E.unit('necron-lord').options.find((o) => o.id === 'wargear'), lord);
  for (const [n, p] of [['Mindshackle Scarabs', 15], ['Tesseract Labyrinth (generic)', 25], ['Sempiternal Weave', 20]]) {
    const c = names.find((x) => x.name === n);
    assert.deepEqual([c.points, c.house], [p, true], n);
  }
  const woven = model('necron-lord', (s) => { s.options.wargear = 'Sempiternal Weave'; });
  assert.deepEqual([woven.profile.T, woven.profile.W, woven.profile.SAV], [6, 5, '2+']);
  assert.equal(pts('sentry-pylon', (s) => { s.options['teleportation-matrix'] = true; }), 115);
  assert.equal(pts('gauss-pylon', (s) => { s.options['teleportation-matrix'] = true; }), 365);
  assert.ok(model('gauss-pylon').items.includes('Tesla Arc'));
  assert.equal(pts('necron-overlord', (s) => { s.options.voidreaper = 'Voidreaper'; }), 125);
  const two = army(true, [['High Command', sel('necron-overlord')], ['High Command', sel('necron-overlord-on-barge')]]);
  two.detachments[0].slots[0].unit.options.voidreaper = 'Voidreaper';
  two.detachments[0].slots[1].unit.options.voidreaper = 'Voidreaper';
  assert.ok(E.armyIssues(two).some((i) => /Voidreaper may only be taken once per army/.test(i.msg)));
  const both = sel('necron-overlord');
  both.options.voidreaper = 'Voidreaper';
  both.options.melee = 'Warscythe';
  E.setArmy(army(true));
  assert.ok(E.unitIssues(both).some((i) => /can't be combined/.test(i.msg)));
  off();
  assert.ok(!E.choicesFor(E.unit('necron-lord').options.find((o) => o.id === 'wargear'), lord).some((c) => c.name === 'Sempiternal Weave'));
  assert.equal(model('necron-lord', (s) => { s.options.wargear = 'Resurrection Orb'; }).profile.T, 5);
});
