// One list per Legion built on that Legion's strengths: its Tactica and Advanced Reaction (as the simulator plays
// them, lib/legions.cjs and lib/reactions.cjs) and its best units by the simulator's own numbers. Each plan says
// what the army is for; the builder (../builder.cjs) makes it legal in the app's engine at 3,000 points.
//   node sim/lists/strong/make.cjs [legion ...]
const { createBuilder } = require('../builder.cjs');

// ---- building blocks ----
const PRAETOR = ['High Command', 'praetor', { 'praetor-options': ['Power fist', 'Volkite serpenta'] }];
const CENTURION = (w = 'Power sword') => ['Command', 'centurion', { 'centurion-options': [w, 'Bolt pistol'] }];
const COMMAND = [PRAETOR, CENTURION(), CENTURION(), CENTURION('Power fist')];
const TACTICAL = (n = 10) => ['Troops', 'tactical-squad', {}, { Legionary: n - 1 }];
const RHINO = ['Transport', 'rhino'];
const PREDATOR = ['Armour', 'predator', { 'predator-legion-sponson-weapons': 'Lascannon', 'predator-turret': 'Twin lascannon' }];
const PREDATOR_HB = ['Armour', 'predator', { 'predator-legion-sponson-weapons': 'Heavy Bolters' }];
const VINDICATOR = ['Armour', 'vindicator-siege-tank'];
// heavy bolters are the squad's own weapons; anything else is swapped in
const HEAVY_SUPPORT = (weapon, n = 5) => ['Support', 'heavy-support-squad', weapon === 'Heavy bolter' ? {} : { 'unit-legion-heavy-weapons-list': weapon }, { Legionary: n - 1 }];
const LEVIATHAN = ['War Engine', 'leviathan-dreadnought'];
const DEREDEO = ['War Engine', 'deredeo-dreadnought', { 'unit-may-exchange-anvilus-autocannon-bat': 'Arachnus heavy lascannon battery' }];
const LAND_RAIDER = ['Heavy Transport', 'land-raider-carrier', { 'land-raider-carrier-hull-front-weapon': 'Twin lascannon' }];
const SPARTAN = ['Heavy Transport', 'spartan-assault-tank'];
const unit = (role, id, models = {}, options = {}) => [role, id, options, models];

// ---- the plans ----
// units: added in order (commands first, so they open the Auxiliary Detachments). grow: [unit id, models] squads
// grown in order. fill: extras added once each while points remain. Then Tactical Squads grow with what's left,
// and last the squads in `after`.
const PLANS = {
  'world-eaters': {
    name: 'World Eaters: the Butcher\'s Due',
    why: 'Violence Incarnate (+1 Attack on the charge) only pays if the melee arrives: Rampagers ride a Spartan and Red Butchers a Land Raider, both Assault Vehicles, so they charge straight out. Tactical Squads hold the markers; the Leviathan walks with the assault.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Heavy Assault', 'rampager-squad', { Rampager: 14 }), SPARTAN, unit('Elites', 'red-butchers', { 'Red Butcher': 4 }), LAND_RAIDER, LEVIATHAN],
    fill: [unit('Heavy Assault', 'rampager-squad', { Rampager: 9 }), RHINO, unit('Elites', 'red-butchers', { 'Red Butcher': 4 })],
  },
  'space-wolves': {
    name: 'Space Wolves: the Wolf Guard',
    why: 'The Hunter\'s Strike adds 2" to the Set-up Move, so charges land from further out. Varagyr are the Legion\'s best unit by a distance; ten ride a Spartan and five a Land Raider. Bestial Savagery (Feel No Pain) keeps them alive under fire.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Elites', 'varagyr-wolf-guard-terminators', { Varagyr: 9 }), SPARTAN, unit('Elites', 'varagyr-wolf-guard-terminators', { Varagyr: 4 }), LAND_RAIDER, LEVIATHAN],
    fill: [PREDATOR, PREDATOR, unit('Elites', 'varagyr-wolf-guard-terminators', { Varagyr: 4 }), PREDATOR, PREDATOR_HB],
  },
  'iron-warriors': {
    name: 'Iron Warriors: the Iron Wall',
    why: 'The Bitter End ignores the penalties statuses put on checks, so the gunline keeps firing. Two full Tyrant Siege Terminator squads (the best unit in the round robin) anchor it, with Predators, a Vindicator, a Deredeo and a Dominator Cohort.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'tyrant-siege-terminator-squad', { Tyrant: 9 }), unit('Heavy Assault', 'tyrant-siege-terminator-squad', { Tyrant: 4 }), PREDATOR, PREDATOR, VINDICATOR, DEREDEO],
    grow: [['tyrant-siege-terminator-squad', 10]],
    fill: [unit('Retinue', 'dominator-cohort'), PREDATOR],
  },
  'iron-hands': {
    name: 'Iron Hands: the Medusan Phalanx',
    why: 'The Gorgon\'s Scales takes 1 off the Strength of shots wounding them, so durable infantry walks through fire: Medusan Immortals and Tactical Squads hold markers while two big Gorgon Terminator squads advance. Predators and a Leviathan back them.',
    units: [...COMMAND, unit('Troops', 'medusan-immortals-squad', { Immortal: 9 }), unit('Troops', 'medusan-immortals-squad', { Immortal: 9 }), TACTICAL(), unit('Heavy Assault', 'gorgon-terminator-squad', { 'Gorgon Terminator': 9 }), unit('Heavy Assault', 'gorgon-terminator-squad', { 'Gorgon Terminator': 4 }), PREDATOR, PREDATOR, LEVIATHAN],
    grow: [['gorgon-terminator-squad', 10]],
    fill: [PREDATOR, unit('Retinue', 'morlock-terminator-squad', { Morlock: 4 }), TACTICAL(), RHINO, RHINO, unit('Retinue', 'morlock-terminator-squad', { Morlock: 4 })],
  },
  'imperial-fists': {
    name: 'Imperial Fists: the Bolter Line',
    why: 'Fire Discipline adds 1 to hit for Bolt Fire Groups of more than five dice, so the army is bolters in bulk: four 20-strong Tactical Squads and a ten-man heavy bolter Heavy Support Squad, with lascannons for armour and Huscarl Terminators as the hammer.',
    units: [...COMMAND, TACTICAL(20), TACTICAL(20), TACTICAL(20), HEAVY_SUPPORT('Heavy bolter', 10), HEAVY_SUPPORT('Lascannon', 5), PREDATOR_HB, PREDATOR, DEREDEO, unit('Retinue', 'huscarl-terminator-retinue')],
    grow: [['heavy-support-squad', 10]],
    fill: [TACTICAL(20), PREDATOR_HB, PREDATOR],
    after: [['huscarl-terminator-retinue', 10]],
  },
  'night-lords': {
    name: 'Night Lords: the Terror Hunt',
    why: 'A Talent for Murder adds 1 Weapon Skill against units with a Tactical Status, so the guns break and pin first (heavy bolters, Predators) and the Atramentar and Contekar, Deep Striking Vanguard Terminators, finish what\'s shaken.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Heavy Assault', 'atramentar-flay-clade', { Atramentar: 9 }), unit('Heavy Assault', 'atramentar-flay-clade', { Atramentar: 4 }), unit('Elites', 'contekar-terminator-squad', { Contekar: 4 }), HEAVY_SUPPORT('Heavy bolter', 10), PREDATOR_HB, PREDATOR],
    grow: [['atramentar-flay-clade', 10]],
    fill: [HEAVY_SUPPORT('Lascannon', 5), PREDATOR, unit('Elites', 'contekar-terminator-squad', { Contekar: 4 }), TACTICAL(), RHINO],
    after: [['contekar-terminator-squad', 10]],
  },
  'blood-angels': {
    name: 'Blood Angels: the Angels of Death',
    why: 'Encarmine Fury adds 1 Strength on the charge. Dawnbreaker Cohorts fly in on jump packs, Crimson Paladins ride a Land Raider, and a Leviathan follows; Tactical Squads and Predators hold and cover.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Elites', 'dawnbreaker-cohort', { Dawnbreaker: 9 }), unit('Elites', 'crimson-paladins', { 'Crimson Paladin': 4 }), LAND_RAIDER, unit('Elites', 'dawnbreaker-cohort', { Dawnbreaker: 4 }), LEVIATHAN],
    grow: [['dawnbreaker-cohort', 10]],
    fill: [PREDATOR, PREDATOR, TACTICAL(), PREDATOR, RHINO, PREDATOR, TACTICAL(), RHINO],
    after: [['crimson-paladins', 6]],
  },
  'ultramarines': {
    name: 'Ultramarines: the Tactical Masters',
    why: 'Tactical Flexibility makes one reaction a turn free, which pays most with many units to react with: four Tactical Squads, two Fulmentarus Terminator squads (the Legion\'s best guns), Invictus Suzerains, Predators and a Leviathan.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Heavy Assault', 'fulmentarus-terminator-squad', { 'Fulmentarus Terminator': 4 }), unit('Heavy Assault', 'fulmentarus-terminator-squad', { 'Fulmentarus Terminator': 4 }), unit('Elites', 'invictus-suzerain-squad', { Suzerain: 10 }), PREDATOR, PREDATOR, LEVIATHAN],
    grow: [['fulmentarus-terminator-squad', 8]],
    fill: [PREDATOR, TACTICAL(), unit('Elites', 'invictus-suzerain-squad', { Suzerain: 5 })],
    after: [['invictus-suzerain-squad', 10]],
  },
  'death-guard': {
    name: 'Death Guard: the Remorseless Advance',
    why: 'Remorseless Advance lets them fire Heavy weapons after moving up to 4" and ignore difficult terrain, so lascannon Heavy Support Squads walk forward with two full Grave Warden Terminator squads, the Legion\'s best unit.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'grave-warden-terminator-squad', { 'Grave Warden': 9 }), unit('Heavy Assault', 'grave-warden-terminator-squad', { 'Grave Warden': 4 }), HEAVY_SUPPORT('Lascannon', 10), HEAVY_SUPPORT('Lascannon', 5), LEVIATHAN],
    grow: [['grave-warden-terminator-squad', 10], ['heavy-support-squad', 10]],
    fill: [unit('Retinue', 'deathshroud-terminator-squad'), TACTICAL(), RHINO, RHINO, unit('Retinue', 'deathshroud-terminator-squad')],
    after: [['deathshroud-terminator-squad', 10]],
  },
  'thousand-sons': {
    name: 'Thousand Sons: the Cult Arcana',
    why: 'Cult Arcana makes every unit a Psyker with +1 Willpower, and Prosperine Sorcerers lead. Sekhmet Terminators are the core, Khenetai blades ride a Land Raider into combat, and an Osiron Contemptor and Predators add guns.',
    units: [PRAETOR, ['Command', 'prosperine-sorcerer'], ['Command', 'prosperine-sorcerer'], ['Command', 'prosperine-sorcerer'], TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Elites', 'sekhmet-terminator-cabal', { Sekhmet: 9 }), unit('Elites', 'sekhmet-terminator-cabal', { Sekhmet: 4 }), unit('Elites', 'khenetai-occult-cabal', { 'Khenetai Blade': 9 }), LAND_RAIDER, ['War Engine', 'contemptor-osiron-dreadnought'], PREDATOR],
    grow: [['sekhmet-terminator-cabal', 10]],
    fill: [PREDATOR, PREDATOR, TACTICAL(), RHINO, PREDATOR],
  },
  'sons-of-horus': {
    name: 'Sons of Horus: the Warmaster\'s Spear',
    why: 'Death Dealers fire Volleys at full Ballistic Skill, and Reavers and Justaerin are Vanguard units that shoot and fight: two Reaver squads hunt the units on markers, ten Justaerin ride a Spartan, and Tactical Squads hold.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Heavy Assault', 'reaver-attack-squad', { Reaver: 19 }), unit('Heavy Assault', 'reaver-attack-squad', { Reaver: 9 }), unit('Elites', 'justaerin-terminator-squad', { Justaerin: 10 }), SPARTAN, LEVIATHAN],
    fill: [RHINO, unit('Elites', 'justaerin-terminator-squad', { Justaerin: 5 })],
  },
  'word-bearers': {
    name: 'Word Bearers: the Gal Vorbak',
    why: 'Unwavering Conviction adds 1 to Combat Resolution, so they win the fights they start. Gal Vorbak (Feel No Pain, Vanguard) ride a Spartan, the Phraetus Anointed a Land Raider, and the Mhara Gal walks with them.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Elites', 'gal-vorbak', { 'Dark Brethren': 10 }), SPARTAN, unit('Elites', 'phraetus-anointed-conclave', { 'Phraetus Anointed': 4 }), LAND_RAIDER, ['War Engine', 'mhara-gal-dreadnought']],
    fill: [unit('Elites', 'gal-vorbak', { 'Dark Brethren': 5 }), PREDATOR, PREDATOR, PREDATOR, PREDATOR_HB],
  },
  'salamanders': {
    name: 'Salamanders: the Pyre',
    why: 'Promethean Endurance makes Wound rolls of 1 and 2 fail against them and ignores Panic from flame. Firedrakes (the Legion\'s best melee) ride two Land Raiders, Pyroclasts burn what\'s close, and a Leviathan joins the push.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Elites', 'firedrake-terminator-squad', { Firedrake: 4 }), LAND_RAIDER, unit('Elites', 'firedrake-terminator-squad', { Firedrake: 4 }), LAND_RAIDER, unit('Heavy Assault', 'pyroclast-squad', { Pyroclast: 9 }), LEVIATHAN],
    grow: [['pyroclast-squad', 10]],
    fill: [unit('Heavy Assault', 'pyroclast-squad', { Pyroclast: 4 }), RHINO, TACTICAL(), RHINO],
    after: [['pyroclast-squad', 10]],
  },
  'raven-guard': {
    name: 'Raven Guard: the Shadow Line',
    why: 'Shadow Walkers turns any shot from 18" or more into a Snap Shot, so they win the long-range duel: lascannon Heavy Support Squads, four Predators and a Deredeo shoot from beyond 18", while Deliverers Deep Strike onto whoever closes.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), TACTICAL(), HEAVY_SUPPORT('Lascannon', 5), HEAVY_SUPPORT('Lascannon', 5), PREDATOR, PREDATOR, PREDATOR, PREDATOR, DEREDEO, unit('Elites', 'deliverers-squad', { Deliverer: 9 })],
    grow: [['heavy-support-squad', 8], ['deliverers-squad', 10]],
    fill: [TACTICAL()],
    after: [['deliverers-squad', 15]],
  },
  'white-scars': {
    name: 'White Scars: the Chogorian Storm',
    why: 'Swift of Action adds 2" to every non-vehicle\'s Movement, so Tactical Squads reach markers first (they were the White Scars\' best unit), Ebon Keshig Terminators move like Assault Marines, and Golden Keshig jetbikes run down the stragglers.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), TACTICAL(), TACTICAL(), unit('Heavy Assault', 'ebon-keshig', { Kharash: 10 }), unit('Heavy Assault', 'ebon-keshig', { Kharash: 5 }), unit('Elites', 'golden-keshig', { 'Keshig Rider': 4 }), PREDATOR, PREDATOR, LEVIATHAN],
    fill: [PREDATOR, unit('Elites', 'golden-keshig', { 'Keshig Rider': 2 }), PREDATOR],
    after: [['golden-keshig', 6]],
  },
  'emperors-children': {
    name: 'Emperor\'s Children: the Perfect Strike',
    why: 'Flawless Execution adds 1 Combat Initiative on the charge, so Palatine Blades strike first; they ride Rhinos in. Sun Killers with lascannons and the Kakophoni give the army its guns.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, RHINO, RHINO, unit('Elites', 'palatine-blade-squad', { 'Palatine Warrior': 9 }), unit('Elites', 'palatine-blade-squad', { 'Palatine Warrior': 9 }), unit('Elites', 'sun-killer-squad', { 'Sun Killer': 9 }, { 'unit-every-model-in-the-unit-must-have-o': 'Lascannon' }), unit('Support', 'kakophoni-squad', { Chora: 9 }), PREDATOR, PREDATOR, LEVIATHAN],
    fill: [PREDATOR, TACTICAL()],
    after: [['sun-killer-squad', 20]],
  },
  'dark-angels': {
    name: 'Dark Angels: the Inner Circle',
    why: 'The Angel of Death keeps their Leadership at 6 or more and Fear from biting deep, so the elite hold. Two Inner Circle Knights Cenobium squads ride Land Raiders into the enemy, a Leviathan walks with them, and Tactical Squads and Predators hold the line.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), RHINO, RHINO, unit('Elites', 'inner-circle-knights-cenobium', { 'Order Cenobite': 4 }), LAND_RAIDER, unit('Elites', 'inner-circle-knights-cenobium', { 'Order Cenobite': 4 }), LAND_RAIDER, LEVIATHAN],
    fill: [PREDATOR, PREDATOR, TACTICAL(), PREDATOR, RHINO, PREDATOR, unit('Elites', 'firewing-enigmatus-cabal')],
    after: [['firewing-enigmatus-cabal', 6]],
  },
  'alpha-legion': {
    name: 'Alpha Legion: the Hydra',
    why: 'Lies and Obfuscation makes them count as 2" further away for shooting, charges and reactions. Lernaean Terminators (Line) are tough objective holders, Headhunters infiltrate and shoot, and Predators and a Leviathan give weight.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), TACTICAL(), unit('Elites', 'lernaean-terminator-squad', { Lernaean: 9 }), unit('Elites', 'lernaean-terminator-squad', { Lernaean: 4 }), unit('Elites', 'headhunter-kill-team', { Headhunter: 9 }), PREDATOR, PREDATOR, PREDATOR, LEVIATHAN],
    grow: [['lernaean-terminator-squad', 10]],
    fill: [PREDATOR],
  },
};

// ---- second plans: the Legion's best units, carried where they fight in melee, around the core that wins in
// the simulator (four lascannon Predators, lascannon Heavy Support, Tactical Squads on foot) ----
const GUNS = [PREDATOR, PREDATOR, PREDATOR, PREDATOR];
const STRIKE = {
  'world-eaters': { why: 'Rampagers ride a Spartan and Red Butchers a Land Raider, so Violence Incarnate lands the turn they arrive; four Predators and two big Tactical Squads hold the rest of the table.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'rampager-squad', { Rampager: 14 }), SPARTAN, unit('Elites', 'red-butchers', { 'Red Butcher': 4 }), LAND_RAIDER, ...GUNS], fill: [unit('Elites', 'red-butchers', { 'Red Butcher': 4 })] },
  'space-wolves': { why: 'Varagyr, the Legion\'s best unit, ride a Spartan and a Land Raider so the Hunter\'s Strike charge lands from the transport; four Predators and lascannons cover them.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'varagyr-wolf-guard-terminators', { Varagyr: 9 }), SPARTAN, unit('Elites', 'varagyr-wolf-guard-terminators', { Varagyr: 4 }), LAND_RAIDER, ...GUNS, HEAVY_SUPPORT('Lascannon', 5)] },
  'salamanders': { why: 'Firedrakes ride two Land Raiders into the enemy line, tough under Promethean Endurance; four Predators and lascannons do the rest.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'firedrake-terminator-squad', { Firedrake: 4 }), LAND_RAIDER, unit('Elites', 'firedrake-terminator-squad', { Firedrake: 4 }), LAND_RAIDER, ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], fill: [TACTICAL()] },
  'word-bearers': { why: 'Gal Vorbak ride a Spartan and the Phraetus Anointed a Land Raider into fights Unwavering Conviction wins; four Predators and lascannons cover them.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'gal-vorbak', { 'Dark Brethren': 10 }), SPARTAN, unit('Elites', 'phraetus-anointed-conclave', { 'Phraetus Anointed': 4 }), LAND_RAIDER, ...GUNS, HEAVY_SUPPORT('Lascannon', 5)] },
  'dark-angels': { why: 'Two Inner Circle Knights Cenobium squads ride Land Raiders into the enemy, steadied by the Angel of Death; four Predators and lascannons hold the line.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'inner-circle-knights-cenobium', { 'Order Cenobite': 4 }), LAND_RAIDER, unit('Elites', 'inner-circle-knights-cenobium', { 'Order Cenobite': 4 }), LAND_RAIDER, ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], fill: [TACTICAL()] },
  'blood-angels': { why: 'Dawnbreakers ride a Spartan and Crimson Paladins a Land Raider, so Encarmine Fury strikes the turn they arrive; four Predators and lascannons cover them.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'dawnbreaker-cohort', { Dawnbreaker: 9 }), SPARTAN, unit('Elites', 'crimson-paladins', { 'Crimson Paladin': 4 }), LAND_RAIDER, ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], fill: [TACTICAL()] },
  'night-lords': { why: 'The guns break and pin (heavy bolters, four Predators) and the Atramentar and Contekar fall on what\'s shaken, with A Talent for Murder.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'atramentar-flay-clade', { Atramentar: 9 }), unit('Heavy Assault', 'atramentar-flay-clade', { Atramentar: 4 }), unit('Elites', 'contekar-terminator-squad', { Contekar: 4 }), ...GUNS, HEAVY_SUPPORT('Heavy bolter', 10)], grow: [['atramentar-flay-clade', 10]], after: [['contekar-terminator-squad', 10]] },
  'emperors-children': { why: 'Palatine Blades strike first on the charge with Flawless Execution, one squad from a Land Raider; Sun Killers and four Predators bring the guns.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'palatine-blade-squad', { 'Palatine Warrior': 9 }), LAND_RAIDER, unit('Elites', 'palatine-blade-squad', { 'Palatine Warrior': 9 }), unit('Elites', 'sun-killer-squad', { 'Sun Killer': 9 }, { 'unit-every-model-in-the-unit-must-have-o': 'Lascannon' }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], after: [['sun-killer-squad', 20]] },
  'thousand-sons': { why: 'Sekhmet Terminators, Psykers all under Cult Arcana, ride a Spartan forward with Sorcerers leading; four Predators and lascannons back them.',
    units: [PRAETOR, ['Command', 'prosperine-sorcerer'], ['Command', 'prosperine-sorcerer'], ['Command', 'prosperine-sorcerer'], TACTICAL(), TACTICAL(), unit('Elites', 'sekhmet-terminator-cabal', { Sekhmet: 9 }), SPARTAN, unit('Elites', 'sekhmet-terminator-cabal', { Sekhmet: 4 }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], after: [['sekhmet-terminator-cabal', 10]] },
  'ultramarines': { why: 'Two Fulmentarus squads and four Predators shoot, Invictus Suzerains ride a Land Raider, and Tactical Flexibility gives a free reaction every turn.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), TACTICAL(), unit('Heavy Assault', 'fulmentarus-terminator-squad', { 'Fulmentarus Terminator': 4 }), unit('Heavy Assault', 'fulmentarus-terminator-squad', { 'Fulmentarus Terminator': 4 }), unit('Elites', 'invictus-suzerain-squad', { Suzerain: 10 }), LAND_RAIDER, ...GUNS], grow: [['fulmentarus-terminator-squad', 8]] },
  'iron-hands': { why: 'Two big Gorgon Terminator squads and Medusan Immortals advance under the Gorgon\'s Scales; four Predators and lascannons shoot them in.',
    units: [...COMMAND, unit('Troops', 'medusan-immortals-squad', { Immortal: 9 }), TACTICAL(), unit('Heavy Assault', 'gorgon-terminator-squad', { 'Gorgon Terminator': 9 }), unit('Heavy Assault', 'gorgon-terminator-squad', { 'Gorgon Terminator': 4 }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], grow: [['gorgon-terminator-squad', 10]], after: [['medusan-immortals-squad', 20]], fill: [unit('Retinue', 'morlock-terminator-squad', { Morlock: 4 })] },
  'iron-warriors': { why: 'Two full Tyrant squads, four Predators and lascannons: a gunline that keeps firing through statuses with the Bitter End.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'tyrant-siege-terminator-squad', { Tyrant: 9 }), unit('Heavy Assault', 'tyrant-siege-terminator-squad', { Tyrant: 9 }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], fill: [unit('Retinue', 'dominator-cohort')] },
  'death-guard': { why: 'Two full Grave Warden squads walk forward with lascannon Heavy Support Squads that fire on the move (Remorseless Advance); four Predators add weight.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'grave-warden-terminator-squad', { 'Grave Warden': 9 }), unit('Heavy Assault', 'grave-warden-terminator-squad', { 'Grave Warden': 4 }), HEAVY_SUPPORT('Lascannon', 10), ...GUNS], grow: [['grave-warden-terminator-squad', 10]], fill: [HEAVY_SUPPORT('Lascannon', 10), unit('Retinue', 'deathshroud-terminator-squad')] },
  'imperial-fists': { why: 'Fire Discipline\'s bolters in bulk (three 20-strong Tactical Squads, ten heavy bolters, heavy bolter Predators) with lascannons and Huscarls.',
    units: [...COMMAND, TACTICAL(20), TACTICAL(20), TACTICAL(20), HEAVY_SUPPORT('Heavy bolter', 10), HEAVY_SUPPORT('Lascannon', 5), PREDATOR_HB, PREDATOR_HB, PREDATOR, PREDATOR, unit('Retinue', 'huscarl-terminator-retinue')], after: [['huscarl-terminator-retinue', 10]], fill: [TACTICAL(20)] },
  'alpha-legion': { why: 'Lernaean Terminators hold markers (Line), Headhunters infiltrate, and four Predators and lascannons shoot from 2" further away than they seem.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Elites', 'lernaean-terminator-squad', { Lernaean: 9 }), unit('Elites', 'lernaean-terminator-squad', { Lernaean: 4 }), unit('Elites', 'headhunter-kill-team', { Headhunter: 9 }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], grow: [['lernaean-terminator-squad', 10]] },
  'white-scars': { why: 'Fast Tactical Squads reach markers first with Swift of Action, Ebon Keshig hit hard, and four Predators and lascannons cover them.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), TACTICAL(), unit('Heavy Assault', 'ebon-keshig', { Kharash: 10 }), unit('Heavy Assault', 'ebon-keshig', { Kharash: 5 }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5)], fill: [TACTICAL(), unit('Elites', 'golden-keshig', { 'Keshig Rider': 4 })], after: [['ebon-keshig', 10]] },
  'sons-of-horus': { why: 'Two Reaver squads and Justaerin, Vanguard units that shoot and fight with Death Dealers, behind four Predators and lascannon Heavy Support.',
    units: [...COMMAND, TACTICAL(), TACTICAL(), unit('Heavy Assault', 'reaver-attack-squad', { Reaver: 19 }), unit('Heavy Assault', 'reaver-attack-squad', { Reaver: 9 }), unit('Elites', 'justaerin-terminator-squad', { Justaerin: 10 }), ...GUNS, HEAVY_SUPPORT('Lascannon', 5), HEAVY_SUPPORT('Lascannon', 5)] },
};
// which plan each Legion uses ('strike' for the second plan), chosen by playing both (see the README)
const CHOICE = {};

function build(id, variant = CHOICE[id] || 'plan', file = `${__dirname}/${id}.json`) {
  const plan = variant === 'strike' ? Object.assign({ name: PLANS[id].name }, STRIKE[id]) : PLANS[id];
  const b = createBuilder(id, { name: plan.name, smart: true });
  const skipped = [];
  for (const u of plan.units) if (!b.add(u)) skipped.push(u[1]);
  for (const [uid, max] of plan.grow || []) b.growAll((sl) => sl.unit.unitId === uid, max);
  for (const f of plan.fill || []) b.add(f);
  // Tactical Squads that ride Rhinos stay at 10 (a Rhino carries 10); on foot they grow to 20
  const rhinos = [...plan.units, ...(plan.fill || [])].some((u) => u[1] === 'rhino');
  b.growAll((sl) => sl.unit.unitId === 'tactical-squad', rhinos ? 10 : 20);
  for (const [uid, max] of plan.after || []) b.growAll((sl) => sl.unit.unitId === uid, max);
  // whatever is left goes into the Heavy Support Squads
  b.growAll((sl) => sl.unit.unitId === 'heavy-support-squad', 10);
  return Object.assign(b.finish(file), { skipped, variant });
}

module.exports = { build, PLANS, STRIKE, CHOICE };
if (require.main === module) {
  for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PLANS)) {
    try {
      const r = build(id);
      console.log(`${id.padEnd(18)} ${r.total} pts ${r.errors.length ? 'ERRORS: ' + r.errors.join(' | ') : ''}${r.skipped.length ? ' SKIPPED: ' + r.skipped.join(',') : ''}\n    ${r.dets.join(' + ')}\n    ${r.units.join(', ')}`);
    } catch (e) { console.log(id, 'FAILED', e.stack.split('\n').slice(0, 3).join(' ')); }
  }
}
