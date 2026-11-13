// Building legal lists through the builder's own engine: make a unit with its required weapon picks filled,
// place it in the Primary Detachment or an Auxiliary or Apex Detachment that has room, grow squads, and check the
// army. Used by lists/legions/make.cjs (one generic list per Legion) and lists/strong/make.cjs (lists built on
// each Legion's strengths).
const fs = require('fs'), vm = require('vm'), path = require('path');
const R = path.join(__dirname, '..', '..') + '/';
const { createEngine } = require(R + 'js/engine.js');
const { loadArmyData, resolveItem, buildUnit, buildArmy } = require(R + 'sim/lib/army.cjs');
const ai = require(R + 'sim/lib/ai.cjs');

// reference targets for weighing weapons: a Tactical Squad, Terminators and a Predator
let REF = null;
const refTargets = () => REF || (REF = (() => { const u = buildArmy(R + 'sim/lists/legions/sons-of-horus.json', 1).units; return ['Tactical Squad', 'Justaerin Terminator Squad', 'Predator'].map((n) => u.find((x) => x.name === n)); })());
const load = (id) => { const window = {}; vm.runInNewContext(fs.readFileSync(`${R}js/data-${id}.js`, 'utf8'), { window }); return window.ARMY_DATA[id]; };

const TRAITOR = new Set(['emperors-children', 'iron-warriors', 'night-lords', 'world-eaters', 'death-guard', 'thousand-sons', 'sons-of-horus', 'word-bearers', 'alpha-legion']);
// where each role goes once the Primary Detachment is full: auxiliaries need a Command each, the apex needs High Command
const AUX = { Armour: 'core-armoured-support', Support: 'core-tactical-support', Troops: 'core-tactical-support', 'War Engine': 'core-heavy-support', 'Heavy Assault': 'core-shock-assault', 'Fast Attack': 'core-first-strike', Recon: 'core-combat-pioneer', 'Heavy Transport': 'core-armoured-fist', Transport: 'core-armoured-fist' };
const APEX = { Elites: 'core-army-vanguard', Retinue: 'core-combat-retinue', Command: 'core-officer-cadre' };

function createBuilder(id, { limit = 3000, name, smart = false } = {}) {
  const D = load(id);
  const E = createEngine(D);
  const { weapons } = loadArmyData(id);
  const isMelee = (n) => resolveItem(weapons, n).melee.some((w) => !(w.specialRules || []).some((r) => /^Detonation/.test(r)));
  const isGun = (n) => resolveItem(weapons, n).ranged.length > 0;
  /** A unit selection with the given options and model counts; required picks left open get the cheapest melee weapon and, where a model takes two, the cheapest gun. */
  const mk = ([role, uid, options = {}, counts = {}]) => {
    if (!D.units.find((u) => u.id === uid)) return null;
    const s = E.newSelection(uid); Object.assign(s.options, JSON.parse(JSON.stringify(options))); Object.assign(s.counts, counts);
    for (const o of E.optionsOf(s)) {
      if (!o.required || s.options[o.id]) continue;
      const c = E.choicesFor(o, s); const n = E.modelCounts(s)[o.model] || 1;
      const many = (o.max && o.max.fixed) || +((String(o.text || '').match(/choose (\d+)/i) || [])[1] || 1);
      if (!c.length) continue;
      const byCost = [...c].sort((a, b) => (a.points || 0) - (b.points || 0));
      const melee = byCost.find((x) => isMelee(x.name)), gun = byCost.find((x) => isGun(x.name));
      const weaponPick = melee ? (many >= 2 && gun ? [melee.name, gun.name] : [melee.name]) : null;
      // a per-model group takes one pick per model, or as many as its perModelPicks allows ("choose 2")
      if (o.kind === 'perModel') s.options[o.id] = Object.fromEntries((weaponPick || [c[0].name]).slice(0, o.perModelPicks || 1).map((w) => [w, n]));
      else if (o.kind === 'any') s.options[o.id] = weaponPick || c.slice(0, many).map((x) => x.name);
      else s.options[o.id] = weaponPick ? weaponPick[0] : c[0].name;
    }
    if (smart) choose(role, s, options);
    return { role, s };
  };
  /**
   * Weigh a unit by the simulator's combat maths: points it would destroy per turn, shooting at 18" and fighting
   * after a charge, against the reference targets, for each point it costs.
   */
  const st = { cache: { shoot: new Map(), melee: new Map() }, table: { pieces: [], objectives: [] }, units: [] };
  const worth = (role, s) => {
    if (E.unitIssues(s).some((i) => i.level === 'error')) return -1;
    const u = buildUnit(id, army(), { role, unit: s }, { name: 'x' }, 0);
    u.turn = { charged: true };
    let v = 0;
    for (const t of refTargets()) v += ai.meleeEV(st, u, t) + ai.evAt(ai.shootTable(st, u, t), 18);
    return v / Math.max(1, u.pts);
  };
  /**
   * For each required weapon pick the plan left open, take the choice that makes the unit worth most per point,
   * among the choices that cost no more than the cheapest: a better weapon at the same price, never one that
   * spends points the squad's bodies would otherwise get (those hold markers and soak fire, which damage per
   * point doesn't count).
   */
  const choose = (role, s, given) => {
    for (const o of E.optionsOf(s)) {
      if (!o.required || given[o.id] !== undefined || !s.options[o.id]) continue;
      const all = E.choicesFor(o, s);
      const cheapest = Math.min(...all.map((x) => x.points || 0));
      const c = all.filter((x) => (x.points || 0) <= cheapest).map((x) => x.name);
      const slots = o.kind === 'perModel' ? Object.keys(s.options[o.id]) : o.kind === 'any' ? s.options[o.id] : [s.options[o.id]];
      const set = (picks) => {
        if (o.kind === 'perModel') { const n = E.modelCounts(s)[o.model] || 1; s.options[o.id] = Object.fromEntries(picks.map((w) => [w, n])); }
        else s.options[o.id] = o.kind === 'any' ? picks : picks[0];
      };
      let picks = [...slots], best = worth(role, s);
      // a melee weapon is only swapped for another melee weapon, a gun for a gun: a squad that lost its guns
      // would turn into an assault unit (Terminators with Deep Strike would wait in Reserves)
      const sameKind = (a, b) => isMelee(a) === isMelee(b) && isGun(a) === isGun(b);
      for (let k = 0; k < picks.length; k++) {
        for (const x of c) {
          if (picks.includes(x) || !sameKind(x, picks[k])) continue;
          const tryPicks = picks.map((p, i) => (i === k ? x : p));
          set(tryPicks);
          const v = worth(role, s);
          if (v > best * 1.01) { best = v; picks = tryPicks; }
        }
        set(picks);
      }
    }
  };
  const primary = E.makeDetachment('primary', D.forceorg.primary.name, D.forceorg.primary.slots.flatMap((d) => Array.from({ length: d.count ?? 1 }, (_, i) => ({ role: d.role, prime: i < (d.prime || 0) }))));
  const dets = [primary];
  /** Put a unit in the first free slot of its role, opening an Auxiliary or Apex Detachment for it if one is allowed. */
  const place = (x) => {
    for (const d of dets) { const slot = d.slots.find((sl) => sl.role === x.role && !sl.unit); if (slot) { slot.unit = x.s; return true; } }
    const commands = primary.slots.filter((sl) => sl.role === 'Command' && sl.unit).length;
    const aux = dets.filter((d) => d.type === 'Auxiliary' || d.kind === 'auxiliary').length;
    const apex = dets.filter((d) => d.type === 'Apex' || d.kind === 'apex').length;
    const warlord = dets.some((d) => d.type === 'Warlord' || d.kind === 'warlord');
    // a Primarch (the Warlord role) brings a Warlord Detachment, with room for a Retinue and a Heavy Transport
    const defId = x.role === 'Warlord' && !warlord ? 'core-warlord' : AUX[x.role] && aux < commands ? AUX[x.role] : APEX[x.role] && apex < 1 ? APEX[x.role] : null;
    if (!defId) return false;
    const d = E.detachmentFromDef(defId); dets.push(d);
    const slot = d.slots.find((sl) => sl.role === x.role && !sl.unit);
    if (!slot) return false;
    slot.unit = x.s; return true;
  };
  // Allegiance, and the Legion's own Rite of War where one must be chosen (it carries the Legion Tactica)
  const config = { allegiance: [TRAITOR.has(id) ? 'Traitor' : 'Loyalist'] };
  const rite = D.armyConfig.groups.find((g) => g.id === 'rite-of-war' && g.min > 0);
  if (rite) config['rite-of-war'] = [rite.choices[0].name];
  const army = () => ({ version: 2, faction: id, name: name || id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), pointsLimit: limit, sequelae: [], config, detachments: dets });
  const total = () => { const a = army(); E.setArmy(a); return dets.reduce((t, d) => t + d.slots.filter((s) => s.unit).reduce((x, s) => x + E.unitPoints(s.unit, s), 0), 0); };
  const remove = (s) => { for (const d of dets) for (const sl of d.slots) if (sl.unit === s) sl.unit = null; };
  /** Make and place a unit; it's taken back out if it breaks the points limit. */
  const add = (spec) => {
    const x = mk(spec); if (!x || !place(x)) return false;
    if (total() > limit) { remove(x.s); return false; }
    return true;
  };
  const count = (uid) => dets.reduce((t, d) => t + d.slots.filter((sl) => sl.unit && sl.unit.unitId === uid).length, 0);
  /** One more model in a squad, if it stays legal and under the limit; the required weapon picks grow with it. */
  const grow = (sl, max = Infinity) => {
    const def = D.units.find((u) => u.id === sl.unit.unitId);
    if (E.effectiveModels(sl.unit, sl).reduce((t, m) => t + m.count, 0) >= max) return false;
    for (const m of def.models || []) {
      if (m.max == null || m.max <= (m.min || 0)) continue;
      const cur = sl.unit.counts[m.name] ?? m.min;
      if (cur >= m.max) continue;
      const before = JSON.stringify(sl.unit.options);
      sl.unit.counts[m.name] = cur + 1;
      // every model of a required weapon group takes its weapons, so the picks grow with the squad
      for (const o of E.optionsOf(sl.unit)) {
        const v = sl.unit.options[o.id];
        if (o.kind !== 'perModel' || !o.required || o.required.count !== 'all' || !v || typeof v !== 'object') continue;
        for (const k of Object.keys(v)) v[k] = E.modelCounts(sl.unit)[o.model] || 1;
      }
      if (total() > limit || E.unitIssues(sl.unit).some((i) => i.level === 'error')) { sl.unit.counts[m.name] = cur; sl.unit.options = JSON.parse(before); continue; }
      return true;
    }
    return false;
  };
  /** Grow every squad the predicate picks, round-robin, until none can grow (or reaches `max` models). */
  const growAll = (pick, max) => {
    let grew = true;
    while (grew) { grew = false; for (const d of dets) for (const sl of d.slots) if (sl.unit && pick(sl) && grow(sl, max)) grew = true; }
  };
  /** Check the army and write it as a list file. */
  const finish = (file) => {
    const a = army(); E.setArmy(a);
    const errors = E.armyIssues(a).filter((i) => i.level === 'error').map((i) => i.msg);
    const slim = JSON.parse(JSON.stringify(a), (k, v) => (k === 'uid' || v === null || (k === 'options' && v && !Object.keys(v).length) || (k === 'counts' && v && !Object.keys(v).length) || (v === false && ['flexible', 'advisor', 'prime'].includes(k)) ? undefined : v));
    if (file) fs.writeFileSync(file, JSON.stringify(slim, null, 1));
    const units = dets.flatMap((d) => d.slots.filter((s) => s.unit).map((s) => `${s.unit.unitId}${E.effectiveModels(s.unit, s).reduce((t, m) => t + m.count, 0) > 1 ? 'x' + E.effectiveModels(s.unit, s).reduce((t, m) => t + m.count, 0) : ''}`));
    return { id, total: total(), errors, dets: dets.map((d) => d.name), units };
  };
  return { D, E, dets, primary, config, mk, place, add, remove, total, count, grow, growAll, army, finish };
}

module.exports = { createBuilder, TRAITOR };
