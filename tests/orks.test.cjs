// Orks army data through the same engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/orks.json');
const { createEngine } = require('../js/engine.js');

const E = createEngine(data);
const sel = (id) => { const s = E.newSelection(id); if (s.arkana === null) s.arkana = 'Goffs'; return s; };
const errs = (s) => E.unitIssues(s).filter((i) => i.level === 'error');

test('the Great Clan is the faction choice', () => {
  assert.equal(E.choiceLabel, 'Great Clan');
  assert.ok(E.ARKANA.includes('Evil Sunz'));
  const s = E.newSelection('slugga-boyz-mob');
  assert.ok(E.unitIssues(s).some((i) => /choose a Great Clan/.test(i.msg)));
});

test('every unit starts at its base cost; only "must take" options are flagged', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    assert.equal(E.unitPoints(s), u.basePoints, u.id);
    for (const i of errs(s)) assert.match(i.msg, /must take/, `${u.id}: ${i.msg}`);
  }
});

test('every option resolves to at least one choice', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    for (const o of E.optionsOf(s)) assert.ok(E.choicesFor(o, s).length > 0, `${u.id}/${o.id}`);
  }
});

test('Slugga Boyz: size, Nob swap and special weapons', () => {
  const s = sel('slugga-boyz-mob');
  s.counts['Slugga Boy'] = 20;
  assert.equal(E.unitPoints(s), 60 + 10 * 5);
  const nob = E.unit('slugga-boyz-mob').options.find((o) => o.kind === 'swapModel');
  s.options[nob.id] = 1;
  assert.equal(E.unitPoints(s), 60 + 50 + 10);
  assert.deepEqual(errs(s), []);
});

test('Deff Dread: ranged picks depend on the klaw choice', () => {
  const s = sel('deff-dread');
  assert.ok(errs(s).some((i) => /must take/.test(i.msg)));
  s.options['deff-dread-klaws'] = 'Paired dread klaws';
  assert.ok(errs(s).some((i) => /must take 2/.test(i.msg)));
  s.options['deff-dread-ranged-weapons-paired'] = { 'Big shoota': 2 };
  assert.deepEqual(errs(s), []);
  s.options['deff-dread-klaws'] = "Lots o' dread klaws";
  assert.ok(errs(s).some((i) => /needs another option/.test(i.msg)));
});

test('Mega-dread: two weapons or a paired option, not both', () => {
  const s = sel('mega-dread');
  s.options['mega-dread-paired'] = 'Paired mega killsaws';
  assert.deepEqual(errs(s), []);
  s.options['mega-dread-two-weapons'] = { 'Killkannon': 1 };
  assert.ok(errs(s).some((i) => /can't be combined/.test(i.msg)));
});

test('Big Gunz Battery scales crews per gun', () => {
  const s = sel('big-gunz-battery');
  s.counts['Big Gun Carrier'] = 3;
  assert.equal(E.modelCounts(s)['Gretchin Gunner'], 6);
  const extra = E.unit('big-gunz-battery').options.find((o) => o.id === 'big-gun-extra-gunners');
  assert.equal(E.optionMax(extra, s), 9);
  s.counts['Runtherd'] = 4;
  assert.ok(errs(s).some((i) => /per Big Gun Carrier/.test(i.msg)));
});

test('Snakebites unlock Cyboars on warbikes only', () => {
  const s = sel('ork-warboss');
  s.arkana = 'Snakebites';
  const cyb = E.optionsOf(s).find((o) => o.id === 'clan-cyboar');
  assert.ok(cyb);
  assert.equal(E.optionMax(cyb, s), 0); // on foot
  s.arkana = 'Goffs';
  assert.ok(!E.optionsOf(s).some((o) => o.id === 'clan-cyboar'));
});

test('Auxiliary Detachments must share one clan (Freebooters aside)', () => {
  const det = E.detachmentFromDef('green-tide');
  const troops = det.slots.filter((s) => s.role === 'Troops');
  troops[0].unit = sel('slugga-boyz-mob'); troops[0].unit.arkana = 'Goffs';
  troops[1].unit = sel('shoota-boyz-mob'); troops[1].unit.arkana = 'Bad Moons';
  const a = { pointsLimit: 3000, sequelae: [], detachments: [E.makeDetachment('primary', 'P', []), det] };
  assert.ok(E.armyIssues(a).some((i) => /share one Great Clan/.test(i.msg)));
  troops[1].unit.arkana = 'Freebooters';
  assert.ok(!E.armyIssues(a).some((i) => /share one Great Clan/.test(i.msg)));
});
