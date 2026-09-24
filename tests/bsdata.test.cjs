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

function armyOf(id) {
  const D = load(`data-${id}.js`).ARMY_DATA[id];
  const E = createEngine(D);
  const slots = [];
  for (const d of D.forceorg.primary.slots) for (let i = 0; i < (d.count ?? 1); i++) slots.push({ role: d.role, prime: i < (d.prime || 0) });
  const army = { version: 2, faction: id, name: '', pointsLimit: 3000, sequelae: [], config: {}, detachments: [E.makeDetachment('primary', 'Crusade Primary Detachment', slots)] };
  return { D, E, army };
}
const place = (E, slot, unitId) => { slot.unit = E.newSelection(unitId); return slot.unit; };

test('Legion detachments: Terror Assault takes only Terror Squads in its Troops slots', () => {
  const { D, E, army } = armyOf('night-lords');
  const def = D.detachments.find((d) => d.name === 'Terror Assault');
  assert.ok(def && def.type === 'Auxiliary');
  const det = E.detachmentFromDef(def.id);
  army.detachments.push(det);
  const troops = det.slots.find((s) => s.role === 'Troops');
  assert.equal(E.unitsForSlot(troops, det).map((u) => u.id).join(), 'terror-squad');
  assert.ok(E.unitsForSlot(det.slots.find((s) => s.role === 'Fast Attack'), det).length > 1);
  place(E, troops, 'tactical-squad');
  assert.ok(E.armyIssues(army).some((i) => /restrictions/.test(i.msg)));
});

test('Army configuration: Legion Tactica, Gambit and Advanced Reaction, plus an allegiance to pick', () => {
  const { D, E, army } = armyOf('night-lords');
  const names = D.armyConfig.fixed.map((r) => r.name);
  assert.ok(names.includes('A Talent for Murder') && names.includes('Nostraman Courage') && names.includes('Better Part of Valour'));
  assert.ok(E.armyIssues(army).some((i) => /choose 1 from Allegiance/.test(i.msg)));
  army.config.allegiance = ['Traitor'];
  assert.ok(!E.armyIssues(army).some((i) => /Allegiance/.test(i.msg)));
  const sa = armyOf('solar-auxilia').D.armyConfig.groups.find((g) => g.id === 'cohort-doctrine');
  assert.ok(sa.choices.some((c) => /Solar Pattern/.test(c.name) && /Shock Assault/.test(c.text)));
});

test('Legion Prime Advantages follow the slot: Duty Before Death for Salamanders Troops', () => {
  const { E, army } = armyOf('salamanders');
  const primary = army.detachments[0];
  const troops = primary.slots.find((s) => s.role === 'Troops' && s.prime);
  const command = primary.slots.find((s) => s.role === 'Command' && s.prime);
  const t = place(E, troops, 'tactical-squad');
  const c = place(E, command, 'centurion');
  assert.ok(E.primeAdvantagesFor(t, army, troops).some((a) => a.name === 'Duty Before Death'));
  assert.ok(!E.primeAdvantagesFor(c, army, command).some((a) => a.name === 'Duty Before Death'));
});

test('Clade Operative adds three Support slots that only Assassins fill', () => {
  const { E, army } = armyOf('ultramarines');
  army.config.allegiance = ['Loyalist'];
  const primary = army.detachments[0];
  const slot = primary.slots.find((s) => s.role === 'Troops' && s.prime);
  const sel = place(E, slot, 'tactical-squad');
  assert.ok(E.primeAdvantagesFor(sel, army, slot).some((a) => a.name === 'Clade Operative'));
  army.config.allegiance = ['Traitor'];
  assert.ok(!E.primeAdvantagesFor(sel, army, slot).some((a) => a.name === 'Clade Operative'));
  army.config.allegiance = ['Loyalist'];
  sel.primeAdvantage = 'Clade Operative';
  E.syncAdvisorSlots(primary);
  const extra = primary.slots.filter((s) => s.operative === 'Clade Operative');
  assert.equal(extra.length, 3);
  const ids = E.unitsForSlot(extra[0], primary).map((u) => u.id);
  assert.ok(ids.includes('vindicare-assassin') && !ids.includes('infernus-abomination') && !ids.includes('tactical-squad'));
  assert.ok(!E.unitsForSlot({ role: 'Support' }, primary).some((u) => u.id === 'vindicare-assassin'));
  place(E, extra[0], 'eversor-assassin');
  assert.deepEqual(E.armyIssues(army).filter((i) => /Assassin|operative/i.test(i.msg)), []);
  sel.primeAdvantage = null;
  E.syncAdvisorSlots(primary);
  assert.ok(E.armyIssues(army).some((i) => /Prime Advantage that's gone/.test(i.msg)));
});

test('Allegiance-locked units are flagged', () => {
  const { E, army } = armyOf('emperors-children');
  army.config.allegiance = ['Loyalist'];
  place(E, army.detachments[0].slots.find((s) => s.role === 'Troops'), 'kakophoni-squad');
  assert.ok(E.armyIssues(army).some((i) => /only available to Traitor/.test(i.msg)));
});

test('Mounts change the rider: Mounted Praetor on a Scimitar Jetbike', () => {
  const { E } = armyOf('ultramarines');
  const s = E.newSelection('mounted-praetor');
  const row = () => E.effectiveModels(s)[0];
  assert.ok(row().rules.includes('Bulky (2)') && row().rules.includes('Outflank'));
  const mount = E.optionsOf(s).find((o) => /Mount/.test(o.text));
  s.options[mount.id] = 'Scimitar Jetbike';
  const r = row();
  assert.equal(r.profile.M, 16);
  assert.ok(r.rules.includes('Bulky (3)') && r.rules.includes('Deep Strike') && !r.rules.includes('Outflank'));
  assert.match(r.unitType, /Antigrav/);
});

test('Legion detachments warn when their officer is missing', () => {
  const { D, E, army } = armyOf('ultramarines');
  const def = D.detachments.find((d) => d.name === 'Planetfall Speartip');
  assert.deepEqual([...def.requires], ['Master of Descent']);
  army.detachments.push(E.detachmentFromDef(def.id));
  assert.ok(E.armyIssues(army).some((i) => /requires a Master of Descent/.test(i.msg)));
  place(E, army.detachments[0].slots.find((s) => s.role === 'Command'), 'master-of-descent');
  assert.ok(!E.armyIssues(army).some((i) => /Master of Descent/.test(i.msg)));
});
