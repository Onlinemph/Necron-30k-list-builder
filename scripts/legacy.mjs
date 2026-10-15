// "Legacy" house rules: an optional layer of Rites of War, extra options, wargear and statline flavour
// on top of the official BSData armies. Content lives in data/legacy/ (format in data/legacy/README.md).
// Everything is tied to the army configuration: "Legacy rules" switches the layer on, and each Rite of
// War is a choice that only appears with it. Nothing here changes a list that doesn't opt in.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const LEGACY = 'Legacy rules';
const GROUP_TOGGLE = 'legacy-rules';
const GROUP_RITE = 'legacy-rite-of-war';
const STATS = new Set(['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'LD', 'CL', 'WP', 'IN', 'SAV', 'INV', 'FRONT', 'SIDE', 'REAR', 'HP', 'CAPACITY']);
const ROLES = new Set(['Warlord', 'High Command', 'Command', 'Retinue', 'Elites', 'War Engine', 'Troops', 'Support', 'Transport', 'Heavy Assault', 'Heavy Transport', 'Armour', 'Recon', 'Fast Attack', 'Lord of War']);
const KINDS = new Set(['one', 'any', 'perModel', 'upgrade']);
const slug = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The legacy files for an army: one shared by its group (all Legions) and its own. */
function filesFor(root, army) {
  const dir = join(root, 'data', 'legacy');
  const list = [];
  if (army.group === 'Legiones Astartes') list.push(join(dir, 'legiones-astartes.json'));
  list.push(join(dir, `${army.id}.json`));
  return list.filter((f) => existsSync(f)).map((f) => ({ file: f, data: JSON.parse(readFileSync(f, 'utf8')) }));
}

/**
 * Units an entry applies to: "units" (ids, or "*" for all), and/or "match" { role, roles, nameIncludes,
 * trait, category, unitType, notUnitType, notNameIncludes } — all given filters must hold. Unknown ids are reported.
 */
function resolveUnits(out, spec, problems, where) {
  const ids = new Set(out.units.map((u) => u.id));
  // wildcards and matches leave out the shared Assassins and Cults (Clade and Cult Operatives);
  // a unit named by id is always included
  const shared = (u) => u.operative === 'Clade Operative' || u.operative === 'Cult Operative';
  let list = out.units.filter((u) => !u.ally);
  if (spec.units && !spec.units.includes('*')) {
    // a Legion file may name units another Legion lacks; only the shared file must match everywhere
    for (const id of spec.units) if (!ids.has(id) && !spec.optionalUnits) problems.push(`${where}: no unit "${id}"`);
    list = list.filter((u) => spec.units.includes(u.id));
  } else list = list.filter((u) => !shared(u));
  const m = spec.match;
  if (m) {
    list = list.filter((u) => (!m.role || u.role === m.role) && (!m.roles || m.roles.includes(u.role))
      && (!m.nameIncludes || [].concat(m.nameIncludes).some((n) => u.name.toLowerCase().includes(n.toLowerCase())))
      && (!m.notNameIncludes || ![].concat(m.notNameIncludes).some((n) => u.name.toLowerCase().includes(n.toLowerCase())))
      && (!m.trait || (u.traits || []).includes(m.trait) || (u.specialRules || []).includes(m.trait))
      && (!m.category || (u.categories || []).includes(m.category))
      && (!m.unitType || u.models.some((x) => (x.unitType || '').includes(m.unitType)))
      && (!m.notUnitType || !u.models.some((x) => (x.unitType || '').includes(m.notUnitType))));
  }
  return list;
}

function checkOption(o, problems, where) {
  if (!o || !KINDS.has(o.kind)) problems.push(`${where}: option kind must be one of ${[...KINDS].join(', ')}`);
  if (!o || !Array.isArray(o.choices) || !o.choices.length) problems.push(`${where}: option needs choices`);
  for (const c of (o && o.choices) || []) if (!c.name || typeof c.points !== 'number') problems.push(`${where}: each choice needs a name and points`);
}
function checkStats(stats, problems, where) {
  for (const [k, v] of Object.entries(stats || {})) {
    if (!STATS.has(k)) problems.push(`${where}: unknown stat ${k}`);
    if (!/^([+-]\d+|=.+|best:\d\+)$/.test(String(v))) problems.push(`${where}: stat change "${v}" should be +N, -N, =X or best:N+`);
  }
}

/** Merge the legacy layer into a built army. Returns a list of problems (empty when the files are sound). */
export function applyLegacy(root, out, army) {
  const problems = [];
  const files = filesFor(root, army);
  if (!files.length) return problems;
  const toggle = { config: LEGACY };
  // a legacy name must not shadow an official weapon, wargear or rule
  const commonFile = join(root, 'data', 'bsdata', 'common.json');
  const official = new Set();
  if (existsSync(commonFile)) {
    const c = JSON.parse(readFileSync(commonFile, 'utf8'));
    for (const x of [...c.weapons.ranged, ...c.weapons.melee, ...c.wargear, ...Object.values(c.rules).flat()]) official.add(x.name.toLowerCase());
  }
  for (const { file, data } of files) {
    const own = [...(data.wargear || []), ...(data.rules || []), ...(data.armyRules || []), ...((data.weapons || {}).ranged || []), ...((data.weapons || {}).melee || []), ...(data.rites || []).flatMap((r) => r.rules || [])];
    for (const x of own) if (x.name && official.has(x.name.toLowerCase())) problems.push(`${file.replace(/^.*\/data\//, 'data/')}: "${x.name}" is already an official name; pick another`);
  }
  const rites = [];
  const armyRules = [];
  let n = 0;
  const uniq = (base) => `legacy-${slug(base)}-${++n}`;

  const addOption = (entry, when, where) => {
    checkOption(entry.option, problems, where);
    let used = 0;
    for (const u of resolveUnits(out, entry, problems, where)) {
      const o = JSON.parse(JSON.stringify(entry.option));
      // "model": a name or a list of candidate names; "modelType": the first model whose type includes it
      // ("Sergeant"). A unit without a matching model is skipped.
      const names = o.model == null ? null : [].concat(o.model);
      let model = null;
      if (o.modelType) model = (u.models.find((m) => (m.unitType || '').includes(o.modelType)) || {}).name || false;
      else if (names) model = names.find((nm) => u.models.some((m) => m.name === nm)) || false;
      if (model === false) continue;
      delete o.modelType;
      o.model = model;
      o.id = uniq(o.id || o.text);
      o.text = `Legacy: ${o.text}`;
      o.replaces = o.replaces || [];
      // a swap needs the item it replaces on that model
      if (o.replaces.length && model && !o.replaces.every((w) => (u.models.find((m) => m.name === model).wargear || []).includes(w))) continue;
      o.when = [when];
      o.legacy = true;
      u.options.push(o);
      used++;
    }
    if (!used && !entry.optionalUnits) problems.push(`${where}: option "${entry.option && entry.option.text}" fits no unit`);
  };
  const addModifier = (entry, when, where, sourceName) => {
    checkStats(entry.stats, problems, where);
    const units = resolveUnits(out, entry, problems, where);
    if (!units.length) { if (!entry.optionalUnits) problems.push(`${where}: "${entry.text || 'modifier'}" fits no unit`); return; }
    out.modifiers.modifiers.push({
      id: uniq(`${sourceName}-${entry.text || 'mod'}`),
      text: entry.text || `${sourceName}.`,
      // "item": the change rides on a piece of wargear, and only while the legacy rules (or Rite) are on
      source: entry.item ? { type: 'upgrade', name: entry.item, when } : { type: 'when', when, name: sourceName },
      appliesTo: Object.assign({ units: units.map((u) => u.id) }, entry.models ? { models: entry.models } : {}),
      scope: entry.scope || 'model',
      stats: entry.stats || {}, addRules: entry.addRules || [], removeRules: entry.removeRules || [],
      ...(entry.addTraits ? { addTraits: entry.addTraits } : {}),
      ...(entry.addUnitTypes ? { addUnitTypes: entry.addUnitTypes } : {}),
      ...(entry.condition ? { condition: entry.condition } : {}),
      legacy: true,
    });
  };

  for (const { file, data } of files) {
    const tag = file.replace(/^.*\/data\//, 'data/');
    // always-on legacy content (with "Legacy rules")
    for (const [i, e] of (data.options || []).entries()) addOption(e, toggle, `${tag} options[${i}]`);
    for (const [i, e] of (data.modifiers || []).entries()) addModifier(e, toggle, `${tag} modifiers[${i}]`, e.name || 'Legacy rules');
    for (const [i, e] of (data.points || []).entries()) for (const u of resolveUnits(out, e, problems, `${tag} points[${i}]`)) (u.pointsWhen = u.pointsWhen || []).push({ when: toggle, delta: e.delta });
    for (const r of data.rules || []) out.rules.specialRules.push({ name: r.name, page: null, text: r.text, legacy: true });
    // army rules: the Legion's (or army's) own special rules, shown in the configuration panel and on
    // the datasheets of the units they name
    for (const [i, r] of (data.armyRules || []).entries()) {
      const where = `${tag} armyRules[${i}] ${r.name}`;
      if (!r.name || !r.text) { problems.push(`${where}: an army rule needs a name and text`); continue; }
      armyRules.push({ name: r.name, text: r.text, source: 'Legacy house rule', when: [toggle], legacy: true });
      out.rules.specialRules.push({ name: r.name, page: null, text: r.text, legacy: true });
      if (r.units || r.match) addModifier({ units: r.units, match: r.match, optionalUnits: r.optionalUnits, text: `${r.name}.`, addRules: [r.name], stats: r.stats, condition: r.condition }, toggle, where, r.name);
    }
    for (const w of data.wargear || []) out.wargear.push({ name: w.name, page: null, text: w.text, legacy: true });
    for (const k of ['ranged', 'melee']) for (const w of (data.weapons && data.weapons[k]) || []) out.weapons[k].push(Object.assign({ page: null, modes: null, specialRules: [], traits: [] }, w, { legacy: true }));

    // Rites of War
    for (const [i, rite] of (data.rites || []).entries()) {
      const where = `${tag} rites[${i}] ${rite.name}`;
      // a Rite reads like the old books: what it's about, then Benefits and Limitations
      const list = (title, xs) => (xs && xs.length ? `${title}\n${xs.map((x) => `- ${x}`).join('\n')}` : null);
      const text = [rite.flavor ? `"${rite.flavor}"` : null, rite.text, list('Benefits', rite.benefits), list('Limitations', rite.limitations)].filter(Boolean).join('\n\n');
      if (!rite.name || !(rite.benefits || []).length || !(rite.limitations || []).length) { problems.push(`${where}: a Rite needs a name, benefits and limitations`); continue; }
      // Rites change how the army fights, not what it costs
      if ((rite.points || []).length) problems.push(`${where}: Rites don't change points; give a rule or a statline instead`);
      const when = { config: rite.name };
      rites.push({ name: rite.name, text });
      for (const [j, e] of (rite.options || []).entries()) addOption(e, when, `${where} options[${j}]`);
      for (const [j, e] of (rite.modifiers || []).entries()) addModifier(e, when, `${where} modifiers[${j}]`, rite.name);
      for (const [j, e] of (rite.roles || []).entries()) {
        if (!ROLES.has(e.role)) problems.push(`${where} roles[${j}]: unknown role ${e.role}`);
        for (const u of resolveUnits(out, e, problems, `${where} roles[${j}]`)) if (u.role !== e.role) (u.roleWhen = u.roleWhen || []).push({ when, role: e.role });
      }
      for (const [j, e] of (rite.forbid || []).entries()) {
        for (const u of resolveUnits(out, e, problems, `${where} forbid[${j}]`)) (u.unless = u.unless || []).push(when);
      }
      for (const [j, e] of [...(rite.require || []).map((x) => ['min', x]), ...(rite.limit || []).map((x) => ['max', x])].entries()) {
        const [kind, x] = e;
        const units = resolveUnits(out, x, problems, `${where} ${kind === 'min' ? 'require' : 'limit'}[${j}]`).map((u) => u.id);
        if (!units.length) continue;
        out.requirements = out.requirements || [];
        out.requirements.push({ when, units, [kind]: x[kind] ?? (kind === 'min' ? 1 : 0), note: x.note || `${rite.name}` , source: rite.name });
      }
      for (const r of rite.rules || []) out.rules.specialRules.push({ name: r.name, page: null, text: r.text, legacy: true });
    }
  }

  // the switch and the Rite choice go at the end of the army configuration
  out.armyConfig = out.armyConfig || { fixed: [], groups: [] };
  out.armyConfig.fixed = (out.armyConfig.fixed || []).concat(armyRules);
  out.armyConfig.groups.push({ id: GROUP_TOGGLE, name: 'House rules', min: 0, max: 1, legacy: true,
    choices: [{ name: LEGACY, text: 'Optional house rules, not part of the official 3rd edition: Rites of War, restored Legion wargear and options, and more varied statlines, written for this builder. Agree with your opponent before using them.' }] });
  if (rites.length) out.armyConfig.groups.push({ id: GROUP_RITE, name: 'Legacy Rite of War', min: 0, max: 1, when: [toggle], legacy: true, choices: rites });
  return problems;
}
