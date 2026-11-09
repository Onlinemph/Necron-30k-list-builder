// Rangdan house army through the same engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/rangdan.json');
const common = require('../data/bsdata/common.json');
const { createEngine } = require('../js/engine.js');

const E = createEngine(data);
const sel = (id) => E.newSelection(id);
const errs = (s) => E.unitIssues(s).filter((i) => i.level === 'error');
const army = (dets) => ({ pointsLimit: 3000, sequelae: [], config: {}, detachments: dets });
const unit = (id) => data.units.find((u) => u.id === id);
const has = (u, t) => (u.traits || []).includes(t);
const rules = (s) => E.effectiveModels(s)[0].rules;

test('the army has no faction choice', () => {
  assert.equal(data.meta.name, 'Rangdan');
  assert.deepEqual(E.ARKANA, []);
});

test('every unit starts at its base cost with no errors, and every option resolves', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    assert.equal(E.unitPoints(s), u.basePoints, u.id);
    assert.deepEqual(errs(s), [], u.id);
    for (const o of E.optionsOf(s)) assert.ok(E.choicesFor(o, s).length > 0, `${u.id}/${o.id}`);
  }
});

test('Rangdan Weapon Skill: 5 in the ranks, 6 for Command, 7 for High Command', () => {
  const ws = (id) => unit(id).models[0].profile.WS;
  for (const id of ['hunt-pack', 'shadow-lancers', 'rangdan-mimics']) assert.equal(ws(id), 5, id);
  for (const id of ['rangda-huntmaster', 'collar-wright']) assert.equal(ws(id), 6, id);
  assert.equal(ws('hunt-sovereign'), 7);
});

test('Rangdan squads cost 70 to 90 points a model', () => {
  const squads = data.units.filter((u) => has(u, 'Rangda') && u.models.some((m) => m.max > 1 && /Infantry/.test(m.unitType)));
  assert.deepEqual(squads.map((u) => u.id).sort(), ['hunt-pack', 'rangdan-mimics', 'shadow-lancers']);
  for (const u of squads) {
    const m = u.models[0];
    assert.ok(m.costPerExtra >= 70 && m.costPerExtra <= 90, `${u.id} at ${m.costPerExtra}`);
    assert.equal(u.basePoints, m.costPerExtra * m.min, `${u.id} base cost is its minimum models`);
  }
});

test('every Troops unit is a Thrall: the Rangda never hold ground themselves', () => {
  const troops = data.units.filter((u) => u.role === 'Troops');
  assert.ok(troops.length >= 2);
  for (const u of troops) assert.ok(has(u, 'Thrall') && !has(u, 'Rangda'), u.id);
});

test('Thralls are captured Imperial troops with Imperial wargear and Neural Collars', () => {
  for (const u of data.units.filter((x) => has(x, 'Thrall'))) assert.ok(u.specialRules.includes('Neural Collars'), u.id);
  for (const name of ['Lasrifle', 'Battlecannon', 'Heavy bolter', 'Lascannon', 'Bayonet', 'Krak grenades']) {
    const mine = [...data.weapons.ranged, ...data.weapons.melee].find((w) => w.name === name);
    const theirs = [...common.weapons.ranged, ...common.weapons.melee].find((w) => w.name === name);
    for (const k of ['R', 'FP', 'RS', 'IM', 'AM', 'SM', 'AP', 'D']) assert.equal(String(mine[k]), String(theirs[k]), `${name} ${k}`);
  }
});

test('the army rules use modifiers and statuses, never re-rolls', () => {
  const texts = [...data.rules.specialRules, ...data.rules.reactions, ...data.wargear, ...data.grantedPrimeAdvantages,
    ...data.units.flatMap((u) => u.unitRules || [])].map((r) => r.text);
  for (const t of texts) assert.doesNotMatch(t, /re-?roll/i);
  const prey = data.rules.specialRules.find((r) => r.name === 'Prey Instinct').text;
  assert.match(prey, /\+1 to that Wound Test/);
  assert.match(prey, /Pinned, Suppressed, Stunned or Routed/);
});

test('Rangda carry Prey Instinct and Fear (2); Slaugth carry Worm Gestalt, which fire ignores', () => {
  for (const u of data.units.filter((x) => has(x, 'Rangda') && x.models[0].profile.T != null)) {
    const r = rules(sel(u.id));
    assert.ok(r.includes('Prey Instinct') && r.includes('Fear (2)'), u.id);
  }
  for (const u of data.units.filter((x) => has(x, 'Slaugth'))) assert.ok(rules(sel(u.id)).includes('Worm Gestalt'), u.id);
  assert.match(data.rules.specialRules.find((r) => r.name === 'Worm Gestalt').text, /Feel No Pain \(5\+\).*Flame Trait or the Aflame/s);
});

test('Shadow Blaster swaps cost 10 points a model; the Kindred get one Necrotic Spewer per three', () => {
  const h = sel('hunt-pack');
  h.counts = { 'Rangda Hunter': 4 };
  h.options.blaster = { 'Shadow Blaster': 4 };
  assert.equal(E.unitPoints(h), 4 * 70 + 40);
  assert.ok(E.effectiveModels(h).every((r) => r.items.includes('Shadow Blaster') && !r.items.includes('Shadow Pistol')));
  const k = sel('slaugth-kindred');
  k.counts = { Slaugth: 6 };
  const o = E.optionsOf(k).find((x) => x.id === 'spewer');
  assert.equal(E.optionMax(o, k), 2);
});

test('The Hunt takes only Rangda and The Herd only Thralls', () => {
  const hunt = E.detachmentFromDef('the-hunt');
  const herd = E.detachmentFromDef('the-herd');
  const ids = (det, role) => E.unitsForSlot(det.slots.find((s) => s.role === role), det).map((u) => u.id);
  assert.deepEqual(ids(hunt, 'Elites'), ['hunt-pack']);
  assert.deepEqual(ids(herd, 'Troops').sort(), ['collared-auxilia', 'thrall-cohort']);
  assert.deepEqual(ids(herd, 'Armour'), ['thrall-armour']);
  const shoal = E.detachmentFromDef('medusa-shoal');
  assert.deepEqual(ids(shoal, 'Armour'), ['iron-medusa']);
});

test('the Carrion Court needs a Slaugth Dream-Eater in a Command slot and takes only Slaugth', () => {
  const primary = E.makeDetachment('primary', 'P', [{ role: 'High Command' }, { role: 'Command' }]);
  const court = E.detachmentFromDef('the-carrion-court');
  const a = army([primary, court]);
  primary.slots[1].unit = sel('collar-wright');
  assert.ok(E.armyIssues(a).some((i) => /The Carrion Court needs a Slaugth Dream-Eater in a Command slot/.test(i.msg)));
  primary.slots[1].unit = sel('slaugth-dream-eater');
  assert.ok(!E.armyIssues(a).some((i) => /Carrion Court needs/.test(i.msg)));
  const elites = court.slots.find((s) => s.role === 'Elites');
  assert.deepEqual(E.unitsForSlot(elites, court).map((u) => u.id), ['slaugth-kindred']);
  elites.unit = sel('hunt-pack');
  assert.ok(E.armyIssues(a).some((i) => /The Carrion Court's restrictions/.test(i.msg)));
});

test('Prime Advantages go to the right half of the army', () => {
  const advs = (id) => E.primeAdvantagesFor(sel(id), army([]), null).map((a) => a.name);
  assert.ok(advs('hunt-pack').includes('Apex Predators'));
  assert.ok(!advs('thrall-cohort').includes('Apex Predators'));
  assert.ok(!advs('iron-medusa').includes('Apex Predators'), 'vehicles are not Infantry or Paragon');
  assert.ok(advs('thrall-cohort').includes('Collared Legion'));
  assert.ok(!advs('collared-ogryns').includes('Collared Legion'), 'Troops only');
  assert.ok(advs('slaugth-kindred').includes('Sated Gestalt'));
  assert.ok(!advs('vassal-swarm').includes('Sated Gestalt'), 'Vassals have no Carrion Feast');
});

test('a legal 3,000 point list builds without errors', () => {
  const primary = E.makeDetachment('primary', 'Crusade Primary Detachment', [
    { role: 'High Command' }, { role: 'Command', prime: true }, { role: 'Command' }, { role: 'Command' },
    { role: 'Troops', prime: true }, { role: 'Troops' }, { role: 'Troops' }, { role: 'Troops' },
  ]);
  const put = (det, role, s) => { det.slots.find((x) => x.role === role && !x.unit).unit = s; return s; };
  put(primary, 'High Command', sel('hunt-sovereign'));
  put(primary, 'Command', sel('collar-wright'));
  put(primary, 'Command', sel('rangda-huntmaster'));
  put(primary, 'Command', sel('slaugth-dream-eater'));
  put(primary, 'Troops', sel('thrall-cohort'));
  put(primary, 'Troops', sel('thrall-cohort'));
  put(primary, 'Troops', sel('collared-auxilia'));
  const hunt = E.detachmentFromDef('the-hunt');
  put(hunt, 'Elites', sel('hunt-pack'));
  put(hunt, 'Elites', sel('hunt-pack'));
  put(hunt, 'Support', sel('shadow-lancers'));
  put(hunt, 'Recon', sel('rangdan-mimics'));
  const court = E.detachmentFromDef('the-carrion-court');
  put(court, 'Elites', sel('slaugth-kindred'));
  put(court, 'War Engine', sel('slaugth-harvester'));
  const shoal = E.detachmentFromDef('medusa-shoal');
  put(shoal, 'Armour', sel('iron-medusa'));
  const a = army([primary, hunt, court, shoal]);
  const total = E.armyPoints ? E.armyPoints(a) : null;
  if (total != null) assert.ok(total <= 3000, `total ${total}`);
  const bad = E.armyIssues(a).filter((i) => i.level === 'error');
  assert.deepEqual(bad.map((i) => i.msg), []);
});
