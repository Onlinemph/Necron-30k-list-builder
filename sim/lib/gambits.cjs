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
// and the Legion gambits' (CONFIRMED, army data), worked in assault.cjs:
//   oppCI1                   the opponent's Combat Initiative counts as 1 for the Focus Roll
//   noCI                     this model's Combat Initiative isn't added to its Focus Roll
//   noWoundPenalty           wounds lost don't lower the Focus Roll
//   noSupport                no Outside Support; supportMult n: n times the Outside Support; supportBonus n
//   oppSupportCap n          the opponent's Outside Support is at most n
//   aegis                    +1 Focus per other friendly Ultramarines Command model on the battlefield
//   wpFocus                  the Focus Roll may be replaced by the model's Willpower
//   predict                  Strike Low / Strike High: a correct guess ignores negative Focus modifiers
//   ew n                     Eternal Warrior (n) in the Strike Step
//   ifSword                  a sword: -1 Attack and Critical Hit (6+), or an existing Critical Hit improved by 1
//   decap                    no Focus Roll; one attack first, and the rest only if it hits and wounds
//   sacrifice n              +n Focus, then n wounds at AP 5, Damage 1 (armour and invulnerable saves allowed)
//   swapOut                  another model of the unit takes this one's place in the challenge
//   onDeath(state, me, opp)  effect when this model falls in the Strike Step
//   crpOnKill n              +n Combat Resolution if the opponent falls in the Strike Step
//   overkill                 attacks left after the opponent falls go to the rest of its unit
//   noEscape                 nobody may stop the challenge until a model falls
//   persist                  the effects last until the end of the Challenge Sub-Phase
// A gambit marked `first` may only be picked in the first Face-Off of a challenge.
const { has } = require('./rules.cjs');
const { alive, passChance, check } = require('./checks.cjs');

const traitOf = (m, t) => (m.traits || []).includes(t);
const anyone = () => true;
// a Legion's gambit; Emperor's Children and World Eaters have one per version (Legiones Astartes or Hereticus)
const legion = (name, version) => (m, me) => traitOf(m, name) && (!version || (me && me.u.rite) === version);
const SWORD = /chainsword|power sword|force sword|paragon blade/i;
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
  // Legion gambits (CONFIRMED: each Legion's army data)
  { name: 'I Am Alpharius', first: true, can: legion('Alpha Legion'), make: () => ({ oppCI1: true }) },
  { name: 'Thrall of the Red Thirst', can: legion('Blood Angels'), make: () => ({ noWoundPenalty: true, dmg: 1, noSupport: true }) },
  { name: 'Sword of the Order', can: legion('Dark Angels'), make: () => ({ ifSword: true }) },
  // the Death Guard's gambit is called simply "Gambit" in the data
  { name: 'Death Guard Gambit', can: legion('Death Guard'), make: (state, me, opp) => ({ toughSet: Number(opp.m.p.WS) || 4, toughExact: true }) },
  { name: 'Paragon of Excellence', first: true, can: legion("Emperor's Children", 'Astartes'), make: () => ({ focus: 2 }) },
  { name: 'The Broken Mirror', can: legion("Emperor's Children", 'Hereticus'), make: (state, me) => ({ supportMult: 2, supportBonus: me.u.cond?.has('Stupefied') ? 1 : 0 }) },
  { name: 'A Wall Unyielding', can: legion('Imperial Fists'), make: () => ({ noCI: true, ew: 1 }) },
  { name: 'Legion of One', can: legion('Iron Hands'), make: () => ({ supportMult: 2, oppSupportCap: 2 }) },
  {
    name: 'Spiteful Demise', can: legion('Iron Warriors'),
    // ASSUMPTION: the data leaves out the Spiteful Demise weapon profile; the model's own best weapon is used
    make: () => ({ onDeath: true }),
  },
  { name: 'Nostraman Courage', can: (m, me) => legion('Night Lords')(m, me) && me && alive(me.u).length > 1, make: () => ({ swapOut: true }) },
  { name: 'Decapitation Strike', can: legion('Raven Guard'), make: () => ({ decap: true }) },
  { name: 'Duty is Sacrifice', can: legion('Salamanders'), make: () => ({ sacrifice: 2 }) },
  { name: 'Merciless Strike', first: true, can: legion('Sons of Horus'), make: () => ({ extraRules: () => ['Phage (T)'] }) },
  {
    name: 'A Saga Woven of Glory', can: legion('Space Wolves'),
    make: () => ({ onKill: (state, me) => { require('./reactions.cjs').addBuff(me.u, { attacks: 1 }, 'phase'); state.log(`      ${me.u.name} gains +1 Attack for the fight (A Saga Woven of Glory)`); } }),
  },
  { name: 'No Prey Escapes', can: legion('Space Wolves'), make: () => ({ noEscape: true }) },
  { name: 'Prophetic Duellist', can: legion('Thousand Sons'), make: () => ({ wpFocus: true }) },
  { name: 'Aegis of Wisdom', can: legion('Ultramarines'), make: () => ({ aegis: true, noSupport: true }) },
  { name: 'The Path of the Warrior', can: legion('White Scars'), make: () => ({ predict: 'high' }) },
  {
    name: 'Beseech the Gods', first: true, can: legion('Word Bearers'),
    estimate: (state, me) => { const p = passChance(state, me.u, 'WP', 0); return { str: p, attacks: p, selfWound: 1 - p }; },
    make: (state, me) => {
      if (check(state, me.u, 'WP', 0, 'Beseech the Gods')) return { str: 1, attacks: 1, persist: true };
      // a failed check: one wound at AP 2, Damage 1, no saves
      me.m.wounds -= 1;
      state.log(`      ${me.m.name} suffers a wound (Beseech the Gods)`);
      if (me.m.wounds <= 0 && state.onCasualty) state.onCasualty(me.m, me.u, null);
      return {};
    },
  },
  { name: 'Brutal Dismemberment', can: legion('World Eaters', 'Hereticus'), make: () => ({ crpOnKill: 2 }) },
  { name: 'Violent Overkill', can: legion('World Eaters', 'Astartes'), make: () => ({ overkill: true }) },
];

/** The gambits a model may pick (me: {u, m}; round: the challenge round). */
const available = (m, me, round = 1) => GAMBITS.filter((g) => (!g.first || round === 1) && g.can(m, me));
/** Expected Focus Roll change from a gambit's effects (an extra die kept high is worth about +1). */
const focusShift = (e) => (e.focus || 0) + (e.focusDice === 'high' ? 0.97 : e.focusDice === 'low' ? -0.97 : 0);

/**
 * Pick a gambit for `me` against `opp` ({u, m} pairs). duel(effects) returns the expected wound difference of
 * the coming Strike Step with those effects; a point of Focus is worth about an eighth of a wound.
 */
function choose(state, me, opp, duel, opts = {}) {
  let best = null;
  for (const g of available(me.m, me, opts.round || 1)) {
    const e = g.estimate ? g.estimate(state, me, opp) : g.make(state, me, opp);
    // the Focus Roll change, from the challenge's own sums where it can tell (opts.focusDelta)
    const df = opts.focusDelta ? opts.focusDelta(e) : focusShift(e);
    let v = duel(e) + df * 0.12 + (e.onKill ? 0.3 : 0) + ((e.crpIfWin || 0) + (e.crpOnKill || 0) * 0.5) * 0.15;
    if (e.testFoe) v += opts.moreRounds ? 0.15 : -0.5;
    if (e.guardUp) v += 0.1;
    if (e.overkill || e.onDeath) v += 0.15;
    if (e.selfWound) v -= e.selfWound * 0.6;
    if (e.sacrifice && opts.saveFail) v -= e.sacrifice * opts.saveFail;
    // swapping out only pays when this model would fall; Decapitation Strike gives up the Focus Roll
    if (e.swapOut) v = opts.wouldFall ? 0.5 : -1;
    if (e.decap) v = (opts.decap ?? 0) - 0.2;
    if (e.noEscape) v += opts.favoured ? 0.15 : -0.4;
    if (!best || v > best.v) best = { g, v };
  }
  return best ? best.g : null;
}

module.exports = { GAMBITS, available, choose, focusShift };
