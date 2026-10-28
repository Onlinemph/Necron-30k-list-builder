# Harlequins: design notes

There is no fan codex for Harlequins, so this army list was written for the builder rather than transcribed. It follows
`data/SCHEMA.md` and the Drukhari and Ork conventions (`data/drukhari/NOTES.md`, `data/orks/NOTES.md`), with every
`page` set to `null` because there is no book to cite.

## How it follows Horus Heresy 3rd edition

An HH3 faction is a trait, a Tactica, Advanced Reactions, Gambits, Prime Advantages and detachments, and its Legions
differ through those rather than through statlines alone. Rules come with a cost attached (Only in Death, Vanguard,
Heedless). The Harlequins get the same set:

- **Traits**: Xenos (replaces Allegiance, as in the other fan codexes), Harlequin, [Masque], Masque Leader, Jink, Psyker.
- **Tactica, The Great Dance**: Rising Crescendo (Run and Charge from the second turn, the 7th edition rule) and Disengage
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

## Individually as strong as Custodes, in their own way

Harlequins are priced so a model is worth about what a Custodian is, but they get there differently. Custodes are T5,
2+ armour and Eternal Warrior. Harlequins are T3 with a 6+ armour save, and rely on a 4+ invulnerable holo-suit
that turns to Shrouded (5+) against shooting after a Rush, Initiative 7 to 10 so they strike first, five attacks a Player (the 10th
edition blade), M8 with flip belts and Rising Crescendo, and Shadow Dance and Veil of Tears to avoid being shot at all.

Checked with `scripts/balance-sim.cjs --rank` against Legio Custodes, in a scratch copy that also models Dodge and
Bypass. It can't see the holo-suit's Shrouded after a Rush. Value per 100 points, summed over shooting and melee against Legionaries, Terminators and a Predator, and
durability against bolters, lascannons and power axes:

| Unit | Points | Value / 100 pts |
| --- | --- | --- |
| Custodian Guard (6) | 270 | 5.96 |
| Harlequin Troupe (5), Caresses | 185 | 5.46 |
| Harlequin Troupe (5), Embraces | 185 | 5.42, before the charge bonus |
| Harlequin Troupe (5), Kisses | 185 | 5.10 |
| Harlequin Troupe (5), blades | 160 | 3.68, before Reaping Blow |
| Constantin Valdor | 400 | 2.78 |
| Vaelith Duskmirror | 400 | 2.70 |
| Tribune | 250 | 2.92 |
| Solitaire, before Blitz | 175 | 2.56 |
| Shield Captain | 175 | 2.43 |
| Troupe Master, Caress | 120 | 2.32 |
| Contemptor-Galatus Dreadnought | 225 | 5.80 |
| Harlequin Wraithlord, Wraithsword | 180 | 5.74 |

Per point, a Troupe is about a fifth as tough as Custodian Guard against bolters and 1.8 times as tough against
lascannons. The sim can't see speed, Reactions, Rising Crescendo, the Shrouded after a Rush, Veil of Tears, Fear, Impact or
Reaping Blow, which is why Troupes sit about 10% under the Custodian Guard on paper.

## Weapons and wargear, and where they come from

Most of the rules come from the BattleScribe data for older editions: `BSData/wh40k-7th-edition`
(`Harlequins - Codex.cat`, the 2015 codex) and `BSData/wh40k-2nd-edition` (`Codex - Eldar (Harlequins).cat`), with later
editions from search results (Wahapedia's 8th and 10th edition datasheets, the Warhammer Community article on the 2022
weapons). Each item is converted to HH3 terms:

Every weapon uses only rules that real HH3 weapons use (a test checks this against the BSData HH3 weapons), and each
has its own shape: different Initiative, Attacks and Strength modifiers and one or two rules, so a loadout is a choice
of role rather than a bigger number.

| Item | Source rule | Here | Role |
| --- | --- | --- | --- |
| Harlequin's Blade | 10th: many attacks, AP-1 | I+1, AP 4, Reaping Blow (1) | strikes first, whirls when outnumbered; the cheap anti-horde default |
| Harlequin's Kiss | 2nd: a hit kills on a failed save, no use against vehicles; 7th: Instant Death on a 6; 8th–9th: D3, D2 | AP 3, D 2, Poisoned (4+), Shred (6+) | the wire works from inside, so Toughness doesn't matter: for Custodians, monsters and Primarchs, never vehicles |
| Harlequin's Caress | 7th: a 6 to hit wounds at AP2; 9th: ignores invulnerable saves | S+1, AP 3, Bypass (6+) | phase field: a 6 to wound ignores every save, as on the Callidus phase sword; for Terminators and characters |
| Harlequin's Embrace | 7th: D3 Hammer of Wrath hits at S6; 8th: AP-3; 9th: mortal wounds on the charge | S+1, AP 3, Impact (AM), Impact (SM) | the wire cloud on the charge: S5 and an extra attack; for power-armoured infantry |
| Power Sword | 10th: Lead Player and Troupe Master option | the HH3 power sword | |
| Mime's Blade | Rogue Trader Mimes, silent killers | I+1, AP 4, Precision (4+) | picks out sergeants and specialists |
| Miststave | 7th: S+2 Concussive, Fleshbane; 8th: D3 | S+1, AP 4, Force (D), Aflame (2) | the Shadowseer's visions break the foe's nerve in combat |
| Zephyrglaive | 7th: S+1 and AP2 on the charge; 10th: S6 AP-2 D2 | I+1, S+1, AP 3, D 2, Impact (SM) | the Skyweaver's lance |
| Shuriken weapons | Bladestorm: a 6 to wound is AP2 | Breaching (6+); the cannon also Suppressive (1) | |
| Neuro Disruptor | 7th: S1 AP2 Pistol, Fleshbane; lore: scrambles the nervous system | RS 1, AP 2, Poisoned (3+), Psy-Shock | kills infantry and burns out psykers |
| Fusion Pistol | 7th: 6" S8 AP1 Pistol, Melta | RS 8, AP 2, D 3, Melta (6) | |
| Shrieker Cannon | 7th: S1 Poisoned (2+), Pinning, Bio-explosive; or S6 Assault 3 | Poisoned (2+), Pinning (1), Deflagrate (5) (the victim bursts); or FP 3 shuriken | |
| Hallucinogen Grenade Launcher | 7th: S1 Blast, Hallucinogenic | Blast, Panic (1), Stun (1) | the foe flees or freezes |
| Star Bolas | 7th: S6 AP2 Blast, One Use Only | Blast, Pinning (2), Limited (1) | entangles |
| Haywire Cannon | 7th: S4 AP4 Blast, Haywire | Blast, Shock (Stunned), Armourbane | |
| Prismatic Cannon | 7th: Dispersed, Focussed, Lance | three modes; the lance has Armourbane and Armour-breaker (5+) | |
| Holo-suit | 2nd: -1 to hit and -1 WS in combat; 7th: 5++; 8th on: 4++ | 4++, and Shrouded (5+) against shooting after a Rush (or +1 to an existing Shrouded, to 4+ at best) | |
| Flip Belt | 7th: ignores difficult terrain when moving and charging | Move Through Cover, moves over models and terrain | |
| Holo-fields | 2nd: -1 to hit while moving; 7th: 5++ unless immobilised; 8th: 4++ | 5++, 4++ after a fast move | |
| Solitaire | 7th: Impossible Form 3++, Blitz (Xd6" over everything, Attacks 10), Path of Damnation; 2nd: immune to psychology | 3+ invulnerable, Blitz as in 7th, ignores Fear | |
| Death Jester | 7th: Death is Not Enough (Morale at -2 after a casualty); 10th: Cruel Amusement | both | |

The relics are the 7th edition Enigmas of the Black Library: Cegorach's Rose (a finer Kiss: Poisoned (3+), Shred (5+),
master-crafted), The Storied Sword (S+1 AP3, master-crafted, with an extra attack), Crescendo (a Quickfire shuriken
pistol, here three shots with Breaching (5+)), The Laughing God's Eye (Adamantium Will nearby, here +1 Willpower within
12"), The Mask of Secrets (Fearless, -2 Leadership nearby, here Fear (2)) and Starmist Raiment (3++ after running).
"Master-crafted" is Duellist's Edge (1).

Stats are scaled up from the older editions to put Harlequins on the Custodes power level the army is meant for; the
relative order holds (a 7th edition Player is WS5 I6 A2, a Troupe Master WS6 I7 A3, a Solitaire WS9 I10 A6).
