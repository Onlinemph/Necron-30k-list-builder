// The optional "Legacy" house-rules layer (data/legacy/): nothing changes until a list switches it on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../js/engine.js');

const load = (file) => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), { window }); return window; };
const common = load('data-common.js').ARMY_COMMON;
const legions = load('armies.js').ARMY_INDEX.filter((a) => a.group === 'Legiones Astartes');

function armyOf(id) {
  const D = load(`data-${id}.js`).ARMY_DATA[id];
  D.weapons = { ranged: D.weapons.ranged.concat(common.weapons.ranged), melee: D.weapons.melee.concat(common.weapons.melee) };
  const E = createEngine(D);
  const slots = [];
  for (const d of D.forceorg.primary.slots) for (let i = 0; i < (d.count ?? 1); i++) slots.push({ role: d.role, prime: i < (d.prime || 0) });
  const army = { version: 2, faction: id, name: '', pointsLimit: 3000, sequelae: [], config: { allegiance: ['Traitor'] }, detachments: [E.makeDetachment('primary', 'Crusade Primary Detachment', slots)] };
  return { D, E, army };
}
const slotOf = (army, role, n = 0) => army.detachments[0].slots.filter((s) => s.role === role && !s.unit)[n];
const place = (E, slot, unitId) => { slot.unit = E.newSelection(unitId); return slot.unit; };
const legacyOn = (army, rite) => { army.config['legacy-rules'] = ['Legacy rules']; if (rite) army.config['legacy-rite-of-war'] = [rite]; };

test('every Legion offers the switch and the shared Rites of War', () => {
  for (const a of legions) {
    const D = load(`data-${a.id}.js`).ARMY_DATA[a.id];
    const g = D.armyConfig.groups.find((x) => x.id === 'legacy-rules');
    assert.ok(g && g.legacy, `${a.id} has no Legacy switch`);
    const rites = D.armyConfig.groups.find((x) => x.id === 'legacy-rite-of-war');
    assert.ok(rites.choices.some((c) => c.name === 'Pride of the Legion'), `${a.id} lacks the shared Rites`);
    assert.equal(JSON.stringify(rites.when), JSON.stringify([{ config: 'Legacy rules' }]));
  }
  const sa = load('data-solar-auxilia.js').ARMY_DATA['solar-auxilia'];
  assert.ok(!(sa.armyConfig.groups || []).some((g) => g.id === 'legacy-rite-of-war' && g.choices.some((c) => c.name === 'Pride of the Legion')));
});

test('legacy options stay hidden until Legacy rules is switched on', () => {
  const { E, army } = armyOf('world-eaters');
  const tac = place(E, slotOf(army, 'Troops'), 'tactical-squad');
  E.setArmy(army);
  assert.ok(!E.optionsOf(tac).some((o) => o.legacy));
  legacyOn(army);
  E.setArmy(army);
  const legacy = E.optionsOf(tac).filter((o) => o.legacy);
  assert.ok(legacy.some((o) => /Artificer armour/.test(o.text)));
  assert.ok(legacy.every((o) => o.text.startsWith('Legacy: ')));
});

test('Artificer armour and Veteran Sergeant change the Sergeant only', () => {
  const { E, army } = armyOf('world-eaters');
  legacyOn(army);
  const tac = place(E, slotOf(army, 'Troops'), 'tactical-squad');
  E.setArmy(army);
  const art = E.optionsOf(tac).find((o) => o.legacy && /Artificer/.test(o.text));
  const vet = E.optionsOf(tac).find((o) => o.legacy && /Veteran Sergeant/.test(o.text));
  assert.equal(art.model, 'Sergeant');
  tac.options[art.id] = 'Artificer armour';
  tac.options[vet.id] = 'Veteran Sergeant';
  assert.equal(E.unitPoints(tac), 120);
  const rows = E.effectiveModels(tac);
  const sgt = rows.find((r) => r.model === 'Sergeant');
  const leg = rows.find((r) => r.model === 'Legionary');
  const prof = (r) => r.profile || r.stats;
  assert.equal(prof(sgt).SAV, '2+');
  assert.equal(prof(sgt).WS, 5);
  assert.equal(prof(leg).SAV, '3+');
});

test('World Eaters statlines: Inductii hit harder and shoot worse', () => {
  const { E, army } = armyOf('world-eaters');
  const ind = place(E, slotOf(army, 'Troops'), 'inductii-squad');
  E.setArmy(army);
  const before = E.effectiveModels(ind)[0];
  legacyOn(army);
  E.setArmy(army);
  const after = E.effectiveModels(ind)[0];
  const prof = (r) => r.profile || r.stats;
  assert.equal(prof(after).S, prof(before).S + 1);
  assert.equal(prof(after).BS, prof(before).BS - 1);
});

test('Pride of the Legion: veterans as Troops, no Recon, a Terminator warlord required', () => {
  const { E, army } = armyOf('world-eaters');
  const troops = slotOf(army, 'Troops');
  E.setArmy(army);
  assert.ok(!E.unitsForSlot(troops, army.detachments[0]).some((u) => u.id === 'veteran-tactical-squad'));
  legacyOn(army, 'Pride of the Legion');
  E.setArmy(army);
  assert.ok(E.unitsForSlot(troops, army.detachments[0]).some((u) => u.id === 'cataphractii-terminator-squad'));
  assert.ok(!E.unitsForSlot(slotOf(army, 'Recon') || troops, army.detachments[0]).some((u) => u.role === 'Recon'));
  place(E, troops, 'veteran-tactical-squad');
  assert.ok(E.armyIssues(army).some((i) => /Pride of the Legion: needs at least 1/.test(i.msg)));
  assert.ok(!E.armyIssues(army).some((i) => /Veteran Tactical Squad.*slot/.test(i.msg)));
  const hc = army.detachments[0].slots.find((s) => s.role === 'High Command');
  place(E, hc, 'praetor-in-terminator-armour');
  assert.ok(!E.armyIssues(army).some((i) => /Pride of the Legion/.test(i.msg)));
});

test('The Butcher\'s Due: Red Butchers cost less and need Angron or Kharn', () => {
  const { E, army } = armyOf('world-eaters');
  legacyOn(army, "The Butcher's Due");
  const rb = place(E, slotOf(army, 'Troops'), 'red-butchers');
  E.setArmy(army);
  assert.equal(E.unitPoints(rb), 225);
  assert.ok(E.armyIssues(army).some((i) => /Butcher's Due: needs at least 1/.test(i.msg)));
});
