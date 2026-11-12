'use strict';
// Gambits: each model in a challenge picks one in the Face-Off step of every round.
//
// SHEET: the seven core gambits every duellist may pick. CONFIRMED (army data): the Rangdan three; character
// gambits from data/bsdata/common.json with plain number effects. A gambit's effects are data:
//   focusDice 'high'|'low'  roll an extra Focus die and keep the highest or the lowest
//   focus n                  +n to the Focus Roll
//   attacks n / attacksD3    extra Attacks
//   single                   only one attack in the Strike Step
//   matchOpp                 WS and A lowered to the opponent's
//   ws, str, dmg n           +n WS, Strength, Damage
//   dmgCap1                  attacks do only 1 Damage
//   tough n / toughSet n     +n Toughness, or Toughness set to n
//   extraRules(w)            special rules added to the weapon
//   testFoe                  take Challenge Advantage next round
//   guardUp                  +1 to the next Focus Roll for each enemy miss
//   crpIfWin n               +n Combat Resolution if this model wins the challenge
//   onKill(state, me, opp)   effect when the opponent is slain this round
const { has } = require('./rules.cjs');
const { alive, passChance, check } = require('./checks.cjs');

const traitOf = (m, t) => (m.traits || []).includes(t);
const anyone = () => true;
const GAMBITS = [
  // core gambits (SHEET)
  { name: 'Seize the Initiative', can: anyone, make: () => ({ focusDice: 'high' }) },
  { name: 'Flurry of Blows', can: anyone, make: () => ({ attacksD3: true, dmgCap1: true }) },
  { name: 'Test the Foe', can: anyone, make: () => ({ testFoe: true }) },
  { name: 'Guard Up', can: anyone, make: () => ({ ws: 1, single: true, guardUp: true }) },
  { name: 'Taunt and Bait', can: anyone, make: () => ({ matchOpp: true, crpIfWin: 1 }) },
  { name: 'Grandstand', can: anyone, make: (state, me) => ({ focusDice: 'low', attacks: Math.floor(alive(me.u).length / 5) }) },
  { name: 'Finishing Blow', can: anyone, make: () => ({ focusDice: 'low', str: 1, dmg: 1 }) },
  // Rangdan (data-rangdan.js)
  {
    name: 'Throat-Hunter', can: (m) => traitOf(m, 'Long Hunt'),
    make: (state, me, opp) => ({ extraRules: (w) => (String(w.AP) === '2' ? ['Shred (6+)'] : ['Breaching (4+)']), focus: opp.u.statuses.size ? 1 : 0 }),
  },
  {
    name: "Hunter's Stare", can: (m) => traitOf(m, 'Rangda'),
    estimate: (state, me, opp) => ({ focus: (1 - passChance(state, opp.u, 'CL', 0)) * 2 }),
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
/** Expected Focus Roll change from a gambit's effects (an extra die kept high is worth about +1). */
const focusShift = (e) => (e.focus || 0) + (e.focusDice === 'high' ? 0.97 : e.focusDice === 'low' ? -0.97 : 0);

/**
 * Pick a gambit for `me` against `opp` ({u, m} pairs). duel(effects) returns the expected wound difference of
 * the coming Strike Step with those effects; a point of Focus is worth about an eighth of a wound.
 */
function choose(state, me, opp, duel, opts = {}) {
  let best = null;
  for (const g of available(me.m)) {
    const e = g.estimate ? g.estimate(state, me, opp) : g.make(state, me, opp);
    let v = duel(e) + focusShift(e) * 0.12 + (e.onKill ? 0.3 : 0) + (e.crpIfWin || 0) * 0.15;
    if (e.testFoe) v += opts.moreRounds ? 0.15 : -0.5;
    if (e.guardUp) v += 0.1;
    if (!best || v > best.v) best = { g, v };
  }
  return best ? best.g : null;
}

module.exports = { GAMBITS, available, choose, focusShift };
