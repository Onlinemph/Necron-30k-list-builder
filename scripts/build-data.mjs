#!/usr/bin/env node
// Merges data/parts/*.json into data/necrons.json and js/data.js, then cross-checks references.
// Usage: node scripts/build-data.mjs [--strict]
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const parts = join(root, 'data', 'parts');
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const files = existsSync(parts) ? readdirSync(parts).filter((f) => f.endsWith('.json')).sort() : [];

const out = {
  meta: {
    source: 'Codex Xenologica – Necrons (Horus Heresy 3rd edition)',
    version: '1.4.2',
    date: 'August 2026',
  },
  units: [], lists: [], arkana: [], weapons: { ranged: [], melee: [] }, wargear: [],
  rules: { specialRules: [], reactions: [], gambits: [], primeAdvantages: [], traits: [], powersOfTheCtan: [], unitTypes: [] },
  detachments: [], sequelae: { intro: '', sequelae: [] }, faq: [], baseSizes: [],
  forceorg: read(join(root, 'data', 'forceorg.json')),
  coreRules: read(join(root, 'data', 'core-rules.json')),
  sequelaEffects: read(join(root, 'data', 'sequela-effects.json')),
  grantedPrimeAdvantages: read(join(root, 'data', 'granted-prime-advantages.json')).grantedPrimeAdvantages,
  modifiers: existsSync(join(root, 'data', 'modifiers.json')) ? read(join(root, 'data', 'modifiers.json')) : { modifiers: [] },
};

for (const f of files) {
  const d = read(join(parts, f));
  if (d.units) out.units.push(...d.units);
  if (d.lists) out.lists.push(...d.lists);
  if (d.arkana) out.arkana.push(...d.arkana);
  if (d.ranged) out.weapons.ranged.push(...d.ranged);
  if (d.melee) out.weapons.melee.push(...d.melee);
  if (d.wargear) out.wargear.push(...d.wargear);
  for (const k of Object.keys(out.rules)) if (d[k]) out.rules[k].push(...d[k]);
  if (d.detachments) out.detachments.push(...d.detachments);
  if (d.sequelae) { out.sequelae.sequelae.push(...d.sequelae); if (d.intro) out.sequelae.intro = d.intro; }
  if (d.faq) out.faq.push(...d.faq);
  if (d.baseSizes) out.baseSizes.push(...d.baseSizes);
}

// core detachments from the Horus Heresy rulebook sit alongside the codex ones
out.detachments.push(...(out.forceorg.detachments || []));

// ---------- checks ----------
const problems = [];
const warn = [];
const ids = new Set();
const listIds = new Set(out.lists.map((l) => l.id));
const { norm, wkey } = require(join(root, 'js', 'engine.js'));
const coreFile = read(join(root, 'data', 'core-rules.json'));
const core = new Set([...coreFile.rules, ...coreFile.undefinedInCodex.map((x) => x.name)].map(norm));
const aliases = new Map(Object.entries(coreFile.weaponAliases || {}).map(([k, v]) => [wkey(k), wkey(v)]));
const weaponKeys = new Set([...out.weapons.ranged, ...out.weapons.melee].map((w) => wkey(w.name)));
const ruleKeys = new Set();
for (const k of Object.keys(out.rules)) for (const r of out.rules[k]) ruleKeys.add(norm(r.name));
for (const w of out.wargear) ruleKeys.add(norm(w.name));
for (const a of out.arkana) { if (a.harbinger) ruleKeys.add(norm(a.harbinger.name)); for (const w of a.wargear || []) ruleKeys.add(norm(w.name)); }

const KINDS = new Set(['one', 'any', 'perModel', 'swapModel', 'upgrade']);
const ROLES = new Set(['Warlord', 'High Command', 'Command', 'Retinue', 'Elites', 'War Engine', 'Troops', 'Support', 'Transport', 'Heavy Assault', 'Heavy Transport', 'Armour', 'Recon', 'Fast Attack', 'Lord of War', 'Fortification']);

for (const u of out.units) {
  const where = `${u.id || u.name}`;
  if (!u.id) problems.push(`${where}: missing id`);
  if (ids.has(u.id)) problems.push(`${where}: duplicate id`);
  ids.add(u.id);
  if (!ROLES.has(u.role)) problems.push(`${where}: unknown role "${u.role}"`);
  if (typeof u.basePoints !== 'number') problems.push(`${where}: basePoints not a number`);
  if (!Array.isArray(u.models) || !u.models.length) problems.push(`${where}: no models`);
  for (const r of u.unitRules || []) ruleKeys.add(norm(r.name));
  const modelNames = new Set((u.models || []).map((m) => m.name));
  const optIds = new Set();
  for (const o of u.options || []) {
    if (optIds.has(o.id)) problems.push(`${where}: duplicate option id ${o.id}`);
    optIds.add(o.id);
    if (!KINDS.has(o.kind)) problems.push(`${where}/${o.id}: unknown kind ${o.kind}`);
    if (o.model && !modelNames.has(o.model)) problems.push(`${where}/${o.id}: option model "${o.model}" not in models`);
    if (!o.choices || !o.choices.length) problems.push(`${where}/${o.id}: no choices`);
    for (const c of o.choices || []) {
      if (c.list && !listIds.has(c.list) && !['arkana-weapons', 'techno-arkana'].includes(c.list)) problems.push(`${where}/${o.id}: unknown list ${c.list}`);
      if (!c.list && typeof c.points !== 'number') problems.push(`${where}/${o.id}: choice "${c.name}" has non-numeric points`);
    }
    if (o.kind === 'swapModel' && !modelNames.has(o.choices?.[0]?.name)) problems.push(`${where}/${o.id}: swap target "${o.choices?.[0]?.name}" not in models`);
    if (o.requires && !(u.options || []).some((x) => x.id === o.requires)) problems.push(`${where}/${o.id}: requires unknown option ${o.requires}`);
  }
}

// sequela effects must point at real units, lists and sequelae
const seqNames = new Set(out.sequelae.sequelae.map((x) => x.name));
for (const e of out.sequelaEffects.effects) {
  if (!seqNames.has(e.sequela)) problems.push(`sequela effect: unknown sequela "${e.sequela}"`);
  for (const id of e.units || []) if (!ids.has(id)) problems.push(`sequela effect ${e.sequela}: unknown unit ${id}`);
  if (e.list && !listIds.has(e.list)) problems.push(`sequela effect ${e.sequela}: unknown list ${e.list}`);
  for (const c of (e.option && e.option.choices) || []) if (c.list && !listIds.has(c.list)) problems.push(`sequela effect ${e.sequela}: unknown list ${c.list}`);
}
for (const r of out.sequelaEffects.rules || []) ruleKeys.add(norm(r.name));

// modifiers must point at real units and models
const allModels = new Set(out.units.flatMap((u) => u.models.map((m) => m.name)));
const STAT_KEYS = new Set(['M', 'WS', 'BS', 'S', 'T', 'W', 'I', 'A', 'LD', 'CL', 'WP', 'IN', 'SAV', 'INV', 'FRONT', 'SIDE', 'REAR', 'HP']);
for (const m of out.modifiers.modifiers) {
  const where = `modifier ${m.id}`;
  if (!['sequela', 'wargear', 'arkana', 'primeAdvantage', 'upgrade', 'unitRule'].includes(m.source?.type)) problems.push(`${where}: bad source type`);
  if (m.source?.type === 'sequela' && !seqNames.has(m.source.name)) problems.push(`${where}: unknown sequela ${m.source.name}`);
  for (const id of m.appliesTo?.units || []) if (!ids.has(id)) problems.push(`${where}: unknown unit ${id}`);
  for (const n of m.appliesTo?.models || []) if (!allModels.has(n)) problems.push(`${where}: unknown model ${n}`);
  for (const k of Object.keys(m.stats || {})) if (!STAT_KEYS.has(k)) problems.push(`${where}: unknown stat ${k}`);
  if (!['model', 'unit'].includes(m.scope)) problems.push(`${where}: scope must be model or unit`);
}

// second pass: references to weapons / rules (warnings only)
for (const u of out.units) {
  for (const m of u.models || []) for (const w of m.wargear || []) if (!weaponKeys.has(aliases.get(wkey(w)) || wkey(w)) && !ruleKeys.has(norm(w)) && !core.has(norm(w))) warn.push(`${u.id}: wargear "${w}" has no weapon profile or wargear text`);
  for (const r of [...(u.specialRules || []), ...(u.models || []).flatMap((m) => m.specialRules || [])]) {
    if (!ruleKeys.has(norm(r)) && !core.has(norm(r))) warn.push(`${u.id}: rule "${r}" has no text`);
  }
}
for (const l of out.lists) for (const it of l.items) if (!weaponKeys.has(wkey(it.name)) && !ruleKeys.has(norm(it.name))) warn.push(`list ${l.id}: "${it.name}" has no profile or text`);

writeFileSync(join(root, 'data', 'necrons.json'), JSON.stringify(out, null, 1) + '\n');
writeFileSync(join(root, 'js', 'data.js'), '/* Generated by scripts/build-data.mjs — edit data/parts/*.json instead. */\nwindow.NECRON_DATA = ' + JSON.stringify(out) + ';\n');

console.log(`units ${out.units.length}, lists ${out.lists.length}, ranged ${out.weapons.ranged.length}, melee ${out.weapons.melee.length}, wargear ${out.wargear.length}, rules ${Object.values(out.rules).reduce((a, b) => a + b.length, 0)}, detachments ${out.detachments.length}, sequelae ${out.sequelae.sequelae.length}`);
if (warn.length) console.log(`\n${warn.length} reference warnings:\n  ` + [...new Set(warn)].join('\n  '));
if (problems.length) {
  console.error(`\n${problems.length} problems:\n  ` + problems.join('\n  '));
  if (process.argv.includes('--strict')) process.exit(1);
}
