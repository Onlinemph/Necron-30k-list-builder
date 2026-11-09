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

test('Rangdan squads cost 65 to 80 points a model', () => {
  const squads = data.units.filter((u) => has(u, 'Rangda') && u.models.some((m) => m.max > 1 && /Infantry/.test(m.unitType)));
  assert.deepEqual(squads.map((u) => u.id).sort(), ['hunt-pack', 'rangdan-mimics', 'shadow-lancers']);
  for (const u of squads) {
    const m = u.models[0];
    assert.ok(m.costPerExtra >= 65 && m.costPerExtra <= 80, `${u.id} at ${m.costPerExtra}`);
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
  // every weapon that shares a name with a BSData profile is that profile, modes included
  const theirs = new Map([...common.weapons.ranged, ...common.weapons.melee].map((w) => [w.name, w]));
  const shared = [...data.weapons.ranged, ...data.weapons.melee].filter((w) => theirs.has(w.name));
  assert.ok(shared.length >= 15, `${shared.length} Imperial profiles`);
  const stats = (w) => JSON.stringify(['R', 'FP', 'RS', 'IM', 'AM', 'SM', 'AP', 'D', 'specialRules'].map((k) => w[k]).concat([(w.modes || []).map(stats)]));
  for (const w of shared) assert.equal(stats(w), stats(theirs.get(w.name)), w.name);
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
  for (const u of data.units.filter((x) => has(x, 'Slaugth') && x.models[0].profile.T != null)) assert.ok(rules(sel(u.id)).includes('Worm Gestalt'), u.id);
  assert.match(data.rules.specialRules.find((r) => r.name === 'Worm Gestalt').text, /Feel No Pain \(5\+\).*Flame Trait or the Aflame/s);
});

test('Hunt-Pack wargear: sidearms, hooks, one Severing Maul per three and a Pack-Alpha', () => {
  const h = sel('hunt-pack');
  h.counts = { 'Rangda Hunter': 4 };
  h.options.sidearm = { 'Shadow Blaster': 4 };
  assert.equal(E.unitPoints(h), 4 * 70 + 40);
  assert.ok(E.effectiveModels(h).every((r) => r.items.includes('Shadow Blaster') && !r.items.includes('Shadow Pistol')));
  h.counts = { 'Rangda Hunter': 6 };
  h.options = { maul: { 'Severing Maul': 2 }, melee: { 'Flensing Hooks': 4 } };
  assert.equal(E.optionMax(E.optionsOf(h).find((o) => o.id === 'maul'), h), 2);
  assert.equal(E.unitPoints(h), 6 * 70 + 40);
  assert.deepEqual(errs(h), []);
  h.options.melee = { 'Flensing Hooks': 5 };
  assert.ok(errs(h).some((i) => /more upgrades than models/.test(i.msg)), 'hooks and mauls share the glaives');
  const a = sel('hunt-pack');
  a.options.alpha = 1;
  assert.equal(E.unitPoints(a), 210 + 15);
  const alpha = E.effectiveModels(a).find((r) => r.name === 'Pack-Alpha');
  assert.equal(alpha.count, 1);
  assert.equal(alpha.profile.INV, '4+');
  assert.ok(alpha.items.includes('Shroud-field'));
});

test('Relics of the Hunt and the Fang are once per army', () => {
  const m = sel('rangda-huntmaster');
  const c = sel('collar-wright');
  for (const s of [m, c]) { s.options.fang = 'Fang of the First Xenocide'; s.options.relic = 'Dread-mask'; }
  const det = E.makeDetachment('primary', 'P', [{ role: 'Command' }, { role: 'Command' }]);
  det.slots[0].unit = m;
  det.slots[1].unit = c;
  const msgs = E.armyIssues(army([det])).map((i) => i.msg);
  assert.ok(msgs.some((x) => /Fang of the First Xenocide may only be taken once/.test(x)));
  assert.ok(msgs.some((x) => /Dread-mask may only be taken once/.test(x)));
  c.options = { relic: 'Skin-thief Cloak' };
  assert.ok(!E.armyIssues(army([det])).some((i) => /once per army/.test(i.msg)));
  assert.equal(E.unitPoints(m), 155 + 25 + 10);
});

test('Thralls carry captured Imperial heavy and special weapons, one per ten', () => {
  const t = sel('thrall-cohort');
  t.counts = { Thrall: 30 };
  assert.equal(E.optionMax(E.optionsOf(t).find((o) => o.id === 'heavy'), t), 3);
  t.options.heavy = { Lascannon: 2, Autocannon: 1 };
  assert.equal(E.unitPoints(t), 120 + 10 * 6 + 2 * 15 + 20);
  const x = sel('collared-auxilia');
  assert.equal(E.optionMax(E.optionsOf(x).find((o) => o.id === 'special'), x), 1);
  const r = sel('thrall-armour');
  r.options.turret = 'Turret Mounted Demolisher cannon';
  r.options.sponsons = 'Two Sponson Mounted Lascannons';
  assert.equal(E.unitPoints(r), 130 + 15 + 25);
  assert.ok(E.effectiveModels(r)[0].items.includes('Turret Mounted Demolisher cannon'));
});

test('transports: a Tendril Barge carries four Rangda, Thrall Carriers only Thralls without Bulky, and each goes in its own detachments', () => {
  const cap = (id) => unit(id).models[0].profile.CAPACITY;
  assert.ok(cap('tendril-barge') >= 4 * 3, 'four Bulky (3) Rangda');
  assert.ok(!unit('tendril-barge').specialRules.includes('Light Transport'), 'Light Transport would bar Bulky Rangda');
  assert.ok(unit('thrall-carrier').specialRules.includes('Light Transport'));
  assert.ok(cap('charnel-barge') >= 4 * 2, 'four Bulky (2) Kindred');
  const ids = (detId) => { const d = E.detachmentFromDef(detId); return E.unitsForSlot(d.slots.find((s) => s.role === 'Transport'), d).map((u) => u.id); };
  assert.deepEqual(ids('the-hunt'), ['tendril-barge']);
  assert.deepEqual(ids('the-herd'), ['thrall-carrier']);
  assert.deepEqual(ids('the-carrion-court'), ['charnel-barge']);
  const shoal = E.detachmentFromDef('medusa-shoal');
  assert.deepEqual(E.unitsForSlot(shoal.slots.find((s) => s.role === 'Fast Attack'), shoal).map((u) => u.id).sort(), ['shadow-kite', 'tendril-skiffs']);
  assert.match(E.effectiveModels(sel('shadow-kite'))[0].unitType, /Flyer/);
});

test('the Kindred get one Necrotic Spewer per three', () => {
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
