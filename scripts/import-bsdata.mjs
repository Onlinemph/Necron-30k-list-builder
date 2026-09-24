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
const files = readdirSync(src).filter((f) => f.endsWith('.json')).sort();
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

const ALLEGIANCE = Object.fromEntries(['Loyalist', 'Traitor'].map((n) => [[...byId.values()].find((x) => x.name === n && x.type === 'upgrade')?.id, n]));

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
let CTX = { cats: new Set(), primary: null };
function condTrue(c) {
  const id = c.childId;
  const isCat = cats[id] || (gst && gst.data.id === id);
  let n = 0;
  // "primary-catalogue" means the army's own catalogue, not the ones it imports
  if (isCat) n = (c.scope === 'primary-catalogue' ? CTX.primary === id || gst.data.id === id : CTX.cats.has(id)) ? 1 : 0;
  // wargear the model is assumed to carry (its defaults, or one option being tried out)
  else if (CTX.selected && c.field === 'selections' && !['roster', 'force', 'primary-catalogue', 'ancestor'].includes(c.scope)) {
    const t = byId.get(id);
    if (t && CTX.selected.has(String(t.name).trim())) n = 1;
  }
  // anything else depends on the roster; assume nothing is selected yet
  switch (c.type) {
    case 'instanceOf': return isCat ? n === 1 : false;
    case 'notInstanceOf': return isCat ? n === 0 : true;
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
    else if (m.type === 'prepend') v = `${m.value} ${v}`;
    else if (m.type === 'replace' && m.arg != null) {
      const arg = String(m.arg);
      // "X" must match as a word so it doesn't hit the X in other words; "(X)" can match as written
      v = /^\w+$/.test(arg) ? String(v).replace(new RegExp(`\\b${arg}\\b`), String(m.value)) : String(v).replace(arg, String(m.value));
    }
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
      selectionEntries: [...(base.selectionEntries || []), ...(e.selectionEntries || [])],
      selectionEntryGroups: [...(base.selectionEntryGroups || []), ...(e.selectionEntryGroups || [])],
      rules: [...(base.rules || []), ...(e.rules || [])],
      profiles: [...(base.profiles || []), ...(e.profiles || [])],
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
function convertUnit(e, armyId, forcedRole) {
  const role = forcedRole || roleOf(e);
  if (!role) { skipped.push(`${e.name} (${[...(e.categoryLinks || [])].map((l) => catName.get(l.targetId) || l.name).join('/') || 'no role'})`); return null; }
  const unit = {
    id: slug(e.name), name: e.name, role, page: e.page || null, limit: null, unique: false,
    basePoints: 0, composition: '', models: [], traits: [], specialRules: [], unitRules: [], options: [], note: null,
  };
  const special = specialCategory(e);
  if (special) unit.note = `Taken as ${special}.`;
  const lim = limits(e);
  // named characters: "Horus Lupercal", or a single name such as "Angron"
  if (lim.rosterMax === 1) unit.unique = (/^[A-Z][a-z]+ [A-Z]/.test(e.name) || /^[A-Z][a-z]+$/.test(e.name)) && !/Squad|Battery|Detachment|Cohort/.test(e.name);
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
  selectionEffects(unit, modelEntries, rules, e);
  unit.composition = unit.models.filter((m) => m.min).map((m) => `${m.min} ${m.name}`).join(', ') || (unit.size ? `${unit.size.min}–${unit.size.max} models` : '');
  return unit;
}

// ---------- wargear that changes the model (mounts, armour): BSData modifiers conditional on a selection ----------
let unitEffects = [];
function referencedNames(e) {
  const out = new Set();
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.childId && n.field === 'selections') { const t = byId.get(n.childId); if (t && t.name) out.add(String(t.name).trim()); }
    for (const [k, v] of Object.entries(n)) if (typeof v === 'object') walk(k === 'targetId' ? null : v);
    if (n.targetId && byId.get(n.targetId)) walk(byId.get(n.targetId));
  };
  walk(e);
  return out;
}
function modelState(m, self, unitEntry, unitRules) {
  const prof = modelProfile(m) || (self ? null : modelProfile(unitEntry)) || { profile: {}, unitType: '' };
  return { profile: prof.profile, unitType: prof.unitType, rules: self ? rulesOf(m).rules : rulesOf(m).rules.filter((r) => !unitRules.includes(r)) };
}
function selectionEffects(unit, modelEntries, unitRules, unitEntry) {
  for (const { e: m, self } of modelEntries) {
    const model = unit.models.find((x) => x.name === m.name);
    if (!model) continue;
    const refs = referencedNames(m);
    const defaults = new Set(model.wargear);
    if (![...refs].some((r) => defaults.has(r)) && !unit.options.some((o) => (o.model === model.name || o.model === null) && o.choices.some((c) => refs.has(c.name)))) continue;
    const prev = CTX.selected;
    CTX.selected = defaults;
    const base = modelState(m, self, unitEntry, unitRules);
    // the default loadout is what the datasheet shows
    model.profile = base.profile;
    model.unitType = base.unitType;
    if (self) unit.specialRules = base.rules; else model.specialRules = base.rules;
    for (const o of unit.options) {
      if (o.model !== model.name && o.model !== null) continue;
      for (const c of o.choices) {
        if (!refs.has(c.name)) continue;
        CTX.selected = new Set([...defaults].filter((w) => !(o.replaces || []).includes(w)).concat(c.name));
        const alt = modelState(m, self, unitEntry, unitRules);
        const stats = {};
        for (const [k, v] of Object.entries(alt.profile)) if (JSON.stringify(v) !== JSON.stringify(base.profile[k]) && typeof v !== 'object') stats[k] = `=${v}`;
        const addRules = alt.rules.filter((r) => !base.rules.includes(r));
        const removeRules = base.rules.filter((r) => !alt.rules.includes(r) && !addRules.some((a) => a.replace(/\s*\(.*\)$/, '') === r.replace(/\s*\(.*\)$/, '')));
        const split = (t) => { const m = String(t || '').match(/^([^(]+?)\s*(?:\((.*)\))?$/) || []; return { main: (m[1] || '').trim(), subs: (m[2] || '').split(',').map((x) => x.trim()).filter(Boolean) }; };
        const bt = split(base.unitType), at = split(alt.unitType);
        const addTypes = at.subs.filter((x) => !bt.subs.includes(x)), dropTypes = bt.subs.filter((x) => !at.subs.includes(x));
        const typeChanged = bt.main !== at.main || addTypes.length || dropTypes.length;
        if (!Object.keys(stats).length && !addRules.length && !removeRules.length && !typeChanged) continue;
        const bits = [...Object.entries(stats).map(([k, v]) => `${k} ${v.slice(1)}`), ...addRules.map((r) => `gains ${r}`), ...removeRules.map((r) => `loses ${r}`), ...(typeChanged ? [`becomes ${alt.unitType}`] : [])];
        const mod = { _unit: unit, id: slug(`${model.name}-${c.name}`), text: `${c.name}: ${bits.join(', ')}.`, source: { type: 'wargear', name: c.name },
          appliesTo: { units: [unit.id], models: [model.name] }, scope: 'model', stats, addRules, removeRules };
        if (bt.main !== at.main) mod.setUnitType = at.main;
        if (addTypes.length) mod.addUnitTypes = addTypes;
        if (dropTypes.length) mod.removeUnitTypes = dropTypes;
        unitEffects.push(mod);
      }
    }
    CTX.selected = prev;
  }
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
      // "one per army" items (Master of Descent, relic weapons)
      const choices = items.filter((i) => i !== def).map((i) => Object.assign({ name: i.name, points: Math.max(0, i.cost - (def ? def.cost : 0)) }, i.once || gl.rosterMax === 1 ? { oncePerArmy: true } : {}));
      if (!choices.length) continue;
      const replaces = def ? [def.name] : [];
      const groupMax = gl.max === null ? choices.length : gl.max;
      const label = c.name.replace(/[:\s]+$/, '');
      const how = replaces.length ? (/exchang/i.test(label) ? '' : ` (exchanges the ${replaces[0]})`) : groupMax === 1 ? ' (choose one)' : gl.min === groupMax ? ` (choose ${groupMax})` : ` (up to ${groupMax})`;
      const o = { id: optId(`${target || 'unit'}-${c.name}`), text: `${model ? `${model.name}: ` : ''}${label}${how}`, model: target, replaces, choices };
      if (multi) { o.kind = 'perModel'; o.max = gl.unitMax !== null ? { fixed: gl.unitMax } : null; if (groupMax > 1 && !replaces.length) o.note = `Each model may take up to ${groupMax}.`; }
      else o.kind = groupMax === 1 || replaces.length ? 'one' : 'any';
      if (o.kind === 'any' && gl.max !== null && gl.max < choices.length) o.max = { fixed: gl.max };
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
    const o = { id: optId(`${target || 'unit'}-${c.name}`), text: `${model ? `${model.name}: ` : ''}${c.name}${multi ? (l.unitMax !== null ? ` (up to ${l.unitMax} in the unit)` : ' (any number of models)') : ''}`, model: target, replaces: [], choices: [Object.assign({ name: c.name, points: pts }, l.rosterMax === 1 ? { oncePerArmy: true } : {})] };
    if (multi) { o.kind = 'perModel'; o.max = l.unitMax !== null ? { fixed: l.unitMax } : null; }
    else o.kind = 'upgrade';
    opts.push(o);
  }
}
function flatItems(g) {
  const out = [];
  for (const c of children(g)) {
    if (c.kind === 'group') out.push(...flatItems(c));
    else if (c.type !== 'model') out.push({ name: c.name, cost: cost(c), min: limits(c).min, id: c.id, linkId: c.linkId, once: limits(c).rosterMax === 1 });
  }
  const seen = new Set();
  return out.filter((i) => (seen.has(i.name) ? false : seen.add(i.name)));
}

// BSData ids (entries and the links to them) → this army's unit ids, for Prime Advantage eligibility
let BSID = new Map();
// categories a unit gains in particular detachments ("set-primary Heavy Assault - Tartaros Only when in Linebreaker Echelon")
function modCategories(e) {
  const out = [];
  const walk = (n) => {
    for (const m of n.modifiers || []) if (m.field === 'category' && /add|set-primary/.test(m.type) && catName.has(m.value)) out.push(catName.get(m.value).trim());
    for (const g of n.modifierGroups || []) walk(g);
  };
  walk(e);
  return out;
}
const catNames = (links) => (links || []).filter((l) => !isHidden(l)).map((l) => (catName.get(l.targetId) || l.name || '').trim()).filter(Boolean);
// Operatives come from their own lists and only fill the slots their Prime Advantage adds
const OPERATIVES = [
  { file: 'Divisio Assassinorum', advantage: 'Clade Operative' },
  { file: 'Cults Abominatio', advantage: 'Cult Operative' },
];
function armyUnits(army) {
  CTX = { cats: catalogueSet(army.catalogue), primary: army.catalogue };
  BSID = new Map();
  unitEffects = [];
  // root entries: the army's catalogue plus catalogues it imports root entries from
  const rootsFrom = [army.catalogue];
  for (const l of cats[army.catalogue].data.catalogueLinks || []) if (l.importRootEntries) rootsFrom.push(l.targetId);
  const units = [];
  const ids = new Set();
  const seenTarget = new Map(); // same unit linked again for a detachment-restricted slot
  const add = (u, raw, e) => {
    for (let n = 2, base = u.id; ids.has(u.id); n++) u.id = `${base}-${n}`;
    ids.add(u.id);
    for (const k of [raw.id, raw.targetId, e.id]) if (k && !BSID.has(k)) BSID.set(k, u.id);
    units.push(u);
  };
  for (const cid of rootsFrom) {
    const d = cats[cid] && cats[cid].data;
    if (!d) continue;
    for (const raw of [...(d.selectionEntries || []), ...(d.entryLinks || [])]) {
      const e = resolve(raw);
      if (!e || isHidden(e) || !['unit', 'model'].includes(e.type)) continue;
      const key = raw.targetId || raw.id;
      const linkCats = [...catNames(raw.categoryLinks), ...modCategories(raw)];
      const restricted = linkCats.find((n) => /\s-\s/.test(n));
      if (seenTarget.has(key)) {
        const prev = seenTarget.get(key);
        for (const c of linkCats) if (!ROLES.has(c) && !prev.categories.includes(c)) prev.categories.push(c);
        if (restricted) prev.note = [prev.note, `Also available as ${restricted}.`].filter(Boolean).join(' ');
        if (!BSID.has(raw.id)) BSID.set(raw.id, prev.id);
        continue;
      }
      const u = convertUnit(e, army.id);
      if (!u) continue;
      // categories other than the battlefield role: detachment slots ("Troops - Terror Squads Only") and Prime Advantages use them
      u.categories = [...new Set([...catNames(e.categoryLinks), ...catNames(e.baseCategoryLinks), ...modCategories(e), ...linkCats])].filter((c) => !ROLES.has(c) && c !== u.role);
      if (restricted) u.note = [u.note, `Listed as ${restricted}.`].filter(Boolean).join(' ');
      const side = unitAllegiance(e);
      if (side) u.allegiance = side;
      seenTarget.set(key, u);
      add(u, raw, e);
    }
  }
  for (const op of OPERATIVES) {
    const c = Object.values(cats).find((x) => fileTitle(x.file) === op.file);
    if (!c || !CTX.cats.has(c.data.id)) continue;
    for (const raw of [...(c.data.selectionEntries || []), ...(c.data.entryLinks || [])]) {
      const e = resolve(raw);
      if (!e || isHidden(e) || !['unit', 'model'].includes(e.type)) continue;
      const u = convertUnit(e, army.id, 'Support');
      if (!u) continue;
      u.categories = [op.advantage];
      u.operative = op.advantage;
      u.note = [u.note, `Only fills the Support slots added by the ${op.advantage} Prime Advantage.`].filter(Boolean).join(' ');
      add(u, raw, e);
    }
  }
  return units;
}

/** "Hidden if the army is Loyalist" → a Traitor-only unit. */
function unitAllegiance(e) {
  const flat = (m) => [...(m.conditions || []), ...(m.conditionGroups || []).flatMap(flat)];
  for (const m of e.modifiers || []) {
    if (m.field !== 'hidden' || !(m.value === true || m.value === 'true')) continue;
    for (const c of flat(m)) {
      const side = ALLEGIANCE[c.childId];
      if (side && /atLeast|greaterThan/.test(c.type) && c.value >= 1) return side === 'Loyalist' ? 'Traitor' : 'Loyalist';
    }
  }
  return null;
}

// ---------- text of rules, reactions and gambits attached to an entry ----------
function describe(p) {
  const c = Object.fromEntries((p.characteristics || []).map((x) => [x.name, x.$text ?? '']));
  if (p.typeName === 'Reaction' || p.typeName === 'Psychic Reaction') return ['Trigger', 'Cost', 'Target', 'Process'].map((k) => (c[k] ? `${k}: ${c[k]}` : '')).filter(Boolean).join('\n\n') || c.Summary || c.Description || '';
  return c.Description || c.Summary || Object.values(c).join('\n');
}
function textItems(e) {
  const out = [];
  for (const r of e.rules || []) if (!isHidden(r) && r.name) out.push({ name: r.name.trim(), text: r.description || '', kind: 'rule' });
  for (const l of e.infoLinks || []) {
    if (isHidden(l)) continue;
    const t = byId.get(l.targetId);
    if (!t) continue;
    const name = String(applyField(l, 'name', l.name || t.name)).trim();
    if (l.type === 'rule') out.push({ name, text: t.description || '', kind: 'rule' });
    else if (l.type === 'profile' && t.typeName !== 'Traits') out.push({ name, text: describe(t), kind: t.typeName });
  }
  for (const p of profilesOf(e)) if (!MODEL_PROFILES.includes(p.typeName) && !/Weapon|Traits|Detachment/.test(p.typeName)) out.push({ name: p.name.trim(), text: describe(p), kind: p.typeName });
  return out;
}
// "Name: text" unless the item is the thing being described
const joinText = (items, own) => items.map((i) => (i.name === own || (!own && items.length === 1) ? i.text : `${i.name}: ${i.text}`)).join('\n\n');

// ---------- army configuration: Legion Tactica, Rites of War, Cohort Doctrines, Provenances… ----------
function armyConfig(army) {
  CTX = { cats: catalogueSet(army.catalogue), primary: army.catalogue };
  const d = cats[army.catalogue].data;
  const roots = [...(d.selectionEntries || []), ...(d.entryLinks || [])].filter((r) => catNames(r.categoryLinks).includes('Army Configuration'));
  const fixed = [], groups = [];
  const gid = new Set();
  const walk = (e, label) => {
    for (const t of textItems(e)) fixed.push(Object.assign(t, { source: label }));
    for (const c of children(e)) {
      const lim = limits(c);
      if (c.kind === 'group') {
        const kids = children(c);
        const items = kids.filter((k) => k.kind !== 'group');
        for (const t of textItems(c)) fixed.push(Object.assign(t, { source: c.name.trim() }));
        if (!items.length || (items.length === 1 && lim.min >= 1)) { for (const k of kids) walk(k, k.kind === 'group' ? label : k.name.trim()); continue; }
        let id = slug(c.name) || 'choice';
        for (let n = 2, b = id; gid.has(id); n++) id = `${b}-${n}`;
        gid.add(id);
        groups.push({ id, name: c.name.trim().replace(/:$/, ''), min: lim.min, max: lim.max === null ? items.length : lim.max,
          choices: items.map((i) => ({ name: i.name.trim(), text: joinText(deepText(i), i.name.trim()) })) });
        continue;
      }
      if (lim.max === 0) continue;
      if (lim.min >= 1) { walk(c, c.name.trim()); continue; }
      let id = slug(c.name);
      for (let n = 2, b = id; gid.has(id); n++) id = `${b}-${n}`;
      gid.add(id);
      groups.push({ id, name: c.name.trim(), min: 0, max: 1, choices: [{ name: c.name.trim(), text: joinText(deepText(c), c.name.trim()) }] });
    }
  };
  // a choice's own text plus whatever it brings with it
  const deepText = (e) => {
    const out = textItems(e);
    for (const c of children(e)) if (c.kind === 'group' || limits(c).min >= 1) out.push(...deepText(c));
    return out;
  };
  for (const raw of roots) {
    const e = resolve(raw);
    if (!e || isHidden(e)) continue;
    walk(e, e.name.trim());
  }
  groups.unshift({ id: 'allegiance', name: 'Allegiance', min: 1, max: 1, choices: [
    { name: 'Loyalist', text: 'The army fights for the Emperor. Some Prime Advantages and units are only available to one side.' },
    { name: 'Traitor', text: 'The army has sided with Horus. Some Prime Advantages and units are only available to one side.' }] });
  const seen = new Set();
  return { fixed: fixed.filter((f) => f.text && !seen.has(f.name) && seen.add(f.name)), groups };
}

// ---------- detachments ----------
const coreDetachments = new Set(JSON.parse(readFileSync(join(root, 'data', 'forceorg.json'), 'utf8')).detachments.map((d) => d.name));
function armyDetachments(army, units) {
  CTX = { cats: catalogueSet(army.catalogue), primary: army.catalogue };
  const crusade = gst.data.forceEntries.find((f) => /^Crusade Force/.test(f.name));
  const out = [];
  for (const f of crusade.forceEntries || []) {
    const m = f.name.match(/^(Auxiliary|Apex)\s*-\s*(.+)$/);
    if (!m || isHidden(f)) continue;
    const [, type, name] = m;
    if (coreDetachments.has(name.trim())) continue;
    const slots = [], prime = {}, problems = [];
    for (const cl of f.categoryLinks || []) {
      const cname = (catName.get(cl.targetId) || cl.name || '').trim();
      const max = (cl.constraints || []).filter((c) => c.type === 'max' && c.field === 'selections').map((c) => Number(applyField(cl, c.id, c.value)));
      if (!max.length) continue;
      const n = Math.min(...max);
      if (n <= 0) continue;
      const pm = cname.match(/^Prime (.+)$/);
      if (pm) { const r = roleName({ name: pm[1] }); if (r) prime[r] = (prime[r] || 0) + n; continue; }
      const r = roleName({ name: cname });
      if (!r) { problems.push(cname); continue; }
      const slot = { role: r, prime: false };
      if (/\s-\s/.test(cname)) {
        slot.onlyLabel = cname.replace(/^[^-]+-\s*/, '');
        slot.only = units.filter((u) => (u.categories || []).includes(cname)).map((u) => u.id);
        if (!slot.only.length) problems.push(`no units for ${cname}`);
      }
      for (let i = 0; i < n; i++) slots.push(Object.assign({}, slot));
    }
    for (const [r, n] of Object.entries(prime)) {
      let k = n;
      for (const s of slots) if (k > 0 && s.role === r) { s.prime = true; k--; }
    }
    if (!slots.length) continue;
    const comp = profilesOf(f).find((p) => p.typeName === 'Detachment Description');
    const compText = comp ? describe(comp).trim() : '';
    out.push({
      id: `bs-${slug(name)}`, name: name.trim(), type, source: 'army', page: f.page || null,
      unlock: compText ? compText.split('\n').filter(Boolean).join(' · ') : null, unlockedBy: null, slots,
      // "Requires a Master of Descent": a Consul-type upgrade some unit in the army must have
      requires: [...compText.matchAll(/Requires (?:an? )?([^\n·]+)/gi)].map((m) => m[1].trim()),
      restrictions: [], rules: textItems(f).map((t) => ({ name: t.name, text: t.text })),
    });
    if (problems.length) console.warn(`${army.name} / ${name}: ${problems.join('; ')}`);
  }
  return out;
}

// ---------- Prime Advantages from BSData's "Prime Benefits" lists ----------
// Visibility that depends on the unit taking the advantage is unknown here, so it's tri-state.
function condTri(c) {
  if (cats[c.childId] || gst.data.id === c.childId) return condTrue(c);
  return null;
}
const triAnd = (v) => (v.some((x) => x === false) ? false : v.every((x) => x === true) ? true : null);
const triOr = (v) => (v.some((x) => x === true) ? true : v.every((x) => x === false) ? false : null);
function groupTri(g) {
  const parts = [...(g.conditions || []).map(condTri), ...(g.conditionGroups || []).map(groupTri)];
  if (!parts.length) return true;
  return g.type === 'or' ? triOr(parts) : triAnd(parts);
}
const modTri = (m) => triAnd([...(m.conditions || []).map(condTri), ...(m.conditionGroups || []).map(groupTri)]);
function eligibility(e) {
  let allegiance = null;
  const any = { roles: new Set(), categories: new Set(), units: new Set() }, excludeRoles = new Set(), unitTypes = new Set();
  let visible = !e.hidden;
  const visit = (c) => {
    if (cats[c.childId] || gst.data.id === c.childId) return;
    if (ALLEGIANCE[c.childId]) {
      const yes = /atLeast|greaterThan|instanceOf/.test(c.type) && !/not/i.test(c.type) || (c.type === 'equalTo' && c.value >= 1);
      allegiance = yes ? ALLEGIANCE[c.childId] : ALLEGIANCE[c.childId] === 'Traitor' ? 'Loyalist' : 'Traitor';
      return;
    }
    const name = catName.get(c.childId);
    if (c.type === 'instanceOf' && ['ancestor', 'unit', 'parent'].includes(c.scope)) {
      if (name) { const r = roleName({ name }); if (r) any.roles.add(r); else any.categories.add(name); }
      else if (BSID.has(c.childId)) any.units.add(BSID.get(c.childId));
      else any.units.add(`?${c.childId}`);
    } else if (c.type === 'notInstanceOf' && name) {
      const r = roleName({ name });
      if (r) excludeRoles.add(r);
    } else if (/atLeast|greaterThan/.test(c.type) && name && /Model Type|Sub-type/i.test(name)) {
      unitTypes.add(name.replace(/\s+Model (Sub-)?Type$/i, ''));
    }
  };
  const walkC = (g) => { (g.conditions || []).forEach(visit); (g.conditionGroups || []).forEach(walkC); };
  for (const m of e.modifiers || []) {
    if (m.field !== 'hidden') continue;
    const t = modTri(m);
    const show = m.value === false || m.value === 'false';
    if (show && t !== false) { visible = true; walkC(m); }
    if (!show && t === true) visible = false;
  }
  if (!visible) return null;
  // an id that isn't one of this army's units means the advantage is for units the army doesn't have
  const units = [...any.units];
  if (units.length && units.every((u) => u.startsWith('?')) && !any.roles.size && !any.categories.size) return null;
  const el = {};
  const a = { roles: [...any.roles], categories: [...any.categories], units: units.filter((u) => !u.startsWith('?')) };
  if (a.roles.length || a.categories.length || a.units.length) el.any = a;
  if (excludeRoles.size) el.excludeRoles = [...excludeRoles];
  if (unitTypes.size) el.unitTypes = [...unitTypes];
  if (allegiance) el.allegiance = allegiance;
  return el;
}
const COMMON_ADVANTAGES = new Set(['Combat Veterans', 'Special Assignment', 'Master Sergeant', 'Paragon of Battle', 'Logistical Benefit', 'Teleport Transponders']);
function armyAdvantages(army, units) {
  CTX = { cats: catalogueSet(army.catalogue), primary: army.catalogue };
  const out = [];
  const seen = new Set();
  const lists = [...byId.values()].filter((n) => n.name === 'Prime Benefits' && !n.targetId && !n.type);
  for (const list of lists) {
    const file = Object.values(cats).find((c) => JSON.stringify(c.data).includes(`"id":"${list.id}"`));
    if (!file || !CTX.cats.has(file.data.id)) continue;
    const walk = (g) => {
      for (const raw of [...(g.selectionEntries || []), ...(g.entryLinks || []), ...(g.selectionEntryGroups || [])]) {
        const e = raw.targetId ? resolve(raw) : raw;
        if (!e) continue;
        if (!e.type || e.kind === 'group' || raw.type === 'selectionEntryGroup') { if (limits(e).max !== 0 && !/Prime Traits/.test(e.name)) walk(e); continue; }
        const name = e.name.trim();
        if (COMMON_ADVANTAGES.has(name) || seen.has(name) || /^LB - |dummy/i.test(name)) continue;
        const el = eligibility(e);
        if (!el) continue;
        seen.add(name);
        const items = textItems(e);
        const own = items.find((i) => i.name === name);
        const text = own ? [own, ...items.filter((i) => i !== own)] : items;
        const adv = { name, text: joinText(text, name) || name, eligible: el };
        if (limits(e).rosterMax === 1) adv.oncePerArmy = true;
        const op = OPERATIVES.find((o) => o.advantage === name);
        if (op) {
          if (!units.some((u) => u.operative === name)) continue;
          const words = { one: 1, two: 2, three: 3, four: 4 };
          const n = (adv.text.match(/Add (one|two|three|four|\d+) additional Support/i) || [])[1];
          adv.addSlots = { role: 'Support', count: words[String(n).toLowerCase()] || Number(n) || 1, operative: name };
          adv.eligible = el.allegiance ? { allegiance: el.allegiance } : {};
          adv.primaryOnly = true;
        }
        out.push(adv);
      }
    };
    walk(list);
  }
  return out;
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
  // unit ids are final now
  const effects = unitEffects.map(({ _unit, ...m }) => Object.assign(m, { id: `${_unit.id}-${m.id}`, appliesTo: Object.assign({}, m.appliesTo, { units: [_unit.id] }) }));
  writeFileSync(join(out, a.id, 'modifiers.json'), JSON.stringify({ modifiers: effects }, null, 1) + '\n');
  const dets = armyDetachments(a, units);
  writeFileSync(join(out, a.id, 'parts', 'detachments.json'), JSON.stringify({ detachments: dets }, null, 1) + '\n');
  const config = armyConfig(a);
  writeFileSync(join(out, a.id, 'parts', 'config.json'), JSON.stringify({ armyConfig: config }, null, 1) + '\n');
  const advs = armyAdvantages(a, units);
  writeFileSync(join(out, a.id, 'granted-prime-advantages.json'), JSON.stringify({ grantedPrimeAdvantages: advs }, null, 1) + '\n');
  a.detachments = dets.length;
  a.units = units.length;
  a.skipped = [...skipped];
  report.push(`${a.name}: ${units.length} units, ${dets.length} detachments, ${config.fixed.length} army rules, ${config.groups.length} army choices, ${advs.length} Prime Advantages, ${effects.length} wargear effects${skipped.length ? `, skipped ${skipped.length}` : ''}`);
}
const rev = JSON.parse(readFileSync(join(src, fileTitle(gst.file) + '.json'), 'utf8')).gameSystem.revision;
writeFileSync(join(out, 'armies.json'), JSON.stringify({
  source: 'BSData/horus-heresy-3rd-edition', gameSystemRevision: rev, importedAt: new Date().toISOString().slice(0, 10),
  armies: armies.map(({ id, name, group, catalogue, units, skipped }) => ({ id, name, group, catalogue, units, skipped })),
}, null, 1) + '\n');
console.log(`${armies.length} armies; ${common.weapons.ranged.length} ranged, ${common.weapons.melee.length} melee, ${common.rules.specialRules.length} rules, ${common.wargear.length} wargear\n` + report.join('\n'));
