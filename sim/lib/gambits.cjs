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
//   woundFloor n             Wound Tests against this model succeed only on an unmodified n or more
//   breaker                  no attacks; a friendly Iron Warriors unit shoots the opponent instead (Snap Shots)
//   noPositive               no positive Focus modifiers; regen: D3 wounds back if it survives the Strike Step
//   howl                     +5 Focus each round until a Strike Step without an unsaved wound
//   thousandCuts             a wounded opponent strikes at -1 Strength
//   fnp n                    Feel No Pain (n) in the Strike Step
// and the named characters' gambits (CONFIRMED, their rules in the army data), also worked in assault.cjs:
//   persist                  also keeps ws and tough (Bite of the Betrayed) besides str and attacks
//   crit n                   attacks in the Strike Step have Critical Hit (n+), or keep a better one they have
//   weapon w                 the model strikes with this weapon profile and no other
//   dirty                    one attack, as if the model had 1 Attack, at the start of the Focus Step
//   lastStand n              reduced to 0 Wounds in the Strike Step, on an n+ it stays with 1 Wound and takes
//                            Challenge Advantage (once per Strike Step)
//   hitOn n                  Hit Tests in the Strike Step succeed on n+ (hitOnP: the chance, for the AI's estimate)
// A gambit marked `first` may only be picked in the first Face-Off of a challenge. `can(m, me, opp)` gets the
// opponent ({u, m}) when it's known.
const { has, xOf, save } = require('./rules.cjs');
const { alive, passChance, check } = require('./checks.cjs');

const traitOf = (m, t) => (m.traits || []).includes(t);
const anyone = () => true;
// a Legion's gambit; Emperor's Children and World Eaters have one per version (Legiones Astartes or Hereticus)
const legion = (name, version) => (m, me) => traitOf(m, name) && (!version || (me && me.u.rite) === version);
const SWORD = /chainsword|power sword|force sword|paragon blade/i;
// the Hammerblow weapon profile (CONFIRMED: data/bsdata/common.json), for Alexis Polux's gambit
const HAMMERBLOW = { name: 'Hammerblow', base: 'Hammerblow', IM: 'I', AM: 1, SM: 10, AP: 2, D: 3, specialRules: ['Critical Hit (6+)'], traits: ['Power'] };
// the Legions Saul Tarvitz's Bite of the Betrayed works against
const BETRAYERS = ["Emperor's Children", 'World Eaters', 'Sons of Horus', 'Death Guard'];
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
  // The Faultless Blade (Captain Lucius): +4 instead of +2 (CONFIRMED)
  { name: 'Paragon of Excellence', first: true, can: legion("Emperor's Children", 'Astartes'), make: (state, me) => ({ focus: me && has(me.m.rules, 'The Faultless Blade') ? 4 : 2 }) },
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
  // Primarchs' own gambits (CONFIRMED: their rules in the army data)
  { name: 'Angelic Descent', first: true, can: (m, me) => has(m.rules, 'Angelic Descent') && !!me?.u.turn?.charged, make: (state, me, opp) => ({ focus: xOf(opp.m.rules, 'Bulky') || 0 }) },
  { name: "The Lion's Choler", can: (m) => has(m.rules, "The Lion's Choler") && m.wounds <= 2, make: () => ({ focus: 2, noWoundPenalty: true }) },
  { name: 'Bulwark of the Imperium', can: (m) => has(m.rules, 'Bulwark of the Imperium'), estimate: () => ({ tough: 2 }), make: () => ({ woundFloor: 5 }) },
  { name: 'The Breaker', first: true, can: (m) => has(m.rules, 'The Breaker'), make: () => ({ breaker: true }) },
  {
    name: 'A Death Long Foreseen', can: (m, me) => has(m.rules, 'A Death Long Foreseen') && !!me?.foreseen,
    estimate: (state, me) => { const p = passChance(state, me.u, 'WP', 0); return { fnp: 5, attacks: p, focus: 2 * p }; },
    make: (state, me) => {
      // a Willpower Check for each benefit: Feel No Pain (5+), +1 Attack, +2 Initiative (counted on the Focus Roll)
      const e = {};
      if (check(state, me.u, 'WP', 0, 'A Death Long Foreseen: Feel No Pain')) e.fnp = 5;
      if (check(state, me.u, 'WP', 0, 'A Death Long Foreseen: Attacks')) e.attacks = 1;
      if (check(state, me.u, 'WP', 0, 'A Death Long Foreseen: Initiative')) e.focus = 2;
      return e;
    },
  },
  { name: 'The Shadowed Lord', can: (m) => has(m.rules, 'The Shadowed Lord'), make: () => ({ noWoundPenalty: true }) },
  { name: 'The Undying Fire', can: (m) => has(m.rules, 'The Undying Fire'), make: () => ({ noPositive: true, regen: true }) },
  { name: 'Howl of the Death Wolf', can: (m) => has(m.rules, 'Howl of the Death Wolf') && !m.howlUsed, make: (state, me) => { me.m.howlUsed = true; return { focus: 5, howl: true }; } },
  { name: 'Calculating Swordsman', can: (m) => has(m.rules, 'Calculating Swordsman'), make: (state) => ({ focus: Math.min(4, state.round || 1) }) },
  { name: 'Death by a Thousand Cuts', can: (m) => has(m.rules, 'Death by a Thousand Cuts'), make: () => ({ thousandCuts: true }) },
  // Named characters' own gambits (CONFIRMED: their rules in the army data and data/bsdata/common.json)
  // Bite of the Betrayed (Saul Tarvitz, A Brother Betrayed): first Face-Off only, against an Emperor's Children, World
  // Eaters, Sons of Horus or Death Guard model; +1 WS, Strength and Toughness until the challenge ends
  { name: 'Bite of the Betrayed', first: true, can: (m, me, opp) => has(m.rules, 'A Brother Betrayed') && !!opp && BETRAYERS.some((t) => traitOf(opp.m, t)), make: () => ({ ws: 1, str: 1, tough: 1, persist: true }) },
  // Seeker of Atonement (Hibou Khan): reduced to 0 Wounds in the Strike Step, on a 4+ he stays with 1 Wound and takes
  // Challenge Advantage
  { name: 'Seeker of Atonement', can: (m) => has(m.rules, 'Seeker of Atonement'), make: () => ({ lastStand: 4 }) },
  // Head-taker (Hvarl Red-Blade): the opponent claims no Outside Support
  { name: 'Head-taker', can: (m) => has(m.rules, 'Head-taker'), make: () => ({ oppSupportCap: 0 }) },
  // Death's Champion (Sigismund): Critical Hit (5+) in the Strike Step
  { name: "Death's Champion", can: (m) => has(m.rules, "Death's Champion"), make: () => ({ crit: 5 }) },
  // Hammerblow (Alexis Polux): he strikes with the Hammerblow profile and no other weapon
  { name: 'Hammerblow', can: (m) => has(m.rules, 'Hammerblow'), make: () => ({ weapon: HAMMERBLOW }) },
  // Executioner's Tax (Fafnir Rann): an extra Focus die, the highest discarded; Critical Hit (6+) in the Strike Step
  { name: "Executioner's Tax", can: (m) => has(m.rules, 'Executioner’s Tax'), make: () => ({ focusDice: 'low', crit: 6 }) },
  // Dirty Fighter (Sevatar): first Face-Off only; at the start of the Focus Step one attack as if he had 1 Attack, then
  // the Focus Roll as normal
  { name: 'Dirty Fighter', first: true, can: (m) => has(m.rules, 'Dirty Fighter'), make: () => ({ dirty: true }) },
  // Archein of Wisdom (Raldoron): + Focus for each successful Hit Test the opponent made in the previous Strike Step of
  // this challenge (me.hitsTaken, counted in assault.cjs)
  { name: 'Archein of Wisdom', can: (m) => has(m.rules, 'Archein of Wisdom'), make: (state, me) => ({ focus: (me && me.hitsTaken) || 0 }) },
  {
    // Witchblood (Calas Typhon): once per battle; a Willpower Check: +2 Attacks and Strength in the Strike Step, or a
    // wound at AP 2, Damage 1 with only an invulnerable Save. ASSUMPTION: the check is made when the gambit is picked
    // (the text: at the start of the Focus Step, which comes straight after)
    name: 'Witchblood', can: (m) => has(m.rules, 'Witchblood') && !m.witchbloodUsed,
    estimate: (state, me) => { const p = passChance(state, me.u, 'WP', 0); const inv = save(me.m.p.INV); return { str: 2 * p, attacks: 2 * p, selfWound: (1 - p) * (inv <= 6 ? (inv - 1) / 6 : 1) }; },
    make: (state, me) => {
      me.m.witchbloodUsed = true;
      if (check(state, me.u, 'WP', 0, 'Witchblood')) return { str: 2, attacks: 2 };
      const inv = save(me.m.p.INV);
      if (inv <= 6 && state.dice.d6() >= inv) { state.log(`      ${me.m.name} saves the Witchblood wound`); return {}; }
      me.m.wounds -= 1;
      state.log(`      ${me.m.name} suffers a wound (Witchblood)`);
      if (me.m.wounds <= 0 && state.onCasualty) state.onCasualty(me.m, me.u, null);
      return {};
    },
  },
  {
    // Every Strike Foreseen (Ahzek Ahriman, Magistus Amon, and any Divination psyker): a Willpower Check (no Perils);
    // passed, Hit Tests in the Strike Step succeed on a 2+
    name: 'Every Strike Foreseen', can: (m) => has(m.rules, 'Every Strike Foreseen'),
    estimate: (state, me) => ({ hitOn: 2, hitOnP: passChance(state, me.u, 'WP', 0) }),
    make: (state, me) => (check(state, me.u, 'WP', 0, 'Every Strike Foreseen') ? { hitOn: 2 } : {}),
  },
];

/** The gambits a model may pick (me: {u, m}; round: the challenge round; opp: the opponent {u, m}, when known). */
const available = (m, me, round = 1, opp = null) => GAMBITS.filter((g) => (!g.first || round === 1) && g.can(m, me, opp));
/** Expected Focus Roll change from a gambit's effects (an extra die kept high is worth about +1). */
const focusShift = (e) => (e.focus || 0) + (e.focusDice === 'high' ? 0.97 : e.focusDice === 'low' ? -0.97 : 0);

/**
 * Pick a gambit for `me` against `opp` ({u, m} pairs). duel(effects) returns the expected wound difference of
 * the coming Strike Step with those effects; a point of Focus is worth about an eighth of a wound.
 */
function choose(state, me, opp, duel, opts = {}) {
  let best = null;
  for (const g of available(me.m, me, opts.round || 1, opp)) {
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
    // Dirty Fighter: the extra attack before the Focus Roll (opts.dirty: its expected wounds)
    if (e.dirty) v += opts.dirty || 0;
    // Seeker of Atonement: worth most when this model would otherwise fall
    if (e.lastStand) v += opts.wouldFall ? ((7 - e.lastStand) / 6) * 2 : 0.05;
    // Bite of the Betrayed lasts the whole challenge
    if (e.persist && e.tough && opts.moreRounds) v += 0.1;
    if (!best || v > best.v) best = { g, v };
  }
  return best ? best.g : null;
}

module.exports = { GAMBITS, available, choose, focusShift };
