// Monte Carlo balance check for the Legacy house rules.
//   node scripts/balance-sim.cjs [army-id ...] [--trials N] [--out report.json]
//
// For every unit it rolls dice for three things at minimum size and standard wargear:
//   damage dealt to a Tactical Squad, a Cataphractii squad and a Predator, at range and in combat;
//   how many bolter, lascannon and power axe attacks it takes to wipe the unit out.
// It does that for the official unit, with Legacy rules on, and with each Legacy Rite of War, then for each
// Legacy option choice on its own. It reports what moves a unit's value per point far more than official
// options do. The dice follow 3rd edition closely enough to compare like with like (hit and wound charts,
// AP against saves, invulnerables, Feel No Pain and Shrouded, Breaching, Rending, Critical Hit, Shred,
// Poisoned, Armourbane, Blast and Template), but it's a yardstick, not a game: rules that need the table
// (Deep Strike, morale, Tactical Statuses) don't show up and are listed separately for a human read.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { createEngine, wkey } = require('../js/engine.js');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const TRIALS = +flag('--trials', 500);
const OUT = flag('--out', null);
const load = (f) => { const window = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'js', f), 'utf8'), { window }); return window; };
const common = load('data-common.js').ARMY_COMMON;
const index = load('armies.js').ARMY_INDEX.filter((a) => a.group !== 'Xenos (fan codexes)');
const armies = args.length ? index.filter((a) => args.includes(a.id)) : index;

// ---------- dice ----------
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
const d6 = () => 1 + Math.floor(rnd() * 6);
const num = (v, d = 0) => { const n = parseInt(String(v), 10); return Number.isNaN(n) ? d : n; };
const save = (v) => { const m = String(v ?? '').match(/(\d)\+/); return m ? +m[1] : 7; };
const xOf = (rules, name) => { for (const r of rules || []) { const m = String(r).match(new RegExp(`^${name}\\s*\\((\\d+)\\+?\\)`, 'i')); if (m) return +m[1]; } return null; };
const hasRule = (rules, name) => (rules || []).some((r) => new RegExp(`^${name}\\b`, 'i').test(String(r)));
const hitNeed = (bs) => (bs >= 6 ? 2 : bs <= 0 ? 7 : 7 - bs);
const meleeNeed = (ws, def) => (ws > def ? 3 : def > 2 * ws ? 5 : 4);
const woundNeed = (s, t) => { const d = s - t; return d >= 2 ? 2 : d === 1 ? 3 : d === 0 ? 4 : d === -1 ? 5 : d >= -3 ? 6 : 7; };
const rel = (v, base) => { const s = String(v); if (s === 'I' || s === 'A' || s === 'S') return base; if (/^[+-]\d+$/.test(s)) return base + +s; return num(v, base); };

// ---------- weapons ----------
function weaponLookup(D) {
  const all = { ranged: D.weapons.ranged.concat(common.weapons.ranged), melee: D.weapons.melee.concat(common.weapons.melee) };
  const idx = { ranged: new Map(), melee: new Map() };
  // a weapon with modes counts as each of its modes
  for (const k of ['ranged', 'melee']) all[k] = all[k].flatMap((w) => (w.modes && w.modes.length ? w.modes.map((m) => Object.assign({}, m, { name: w.name })) : [w]));
  for (const k of ['ranged', 'melee']) for (const w of all[k]) {
    for (const key of [w.name.toLowerCase(), wkey(w.name), wkey(w.name.replace(/\s*\(.*\)\s*$/, ''))]) {
      if (!idx[k].has(key)) idx[k].set(key, []);
      idx[k].get(key).push(w);
    }
  }
  return (item) => {
    const out = { ranged: [], melee: [] };
    for (const k of ['ranged', 'melee']) {
      for (const key of [item.toLowerCase(), wkey(item), wkey(item).replace(/^twin(-linked)? /, '')]) {
        if (idx[k].has(key)) { out[k] = idx[k].get(key); break; }
      }
    }
    return out;
  };
}

// ---------- targets ----------
function targetFrom(D, id, n) {
  const u = D.units.find((x) => x.id === id);
  const m = u.models[0];
  return { name: u.name, n, p: m.profile, rules: m.specialRules || [] };
}

/** One volley of a weapon from `count` models at a target: average unsaved damage (wounds, or HP for vehicles). */
function volley(att, w, count, tgt, melee) {
  const rules = [...(w.specialRules || []), ...(melee ? att.rules : [])];
  const tp = tgt.p;
  const vehicle = tp.FRONT != null;
  let shots;
  if (melee) shots = Math.max(1, rel(w.AM, num(att.p.A, 1))) * count;
  else shots = num(w.FP, 1) * count;
  const blast = xOf(rules, 'Blast');
  const template = hasRule(rules, 'Template');
  if (blast) shots *= Math.min(tgt.n, 1 + Math.floor(blast / 2));
  if (template) shots = count * Math.min(tgt.n, 4);
  const S = melee ? rel(w.SM, num(att.p.S, 4)) + (hasRule(rules, 'Impact') && /Impact \(S/i.test(rules.join()) ? 1 : 0) : num(w.RS, 4);
  const AP = num(w.AP, 7), D = Math.max(1, num(w.D, 1));
  const hit = template ? 1 : melee ? meleeNeed(num(att.p.WS, 4), num(tp.WS, 4)) : hitNeed(num(att.p.BS, 4));
  const rend = xOf(rules, 'Rending'), crit = xOf(rules, 'Critical Hit'), breach = xOf(rules, 'Breaching'), shred = xOf(rules, 'Shred'), poison = xOf(rules, 'Poisoned');
  const bane = hasRule(rules, 'Armourbane') || hasRule(rules, 'Melta');
  let dmg = 0;
  for (let i = 0; i < shots; i++) {
    let auto = false, extra = 0, ap = AP;
    if (!template) {
      const h = d6();
      if (h < hit && h !== 6) continue;
      if (h < hit) continue;
      if (rend && h >= rend) auto = true;
      if (crit && h >= crit) { auto = true; extra = 1; }
    }
    if (vehicle) {
      const av = num(tp.SIDE ?? tp.FRONT, 12);
      const pen = S + d6();
      if (pen > av || (bane && pen >= av)) dmg += D + extra;
      else if (pen === av) dmg += 0.5;
      continue;
    }
    if (!auto) {
      const wr = d6();
      const need = woundNeed(S, num(tp.T, 4));
      const ok = (need <= 6 && wr >= need) || (poison && wr >= poison);
      if (!ok) continue;
      if (breach && wr >= breach) ap = 2;
      if (shred && wr >= shred) extra += 1;
    }
    const arm = save(tp.SAV), inv = save(tp.INV);
    const sv = Math.min(ap <= arm ? 7 : arm, inv);
    if (sv <= 6 && d6() >= sv) continue;
    // one damage mitigation roll: Feel No Pain, or Shrouded against shooting
    const fnp = Math.min(xOf(tgt.rules, 'Feel No Pain') || 7, melee ? 7 : xOf(tgt.rules, 'Shrouded') || 7);
    if (fnp <= 6 && d6() >= fnp) continue;
    dmg += Math.min(D + extra, num(tp.W, 1));
  }
  return dmg;
}

// rules the dice model; anything else on a datasheet doesn't change the numbers
const SIM = /^(Rending|Breaching|Critical Hit|Shred|Poisoned|Armourbane|Melta|Blast|Template|Impact|Feel No Pain|Shrouded)\b/i;
const cache = new Map();
function mc(key, fn) {
  if (cache.has(key)) return cache.get(key);
  // common random numbers: every measurement replays the same dice, so two units that differ only in
  // something the dice can't see score exactly the same, and a real change isn't buried in noise
  seed = 12345;
  let t = 0;
  for (let i = 0; i < TRIALS; i++) t += fn();
  const v = t / TRIALS;
  cache.set(key, v);
  return v;
}

/** Best weapon per model group against a target, summed over groups. */
function offence(rows, look, tgt, melee) {
  let total = 0;
  for (const r of rows) {
    if (!r.count) continue;
    if (melee && r.profile.WS == null) continue;
    const att = { p: r.profile, rules: r.rules.filter((x) => SIM.test(x)) };
    // a paired item ("Eternity Blade and Praesidium Shield") is looked up part by part
    const find = (it) => { const k = melee ? 'melee' : 'ranged'; const w = look(it)[k]; return w.length ? w : / and /.test(it) ? it.split(/ and /).flatMap((x) => look(x)[k]) : w; };
    const ws = r.items.flatMap(find);
    if (melee && !ws.length) ws.push({ name: 'close combat', IM: 'I', AM: 'A', SM: 'S', AP: 7, D: 1, specialRules: [] });
    let best = 0;
    for (const w of ws) {
      const k = JSON.stringify([melee, att, w.name, w.FP, w.RS, w.IM, w.AM, w.SM, w.AP, w.D, w.specialRules, tgt.name]);
      best = Math.max(best, mc(k, () => volley(att, w, 1, tgt, melee)));
    }
    total += best * r.count;
  }
  return total;
}

/** How many attacks of a weapon it takes to destroy the unit (models in order, overkill wasted). */
function durability(rows, w, melee) {
  const models = rows.flatMap((r) => Array.from({ length: r.count }, () => r));
  if (!models.length) return 0;
  const k = JSON.stringify(['dur', w.name, models.map((m) => [m.profile, m.rules.filter((x) => /Feel No Pain|Shrouded|Eternal/.test(x))])]);
  const att = { p: { WS: 4, BS: 4, S: 4, A: 1 }, rules: [] };
  return mc(k, () => {
    let n = 0;
    for (const m of models) {
      let hp = num(m.profile.W ?? m.profile.HP, 1);
      const tgt = { name: '', n: 1, p: m.profile, rules: m.rules };
      let guard = 0;
      while (hp > 0 && guard++ < 400) { n++; hp -= volley(att, Object.assign({}, w, { FP: 1, AM: 1 }), 1, tgt, melee); }
    }
    return n;
  });
}

// ---------- per unit ----------
function measure(E, sel, look, T) {
  const rows = E.effectiveModels(sel).map((r) => ({ count: r.count, profile: r.profile, rules: r.rules || [], items: r.items || [] }));
  if (!rows.length || !rows.some((r) => r.profile && (r.profile.T != null || r.profile.FRONT != null))) return null;
  const m = {};
  for (const k of ['tac', 'term', 'tank']) { const t = T[k]; m[`ranged:${k}`] = offence(rows, look, t, false); m[`melee:${k}`] = offence(rows, look, t, true); }
  m['tough:bolter'] = durability(rows, T.bolter, false);
  m['tough:lascannon'] = durability(rows, T.lascannon, false);
  m['tough:axe'] = durability(rows, T.axe, true);
  return m;
}
/**
 * Value per point of b relative to a. Each metric is scaled by the army's median unit, so a unit's value is
 * "how many typical units' worth" of shooting, fighting and toughness it brings, summed. The metric that
 * moved most is reported alongside.
 */
let MED = {};
const score = (m) => Object.keys(m).reduce((t, k) => t + (MED[k] ? m[k] / MED[k] : 0), 0);
function gain(a, b, ptsA, ptsB) {
  const r = (score(b) / ptsB) / (score(a) / ptsA);
  let k = null, best = 0;
  for (const x of Object.keys(a)) { const d = MED[x] ? (b[x] - a[x]) / MED[x] : 0; if (d > best) { best = d; k = x; } }
  return { k, r };
}
const pickAll = (E, sel, o, c) => {
  if (o.kind === 'perModel') {
    // every model that can take it, up to the option's cap
    let n = (o.model && E.modelCounts(sel)[o.model]) || 1;
    if (o.max && o.max.fixed != null) n = Math.min(n, o.max.fixed);
    sel.options[o.id] = { [c.name]: Math.max(1, n) };
  }
  else if (o.kind === 'any') sel.options[o.id] = [c.name];
  else if (o.kind === 'upgrade') sel.options[o.id] = true;
  else sel.options[o.id] = c.name;
};

const report = { trials: TRIALS, armies: {} };
const STRONG = /automatically pass|ignore[sd]? (all|any)|counts? as (a )?6|double|\+2 |immune|no saves|can't be (shot|targeted|charged)|cannot be (shot|targeted|charged)|returns? (to play|from Reserves)|every (enemy|friendly)/i;
for (const a of armies) {
  const D = load(`data-${a.id}.js`).ARMY_DATA[a.id];
  D.weapons = { ranged: D.weapons.ranged.concat(common.weapons.ranged), melee: D.weapons.melee.concat(common.weapons.melee) };
  const E = createEngine(D);
  const look = weaponLookup(D);
  // the yardsticks: real units and weapons from this army's data
  const T = {
    tac: targetFrom(D, D.units.some((u) => u.id === 'tactical-squad') ? 'tactical-squad' : D.units.find((u) => u.models[0].profile.T != null).id, 10),
    term: targetFrom(D, D.units.some((u) => u.id === 'cataphractii-terminator-squad') ? 'cataphractii-terminator-squad' : D.units.find((u) => u.models[0].profile.T != null).id, 5),
    tank: { name: 'Predator', n: 1, p: { BS: 4, FRONT: 13, SIDE: 12, REAR: 10, HP: 5 }, rules: [] },
  };
  const W = (n, k) => look(n)[k][0];
  Object.assign(T, { bolter: W('Bolter', 'ranged'), lascannon: W('Lascannon', 'ranged'), axe: W('Power axe', 'melee') });
  const targets = { tac: T.tac, term: T.term, tank: T.tank };
  const meas = (sel) => measure(E, sel, look, Object.assign({}, targets, { bolter: T.bolter, lascannon: T.lascannon, axe: T.axe }));
  const groups = (D.armyConfig && D.armyConfig.groups) || [];
  const riteGroup = groups.find((g) => g.id === 'legacy-rite-of-war');
  const base = (cfg) => ({ version: 2, faction: a.id, name: '', pointsLimit: 3000, sequelae: [], config: cfg, detachments: [] });
  const out = { rites: [], legacyRules: [], options: [], official: [] };
  const units = D.units.filter((u) => !u.ally);
  // the army's median unit, metric by metric, from the official units
  E.setArmy(base({}));
  const baseM = units.map((u) => meas(E.newSelection(u.id))).filter(Boolean);
  MED = {};
  for (const k of Object.keys(baseM[0] || {})) {
    const v = baseM.map((m) => m[k]).filter((x) => x > 0).sort((x, y) => x - y);
    MED[k] = v.length ? v[Math.floor(v.length / 2)] : 0;
  }

  // 1. official vs Legacy rules on vs each Rite (no points change, so any gain is free)
  for (const cfg of [{ name: 'Legacy rules', c: { 'legacy-rules': ['Legacy rules'] } }, ...(riteGroup ? riteGroup.choices.map((r) => ({ name: r.name, c: { 'legacy-rules': ['Legacy rules'], 'legacy-rite-of-war': [r.name] } })) : [])]) {
    for (const u of units) {
      E.setArmy(base(cfg.name === 'Legacy rules' ? {} : { 'legacy-rules': ['Legacy rules'] }));
      const s0 = E.newSelection(u.id); const m0 = meas(s0); const p0 = E.unitPoints(s0);
      if (!m0 || !p0) continue;
      E.setArmy(base(cfg.c));
      const s1 = E.newSelection(u.id); const m1 = meas(s1); const p1 = E.unitPoints(s1);
      const g = gain(m0, m1, p0, p1);
      if (g.r > 1.001 && g.k) (cfg.name === 'Legacy rules' ? out.legacyRules : out.rites).push({ source: cfg.name, unit: u.name, metric: g.k, gain: +g.r.toFixed(2), before: +m0[g.k].toFixed(2), after: +m1[g.k].toFixed(2), pts: p0 });
    }
  }

  // 2. option choices on their own: official ones with Legacy off, Legacy ones with it on
  for (const legacy of [false, true]) {
    E.setArmy(base(legacy ? { 'legacy-rules': ['Legacy rules'] } : {}));
    for (const u of units) {
      const s0 = E.newSelection(u.id); const m0 = meas(s0); const p0 = E.unitPoints(s0);
      if (!m0 || !p0) continue;
      for (const o of E.optionsOf(s0)) {
        if (!!o.legacy !== legacy || o.kind === 'swapModel') continue;
        for (const c of E.choicesFor(o, s0).slice(0, 25)) {
          const s1 = E.newSelection(u.id);
          pickAll(E, s1, o, c);
          const p1 = E.unitPoints(s1);
          let m1; try { m1 = meas(s1); } catch (e) { continue; }
          if (!m1) continue;
          const g = gain(m0, m1, p0, p1);
          (legacy ? out.options : out.official).push({ unit: u.name, option: o.text.replace(/^Legacy: /, ''), choice: c.name, cost: p1 - p0, metric: g.k, gain: +g.r.toFixed(3) });
        }
      }
    }
  }

  // 3. Legacy rules text that the dice can't see but that reads strong
  const rules = (D.rules.specialRules || []).filter((r) => r.legacy && STRONG.test(r.text)).map((r) => ({ name: r.name, text: r.text }));
  report.armies[a.id] = Object.assign(out, { strongText: rules });
  process.stderr.write(`[${a.id}] rites ${out.rites.length}, legacy ${out.legacyRules.length}, options ${out.options.length}, official ${out.official.length}, text ${rules.length}\n`);
}

// thresholds from the official options: anything past the 99th percentile of their value-per-point gain
const off = Object.values(report.armies).flatMap((x) => x.official.map((o) => o.gain)).sort((a, b) => a - b);
const pct = (q) => off[Math.min(off.length - 1, Math.floor(q * off.length))];
report.officialGain = { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: off[off.length - 1] };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.officialGain));
