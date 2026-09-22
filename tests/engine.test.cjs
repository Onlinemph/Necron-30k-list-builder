// Run with: npm test  (node --test tests/)
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/necrons.json');
const { createEngine, ARKANA } = require('../js/engine.js');

const E = createEngine(data);
const sel = (id) => E.newSelection(id);

test('every unit starts at its base cost with no errors (arkana aside)', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    assert.equal(E.unitPoints(s), u.basePoints, u.id);
    const errs = E.unitIssues(s).filter((i) => !/Crypto-Arkana/.test(i.msg));
    assert.deepEqual(errs, [], u.id);
  }
});

test('every option resolves to at least one choice', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    if (u.cryptoArkana && !u.fixedArkana) s.arkana = 'Chronomancy';
    for (const o of u.options || []) {
      assert.ok(E.choicesFor(o, s).length > 0, `${u.id}/${o.id}`);
    }
  }
});

test('Overlord: Warscythe from the Nobility Melee list costs +15', () => {
  const s = sel('necron-overlord');
  const o = E.unit('necron-overlord').options.find((x) => E.choicesFor(x, s).some((c) => c.name === 'Warscythe'));
  s.options[o.id] = 'Warscythe';
  assert.equal(E.unitPoints(s), 115);
});

test('Royal Warden: extra models and Triarch swaps', () => {
  const s = sel('royal-warden');
  s.counts['Royal Warden'] = 3;
  s.options['swap-triarch'] = 1;
  assert.equal(E.unitPoints(s), 40 + 2 * 40 + 20);
  assert.deepEqual(E.modelCounts(s), { 'Royal Warden': 2, 'Triarch Warden': 1 });
  s.options['swap-triarch'] = 4;
  assert.ok(E.unitIssues(s).some((i) => /too many/.test(i.msg)));
});

test('Macrocytes: one Accelerator per 5 models', () => {
  const s = sel('macrocyte-warriors');
  const acc = E.unit('macrocyte-warriors').options.find((o) => o.kind === 'swapModel' && /Accelerator/.test(o.choices[0].name));
  assert.equal(E.optionMax(acc, s), 1);
  s.counts['Macrocyte Warrior'] = 10;
  assert.equal(E.optionMax(acc, s), 2);
  s.options[acc.id] = 2;
  assert.equal(E.unitPoints(s), 40 + 5 * 8 + 2 * 10);
  assert.equal(E.unitIssues(s).length, 0);
});

test('Cryptek weapon choices follow the chosen arkana', () => {
  const s = sel('cryptek');
  assert.ok(E.unitIssues(s).some((i) => /Crypto-Arkana/.test(i.msg)));
  const weaponOpt = E.unit('cryptek').options.find((o) => o.choices.some((c) => c.list === 'arkana-weapons'));
  assert.equal(E.choicesFor(weaponOpt, s).length, 0);
  for (const a of ARKANA) {
    s.arkana = a;
    assert.ok(E.choicesFor(weaponOpt, s).length >= 2, a);
  }
  s.arkana = 'Chronomancy';
  assert.ok(E.choicesFor(weaponOpt, s).some((c) => c.name === 'Aeonstave'));
});

function armyWith(units, limit = 2000) {
  const slots = units.map(([role, id]) => ({ role }));
  const det = E.makeDetachment('primary', 'Primary', slots);
  units.forEach(([, id], i) => { det.slots[i].unit = sel(id); });
  return { pointsLimit: limit, sequelae: [], detachments: [det] };
}

test('army points and the 25% Warlord/Lord of War cap', () => {
  const low = data.units.find((u) => u.role === 'Lord of War' && u.basePoints >= 500);
  const a = armyWith([['High Command', 'necron-overlord'], ['Lord of War', low.id]], 1000);
  assert.equal(E.armyPoints(a), 100 + low.basePoints);
  assert.ok(E.armyIssues(a).some((i) => /25%/.test(i.msg)));
});

test('named characters are unique', () => {
  const c = data.units.find((u) => u.unique);
  const a = armyWith([[c.role, c.id], [c.role, c.id]], 5000);
  assert.ok(E.armyIssues(a).some((i) => /only be taken once/.test(i.msg)));
});

test('Aeonic Sequelae: one, or two with a Nemesor', () => {
  const a = armyWith([['Command', 'necron-lord']]);
  assert.equal(E.sequelaAllowance(a), 1);
  const b = armyWith([['High Command', 'necron-overlord']]);
  assert.equal(E.sequelaAllowance(b), 2);
  b.sequelae = ['A', 'B', 'C'];
  assert.ok(E.armyIssues(b).some((i) => /Aeonic Sequelae/.test(i.msg)));
});

test('a unit in the wrong slot is flagged', () => {
  const a = armyWith([['Troops', 'necron-overlord']]);
  assert.ok(E.armyIssues(a).some((i) => /is in a Troops slot/.test(i.msg)));
});

test('Dynastic Advisors adds two Crypto-Arkana Command slots', () => {
  const a = armyWith([['High Command', 'necron-overlord']]);
  const det = a.detachments[0];
  const hc = det.slots[0];
  hc.prime = true;
  hc.unit.primeAdvantage = 'Dynastic Advisors';
  E.syncAdvisorSlots(det);
  assert.equal(det.slots[0], hc);
  assert.equal(det.slots.filter((s) => s.advisor).length, 2);
  assert.ok(E.unitsForSlot(det.slots.find((s) => s.advisor)).every((u) => u.cryptoArkana || u.fixedArkana));
  hc.unit.primeAdvantage = null;
  E.syncAdvisorSlots(det);
  assert.equal(det.slots.filter((s) => s.advisor).length, 0);
});

test('detachments from the codex build with the right slot count', () => {
  for (const d of data.detachments) {
    const det = E.detachmentFromDef(d.id);
    assert.equal(det.slots.length, d.slots.length, d.id);
  }
});

test('weapon keys strip counts and mounts', () => {
  const { wkey } = require('../js/engine.js');
  assert.equal(wkey('2 Gauss Slicers'), wkey('Gauss Slicer'));
  assert.equal(wkey('Hull (left) mounted Gauss Flayer Array'), wkey('Gauss Flayer Array'));
});

test('Dark Harvest lets Necron Warriors go to 30 models', () => {
  const s = sel('necron-warriors');
  s.counts['Necron Warrior'] = 25;
  E.setSequelae([]);
  assert.ok(E.unitIssues(s).some((i) => /at most/.test(i.msg)));
  E.setSequelae(['Dark Harvest']);
  assert.deepEqual(E.unitIssues(s), []);
  assert.ok(E.optionsOf(s).some((o) => o.id === 'sq-flensing-scarabs'));
  E.setSequelae([]);
});

test('Servants of the Ankh adds Rod of Covenant to Nobility Melee', () => {
  const s = sel('necron-lord');
  const o = E.unit('necron-lord').options.find((x) => x.choices.some((c) => c.list === 'nobility-melee'));
  E.setSequelae([]);
  const before = E.choicesFor(o, s).some((c) => c.name === 'Rod of Covenant');
  E.setSequelae(['Servants of the Ankh']);
  assert.ok(E.choicesFor(o, s).some((c) => c.name === 'Rod of Covenant' && c.points === 10));
  assert.equal(before, false);
  E.setSequelae([]);
});

test('Royal Burial Site Nemesor upgrade unlocks a second Sequela', () => {
  const a = armyWith([['Command', 'necron-lord']]);
  a.sequelae = ['Royal Burial Site'];
  E.setSequelae(a.sequelae);
  assert.equal(E.sequelaAllowance(a), 1);
  a.detachments[0].slots[0].unit.options['sq-royal-nemesor'] = true;
  assert.equal(E.sequelaAllowance(a), 2);
  assert.equal(E.armyPoints(a), 85);
});

test('Cult of Annihilation lets one Destroyer Lord fill High Command', () => {
  const a = armyWith([['High Command', 'destroyer-lord-lokhust-frame']]);
  assert.ok(E.armyIssues(a).some((i) => /High Command slot/.test(i.msg)));
  a.sequelae = ['Cult of Annihilation'];
  assert.ok(!E.armyIssues(a).some((i) => /High Command slot/.test(i.msg)));
  assert.equal(E.sequelaAllowance(a), 2); // gains the Nemesor Trait
});

test('Horrors of Old restricts the unit list', () => {
  const a = armyWith([['High Command', 'necron-overlord'], ['Command', 'cryptek']]);
  a.sequelae = ['Horrors of Old'];
  const msgs = E.armyIssues(a).map((i) => i.msg);
  assert.ok(msgs.some((m) => /Cryptek can't be taken with Horrors of Old/.test(m)));
  assert.ok(!msgs.some((m) => /Overlord can't/.test(m)));
  E.setSequelae([]);
});

test('detachment restrictions limit the unit picker and are checked', () => {
  const det = E.detachmentFromDef('canoptek-phalanx');
  const recon = det.slots.find((s) => s.role === 'Recon');
  const names = E.unitsForSlot(recon, det).map((u) => u.id);
  assert.ok(names.includes('canoptek-scarabs'));
  assert.ok(!names.includes('deathmarks'));
  recon.unit = sel('deathmarks');
  const a = { pointsLimit: 3000, sequelae: [], detachments: [E.makeDetachment('primary', 'P', []), det] };
  assert.ok(E.armyIssues(a).some((i) => /restrictions/.test(i.msg)));
});

// ---------- battlefield modifiers ----------
const row = (s, name) => E.effectiveModels(s).find((r) => !name || r.model === name);

test('Horrors of Old: Warriors get a 3+ save and lose Endless Legions', () => {
  const s = sel('necron-warriors');
  E.setSequelae([]);
  assert.equal(row(s).profile.SAV, '4+');
  E.setSequelae(['Horrors of Old']);
  const r = row(s);
  assert.equal(r.profile.SAV, '3+');
  assert.ok(r.changed.SAV);
  assert.ok(!r.rules.some((x) => /Endless Legions/.test(x)));
  assert.ok(r.removed.includes('Endless Legions'));
  E.setSequelae([]);
});

test('Engrammatic Soldiers adds +2 Cool', () => {
  const s = sel('necron-warriors');
  const base = row(s).profile.CL;
  s.primeAdvantage = 'Engrammatic Soldiers';
  assert.equal(row(s).profile.CL, base + 2);
});

test('Charnel Displays: Fear (1) and -1 BS', () => {
  const s = sel('immortals');
  E.setSequelae(['Mark of the Flayer']);
  const base = row(s).profile.BS;
  s.options['sq-charnel-displays'] = true;
  const r = row(s);
  assert.equal(r.profile.BS, base - 1);
  assert.ok(r.rules.includes('Fear (1)'));
  E.setSequelae([]);
});

test('Cryptek: Chronomancy grants Phasing; Timesplinter Mantle gives a 4+ invulnerable save', () => {
  const s = sel('cryptek');
  s.arkana = 'Chronomancy';
  assert.ok(row(s).traits.includes('Phasing'));
  const o = E.unit('cryptek').options.find((x) => x.choices.some((c) => c.list === 'techno-arkana'));
  s.options[o.id] = 'Timesplinter Mantle';
  assert.equal(row(s).profile.INV, '4+');
});

test('Cryptek: Technomancy improves Battlesmith, Canoptek Cloak sets M16 and Antigrav', () => {
  const s = sel('cryptek');
  s.arkana = 'Technomancy';
  assert.ok(row(s).rules.includes('Battlesmith (3)'));
  const o = E.unit('cryptek').options.find((x) => x.choices.some((c) => c.list === 'techno-arkana'));
  s.options[o.id] = 'Canoptek Cloak';
  const r = row(s);
  assert.equal(r.profile.M, 16);
  assert.match(r.unitType, /Antigrav/);
  assert.ok(r.rules.includes('Battlesmith (4)'));
});

test('Arkanic Destroyer Frame and its Hovering option', () => {
  const s = sel('cryptek');
  s.arkana = 'Plasmancy';
  s.options['any-of'] = ['Arkanic Destroyer Frame'];
  let r = row(s);
  assert.ok(r.rules.includes('Bulky (3)'));
  assert.ok(r.traits.includes('Destroyer'));
  s.options['frame-config'] = 'Frame: Hovering (Cavalry, M12)';
  r = row(s);
  assert.equal(r.profile.M, 12);
  assert.match(r.unitType, /^Cavalry/);
  assert.equal(E.unitPoints(s), 75 + 15 + 10);
  s.options['any-of'] = [];
  assert.ok(E.unitIssues(s).some((i) => /needs another option/.test(i.msg)));
});

test('Pyrrhian Eternals needs Anrakyr and gives +1 A', () => {
  const a = armyWith([['Troops', 'immortals']]);
  const s = a.detachments[0].slots[0].unit;
  assert.ok(!E.primeAdvantagesFor(s, a).some((x) => x.name === 'Pyrrhian Eternals'));
  const b = armyWith([['Troops', 'immortals'], ['Command', 'anrakyr-the-traveller']], 3000);
  const t = b.detachments[0].slots[0].unit;
  assert.ok(E.primeAdvantagesFor(t, b).some((x) => x.name === 'Pyrrhian Eternals'));
  const base = row(t).profile.A;
  t.primeAdvantage = 'Pyrrhian Eternals';
  assert.equal(row(t).profile.A, base + 1);
  assert.ok(E.effectiveModels(t)[0].reminders.some((r) => /Anrakyr/.test(r.condition)));
});

test('conditional effects are reminders, not stat changes', () => {
  const s = sel('royal-warden');
  E.setSequelae(['Royal Burial Site']);
  const r = row(s);
  assert.equal(r.profile.WS, r.baseProfile.WS);
  assert.ok(r.reminders.length > 0);
  E.setSequelae([]);
});
