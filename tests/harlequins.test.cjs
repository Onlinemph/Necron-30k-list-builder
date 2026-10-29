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
  assert.equal(E.unitPoints(s), 165 + 20);
  const items = E.effectiveModels(s)[0].items;
  assert.ok(items.includes("Cegorach's Rose") && !items.includes("Harlequin's Blade"));
  const det = E.makeDetachment('primary', 'P', [{ role: 'Command' }, { role: 'Command' }]);
  for (const slot of det.slots) { slot.unit = sel('troupe-master'); slot.unit.options.melee = 'The Storied Sword'; }
  assert.ok(E.armyIssues(army([det])).some((i) => /The Storied Sword may only be taken once/.test(i.msg)));
});

test('any Player may take a Kiss (free) or Embrace, one in five a Caress, from one blade each', () => {
  const k = sel('harlequin-troupe');
  k.options.melee = { "Harlequin's Kiss": 5 };
  assert.equal(E.unitPoints(k), 160);
  // five swaps on four Players and a Lead Player: the fifth goes to the Lead Player
  assert.deepEqual(E.effectiveModels(k).map((m) => [m.model, m.count, m.items.includes("Harlequin's Kiss")]), [['Player', 4, true], ['Lead Player', 1, true]]);
  const s = sel('harlequin-troupe');
  s.options.caress = { "Harlequin's Caress": 1 };
  s.options.melee = { "Harlequin's Kiss": 4 };
  assert.equal(E.unitPoints(s), 160 + 10);
  assert.deepEqual(errs(s), []);
  const carried = E.effectiveModels(s).flatMap((m) => Array(m.count).fill(m.items.filter((i) => /^Harlequin's/.test(i)).join()));
  assert.deepEqual(carried.sort(), ["Harlequin's Caress", "Harlequin's Kiss", "Harlequin's Kiss", "Harlequin's Kiss", "Harlequin's Kiss"]);
  s.options.caress = { "Harlequin's Caress": 2 };
  s.options.melee = {};
  assert.ok(errs(s).some((i) => /too many models/.test(i.msg)));
  s.options.caress = { "Harlequin's Caress": 1 };
  s.options.melee = { "Harlequin's Embrace": 5 };
  assert.ok(errs(s).some((i) => /more upgrades than models/.test(i.msg)));
  const p = sel('harlequin-troupe');
  p.options.pistol = { 'Fusion Pistol': 3 };
  assert.ok(errs(p).some((i) => /too many models/.test(i.msg)));
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

test('holo-suits give Shrouded after a Rush; Dodge is a Damage Mitigation Test on top of the invulnerable save', () => {
  const t = E.effectiveModels(sel('harlequin-troupe'))[0];
  assert.ok(t.rules.includes('Dodge (6+)'));
  assert.ok(t.reminders.some((r) => /Rushed/.test(r.text) && /Shrouded \(5\+\)/.test(r.text)));
  assert.ok(rules(sel('vaelith-duskmirror')).includes('Dodge (4+)'));
  assert.ok(rules(sel('solitaire')).includes('Dodge (5+)'));
  assert.ok(rules(sel('troupe-master')).includes('Dodge (5+)'));
  assert.ok(rules(sel('mimes')).includes('Dodge (5+)'));
  assert.ok(rules(sel('skyweavers')).includes('Dodge (6+)'));
  const dodge = data.rules.specialRules.find((r) => r.name === 'Dodge (X)');
  assert.match(dodge.text, /Damage Mitigation Test/);
  assert.match(dodge.text, /in addition to a Saving Throw, including an Invulnerable Save/);
  // vehicles have holo-fields, not holo-suits
  assert.ok(!E.effectiveModels(sel('starweaver'))[0].reminders.some((r) => /Rushed/.test(r.text)));
});

test('each Player weapon has its own stat shape, not just its own rule', () => {
  const w = (n) => data.weapons.melee.find((x) => x.name === n);
  const shape = (n) => [w(n).IM, w(n).AM, w(n).SM, String(w(n).AP), w(n).D].join(' ');
  const shapes = ["Harlequin's Blade", "Harlequin's Kiss", "Harlequin's Caress", "Harlequin's Embrace"].map(shape);
  assert.equal(new Set(shapes).size, 4, shapes.join(' / '));
  assert.equal(w("Harlequin's Blade").AM, '+1');
  assert.equal(w("Harlequin's Kiss").D, 3);
  assert.equal(w("Harlequin's Caress").IM, '-1');
});

test('the 7th edition options: Lead Player relics, the Solitaire\'s Rose, Shadowseer disciplines, Voidweaver squadrons', () => {
  const t = sel('harlequin-troupe');
  t.options['lead-weapon'] = "Cegorach's Rose";
  t.options['lead-pistol'] = 'Crescendo';
  assert.equal(E.unitPoints(t), 160 + 20 + 15);
  const lead = E.effectiveModels(t).find((m) => m.model === 'Lead Player');
  assert.ok(lead.items.includes("Cegorach's Rose") && lead.items.includes('Crescendo') && !lead.items.includes("Harlequin's Blade"));
  // the Rose is once per army, whoever carries it
  const s = sel('solitaire');
  s.options.rose = "Cegorach's Rose";
  assert.ok(E.effectiveModels(s)[0].items.includes("Cegorach's Rose"));
  const det = E.makeDetachment('primary', 'P', [{ role: 'Troops' }, { role: 'Elites' }]);
  det.slots[0].unit = t; det.slots[1].unit = s;
  assert.ok(E.armyIssues(army([det])).some((i) => /Cegorach's Rose may only be taken once/.test(i.msg)));
  const ss = sel('shadowseer');
  ss.options['psychic-disciplines'] = ['Telepathy', 'Divination'];
  assert.ok(errs(ss).some((i) => /at most 1/.test(i.msg)));
  const sy = sel('sylandri-veilwalker');
  sy.options['psychic-disciplines'] = ['Telepathy', 'Divination'];
  assert.deepEqual(errs(sy), []);
  const v = sel('voidweaver');
  v.counts = { Voidweaver: 3 };
  assert.equal(E.unitPoints(v), 105 * 3);
  for (const id of ['troupe-master', 'shadowseer', 'death-jester', 'solitaire']) assert.ok(E.effectiveModels(sel(id))[0].items.includes('Haywire grenades'), id);
  assert.ok(E.effectiveModels(sel('skyweavers'))[0].items.includes('Mirage Launchers'));
});

test('Rising Crescendo covers Paragons, so Vaelith can Rush and charge with the Masque Court', () => {
  const dance = data.rules.specialRules.find((r) => r.name === 'The Great Dance');
  assert.match(dance.text, /Rising Crescendo: [^\n]*the Infantry or Paragon Type may have a Charge declared/);
  const vaelith = data.units.find((u) => u.id === 'vaelith-duskmirror');
  assert.match(vaelith.models[0].unitType, /^Paragon/);
  assert.ok(vaelith.specialRules.includes('The Great Dance'));
});

test('each Masque has its own unit, locked to it, that fits that Masque\'s Auxiliary Detachment', () => {
  const own = { 'revel-troupe': ['Frozen Stars', 'frenzied-revel', 'Heavy Assault'], tragedians: ['Midnight Sorrow', 'chorus-of-lament', 'Support'], phantasms: ['Veiled Path', 'hall-of-illusions', 'Recon'], 'the-unspeaking': ['Silent Shroud', 'silent-procession', 'Elites'], starshrike: ['Soaring Spite', 'skyborne-host', 'Fast Attack'], 'deathmask-players': ['Dreaming Shadow', 'masque-of-the-dead', 'Troops'] };
  for (const [id, [masque, detId, role]] of Object.entries(own)) {
    const s = E.newSelection(id);
    assert.equal(s.arkana, undefined, `${id} has no Masque choice`);
    assert.ok(E.effectiveModels(s)[0].traits.includes(masque), `${id} is ${masque}`);
    assert.deepEqual(errs(s), [], id);
    const det = E.detachmentFromDef(detId);
    det.slots.find((x) => x.role === role).unit = s;
    const issues = E.armyIssues(army([E.makeDetachment('primary', 'P', [{ role: 'High Command' }, { role: 'Command' }]), det]));
    assert.ok(!issues.some((i) => i.level === 'error' && new RegExp(det.name).test(i.msg)), `${id} in ${det.name}: ` + issues.map((i) => i.msg).join('; '));
  }
});

test('Masque units carry their Masque\'s rules: Revel Troupe Impact without Dodge, Deathmask Eternal Warrior, Starshrike speed', () => {
  const r = rules(E.newSelection('revel-troupe'));
  assert.ok(r.includes('Impact (S)') && !r.some((x) => /^Dodge/.test(x)));
  const d = E.newSelection('deathmask-players');
  assert.ok(rules(d).includes('Eternal Warrior (1)') && rules(d).includes('Feel No Pain (6+)'));
  d.primeAdvantage = "Death's Promise";
  assert.ok(rules(d).includes('Eternal Warrior (2)'));
  const s = E.effectiveModels(E.newSelection('starshrike'))[0];
  assert.match(s.unitType, /Flyer/);
  assert.equal(s.profile.M, 24);
  // Phantasms are illusions: no weapons at all
  const p = E.effectiveModels(E.newSelection('phantasms'))[0];
  assert.ok(!p.items.some((i) => data.weapons.melee.concat(data.weapons.ranged).some((w) => w.name === i)));
});

test('Wraith-dancers take any Masque, fill Heavy Assault, and a Forceshield gives a 4+ invulnerable save', () => {
  const w = sel('wraith-dancers', 'Dreaming Shadow');
  assert.equal(data.units.find((u) => u.id === 'wraith-dancers').role, 'Heavy Assault');
  assert.equal(E.effectiveModels(w)[0].profile.INV, '–');
  w.options.forceshield = { Forceshield: 3 };
  assert.equal(E.unitPoints(w), 165 + 30);
  assert.ok(E.effectiveModels(w).every((m) => m.profile.INV === '4+'));
  const det = E.detachmentFromDef('masque-of-the-dead');
  assert.ok(det.slots.some((x) => x.role === 'Heavy Assault'));
});

test('the Avatar of Cegorach needs a Great Harlequin or Troupe Master to play him, and is a Warlord at Initiative 10', () => {
  const u = data.units.find((x) => x.id === 'avatar-of-cegorach');
  assert.equal(u.role, 'Warlord');
  assert.ok(u.unique);
  const a = sel('avatar-of-cegorach');
  assert.equal(E.effectiveModels(a)[0].profile.I, 10);
  const W = E.makeDetachment('warlord', 'W', [{ role: 'Warlord' }]);
  W.slots[0].unit = a;
  const P = E.makeDetachment('primary', 'P', [{ role: 'High Command' }, { role: 'Command' }]);
  const issues = () => E.armyIssues(army([P, W])).filter((i) => i.level === 'error' && /Avatar/.test(i.msg));
  assert.ok(issues().some((i) => /needs Great Harlequin or Troupe Master/.test(i.msg)));
  P.slots[1].unit = sel('troupe-master');
  assert.deepEqual(issues(), []);
});

test('the Harlequin Wraithknight is a Lord of War Knight that Masque rules for infantry pass over', () => {
  const u = data.units.find((x) => x.id === 'harlequin-wraithknight');
  assert.equal(u.role, 'Lord of War');
  for (const m of ['Frozen Stars', 'Dreaming Shadow', 'Veiled Path']) {
    const k = E.effectiveModels(sel('harlequin-wraithknight', m))[0];
    assert.match(k.unitType, /Knight/);
    assert.ok(!k.rules.some((r) => /^(Impact|Feel No Pain|Shrouded)/.test(r)), m);
  }
  const k = sel('harlequin-wraithknight');
  k.options.arms = '2 Heavy Wraithcannons';
  k.options.shoulder = '2 Shoulder mounted Shuriken Cannons';
  assert.equal(E.unitPoints(k), 450 + 20);
  const items = E.effectiveModels(k)[0].items;
  assert.ok(items.includes('2 Heavy Wraithcannons') && !items.includes('Ghostglaive') && !items.includes('Scattershield'));
});

test('the Ventriloquist is a psyker with a Mannequin, and takes one Psychic Discipline', () => {
  const v = sel('the-ventriloquist');
  const models = E.effectiveModels(v);
  assert.deepEqual(models.map((m) => m.model), ['Ventriloquist', 'Mannequin']);
  assert.ok(models.find((m) => m.model === 'Mannequin').items.includes('Wraithbone Fists'));
  assert.ok(models[0].traits.includes('Psyker'));
  v.options['psychic-disciplines'] = ['Telepathy', 'Divination'];
  assert.ok(errs(v).some((i) => /at most 1/.test(i.msg)));
});
