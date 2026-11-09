// Rangdan house army through the same engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data/rangdan.json');
const common = require('../data/bsdata/common.json');
const { createEngine } = require('../js/engine.js');

const E = createEngine(data);
// Rangda and Thralls pick a War-moon; Slaugth and the named characters don't
const sel = (id, m = 'Iron Chain') => { const s = E.newSelection(id); if (s.arkana === null) s.arkana = m; return s; };
const errs = (s) => E.unitIssues(s).filter((i) => i.level === 'error');
const army = (dets) => ({ pointsLimit: 3000, sequelae: [], config: {}, detachments: dets });
const unit = (id) => data.units.find((u) => u.id === id);
const has = (u, t) => (u.traits || []).includes(t);
const rules = (s) => E.effectiveModels(s)[0].rules;

test('War-moon is the per-unit choice; Slaugth have none and the named characters are locked to theirs', () => {
  assert.equal(data.meta.name, 'Rangdan');
  assert.equal(E.choiceLabel, 'War-moon');
  assert.deepEqual(E.ARKANA, ['Silent Choir', 'Iron Chain', 'Long Hunt', 'Burning Sky']);
  for (const m of E.ARKANA) assert.ok(data.arkana.some((a) => a.name === m && /Tactica:.*Cost:/s.test(a.harbinger.text)), m);
  assert.ok(errs(E.newSelection('hunt-pack')).some((i) => /War-moon/.test(i.msg)), 'a Rangda unit must pick one');
  assert.deepEqual(errs(E.newSelection('slaugth-kindred')), []);
  assert.equal(E.arkanaOf(E.newSelection('ithrakk-the-first-voice')), 'Silent Choir');
  assert.equal(E.arkanaOf(E.newSelection('marshal-casimir-vehl')), 'Iron Chain');
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

test('Rangdan squads cost 70 to 105 points a model; the hounds are beasts, not Rangda', () => {
  const squads = data.units.filter((u) => has(u, 'Rangda') && !u.specialRules.includes('Beasts of the Hunt') && u.models.some((m) => m.max > 1 && /Infantry/.test(m.unitType)));
  assert.deepEqual(squads.map((u) => u.id).sort(), ['hunt-court', 'hunt-pack', 'ironhide-hunters', 'moon-callers', 'rangdan-mimics', 'shadow-lancers', 'skyhunters']);
  for (const u of squads) {
    const m = u.models[0];
    assert.ok(m.costPerExtra >= 70 && m.costPerExtra <= 105, `${u.id} at ${m.costPerExtra}`);
    assert.ok(u.basePoints >= m.costPerExtra * m.min, `${u.id} base cost covers its minimum models`);
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

test('Rangda carry Prey Instinct, Fear, the Horror of the Taken and a Hunting Cry; Slaugth carry Worm Gestalt, which fire ignores', () => {
  for (const u of data.units.filter((x) => has(x, 'Rangda') && x.models[0].profile.T != null && !['hunt-hounds', 'spine-stalker'].includes(x.id))) {
    const r = rules(sel(u.id));
    assert.ok(r.includes('Prey Instinct') && r.includes('Horror of the Taken') && r.some((x) => /^Fear \((1|2|3)\)$/.test(x)), u.id);
    assert.ok(E.effectiveModels(sel(u.id)).every((m) => m.items.includes('Hunting Cry')), `${u.id} screams`);
  }
  for (const u of data.units.filter((x) => has(x, 'Slaugth') && x.models[0].profile.T != null)) assert.ok(rules(sel(u.id)).includes('Worm Gestalt'), u.id);
  assert.match(data.rules.specialRules.find((r) => r.name === 'Worm Gestalt').text, /Feel No Pain \(5\+\).*Flame Trait or the Aflame/s);
});

test('Hunt-Pack wargear: sidearms, hooks, one Severing Maul per three and a Pack-Alpha', () => {
  const h = sel('hunt-pack');
  h.counts = { 'Rangda Hunter': 4 };
  h.options.sidearm = { 'Shadow Blaster': 4 };
  assert.equal(E.unitPoints(h), 240 + 75 + 40);
  assert.ok(E.effectiveModels(h).every((r) => r.items.includes('Shadow Blaster') && !r.items.includes('Shadow Pistol')));
  h.counts = { 'Rangda Hunter': 6 };
  h.options = { maul: { 'Severing Maul': 2 }, melee: { 'Flensing Hooks': 4 } };
  assert.equal(E.optionMax(E.optionsOf(h).find((o) => o.id === 'maul'), h), 2);
  assert.equal(E.unitPoints(h), 240 + 3 * 75 + 40);
  assert.deepEqual(errs(h), []);
  h.options.melee = { 'Flensing Hooks': 5 };
  assert.ok(errs(h).some((i) => /more upgrades than models/.test(i.msg)), 'hooks and mauls share the glaives');
  const a = sel('hunt-pack');
  a.options.alpha = 1;
  assert.equal(E.unitPoints(a), 240 + 15);
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
  assert.equal(E.unitPoints(m), 160 + 25 + 10);
});

test('Thralls carry captured Imperial heavy and special weapons, one per ten', () => {
  const t = sel('thrall-cohort');
  t.counts = { Thrall: 30 };
  assert.equal(E.optionMax(E.optionsOf(t).find((o) => o.id === 'heavy'), t), 3);
  t.options.heavy = { Lascannon: 2, Autocannon: 1 };
  assert.equal(E.unitPoints(t), 70 + 10 * 3 + 2 * 15 + 20);
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
  assert.deepEqual(ids('the-hunt').sort(), ['collar-ark', 'spine-pod', 'tendril-barge']);
  assert.deepEqual(ids('the-herd'), ['thrall-carrier']);
  assert.deepEqual(ids('the-carrion-court'), ['charnel-barge']);
  const shoal = E.detachmentFromDef('medusa-shoal');
  assert.deepEqual(E.unitsForSlot(shoal.slots.find((s) => s.role === 'Fast Attack'), shoal).map((u) => u.id).sort(), ['hunt-hounds', 'medusa-drop-ship', 'shadow-kite', 'skyhunters', 'tendril-skiffs']);
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
  assert.deepEqual(ids(herd, 'Troops').sort(), ['collared-auxilia', 'the-broken', 'thrall-cohort']);
  assert.deepEqual(ids(herd, 'Armour').sort(), ['thrall-armour', 'thrall-malcador']);
  const shoal = E.detachmentFromDef('medusa-shoal');
  assert.deepEqual(ids(shoal, 'Armour'), ['iron-medusa']);
});

test('the Carrion Court needs a Dream-Eater or the Hollow Choir in a Command slot and takes only Slaugth', () => {
  const primary = E.makeDetachment('primary', 'P', [{ role: 'High Command' }, { role: 'Command' }]);
  const court = E.detachmentFromDef('the-carrion-court');
  const a = army([primary, court]);
  primary.slots[1].unit = sel('collar-wright');
  assert.ok(E.armyIssues(a).some((i) => /The Carrion Court needs a Slaugth Dream-Eater or The Hollow Choir in a Command slot/.test(i.msg)));
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

test('the Hunting Cry pins: Pinning (2), and Ithrakk\'s screams further and harder', () => {
  const cry = data.weapons.ranged.find((w) => w.name === 'Hunting Cry');
  assert.deepEqual([cry.R, cry.FP, cry.RS, cry.AP, cry.D], [12, 2, 3, '–', 1]);
  assert.deepEqual(cry.specialRules, ['Pinning (2)']);
  assert.ok(!data.weapons.ranged.some((w) => w.name === 'Shadow Shrieker'), 'the cry replaced the Shrieker');
  assert.match(unit('ithrakk-the-first-voice').unitRules.find((r) => r.name === 'The First Voice').text, /18".*Pinning \(3\)/);
  assert.match(data.rules.specialRules.find((r) => r.name === 'Horror of the Taken').text, /within 6".*Leadership Check.*Routed/s);
});

test('war-moon Tacticas change the statline: Silent Choir Fear and BS, Long Hunt Fast (2), Burning Sky Initiative', () => {
  const m = (id, w) => E.effectiveModels(sel(id, w))[0];
  const choir = m('hunt-pack', 'Silent Choir');
  assert.ok(choir.rules.includes('Fear (2)'));
  assert.equal(choir.profile.BS, 3);
  assert.ok(m('hunt-pack', 'Long Hunt').rules.includes('Fast (2)'));
  assert.equal(m('hunt-pack', 'Burning Sky').profile.I, 5);
  assert.equal(m('hunt-pack', 'Iron Chain').profile.BS, 4);
  const regent = m('war-moon-regent', 'Silent Choir');
  assert.ok(regent.rules.includes('Fear (3)') && !regent.rules.includes('Fear (4)'), 'Fear (3) is the cap');
  assert.ok(!m('iron-medusa', 'Long Hunt').rules.includes('Fast (2)'), 'vehicles are unaffected');
  assert.ok(m('ithrakk-the-first-voice').rules.includes('Fear (3)'), 'Ithrakk is Silent Choir');
});

test('each war-moon\'s Auxiliary Detachment needs a Command model of that moon and takes only that moon', () => {
  const ids = { 'Silent Choir': 'the-choirs-hunt', 'Iron Chain': 'the-chained-host', 'Long Hunt': 'the-running-pack', 'Burning Sky': 'the-sky-burners' };
  for (const [w, detId] of Object.entries(ids)) {
    const primary = E.makeDetachment('primary', 'P', [{ role: 'Command' }]);
    const det = E.detachmentFromDef(detId);
    const a = army([primary, det]);
    const other = E.ARKANA.find((x) => x !== w);
    primary.slots[0].unit = sel('rangda-huntmaster', other);
    assert.ok(E.armyIssues(a).some((i) => new RegExp(`unlocked by a ${w} model`).test(i.msg)), detId);
    primary.slots[0].unit = sel('rangda-huntmaster', w);
    assert.ok(!E.armyIssues(a).some((i) => /unlocked by a/.test(i.msg)), detId);
    const slot = det.slots[0];
    const u = E.unitsForSlot(slot, det)[0];
    slot.unit = sel(u.id, other);
    assert.ok(E.armyIssues(a).some((i) => /restrictions/.test(i.msg)), `${detId} refuses ${other}`);
  }
  const hunt = E.detachmentFromDef('the-hunt');
  hunt.slots[0].unit = sel('hunt-pack', 'Long Hunt');
  hunt.slots[1].unit = sel('hunt-pack', 'Burning Sky');
  assert.ok(E.armyIssues(army([hunt])).some((i) => /every unit must share one War-moon/.test(i.msg)));
});

test('the Warlord Detachment fills with a War-moon Regent, a Hunt-Court and a Brood-ship', () => {
  const w = E.makeDetachment('warlord', 'Warlord', [{ role: 'Warlord' }, { role: 'Retinue' }, { role: 'Heavy Transport' }]);
  assert.deepEqual(w.slots.map((s) => E.unitsForSlot(s).map((u) => u.id).sort()), [['war-moon-regent'], ['hunt-court'], ['brood-ship', 'thrall-dracosan']]);
  assert.equal(unit('war-moon-regent').limit, '0-1');
  assert.ok(unit('brood-ship').models[0].profile.CAPACITY >= 6 * 3, 'six Bulky (3) Rangda');
});

test('named characters are unique, and the Hollow Choir unlocks the Carrion Court', () => {
  for (const id of ['ithrakk-the-first-voice', 'marshal-casimir-vehl', 'the-hollow-choir']) assert.equal(unit(id).unique, true, id);
  const primary = E.makeDetachment('primary', 'P', [{ role: 'Command' }]);
  primary.slots[0].unit = sel('the-hollow-choir');
  assert.ok(!E.armyIssues(army([primary, E.detachmentFromDef('the-carrion-court')])).some((i) => /Carrion Court needs/.test(i.msg)));
});

test('The Broken: collared Legionaries, 0-1, Heedless, with their brothers\' Hatred against them', () => {
  const b = unit('the-broken');
  assert.equal(b.limit, '0-1');
  assert.ok(b.specialRules.includes('Heedless') && b.specialRules.includes('Neural Collars'));
  assert.match(b.unitRules.find((r) => r.name === 'Still in There').text, /Hatred \(Thrall\)/);
  assert.deepEqual(b.models[0].wargear.slice(0, 2), ['Bolter', 'Bolt pistol']);
});

test('Collar-bombs goes only to Iron Chain Thrall infantry in a Prime slot', () => {
  const advs = (id, w) => E.primeAdvantagesFor(sel(id, w), army([]), null).map((a) => a.name);
  assert.ok(advs('thrall-cohort', 'Iron Chain').includes('Collar-bombs'));
  assert.ok(!advs('thrall-cohort', 'Silent Choir').includes('Collar-bombs'));
  assert.ok(!advs('thrall-armour', 'Iron Chain').includes('Collar-bombs'));
  assert.ok(!advs('hunt-pack', 'Iron Chain').includes('Collar-bombs'));
});

test('the army panel lists the gambits, reactions and the Additional Reaction Point', () => {
  const names = data.armyConfig.fixed.map((r) => r.name);
  for (const n of ['Horror of the Taken', 'Additional Reaction Point', 'Living Shields', 'The Hunt Closes', "Hunter's Stare", 'Feast of Memories']) assert.ok(names.includes(n), n);
  for (const n of ['The Choir Answers', 'Moonfall']) assert.ok(data.rules.reactions.some((r) => r.name === n), n);
  assert.ok(data.rules.gambits.some((g) => g.name === 'Throat-Hunter'));
});

test('Fear: squads Fear (1), characters Fear (2), the Regent Fear (3); the Silent Choir adds one, to Fear (3)', () => {
  const fear = (id, w) => E.effectiveModels(sel(id, w))[0].rules.find((r) => /^Fear/.test(r));
  for (const id of ['hunt-pack', 'shadow-lancers', 'rangdan-mimics', 'hunt-court']) {
    assert.equal(fear(id), 'Fear (1)', id);
    assert.equal(fear(id, 'Silent Choir'), 'Fear (2)', id);
  }
  for (const id of ['hunt-sovereign', 'rangda-huntmaster', 'collar-wright']) {
    assert.equal(fear(id), 'Fear (2)', id);
    assert.equal(fear(id, 'Silent Choir'), 'Fear (3)', id);
  }
  assert.equal(fear('war-moon-regent', 'Silent Choir'), 'Fear (3)');
});

test('scoring: Thralls hold with Line, the hunters score with Vanguard, Collared Legion adds a Line', () => {
  const rules = (id, pa) => { const s = sel(id); if (pa) s.primeAdvantage = pa; return E.effectiveModels(s)[0].rules; };
  assert.ok(rules('thrall-cohort').includes('Line (1)'));
  assert.ok(rules('collared-auxilia').includes('Line (1)'));
  assert.ok(rules('thrall-cohort', 'Collared Legion').includes('Line (2)'), 'like a Tactical Squad');
  assert.ok(rules('the-broken').includes('Heedless') && !rules('the-broken').some((r) => /^Line/.test(r)));
  assert.ok(rules('hunt-pack').includes('Vanguard (3)'));
  assert.ok(rules('hunt-court').includes('Vanguard (3)'));
  assert.ok(rules('rangdan-mimics').includes('Vanguard (2)'));
  assert.ok(!rules('shadow-lancers').some((r) => /^(Line|Vanguard)/.test(r)), 'the lancers are fire support');
  assert.ok(rules('hunt-pack', 'Apex Predators').includes('Fear (2)'));
});

test('the new Rangda: Skyhunters jump, Ironhides wear plate, hounds are Heedless beasts, the Spine-Stalker fills the Shoal\'s War Engine slot', () => {
  const m = (id, w) => E.effectiveModels(sel(id, w))[0];
  const sky = m('skyhunters');
  assert.match(sky.unitType, /Antigrav/);
  assert.equal(sky.profile.M, 14);
  assert.ok(sky.rules.includes('Deep Strike') && sky.rules.includes('Vanguard (2)'));
  const iron = m('ironhide-hunters');
  assert.match(iron.unitType, /Heavy/);
  assert.deepEqual([iron.profile.T, iron.profile.SAV], [6, '2+']);
  assert.ok(iron.rules.includes('Vanguard (3)'));
  const hound = m('hunt-hounds', 'Long Hunt');
  assert.ok(hound.rules.includes('Heedless') && !hound.items.includes('Hunting Cry'));
  assert.equal(hound.rules.filter((r) => /^Fast/.test(r)).length, 1, 'the Long Hunt doesn\'t stack a second Fast');
  assert.equal(m('hunt-hounds', 'Silent Choir').profile.BS, 0);
  assert.ok(!m('spine-stalker').items.includes('Hunting Cry'));
  const shoal = E.detachmentFromDef('medusa-shoal');
  assert.deepEqual(E.unitsForSlot(shoal.slots.find((s) => s.role === 'War Engine'), shoal).map((u) => u.id), ['spine-stalker']);
  for (const [id, model] of [['shadow-lancers', 'Lance-Alpha'], ['rangdan-mimics', 'Mimic-Alpha'], ['skyhunters', 'Sky-Alpha'], ['ironhide-hunters', 'Ironhide-Alpha']]) {
    const s = sel(id);
    s.options.alpha = 1;
    const a = E.effectiveModels(s).find((r) => r.name === model);
    assert.ok(a && a.count === 1 && a.profile.INV === '4+', `${id} alpha`);
    assert.equal(E.unitPoints(s), unit(id).basePoints + 15, id);
  }
  assert.equal(unit('hunt-pack').models[0].max, 9);
});

test('transports: Rangda ones are tougher than a Rhino and fire out with Firing Point; new vehicles fill the Herd and the Slaugth', () => {
  const p = (id) => unit(id).models[0].profile;
  const r = (id) => unit(id).specialRules;
  for (const id of ['tendril-barge', 'collar-ark']) {
    assert.ok(p(id).FRONT >= 12 && p(id).SIDE >= 12 && p(id).HP >= 5, `${id} beats a Rhino's armour`);
  }
  assert.ok(r('tendril-barge').includes('Firing Point (2)') && r('tendril-barge').includes('Assault Vehicle'));
  assert.ok(r('brood-ship').includes('Firing Point (3)'));
  assert.deepEqual([p('brood-ship').FRONT, p('brood-ship').HP], [13, 8], 'Coronus-level hull');
  assert.ok(r('charnel-barge').includes('Assault Vehicle') && p('charnel-barge').CAPACITY >= 10);
  assert.ok(r('medusa-drop-ship').includes('Assault Vehicle') && /Flyer/.test(unit('medusa-drop-ship').models[0].unitType));
  assert.ok(p('medusa-drop-ship').CAPACITY >= 5 * 3, 'five Bulky (3) Rangda');
  assert.ok(r('spine-pod').includes('Drop Transport') && r('spine-pod').includes('Deep Strike'));
  assert.match(unit('collar-ark').unitRules.find((x) => x.name === 'Collar Beacon').text, /Neural Collars.*within 12"/s);
  // the captured hulls keep their Solar Auxilia / Militia profiles
  const bs = (army, name) => { const u = require('../data/bsdata/' + army + '/parts/units.json'); return (Array.isArray(u) ? u : u.units).find((x) => x.name === name).models[0].profile; };
  for (const k of ['FRONT', 'SIDE', 'REAR', 'HP', 'CAPACITY']) assert.equal(p('thrall-dracosan')[k], bs('solar-auxilia', 'Dracosan Armoured Transport')[k], `Dracosan ${k}`);
  for (const k of ['FRONT', 'SIDE', 'REAR', 'HP']) assert.equal(p('thrall-malcador')[k], bs('imperialis-militia', 'Militia Malcador Heavy Tank')[k], `Malcador ${k}`);
  const herd = E.detachmentFromDef('the-herd');
  assert.deepEqual(E.unitsForSlot(herd.slots.find((s) => s.role === 'Heavy Transport'), herd).map((u) => u.id), ['thrall-dracosan']);
  const court = E.detachmentFromDef('the-carrion-court');
  assert.ok(E.unitsForSlot(court.slots.find((s) => s.role === 'Fast Attack'), court).some((u) => u.id === 'ambush-craft'));
  assert.ok(r('ambush-craft').includes('Outflank'));
});
