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

test('Detachments unlocked by an officer: Tip of the Spear for Planetfall Speartip', () => {
  const { D, E, army } = armyOf('ultramarines');
  const def = D.detachments.find((d) => d.name === 'Planetfall Speartip');
  assert.equal(def.unlockRule.rule, 'Tip of the Spear');
  assert.ok(def.rules.some((r) => r.name === 'Tip of the Spear' && /Primary Detachment/.test(r.text)));
  army.detachments.push(E.detachmentFromDef(def.id));
  assert.ok(E.armyIssues(army).some((i) => /needs a model with Tip of the Spear in the Primary Detachment/.test(i.msg)));
  place(E, army.detachments[0].slots.find((s) => s.role === 'Command'), 'master-of-descent');
  assert.ok(!E.armyIssues(army).some((i) => /Tip of the Spear/.test(i.msg)));
  army.detachments.push(E.detachmentFromDef(def.id));
  assert.ok(E.armyIssues(army).some((i) => /Planetfall Speartip can only be taken once/.test(i.msg)));
});

test('Detachment requirements can be met by the army configuration (Iron Tercio)', () => {
  const { D, E, army } = armyOf('solar-auxilia');
  const def = D.detachments.find((d) => d.name === 'Iron Tercio');
  army.detachments.push(E.detachmentFromDef(def.id));
  assert.ok(E.armyIssues(army).some((i) => /Iron Tercio requires/.test(i.msg)));
  army.config['cohort-doctrine'] = ['Cohort Doctrine: Iron Pattern Cohort'];
  assert.ok(!E.armyIssues(army).some((i) => /Iron Tercio requires/.test(i.msg)));
});

test('Units carry the book their page number refers to', () => {
  const u = armyOf('blood-angels').D.units.find((x) => x.name === 'Crimson Paladins');
  assert.equal(u.book, 'Liber Astartes');
  assert.equal(u.page, 218);
});

test('Army configuration keeps nested choices and fixed rules apart', () => {
  const cus = armyOf('legio-custodes').D.armyConfig;
  assert.ok(cus.fixed.some((r) => r.name === "Heaven's Strike") && !cus.groups.some((g) => /Tactica/.test(g.name)));
  const sl = armyOf('shattered-legions').D.armyConfig.groups.find((g) => g.name === 'Legions chosen');
  assert.equal(sl.choices.length, 18);
  assert.equal(sl.min, 2);
  assert.equal(sl.max, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(sl.maxWhen)), [{ when: { config: 'Three Legions' }, max: 3 }]);
});

test('Config limits: a second Provenance needs a Force Commander; a Cohort Doctrine is compulsory', () => {
  const { D, E, army } = armyOf('imperialis-militia');
  army.config.allegiance = ['Loyalist'];
  const prov = D.armyConfig.groups.find((g) => g.name === 'Provenances of War');
  army.config[prov.id] = [prov.choices[0].name, prov.choices[1].name];
  assert.ok(E.armyIssues(army).some((i) => /at most 1 from Provenances of War/.test(i.msg)));
  place(E, army.detachments[0].slots.find((s) => s.role === 'High Command'), 'force-commander');
  assert.ok(!E.armyIssues(army).some((i) => /Provenances of War/.test(i.msg)));
  const sa = armyOf('solar-auxilia');
  sa.army.config.allegiance = ['Loyalist'];
  assert.ok(sa.E.armyIssues(sa.army).some((i) => /choose 1 from Cohort Doctrine/.test(i.msg)));
});

test('Oaths of Moment change units: The Weapons of Desperation swaps the Sergeant options', () => {
  const { D, E, army } = armyOf('blackshields');
  const s = place(E, army.detachments[0].slots.find((x) => x.role === 'Troops'), 'tactical-squad');
  E.setArmy(army);
  const ids = () => E.optionsOf(s).map((o) => o.id);
  assert.ok(ids().includes('sergeant-may-exchange-bolter-for'));
  const oaths = D.armyConfig.groups.find((g) => g.name === 'Oaths of Moment');
  army.config[oaths.id] = ['The Weapons of Desperation'];
  E.setArmy(army);
  assert.ok(!ids().includes('sergeant-may-exchange-bolter-for'));
  assert.ok(ids().some((i) => /weapons-of-desperation/.test(i)));
  // Panoply of Old brings its own Legion choice
  const legion = D.armyConfig.groups.find((g) => g.when && g.when[0].config === 'Panoply of Old');
  assert.ok(legion && !E.available(legion));
  army.config[oaths.id] = ['Panoply of Old'];
  E.setArmy(army);
  assert.ok(E.available(legion));
});

test('Solar Auxilia: a Legiones Auxilia designation takes away an Advanced Reaction', () => {
  const { D, E, army } = armyOf('solar-auxilia');
  const fire = D.armyConfig.fixed.find((r) => r.name === 'Fire Support!');
  E.setArmy(army);
  assert.ok(E.available(fire));
  army.config['legiones-auxilia-designation'] = ['Archite Palatines'];
  E.setArmy(army);
  assert.ok(!E.available(fire));
});

test('Rewards of Treachery: other Legions units only fill the slot the advantage adds', () => {
  const { E, army } = armyOf('alpha-legion');
  army.config.allegiance = ['Traitor'];
  const primary = army.detachments[0];
  const cmd = primary.slots.find((s) => s.role === 'Command' && s.prime);
  assert.ok(!E.unitsForSlot(primary.slots.find((s) => s.role === 'Command' && !s.prime), primary).some((u) => u.operative));
  const sel = place(E, cmd, 'centurion');
  assert.ok(E.primeAdvantagesFor(sel, army, cmd).some((a) => a.name === 'Rewards of Treachery'));
  sel.primeAdvantage = 'Rewards of Treachery';
  E.syncAdvisorSlots(primary);
  assert.ok(E.armyIssues(army).some((i) => /choose the Battlefield Role/.test(i.msg)));
  sel.logisticalRole = 'Retinue';
  E.syncAdvisorSlots(primary);
  const extra = primary.slots.find((s) => s.operative === 'Rewards of Treachery');
  assert.equal(extra.role, 'Retinue');
  const ids = E.unitsForSlot(extra, primary).map((u) => u.id);
  assert.ok(ids.includes('deathwing-companion-detachment') && !ids.includes('command-squad'));
});

test('Mechanicum: The Heart of Power needs an Archimandrite in High Command', () => {
  const { D, E, army } = armyOf('mechanicum');
  army.config.allegiance = ['Loyalist'];
  army.detachments.push(E.detachmentFromDef(D.detachments.find((d) => d.name === 'The Heart of Power').id));
  assert.ok(E.armyIssues(army).some((i) => /The Heart of Power needs a High Command model with Archimandrite/.test(i.msg)));
  const hc = place(E, army.detachments[0].slots.find((s) => s.role === 'High Command'), 'archmagos');
  const sub = E.optionsOf(hc).find((o) => o.choices.some((c) => c.name === 'Archimandrite'));
  hc.options[sub.id] = 'Archimandrite';
  assert.ok(!E.armyIssues(army).some((i) => /Heart of Power needs/.test(i.msg)));
});

test('Tank Commander detachments appear with a Tank Commander in the army', () => {
  const { D, E, army } = armyOf('ultramarines');
  const def = D.detachments.find((d) => d.name === 'Tank Commander Armoured Support');
  assert.ok(def && def.when);
  army.detachments.push(E.detachmentFromDef(def.id));
  assert.ok(E.armyIssues(army).some((i) => /Tank Commander Armoured Support needs a Tank Commander/.test(i.msg)));
  place(E, army.detachments[0].slots.find((s) => s.role === 'High Command'), 'spartan-prometheus-command-tank');
  assert.ok(!E.armyIssues(army).some((i) => /Armoured Support needs/.test(i.msg)));
});

test('Questoris Familia uses its own chart: four Prime Lord of War slots and Additional detachments', () => {
  const { D, E, army } = armyOf('questoris-familia');
  assert.equal(D.forceorg.primary.slots.length, 4);
  army.config.allegiance = ['Loyalist'];
  const primary = army.detachments[0];
  const slot = primary.slots[0];
  assert.ok(slot.prime && slot.role === 'Lord of War');
  assert.ok(E.unitsForSlot(slot, primary).some((u) => u.id === 'knight-questoris'));
  const sel = place(E, slot, 'knight-questoris');
  const advs = E.primeAdvantagesFor(sel, army, slot).map((a) => a.name);
  assert.ok(advs.includes('Scion Aspirant') && !advs.includes('Master Sergeant'));
  army.detachments.push(E.detachmentFromDef(D.detachments.find((d) => d.name === 'Armiger Talon').id));
  assert.ok(E.armyIssues(army).some((i) => /Armiger Talon: 1 taken, 0 allowed/.test(i.msg)));
  sel.primeAdvantage = 'Scion Aspirant';
  assert.ok(!E.armyIssues(army).some((i) => /Armiger Talon/.test(i.msg)));
  // the Yeomanry Mesnie takes Solar Auxilia and Militia units, and nothing else does
  const yeo = E.detachmentFromDef(D.detachments.find((d) => d.name === 'Yeomanry Mesnie').id);
  army.detachments.push(yeo);
  const troops = yeo.slots.find((s) => s.role === 'Troops');
  assert.ok(E.unitsForSlot(troops, yeo).some((u) => u.id === 'solar-auxilia-lasrifle-section'));
  assert.ok(!E.unitsForSlot(slot, primary).some((u) => /^(solar-auxilia|imperialis-militia)-/.test(u.id)));
});

test('Mechanicum has its own Prime Advantages; Legions no longer borrow them', () => {
  const mech = armyOf('mechanicum').D.grantedPrimeAdvantages.map((a) => a.name);
  assert.ok(mech.includes('Paragon of Metal') && mech.includes('Thallaxi Principe') && !mech.includes('Battlefield Orphans'));
  const um = armyOf('ultramarines').D.grantedPrimeAdvantages.map((a) => a.name);
  assert.ok(!um.includes('Paragon of Metal'));
});

test('Allies: Solar Auxilia in an Ultramarines list', () => {
  const { mergeAlly } = require('../js/engine.js');
  const D = load('data-ultramarines.js').ARMY_DATA.ultramarines;
  mergeAlly(D, load('data-solar-auxilia.js').ARMY_DATA['solar-auxilia'], 'solar-auxilia');
  const E = createEngine(D);
  const slots = [];
  for (const d of D.forceorg.primary.slots) for (let i = 0; i < (d.count ?? 1); i++) slots.push({ role: d.role, prime: i < (d.prime || 0) });
  const army = { version: 2, faction: 'ultramarines', name: '', pointsLimit: 3000, sequelae: [], config: { allegiance: ['Loyalist'] }, detachments: [E.makeDetachment('primary', 'Crusade Primary Detachment', slots)] };
  const allied = E.detachmentFromDef('solar-auxilia:bs-allied-detachment');
  army.detachments.push(allied);
  assert.equal(allied.ally, 'solar-auxilia');
  assert.match(allied.name, /Solar Auxilia/);
  const cmd = allied.slots.find((s) => s.role === 'Command');
  const ids = E.unitsForSlot(cmd, allied).map((u) => u.id);
  assert.ok(ids.length && ids.every((id) => id.startsWith('solar-auxilia:')));
  assert.ok(!E.unitsForSlot(army.detachments[0].slots.find((s) => s.role === 'Command'), army.detachments[0]).some((u) => u.ally));
  // allied Auxiliary Detachments come from the allied Command slots
  army.detachments.push(E.detachmentFromDef('core-armoured-fist', { ally: 'solar-auxilia' }));
  assert.ok(E.armyIssues(army).some((i) => /allied Solar Auxilia Auxiliary Detachment/.test(i.msg)));
  cmd.unit = E.newSelection(ids.find((id) => /command-section/.test(id)) || ids[0]);
  assert.ok(!E.armyIssues(army).some((i) => /allied Solar Auxilia Auxiliary/.test(i.msg)));
  assert.ok(!E.armyIssues(army).some((i) => /Auxiliary Detachment, but only 0 unlocked/.test(i.msg)));
});

test('Mechanicum advantages follow their traits: Paragon of Metal for Cybernetica Automata', () => {
  const { E, army } = armyOf('mechanicum');
  army.config.allegiance = ['Loyalist'];
  const troops = army.detachments[0].slots.find((s) => s.role === 'Troops' && s.prime);
  troops.role = 'Support';
  const cast = place(E, troops, 'castellax-battle-maniple');
  assert.ok(E.primeAdvantagesFor(cast, army, troops).some((a) => a.name === 'Paragon of Metal'));
  const cmd = army.detachments[0].slots.find((s) => s.role === 'Command' && s.prime);
  const magos = place(E, cmd, 'magos');
  assert.ok(!E.primeAdvantagesFor(magos, army, cmd).some((a) => a.name === 'Paragon of Metal'));
});
