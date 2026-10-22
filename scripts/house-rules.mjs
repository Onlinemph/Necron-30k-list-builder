// Optional house rules for a fan-codex army (data/parts/house-rules.json → { "houseRules": {...} }).
// The printed data is never edited: this compiles the overlay into `out.house`, which the engine swaps in
// while the army's "House rules" configuration choice is on, and adds that choice to `out.armyConfig`.
// Format: data/SCHEMA.md, "house-rules.json". Returns a list of problems (unknown ids, names, lists).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { norm, wkey } = require('../js/engine.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

export function applyHouse(out, src) {
  const problems = [];
  const bad = (m) => problems.push(`house rules: ${m}`);
  const toggle = src.toggle || {};
  if (!toggle.name || !toggle.group) bad('toggle needs a group id and a name');
  const when = [{ config: toggle.name }];
  const byId = new Map(out.units.map((u) => [u.id, u]));
  const house = { toggle: { group: toggle.group, name: toggle.name }, units: [], lists: [], weapons: { ranged: [], melee: [] }, wargear: [], rules: [], modifiers: { replace: {}, add: [] } };

  // ---------- units: patches of printed units, full replacements, and new units ----------
  for (const [id, p] of Object.entries(src.units || {})) {
    const printed = byId.get(id);
    if (!printed) { bad(`unknown unit ${id}`); continue; }
    if (p.replace) {
      if (p.replace.id !== id) bad(`${id}: a replacement keeps the unit id (got ${p.replace.id})`);
      house.units.push(Object.assign(clone(p.replace), { houseChanged: true }));
      continue;
    }
    const u = clone(printed);
    if (p.basePoints != null) u.basePoints = p.basePoints;
    for (const [name, mp] of Object.entries(p.models || {})) {
      const m = u.models.find((x) => x.name === name);
      if (!m) { bad(`${id}: unknown model ${name}`); continue; }
      if (mp.costPerExtra != null) m.costPerExtra = mp.costPerExtra;
      if (mp.profile) {
        for (const k of Object.keys(mp.profile)) if (!(k in m.profile)) bad(`${id}/${name}: unknown characteristic ${k}`);
        Object.assign(m.profile, mp.profile);
      }
      if (mp.addWargear) m.wargear = (m.wargear || []).concat(mp.addWargear);
      if (mp.addSpecialRules) m.specialRules = (m.specialRules || []).concat(mp.addSpecialRules);
    }
    if (p.addSpecialRules) u.specialRules = (u.specialRules || []).concat(p.addSpecialRules.filter((r) => !(u.specialRules || []).includes(r)));
    if (p.addUnitRules) u.unitRules = (u.unitRules || []).concat(p.addUnitRules);
    for (const [name, text] of Object.entries(p.unitRules || {})) {
      const r = (u.unitRules || []).find((x) => x.name === name);
      if (!r) { bad(`${id}: unknown unit rule ${name}`); continue; }
      r.text = text;
      delete r.note;
    }
    for (const [oid, op] of Object.entries(p.options || {})) {
      const o = (u.options || []).find((x) => x.id === oid);
      if (!o) { bad(`${id}: unknown option ${oid}`); continue; }
      for (const [name, pts] of Object.entries(op.choices || {})) {
        const c = o.choices.find((x) => x.name === name);
        if (!c) bad(`${id}/${oid}: unknown choice ${name}`); else c.points = pts;
      }
      if (op.excludes) o.excludes = (o.excludes || []).concat(op.excludes);
    }
    for (const o of p.addOptions || []) {
      if ((u.options || []).some((x) => x.id === o.id)) bad(`${id}: option id ${o.id} already exists`);
      u.options = (u.options || []).concat(Object.assign(clone(o), { house: true }));
    }
    if (p.note) u.note = u.note ? `${u.note} ${p.note}` : p.note;
    u.houseChanged = true;
    house.units.push(u);
  }
  for (const n of src.newUnits || []) {
    if (byId.has(n.id)) { bad(`new unit ${n.id} clashes with a printed unit`); continue; }
    house.units.push(Object.assign(clone(n), { when, house: true }));
  }

  // ---------- shared wargear lists ----------
  const lists = new Map(out.lists.map((l) => [l.id, l]));
  for (const [id, lp] of Object.entries(src.lists || {})) {
    const printed = lists.get(id);
    if (!printed) { bad(`unknown list ${id}`); continue; }
    const l = clone(printed);
    for (const [name, pts] of Object.entries(lp.points || {})) {
      const it = l.items.find((x) => x.name === name);
      if (!it) bad(`list ${id}: unknown item ${name}`); else it.points = pts;
    }
    for (const it of lp.add || []) {
      if (l.items.some((x) => x.name === it.name)) bad(`list ${id}: ${it.name} is already on the list`);
      l.items.push(Object.assign(clone(it), { house: true }));
    }
    house.lists.push(l);
  }

  // ---------- weapons: changed profiles (scoped to units) and new ones ----------
  const unitIds = new Set([...out.units.map((u) => u.id), ...house.units.map((u) => u.id)]);
  for (const kind of ['ranged', 'melee']) {
    for (const w of (src.weapons || {})[kind] || []) {
      if (w.replaces && !out.weapons[kind].some((x) => x.name === w.replaces)) bad(`${kind} weapon ${w.name}: replaces unknown weapon ${w.replaces}`);
      for (const id of [...(w.units || []), ...(w.exceptUnits || [])]) if (!unitIds.has(id)) bad(`weapon ${w.name}: unknown unit ${id}`);
      house.weapons[kind].push(clone(w));
    }
  }

  // ---------- rules and wargear text (new, or replacing the printed text) ----------
  const printedText = new Map();
  for (const k of Object.keys(out.rules)) for (const r of out.rules[k]) if (!printedText.has(norm(r.name))) printedText.set(norm(r.name), r);
  for (const w of out.wargear) if (!printedText.has(norm(w.name))) printedText.set(norm(w.name), w);
  for (const a of out.arkana) for (const w of a.wargear || []) if (!printedText.has(norm(w.name))) printedText.set(norm(w.name), w);
  for (const r of src.rules || []) house.rules.push(Object.assign(clone(r), printedText.has(norm(r.name)) ? { printed: printedText.get(norm(r.name)).text } : {}));
  for (const w of src.wargear || []) house.wargear.push(Object.assign(clone(w), printedText.has(norm(w.name)) ? { printed: printedText.get(norm(w.name)).text } : {}));

  // ---------- battlefield modifiers ----------
  const modIds = new Set(out.modifiers.modifiers.map((m) => m.id));
  for (const [id, m] of Object.entries((src.modifiers || {}).replace || {})) {
    if (!modIds.has(id)) bad(`replaces unknown modifier ${id}`);
    house.modifiers.replace[id] = clone(m);
  }
  for (const m of (src.modifiers || {}).add || []) {
    if (modIds.has(m.id)) bad(`modifier id ${m.id} already exists`);
    house.modifiers.add.push(clone(m));
  }
  for (const m of [...Object.values(house.modifiers.replace), ...house.modifiers.add]) {
    for (const id of [...((m.appliesTo || {}).units || []), ...((m.appliesTo || {}).exceptUnits || [])]) if (!unitIds.has(id)) bad(`modifier ${m.id}: unknown unit ${id}`);
  }

  // ---------- every name on a house unit has a profile or text somewhere ----------
  const weaponKeys = new Set([...out.weapons.ranged, ...out.weapons.melee, ...house.weapons.ranged, ...house.weapons.melee].map((w) => wkey(w.name)));
  const textKeys = new Set([...printedText.keys(), ...house.rules.map((r) => norm(r.name)), ...house.wargear.map((w) => norm(w.name)), ...(out.coreRules.rules || []).map(norm), ...(out.coreRules.undefinedInCodex || []).map((x) => norm(x.name))]);
  for (const u of out.units) for (const r of u.unitRules || []) textKeys.add(norm(r.name));
  for (const u of house.units) for (const r of u.unitRules || []) textKeys.add(norm(r.name));
  const srcReplaced = (id) => !!((src.units || {})[id] || {}).replace;
  const known = (n) => weaponKeys.has(wkey(n)) || weaponKeys.has(wkey(n).replace(/^twin(-linked)? /, '')) || textKeys.has(norm(n));
  // only what the overlay adds: printed names that don't resolve are the printed build's warnings
  for (const u of house.units) {
    const printed = byId.get(u.id);
    const own = (m, w) => !u.house && !(u.houseChanged && !printed) && printed && printed.models.some((pm) => pm.name === m.name && (pm.wargear || []).includes(w)) && !srcReplaced(u.id);
    for (const m of u.models) for (const w of m.wargear || []) if (!own(m, w) && !known(w)) bad(`${u.id}: wargear "${w}" has no profile or text`);
    for (const o of u.options || []) if (o.house || u.house || srcReplaced(u.id)) for (const c of o.choices || []) {
      if (c.list && !lists.has(c.list) && !c.list.startsWith('arkana') && !c.list.startsWith('techno')) bad(`${u.id}/${o.id}: unknown list ${c.list}`);
      if (c.name && o.kind !== 'swapModel' && !known(c.name)) bad(`${u.id}/${o.id}: choice "${c.name}" has no profile or text`);
    }
  }
  for (const l of house.lists) for (const it of l.items) if (it.house && !known(it.name)) bad(`list ${l.id}: "${it.name}" has no profile or text`);
  const ROLES = new Set(['Warlord', 'High Command', 'Command', 'Retinue', 'Elites', 'War Engine', 'Troops', 'Support', 'Transport', 'Heavy Assault', 'Heavy Transport', 'Armour', 'Recon', 'Fast Attack', 'Lord of War', 'Fortification']);
  for (const u of house.units) {
    if (!ROLES.has(u.role)) bad(`${u.id}: unknown role ${u.role}`);
    if (typeof u.basePoints !== 'number') bad(`${u.id}: basePoints not a number`);
    const models = new Set(u.models.map((m) => m.name));
    for (const o of u.options || []) {
      if (!['one', 'any', 'perModel', 'swapModel', 'upgrade'].includes(o.kind)) bad(`${u.id}/${o.id}: unknown kind ${o.kind}`);
      if (o.model && !models.has(o.model)) bad(`${u.id}/${o.id}: option model "${o.model}" not in models`);
      if (o.kind === 'swapModel' && !models.has(o.choices[0].name)) bad(`${u.id}/${o.id}: swap target not in models`);
      if (o.requires && !u.options.some((x) => x.id === o.requires)) bad(`${u.id}/${o.id}: requires unknown option ${o.requires}`);
      for (const x of o.excludes || []) if (!u.options.some((y) => y.id === x)) bad(`${u.id}/${o.id}: excludes unknown option ${x}`);
    }
  }

  // ---------- the switch, as an army configuration choice ----------
  out.armyConfig = out.armyConfig || { fixed: [], groups: [] };
  out.armyConfig.groups.push({ id: toggle.group, name: toggle.name, min: 0, max: 1, house: true, choices: [{ name: toggle.name, text: toggle.text }] });
  out.house = house;
  return problems;
}
