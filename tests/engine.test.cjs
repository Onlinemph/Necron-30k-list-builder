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
