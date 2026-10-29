# Harlequins: design notes

There is no fan codex for Harlequins, so this army list was written for the builder rather than transcribed. It follows
`data/SCHEMA.md` and the Drukhari and Ork conventions (`data/drukhari/NOTES.md`, `data/orks/NOTES.md`), with every
`page` set to `null` because there is no book to cite.

## How it follows Horus Heresy 3rd edition

An HH3 faction is a trait, a Tactica, Advanced Reactions, Gambits, Prime Advantages and detachments, and its Legions
differ through those rather than through statlines alone. Rules come with a cost attached (Only in Death, Vanguard,
Heedless). The Harlequins get the same set:

- **Traits**: Xenos (replaces Allegiance, as in the other fan codexes), Harlequin, [Masque], Masque Leader, Jink, Psyker.
- **Tactica, The Great Dance**: Rising Crescendo (Rush and Charge from the second turn, the 7th edition rule; Infantry
  and Paragons, so Vaelith Duskmirror can lead the Masque Court without slowing it) and Disengage
  from any combat (the 2nd edition "flip out of combat"). The cost: a Harlequin unit that loses a combat must leave it.
- **Advanced Reactions**: Shadow Dance (shooting) and The Laughing God's Riposte (charges).
- **Gambit**: Cegorach's Jest. **Prime Advantage**: Webway Strike. **Additional Reaction Point** with a Masque Leader in
  the Primary Detachment, as the Drukhari get one for Rulers of the Dark City.

## How it follows the fan codexes

- **A per-unit choice, like Crypto-Arkana, Great Clan and Partisan**: the [Masque]. Each Masque is built like an Ork clan
  page: a Tactica with a cost, plus one Gambit, Advanced Reaction or Prime Advantage.

  | Masque | Tactica (benefit / cost) | Extra |
  | --- | --- | --- |
  | Frozen Stars | Impact (S) / must charge an enemy within 12" | Gambit: Hysterical Onslaught |
  | Midnight Sorrow | Routed becomes Pinned / can't use The Great Dance to leave combat | Prime Advantage: Herald of the Fall |
  | Veiled Path | Shrouded (5+) with a holo-suit / lost after shooting | Gambit: Hall of Mirrors |
  | Silent Shroud | Fear (1), or +1 to Fear / no joining across Masques | Reaction: The Silent Scream |
  | Soaring Spite | +2 Movement on Jink models / can't hold objectives after a Rush | Reaction: Spite of the Skies |
  | Dreaming Shadow | Feel No Pain (6+), +1 Attack below half strength / -1 Cool | Prime Advantage: Death's Promise |

- **Detachments unlocked by a Command model of the right Masque**, like the Kabalite Strike Force: one Auxiliary per
  Masque, three open Auxiliaries, and two Apex Detachments (The Great Masque; Weaver Constellation with a required
  Prime Advantage, like the Drukhari Titan Hunters). Auxiliary and Apex Detachments share one Masque
  (`sameInDetachment`, as for Ork clans); the Solitaire has none.
- **Wargear lists** with once-per-army relics, the Enigmas of the Black Library, like the Haemonculus Arcana.
- **Every Force Organisation role a Harlequin army plausibly fills**, filled with invented-but-plausible units where the
  Games Workshop range has none, as the Drukhari codex does with the Rampage, Demilune or Raven Lord: the Webweaver,
  Prismweaver, Dreamweaver, Masque Court and Troupe Master on Skyweaver are written for this list, Mimes are a Rogue
  Trader-era role, and so are Vaelith Duskmirror and the rules for Sylandri Veilwalker. The Harlequin Wraithlord is the
  dreadnought from the 1988 Rogue Trader Harlequin list (the model that became the Wraithlord), with rules written here;
  it fills the War Engine role, and the Dreaming Shadow's Masque of the Dead has a slot for one.
- **One unit of its own for each Masque**, as HH3 Legions have theirs (Rampagers, Terror Squads), plus Wraith-dancers
  for the Heavy Assault role. See "Masque units and Wraith-dancers" below.

## Individually as strong as Custodes, in their own way

Harlequins are priced so a model is worth about what a Custodian is, but they get there differently. Custodes are T5,
2+ armour and Eternal Warrior. Harlequins are T3 with a 6+ armour save, and rely on a 4+ invulnerable holo-suit
that turns to Shrouded (5+) against shooting after a Rush, Initiative 7 to 10 so they strike first, five attacks a Player (the 10th
edition blade), M8 with flip belts and Rising Crescendo, and Shadow Dance and Veil of Tears to avoid being shot at all.

In combat they also have Dodge (X), a Damage Mitigation Test taken after the Saving Throw, so it stacks with the
invulnerable save. Dodge is 6+ on Players, Court Players and Skyweavers, 5+ on the characters, the Solitaire and Mimes
(who have no holo-suit, so for them it is the only roll), and 4+ on Vaelith Duskmirror.

Dodge is kept low on the rank and file because striking first already does most of their work in combat: a Troupe at I7
kills most of a Tactical Squad before it swings, so Dodge only matters against what survives that, which is
Terminators, Dreadnoughts and Primarchs. At Dodge (4+) none of the 307 Legion units in the builder wiped a Troupe in six
rounds of combat in the sim, which left a Legion player no answer in combat at any price.

Checked with `scripts/balance-sim.cjs --rank` against Legio Custodes, in a scratch copy that also models Dodge (as a
Damage Mitigation Test in combat, one per wound, so it doesn't add to Feel No Pain), Bypass, Eternal Warrior (X), Reaping
Blow (outnumbering counts Bulky models as several), Impact (AM) on half the rounds (the ones after a charge), and a
Rending or Critical Hit counting as a 6 for Breaching, Shred and Bypass. In combat each model group strikes at its own
weapon's Initiative step. It can't see the holo-suit's Shrouded after a Rush, Phage, Precision or Fear. Value per 100 points, summed over shooting and melee against Legionaries, Terminators and
a Predator, and durability against bolters, lascannons and power axes:

| Unit | Points | Value / 100 pts |
| --- | --- | --- |
| Custodian Guard (6) | 270 | 6.56 |
| Harlequin Troupe (5), blades | 160 | 5.53 |
| Harlequin Troupe (5), Kisses | 160 | 5.65 |
| Harlequin Troupe (5), a Caress | 170 | 5.78 |
| Harlequin Troupe (5), a Caress and four Kisses | 170 | 5.94 |
| Harlequin Troupe (5), Embraces | 210 | 5.41 |
| Harlequin Troupe (5), a Caress and four Embraces | 210 | 5.74 |
| Constantin Valdor | 400 | 2.91 |
| Vaelith Duskmirror | 400 | 2.75 |
| Tribune | 250 | 3.05 |
| Solitaire, before Blitz | 180 | 2.78 |
| Shield Captain | 175 | 2.43 |
| Troupe Master, Caress | 130 | 2.66 |
| Troupe Master, Cegorach's Rose / The Storied Sword | 135 | 2.57 / 3.05 |
| Contemptor-Galatus Dreadnought | 225 | 5.94 |
| Harlequin Wraithlord, Wraithsword | 180 | 5.95 |

Per point, a Troupe is about a quarter as tough as Custodian Guard against bolters, twice as tough against lascannons
and a quarter tougher against power axes. The sim can't see speed, Reactions, Rising Crescendo, the Shrouded after a
Rush or Veil of Tears, which is why Troupes sit 9 to 18% under the Custodian Guard on paper.

In combat, the number of the 307 Legion units in the builder that wipe each loadout within six rounds, and that take it
to half strength or less:

| Unit | Wipe it | Half or less |
| --- | --- | --- |
| Troupe, blades | 20 | 34 |
| Troupe, Kisses | 12 | 25 |
| Troupe, a Caress | 6 | 16 |
| Troupe, a Caress and four Kisses | 6 | 12 |
| Troupe, Embraces | 28 | 51 |
| Troupe, a Caress and four Embraces | 12 | 27 |
| Custodian Guard | 15 | 21 |
| Solitaire | 56 | 78 |

Leman Russ beats every loadout except a Troupe with one Caress, which is a draw after six rounds (Russ at 7%, the
Troupe at 17%); the old five-Caress Troupe beat him with 28% left. The hardest loadouts to beat (a Caress, alone or with
four Kisses) are still easier than that old Troupe, at 3 and 11. Shooting is the answer to Harlequins: a Tactical Squad does 4.5 wounds a turn to a
Troupe and 0.7 to Custodian Guard.

## Masque units and Wraith-dancers

Each Masque has a unit only it can field, locked to that Masque (`fixedChoice`, as for Ork clan units), so the Masque a
list picks changes what it can take as well as its Tactica. Each fits its Masque's Auxiliary Detachment: Frenzied Revel
gained a Heavy Assault slot, Silent Procession an Elites slot and Masque of the Dead a Heavy Assault slot (for
Wraith-dancers). All are written for this list.

| Unit | Masque | Role | Idea | Points |
| --- | --- | --- | --- | --- |
| Revel Troupe | Frozen Stars | Heavy Assault | Embrace-armed players who have given up dodging: no Dodge, +1 Attack in a turn they charged, and they won't Disengage from a combat they're winning | 220 for 5 |
| Tragedians | Midnight Sorrow | Support | The chorus of the Fall, with hallucinogen launchers: -1 Leadership to enemies within 12", and Routed enemies near them stay Routed | 105 for 3 |
| Phantasms | Veiled Path | Recon | Illusions a Shadowseer projects. They can't attack or hold objectives; a foe aiming at a nearby Veiled Path unit must pass an Intelligence Check or hit the Phantasms instead, and they come back one a turn near a psyker | 60 for 5 |
| The Unspeaking | Silent Shroud | Elites | Elite Mimes with Infiltrate, Fear (2), Mime's Blades and neuro disruptors; killing a sergeant, champion or commander Stuns his unit | 120 for 3 |
| Starshrike | Soaring Spite | Fast Attack | A webway fighter, the army's only Flyer: a Starshrike Lance (Armourbane, Skyfire) and two shuriken cannons, and enemies it flies over may be Pinned | 130 |
| Deathmask Players | Dreaming Shadow | Troops | Players who have died once already: Eternal Warrior (1) on top of the Masque's Feel No Pain (6+), immune to Fear; Death's Promise takes them to Eternal Warrior (2) | 175 for 5 |
| Wraith-dancers | any | Heavy Assault | Wraithblades in Harlequin death masks, still dancing: T6 W3 3+, The Great Dance, Ghostswords or Ghostaxes, optional Forceshields (4++) | 165 for 3 |

Against Custodian Guard (6.56 per 100 points), in the same sim: the Revel Troupe scores 91%, Deathmask Players 82%,
Wraith-dancers 87% (90% with Ghostaxes). The Unspeaking (66%), Tragedians (54%), Starshrike (60%) and Phantasms (46%)
score like the Death Jester and Mimes, because what they do (auras, Precision, decoying, a Flyer's evasion) isn't in the
sim. In combat every one of them loses to Leman Russ, and the number of the 307 Legion units that wipe them within six
rounds is 33 for the Revel Troupe, 19 for Deathmask Players and 48 for Wraith-dancers.

## Weapons and wargear, and where they come from

Most of the rules come from the BattleScribe data for older editions: `BSData/wh40k-7th-edition`
(`Harlequins - Codex.cat`, the 2015 codex) and `BSData/wh40k-2nd-edition` (`Codex - Eldar (Harlequins).cat`), with later
editions from search results (Wahapedia's 8th and 10th edition datasheets, the Warhammer Community article on the 2022
weapons). Each item is converted to HH3 terms:

Every weapon uses only rules that real HH3 weapons use (a test checks this against the BSData HH3 weapons). A Player
carries one of four melee weapons, and each does one job well.

Each also has its own stat shape. The blade is free, fast and light: I+1 and an extra attack at AP 5, with a 6 to wound
finding a gap at AP 2. The Kiss is a free swap for the blade, slower and deadlier: one fewer attack, but D 3, and a 5+ to
hit wounds whatever the Toughness, because the wire works from inside. It's for Dreadnoughts, monsters and Custodians,
wasted on line troops, and Eternal Warrior blunts it against a Primarch. The Embrace (10 points) is the strength weapon,
S+1 at AP 3 with an extra attack on the charge and another when outnumbered, so five Players with Embraces wipe a
ten-man squad in a round. The Caress (10 points) strikes a step late (I-1) while its phase field attunes, has no AP
because it doesn't cut, and a 6 to hit wounds automatically and, counting as a 6, ignores every save and Damage
Mitigation Test: the Rending (6+) and Bypass (6+) pairing of the Callidus phase sword. Only one Player in five may take
one, because with a Caress on every Player a Troupe killed Leman Russ in two rounds.

| Item | Source rule | Here | Role |
| --- | --- | --- | --- |
| Harlequin's Blade | 10th: many attacks, AP-1 | I+1, A+1, AP 5, Breaching (6+) | free; fast and light, for lightly armoured infantry |
| Harlequin's Kiss | 2nd: a hit kills on a failed save, no use against vehicles; 7th: one Kiss of Death attack, Instant Death on a 6; 8th–9th: D3, D2 | A-1, AP 4, D 3, Rending (5+); free | the wire works from inside: for Dreadnoughts, monsters and Custodians, never vehicles |
| Harlequin's Caress | 7th: a 6 to hit wounds at AP2; 9th: ignores invulnerable saves | I-1, AP –, Rending (6+), Bypass (6+); one Player in five | phase field: a 6 to hit passes through everything; for Terminators, Custodes and characters |
| Harlequin's Embrace | 7th: D3 Hammer of Wrath hits at S6; 8th: AP-3; 9th: mortal wounds on the charge | S+1, AP 3, Impact (AM), Reaping Blow (1) | the wire cloud: an extra attack on the charge and another when outnumbered; for power-armoured infantry |
| Power Sword | 10th: Lead Player and Troupe Master option | the HH3 power sword | |
| Mime's Blade | Rogue Trader Mimes, silent killers | I+2, AP 4, Precision (4+), Rending (6+) | strikes before anyone sees it and picks out sergeants and specialists |
| Miststave | 7th: S+2 Concussive, Fleshbane; 8th: D3 | I-1, S+2, AP 4, Force (D), Aflame (2) | a heavy staff; the Shadowseer's visions break the foe's nerve in combat |
| Zephyrglaive | 7th: S+1 and AP2 on the charge; 10th: S6 AP-2 D2 | I+1, S+1, AP 3, D 2, Impact (SM) | the Skyweaver's lance |
| Shuriken weapons | Bladestorm: a 6 to wound is AP2 (9th: AP-3) | Breaching (5+); the cannon also Suppressive (1) | twice a bolter's kills against power armour |
| Neuro Disruptor | 7th: S1 AP2 Pistol, Fleshbane; lore: scrambles the nervous system | RS 1, AP 2, Poisoned (3+), Phage (I) | a wounded unit loses 1 Initiative for the battle, so the Troupe strikes first against faster foes |
| Fusion Pistol | 7th: 6" S8 AP1 Pistol, Melta | RS 8, AP 2, D 3, Melta (6) | 15 points |
| Haywire grenades | 7th: on the Masque's characters | the HH3 haywire grenades: R 8, S 4, Shock (Stunned) | Troupe Masters, Great Harlequins, Shadowseers, Death Jesters, the Solitaire and Vaelith |
| Shrieker Cannon | 7th: S1 Poisoned (2+), Pinning, Bio-explosive; or S6 Assault 3 | Poisoned (2+), Pinning (1), Deflagrate (5) (the victim bursts); or FP 3 shuriken | |
| Hallucinogen Grenade Launcher | 7th: S1 Blast, Hallucinogenic | Blast, Panic (1), Stun (1) | the foe flees or freezes |
| Star Bolas | 7th: S6 AP2 Blast, One Use Only | Blast, Pinning (2), Limited (1) | entangles |
| Haywire Cannon | 7th: S4 AP4 Blast, Haywire | Blast, Shock (Stunned), Armourbane | |
| Prismatic Cannon | 7th: Dispersed, Focussed, Lance | three modes; the lance has Armourbane and Armour-breaker (5+) | |
| Holo-suit | 2nd: -1 to hit and -1 WS in combat; 7th: 5++; 8th on: 4++ | 4++, and Shrouded (5+) against shooting after a Rush (or +1 to an existing Shrouded, to 4+ at best); in combat the Dodge roll comes on top | |
| Flip Belt | 7th: ignores difficult terrain when moving and charging | Move Through Cover, moves over models and terrain | |
| Holo-fields | 2nd: -1 to hit while moving; 7th: 5++ unless immobilised; 8th: 4++ | 5++, 4++ after a fast move | |
| Solitaire | 7th: Impossible Form 3++, Blitz (Xd6" over everything, Attacks 10), Path of Damnation; 2nd: immune to psychology | 3+ invulnerable, Blitz as in 7th, ignores Fear | |
| Death Jester | 7th: Death is Not Enough (Morale at -2 after a casualty); 10th: Cruel Amusement | both | |

The relics are the 7th edition Enigmas of the Black Library: Cegorach's Rose (a finer Kiss: A-1, AP 3, D 3, Rending
(4+), master-crafted), The Storied Sword (S+1, AP 2, D 2 and an extra attack, master-crafted), Crescendo (a Quickfire
shuriken pistol, here three shots with Breaching (4+)), The Laughing God's Eye (Adamantium Will nearby, here +1
Willpower within 12"), The Mask of Secrets (Fearless, -2 Leadership nearby, here Fear (2)) and Starmist Raiment (3++
after running). "Master-crafted" is Duellist's Edge (1).

Checked against every unit and option in `Harlequins - Codex.cat`. From it come haywire grenades on the characters,
mirage launchers on Skyweavers, the Solitaire's Cegorach's Rose in place of its Kiss, relics, Crescendo and an Enigma for
the Lead Player (the 7th edition Troupe Master upgrade), up to one Psychic Discipline for a Shadowseer and two for
Sylandri (7th edition Mastery Level 2; Telepathy, Divination or Thaumaturgy, as for a Legion Librarian), and Voidweaver
squadrons of up to three. Left out: the Prophets of Flesh formation characters (the Lambent Prince, Dusk, Inriam's
Spectre, the Blades of Fate, the Serpent's Breath) and the Ynnari (Yvraine, the Visarch, the Yncarne), which are their own
faction.

Stats are scaled up from the older editions to put Harlequins on the Custodes power level the army is meant for; the
relative order holds (a 7th edition Player is WS5 I6 A2, a Troupe Master WS6 I7 A3, a Solitaire WS9 I10 A6).
