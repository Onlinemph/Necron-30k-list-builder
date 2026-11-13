'use strict';
// Choosing what to shoot with. HH3: a model attacks with one Ranged Weapon in a Shooting Attack, two if both have
// the Pistol rule, or as many as its Firing Protocols (X) allow. Weapons are picked for expected value.
const { num, xOf, has } = require('./rules.cjs');
const { rangedGroup, expectedGroup } = require('./attack.cjs');
const { gap, lineOfSight, inCover } = require('./table.cjs');
const core = require('./core.cjs');
const legions = require('./legions.cjs');

const rangeOf = (w, m) => {
  if (has(w.specialRules, 'Template') || String(w.R).toLowerCase() === 'template') return core.TEMPLATE_RANGE;
  // Burning Sky war-moon: Rangda weapons reach 6" further (Unlimited and Template ranges unchanged)
  const bonus = m && m.traits && m.traits.includes('Burning Sky') && m.traits.includes('Rangda') ? 6 : 0;
  return num(w.R, 0) + bonus;
};

/** How many weapons a model may fire in one Shooting Attack. */
function fireLimit(model) {
  const fp = xOf(model.rules, 'Firing Protocols');
  if (fp) return fp;
  return core.weaponsPerModel(model);
}

/** Value of a point of damage on a unit: its points spread over its wounds, so killing elite models is worth more. */
const valuePerWound = (u) => {
  const total = u.models.reduce((t, m) => t + m.maxWounds, 0);
  return total ? u.pts / total : 0;
};

/**
 * The best weapons for each model in `shooter` against `target`, with the expected damage and points removed.
 * opts: { stationary, snap, bsMod, coverSave, losOK }
 */
function planVolley(shooter, target, state, opts = {}) {
  // Lies and Obfuscation (Alpha Legion): they count as 2" further away
  const d = gap(shooter, target) + legions.rangePenalty(target);
  const los = opts.losOK ?? lineOfSight(state.table, shooter, target);
  // Ferrum Occularis (Iron Havocs): no Cover Saves against them after they stayed Stationary (CONFIRMED)
  const ferrum = has(shooter.rules, 'Ferrum Occularis') && shooter.turn?.stationary;
  const coverSave = opts.coverSave !== undefined ? opts.coverSave : (!opts.ignoreCover && !ferrum ? core.coverSave(target, inCover(state.table, shooter, target)) : null);
  // Fatal Strike (Mor Deythan): +2 Ballistic Skill for the phase it's used in
  if (shooter.turn?.fatalStrike) opts = Object.assign({}, opts, { bsMod: (opts.bsMod || 0) + 2 });
  const picks = [];
  let exp = 0;
  for (const m of shooter.models) {
    if (m.wounds <= 0 || !m.ranged.length) continue;
    const usable = m.ranged.filter((w) => {
      if (d > rangeOf(w, m)) return false;
      if (!los && !has(w.specialRules, 'Barrage')) return false;
      if (has(w.specialRules, 'Limited') && (shooter.limitedUsed?.[w.name] || 0) >= xOf(w.specialRules, 'Limited')) return false;
      if (opts.exclude && opts.exclude(w)) return false;
      return true;
    });
    if (!usable.length) continue;
    // modes of one weapon are alternatives: keep each weapon's best mode
    const byBase = new Map();
    for (const w of usable) {
      const g = rangedGroup(m, w, target, opts);
      const e = expectedGroup(g, target, { coverSave });
      const cur = byBase.get(w.base || w.name);
      if (!cur || e > cur.e) byBase.set(w.base || w.name, { w, e });
    }
    let options = [...byBase.values()].sort((a, b) => b.e - a.e);
    let limit = fireLimit(m);
    // two Pistols may be fired together
    const pistols = options.filter((o) => has(o.w.specialRules, 'Pistol'));
    if (limit === 1 && pistols.length >= 2 && pistols[0].e + pistols[1].e > options[0].e) options = pistols, limit = 2;
    for (const o of options.slice(0, limit)) {
      picks.push({ model: m, weapon: o.w, e: o.e });
      exp += o.e;
    }
  }
  return { picks, expectedDamage: exp, expectedPts: exp * valuePerWound(target), coverSave, los, range: d };
}

module.exports = { planVolley, fireLimit, rangeOf, valuePerWound };
