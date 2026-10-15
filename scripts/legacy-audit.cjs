// Find Legacy content that does nothing, or less than the unit already has:
//   node scripts/legacy-audit.cjs [army-id ...] [--json out.json]
// Reads the built js/data-*.js. Reports, per army, modifiers and options whose effect a unit already has
// (Feel No Pain (6+) on a 5+ unit, Deep Strike on a Deep Strike unit, Line (1) on Line (2)), stat changes
// to characteristics the model doesn't have, saves no better than the model's own, weapon rules put on
// models instead of weapons, and options that offer wargear the model already carries.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { norm } = require('../js/engine.js');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const ji = args.indexOf('--json');
const JSON_OUT = ji >= 0 ? args.splice(ji, 2)[1] : null;
const load = (f) => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), { window }); return window; };
const common = load('data-common.js').ARMY_COMMON;
const index = load('armies.js').ARMY_INDEX.filter((a) => a.group !== 'Xenos (fan codexes)');
const armies = args.length ? index.filter((a) => args.includes(a.id)) : index;

const WEAPON_RULES = /^(Rending|Breaching|Shred|Critical Hit|Poisoned|Armourbane|Precision|Phage|Murderous|Duellist's Edge|Deflagrate|Melta|Pinning|Shock|Stun|Suppressive|Bypass|Panic|Aflame|Blast|Template|Overload|Heavy|Limited|Rapid Tracking|Skyfire|Force)\b/i;
// "(5+)" rules: lower is better. "(2)" rules: higher is better. Others: present or not.
const val = (r) => { const m = String(r).match(/\((\d+)(\+?)\)/); return m ? { n: +m[1], plus: !!m[2] } : null; };
const sv = (v) => { const m = String(v ?? '').match(/(\d)\+/); return m ? +m[1] : 7; };

const report = {};
for (const a of armies) {
  const D = load(`data-${a.id}.js`).ARMY_DATA[a.id];
  const W = new Map([...D.weapons.ranged, ...D.weapons.melee, ...common.weapons.ranged, ...common.weapons.melee].map((w) => [w.name.toLowerCase(), w]));
  const unit = new Map(D.units.map((u) => [u.id, u]));
  const found = new Map();
  const add = (what, issue, uname) => {
    const k = `${what}||${issue}`;
    if (!found.has(k)) found.set(k, { what, issue, units: [] });
    if (!found.get(k).units.includes(uname)) found.get(k).units.push(uname);
  };
  const baseRules = (u, m) => [...(u.specialRules || []), ...(m.specialRules || [])];
  const weaponRules = (m) => (m.wargear || []).flatMap((it) => (W.get(String(it).toLowerCase()) || {}).specialRules || []);
  const already = (have, r) => {
    const b = norm(r), v = val(r);
    return have.some((h) => {
      if (norm(h) !== b) return false;
      const hv = val(h);
      if (!v || !hv) return true;
      return v.plus ? hv.n <= v.n : hv.n >= v.n;
    });
  };
  const legacyMods = D.modifiers.modifiers.filter((m) => m.legacy);
  const itemMods = new Map();
  for (const m of legacyMods) if (m.source && m.source.type === 'upgrade') { if (!itemMods.has(m.source.name)) itemMods.set(m.source.name, []); itemMods.get(m.source.name).push(m); }

  // modifiers from army rules, Rites and always-on statlines (item bonuses are checked with their options)
  for (const m of legacyMods) {
    if (m.source && m.source.type === 'upgrade') continue;
    const what = `${m.source && m.source.name ? m.source.name + ': ' : ''}${m.text}`;
    for (const id of (m.appliesTo && m.appliesTo.units) || []) {
      const u = unit.get(id);
      if (!u) continue;
      for (const md of u.models.filter((x) => !m.appliesTo.models || m.appliesTo.models.includes(x.name))) {
        const have = baseRules(u, md);
        for (const r of m.addRules || []) {
          if (already(have, r)) add(what, `already has ${have.find((h) => norm(h) === norm(r))}, so ${r} does nothing`, u.name);
          else if (WEAPON_RULES.test(r)) {
            const wr = weaponRules(md).filter((x) => /^(Rending|Breaching|Critical Hit|Shred|Poisoned|Armourbane)/i.test(x));
            add(what, `${r} is a weapon rule but goes on the model${wr.length ? ` (its weapons already have ${[...new Set(wr)].join(', ')})` : ''}`, u.name);
          }
        }
        for (const [k, v] of Object.entries(m.stats || {})) {
          if (!(k in (md.profile || {}))) add(what, `changes ${k}, which ${md.unitType && /Vehicle/.test(md.unitType) ? 'a vehicle' : 'this model'} doesn't have`, u.name);
          else if (/^best:/.test(v) && sv(md.profile[k]) <= sv(v.slice(5))) add(what, `${k} ${v.slice(5)} is no better than its own ${md.profile[k]}`, u.name);
        }
      }
    }
  }

  // options: wargear the model already has, or an item whose bonus the model already beats
  for (const u of D.units) {
    for (const o of (u.options || []).filter((x) => x.legacy)) {
      const models = o.model ? u.models.filter((m) => m.name === o.model) : u.models;
      for (const c of o.choices || []) {
        for (const md of models) {
          if ((md.wargear || []).some((w) => norm(w) === norm(c.name)) && !(o.replaces || []).length) add(`option "${o.text.replace(/^Legacy: /, '')}": ${c.name}`, `the model already carries ${c.name}`, u.name);
          const ims = itemMods.get(c.name) || [];
          if (!ims.length) continue;
          const have = baseRules(u, md);
          const useless = ims.every((m) => {
            const statsDead = Object.entries(m.stats || {}).every(([k, v]) => !(k in (md.profile || {})) || (/^best:/.test(v) && sv(md.profile[k]) <= sv(v.slice(5))));
            const rulesDead = (m.addRules || []).every((r) => already(have, r));
            return statsDead && rulesDead && !m.condition;
          });
          if (useless) add(`option "${o.text.replace(/^Legacy: /, '')}": ${c.name}`, `does nothing for this model (it already has as good or better)`, u.name);
        }
      }
    }
  }
  report[a.id] = [...found.values()];
}

if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
for (const [a, list] of Object.entries(report)) {
  if (!list.length) continue;
  console.log(`\n## ${a} (${list.length})`);
  for (const f of list) console.log(`- ${f.what} -> ${f.issue} [${f.units.slice(0, 4).join(', ')}${f.units.length > 4 ? ` +${f.units.length - 4}` : ''}]`);
}
