#!/usr/bin/env node
// Converts BSData's Horus Heresy 3rd edition catalogues (BattleScribe JSON) into this builder's data format.
//
//   node scripts/import-bsdata.mjs <path to a clone of github.com/BSData/horus-heresy-3rd-edition>
//
// Writes data/bsdata/armies.json, data/bsdata/common.json (weapons, rules, wargear shared by every
// BSData army) and data/bsdata/<army>/parts/units.json. scripts/build-data.mjs then builds them like any
// other army.
//
// BattleScribe data is a tree of selection entries with constraints and conditional modifiers. This
// importer resolves it statically for each army: conditions that test which catalogue (Legion, faction)
// the force belongs to are evaluated; conditions that depend on what else is in the roster are evaluated
// against an empty roster, so the builder shows each unit's default state.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src || !existsSync(src)) {
  console.error('usage: node scripts/import-bsdata.mjs <path to BSData/horus-heresy-3rd-edition clone>');
  process.exit(1);
}

// ---------- load everything ----------
const files = readdirSync(src).filter((f) => f.endsWith('.json'));
const cats = {}; // id -> { file, data }
let gst = null;
for (const f of files) {
  const j = JSON.parse(readFileSync(join(src, f), 'utf8'));
  if (j.gameSystem) gst = { file: f, data: j.gameSystem };
  else if (j.catalogue) cats[j.catalogue.id] = { file: f, data: j.catalogue };
}
const byId = new Map();
function index(node) {
  if (Array.isArray(node)) { for (const n of node) index(n); return; }
  if (!node || typeof node !== 'object') return;
  if (node.id && node.name !== undefined && !byId.has(node.id)) byId.set(node.id, node);
  for (const [k, v] of Object.entries(node)) if (k !== 'conditions' && k !== 'conditionGroups' && typeof v === 'object') index(v);
}
index(gst.data);
for (const c of Object.values(cats)) index(c.data);

const POINTS = (gst.data.costTypes.find((c) => /^Point/.test(c.name)) || {}).id;
const catName = new Map([...gst.data.categoryEntries, ...Object.values(cats).flatMap((c) => c.data.categoryEntries || [])].map((c) => [c.id, c.name]));

// ---------- armies ----------
const LEGIONS = ['Dark Angels', "Emperor's Children", 'Iron Warriors', 'White Scars', 'Space Wolves', 'Imperial Fists', 'Night Lords',
  'Blood Angels', 'Iron Hands', 'World Eaters', 'Ultramarines', 'Death Guard', 'Thousand Sons', 'Sons of Horus', 'Word Bearers',
  'Salamanders', 'Raven Guard', 'Alpha Legion'];
const fileTitle = (f) => basename(f, '.json');
function armyList() {
  const out = [];
  for (const [id, c] of Object.entries(cats)) {
    const d = c.data;
    const roots = (d.entryLinks || []).length + (d.selectionEntries || []).length;
    const name = fileTitle(c.file);
    if (d.library || !roots) continue;
    if (['Assets', 'Battlefield Assets', 'Battlefield Fortifications'].includes(name)) continue; // add-ons, not armies
    const group = LEGIONS.includes(name) ? 'Legiones Astartes' : ['Shattered Legions', 'Blackshields'].includes(name) ? 'Legiones Astartes' : 'Imperium & Traitors';
    out.push({ id: slug(name), name, catalogue: id, group });
  }
  return out.sort((a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : a.group.localeCompare(b.group)));
}
function slug(s) { return s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// catalogues an army's force is an instance of: its own plus everything it imports
function catalogueSet(catId) {
  const set = new Set([catId]);
  const walk = (id) => {
    const c = cats[id];
    if (!c) return;
    for (const l of c.data.catalogueLinks || []) if (!set.has(l.targetId)) { set.add(l.targetId); walk(l.targetId); }
  };
  walk(catId);
  return set;
}

// ---------- conditions (static) ----------
let CTX = { cats: new Set() };
function condTrue(c) {
  const id = c.childId;
  const isCat = cats[id] || (gst && gst.data.id === id);
  let n = 0;
  if (isCat) n = CTX.cats.has(id) ? 1 : 0;
  // anything else depends on the roster; assume nothing is selected yet
  switch (c.type) {
    case 'instanceOf': return isCat ? CTX.cats.has(id) : false;
    case 'notInstanceOf': return isCat ? !CTX.cats.has(id) : true;
    case 'atLeast': return n >= c.value;
    case 'greaterThan': return n > c.value;
    case 'atMost': return n <= c.value;
    case 'lessThan': return n < c.value;
    case 'equalTo': return n === c.value;
    case 'notEqualTo': return n !== c.value;
    default: return false;
  }
}
function groupTrue(g) {
  const parts = [...(g.conditions || []).map(condTrue), ...(g.conditionGroups || []).map(groupTrue)];
  if (!parts.length) return true;
  return g.type === 'or' ? parts.some(Boolean) : parts.every(Boolean);
}
function modApplies(m) {
  if (m.repeats && m.repeats.length) return false; // "per X selected" — depends on the roster
  const parts = [...(m.conditions || []).map(condTrue), ...(m.conditionGroups || []).map(groupTrue)];
  return parts.every(Boolean);
}
function allMods(node) {
  const out = [...(node.modifiers || [])];
  for (const g of node.modifierGroups || []) {
    if (!groupTrue({ type: 'and', conditions: g.conditions, conditionGroups: g.conditionGroups })) continue;
    out.push(...allMods(g));
  }
  return out;
}
function applyField(node, field, value) {
  let v = value;
  for (const m of allMods(node)) {
    if (m.field !== field || !modApplies(m)) continue;
    if (m.type === 'set') v = m.value;
    else if (m.type === 'increment') v = (Number(v) || 0) + Number(m.value);
    else if (m.type === 'decrement') v = (Number(v) || 0) - Number(m.value);
    else if (m.type === 'append') v = `${v} ${m.value}`;
  }
  return v;
}

// ---------- entry resolution ----------
/** A link merged with its target: the link's name, constraints, costs and modifiers win. */
function resolve(e) {
  if (e.targetId && (e.type === 'selectionEntry' || e.type === 'selectionEntryGroup' || e.type === 'rule' || e.type === 'profile' || e.type === 'infoGroup')) {
    const t = byId.get(e.targetId);
    if (!t) return null;
    const base = resolve(t) || t;
    const merged = Object.assign({}, base, {
      name: e.name || base.name,
      linkId: e.id,
      hidden: !!(e.hidden || base.hidden),
      constraints: [...(base.constraints || []), ...(e.constraints || [])],
      costs: e.costs && e.costs.length ? e.costs : base.costs,
      modifiers: [...(base.modifiers || []), ...(e.modifiers || [])],
      modifierGroups: [...(base.modifierGroups || []), ...(e.modifierGroups || [])],
      categoryLinks: e.categoryLinks && e.categoryLinks.length ? e.categoryLinks : base.categoryLinks,
      baseCategoryLinks: base.baseCategoryLinks || base.categoryLinks || [],
      entryLinks: [...(base.entryLinks || []), ...(e.entryLinks || [])],
      infoLinks: [...(base.infoLinks || []), ...(e.infoLinks || [])],
      kind: e.type === 'selectionEntryGroup' ? 'group' : base.kind,
    });
    // links often rename what they point at ("Legion Sponson Weapons" → "Sponsons #1")
    merged.name = String(applyField(merged, 'name', merged.name)).trim();
    return merged;
  }
  const own = Object.assign({}, e, { kind: e.kind || (e.type === 'selectionEntryGroup' || (!e.type && (e.selectionEntries || e.entryLinks) && !e.costs && e.defaultSelectionEntryId !== undefined) ? 'group' : e.kind) });
  own.name = String(applyField(own, 'name', own.name ?? '')).trim();
  return own;
}
const isHidden = (e) => !!applyField(e, 'hidden', !!e.hidden);
function children(e) {
  const out = [];
  for (const c of e.selectionEntries || []) out.push(resolve(c));
  for (const g of e.selectionEntryGroups || []) out.push(Object.assign(resolve(g), { kind: 'group' }));
  for (const l of e.entryLinks || []) {
    const r = resolve(l);
    if (!r) continue;
    if (l.type === 'selectionEntryGroup') r.kind = 'group';
    out.push(r);
  }
  return out.filter((x) => x && !isHidden(x));
}
function cost(e) {
  const c = (e.costs || []).find((x) => x.typeId === POINTS || /^Point/.test(x.name || ''));
  return Math.round(Number(applyField(e, POINTS, c ? c.value : 0)) || 0);
}
function limits(e) {
  let min = 0, max = null, unitMax = null, rosterMax = null;
  for (const c of e.constraints || []) {
    if (c.field !== 'selections') continue;
    const v = Number(applyField(e, c.id, c.value));
    if (c.scope === 'parent' && c.type === 'min') min = Math.max(min, v);
    if (c.scope === 'parent' && c.type === 'max' && v >= 0) max = max === null ? v : Math.min(max, v);
    if (c.scope === 'unit' && c.type === 'max' && v >= 0) unitMax = v;
    if ((c.scope === 'roster' || c.scope === 'force') && c.type === 'max' && v >= 0) rosterMax = v;
  }
  return { min, max, unitMax, rosterMax };
}

// ---------- profiles, rules, traits ----------
const STAT = { 'Front Armour': 'FRONT', 'Side Armour': 'SIDE', 'Rear Armour': 'REAR', 'Transport Capacity': 'CAPACITY', 'Primary Armour': 'PRIMARY', 'Exposed Armour': 'EXPOSED', Front: 'FRONT', Rear: 'REAR', Primary: 'PRIMARY', Exposed: 'EXPOSED', Transport: 'CAPACITY' };
const MODEL_PROFILES = ['Profile', 'Vehicle', 'Knight', 'Battlefield fortification', 'Ordinatus Carriage', 'Ordinatus Gun'];
function profileStats(p) {
  const out = {};
  let type = null;
  for (const ch of p.characteristics || []) {
    const val = applyField(p, ch.typeId, ch.$text ?? '');
    if (ch.name === 'Type') { type = val; continue; }
    if (ch.name === 'Access Points') continue;
    const k = STAT[ch.name] || ch.name.toUpperCase();
    out[k] = /^-?\d+$/.test(String(val)) ? Number(val) : (val === '-' ? '–' : val);
  }
  return { stats: out, type };
}
function profilesOf(e) {
  const list = [...(e.profiles || [])];
  for (const l of e.infoLinks || []) if (l.type === 'profile') { const t = byId.get(l.targetId); if (t) list.push(Object.assign({}, t, { name: l.name || t.name, modifiers: [...(t.modifiers || []), ...(l.modifiers || [])] })); }
  return list.filter((p) => !isHidden(p));
}
function modelProfile(e) {
  const ps = profilesOf(e);
  const titan = ps.filter((p) => /^Titan /.test(p.typeName));
  if (titan.length) {
    const prof = {};
    let type = null;
    for (const p of titan) { const s = profileStats(p); prof[p.typeName.replace(/^Titan /, '').toUpperCase()] = s.stats; type = type || s.type; }
    return { profile: prof, unitType: type || 'Titan' };
  }
  const p = ps.find((x) => MODEL_PROFILES.includes(x.typeName));
  if (!p) return null;
  const s = profileStats(p);
  return { profile: s.stats, unitType: s.type || p.typeName };
}
function rulesOf(e) {
  const rules = [], traits = [];
  for (const l of e.infoLinks || []) {
    if (isHidden(l)) continue;
    const t = byId.get(l.targetId);
    if (!t) continue;
    const name = applyField(l, 'name', l.name || t.name);
    if (l.type === 'rule') rules.push(name);
    if (l.type === 'profile' && t.typeName === 'Traits') traits.push(name);
  }
  for (const r of e.rules || []) if (!isHidden(r)) rules.push(r.name);
  return { rules, traits };
}

// ---------- weapons / shared text ----------
const splitList = (s) => {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(s || '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { if (cur.trim() && cur.trim() !== '-') out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() && cur.trim() !== '-') out.push(cur.trim());
  return out;
};
function collectCommon() {
  const ranged = new Map(), melee = new Map(), rules = new Map(), wargear = new Map(), traits = new Map(), reactions = new Map(), gambits = new Map();
  const walk = (node, page) => {
    if (Array.isArray(node)) { node.forEach((n) => walk(n)); return; }
    if (!node || typeof node !== 'object') return;
    if (node.typeName === 'Ranged Weapon' || node.typeName === 'Melee Weapon') {
      const c = Object.fromEntries((node.characteristics || []).map((x) => [x.name, x.$text ?? '']));
      const w = { name: node.name, page: node.page || null, specialRules: splitList(c['Special Rules']), traits: splitList(c.Traits), modes: null };
      const num = (v) => (/^-?\d+$/.test(String(v)) ? Number(v) : (v === '-' ? '–' : v));
      if (node.typeName === 'Ranged Weapon') { Object.assign(w, { R: num(c.R), FP: num(c.FP), RS: num(c.RS), AP: num(c.AP), D: num(c.D) }); if (!ranged.has(node.name)) ranged.set(node.name, w); }
      else { Object.assign(w, { IM: num(c.IM), AM: num(c.AM), SM: num(c.SM), AP: num(c.AP), D: num(c.D) }); if (!melee.has(node.name)) melee.set(node.name, w); }
    }
    if (node.typeName === 'Wargear' && !wargear.has(node.name)) {
      const c = Object.fromEntries((node.characteristics || []).map((x) => [x.name, x.$text ?? '']));
      wargear.set(node.name, { name: node.name, page: node.page || null, text: c.Description || c.Summary || '' });
    }
    if (node.typeName === 'Traits' && !traits.has(node.name)) {
      const c = Object.fromEntries((node.characteristics || []).map((x) => [x.name, x.$text ?? '']));
      traits.set(node.name, { name: node.name, page: node.page || null, text: c.Description || '' });
    }
    if (node.typeName === 'Reaction' && !reactions.has(node.name)) {
      const c = Object.fromEntries((node.characteristics || []).map((x) => [x.name, x.$text ?? '']));
      reactions.set(node.name, { name: node.name, page: node.page || null, text: ['Trigger', 'Cost', 'Target', 'Process'].map((k) => c[k] ? `${k}: ${c[k]}` : '').filter(Boolean).join('\n\n') || c.Summary || '' });
    }
    if (node.typeName === 'Gambit' && !gambits.has(node.name)) {
      const c = Object.fromEntries((node.characteristics || []).map((x) => [x.name, x.$text ?? '']));
      gambits.set(node.name, { name: node.name, page: node.page || null, text: c.Description || c.Summary || '' });
    }
    if (node.description !== undefined && node.name && !node.typeName && !node.characteristics && !rules.has(node.name) && /^[0-9a-f]{4}-/.test(node.id || '') && !node.type) {
      rules.set(node.name, { name: node.name, page: node.page || null, text: node.description });
    }
    for (const [k, v] of Object.entries(node)) if (typeof v === 'object' && k !== 'conditions') walk(v);
  };
  walk(gst.data);
  for (const c of Object.values(cats)) walk(c.data);
  return {
    weapons: { ranged: [...ranged.values()], melee: [...melee.values()] },
    wargear: [...wargear.values()],
    rules: { specialRules: [...rules.values()], traits: [...traits.values()], reactions: [...reactions.values()], gambits: [...gambits.values()] },
  };
}

// ---------- units ----------
const ROLES = new Set(['Warlord', 'High Command', 'Command', 'Retinue', 'Elites', 'War Engine', 'Troops', 'Support', 'Transport', 'Heavy Assault', 'Heavy Transport', 'Armour', 'Recon', 'Fast Attack', 'Lord of War', 'Fortification']);
function roleName(l) {
  let n = (catName.get(l.targetId) || l.name || '').replace(/\s+-\s+.*$/, '').trim();
  if (/^war[- ]engine$/i.test(n)) n = 'War Engine';
  if (/^paragon$/i.test(n)) n = 'Warlord';
  return ROLES.has(n) ? n : null;
}
/** The primary category if it's a battlefield role, else the first category that is one. */
function roleOf(e) {
  const links = (e.categoryLinks || []).filter((l) => !isHidden(l));
  const prim = links.find((l) => l.primary);
  return (prim && roleName(prim)) || links.map(roleName).find(Boolean)
    // Rewards of Treachery / Exemplars of the Legion links replace the categories; the unit keeps its own role
    || (e.baseCategoryLinks || []).map(roleName).find(Boolean) || homeRole.get(e.targetId) || homeRole.get(e.id) || null;
}
// A unit's role as its home catalogue lists it, for links (Rewards of Treachery, Exemplars) that re-categorise it
const homeRole = new Map();
for (const c of Object.values(cats)) for (const l of c.data.entryLinks || []) {
  const r = (l.categoryLinks || []).map(roleName).find(Boolean);
  if (r && !homeRole.has(l.targetId)) homeRole.set(l.targetId, r);
}

/** A special category such as "Rewards of Treachery" that the link puts the unit under. */
function specialCategory(e) {
  const prim = (e.categoryLinks || []).find((l) => l.primary);
  const n = prim && (catName.get(prim.targetId) || prim.name);
  return n && !roleName(prim) ? n : null;
}

const skipped = [];
function convertUnit(e, armyId) {
  const role = roleOf(e);
  if (!role) { skipped.push(`${e.name} (${[...(e.categoryLinks || [])].map((l) => catName.get(l.targetId) || l.name).join('/') || 'no role'})`); return null; }
  const unit = {
    id: slug(e.name), name: e.name, role, page: e.page || null, limit: null, unique: false,
    basePoints: 0, composition: '', models: [], traits: [], specialRules: [], unitRules: [], options: [], note: null,
  };
  const special = specialCategory(e);
  if (special) unit.note = `Taken as ${special}.`;
  const lim = limits(e);
  if (lim.rosterMax === 1) unit.unique = /^[A-Z][a-z]+ [A-Z]/.test(e.name) && !/Squad|Battery|Detachment|Cohort/.test(e.name);
  if (lim.rosterMax === 1 && !unit.unique) unit.limit = '0-1';
  const { rules, traits } = rulesOf(e);
  unit.specialRules = rules;
  unit.traits = traits.filter((t) => !/^\[/.test(t));
  let points = cost(e);
  const opts = [];
  const seenOpt = new Set();
  const optId = (s) => { let id = slug(s).slice(0, 40) || 'opt'; while (seenOpt.has(id)) id += '-x'; seenOpt.add(id); return id; };

  // models: direct children or inside groups
  const modelEntries = [];
  const groupSizes = [];
  const scan = (node, inGroup) => {
    for (const c of children(node)) {
      if (c.kind === 'group') {
        const kids = children(c);
        if (kids.length && kids.every((k) => k.type === 'model')) { const l = limits(c); groupSizes.push(l); for (const k of kids) modelEntries.push({ e: k, grouped: true }); }
        else scan(c, true);
      } else if (c.type === 'model') modelEntries.push({ e: c, grouped: inGroup });
    }
  };
  // crews: a unit made of repeatable sub-units ("Rapier Crew" ×1–4, each a gun and its crewmen)
  const crews = e.type === 'model' ? [] : children(e).filter((c) => c.type === 'unit');
  if (e.type === 'model') modelEntries.push({ e, self: true });
  else scan(e, false);
  if (!modelEntries.length && crews.length === 1) {
    const crew = crews[0];
    const cl = limits(crew);
    const kids = children(crew).filter((k) => k.type === 'model');
    const driver = kids.find((k) => /carrier|gun|carriage|battery|platform/i.test(k.name)) || kids.find((k) => limits(k).min === 1 && limits(k).max === 1) || kids[0];
    if (driver) {
      unit.note = [unit.note, `Taken as ${cl.min}–${cl.max} ${crew.name}s; each has ${kids.map((k) => `${limits(k).min} ${k.name}`).join(' and ')}.`].filter(Boolean).join(' ');
      const crewCost = cost(crew) + kids.reduce((a, k) => a + limits(k).min * cost(k), 0);
      for (const k of kids) {
        const kl = limits(k);
        const prof = modelProfile(k) || { profile: {}, unitType: '' };
        const model = { name: k.name, min: k === driver ? cl.min : 0, max: k === driver ? cl.max : null, costPerExtra: k === driver ? crewCost : 0,
          profile: prof.profile, wargear: [], unitType: prof.unitType, specialRules: rulesOf(k).rules.filter((r) => !rules.includes(r)) };
        if (k !== driver) model.scaleWith = { model: driver.name, count: kl.min };
        if (k === driver) points += cl.min * crewCost;
        walkOptions(k, model, unit, opts, optId, (p) => { points += p * (k === driver ? cl.min : kl.min * cl.min); });
        unit.models.push(model);
      }
      // the crew's own options (e.g. its gun) belong to the driver model, one per crew
      const drv = unit.models.find((m) => m.name === driver.name);
      walkOptions(crew, Object.assign(drv, {}), unit, opts, optId, (p) => { points += p * cl.min; });
      unit.basePoints = points;
      unit.options = opts;
      unit.composition = `${cl.min} ${crew.name}${cl.min === 1 ? '' : 's'}`;
      return unit;
    }
  }
  if (!modelEntries.length) { skipped.push(`${e.name} (no models)`); return null; }
  if (groupSizes.length === 1 && groupSizes[0].max) unit.size = { min: groupSizes[0].min, max: groupSizes[0].max };

  for (const { e: m, self } of modelEntries) {
    const l = self ? { min: 1, max: 1 } : limits(m);
    const prof = modelProfile(m) || (self ? null : modelProfile(e)) || { profile: {}, unitType: '' };
    const mr = rulesOf(m);
    const model = {
      name: m.name, min: l.min, max: l.max === null ? (unit.size ? null : Math.max(l.min, 1)) : l.max,
      costPerExtra: self ? 0 : cost(m), profile: prof.profile, wargear: [], unitType: prof.unitType,
      specialRules: self ? [] : mr.rules.filter((r) => !rules.includes(r)),
    };
    if (self) { points += 0; } else points += model.min * model.costPerExtra;
    // wargear and options of this model
    const target = self ? e : m;
    walkOptions(target, model, unit, opts, optId, (p) => { points += p * Math.max(model.min, 1); });
    unit.models.push(model);
  }
  // nothing mandatory: one model type means "take it"; several make a menu the player picks from
  if (!unit.size && unit.models.every((m) => !m.min)) {
    if (unit.models.length === 1) { unit.models[0].min = 1; points += unit.models[0].costPerExtra; }
    else unit.size = { min: 1, max: unit.models.reduce((a, m) => a + (m.max || 1), 0) };
  }
  // unit-level options (single-model units already handled above)
  if (e.type !== 'model') walkOptions(e, null, unit, opts, optId, (p) => { points += p; });
  unit.basePoints = points;
  unit.options = opts;
  unit.composition = unit.models.filter((m) => m.min).map((m) => `${m.min} ${m.name}`).join(', ') || (unit.size ? `${unit.size.min}–${unit.size.max} models` : '');
  return unit;
}

/** Collect default wargear and turn optional entries/groups into Options. */
function walkOptions(node, model, unit, opts, optId, addMandatoryCost) {
  const multi = model && (model.max === null || model.max > 1);
  const target = model ? model.name : null;
  for (const c of children(node)) {
    if (c.type === 'model') continue;
    // army-building bookkeeping, not wargear: Prime/Warlord markers and detachment counters
    if (/^Prime Unit$|^Warlord$|Detachment Choice/i.test(c.name)) continue;
    if ((c.costs || []).some((x) => /Detachment\(s\)/.test(x.name) && x.value)) continue;
    const l = limits(c);
    if (c.kind === 'group') {
      // a group with no limits of its own is just a folder: each thing inside is its own option
      if (!(c.constraints || []).some((x) => x.field === 'selections') && !c.defaultSelectionEntryId) {
        walkOptions(c, model, unit, opts, optId, addMandatoryCost);
        continue;
      }
      const items = flatItems(c);
      if (!items.length) continue;
      const gl = limits(c);
      const defId = c.defaultSelectionEntryId;
      // the default is the item the model must have (min 1), or the group's default when the group needs a pick
      let def = items.find((i) => i.min >= 1) || (gl.min >= 1 ? items.find((i) => defId && (i.id === defId || i.linkId === defId)) : null);
      if (gl.min >= 1 && !def && items.length === 1) def = items[0];
      if (def) {
        if (model) model.wargear.push(def.name); else unit.models.forEach((m) => m.wargear.push(def.name));
        if (def.cost) addMandatoryCost(def.cost);
      }
      const choices = items.filter((i) => i !== def).map((i) => ({ name: i.name, points: Math.max(0, i.cost - (def ? def.cost : 0)) }));
      if (!choices.length) continue;
      const replaces = def ? [def.name] : [];
      const groupMax = gl.max === null ? choices.length : gl.max;
      const label = c.name.replace(/[:\s]+$/, '');
      const how = replaces.length ? (/exchang/i.test(label) ? '' : ` (exchanges the ${replaces[0]})`) : groupMax === 1 ? ' (choose one)' : ` (up to ${groupMax})`;
      const o = { id: optId(`${target || 'unit'}-${c.name}`), text: `${model ? `${model.name}: ` : ''}${label}${how}`, model: target, replaces, choices };
      if (multi) { o.kind = 'perModel'; o.max = gl.unitMax !== null ? { fixed: gl.unitMax } : null; if (groupMax > 1 && !replaces.length) o.note = `Each model may take up to ${groupMax}.`; }
      else o.kind = groupMax === 1 || replaces.length ? 'one' : 'any';
      // a pick the model must make, with no free default to fall back on
      if (gl.min >= 1 && !def) o.required = o.kind === 'perModel' ? { count: 'all' } : o.kind === 'any' ? { count: gl.min } : {};
      opts.push(o);
      continue;
    }
    // a single upgrade entry
    if (l.min >= 1) {
      if (model) model.wargear.push(c.name); else unit.models.forEach((m) => { if (!m.wargear.includes(c.name)) m.wargear.push(c.name); });
      if (cost(c)) addMandatoryCost(cost(c));
      continue;
    }
    if (l.max === 0) continue;
    const pts = cost(c);
    const o = { id: optId(`${target || 'unit'}-${c.name}`), text: `${model ? `${model.name}: ` : ''}${c.name}${multi ? (l.unitMax !== null ? ` (up to ${l.unitMax} in the unit)` : ' (any number of models)') : ''}`, model: target, replaces: [], choices: [{ name: c.name, points: pts }] };
    if (multi) { o.kind = 'perModel'; o.max = l.unitMax !== null ? { fixed: l.unitMax } : null; }
    else o.kind = 'upgrade';
    opts.push(o);
  }
}
function flatItems(g) {
  const out = [];
  for (const c of children(g)) {
    if (c.kind === 'group') out.push(...flatItems(c));
    else if (c.type !== 'model') out.push({ name: c.name, cost: cost(c), min: limits(c).min, id: c.id, linkId: c.linkId });
  }
  const seen = new Set();
  return out.filter((i) => (seen.has(i.name) ? false : seen.add(i.name)));
}

function armyUnits(army) {
  CTX = { cats: catalogueSet(army.catalogue) };
  // root entries: the army's catalogue plus catalogues it imports root entries from
  const rootsFrom = [army.catalogue];
  for (const l of cats[army.catalogue].data.catalogueLinks || []) if (l.importRootEntries) rootsFrom.push(l.targetId);
  const units = [];
  const ids = new Set();
  const seenTarget = new Map(); // same unit linked again for a detachment-restricted slot
  for (const cid of rootsFrom) {
    const d = cats[cid] && cats[cid].data;
    if (!d) continue;
    for (const raw of [...(d.selectionEntries || []), ...(d.entryLinks || [])]) {
      const e = resolve(raw);
      if (!e || isHidden(e) || !['unit', 'model'].includes(e.type)) continue;
      const key = raw.targetId || raw.id;
      const restricted = (raw.categoryLinks || []).map((l) => catName.get(l.targetId) || l.name).find((n) => /\s-\s/.test(n || ''));
      if (seenTarget.has(key)) {
        if (restricted) { const prev = seenTarget.get(key); prev.note = [prev.note, `Also available as ${restricted}.`].filter(Boolean).join(' '); }
        continue;
      }
      const u = convertUnit(e, army.id);
      if (!u) continue;
      if (restricted) u.note = [u.note, `Listed as ${restricted}.`].filter(Boolean).join(' ');
      while (ids.has(u.id)) u.id += '-2';
      ids.add(u.id);
      seenTarget.set(key, u);
      units.push(u);
    }
  }
  return units;
}

// ---------- write ----------
const out = join(root, 'data', 'bsdata');
if (existsSync(out)) rmSync(out, { recursive: true });
mkdirSync(out, { recursive: true });
const armies = armyList();
const common = collectCommon();
writeFileSync(join(out, 'common.json'), JSON.stringify(common) + '\n');
const report = [];
for (const a of armies) {
  skipped.length = 0;
  const units = armyUnits(a);
  mkdirSync(join(out, a.id, 'parts'), { recursive: true });
  // one unit per line keeps the files small and the diffs readable when BSData updates
  writeFileSync(join(out, a.id, 'parts', 'units.json'), '{"units":[\n' + units.map((u) => JSON.stringify(u)).join(',\n') + '\n]}\n');
  a.units = units.length;
  a.skipped = [...skipped];
  report.push(`${a.name}: ${units.length} units${skipped.length ? `, skipped ${skipped.length}` : ''}`);
}
const rev = JSON.parse(readFileSync(join(src, fileTitle(gst.file) + '.json'), 'utf8')).gameSystem.revision;
writeFileSync(join(out, 'armies.json'), JSON.stringify({
  source: 'BSData/horus-heresy-3rd-edition', gameSystemRevision: rev, importedAt: new Date().toISOString().slice(0, 10),
  armies: armies.map(({ id, name, group, catalogue, units, skipped }) => ({ id, name, group, catalogue, units, skipped })),
}, null, 1) + '\n');
console.log(`${armies.length} armies; ${common.weapons.ranged.length} ranged, ${common.weapons.melee.length} melee, ${common.rules.specialRules.length} rules, ${common.wargear.length} wargear\n` + report.join('\n'));
