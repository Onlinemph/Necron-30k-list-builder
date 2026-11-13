'use strict';
// Legion Tacticas: each Legion's army-wide rule, from the Legion Tactica (or base Rite of War) text in that Legion's
// army data (CONFIRMED). The rest of the simulator asks legionOf(unit) and applies the effect where it happens:
//
//   Dark Angels      The Angel of Death        Leadership never below 6; Fear takes off at most 1 (checks.cjs)
//   Emperor's Ch.    Flawless Execution        +1 Combat Initiative on a turn they charged (assault.cjs)
//   Iron Warriors    The Bitter End            ignore Panic/Pinning/Stun/Suppressive penalties to checks (shoot.cjs)
//   White Scars      Swift of Action           +2 Movement for non-vehicles (army.cjs)
//   Space Wolves     The Hunter's Strike       +2" Set-up Move, to 6" (core.cjs)
//   Imperial Fists   Fire Discipline           +1 to hit for Bolt or Auto Fire Groups of more than 5 dice (shoot.cjs)
//   Night Lords      A Talent for Murder       +1 WS fighting units with a Tactical Status (assault.cjs)
//   Blood Angels     Encarmine Fury            +1 Strength on a turn they charged (assault.cjs)
//   Iron Hands       The Gorgon's Scales       -1 Strength to wound them with shooting (attack.cjs)
//   World Eaters     Violence Incarnate        +1 Attack on a turn they charged (assault.cjs)
//   Ultramarines     Tactical Flexibility      one reaction a turn costs nothing (reactions.cjs)
//   Death Guard      Remorseless Advance       Heavy after moving up to 4"; difficult terrain doesn't slow them (move.cjs)
//   Thousand Sons    Cult Arcana               all Psykers, +1 Willpower (army.cjs)
//   Sons of Horus    Death Dealers             Volleys at full BS (assault.cjs)
//   Word Bearers     Unwavering Conviction     +1 Combat Resolution (assault.cjs)
//   Salamanders      Promethean Endurance      wound rolls of 1-2 against them fail; Panic from Flame ignored
//   Raven Guard      Shadow Walkers            shots from 18" or more away are Snap Shots (shoot.cjs, ai.cjs)
//   Alpha Legion     Lies and Obfuscation      count as 2" further away for shooting, charges and reactions
//
// Emperor's Children and World Eaters choose a version in the army's configuration (CONFIRMED): Legiones Astartes
// has the Tactica, gambit and reaction above; Legiones Hereticus replaces all three:
//   Emperor's Children  Lords of Profligacy  after a Shooting Attack at them, they may become Stupefied (shoot.cjs)
//   World Eaters        The Nails' Bite      on a failed Leadership Check, they may become Lost to the Nails (checks.cjs)

/** The Legion whose Tactica a unit benefits from: every model it has left carries that Legion's Trait. */
function legionOf(u) {
  if (!u || !u.legion || !u.models) return null;
  const a = u.models.filter((m) => m.wounds > 0);
  return a.length && a.every((m) => (m.traits || []).includes(u.legion)) ? u.legion : null;
}
const is = (u, name) => legionOf(u) === name;
/** A unit of a Legiones Hereticus army (Emperor's Children and World Eaters only choose). */
const hereticus = (u) => !!legionOf(u) && u.rite === 'Hereticus';
/** The Legion's own Tactica applies: its Legion's units, in the Legiones Astartes version where there is a choice. */
const tactica = (u, name) => is(u, name) && !hereticus(u);
/** Extra distance an attacker must cover to an Alpha Legion unit. */
const rangePenalty = (target) => (is(target, 'Alpha Legion') ? 2 : 0);

module.exports = { legionOf, is, hereticus, tactica, rangePenalty };
