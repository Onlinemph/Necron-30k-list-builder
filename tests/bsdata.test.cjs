// Every army imported from BSData, through the same engine the app uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../js/engine.js');

const load = (file) => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), { window }); return window; };
const index = load('armies.js').ARMY_INDEX.filter((a) => a.group !== 'Xenos (fan codexes)');
const common = load('data-common.js').ARMY_COMMON;

test('BSData armies are listed', () => {
  assert.ok(index.length >= 25, `only ${index.length} armies`);
  assert.ok(index.some((a) => a.name === 'Ultramarines'));
  assert.ok(common.weapons.ranged.length > 300 && common.rules.specialRules.length > 300);
});

for (const a of index) {
  test(`${a.name}: every unit builds, prices and renders`, () => {
    const D = load(`data-${a.id}.js`).ARMY_DATA[a.id];
    D.weapons = { ranged: D.weapons.ranged.concat(common.weapons.ranged), melee: D.weapons.melee.concat(common.weapons.melee) };
    const E = createEngine(D);
    assert.ok(D.units.length > 0);
    for (const u of D.units) {
      const s = E.newSelection(u.id);
      assert.equal(E.unitPoints(s), u.basePoints, `${u.id} points`);
      assert.ok(u.basePoints >= 0, `${u.id} negative points`);
      const rows = E.effectiveModels(s);
      if (!u.size) assert.ok(rows.length > 0, `${u.id} has no models`);
      for (const o of E.optionsOf(s)) assert.ok(E.choicesFor(o, s).length > 0, `${u.id}/${o.id} has no choices`);
      // a fresh unit may only be flagged for picks it must make or a menu-built size
      for (const i of E.unitIssues(s).filter((x) => x.level === 'error')) assert.match(i.msg, /must take|must have between|at least/, `${u.id}: ${i.msg}`);
    }
  });
}

test('Tactical Squad: 100 points, bolters as standard, Sergeant weapon swaps', () => {
  const D = load('data-ultramarines.js').ARMY_DATA.ultramarines;
  const E = createEngine(D);
  const s = E.newSelection('tactical-squad');
  assert.equal(E.unitPoints(s), 100);
  const lo = E.loadout(s).find((r) => r.model === 'Legionary');
  assert.ok(lo.base.includes('Bolter') && lo.base.includes('Bolt pistol'));
  s.counts.Legionary = 19;
  assert.equal(E.unitPoints(s), 200);
  const swap = E.optionsOf(s).find((o) => o.model === 'Sergeant' && o.replaces.includes('Bolter'));
  assert.ok(E.choicesFor(swap, s).some((c) => c.name === 'Power fist'));
});

test('Legion-specific options only appear for their Legion', () => {
  const um = load('data-ultramarines.js').ARMY_DATA.ultramarines.units.find((u) => u.id === 'tactical-squad');
  const ts = load('data-thousand-sons.js').ARMY_DATA['thousand-sons'].units.find((u) => u.id === 'tactical-squad');
  assert.ok(!um.options.some((o) => /prosperine/.test(o.id)));
  assert.ok(ts.options.some((o) => /prosperine/.test(o.id)));
});

test('Rapier Battery scales crew per gun', () => {
  const D = load('data-ultramarines.js').ARMY_DATA.ultramarines;
  const E = createEngine(D);
  const s = E.newSelection('rapier-battery');
  s.counts['Rapier Carrier'] = 3;
  assert.equal(E.modelCounts(s).Legionary, 6);
  assert.equal(E.unitPoints(s), 120);
});

test('Warlord Titan must take exactly two arm weapons', () => {
  const D = load('data-legio-titanicus.js').ARMY_DATA['legio-titanicus'];
  const E = createEngine(D);
  const s = E.newSelection('warlord-titan');
  const arms = E.optionsOf(s).find((o) => o.id === 'warlord-titan-arm-weapons');
  const errs = () => E.unitIssues(s).map((i) => i.msg).join('\n');
  assert.match(errs(), /must take 2 from "Warlord Titan: Arm weapons/);
  s.options[arms.id] = arms.choices.slice(0, 3).map((c) => c.name);
  assert.match(errs(), /at most 2/);
  s.options[arms.id] = arms.choices.slice(0, 2).map((c) => c.name);
  assert.doesNotMatch(errs(), /Arm weapons/);
});

test('BSData name modifiers: (X) values, source Legion prefixes, single-name characters', () => {
  const lord = load('data-daemons.js').ARMY_DATA.daemons.units.find((u) => u.name === 'Lord of Change');
  assert.ok(lord.specialRules.includes('Bulky (7)'));
  const al = load('data-alpha-legion.js').ARMY_DATA['alpha-legion'].units;
  assert.ok(al.some((u) => u.name === 'Dark Angels Inductii Squad'));
  assert.equal(new Set(al.map((u) => u.id)).size, al.length);
  assert.equal(al.find((u) => u.name === 'Alpharius').unique, true);
});
