// One list per Legion: a shared core plus that Legion's signature units, legal in the builder's engine and
// filled to just under 3000 points. Usage: node make.cjs [legion ...]
const { createBuilder } = require('../builder.cjs');

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

function build(id, { smart = false, name, file = `${__dirname}/${id}.json` } = {}) {
  const b = createBuilder(id, { smart, name });
  const skipped = [];
  // commands first (they unlock the auxiliaries), then the signature units, then the rest of the core
  const cmds = CORE.filter((u) => /Command/.test(u[0])), rest = CORE.filter((u) => !/Command/.test(u[0]));
  const sigCmd = SIGNATURE[id].filter((u) => u[0] === 'Command');
  const order = [...sigCmd, ...cmds.slice(0, 4 - sigCmd.length), ...SIGNATURE[id].filter((u) => u[0] !== 'Command'), ...rest];
  for (const u of order) { const x = b.mk(u); if (!x || !b.place(x)) skipped.push(u[1]); }
  // fill up to 3000: a few extras once each, then grow the signature units, then the tactical squads
  for (let pass = 0; pass < 4; pass++) for (const f of FILL) {
    if (b.count(f[1]) >= (CAP[f[1]] || 1)) continue;
    b.add(f);
  }
  const sigIds = new Set(SIGNATURE[id].map((u) => u[1]));
  for (const pick of [(sl) => sigIds.has(sl.unit.unitId), (sl) => sl.unit.unitId === 'heavy-support-squad', (sl) => sl.unit.unitId === 'tactical-squad']) b.growAll(pick);
  return Object.assign(b.finish(file), { skipped });
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
