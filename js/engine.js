/* Necron 30k list builder: points, options and validation.
 * Plain script so the app works from file:// — exposes `NecronEngine` on window,
 * or module.exports under Node (tests). */
(function (root) {
  'use strict';

  const ROLES = [
    'Warlord', 'High Command', 'Command', 'Retinue', 'Elites', 'War Engine', 'Troops',
    'Support', 'Transport', 'Heavy Assault', 'Heavy Transport', 'Armour', 'Recon',
    'Fast Attack', 'Lord of War', 'Fortification',
  ];

  const ARKANA = ['Chronomancy', 'Ethermancy', 'Geomancy', 'Plasmancy', 'Psychomancy', 'Technomancy'];

  const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  /** Key for matching a wargear line ("2 Gauss Slicers", "Hull (left) mounted Gauss Flayer Array") to a weapon profile. */
  const wkey = (n) => {
    let k = norm(n).replace(/\s+with .*$/, '').replace(/^the \w+ profile has /, '').replace(/-/g, ' ');
    // strip counts and mount prefixes in any order: "Two Centreline Mounted big shootas", "3 Arm Mounted supa-rokkits"
    for (let prev = null; prev !== k;) {
      prev = k;
      k = k.replace(/^\d+\s*x?\s+/, '')
        .replace(/^(a|an|one|two|three|four|pair of|paired)\s+/, '')
        .replace(/^((hull|centreline|centerline|sponson|pintle|turret|rear|front|side|arm|carapace|head)\s+)+mounted\s+/, '')
        .replace(/^twin linked\s+/, 'twin ');
    }
    return k.replace(/s$/, '');
  };

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return (prefix || 'x') + Date.now().toString(36) + uidCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function createEngine(data) {
    // Per-unit faction choice: Crypto-Arkana for Necrons, Great Clan for Orks. Ork data marks it
    // with factionChoice / fixedChoice; both map onto the same fields.
    const CHOICE = (data.meta && data.meta.choice) || { label: 'Crypto-Arkana', options: ARKANA };
    for (const u of data.units) {
      if (u.factionChoice) u.cryptoArkana = true;
      if (u.fixedChoice) u.fixedArkana = u.fixedChoice;
    }
    const unitsById = new Map(data.units.map((u) => [u.id, u]));
    const listsById = new Map((data.lists || []).map((l) => [l.id, l]));
    const detById = new Map((data.detachments || []).map((d) => [d.id, d]));

    function unit(id) { return unitsById.get(id); }

    // ---------- Aeonic Sequelae effects ----------
    const effects = (data.sequelaEffects && data.sequelaEffects.effects) || [];
    let activeSeq = new Set();
    function setSequelae(list) { activeSeq = new Set(list || []); }
    // ---------- what else is in the army: config choices, units, upgrades, and each unit's detachment ----------
    // BSData imports mark options, units and effects "only with X" (when) or "not with X" (unless).
    let ctx = { config: new Set(), units: new Set(), upgrades: new Set(), categories: new Set(), detOf: new Map() };
    function setArmy(army) {
      setSequelae(army.sequelae);
      const config = new Set(Object.values(army.config || {}).flat());
      const units = new Set(), upgrades = new Set(), categories = new Set(), detOf = new Map();
      for (const d of army.detachments) for (const s of d.slots) {
        if (!s.unit) continue;
        const u = unit(s.unit.unitId);
        units.add(s.unit.unitId);
        detOf.set(s.unit, baseName(d));
        for (const [id, v] of Object.entries(s.unit.options || {})) {
          if (v == null || v === false || v === '' || v === 0) continue;
          if (typeof v === 'string') upgrades.add(v);
          else if (Array.isArray(v)) v.forEach((x) => upgrades.add(x));
          else if (typeof v === 'object') Object.entries(v).forEach(([k, n]) => { if (n > 0) upgrades.add(k); });
          else { const o = u && (u.options || []).find((x) => x.id === id); if (o && o.choices[0]) upgrades.add(o.choices[0].name); }
        }
        if (u) for (const m of u.models) for (const w of m.wargear || []) upgrades.add(w);
        if (u) for (const c of u.categories || []) categories.add(c);
      }
      ctx = { config, units, upgrades, categories, detOf };
    }
    /** A detachment's own name, without an ally suffix ("Planetfall Speartip (Ultramarines)"). */
    function baseName(d) { const def = d.defId && detById.get(d.defId); return def ? def.name : d.name; }
    function condOk(c, sel, detName) {
      if (c.config) return ctx.config.has(c.config);
      if (c.unit) return ctx.units.has(c.unit);
      if (c.upgrade) return ctx.upgrades.has(c.upgrade);
      if (c.detachment) return (detName || (sel && ctx.detOf.get(sel))) === c.detachment;
      if (c.category) return ctx.categories.has(c.category);
      if (c.all) return c.all.every((x) => condOk(x, sel, detName));
      return false;
    }
    function available(x, sel, detName) {
      if (!x) return false;
      if (x.when && !x.when.some((c) => condOk(c, sel, detName))) return false;
      if (x.unless && x.unless.some((c) => condOk(c, sel, detName))) return false;
      return true;
    }
    /** A config group's limit after anything in the army that sets it (a Force Commander: 2; Oblitum Pattern Cohort: 0). */
    function configMax(g) {
      const hits = (g.maxWhen || []).filter((x) => condOk(x.when));
      if (!hits.length) return g.max;
      return hits.some((x) => x.max < g.max) ? Math.min(...hits.map((x) => x.max)) : Math.max(...hits.map((x) => x.max));
    }
    const condText = (c) => (c.all ? c.all.map((x) => condText(x)).join(' and ') : null) || (c.category ? `a ${c.category}` : null) || c.config || c.unitName || (c.unit && unit(c.unit) ? unit(c.unit).name : c.unit) || c.upgrade || (c.detachment ? `the ${c.detachment}` : '?');

    function activeEffects(type) { return effects.filter((e) => activeSeq.has(e.sequela) && (!type || e.type === type)); }

    function unitHasTrait(u, t) {
      const k = t.replace(/[[\]]/g, '').toLowerCase();
      if (k === 'crypto-arkana') return !!(u.cryptoArkana || u.fixedArkana);
      const pool = [...(u.traits || []), ...u.models.map((m) => m.unitType || ''), ...(u.specialRules || [])];
      return pool.some((x) => x.toLowerCase().includes(k));
    }
    function unitHasRule(u, r) {
      const k = r.toLowerCase();
      return [...(u.specialRules || []), ...u.models.flatMap((m) => m.specialRules || [])].some((x) => x.toLowerCase().startsWith(k));
    }
    function effectMatches(e, u) {
      if (e.units && !e.units.includes(u.id)) return false;
      const f = e.filter;
      if (!f) return true;
      if (f.role && u.role !== f.role) return false;
      if (f.excludeRoles && f.excludeRoles.includes(u.role)) return false;
      if (f.cryptoArkana && !(u.cryptoArkana || u.fixedArkana)) return false;
      if (f.trait && !unitHasTrait(u, f.trait)) return false;
      if (f.withoutRule && unitHasRule(u, f.withoutRule)) return false;
      if (f.commandSubtype && !u.models.some((m) => /\bCommand\b/.test(m.unitType || ''))) return false;
      return true;
    }
    /** Unit options plus any granted by the chosen Aeonic Sequelae. */
    function optionsOf(sel) {
      const u = unit(sel.unitId);
      const extra = activeEffects('option').filter((e) => effectMatches(e, u)).map((e) => Object.assign({ replaces: [] }, e.option, { effect: e }));
      const choice = arkanaOf(sel);
      const byChoice = choice ? choiceEffects.filter((e) => e.type === 'option' && (e.choice || []).includes(choice) && choiceEffectMatches(e, u))
        .map((e) => Object.assign({ replaces: [] }, e.option, { effect: e })) : [];
      return (u.options || []).filter((o) => !(o.when || o.unless) || available(o, sel)).concat(extra, byChoice);
    }
    const choiceEffects = (data.choiceEffects && data.choiceEffects.effects) || [];
    function choiceEffectMatches(e, u) {
      const byUnit = e.units ? e.units.includes(u.id) : null;
      const f = e.filter;
      let byFilter = null;
      if (f) {
        byFilter = true;
        if (f.unitTypeAny && !u.models.some((m) => f.unitTypeAny.some((t) => new RegExp(`\\b${t}\\b`).test(m.unitType || '')))) byFilter = false;
        if (f.trait && !unitHasTrait(u, f.trait)) byFilter = false;
        if (f.role && u.role !== f.role) byFilter = false;
        if (f.roles && !f.roles.includes(u.role)) byFilter = false;
      }
      if (byUnit === null && byFilter === null) return true;
      if (e.anyOf) return !!(byUnit || byFilter);
      return byUnit !== false && byFilter !== false;
    }

    function modelMax(u, m) {
      // units built from a menu of models ("between 1 and 12 of the following") cap each type at the unit size
      let max = m.max ?? (u.size ? u.size.max : m.min);
      for (const e of activeEffects('maxModels')) if (effectMatches(e, u) && e.model === m.name) max += e.add;
      return max;
    }
    /** Battlefield roles a unit may fill: its own, plus any a Sequela allows. */
    function rolesFor(u) {
      const r = [u.role];
      for (const e of activeEffects('altRole')) if (effectMatches(e, u) && !r.includes(e.role)) r.push(e.role);
      return r;
    }
    /** Traits a selection gains from Sequela upgrades or from filling an alternative role. */
    function grantedTraits(sel, slot) {
      const u = unit(sel.unitId);
      const out = [];
      for (const o of optionsOf(sel)) if (o.effect && o.effect.grantsTrait && sel.options[o.id]) out.push(o.effect.grantsTrait);
      if (slot && slot.role !== u.role) for (const e of activeEffects('altRole')) if (e.role === slot.role && e.grantsTrait && effectMatches(e, u)) out.push(e.grantsTrait);
      return out;
    }

    // ---------- arkana ----------
    function arkanaOf(sel) {
      const u = unit(sel.unitId);
      if (!u) return null;
      return u.fixedArkana || (u.cryptoArkana ? sel.arkana || null : null);
    }

    // ---------- choices ----------
    function resolveList(listId, sel) {
      let id = listId;
      if (listId === 'arkana-weapons' || listId === 'techno-arkana') {
        const ark = arkanaOf(sel);
        if (!ark) return [];
        id = listId + ':' + ark;
      }
      const list = listsById.get(id);
      if (!list) return [];
      const items = list.items.slice();
      for (const e of activeEffects('listAdd')) if (e.list === id) items.push(...e.items);
      return items.map((it) => ({ name: it.name, points: Number(it.points) || 0, from: list.name }));
    }

    function choicesFor(opt, sel) {
      const out = [];
      const seen = new Set();
      for (const c of opt.choices || []) {
        const items = c.list ? resolveList(c.list, sel) : [{ name: c.name, points: Number(c.points) || 0, pointsUnknown: !!c.pointsUnknown }];
        for (const it of items) {
          if (seen.has(it.name)) continue;
          seen.add(it.name);
          out.push(it);
        }
      }
      return out;
    }

    // ---------- models ----------
    function swapTargets(u) {
      const s = new Set();
      for (const o of u.options || []) {
        if (o.kind === 'swapModel' && o.choices && o.choices[0]) s.add(o.choices[0].name);
      }
      return s;
    }

    /** Model types whose count the player sets directly. */
    function sizableModels(u) {
      const targets = swapTargets(u);
      return u.models.filter((m) => !targets.has(m.name) && !m.scaleWith && (m.max ?? (u.size && u.size.max) ?? m.min) > m.min);
    }

    function newSelection(unitId) {
      const u = unit(unitId);
      if (!u) throw new Error('Unknown unit ' + unitId);
      const counts = {};
      const targets = swapTargets(u);
      for (const m of u.models) counts[m.name] = targets.has(m.name) ? 0 : m.min;
      return { uid: uid('u'), unitId, counts, options: {}, arkana: u.cryptoArkana && !u.fixedArkana ? null : undefined, primeAdvantage: null };
    }

    /** Effective count of each model type after swaps. */
    function modelCounts(sel) {
      const u = unit(sel.unitId);
      const counts = {};
      const targets = swapTargets(u);
      for (const m of u.models) counts[m.name] = targets.has(m.name) ? 0 : (sel.counts[m.name] ?? m.min);
      // models that come in fixed numbers per another model (e.g. 2 Gretchin Gunners per Big Gun)
      for (const m of u.models) if (m.scaleWith) counts[m.name] = m.scaleWith.count * (counts[m.scaleWith.model] || 0);
      for (const o of u.options || []) {
        if (o.kind !== 'swapModel') continue;
        const n = Number(sel.options[o.id]) || 0;
        const target = o.choices[0].name;
        const src = o.model || u.models[0].name;
        counts[src] = (counts[src] || 0) - n;
        counts[target] = (counts[target] || 0) + n;
      }
      return counts;
    }

    function totalModels(sel) {
      return Object.values(modelCounts(sel)).reduce((a, b) => a + b, 0);
    }

    /** Number of models eligible for a perModel/swapModel option before other options consume them. */
    function eligible(opt, sel) {
      const u = unit(sel.unitId);
      if (opt.kind === 'swapModel') {
        const src = opt.model || u.models[0].name;
        return sel.counts[src] ?? 0;
      }
      // one model carrying several copies of a weapon (e.g. a Monolith's Gauss Flux Arcs)
      if (opt.perWeapon && opt.max && opt.max.fixed != null) return opt.max.fixed;
      if (opt.max && opt.max.perModelOf && opt.addsModels) return Infinity;
      if (opt.models) { const c = modelCounts(sel); return opt.models.reduce((a, n) => a + (c[n] || 0), 0); }
      if (!opt.model) return totalModels(sel);
      return modelCounts(sel)[opt.model] || 0;
    }

    function optionMax(opt, sel) {
      let cap = eligible(opt, sel);
      const m = opt.max;
      if (m && m.fixed != null) cap = Math.min(cap, m.fixed);
      if (m && m.per) cap = Math.min(cap, Math.floor(totalModels(sel) / m.per) * (m.count || 1));
      if (m && m.perModelOf) cap = Math.min(cap, (modelCounts(sel)[m.perModelOf] || 0) * (m.count || 1));
      if (opt.kind === 'swapModel') {
        // other swaps drawing from the same source reduce what's left
        const u = unit(sel.unitId);
        const src = opt.model || u.models[0].name;
        let used = 0;
        for (const o of u.options) {
          if (o !== opt && o.kind === 'swapModel' && (o.model || u.models[0].name) === src) used += Number(sel.options[o.id]) || 0;
        }
        cap = Math.min(cap, (sel.counts[src] ?? 0) - used);
      }
      return Math.max(0, cap);
    }

    function perModelUsed(val) {
      if (!val || typeof val !== 'object') return 0;
      return Object.values(val).reduce((a, b) => a + (Number(b) || 0), 0);
    }

    // ---------- points ----------
    function optionCost(opt, sel) {
      const val = sel.options[opt.id];
      if (val == null || val === false || val === '') return 0;
      const choices = choicesFor(opt, sel);
      const price = (name) => (choices.find((c) => c.name === name) || { points: 0 }).points;
      switch (opt.kind) {
        case 'one': return price(val);
        case 'upgrade': return val ? (choices[0] ? choices[0].points : 0) : 0;
        case 'any': return (Array.isArray(val) ? val : []).reduce((s, n) => s + price(n), 0);
        case 'perModel': return Object.entries(val).reduce((s, [n, c]) => s + price(n) * (Number(c) || 0), 0);
        case 'swapModel': return (Number(val) || 0) * (choices[0] ? choices[0].points : 0);
        default: return 0;
      }
    }

    function unitPoints(sel) {
      const u = unit(sel.unitId);
      if (!u) return 0;
      let pts = Number(u.basePoints) || 0;
      for (const m of u.models) {
        const n = sel.counts[m.name] ?? m.min;
        if (n > m.min) pts += (n - m.min) * (Number(m.costPerExtra) || 0);
      }
      for (const o of optionsOf(sel)) pts += optionCost(o, sel);
      for (const p of u.pointsWhen || []) if (condOk(p.when, sel)) pts += p.delta;
      return pts;
    }

    // ---------- wargear after options ----------
    /** Returns [{model, count, wargear:[names]}] — a readable per-model loadout summary. */
    function loadout(sel) {
      const u = unit(sel.unitId);
      const counts = modelCounts(sel);
      const out = [];
      for (const m of u.models) {
        const n = counts[m.name] || 0;
        if (n <= 0) continue;
        out.push({ model: m.name, count: n, base: m.wargear || [], changes: [] });
      }
      const byModel = (name) => out.find((r) => r.model === name) || out[0];
      for (const o of optionsOf(sel)) {
        const val = sel.options[o.id];
        if (val == null || val === false || val === '' || val === 0) continue;
        const row = o.models ? (out.find((r) => o.models.includes(r.model)) || byModel(o.model)) : byModel(o.model);
        if (!row) continue;
        const rep = o.replaces && o.replaces.length ? o.replaces.join(' & ') : null;
        const push = (name, n) => row.changes.push({ name, count: n, replaces: rep });
        switch (o.kind) {
          case 'one': push(val, 1); break;
          case 'upgrade': push(choicesFor(o, sel)[0]?.name || o.text, 1); break;
          case 'any': for (const n of val) push(n, 1); break;
          case 'perModel': for (const [n, c] of Object.entries(val)) if (c > 0) push(n, c); break;
          default: break;
        }
      }
      return out;
    }

    // ---------- Prime Advantages ----------
    /** Advantages this unit may take: the codex's own plus any granted by characters in the army. */
    function primeAdvantagesFor(sel, army, slot) {
      const u = unit(sel.unitId);
      const inPrimary = slot && army && army.detachments.some((d) => d.kind === 'primary' && d.slots.includes(slot));
      const noCore = inPrimary && data.forceorg && data.forceorg.primary && data.forceorg.primary.onlyArmyAdvantages;
      const core = (noCore ? [] : (data.forceorg && data.forceorg.primeAdvantages) || [])
        .filter((a) => !a.roles || !slot || a.roles.includes(slot.role))
        .map((a) => ({ name: a.name, text: a.text, core: true }));
      const out = core.concat(((data.rules && data.rules.primeAdvantages) || []).map((a) => ({ name: a.name, text: a.text })));
      const present = new Set(allSelections(army).map((x) => x.sel.unitId));
      for (const g of data.grantedPrimeAdvantages || []) {
        if (g.grantedBy && !present.has(g.grantedBy)) continue;
        if ((g.ally || null) !== (u.ally || null)) continue;
        const e = g.eligible || {};
        if (e.choice && !e.choice.includes(arkanaOf(sel))) continue;
        if (e.units && !e.units.includes(u.id)) continue;
        if (e.roles && !e.roles.includes(u.role)) continue;
        if (e.trait && !unitHasTrait(u, e.trait)) continue;
        if (e.any && !((e.any.roles || []).includes(u.role) || (e.any.units || []).includes(u.id) || (e.any.categories || []).some((c) => (u.categories || []).includes(c)))) continue;
        if (e.excludeRoles && e.excludeRoles.includes(u.role)) continue;
        const side = army && army.config && (army.config.allegiance || [])[0];
        if (e.allegiance && side && e.allegiance !== side) continue;
        if (e.unitTypes && !u.models.some((m) => e.unitTypes.some((t) => (m.unitType || '').includes(t)))) continue;
        // "only for a unit with the Cybernetica trait": a category the unit has, or a trait/upgrade it took
        const took = (n) => (u.categories || []).includes(n) || (u.traits || []).includes(n) || Object.values(sel.options || {}).some((v) => v === n || (Array.isArray(v) && v.includes(n)));
        if (e.categories && !e.categories.every(took)) continue;
        if (e.items && !e.items.every(took)) continue;
        if (g.primaryOnly && slot && army && !army.detachments.some((d) => d.kind === 'primary' && d.slots.includes(slot))) continue;
        out.push({ name: g.name, text: g.text, grantedBy: g.grantedBy ? unit(g.grantedBy).name : e.allegiance ? `${e.allegiance} only` : (e.choice || []).join('/') });
      }
      return out;
    }

    // ---------- battlefield modifiers ----------
    const modifiers = (data.modifiers && data.modifiers.modifiers) || [];
    const saveNum = (v) => { const m = String(v ?? '').match(/(\d+)\+/); return m ? +m[1] : 99; };
    const ruleBase = (r) => norm(r);

    function applyStat(profile, key, op) {
      const cur = profile[key];
      const str = String(op);
      if (str.startsWith('best:')) {
        const v = str.slice(5);
        if (saveNum(v) < saveNum(cur)) { profile[key] = v; return true; }
        return false;
      }
      if (str.startsWith('=')) {
        const raw = str.slice(1);
        const v = /^-?\d+$/.test(raw) ? +raw : raw;
        if (cur === v) return false;
        if (/\+$/.test(raw) && cur != null && saveNum(raw) >= saveNum(cur) && /SAV|INV/.test(key)) return false;
        profile[key] = v;
        return true;
      }
      const n = Number(str);
      if (Number.isNaN(n) || cur == null) return false;
      const num = Number(cur);
      if (Number.isNaN(num)) return false;
      profile[key] = Math.max(0, num + n);
      return true;
    }

    function modMatches(m, u, model, traits) {
      const a = m.appliesTo || {};
      if (a.units && !a.units.includes(u.id)) return false;
      if (a.models && !a.models.includes(model.name)) return false;
      if (a.trait && !traits.some((t) => norm(t).includes(norm(a.trait)))) return false;
      if (a.unitType && !String(model.unitType || '').toLowerCase().includes(a.unitType.toLowerCase())) return false;
      return true;
    }

    /**
     * The unit as it plays on the table: one entry per group of identical models, with
     * characteristics, rules and traits after wargear, arkana, Prime Advantage and Sequelae.
     * Conditional effects are returned as reminders rather than applied.
     */
    function effectiveModels(sel, slot) {
      const u = unit(sel.unitId);
      const ark = arkanaOf(sel);
      const baseTraits = [...(u.traits || []), ...(ark ? [ark] : []), ...grantedTraits(sel, slot)];
      // split each loadout row into groups of models that carry the same items
      const groups = [];
      for (const row of loadout(sel)) {
        const model = u.models.find((m) => m.name === row.model);
        const fullChanges = row.changes.filter((c) => c.count >= row.count);
        const partial = row.changes.filter((c) => c.count < row.count);
        const replaced = new Set(fullChanges.filter((c) => c.replaces).flatMap((c) => c.replaces.split(' & ')));
        const items = row.base.filter((w) => !replaced.has(w)).concat(fullChanges.map((c) => c.name));
        let left = row.count;
        for (const p of partial) {
          const pr = new Set(p.replaces ? p.replaces.split(' & ') : []);
          groups.push({ model, count: p.count, label: `${row.model} with ${p.name}`, items: items.filter((w) => !pr.has(w)).concat(p.name) });
          left -= p.count;
        }
        if (left > 0 || !partial.length) groups.push({ model, count: Math.max(left, 0), label: row.model, items });
      }
      // "one model" bonuses (Master Sergeant, Paragon of Battle) split the first group
      const oneMods = modifiers.filter((m) => m.oneModel && m.source && m.source.type === 'primeAdvantage' && sel.primeAdvantage === m.source.name);
      if (oneMods.length && groups.length) {
        const g = groups.find((x) => x.count > 0) || groups[0];
        if (g.count > 1) {
          groups.splice(groups.indexOf(g), 1, Object.assign({}, g, { count: 1, label: `${g.label} (${oneMods[0].source.name})`, one: true }), Object.assign({}, g, { count: g.count - 1 }));
        } else g.one = true;
      }
      const unitItems = new Set(groups.flatMap((g) => g.items));
      const has = (m, items) => {
        const src = m.source || {};
        switch (src.type) {
          case 'sequela': return activeSeq.has(src.name);
          case 'arkana': return ark === src.name;
          // character-granted advantages are labelled "Name (Character)" in the picker
          case 'primeAdvantage': return sel.primeAdvantage === src.name;
          case 'unitRule': return (u.unitRules || []).some((r) => norm(r.name) === norm(src.name)) || [...(u.specialRules || []), ...u.models.flatMap((m) => m.specialRules || [])].some((r) => norm(r) === norm(src.name));
          case 'wargear': case 'upgrade': return items.has(src.name);
          case 'when': return condOk(src.when, sel);
          default: return false;
        }
      };
      const out = [];
      for (const g of groups.filter((x) => x.count > 0)) {
        const profile = Object.assign({}, g.model.profile);
        const changed = {};
        let rules = [...(u.specialRules || []), ...(g.model.specialRules || [])];
        const added = [], removed = [];
        const traits = baseTraits.slice();
        const addedTraits = [];
        let unitType = g.model.unitType || '';
        const reminders = [];
        const own = new Set(g.items);
        for (const m of modifiers) {
          if (m.oneModel && !g.one) continue;
          const present = m.scope === 'unit' ? has(m, unitItems) : has(m, own);
          if (!present || !modMatches(m, u, g.model, traits)) continue;
          if (m.condition) { reminders.push({ text: m.text, condition: m.condition, source: m.source }); continue; }
          for (const [k, op] of Object.entries(m.stats || {})) {
            if (!(k in profile) && !String(op).startsWith('best:') && !String(op).startsWith('=')) continue;
            if (applyStat(profile, k, op)) changed[k] = true;
          }
          for (const r of m.removeRules || []) {
            const before = rules.length;
            rules = rules.filter((x) => ruleBase(x) !== ruleBase(r));
            if (rules.length < before) removed.push(r);
          }
          for (const r of m.addRules || []) {
            const i = rules.findIndex((x) => ruleBase(x) === ruleBase(r));
            if (m.ifMissing && i >= 0) continue;
            if (i >= 0 && rules[i] === r) continue;
            if (i >= 0) rules[i] = r; else rules.push(r); // a new value replaces the old one, e.g. Ever-Living (2+)
            added.push(r);
          }
          for (const mr of m.modifyRules || []) {
            if (typeof mr.by !== 'number') { reminders.push({ text: m.text, condition: mr.note || 'see rule', source: m.source }); continue; }
            rules = rules.map((x) => {
              if (ruleBase(x) !== ruleBase(mr.rule)) return x;
              const nx = x.replace(/\((\d+)(\+?)\)/, (_, n, plus) => `(${plus ? Math.max(2, +n - mr.by) : +n + mr.by}${plus})`);
              if (nx !== x) added.push(nx);
              return nx;
            });
          }
          for (const t of m.addTraits || []) if (!traits.includes(t)) { traits.push(t); addedTraits.push(t); }
          if (m.setUnitType && !unitType.startsWith(m.setUnitType)) {
            unitType = unitType.replace(/^[A-Za-z]+/, m.setUnitType);
            changed.unitType = true;
          }
          for (const t of m.removeUnitTypes || []) {
            const m2 = unitType.match(/^([^(]+?)\s*\((.*)\)$/);
            if (!m2) continue;
            const subs = m2[2].split(',').map((x) => x.trim()).filter((x) => x && x !== t);
            const next = subs.length ? `${m2[1]} (${subs.join(', ')})` : m2[1];
            if (next !== unitType) { unitType = next; changed.unitType = true; }
          }
          for (const t of m.addUnitTypes || []) {
            if (unitType.includes(t)) continue;
            unitType = /\)$/.test(unitType) ? unitType.replace(/\)$/, `, ${t})`) : `${unitType} (${t})`;
            changed.unitType = true;
          }
        }
        out.push({ name: g.label, model: g.model.name, count: g.count, items: g.items, profile, baseProfile: g.model.profile, changed, rules, added, removed, traits, addedTraits, unitType, reminders });
      }
      return out;
    }

    // ---------- validation of a single unit ----------
    function unitIssues(sel) {
      const u = unit(sel.unitId);
      const issues = [];
      if (!u) return [{ level: 'error', msg: 'Unknown unit ' + sel.unitId }];
      if (u.cryptoArkana && !u.fixedArkana && !sel.arkana) issues.push({ level: 'error', msg: `${u.name}: choose a ${CHOICE.label}.` });
      for (const m of u.models) {
        const n = sel.counts[m.name];
        if (n == null) continue;
        if (n < m.min) issues.push({ level: 'error', msg: `${u.name}: at least ${m.min} ${m.name}.` });
        if (m.maxPer && m.maxPer.model && n > m.maxPer.count * (modelCounts(sel)[m.maxPer.model] || 0)) issues.push({ level: 'error', msg: `${u.name}: at most ${m.maxPer.count} ${m.name} per ${m.maxPer.model}.` });
        if (m.maxPer && m.maxPer.per && n > Math.floor(totalModels(sel) / m.maxPer.per) * m.maxPer.count) issues.push({ level: 'error', msg: `${u.name}: at most ${m.maxPer.count} ${m.name} for every ${m.maxPer.per} models.` });
        if (n > modelMax(u, m)) issues.push({ level: 'error', msg: `${u.name}: at most ${modelMax(u, m)} ${m.name}.` });
      }
      if (u.size) {
        const t = totalModels(sel);
        if (t < u.size.min || t > u.size.max) issues.push({ level: 'error', msg: `${u.name}: must have between ${u.size.min} and ${u.size.max} models (has ${t}).` });
      }
      const pools = {};
      for (const o of optionsOf(sel)) {
        const val = sel.options[o.id];
        if (o.effect && o.effect.requiresWargear && isTaken(val)) {
          const has = loadout(sel).some((r) => r.base.concat(r.changes.map((c) => c.name)).some((w) => o.effect.requiresWargear.includes(w)));
          if (!has) issues.push({ level: 'error', msg: `${u.name}: ${o.choices[0].name} needs a ${o.effect.requiresWargear.join(' or ')}.` });
        }
        if (o.required && !(o.required.or && isTaken(sel.options[o.required.or])) && !(o.requires && !requirementMet(o, sel))) {
          const counted = o.kind === 'perModel' || (o.kind === 'any' && o.required.count > 1);
          const need = o.kind === 'perModel' ? (o.required.count === 'all' ? eligible(o, sel) : (o.required.count || 1)) : counted ? o.required.count : 1;
          const have = o.kind === 'perModel' ? perModelUsed(val) : o.kind === 'any' ? (Array.isArray(val) ? val.length : 0) : (isTaken(val) ? 1 : 0);
          if (have < need) issues.push({ level: 'error', msg: `${u.name}: must take ${counted ? need + ' from ' : ''}"${short(o.text)}".` });
        }
        if (o.excludes && isTaken(val) && o.excludes.some((id) => isTaken(sel.options[id]))) {
          issues.push({ level: 'error', msg: `${u.name}: "${short(o.text)}" can't be combined with another option already taken.` });
        }
        if (o.requires && isTaken(val) && !requirementMet(o, sel)) {
          issues.push({ level: 'error', msg: `${u.name}: "${short(o.text)}" needs another option first.` });
        }
        if (o.kind === 'perModel') {
          const used = perModelUsed(val);
          const max = optionMax(o, sel);
          if (used > max) issues.push({ level: 'error', msg: `${u.name}: too many models took "${short(o.text)}" (${used}/${max}).` });
          if (o.max && o.max.shared) {
            pools[o.max.shared] = pools[o.max.shared] || { used: 0, cap: eligible(o, sel) };
            pools[o.max.shared].used += used;
          }
        }
        if (o.kind === 'any' && o.max && o.max.fixed != null && Array.isArray(val) && val.length > o.max.fixed) {
          issues.push({ level: 'error', msg: `${u.name}: at most ${o.max.fixed} from "${short(o.text)}".` });
        }
        if (o.kind === 'swapModel') {
          const n = Number(val) || 0;
          if (n > optionMax(o, sel)) issues.push({ level: 'error', msg: `${u.name}: too many models swapped for ${o.choices[0].name}.` });
        }
        if (o.kind === 'one' && val && !choicesFor(o, sel).some((c) => c.name === val)) {
          issues.push({ level: 'error', msg: `${u.name}: ${val} isn't available (check the ${CHOICE.label}).` });
        }
      }
      for (const [k, p] of Object.entries(pools)) {
        if (p.used > p.cap) issues.push({ level: 'error', msg: `${u.name}: more upgrades than models in "${k}" (${p.used}/${p.cap}).` });
      }
      return issues;
    }

    function requirementMet(o, sel) {
      const v = sel.options[o.requires];
      if (!o.requiresChoice) return isTaken(v);
      return Array.isArray(v) ? v.includes(o.requiresChoice) : v === o.requiresChoice || (v && typeof v === 'object' && v[o.requiresChoice] > 0);
    }

    function isTaken(v) {
      if (v == null || v === false || v === '' || v === 0) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return perModelUsed(v) > 0;
      return true;
    }

    function short(t) { return t && t.length > 60 ? t.slice(0, 57) + '…' : t; }

    // ---------- army ----------
    function allSelections(army) {
      const out = [];
      for (const d of army.detachments) for (const s of d.slots) if (s.unit) out.push({ det: d, slot: s, sel: s.unit });
      return out;
    }

    function armyPoints(army) {
      setArmy(army);
      return allSelections(army).reduce((a, x) => a + unitPoints(x.sel), 0);
    }

    function hasTrait(sel, trait, slot) {
      const u = unit(sel.unitId);
      if (!u) return false;
      if (unitHasTrait(u, trait)) return true;
      const ch = arkanaOf(sel);
      if (ch && ch.toLowerCase() === trait.replace(/[[\]]/g, '').toLowerCase()) return true;
      return grantedTraits(sel, slot).some((t) => t.toLowerCase() === trait.toLowerCase());
    }

    function sequelaAllowance(army) {
      const sels = allSelections(army);
      if (!sels.length) return 1;
      const noble = sels.some((x) => hasTrait(x.sel, 'Nemesor', x.slot) || hasTrait(x.sel, 'Phaeron', x.slot));
      return noble ? 2 : 1;
    }

    function armyIssues(army) {
      setArmy(army);
      const issues = [];
      const sels = allSelections(army);
      const total = armyPoints(army);
      const limit = Number(army.pointsLimit) || 0;
      if (limit && total > limit) issues.push({ level: 'error', msg: `Army is ${total - limit} points over the ${limit} point limit.` });

      // 25% cap on Warlord + Lord of War
      if (limit) {
        const capped = sels.filter((x) => ['Warlord', 'Lord of War'].includes(unit(x.sel.unitId)?.role)).reduce((a, x) => a + unitPoints(x.sel), 0);
        if (capped > limit * 0.25) issues.push({ level: 'error', msg: `Warlord and Lord of War units cost ${capped} points; the cap is 25% (${Math.floor(limit * 0.25)}).` });
      }

      // unique & 0-1
      const counts = {};
      for (const x of sels) counts[x.sel.unitId] = (counts[x.sel.unitId] || 0) + 1;
      for (const [id, n] of Object.entries(counts)) {
        const u = unit(id);
        if (!u) continue;
        if (u.unique && n > 1) issues.push({ level: 'error', msg: `${u.name} is a named character and can only be taken once.` });
        if (u.limit === '0-1' && n > 1) issues.push({ level: 'error', msg: `${u.name} is 0-1 per army.` });
      }

      // sequelae
      const allow = sequelaAllowance(army);
      const nSeq = (army.sequelae || []).length;
      if (nSeq > allow) {
        issues.push({ level: 'error', msg: `${nSeq} Aeonic Sequelae chosen; this army may take ${allow}${allow === 1 ? ' (a Nemesor or Phaeron unlocks a second)' : ''}.` });
      }

      // detachments
      const primary = army.detachments.find((d) => d.kind === 'primary');
      if (!primary) issues.push({ level: 'error', msg: 'The army needs a Primary Detachment.' });
      const ul = unlocks(army);
      if (ul.aux > ul.auxAllowed) {
        issues.push({ level: 'error', msg: `${ul.aux} Auxiliary Detachment${ul.aux === 1 ? '' : 's'}, but only ${ul.auxAllowed} unlocked (one per filled Command slot in the Crusade Primary Detachment${ul.scionApex ? ', less one used by Dynastic Scion for an Apex' : ''}).` });
      }
      if (ul.apex > ul.apexAllowed) {
        issues.push({ level: 'error', msg: ul.apexAllowed ? `${ul.apex} Apex Detachments, but only ${ul.apexAllowed} allowed.` : 'An Apex Detachment needs the Crusade Primary Detachment\'s High Command slot filled (or a Dynastic Scion in a Command slot).' });
      }
      for (const d of army.detachments.filter((x) => x.kind === 'custom' && x.slots.some((s) => s.unit))) {
        issues.push({ level: 'warn', msg: `${d.name} is a custom detachment, so the builder can't check that it's unlocked or legal.` });
      }
      if (CHOICE.sameInDetachment) {
        const exempt = CHOICE.sameInDetachment.exempt;
        for (const d of army.detachments.filter((x) => x.kind === 'auxiliary' || x.kind === 'apex')) {
          const picks = d.slots.filter((s) => s.unit && !(s.unit.primeAdvantage === 'Logistical Benefit')).map((s) => arkanaOf(s.unit)).filter(Boolean);
          const kinds = new Set(picks.filter((c) => c !== exempt));
          if (kinds.size > 1) issues.push({ level: 'error', msg: `${d.name}: every unit must share one ${CHOICE.label} (found ${[...kinds].join(', ')}).` });
          const nEx = picks.filter((c) => c === exempt).length;
          if (exempt && nEx && kinds.size && nEx >= picks.length - nEx) {
            issues.push({ level: 'warn', msg: `${d.name}: ${exempt} units must be fewer than the others unless the Primary Detachment has a ${exempt} High Command or Command unit.` });
          }
        }
      }
      const warlordDets = army.detachments.filter((d) => d.kind === 'warlord');
      if (warlordDets.length > 1) issues.push({ level: 'error', msg: 'Only one Warlord Detachment may be taken.' });
      if (warlordDets.length && (Number(army.pointsLimit) || 0) < 3000) issues.push({ level: 'error', msg: 'The Warlord Detachment needs an army of 3,000 points or more.' });
      if (army.detachments.filter((d) => d.kind === 'lord of war').length > 1) issues.push({ level: 'error', msg: 'Only one Lord of War Detachment may be taken.' });

      for (const d of army.detachments) {
        const def = d.defId ? detById.get(d.defId) : null;
        if (def && def.unlockedBy) {
          const ub = def.unlockedBy;
          if (ub.sequela && !(army.sequelae || []).includes(ub.sequela)) {
            issues.push({ level: 'error', msg: `${def.name} needs the ${ub.sequela} Aeonic Sequela.` });
          }
          if (ub.commandUnit) {
            const role = ub.slotRole || 'Command';
            const ok = army.detachments.some((od) => od !== d && od.slots.some((s) => s.unit && s.role === role && ub.commandUnit.includes(s.unit.unitId)));
            if (!ok) issues.push({ level: 'error', msg: `${def.name} needs a ${ub.commandUnit.map((id) => unit(id)?.name || id).join(' or ')} in a ${role} slot.` });
          }
          if (ub.commandTrait) {
            const ok = army.detachments.some((od) => od !== d && od.slots.some((s) => s.unit && ['Command', 'High Command'].includes(s.role) && hasTrait(s.unit, ub.commandTrait)));
            if (!ok) issues.push({ level: 'warn', msg: `${def.name} is unlocked by a ${ub.commandTrait} model filling a Command slot; none found.` });
          }
        }
        // slot role checks
        for (const s of d.slots) {
          if (!s.unit) continue;
          const u = unit(s.unit.unitId);
          if (!u) continue;
          const specialAssignment = s.role === 'Command' && s.prime && u.role === 'High Command';
          if (specialAssignment && s.unit.primeAdvantage !== 'Special Assignment') {
            issues.push({ level: 'error', msg: `${u.name} can only fill a Command slot with the Special Assignment Prime Advantage.` });
          } else if (!specialAssignment && !s.flexible && !rolesFor(u).includes(s.role)) {
            issues.push({ level: 'error', msg: `${u.name} (${u.role}) is in a ${s.role} slot.` });
          }
          if (s.unit.primeAdvantage === 'Special Assignment' && !(s.role === 'Command' && s.prime)) {
            issues.push({ level: 'error', msg: 'Special Assignment can only be chosen for a Prime Command slot.' });
          }
          if (s.logisticOf && !d.slots.some((o) => o.unit && o.unit.uid === s.logisticOf && o.unit.primeAdvantage === 'Logistical Benefit' && o.unit.logisticalRole === s.role)) {
            issues.push({ level: 'error', msg: `${u.name} is in an extra ${s.role} slot whose Logistical Benefit is gone.` });
          }
          if ((s.unit.primeAdvantage === 'Logistical Benefit' || (slotAdder(s.unit.primeAdvantage) || {}).chooseRole) && !s.unit.logisticalRole) {
            issues.push({ level: 'error', msg: `${u.name}: choose the Battlefield Role for Logistical Benefit.` });
          }
          if (!slotAllows(d, s, u, s.unit)) {
            issues.push({ level: 'error', msg: `${u.name} doesn't meet ${d.name}'s restrictions for its ${s.flexible ? 'flexible' : s.role} slot.` });
          }
          if (s.flexible && s.exclude && s.exclude.includes(u.role)) {
            issues.push({ level: 'error', msg: `${u.name} can't fill the flexible slot in ${d.name}.` });
          }
          if (s.advisor && !(u.cryptoArkana || u.fixedArkana)) {
            issues.push({ level: 'error', msg: `Dynastic Advisors slots take only [Crypto-Arkana] units; ${u.name} isn't one.` });
          }
          if (s.unit.primeAdvantage && !s.prime) {
            issues.push({ level: 'warn', msg: `${u.name} has a Prime Advantage but isn't in a Prime slot.` });
          }
          if (s.unit.primeAdvantage === 'Engrammatic Soldiers') {
            const bad = u.models.some((m) => !/^(Infantry|Cavalry)/i.test(m.unitType || ''));
            if (bad) issues.push({ level: 'error', msg: `Engrammatic Soldiers needs a unit of only Infantry/Cavalry; ${u.name} doesn't qualify.` });
          }
          if (s.unit.primeAdvantage === 'Dynastic Advisors' && !['Command', 'High Command'].includes(s.role)) {
            issues.push({ level: 'error', msg: 'Dynastic Advisors can only be chosen for a Command or High Command Prime slot.' });
          }
          const granted = (data.grantedPrimeAdvantages || []).find((g) => g.name === s.unit.primeAdvantage);
          if (granted && granted.oncePerArmy && sels.filter((x) => x.sel.primeAdvantage === granted.name).length > 1 && sels.find((x) => x.sel.primeAdvantage === granted.name).sel === s.unit) {
            issues.push({ level: 'error', msg: `${granted.name} can only be selected once per army.` });
          }
          if (s.extraOf && !d.slots.some((o) => o.unit && o.unit.uid === s.extraOf && slotAdder(o.unit.primeAdvantage))) {
            issues.push({ level: 'error', msg: `${u.name} is in a slot added by a Prime Advantage that's gone.` });
          }
          if (granted && granted.grantedBy && !sels.some((x) => x.sel.unitId === granted.grantedBy)) {
            issues.push({ level: 'error', msg: `${u.name}: ${granted.name} needs ${unit(granted.grantedBy).name} in the army.` });
          }
          // the codex's own Prime Advantages need its faction trait ("If a unit with the Necron Trait…")
          const factionTrait = data.meta && data.meta.id === 'necrons' ? 'Necron' : null;
          const codexAdv = ((data.rules && data.rules.primeAdvantages) || []).some((a) => a.name === s.unit.primeAdvantage);
          if (factionTrait && codexAdv && !hasTrait(s.unit, factionTrait)) {
            issues.push({ level: 'error', msg: `${u.name} lacks the Necron trait, so it can't take a Necron Prime Advantage.` });
          }
        }
        const advisors = d.slots.filter((s) => s.advisor && s.unit).map((s) => s.unit.unitId);
        const other = d.slots.filter((s) => !s.advisor && s.unit).map((s) => s.unit.unitId);
        if (advisors.some((id, i) => advisors.indexOf(id) !== i || other.includes(id))) {
          issues.push({ level: 'error', msg: `Dynastic Advisors in ${d.name} must each be a different unit entry from every other model in the Detachment.` });
        }
        if (d.slots.filter((s) => s.unit && s.unit.primeAdvantage === 'Dynastic Advisors').length > 1) {
          issues.push({ level: 'error', msg: `Dynastic Advisors can only be chosen once per Detachment (${d.name}).` });
        }
      }

      // Sequela limits: alternative roles, single-use upgrades, restricted unit lists
      for (const e of activeEffects('altRole')) {
        const n = sels.filter((x) => x.slot.role === e.role && unit(x.sel.unitId)?.role !== e.role && effectMatches(e, unit(x.sel.unitId))).length;
        if (e.armyMax != null && n > e.armyMax) issues.push({ level: 'error', msg: `${e.sequela}: only ${e.armyMax} unit may be taken as ${e.role} this way (${n}).` });
      }
      for (const e of activeEffects('option')) {
        if (e.armyMax == null) continue;
        const n = sels.filter((x) => isTaken(x.sel.options[e.option.id]) && optionsOf(x.sel).some((o) => o.id === e.option.id)).length;
        if (n > e.armyMax) issues.push({ level: 'error', msg: `${e.sequela}: only ${e.armyMax} unit may take ${e.option.choices[0].name} (${n}).` });
      }
      for (const e of activeEffects('allowedUnits')) {
        for (const x of sels) {
          const u = unit(x.sel.unitId);
          if (u && !e.units.includes(u.id)) issues.push({ level: 'error', msg: `${u.name} can't be taken with ${e.sequela}.` });
        }
      }
      const side = army.config && (army.config.allegiance || [])[0];
      if (side) for (const x of sels) {
        const u = unit(x.sel.unitId);
        if (u && u.allegiance && u.allegiance !== side) issues.push({ level: 'error', msg: `${u.name} is only available to ${u.allegiance} armies.` });
      }
      // detachments unlocked by an officer's special rule (Tip of the Spear → Planetfall Speartip)
      const unitHasRule = (u, r) => [...(u.specialRules || []), ...u.models.flatMap((m) => m.specialRules || [])].some((x) => norm(x) === norm(r));
      const seenOnce = {};
      for (const d of army.detachments) {
        const def = d.defId ? detById.get(d.defId) : null;
        const ul = def && def.unlockRule;
        if (!ul) continue;
        const where = ul.primary ? army.detachments.filter((x) => x.kind === 'primary') : army.detachments;
        // the rule can come from the unit, a trait, or an upgrade it took (Archimandrite)
        const selHas = (sel) => { const u = unit(sel.unitId); if (!u) return false; if (unitHasRule(u, ul.rule) || (u.traits || []).some((t) => norm(t) === norm(ul.rule))) return true;
          return Object.values(sel.options || {}).some((v) => JSON.stringify(v).toLowerCase().includes(`"${ul.rule.toLowerCase()}"`)); };
        const ok = where.some((x) => x.slots.some((s) => s.unit && (!ul.role || s.role === ul.role) && selHas(s.unit)));
        if (!ok) issues.push({ level: 'error', msg: `${d.name} needs ${ul.role ? `a ${ul.role} model` : 'a model'} with ${ul.rule} in the ${ul.primary ? 'Primary Detachment' : 'army'}.` });
        seenOnce[def.id] = (seenOnce[def.id] || 0) + 1;
        if (ul.once && seenOnce[def.id] === 2) issues.push({ level: 'error', msg: `${d.name} can only be taken once per army.` });
      }
      // Legion detachments that need a particular officer ("Requires a Master of Descent")
      for (const d of army.detachments) {
        const def = d.defId ? detById.get(d.defId) : null;
        for (const need of (def && def.requires) || []) {
          const key = need.toLowerCase();
          // "Iron Pattern Cohort Doctrine" is met by "Cohort Doctrine: Iron Pattern Cohort"
          const words = key.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
          const picked = Object.values(army.config || {}).flat().some((n) => { const t = String(n).toLowerCase(); return words.every((w) => t.includes(w)); });
          const has = picked || sels.some((x) => {
            const u = unit(x.sel.unitId);
            if (!u) return false;
            if (u.name.toLowerCase().includes(key)) return true;
            if (Object.values(x.sel.options || {}).some((v) => JSON.stringify(v).toLowerCase().includes(key))) return true;
            return loadout(x.sel).some((r) => r.base.concat(r.changes.map((c) => c.name)).some((w) => w.toLowerCase().includes(key)));
          });
          if (!has) issues.push({ level: 'warn', msg: `${d.name} requires ${/^[aeiou]/i.test(need) ? 'an' : 'a'} ${need} in the army; none found.` });
        }
      }
      // units and detachments that depend on something else in the army
      for (const x of sels) {
        const u = unit(x.sel.unitId);
        if (!u || !(u.when || u.unless) || available(u, x.sel)) continue;
        const bad = (u.unless || []).find((c) => condOk(c, x.sel));
        issues.push({ level: 'error', msg: bad ? `${u.name} can't be taken with ${condText(bad)}.` : `${u.name} needs ${u.when.map(condText).join(' or ')}.` });
      }
      for (const d of army.detachments) {
        const def = d.defId ? detById.get(d.defId) : null;
        if (def && def.when && !def.when.some((c) => condOk(c))) issues.push({ level: 'error', msg: `${d.name} needs ${def.when.map(condText).join(' or ')} in the army.` });
      }
      // "Additional" detachments (Questoris Familia): one per Household Rank advantage or paradigm that allows it
      const addCount = {};
      for (const d of army.detachments) if (d.defId && detById.get(d.defId) && detById.get(d.defId).allowedBy) addCount[d.defId] = (addCount[d.defId] || 0) + 1;
      for (const [id, n] of Object.entries(addCount)) {
        const def = detById.get(id);
        let allowed = 0;
        for (const a of def.allowedBy) {
          if (a.config) allowed += ctx.config.has(a.config) ? 1 : 0;
          if (a.each) allowed += sels.filter((x) => x.sel.primeAdvantage === a.each || unit(x.sel.unitId)?.name === a.each || Object.values(x.sel.options || {}).some((v) => v === a.each || (Array.isArray(v) && v.includes(a.each)))).length;
        }
        if (n > allowed) issues.push({ level: 'error', msg: `${def.name}: ${n} taken, ${allowed} allowed (one per ${def.allowedBy.map((a) => a.config || a.each).join(' / ')}).` });
      }
      // allies: an Allied Detachment per allied army; its Auxiliary Detachments come from its own Command slots
      const allyIds = [...new Set(army.detachments.filter((d) => d.ally).map((d) => d.ally))];
      for (const id of allyIds) {
        const mine = army.detachments.filter((d) => d.ally === id);
        const name = ((data.allies || []).find((a) => a.id === id) || {}).name || id;
        if (!(data.allies || []).some((a) => a.id === id)) { issues.push({ level: 'warn', msg: `The ${name} allies haven't loaded; reload the page.` }); continue; }
        const allied = mine.filter((d) => d.kind === 'allied');
        const lordOfWar = mine.filter((d) => d.kind === 'lord of war');
        if (!allied.length && !lordOfWar.length) issues.push({ level: 'error', msg: `${name} detachments need an Allied Detachment.` });
        if (allied.length > 1) issues.push({ level: 'error', msg: `Only one Allied Detachment from ${name}.` });
        const cmd = allied.reduce((n, d) => n + d.slots.filter((s) => s.role === 'Command' && s.unit).length, 0);
        const aux = mine.filter((d) => d.kind === 'auxiliary').length;
        if (aux > cmd) issues.push({ level: 'error', msg: `${aux} allied ${name} Auxiliary Detachment${aux === 1 ? '' : 's'}, but only ${cmd} unlocked (one per filled Command slot in its Allied Detachment).` });
        if (mine.some((d) => d.kind === 'apex')) issues.push({ level: 'error', msg: `Allies can't take Apex Detachments (${name}).` });
      }
      // army configuration: Rites of War, Cohort Doctrines, Provenances of War…
      for (const g of (data.armyConfig && data.armyConfig.groups) || []) {
        if (g.when && !available(g)) continue;
        const picked = (army.config || {})[g.id] || [];
        for (const c of g.choices) {
          if (!picked.includes(c.name) || !c.unless) continue;
          const bad = c.unless.find((k) => condOk(k));
          if (bad) issues.push({ level: 'error', msg: `Army configuration: ${c.name} can't be combined with ${condText(bad)}.` });
        }
        const n = picked.length;
        // a limit raised by something in the army (a Force Commander allows a second Provenance)
        const max = configMax(g);
        if (max === 0 && n === 0) continue;
        if (n < g.min) issues.push({ level: 'error', msg: `Army configuration: choose ${g.min === g.max ? g.min : 'at least ' + g.min} from ${g.name}${n ? ` (${n} chosen)` : ''}.` });
        if (n > max) issues.push({ level: 'error', msg: `Army configuration: at most ${max} from ${g.name} (${n} chosen)${(g.maxWhen || []).length && max === g.max ? `; ${g.maxWhen.map((x) => `${x.max} with ${condText(x.when)}`).join(', ')}` : ''}.` });
      }
      // upgrades limited to one per army ("Master of Descent", relic weapons)
      const onceTaken = {};
      for (const x of sels) for (const o of optionsOf(x.sel)) {
        const v = x.sel.options[o.id];
        if (!isTaken(v)) continue;
        const names = o.kind === 'upgrade' ? [o.choices[0].name] : Array.isArray(v) ? v : typeof v === 'object' ? Object.keys(v).filter((k) => v[k] > 0) : [v];
        for (const n of names) {
          const c = o.choices.find((ch) => ch.name === n);
          if (c && c.oncePerArmy) onceTaken[n] = (onceTaken[n] || 0) + (typeof v === 'object' && !Array.isArray(v) ? v[n] : 1);
        }
      }
      for (const [n, c] of Object.entries(onceTaken)) if (c > 1) issues.push({ level: 'error', msg: `${n} may only be taken once per army (${c} taken).` });
      // wargear list items limited to one per army (e.g. Haemonculus Arcana)
      const once = new Set((data.lists || []).flatMap((l) => l.items.filter((it) => it.oncePerArmy).map((it) => it.name)));
      if (once.size) {
        const taken = {};
        for (const x of sels) for (const r of loadout(x.sel)) for (const c of r.changes) if (once.has(c.name)) taken[c.name] = (taken[c.name] || 0) + c.count;
        for (const [n, c] of Object.entries(taken)) if (c > 1) issues.push({ level: 'error', msg: `${n} may only be taken once per army (${c} taken).` });
      }

      for (const x of sels) for (const i of unitIssues(x.sel)) issues.push(i);
      return issues;
    }

    /** How many Auxiliary/Apex Detachments the Crusade Primary Detachment unlocks. */
    function unlocks(army) {
      const primary = army.detachments.find((d) => d.kind === 'primary');
      const filled = (role) => (primary ? primary.slots.filter((s) => s.role === role && s.unit && !s.logisticOf).length : 0);
      const command = filled('Command');
      const hc = filled('High Command');
      const scions = primary ? primary.slots.filter((s) => s.role === 'Command' && s.unit && scionTaken(s.unit)).length : 0;
      const aux = army.detachments.filter((d) => d.kind === 'auxiliary' && !d.ally).length;
      const apex = army.detachments.filter((d) => d.kind === 'apex' && !d.ally).length;
      const hcApex = hc > 0 ? 1 : 0;
      // Dynastic Scion: one Apex may be taken instead of the Auxiliary a Command slot grants
      const scionApex = Math.min(scions > 0 ? 1 : 0, Math.max(0, apex - hcApex));
      return { aux, apex, command, hc, auxAllowed: command - scionApex, apexAllowed: hcApex + (scions > 0 ? 1 : 0), scionApex };
    }

    function scionTaken(sel) {
      const u = unit(sel.unitId);
      return optionsOf(sel).some((o) => o.kind === 'upgrade' && /Dynastic Scion/i.test(o.text) && sel.options[o.id]);
    }

    // ---------- detachments ----------
    function makeDetachment(kind, name, slotDefs, extra) {
      return Object.assign({
        uid: uid('d'), kind, name,
        slots: slotDefs.map((s) => Object.assign({ uid: uid('s'), role: s.role, prime: !!s.prime, flexible: !!s.flexible, exclude: s.exclude || null, advisor: !!s.advisor, unit: null },
          s.only ? { only: s.only, onlyLabel: s.onlyLabel || null } : {})),
      }, extra || {});
    }

    function detachmentFromDef(defId, extra) {
      const def = detById.get(defId);
      if (!def) throw new Error('Unknown detachment ' + defId);
      const kind = (def.type || 'Auxiliary').toLowerCase();
      const flexExclude = ['Command', 'High Command'];
      const slots = def.slots.map((s) => ({ role: s.role, prime: s.prime, flexible: s.flexible, exclude: s.flexible ? flexExclude : null, only: s.only, onlyLabel: s.onlyLabel }));
      const ally = def.allyOf || (extra && extra.ally) || null;
      const allyName = ally && (data.allies || []).find((a) => a.id === ally);
      return makeDetachment(kind, ally && allyName ? `${def.name} (${allyName.name})` : def.name, slots, Object.assign({ defId }, ally ? { ally } : {}, extra || {}));
    }

    /** Detachment restrictions ("Only Units with the Canoptek Trait…") for one slot. */
    function slotAllows(det, slot, u, sel) {
      // an allied army's units go only in its allied detachments, and those take nothing else
      if ((u.ally || null) !== ((det && det.ally) || null)) return false;
      if (slot && slot.only && !slot.only.includes(u.id)) return false;
      // Assassins and other operatives only fill the slots their Prime Advantage adds
      if (slot && (u.operative || slot.operative) && u.operative !== slot.operative) return false;
      const def = det && det.defId ? detById.get(det.defId) : null;
      if (!def || !def.slotRules) return true;
      const role = slot.flexible ? u.role : slot.role;
      return def.slotRules.every((r) => {
        if (r.roles && !r.roles.includes(role)) return true;
        if (r.units && !r.units.includes(u.id)) return false;
        if (r.trait && !unitHasTrait(u, r.trait)) {
          // a trait the unit picks (Partisan, Great Clan): allowed if it could pick it, checked once picked
          const t = r.trait.replace(/[[\]]/g, '');
          if (!CHOICE.options.includes(t)) return false;
          if (u.fixedArkana) return u.fixedArkana === t;
          if (!u.cryptoArkana) return false;
          if (sel && sel.arkana && sel.arkana !== t) return false;
        }
        return true;
      });
    }

    /** Which units can go in a slot: role match plus the detachment's restrictions. */
    function unitsForSlot(slot, det) {
      return data.units.filter((u) => {
        if (!slotAllows(det, slot, u)) return false;
        if ((u.when || u.unless) && !available(u, null, det && baseName(det))) return false;
        if (slot.advisor) return u.cryptoArkana || !!u.fixedArkana;
        if (slot.flexible) return !(slot.exclude || []).includes(u.role);
        if (slot.role === 'Command' && slot.prime && u.role === 'High Command') return true; // Special Assignment
        return rolesFor(u).includes(slot.role);
      });
    }

    /** A Prime Advantage that adds slots (Clade Operative, Rewards of Treachery, Logisticae). */
    function slotAdder(name) {
      const g = name && (data.grantedPrimeAdvantages || []).find((x) => x.name === name && x.addSlots);
      return g ? g.addSlots : null;
    }

    /** Dynastic Advisors adds two Command slots to the detachment. Keeps slots in sync. */
    function syncAdvisorSlots(det) {
      const has = det.slots.some((s) => s.unit && s.unit.primeAdvantage === 'Dynastic Advisors');
      const adv = det.slots.filter((s) => s.advisor);
      if (has && adv.length === 0) {
        const roles = det.slots.map((s) => s.role);
        const idx = Math.max(roles.lastIndexOf('Command'), roles.lastIndexOf('High Command'));
        const add = [0, 1].map(() => ({ uid: uid('s'), role: 'Command', prime: false, flexible: false, exclude: null, advisor: true, unit: null }));
        det.slots.splice(idx + 1, 0, ...add);
      } else if (!has && adv.length) {
        det.slots = det.slots.filter((s) => !s.advisor);
      }
      // Logistical Benefit: one extra slot of the chosen role per unit that took it
      const owners = new Map(det.slots.filter((s) => s.unit && s.unit.primeAdvantage === 'Logistical Benefit' && s.unit.logisticalRole).map((s) => [s.unit.uid, s.unit.logisticalRole]));
      // an orphaned extra slot keeps its unit (flagged in the checks) rather than deleting it
      det.slots = det.slots.filter((s) => !s.logisticOf || owners.get(s.logisticOf) === s.role || s.unit);
      for (const [owner, role] of owners) {
        if (det.slots.some((s) => s.logisticOf === owner)) continue;
        det.slots.push({ uid: uid('s'), role, prime: false, flexible: false, exclude: null, advisor: false, logisticOf: owner, unit: null });
      }
      // Prime Advantages that add slots (Clade Operative: three Support slots for Assassins)
      const adders = new Map();
      for (const s of det.slots) {
        const add = s.unit && slotAdder(s.unit.primeAdvantage);
        if (!add) continue;
        // Rewards of Treachery, Logisticae: the player picks the extra slot's role
        const role = add.chooseRole ? s.unit.logisticalRole : add.role;
        if (role) adders.set(s.unit.uid, Object.assign({}, add, { role }));
      }
      det.slots = det.slots.filter((s) => !s.extraOf || (adders.has(s.extraOf) && adders.get(s.extraOf).role === s.role) || s.unit);
      for (const [owner, add] of adders) {
        if (det.slots.some((s) => s.extraOf === owner)) continue;
        for (let i = 0; i < add.count; i++) det.slots.push({ uid: uid('s'), role: add.role, prime: false, flexible: false, exclude: null, advisor: false, extraOf: owner, operative: add.operative || null, onlyLabel: add.operative ? `${add.operative} only` : null, unit: null });
      }
    }

    return {
      data, ROLES, ARKANA: CHOICE.options, choiceLabel: CHOICE.label, unit, choicesFor, sizableModels, swapTargets, newSelection, modelCounts, totalModels,
      eligible, optionMax, perModelUsed, optionCost, unitPoints, loadout, unitIssues, armyIssues, armyPoints,
      allSelections, sequelaAllowance, configMax, setArmy, slotAdder, available, condOk, condText, makeDetachment, detachmentFromDef, unitsForSlot, slotAllows, syncAdvisorSlots,
      hasTrait, arkanaOf, uid, setSequelae, effectiveModels, primeAdvantagesFor, requirementMet, unlocks, optionsOf, modelMax, rolesFor, activeEffects, grantedTraits,
    };
  }

    /** An allied army's units, advantages, effects and detachments, under "<army>:" ids and marked with the ally. */
  function mergeAlly(D, A, id) {
    const pre = (x) => `${id}:${x}`;
    const cond = (c) => (c && c.unit ? Object.assign({}, c, { unit: pre(c.unit) }) : c && c.all ? { all: c.all.map(cond) } : c);
    const conds = (list) => list && list.map(cond);
    for (const u of A.units) {
      D.units.push(Object.assign({}, u, {
        id: pre(u.id), ally: id, allyName: A.meta.name, when: conds(u.when), unless: conds(u.unless),
        pointsWhen: u.pointsWhen && u.pointsWhen.map((p) => Object.assign({}, p, { when: cond(p.when) })),
        options: (u.options || []).map((o) => Object.assign({}, o, { when: conds(o.when), unless: conds(o.unless) })),
      }));
    }
    for (const g of A.grantedPrimeAdvantages || []) {
      const e = g.eligible || {};
      D.grantedPrimeAdvantages = (D.grantedPrimeAdvantages || []).filter((x) => !(x.name === g.name && x.ally === id));
      D.grantedPrimeAdvantages.push(Object.assign({}, g, { ally: id, eligible: Object.assign({}, e, e.any ? { any: Object.assign({}, e.any, { units: (e.any.units || []).map(pre) }) } : {}, e.units ? { units: e.units.map(pre) } : {}) }));
    }
    const mods = (A.modifiers && A.modifiers.modifiers) || [];
    D.modifiers = D.modifiers || { modifiers: [] };
    for (const m of mods) D.modifiers.modifiers.push(Object.assign({}, m, { id: pre(m.id), appliesTo: Object.assign({}, m.appliesTo, m.appliesTo && m.appliesTo.units ? { units: m.appliesTo.units.map(pre) } : {}),
      source: m.source && m.source.type === 'when' ? Object.assign({}, m.source, { when: cond(m.source.when) }) : m.source }));
    // its own detachments (and the allied ones) can join the list as allies
    for (const d of A.detachments || []) {
      if (d.source !== 'army' && !d.allyOnly) continue;
      D.detachments.push(Object.assign({}, d, { id: pre(d.id), allyOf: id, slots: d.slots.map((s) => Object.assign({}, s, s.only ? { only: s.only.map(pre) } : {})) }));
    }
    D.allies = (D.allies || []).concat({ id, name: A.meta.name });
  }

  const api = { createEngine, mergeAlly, ROLES, ARKANA, norm, wkey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NecronEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
