'use strict';
// Turns a list from the builder (a saved JSON list, a share link, or a list object) into units the simulator can
// fight with. Profiles, rules and wargear come from the builder's own engine, so war-moons, Prime Advantages,
// Legion rules and wargear modifiers apply exactly as they do in the app.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createEngine, wkey } = require('../../js/engine.js');
const { num, xOf, has } = require('./rules.cjs');

const ROOT = path.join(__dirname, '..', '..');
// BSData Legion lists don't carry the Legion's Trait on each unit, so the army id supplies it
const LEGION_TRAIT = {
  'dark-angels': 'Dark Angels', 'emperors-children': "Emperor's Children", 'iron-warriors': 'Iron Warriors', 'white-scars': 'White Scars',
  'space-wolves': 'Space Wolves', 'imperial-fists': 'Imperial Fists', 'night-lords': 'Night Lords', 'blood-angels': 'Blood Angels',
  'iron-hands': 'Iron Hands', 'world-eaters': 'World Eaters', 'ultramarines': 'Ultramarines', 'death-guard': 'Death Guard',
  'thousand-sons': 'Thousand Sons', 'sons-of-horus': 'Sons of Horus', 'word-bearers': 'Word Bearers', 'salamanders': 'Salamanders',
  'raven-guard': 'Raven Guard', 'alpha-legion': 'Alpha Legion',
};
const cache = new Map();
function loadArmyData(id) {
  if (cache.has(id)) return cache.get(id);
  const read = (f) => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), { window }); return window; };
  const common = cache.get('__common') || read('data-common.js').ARMY_COMMON;
  cache.set('__common', common);
  const D = read(`data-${id}.js`).ARMY_DATA[id];
  if (!D) throw new Error(`No army data for "${id}"`);
  const out = { D, common, E: createEngine(D), weapons: weaponIndex(D, common) };
  cache.set(id, out);
  return out;
}

/** A list from a share link ("...#a=<base64>"), a JSON file path, a JSON string or an object. */
function readList(src) {
  if (typeof src === 'object') return src;
  const s = String(src).trim();
  if (/#a=/.test(s)) return JSON.parse(Buffer.from(s.slice(s.indexOf('#a=') + 3), 'base64').toString('utf8'));
  if (s.startsWith('{')) return JSON.parse(s);
  return JSON.parse(fs.readFileSync(s, 'utf8'));
}

// ---------- weapons ----------
function weaponIndex(D, common) {
  const idx = { ranged: new Map(), melee: new Map(), exactMelee: new Map() };
  for (const kind of ['ranged', 'melee']) {
    for (const w of [...(D.weapons[kind] || []), ...(common.weapons[kind] || [])]) {
      if (kind === 'melee' && !idx.exactMelee.has(w.name.toLowerCase())) idx.exactMelee.set(w.name.toLowerCase(), w);
      for (const key of [w.name.toLowerCase(), wkey(w.name), wkey(w.name.replace(/\s*\(.*\)\s*$/, ''))]) {
        if (!idx[kind].has(key)) idx[kind].set(key, w);
      }
    }
  }
  return idx;
}
const COUNT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
/** "2 Hull Mounted Shadow Blasters" -> 2; "Two Sponson Mounted Lascannons" -> 2; anything else -> 1. */
const itemCount = (item) => {
  const m = String(item).match(/^(\d+|one|two|three|four|five|six)\s+/i);
  if (!m) return 1;
  return /^\d+$/.test(m[1]) ? +m[1] : COUNT_WORDS[m[1].toLowerCase()];
};
/** A weapon's firing modes as separate profiles (most weapons have one). */
const modesOf = (w) => (w.modes && w.modes.length ? w.modes.map((m) => Object.assign({}, m, { name: `${w.name} (${m.name || 'mode'})`, base: w.name, traits: w.traits })) : [Object.assign({}, w, { base: w.name })]);
function resolveItem(weapons, item) {
  const out = { ranged: [], melee: [] };
  const look = (name) => {
    const r = weapons.ranged.get(name.toLowerCase()) || weapons.ranged.get(wkey(name)) || weapons.ranged.get(wkey(name).replace(/^twin(-linked)? /, ''));
    if (r) out.ranged.push(...modesOf(r));
    // an item that is a gun only counts as a melee weapon if a melee profile has exactly its name
    // (so a "Bolter" doesn't pick up "Bolter with Bayonet")
    const m = r ? weapons.exactMelee.get(name.toLowerCase()) : weapons.melee.get(name.toLowerCase()) || weapons.melee.get(wkey(name)) || weapons.melee.get(wkey(name).replace(/^twin(-linked)? /, ''));
    if (m) out.melee.push(...modesOf(m));
  };
  look(item);
  // a paired item ("Eternity Blade and Praesidium Shield", "Bolter and bolt pistol") is looked up part by part
  if (!out.ranged.length && !out.melee.length && / and /i.test(item)) for (const part of item.split(/ and /i)) look(part);
  return out;
}
const DISCIPLINES = /^(Biomancy|Divination|Pyromancy|Telekinesis|Telepathy|Thaumaturgy|Anathemata|Malignant|Navis Astrologis|Fateweaving|Stormcalling|Runecasting|Power of the Waaagh!)$/;
const CCW = { name: 'Close combat weapon', base: 'Close combat weapon', IM: 'I', AM: 'A', SM: 'S', AP: '–', D: 1, specialRules: [], traits: [] };

// ---------- footprint ----------
/** Base radius in inches, from the unit type and Bulky (X). */
function baseRadius(unitType, rules, profile) {
  const t = unitType || '';
  if (/Titan/.test(t)) return 5;
  if (/Knight/.test(t)) return 3;
  if (/Super-heavy|Super-Heavy/.test(t)) return 3.5;
  if (/Vehicle|Flyer/.test(t)) return /Rapid|Light/.test(t) ? 1.8 : 2.5;
  if (/Walker/.test(t)) return /Heavy/.test(t) ? 2.2 : 1.5;
  if (/Paragon|Primarch/.test(t)) return 1;
  const bulky = xOf(rules, 'Bulky') || 1;
  if (/Cavalry/.test(t)) return 1;
  return 0.5 + 0.12 * (bulky - 1) + (num(profile.W, 1) >= 3 ? 0.1 : 0);
}
const isVehicleProfile = (p) => p.FRONT != null || p.HP != null;

// ---------- units ----------
let nextUnit = 1;
/**
 * Build one fighting unit from a slot of a list.
 * Each model carries its profile, wounds, rules and weapons; the unit carries position and battle state.
 */
function buildUnit(armyId, list, slot, detachment, side) {
  const { D, E, weapons } = loadArmyData(armyId);
  E.setArmy(list);
  const sel = slot.unit;
  const def = D.units.find((u) => u.id === sel.unitId);
  if (!def) throw new Error(`Unknown unit ${sel.unitId} in ${armyId}`);
  const s = Object.assign({ options: {}, counts: {} }, sel);
  const rows = E.effectiveModels(s, slot).filter((r) => r.count > 0);
  // Thin the Ranks: does the unit's Prime Advantage improve any model's characteristics?
  let primeStats = false;
  if (slot.prime && s.primeAdvantage) {
    const plain = E.effectiveModels(Object.assign({}, s, { primeAdvantage: null }), slot).filter((r) => r.count > 0);
    primeStats = rows.some((r, i) => plain[i] && JSON.stringify(r.profile) !== JSON.stringify(plain[i].profile));
  }
  const models = [];
  for (const r of rows) {
    const ranged = [], melee = [];
    for (const item of r.items) {
      const found = resolveItem(weapons, item);
      const n = itemCount(item);
      for (const w of found.ranged) ranged.push(Object.assign({}, w, { count: n }));
      for (const w of found.melee) melee.push(w);
    }
    let p = r.profile;
    const vehicle = isVehicleProfile(p);
    // Swift of Action (White Scars): +2 Movement for non-vehicles (taken every turn); Cult Arcana (Thousand Sons): +1 WP
    if (armyId === 'white-scars' && !vehicle && num(p.M, 0) >= 1) p = Object.assign({}, p, { M: num(p.M, 0) + 2 });
    if (armyId === 'thousand-sons' && !vehicle && p.WP != null) p = Object.assign({}, p, { WP: num(p.WP, 7) + 1 });
    const traits = [...new Set([...(r.traits || []), ...(def.traits || []), ...(LEGION_TRAIT[armyId] ? [LEGION_TRAIT[armyId]] : [])])];
    // every model can fight with a basic close combat profile; grenades that only hurt vehicles don't count
    if (!vehicle && p.WS != null && !melee.some((w) => !has(w.specialRules, 'Detonation'))) melee.push(CCW);
    for (let i = 0; i < r.count; i++) {
      models.push({
        name: r.name, p, rules: r.rules || [], unitType: r.unitType || '', vehicle, traits, items: r.items || [],
        wounds: vehicle ? num(p.HP, 1) : num(p.W, 1), maxWounds: vehicle ? num(p.HP, 1) : num(p.W, 1),
        ranged, melee, sergeant: /Sergeant|Command|Champion|Alpha/.test(r.unitType || '') || /Alpha|Sergeant|Champion|Exemplar|Prefector|Headsman|Huntmaster/.test(r.name),
      });
    }
  }
  const rules = [...new Set(models.flatMap((m) => m.rules))];
  const unitTraits = [...new Set(models.flatMap((m) => m.traits))];
  const unitType = models[0] ? models[0].unitType : '';
  const capacity = models.reduce((t, m) => t + num(m.p.CAPACITY, 0), 0);
  const unit = {
    uid: nextUnit++, side, armyId, id: def.id, name: def.name, role: slot.role || def.role, pts: E.unitPoints(s, slot),
    traits: unitTraits, legion: LEGION_TRAIT[armyId] || null, rules, unitType, models,
    prime: !!slot.prime, primeAdvantage: sel.primeAdvantage || null, primeStats, detachment: detachment.name,
    vehicle: models.every((m) => m.vehicle), capacity, passengers: [], embarkedIn: null,
    x: 0, y: 0, r: 0, statuses: new Set(), lockedWith: new Set(), reserve: null, arrived: true, destroyed: false,
    // a Psyker has the Trait, or a Psychic Discipline taken as wargear
    warlord: false, psyker: armyId === 'thousand-sons' || has(rules, 'Psyker') || unitTraits.includes('Psyker') || rows.some((r) => r.items.some((i) => DISCIPLINES.test(i))),
    turn: {},
  };
  unit.r = footprint(unit);
  return unit;
}
/** Radius of the circle a unit occupies: its models' bases packed at about 1" spacing. */
function footprint(unit) {
  const alive = unit.models.filter((m) => m.wounds > 0);
  if (!alive.length) return 0;
  const br = baseRadius(alive[0].unitType, alive[0].rules, alive[0].p);
  if (alive.length === 1) return br;
  return Math.sqrt(alive.length) * (br + 0.5) * 1.05;
}

/** Every unit in a list, one side of the battle. */
function buildArmy(src, side) {
  const list = readList(src);
  const units = [];
  for (const det of list.detachments || []) {
    for (const slot of det.slots || []) {
      if (!slot.unit) continue;
      const armyId = det.allyOf || list.faction;
      units.push(buildUnit(armyId, list, slot, det, side));
    }
  }
  return { side, faction: list.faction, name: list.name || list.faction, pointsLimit: list.pointsLimit || 3000, units, list };
}

const alive = (u) => u.models.filter((m) => m.wounds > 0);
const isDestroyed = (u) => !u.models.some((m) => m.wounds > 0);
const unitPointsLeft = (u) => u.pts * (alive(u).length / u.models.length);

module.exports = { LEGION_TRAIT, loadArmyData, readList, buildArmy, buildUnit, footprint, alive, isDestroyed, unitPointsLeft, resolveItem, itemCount, CCW };
