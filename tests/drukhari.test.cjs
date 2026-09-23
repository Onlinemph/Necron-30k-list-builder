// Drukhari army data through the same engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/drukhari.json');
const { createEngine } = require('../js/engine.js');

const E = createEngine(data);
const sel = (id) => { const s = E.newSelection(id); if (s.arkana === null) s.arkana = 'Kabals'; return s; };
const errs = (s) => E.unitIssues(s).filter((i) => i.level === 'error');

test('Partisan is the faction choice', () => {
  assert.equal(E.choiceLabel, 'Partisan');
  assert.deepEqual(E.ARKANA, ['Kabals', 'Cults', 'Covens']);
});

test('every unit starts at its base cost; only required picks and unit size are flagged', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    assert.equal(E.unitPoints(s), u.basePoints, u.id);
    for (const i of errs(s)) assert.match(i.msg, /must take|must have between/, `${u.id}: ${i.msg}`);
  }
});

test('every option resolves to at least one choice', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    for (const o of E.optionsOf(s)) assert.ok(E.choicesFor(o, s).length > 0, `${u.id}/${o.id}`);
  }
});

test('Combat Drugs: required, and the drug raises the stat', () => {
  const s = sel('cult-wyches');
  assert.ok(errs(s).some((i) => /must take/.test(i.msg)));
  const base = E.effectiveModels(s)[0].profile.A;
  s.options['combat-drugs'] = 'Adrenalight';
  assert.deepEqual(errs(s), []);
  const r = E.effectiveModels(s);
  assert.ok(r.every((m) => m.profile.A === m.baseProfile.A + 1));
  assert.equal(r[0].profile.A, base + 1);
});

test('Kabal Archon: the drug pick is required once the upgrade is bought', () => {
  const s = sel('kabal-archon');
  assert.deepEqual(errs(s), []);
  s.options['combat-drugs'] = true;
  assert.equal(E.unitPoints(s), 95);
  assert.ok(errs(s).some((i) => /must take/.test(i.msg)));
  s.options['combat-drug-choice'] = 'Hypex';
  assert.deepEqual(errs(s), []);
});

test('Court of the Archon: 1 to 12 models from the menu', () => {
  const s = sel('court-of-the-archon');
  assert.ok(errs(s).some((i) => /between 1 and 12/.test(i.msg)));
  s.counts['Incubus Bodyguard'] = 3;
  s.counts['Sslyth'] = 1;
  assert.equal(E.unitPoints(s), 3 * 20 + 25);
  assert.deepEqual(errs(s), []);
  s.counts['Tortured Prisoner'] = 9;
  assert.ok(errs(s).some((i) => /between 1 and 12/.test(i.msg)));
});

test('Cult Beast Pack: one Beastmaster per 4 models', () => {
  const s = sel('cult-beast-pack');
  s.counts['Khymerae'] = 3;
  s.counts['Beastmaster'] = 2;
  assert.ok(errs(s).some((i) => /for every 4 models/.test(i.msg)));
  s.counts['Khymerae'] = 6;
  assert.ok(!errs(s).some((i) => /for every 4 models/.test(i.msg)));
});

test('Haemonculus Arcana items are once per army', () => {
  const det = E.makeDetachment('primary', 'P', [{ role: 'Command' }, { role: 'Command' }]);
  for (const slot of det.slots) { slot.unit = sel('coven-haemonculus'); slot.unit.options.arcana = 'Dark Gate'; }
  const a = { pointsLimit: 3000, sequelae: [], detachments: [det] };
  assert.ok(E.armyIssues(a).some((i) => /Dark Gate may only be taken once/.test(i.msg)));
});

test('Kabalite Strike Force needs a Kabals Command unit and takes only Kabals', () => {
  const primary = E.makeDetachment('primary', 'P', [{ role: 'Command' }]);
  const ksf = E.detachmentFromDef('kabalite-strike-force');
  const a = { pointsLimit: 3000, sequelae: [], detachments: [primary, ksf] };
  assert.ok(E.armyIssues(a).some((i) => /Kabalite Strike Force is unlocked by a Kabals/.test(i.msg)));
  primary.slots[0].unit = sel('kabal-dracon');
  assert.ok(!E.armyIssues(a).some((i) => /Kabalite Strike Force is unlocked/.test(i.msg)));
  const elites = ksf.slots.find((s) => s.role === 'Elites');
  const ids = E.unitsForSlot(elites, ksf).map((u) => u.id);
  assert.ok(ids.includes('kabalite-trueborn'));
  assert.ok(!ids.includes('cult-bloodbrides'));
});
