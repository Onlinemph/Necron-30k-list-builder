// One list per Legion: a shared core plus that Legion's signature units, legal in the builder's engine and
// filled to just under 3000 points. Usage: node make.cjs [legion ...]
const fs = require('fs'), vm = require('vm'), path = require('path'), R = path.join(__dirname, '..', '..', '..') + '/';
const { createEngine } = require(R + 'js/engine.js');
const load = (id) => { const window = {}; vm.runInNewContext(fs.readFileSync(`${R}js/data-${id}.js`, 'utf8'), { window }); return window.ARMY_DATA[id]; };

// signature units: [role, unitId, options, counts]
const SIGNATURE = {
  'dark-angels': [['Elites', 'inner-circle-knights-cenobium'], ['Support', 'dreadwing-interemptor-squad']],
  'emperors-children': [['Elites', 'palatine-blade-squad'], ['Support', 'kakophoni-squad']],
  'iron-warriors': [['Heavy Assault', 'tyrant-siege-terminator-squad'], ['Support', 'iron-havocs']],
  'white-scars': [['Elites', 'golden-keshig'], ['Support', 'kyzagan-assault-speeder']],
  'space-wolves': [['Troops', 'grey-slayer-pack'], ['Elites', 'varagyr-wolf-guard-terminators'], ['Heavy Assault', 'deathsworn-pack']],
  'imperial-fists': [['Elites', 'templar-brethren'], ['Heavy Assault', 'phalanx-warder-squad']],
  'night-lords': [['Troops', 'terror-squad'], ['Elites', 'contekar-terminator-squad'], ['Fast Attack', 'night-raptor-squad']],
  'blood-angels': [['Elites', 'crimson-paladins'], ['Elites', 'dawnbreaker-cohort']],
  'iron-hands': [['Troops', 'medusan-immortals-squad'], ['Heavy Assault', 'gorgon-terminator-squad']],
  'world-eaters': [['Heavy Assault', 'rampager-squad'], ['Elites', 'red-butchers']],
  'ultramarines': [['Elites', 'invictus-suzerain-squad'], ['Heavy Assault', 'fulmentarus-terminator-squad']],
  'death-guard': [['Heavy Assault', 'grave-warden-terminator-squad'], ['Elites', 'mortus-poisoner-squad']],
  'thousand-sons': [['Command', 'prosperine-sorcerer'], ['Elites', 'khenetai-occult-cabal'], ['Elites', 'sekhmet-terminator-cabal']],
  'sons-of-horus': [['Elites', 'justaerin-terminator-squad'], ['Heavy Assault', 'reaver-attack-squad']],
  'word-bearers': [['Elites', 'gal-vorbak'], ['Fast Attack', 'ashen-circle']],
  'salamanders': [['Elites', 'firedrake-terminator-squad'], ['Heavy Assault', 'pyroclast-squad']],
  'raven-guard': [['Elites', 'mor-deythan-squad'], ['Elites', 'dark-fury-squad']],
  'alpha-legion': [['Elites', 'headhunter-kill-team'], ['Elites', 'lernaean-terminator-squad']],
};
// the shared core every Legion takes
const CORE = [
  ['High Command', 'praetor', { 'praetor-options': ['Power fist', 'Volkite serpenta'] }],
  ['Command', 'centurion', { 'centurion-options': ['Power sword', 'Bolt pistol'] }],
  ['Command', 'centurion', { 'centurion-options': ['Power sword', 'Bolt pistol'] }],
  ['Command', 'centurion', { 'centurion-options': ['Power fist', 'Bolt pistol'] }],
  ['Troops', 'tactical-squad', {}, { Legionary: 19 }],
  ['Troops', 'tactical-squad', {}, { Legionary: 9 }],
  ['Transport', 'rhino'],
  ['Support', 'heavy-support-squad', { 'unit-legion-heavy-weapons-list': 'Lascannon' }],
  ['Armour', 'predator', { 'predator-legion-sponson-weapons': 'Lascannon', 'predator-turret': 'Twin lascannon' }],
  ['Armour', 'predator', { 'predator-legion-sponson-weapons': 'Heavy Bolters' }],
  ['War Engine', 'contemptor-dreadnought', { 'unit-1-weapon-option-1': 'Kheres assault cannon', 'unit-2-weapon-option-2': 'Gravis power fist with in-built ranged weapon' }],
];
// filler, once each, while it fits under 3000
const FILL = [
  ['Armour', 'predator', { 'predator-legion-sponson-weapons': 'Lascannon', 'predator-turret': 'Twin lascannon' }],
  ['Transport', 'rhino'],
  ['Troops', 'tactical-squad', {}, { Legionary: 9 }],
  ['Support', 'heavy-support-squad', { 'unit-legion-heavy-weapons-list': 'Lascannon' }],
  ['War Engine', 'contemptor-dreadnought', { 'unit-1-weapon-option-1': 'Kheres assault cannon', 'unit-2-weapon-option-2': 'Gravis power fist with in-built ranged weapon' }],
  ['Armour', 'predator', { 'predator-legion-sponson-weapons': 'Heavy Bolters' }],
];
const CAP = { 'tactical-squad': 4, rhino: 3, predator: 4, 'heavy-support-squad': 2, 'contemptor-dreadnought': 2 };
const TRAITOR = new Set(['emperors-children', 'iron-warriors', 'night-lords', 'world-eaters', 'death-guard', 'thousand-sons', 'sons-of-horus', 'word-bearers', 'alpha-legion']);
// where each role goes once the Primary Detachment is full: auxiliaries need a Command each, the apex needs High Command
const AUX = { Armour: 'core-armoured-support', Support: 'core-tactical-support', Troops: 'core-tactical-support', 'War Engine': 'core-heavy-support', 'Heavy Assault': 'core-shock-assault', 'Fast Attack': 'core-first-strike', Recon: 'core-combat-pioneer' };
const APEX = { Elites: 'core-army-vanguard', Retinue: 'core-combat-retinue', Command: 'core-officer-cadre' };

function build(id) {
  const D = load(id);
  const E = createEngine(D);
  const { weapons } = require(R + 'sim/lib/army.cjs').loadArmyData(id);
  const { resolveItem } = require(R + 'sim/lib/army.cjs');
  const isMelee = (n) => resolveItem(weapons, n).melee.some((w) => !(w.specialRules || []).some((r) => /^Detonation/.test(r)));
  const isGun = (n) => resolveItem(weapons, n).ranged.length > 0;
  const mk = ([role, uid, options = {}, counts = {}]) => {
    if (!D.units.find((u) => u.id === uid)) return null;
    const s = E.newSelection(uid); Object.assign(s.options, options); Object.assign(s.counts, counts);
    for (const o of E.optionsOf(s)) {
      if (!o.required || s.options[o.id]) continue;
      const c = E.choicesFor(o, s); const n = E.modelCounts(s)[o.model] || 1;
      const many = (o.max && o.max.fixed) || +((String(o.text || '').match(/choose (\d+)/i) || [])[1] || 1);
      if (!c.length) continue;
      // a weapon group: the cheapest melee weapon and, where two are taken, the cheapest gun
      const byCost = [...c].sort((a, b) => (a.points || 0) - (b.points || 0));
      const melee = byCost.find((x) => isMelee(x.name)), gun = byCost.find((x) => isGun(x.name));
      const weaponPick = melee ? (many >= 2 && gun ? [melee.name, gun.name] : [melee.name]) : null;
      // the builder allows one pick per model in these groups, so each model takes the melee weapon
      if (o.kind === 'perModel') s.options[o.id] = { [weaponPick ? weaponPick[0] : c[0].name]: n };
      else if (o.kind === 'any') s.options[o.id] = weaponPick || c.slice(0, many).map((x) => x.name);
      else s.options[o.id] = weaponPick ? weaponPick[0] : c[0].name;
    }
    return { role, s };
  };
  const primary = E.makeDetachment('primary', D.forceorg.primary.name, D.forceorg.primary.slots.flatMap((d) => Array.from({ length: d.count ?? 1 }, (_, i) => ({ role: d.role, prime: i < (d.prime || 0) }))));
  const dets = [primary];
  const place = (x) => {
    for (const d of dets) { const slot = d.slots.find((sl) => sl.role === x.role && !sl.unit); if (slot) { slot.unit = x.s; return true; } }
    const commands = primary.slots.filter((sl) => sl.role === 'Command' && sl.unit).length;
    const aux = dets.filter((d) => d.type === 'Auxiliary' || d.kind === 'auxiliary').length;
    const apex = dets.filter((d) => d.type === 'Apex' || d.kind === 'apex').length;
    const defId = AUX[x.role] && aux < commands ? AUX[x.role] : APEX[x.role] && apex < 1 ? APEX[x.role] : null;
    if (!defId) return false;
    const d = E.detachmentFromDef(defId); dets.push(d);
    const slot = d.slots.find((sl) => sl.role === x.role && !sl.unit);
    if (!slot) return false;
    slot.unit = x.s; return true;
  };
  // Allegiance, and the Legion's own Rite of War where one must be chosen (it carries the Legion Tactica)
  const config = { allegiance: [TRAITOR.has(id) ? 'Traitor' : 'Loyalist'] };
  const rite = D.armyConfig.groups.find((g) => g.id === 'rite-of-war' && g.min > 0);
  if (rite) config['rite-of-war'] = [rite.choices[0].name];
  const army = () => ({ version: 2, faction: id, name: id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), pointsLimit: 3000, sequelae: [], config, detachments: dets });
  const total = () => { const a = army(); E.setArmy(a); return dets.reduce((t, d) => t + d.slots.filter((s) => s.unit).reduce((x, s) => x + E.unitPoints(s.unit, s), 0), 0); };
  const skipped = [];
  // commands first (they unlock the auxiliaries), then the signature units, then the rest of the core
  const cmds = CORE.filter((u) => /Command/.test(u[0])), rest = CORE.filter((u) => !/Command/.test(u[0]));
  const sigCmd = SIGNATURE[id].filter((u) => u[0] === 'Command');
  const order = [...sigCmd, ...cmds.slice(0, 4 - sigCmd.length), ...SIGNATURE[id].filter((u) => u[0] !== 'Command'), ...rest];
  for (const u of order) { const x = mk(u); if (!x || !place(x)) skipped.push(u[1]); }
  // fill up to 3000: a few extras once each, then grow the signature units, then the tactical squads
  const count = (uid) => dets.reduce((t, d) => t + d.slots.filter((sl) => sl.unit && sl.unit.unitId === uid).length, 0);
  for (let pass = 0; pass < 4; pass++) for (const f of FILL) {
    if (count(f[1]) >= (CAP[f[1]] || 1)) continue;
    const x = mk(f); if (!x) continue;
    if (!place(x)) continue;
    if (total() > 3000) for (const d of dets) for (const sl of d.slots) if (sl.unit === x.s) sl.unit = null;
  }
  const sigIds = new Set(SIGNATURE[id].map((u) => u[1]));
  const grow = (sl) => {
    const def = D.units.find((u) => u.id === sl.unit.unitId);
    for (const m of def.models || []) {
      if (m.max == null || m.max <= (m.min || 0)) continue;
      const cur = sl.unit.counts[m.name] ?? m.min;
      if (cur >= m.max) continue;
      sl.unit.counts[m.name] = cur + 1;
      if (total() > 3000 || E.unitIssues(sl.unit).some((i) => i.level === 'error')) { sl.unit.counts[m.name] = cur; continue; }
      return true;
    }
    return false;
  };
  for (const pick of [(sl) => sigIds.has(sl.unit.unitId), (sl) => sl.unit.unitId === 'heavy-support-squad', (sl) => sl.unit.unitId === 'tactical-squad']) {
    let grew = true;
    while (grew) { grew = false; for (const d of dets) for (const sl of d.slots) if (sl.unit && pick(sl) && grow(sl)) grew = true; }
  }
  const a = army(); E.setArmy(a);
  const errors = E.armyIssues(a).filter((i) => i.level === 'error').map((i) => i.msg);
  const slim = JSON.parse(JSON.stringify(a), (k, v) => (k === 'uid' || v === null || (k === 'options' && v && !Object.keys(v).length) || (k === 'counts' && v && !Object.keys(v).length) || (v === false && ['flexible', 'advisor', 'prime'].includes(k)) ? undefined : v));
  fs.writeFileSync(`${__dirname}/${id}.json`, JSON.stringify(slim, null, 1));
  const units = dets.flatMap((d) => d.slots.filter((s) => s.unit).map((s) => `${s.unit.unitId}${E.effectiveModels(s.unit, s).reduce((t, m) => t + m.count, 0) > 1 ? 'x' + E.effectiveModels(s.unit, s).reduce((t, m) => t + m.count, 0) : ''}`));
  return { id, total: total(), errors, skipped, dets: dets.map((d) => d.name), units };
}
module.exports = { build, SIGNATURE };
if (require.main === module) {
  for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SIGNATURE)) {
    try {
      const r = build(id);
      console.log(`${id.padEnd(18)} ${r.total} pts ${r.errors.length ? 'ERRORS: ' + r.errors.join(' | ') : ''}${r.skipped.length ? ' SKIPPED: ' + r.skipped.join(',') : ''}\n    ${r.dets.join(' + ')}\n    ${r.units.join(', ')}`);
    } catch (e) { console.log(id, 'FAILED', e.message); }
  }
}
