// Harlequins army data through the same engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/harlequins.json');
const { createEngine } = require('../js/engine.js');

const E = createEngine(data);
const sel = (id, masque = 'Frozen Stars') => { const s = E.newSelection(id); if (s.arkana === null) s.arkana = masque; return s; };
const errs = (s) => E.unitIssues(s).filter((i) => i.level === 'error');
const army = (dets) => ({ pointsLimit: 3000, sequelae: [], config: {}, detachments: dets });
const rules = (s) => E.effectiveModels(s)[0].rules;

test('Masque is the faction choice', () => {
  assert.equal(E.choiceLabel, 'Masque');
  assert.deepEqual(E.ARKANA, ['Frozen Stars', 'Midnight Sorrow', 'Veiled Path', 'Silent Shroud', 'Soaring Spite', 'Dreaming Shadow']);
  for (const m of E.ARKANA) assert.ok(data.arkana.some((a) => a.name === m && a.harbinger.text), m);
});

test('every unit starts at its base cost with no errors once a Masque is chosen', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    assert.equal(E.unitPoints(s), u.basePoints, u.id);
    assert.deepEqual(errs(s), [], u.id);
  }
});

test('every option resolves to at least one choice', () => {
  for (const u of data.units) {
    const s = sel(u.id);
    for (const o of E.optionsOf(s)) assert.ok(E.choicesFor(o, s).length > 0, `${u.id}/${o.id}`);
  }
});

test('a Masque must be chosen, except for the Solitaire and fixed characters', () => {
  const s = E.newSelection('harlequin-troupe');
  assert.ok(errs(s).some((i) => /choose a Masque/.test(i.msg)));
  assert.deepEqual(errs(E.newSelection('solitaire')), []);
  assert.equal(E.arkanaOf(E.newSelection('sylandri-veilwalker')), 'Veiled Path');
});

test('Masque rules change the datasheet', () => {
  assert.ok(rules(sel('harlequin-troupe', 'Frozen Stars')).includes('Impact (S)'));
  assert.ok(!rules(sel('starweaver', 'Frozen Stars')).includes('Impact (S)'));
  assert.equal(E.effectiveModels(sel('skyweavers', 'Soaring Spite'))[0].profile.M, 20);
  assert.ok(rules(sel('harlequin-troupe', 'Silent Shroud')).includes('Fear (1)'));
  assert.ok(rules(sel('mimes', 'Silent Shroud')).includes('Fear (2)'));
  const ds = E.effectiveModels(sel('harlequin-troupe', 'Dreaming Shadow'))[0];
  assert.ok(ds.rules.includes('Feel No Pain (6+)'));
  assert.equal(ds.profile.CL, ds.baseProfile.CL - 1);
  // Veiled Path's veil lapses after shooting, so it's a reminder rather than a fixed rule
  const vp = E.effectiveModels(sel('harlequin-troupe', 'Veiled Path'))[0];
  assert.ok(!vp.rules.includes('Shrouded (5+)'));
  assert.ok(vp.reminders.some((r) => /Shrouded \(5\+\)/.test(r.text)));
});

test('wargear: holo-fields, the Solitaire\'s Impossible Form and the Enigmas', () => {
  assert.equal(E.effectiveModels(sel('voidweaver'))[0].profile.INV, '5+');
  assert.equal(E.effectiveModels(sel('solitaire'))[0].profile.INV, '3+');
  const s = sel('great-harlequin');
  s.options.enigma = 'Starmist Raiment';
  // only after a Rush, as in 7th edition, so it's a reminder
  assert.equal(E.effectiveModels(s)[0].profile.INV, '4+');
  assert.ok(E.effectiveModels(s)[0].reminders.some((r) => /Starmist Raiment/.test(r.text)));
  s.options.enigma = 'The Mask of Secrets';
  assert.ok(rules(s).includes('Fear (2)'));
});

test('relic weapons replace the leader\'s blade and are once per army', () => {
  const s = sel('great-harlequin');
  s.options.melee = "Cegorach's Rose";
  assert.equal(E.unitPoints(s), 160 + 20);
  const items = E.effectiveModels(s)[0].items;
  assert.ok(items.includes("Cegorach's Rose") && !items.includes("Harlequin's Blade"));
  const det = E.makeDetachment('primary', 'P', [{ role: 'Command' }, { role: 'Command' }]);
  for (const slot of det.slots) { slot.unit = sel('troupe-master'); slot.unit.options.melee = 'The Storied Sword'; }
  assert.ok(E.armyIssues(army([det])).some((i) => /The Storied Sword may only be taken once/.test(i.msg)));
});

test('special weapons swap the Harlequin\'s Blade and cost 5 points a model', () => {
  const s = sel('harlequin-troupe');
  s.options.melee = { "Harlequin's Caress": 5 };
  assert.equal(E.unitPoints(s), 160 + 25);
  const players = E.effectiveModels(s).find((m) => m.model === 'Player');
  assert.ok(players.items.includes("Harlequin's Caress"));
  assert.ok(!players.items.includes("Harlequin's Blade"));
  s.options.pistol = { 'Fusion Pistol': 3 };
  assert.ok(errs(s).some((i) => /too many models/.test(i.msg)));
});

test('every unit in an Auxiliary Detachment shares one Masque; the Solitaire is ignored', () => {
  const primary = E.makeDetachment('primary', 'P', [{ role: 'Command' }, { role: 'Command' }]);
  primary.slots[0].unit = sel('troupe-master');
  primary.slots[1].unit = sel('troupe-master');
  const raid = E.detachmentFromDef('webway-raiders');
  const troops = raid.slots.filter((s) => s.role === 'Troops');
  troops[0].unit = sel('harlequin-troupe', 'Frozen Stars');
  troops[1].unit = sel('harlequin-troupe', 'Veiled Path');
  const path = E.detachmentFromDef('the-lonely-path');
  path.slots[0].unit = sel('solitaire');
  const a = army([primary, raid, path]);
  assert.ok(E.armyIssues(a).some((i) => /Webway Raiders: every unit must share one Masque/.test(i.msg)));
  troops[1].unit = sel('harlequin-troupe', 'Frozen Stars');
  assert.ok(!E.armyIssues(a).some((i) => /share one Masque/.test(i.msg)));
});

test('a Masque Detachment needs a Command unit of that Masque and takes only that Masque', () => {
  const primary = E.makeDetachment('primary', 'P', [{ role: 'Command' }]);
  const revel = E.detachmentFromDef('frenzied-revel');
  const a = army([primary, revel]);
  primary.slots[0].unit = sel('troupe-master', 'Veiled Path');
  assert.ok(E.armyIssues(a).some((i) => /Frenzied Revel is unlocked by a Frozen Stars/.test(i.msg)));
  primary.slots[0].unit = sel('troupe-master', 'Frozen Stars');
  assert.ok(!E.armyIssues(a).some((i) => /Frenzied Revel is unlocked/.test(i.msg)));
  const slot = revel.slots.find((s) => s.role === 'Troops');
  assert.ok(E.unitsForSlot(slot, revel).some((u) => u.id === 'harlequin-troupe'));
  slot.unit = sel('harlequin-troupe', 'Dreaming Shadow');
  assert.ok(E.armyIssues(a).some((i) => /Frenzied Revel's restrictions/.test(i.msg)));
});

test('The Lonely Path takes only a Solitaire, and the Solitaire is 0-1', () => {
  const path = E.detachmentFromDef('the-lonely-path');
  assert.deepEqual(E.unitsForSlot(path.slots[0], path).map((u) => u.id), ['solitaire']);
  const primary = E.makeDetachment('primary', 'P', [{ role: 'Elites' }, { role: 'Elites' }]);
  primary.slots[0].unit = sel('solitaire');
  primary.slots[1].unit = sel('solitaire');
  assert.ok(E.armyIssues(army([primary])).some((i) => /Solitaire is 0-1/.test(i.msg)));
});

test('Masque Prime Advantages go only to their Masque', () => {
  const advs = (s) => E.primeAdvantagesFor(s, army([]), null).map((a) => a.name);
  assert.ok(advs(sel('harlequin-troupe', 'Midnight Sorrow')).includes('Herald of the Fall'));
  assert.ok(!advs(sel('harlequin-troupe', 'Frozen Stars')).includes('Herald of the Fall'));
  assert.ok(advs(sel('harlequin-troupe', 'Dreaming Shadow')).includes("Death's Promise"));
  assert.ok(!advs(sel('starweaver', 'Dreaming Shadow')).includes("Death's Promise"));
  assert.ok(advs(sel('prismweaver')).includes('Prismatic Master'));
  assert.ok(advs(sel('harlequin-troupe')).includes('Webway Strike'));
  const s = sel('harlequin-troupe', 'Dreaming Shadow');
  s.primeAdvantage = "Death's Promise";
  assert.ok(rules(s).includes('Eternal Warrior (1)'));
  const v = sel('vaelith-duskmirror', 'Dreaming Shadow');
  v.primeAdvantage = "Death's Promise";
  assert.ok(rules(v).includes('Eternal Warrior (2)'));
});

test('Enigmas of the Black Library are once per army', () => {
  const det = E.makeDetachment('primary', 'P', [{ role: 'Command' }, { role: 'Command' }]);
  for (const slot of det.slots) { slot.unit = sel('troupe-master'); slot.unit.options.enigma = 'The Mask of Secrets'; }
  assert.ok(E.armyIssues(army([det])).some((i) => /The Mask of Secrets may only be taken once/.test(i.msg)));
});

test('the army rules panel repeats the rules text word for word', () => {
  const all = [...data.rules.specialRules, ...data.rules.reactions, ...data.rules.gambits, ...data.rules.primeAdvantages];
  for (const f of data.armyConfig.fixed) assert.equal(f.text, all.find((r) => r.name === f.name).text, f.name);
});

test('Harlequin Wraithlord: up to two heavy weapons, and the Masque of the Dead\'s War Engine slot', () => {
  const s = sel('harlequin-wraithlord', 'Dreaming Shadow');
  s.options['heavy-weapons'] = { 'Shuriken Cannon': 1, 'Prismatic Cannon': 1 };
  assert.equal(E.unitPoints(s), 170 + 10 + 20);
  assert.deepEqual(errs(s), []);
  s.options['heavy-weapons'] = { 'Shuriken Cannon': 3 };
  assert.ok(errs(s).some((i) => /too many/.test(i.msg)));
  const m = E.effectiveModels(sel('harlequin-wraithlord', 'Dreaming Shadow'))[0];
  assert.equal(m.profile.INV, '5+');
  assert.ok(m.rules.includes('Feel No Pain (6+)'));
  assert.ok(!rules(sel('harlequin-wraithlord', 'Veiled Path')).includes('Shrouded (5+)'));
  const det = E.detachmentFromDef('masque-of-the-dead');
  const slot = det.slots.find((x) => x.role === 'War Engine');
  assert.deepEqual(E.unitsForSlot(slot, det).map((u) => u.id), ['harlequin-wraithlord']);
});

test('every Harlequin weapon rule is one that real HH3 weapons use', () => {
  const common = require('../data/bsdata/common.json');
  const base = (r) => String(r).replace(/\s*\(.*\)\s*$/, '').replace(/[’]/g, "'").trim();
  const flat = (ws) => ws.flatMap((w) => (w.modes && w.modes.length ? w.modes : [w]));
  const hh3 = new Set(flat([...common.weapons.ranged, ...common.weapons.melee]).flatMap((w) => (w.specialRules || []).map(base)));
  for (const w of flat([...data.weapons.ranged, ...data.weapons.melee])) {
    for (const r of w.specialRules || []) assert.ok(hh3.has(base(r)), `${w.name}: ${r} isn't an HH3 weapon rule`);
  }
});

test('holo-suits give Shrouded after a Rush; Dodge only where it beats the invulnerable save', () => {
  const t = E.effectiveModels(sel('harlequin-troupe'))[0];
  assert.ok(!t.rules.some((r) => /^Dodge/.test(r)));
  assert.ok(t.reminders.some((r) => /Rushed/.test(r.text) && /Shrouded \(5\+\)/.test(r.text)));
  assert.ok(rules(sel('vaelith-duskmirror')).includes('Dodge (3+)'));
  assert.ok(rules(sel('mimes')).includes('Dodge (5+)'));
  // vehicles have holo-fields, not holo-suits
  assert.ok(!E.effectiveModels(sel('starweaver'))[0].reminders.some((r) => /Rushed/.test(r.text)));
});
