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

const saveNum = (v) => { const m = String(v ?? '').match(/(\d)\+/); return m ? +m[1] : 7; };
const ruleBase = (r) => String(r).toLowerCase().replace(/\(.*?\)/g, '').trim();
/** Whether a choice adds anything to this model: a better save, or a rule it doesn't already have as good. */
function offersSomething(onlyIf, u, md) {
  const have = [...(u.specialRules || []), ...(md.specialRules || [])];
  const better = Object.entries(onlyIf.worse || {}).some(([k, v]) => saveNum((md.profile || {})[k]) > saveNum(v));
  const missing = (onlyIf.missing || []).some((r) => {
    const h = have.find((x) => ruleBase(x) === ruleBase(r));
    if (!h) return true;
    const a = String(r).match(/\((\d+)\+\)/), b = String(h).match(/\((\d+)\+\)/);
    return a && b ? +a[1] < +b[1] : false;
  });
  return better || missing;
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
    // 3rd edition has no re-rolls; a house rule shouldn't bring them back
    const strings = [];
    (function walk(x) { if (typeof x === 'string') strings.push(x); else if (x && typeof x === 'object') Object.values(x).forEach(walk); })(data);
    for (const t of strings) if (/re-?roll/i.test(t)) problems.push(`${file.replace(/^.*\/data\//, 'data/')}: re-rolls aren't part of 3rd edition: "${t.slice(0, 80)}"`);
    const own = [...(data.wargear || []), ...(data.rules || []), ...(data.armyRules || []), ...((data.weapons || {}).ranged || []), ...((data.weapons || {}).melee || []), ...(data.rites || []).flatMap((r) => r.rules || [])];
    for (const x of own) if (x.name && official.has(x.name.toLowerCase())) problems.push(`${file.replace(/^.*\/data\//, 'data/')}: "${x.name}" is already an official name; pick another`);
  }
  // units the army had in earlier editions: written out in full, or copied from another army's data
  // ("copy": { "army": "questoris-familia", "unit": "acastus-knight-asterius" }) and adjusted. They only
  // appear with Legacy rules on, and options, modifiers and Rites below can target them like any unit.
  for (const { file, data } of files) {
    const tag = file.replace(/^.*\/data\//, 'data/');
    for (const [i, e] of (data.units || []).entries()) {
      const where = `${tag} units[${i}] ${e.name || e.id}`;
      let u = e;
      if (e.copy) {
        const src = join(root, 'data', 'bsdata', e.copy.army, 'parts', 'units.json');
        const from = existsSync(src) && JSON.parse(readFileSync(src, 'utf8')).units.find((x) => x.id === e.copy.unit);
        if (!from) { problems.push(`${where}: nothing to copy at ${e.copy.army}/${e.copy.unit}`); continue; }
        const { copy, renameModels, ...rest } = e;
        u = Object.assign(JSON.parse(JSON.stringify(from)), rest);
        // "renameModels": { "Rhino": "Null-Maiden Rhino" }, carried through the copied options too
        for (const [a, b] of Object.entries(renameModels || {})) {
          for (const m of u.models) if (m.name === a) m.name = b;
          for (const o of u.options || []) if (o.model === a) o.model = b;
        }
      } else u = JSON.parse(JSON.stringify(e));
      if (!u.id || out.units.some((x) => x.id === u.id)) { problems.push(`${where}: needs an id the army doesn't already use`); continue; }
      if (!ROLES.has(u.role)) problems.push(`${where}: unknown role ${u.role}`);
      if (typeof u.basePoints !== 'number') problems.push(`${where}: basePoints must be a number`);
      if (!Array.isArray(u.models) || !u.models.length) { problems.push(`${where}: needs models`); continue; }
      for (const m of u.models) {
        if (!m.name || !m.profile || !m.unitType || typeof m.min !== 'number') problems.push(`${where}: model ${m.name || '?'} needs name, min, max, profile and unitType`);
        checkStats(Object.fromEntries(Object.keys(m.profile || {}).map((k) => [k, '+0'])), problems, `${where} ${m.name}`);
        m.wargear = m.wargear || []; m.specialRules = m.specialRules || []; m.costPerExtra = m.costPerExtra || 0;
      }
      Object.assign(u, { options: u.options || [], traits: u.traits || [], specialRules: u.specialRules || [], unitRules: u.unitRules || [],
        page: null, book: 'Legacy house rule', unique: !!u.unique, limit: u.limit || null, legacy: true });
      // only with Legacy rules, and still under any condition the copied unit had
      u.when = [(u.when || []).length ? { all: [toggle, { any: u.when }] } : toggle];
      for (const o of u.options) { o.replaces = o.replaces || []; o.model = o.model === undefined ? null : o.model; }
      out.units.push(u);
    }
  }
  const rites = [];
  const armyRules = [];
  let n = 0;
  const uniq = (base) => `legacy-${slug(base)}-${++n}`;
  const list = (title, xs) => (xs && xs.length ? `${title}\n${xs.map((x) => `- ${x}`).join('\n')}` : null);
  // rules and wargear read like the rulebook: a quoted one-line summary, then the rule in full; the
  // build adds the house-rule tag (and the Rite it comes from) at the end
  const ruleText = (r, where, source) => {
    if (!r.summary || !r.text) problems.push(`${where} ${r.name}: needs a "summary" line and the rule "text"`);
    if (/legacy house rule/i.test(r.text || '')) problems.push(`${where} ${r.name}: leave "Legacy house rule" out of the text; the build adds it`);
    return [r.summary ? `"${r.summary}"` : null, r.text, `Legacy house rule${source ? ` (${source})` : ''}.`].filter(Boolean).join('\n\n');
  };

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
      // a choice that gives the model nothing it lacks is dropped ("onlyIf": { worse: { INV: '4+' }, missing: ['Feel No Pain (6+)'] })
      const md = u.models.find((m) => m.name === model) || u.models[0];
      const carried = new Set((md.wargear || []).map((w) => String(w).toLowerCase()));
      o.choices = o.choices.filter((c) => (!c.onlyIf || offersSomething(c.onlyIf, u, md)) && (o.replaces.length || !carried.has(c.name.toLowerCase())));
      for (const c of o.choices) delete c.onlyIf;
      if (!o.choices.length) continue;
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
    // a situational modifier is shown as a reminder and not applied, so any rules it adds or removes go
    // in a modifier of their own that always applies
    if (entry.condition && ((entry.addRules || []).length || (entry.removeRules || []).length)) {
      const { condition, stats, ...always } = entry;
      addModifier(always, when, where, sourceName);
      addModifier({ ...entry, addRules: [], removeRules: [], optionalUnits: true }, when, where, sourceName);
      return;
    }
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
    // "whileInArmy": only while one of these units is in the army (a Primarch's presence)
    const gate = (e, base) => (e.whileInArmy ? { all: [base, { any: e.whileInArmy.map((id) => ({ unit: id })) }] } : base);
    const known = new Set(out.units.map((u) => u.id));
    const checkGate = (e, where) => { for (const id of e.whileInArmy || []) if (!known.has(id)) problems.push(`${where}: whileInArmy names no unit "${id}"`); };
    for (const [i, e] of (data.modifiers || []).entries()) { checkGate(e, `${tag} modifiers[${i}]`); addModifier(e, gate(e, toggle), `${tag} modifiers[${i}]`, e.name || 'Legacy rules'); }
    for (const [i, e] of (data.points || []).entries()) for (const u of resolveUnits(out, e, problems, `${tag} points[${i}]`)) (u.pointsWhen = u.pointsWhen || []).push({ when: toggle, delta: e.delta });
    for (const [i, r] of (data.rules || []).entries()) out.rules.specialRules.push({ name: r.name, page: null, text: ruleText(r, `${tag} rules[${i}]`, r.source), legacy: true });
    // army rules: the Legion's (or army's) own special rules, shown in the configuration panel and on
    // the datasheets of the units they name. They read like a Rite: flavour, Benefits, Drawbacks.
    for (const [i, r] of (data.armyRules || []).entries()) {
      const where = `${tag} armyRules[${i}] ${r.name}`;
      if (!r.name || !(r.benefits || []).length || !(r.drawbacks || []).length) { problems.push(`${where}: an army rule needs a name, benefits and drawbacks`); continue; }
      const text = [r.flavor ? `"${r.flavor}"` : null, list('Benefits', r.benefits), list('Drawbacks', r.drawbacks), 'Legacy house rule.'].filter(Boolean).join('\n\n');
      checkGate(r, where);
      armyRules.push({ name: r.name, text, source: 'Legacy house rule', when: [gate(r, toggle)], legacy: true });
      out.rules.specialRules.push({ name: r.name, page: null, text, legacy: true });
      if (r.units || r.match) {
        // the rule always goes on the datasheet; a situational stat goes with it as a reminder
        const sel = { units: r.units, match: r.match, optionalUnits: r.optionalUnits };
        addModifier({ ...sel, text: `${r.name}.`, addRules: [r.name], ...(r.condition ? {} : { stats: r.stats }) }, gate(r, toggle), where, r.name);
        if (r.condition && r.stats) addModifier({ ...sel, optionalUnits: true, text: `${r.name}: ${Object.entries(r.stats).map(([k, v]) => `${v} ${k}`).join(', ')}.`, stats: r.stats, condition: r.condition }, gate(r, toggle), where, r.name);
      }
    }
    for (const [i, w] of (data.wargear || []).entries()) out.wargear.push({ name: w.name, page: null, text: ruleText(w, `${tag} wargear[${i}]`), legacy: true });
    for (const k of ['ranged', 'melee']) for (const w of (data.weapons && data.weapons[k]) || []) out.weapons[k].push(Object.assign({ page: null, modes: null, specialRules: [], traits: [] }, w, { legacy: true }));

    // Rites of War
    for (const [i, rite] of (data.rites || []).entries()) {
      const where = `${tag} rites[${i}] ${rite.name}`;
      // a Rite reads like the old books: what it's about, then Benefits and Limitations
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
      for (const [j, r] of (rite.rules || []).entries()) out.rules.specialRules.push({ name: r.name, page: null, text: ruleText(r, `${where} rules[${j}]`, rite.name), legacy: true });
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
