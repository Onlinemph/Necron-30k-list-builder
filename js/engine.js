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
  const wkey = (n) => norm(n)
    .replace(/^\d+\s*x?\s+/, '')
    .replace(/^(hull|centreline|centerline|sponson|pintle|turret|rear|front|side)\s*-?\s*mounted\s+/, '')
    .replace(/^(a |an |two |three |pair of |paired )/, '')
    .replace(/s$/, '');

  let uidCounter = 0;
  function uid(prefix) {
    uidCounter += 1;
    return (prefix || 'x') + Date.now().toString(36) + uidCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function createEngine(data) {
    const unitsById = new Map(data.units.map((u) => [u.id, u]));
    const listsById = new Map((data.lists || []).map((l) => [l.id, l]));
    const detById = new Map((data.detachments || []).map((d) => [d.id, d]));

    function unit(id) { return unitsById.get(id); }

    // ---------- Aeonic Sequelae effects ----------
    const effects = (data.sequelaEffects && data.sequelaEffects.effects) || [];
    let activeSeq = new Set();
    function setSequelae(list) { activeSeq = new Set(list || []); }
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
      return (u.options || []).concat(extra);
    }
    function modelMax(u, m) {
      let max = m.max ?? m.min;
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
        const items = c.list ? resolveList(c.list, sel) : [{ name: c.name, points: Number(c.points) || 0 }];
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
      return u.models.filter((m) => !targets.has(m.name) && (m.max || m.min) > m.min);
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
      if (!opt.model) return totalModels(sel);
      return modelCounts(sel)[opt.model] || 0;
    }

    function optionMax(opt, sel) {
      let cap = eligible(opt, sel);
      const m = opt.max;
      if (m && m.fixed != null) cap = Math.min(cap, m.fixed);
      if (m && m.per) cap = Math.min(cap, Math.floor(totalModels(sel) / m.per) * (m.count || 1));
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
        const row = byModel(o.model);
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

    // ---------- validation of a single unit ----------
    function unitIssues(sel) {
      const u = unit(sel.unitId);
      const issues = [];
      if (!u) return [{ level: 'error', msg: 'Unknown unit ' + sel.unitId }];
      if (u.cryptoArkana && !u.fixedArkana && !sel.arkana) issues.push({ level: 'error', msg: u.name + ': choose a Crypto-Arkana.' });
      for (const m of u.models) {
        const n = sel.counts[m.name];
        if (n == null) continue;
        if (n < m.min) issues.push({ level: 'error', msg: `${u.name}: at least ${m.min} ${m.name}.` });
        if (n > modelMax(u, m)) issues.push({ level: 'error', msg: `${u.name}: at most ${modelMax(u, m)} ${m.name}.` });
      }
      const pools = {};
      for (const o of optionsOf(sel)) {
        const val = sel.options[o.id];
        if (o.effect && o.effect.requiresWargear && isTaken(val)) {
          const has = loadout(sel).some((r) => r.base.concat(r.changes.map((c) => c.name)).some((w) => o.effect.requiresWargear.includes(w)));
          if (!has) issues.push({ level: 'error', msg: `${u.name}: ${o.choices[0].name} needs a ${o.effect.requiresWargear.join(' or ')}.` });
        }
        if (o.requires && val && !isTaken(sel.options[o.requires])) {
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
        if (o.kind === 'swapModel') {
          const n = Number(val) || 0;
          if (n > optionMax(o, sel)) issues.push({ level: 'error', msg: `${u.name}: too many models swapped for ${o.choices[0].name}.` });
        }
        if (o.kind === 'one' && val && !choicesFor(o, sel).some((c) => c.name === val)) {
          issues.push({ level: 'error', msg: `${u.name}: ${val} isn't available (check the Crypto-Arkana).` });
        }
      }
      for (const [k, p] of Object.entries(pools)) {
        if (p.used > p.cap) issues.push({ level: 'error', msg: `${u.name}: more upgrades than models in "${k}" (${p.used}/${p.cap}).` });
      }
      return issues;
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
      setSequelae(army.sequelae);
      return allSelections(army).reduce((a, x) => a + unitPoints(x.sel), 0);
    }

    function hasTrait(sel, trait, slot) {
      const u = unit(sel.unitId);
      if (!u) return false;
      if (unitHasTrait(u, trait)) return true;
      return grantedTraits(sel, slot).some((t) => t.toLowerCase() === trait.toLowerCase());
    }

    function sequelaAllowance(army) {
      const sels = allSelections(army);
      if (!sels.length) return 1;
      const noble = sels.some((x) => hasTrait(x.sel, 'Nemesor', x.slot) || hasTrait(x.sel, 'Phaeron', x.slot));
      return noble ? 2 : 1;
    }

    function armyIssues(army) {
      setSequelae(army.sequelae);
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
      const commandFilled = primary ? primary.slots.filter((s) => s.role === 'Command' && s.unit).length : 0;
      const aux = army.detachments.filter((d) => d.kind === 'auxiliary');
      const apex = army.detachments.filter((d) => d.kind === 'apex');
      const scions = sels.filter((x) => x.slot.role === 'Command' && scionTaken(x.sel)).length;
      if (aux.length + apex.length > commandFilled + (primary ? primary.slots.filter((s) => s.role === 'High Command' && s.unit).length : 0)) {
        issues.push({ level: 'warn', msg: `${aux.length + apex.length} Auxiliary/Apex Detachments but only ${commandFilled} filled Command slot(s) in the Primary Detachment to unlock them.` });
      }
      if (scions > 0 && apex.filter((d) => d.viaScion).length > 1) {
        issues.push({ level: 'error', msg: 'Only one Apex Detachment may be added with Dynastic Scion.' });
      }

      for (const d of army.detachments) {
        const def = d.defId ? detById.get(d.defId) : null;
        if (def && def.unlockedBy) {
          const ub = def.unlockedBy;
          if (ub.sequela && !(army.sequelae || []).includes(ub.sequela)) {
            issues.push({ level: 'error', msg: `${def.name} needs the ${ub.sequela} Aeonic Sequela.` });
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
          if (!s.flexible && !rolesFor(u).includes(s.role)) {
            issues.push({ level: 'error', msg: `${u.name} (${u.role}) is in a ${s.role} slot.` });
          }
          if (!slotAllows(d, s, u)) {
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
          if (s.unit.primeAdvantage && !hasTrait(s.unit, 'Necron')) {
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
      for (const x of sels) for (const i of unitIssues(x.sel)) issues.push(i);
      return issues;
    }

    function scionTaken(sel) {
      const u = unit(sel.unitId);
      return optionsOf(sel).some((o) => o.kind === 'upgrade' && /Dynastic Scion/i.test(o.text) && sel.options[o.id]);
    }

    // ---------- detachments ----------
    function makeDetachment(kind, name, slotDefs, extra) {
      return Object.assign({
        uid: uid('d'), kind, name,
        slots: slotDefs.map((s) => ({ uid: uid('s'), role: s.role, prime: !!s.prime, flexible: !!s.flexible, exclude: s.exclude || null, advisor: !!s.advisor, unit: null })),
      }, extra || {});
    }

    function detachmentFromDef(defId, extra) {
      const def = detById.get(defId);
      if (!def) throw new Error('Unknown detachment ' + defId);
      const kind = (def.type || 'Auxiliary').toLowerCase();
      const flexExclude = ['Command', 'High Command'];
      const slots = def.slots.map((s) => ({ role: s.role, prime: s.prime, flexible: s.flexible, exclude: s.flexible ? flexExclude : null }));
      return makeDetachment(kind, def.name, slots, Object.assign({ defId }, extra || {}));
    }

    /** Detachment restrictions ("Only Units with the Canoptek Trait…") for one slot. */
    function slotAllows(det, slot, u) {
      const def = det && det.defId ? detById.get(det.defId) : null;
      if (!def || !def.slotRules) return true;
      const role = slot.flexible ? u.role : slot.role;
      return def.slotRules.every((r) => {
        if (r.roles && !r.roles.includes(role)) return true;
        if (r.units && !r.units.includes(u.id)) return false;
        if (r.trait && !unitHasTrait(u, r.trait)) return false;
        return true;
      });
    }

    /** Which units can go in a slot: role match plus the detachment's restrictions. */
    function unitsForSlot(slot, det) {
      return data.units.filter((u) => {
        if (!slotAllows(det, slot, u)) return false;
        if (slot.advisor) return u.cryptoArkana || !!u.fixedArkana;
        if (slot.flexible) return !(slot.exclude || []).includes(u.role);
        return rolesFor(u).includes(slot.role);
      });
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
    }

    return {
      data, ROLES, ARKANA, unit, choicesFor, sizableModels, swapTargets, newSelection, modelCounts, totalModels,
      eligible, optionMax, perModelUsed, optionCost, unitPoints, loadout, unitIssues, armyIssues, armyPoints,
      allSelections, sequelaAllowance, makeDetachment, detachmentFromDef, unitsForSlot, slotAllows, syncAdvisorSlots,
      hasTrait, arkanaOf, uid, setSequelae, optionsOf, modelMax, rolesFor, activeEffects, grantedTraits,
    };
  }

  const api = { createEngine, ROLES, ARKANA, norm, wkey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NecronEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
