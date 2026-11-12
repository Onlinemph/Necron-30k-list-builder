'use strict';
// Gambits: each model in a challenge may pick one before the Focus Roll. The core rulebook's generic gambits
// aren't in the repo, so only gambits with full texts are here: the Rangdan three and character gambits from
// data/bsdata/common.json with plain number effects. A model without one fights the challenge as normal.
//
// A gambit returns { name, focus, extraRules, attacks, tough, onKill, needsCheck } and is chosen by the AI for the
// best expected duel. Add a gambit by adding an entry to GAMBITS.
const { num, has } = require('./rules.cjs');
const { alive, passChance, check } = require('./checks.cjs');

const traitOf = (m, t) => (m.traits || []).includes(t);
const GAMBITS = [
  // Rangdan (data-rangdan.js)
  {
    name: 'Throat-Hunter', can: (m) => traitOf(m, 'Long Hunt'),
    make: (state, me, opp) => ({ extraRules: (w) => (String(w.AP) === '2' ? ['Shred (6+)'] : ['Breaching (4+)']), focus: opp.u.statuses.size ? 1 : 0 }),
  },
  {
    name: "Hunter's Stare", can: (m) => traitOf(m, 'Rangda'),
    estimate: (state, me, opp) => (1 - passChance(state, opp.u, 'CL', 0)) * 2,
    make: (state, me, opp) => ({ focus: check(state, opp.u, 'CL', 0, "Hunter's Stare") ? 0 : 2 }),
  },
  {
    name: 'Feast of Memories', can: (m) => traitOf(m, 'Slaugth'),
    make: () => ({
      onKill: (state, me, opp) => {
        me.m.wounds = me.m.maxWounds;
        const take = opp.m.rules.find((r) => /^(Eternal Warrior|Feel No Pain|Fear|Hatred|Rending|Fleet|Counter-attack|Bulky)/.test(r)) || opp.m.rules[0];
        if (take && !me.m.rules.includes(take)) me.m.rules = [...me.m.rules, take];
        state.log(`      ${me.m.name} feasts on ${opp.m.name}'s memories: back to full wounds${take ? `, gains ${take}` : ''}`);
      },
    }),
  },
  // character gambits with plain number effects (data/bsdata/common.json)
  { name: 'Biological Overload', can: (m) => has(m.rules, 'Biological Overload'), make: () => ({ focus: 3, attacks: 3 }) },
  { name: 'Tempered by War', can: (m) => has(m.rules, 'Tempered by War'), make: () => ({ toughSet: 8 }) },
  { name: 'The Line Unbroken', can: (m) => has(m.rules, 'The Line Unbroken'), make: () => ({ attacks: 2 }) },
  { name: "Stone's Aegis", can: (m) => traitOf(m, 'Shield') && has(m.rules, "Stone's Aegis"), make: () => ({ tough: 1 }) },
];

/** The gambits a model may pick. */
const available = (m) => GAMBITS.filter((g) => g.can(m));

/**
 * Pick a gambit for `me` against `opp` ({u, m} pairs): the one with the best rough value, or null.
 * duel(effects) returns the expected wound difference of the coming Strike Step with those effects.
 */
function choose(state, me, opp, duel) {
  const opts = available(me.m);
  if (!opts.length) return null;
  let best = null;
  const base = duel({});
  for (const g of opts) {
    // value: change in the duel, plus about a tenth of a wound per point of Focus
    const preview = g.estimate ? { focus: g.estimate(state, me, opp) } : g.make({ dice: null, log: () => {} }, me, opp);
    const v = duel(preview) - base + (preview.focus || 0) * 0.1 + (preview.onKill ? 0.3 : 0);
    if (v > 0 && (!best || v > best.v)) best = { g, v };
  }
  return best ? best.g : null;
}

module.exports = { GAMBITS, available, choose };
