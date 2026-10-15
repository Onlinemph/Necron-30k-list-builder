// Check one army's legacy house rules without rebuilding anything:
//   node scripts/legacy-check.mjs world-eaters
// Reports unknown units, models, stats and option kinds (from scripts/legacy.mjs), plus option choices,
// added rules and weapon rules that have no profile or text anywhere. Exits 1 on any problem.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { applyLegacy } from './legacy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { norm, wkey } = createRequire(import.meta.url)(join(root, 'js', 'engine.js'));
const id = process.argv[2];
if (!id) { console.error('usage: node scripts/legacy-check.mjs <army-id>'); process.exit(2); }
const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
const index = read(join(root, 'data', 'bsdata', 'armies.json')).armies;
const army = index.find((a) => a.id === id);
if (!army) { console.error(`no BSData army "${id}"`); process.exit(2); }
const common = read(join(root, 'data', 'bsdata', 'common.json'));

const parts = join(root, 'data', 'bsdata', id, 'parts');
const out = { units: [], weapons: { ranged: [], melee: [] }, wargear: [], rules: { specialRules: [] }, modifiers: { modifiers: [] }, armyConfig: null };
for (const f of readdirSync(parts).filter((x) => x.endsWith('.json'))) {
  const d = read(join(parts, f));
  if (d.units) out.units.push(...d.units);
  if (d.armyConfig) out.armyConfig = JSON.parse(JSON.stringify(d.armyConfig));
}
const before = new Map(out.units.map((u) => [u.id, u.options.length]));
const problems = applyLegacy(root, out, { id, group: army.group });

// names the app can show text or a profile for
const known = new Set();
for (const w of [...common.weapons.ranged, ...common.weapons.melee, ...out.weapons.ranged, ...out.weapons.melee]) known.add(wkey(w.name));
for (const w of [...common.wargear, ...out.wargear]) known.add(norm(w.name));
for (const k of Object.keys(common.rules)) for (const r of common.rules[k]) known.add(norm(r.name));
for (const r of out.rules.specialRules) known.add(norm(r.name));
// weapons with modes are stored as "Name - Mode", and mounted ones carry a "Dorsal (Front) Mounted" prefix
const modes = new Set([...common.weapons.ranged, ...common.weapons.melee].map((w) => w.name.toLowerCase().split(' - ')[0]));
const has = (n) => { const bare = String(n).replace(/^.*\bMounted\s+/i, ''); return [n, bare].some((x) => known.has(norm(x)) || known.has(wkey(x)) || modes.has(x.toLowerCase())); };

for (const u of out.units.filter((x) => x.legacy)) {
  for (const m of u.models) for (const w of m.wargear) if (!has(w)) problems.push(`unit ${u.id}/${m.name}: wargear "${w}" has no weapon profile, wargear or rule text`);
  for (const r of [...u.specialRules, ...u.models.flatMap((m) => m.specialRules)]) if (!has(r)) problems.push(`unit ${u.id}: rule "${r}" has no text`);
}
for (const u of out.units) {
  const models = new Set(u.models.map((m) => m.name));
  for (const o of u.options.filter((x) => x.legacy)) {
    if (o.model && !models.has(o.model)) problems.push(`${u.id}/${o.id}: model "${o.model}" not in unit`);
    for (const c of o.choices) if (!has(c.name)) problems.push(`${u.id}/${o.id}: choice "${c.name}" has no weapon profile, wargear or rule text`);
  }
}
const allModels = new Set(out.units.flatMap((u) => u.models.map((m) => m.name)));
for (const m of out.modifiers.modifiers.filter((x) => x.legacy)) {
  for (const n of m.appliesTo.models || []) if (!allModels.has(n)) problems.push(`modifier "${m.text}": unknown model ${n}`);
  for (const r of [...m.addRules, ...m.removeRules]) if (!has(r)) problems.push(`modifier "${m.text}": rule "${r}" has no text`);
}
for (const w of [...out.weapons.ranged, ...out.weapons.melee]) {
  for (const r of w.specialRules || []) if (!has(r)) problems.push(`weapon ${w.name}: rule "${r}" has no text`);
  const keys = out.weapons.ranged.includes(w) ? ['R', 'FP', 'RS', 'AP', 'D'] : ['IM', 'AM', 'SM', 'AP', 'D'];
  for (const k of keys) if (w[k] == null) problems.push(`weapon ${w.name}: missing ${k}`);
}
const rites = (out.armyConfig.groups.find((g) => g.id === 'legacy-rite-of-war') || { choices: [] }).choices;
const added = out.units.reduce((n, u) => n + u.options.length - (before.get(u.id) || 0), 0);
console.log(`[${id}] ${rites.length} Rites of War (${rites.map((r) => r.name).join(', ')}); ${added} options added; ${out.modifiers.modifiers.length} modifiers; ${out.units.filter((u) => u.roleWhen).length} units with extra roles`);
// how much of the army's own content leans on morale (kept for fear, rallying and the fall of a leader)
const ownFile = join(root, 'data', 'legacy', `${id}.json`);
if (existsSync(ownFile)) {
  const d = read(ownFile);
  const texts = [...(d.rules || []), ...(d.wargear || [])].map((r) => r.text || '').concat((d.armyRules || []).flatMap((r) => [...(r.benefits || []), ...(r.drawbacks || [])]));
  console.log(`morale references (Cool, Leadership, Willpower, Morale): ${texts.filter((t) => /\b(Cool|Leadership|Willpower|Morale)\b/.test(t)).length} of ${texts.length} rules`);
}
if (problems.length) { console.error(`${problems.length} problems:\n  ` + problems.join('\n  ')); process.exit(1); }
console.log('no problems');
