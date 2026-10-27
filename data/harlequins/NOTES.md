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
2+ armour and Eternal Warrior. Harlequins are T3 with a 6+ armour save, and rely on a 4+ invulnerable holo-suit,
Dodge (3+) in combat and against Reactions, Initiative 7 to 10 so they strike first, five attacks a Player (the 10th
edition blade), M8 with flip belts and Rising Crescendo, and Shadow Dance and Veil of Tears to avoid being shot at all.

Checked with `scripts/balance-sim.cjs --rank` against Legio Custodes, in a scratch copy that also models Dodge, Phase
Field, the Kiss of Death attack and the Embrace's charge hits. Value per 100 points, summed over shooting and melee
against Legionaries, Terminators and a Predator, and durability against bolters, lascannons and power axes:

| Unit | Points | Value / 100 pts |
| --- | --- | --- |
| Custodian Guard (6) | 270 | 6.26 |
| Harlequin Troupe (5), Caresses | 200 | 5.63 |
| Harlequin Troupe (5), Kisses | 200 | 5.58 |
| Harlequin Troupe (5), blades | 175 | 4.75 |
| Constantin Valdor | 400 | 2.93 |
| Vaelith Duskmirror | 400 | 3.07 |
| Tribune | 250 | 3.10 |
| Solitaire, before Blitz | 175 | 2.87 |
| Shield Captain | 175 | 2.61 |
| Troupe Master, Caress | 120 | 2.51 |
| Contemptor-Galatus Dreadnought | 225 | 5.80 |
| Harlequin Wraithlord, Wraithsword | 180 | 5.74 |

Per point, a Troupe is about a fifth as tough as Custodian Guard against bolters and 1.8 times as tough against
lascannons. The sim can't see speed, Reactions, Rising Crescendo, Veil of Tears or Fear, which is why Troupes sit about
10% under the Custodian Guard on paper.

## Weapons and wargear, and where they come from

Most of the rules come from the BattleScribe data for older editions: `BSData/wh40k-7th-edition`
(`Harlequins - Codex.cat`, the 2015 codex) and `BSData/wh40k-2nd-edition` (`Codex - Eldar (Harlequins).cat`), with later
editions from search results (Wahapedia's 8th and 10th edition datasheets, the Warhammer Community article on the 2022
weapons). Each item is converted to HH3 terms:

| Item | Source rule | Here |
| --- | --- | --- |
| Harlequin's Blade | 10th: many attacks, AP-1, Devastating Wounds | AP 4, Breaching (6+) |
| Harlequin's Kiss | 7th: one Kiss of Death attack at S6 AP2, Instant Death on a 6 to wound; 2nd: a hit kills on a failed save | Kiss of Death: one attack at S6 AP2 D2 with Murderous (6+) |
| Harlequin's Caress | 7th: Caress of Death, a 6 to hit wounds automatically at AP2; 9th: ignores invulnerable saves | Rending (6+) with Breaching (6+), so those hits are AP2, and Phase Field (6+) |
| Harlequin's Embrace | 7th: Embrace of Death, D3 Hammer of Wrath hits at S6 | Embrace of Death: D3 automatic S6 hits on the charge |
| Shrieker Cannon | 7th: S1 AP5 Poisoned (2+), Pinning, Bio-explosive (a slain model bursts: S5 AP4 hits); or S6 Assault 3 | Poisoned (2+), Pinning (1), Deflagrate (5); or FP 3 shuriken |
| Neuro Disruptor | 7th: 12" S1 AP2 Pistol, Fleshbane | RS 1, AP 2, Poisoned (2+) |
| Fusion Pistol | 7th: 6" S8 AP1 Pistol, Melta | RS 8, AP 2, D 3, Melta (6) |
| Hallucinogen Grenade Launcher | 7th: S1 Blast, Hallucinogenic (a failed Pinning test also costs a wound, no saves) | Blast, Pinning (1), Hallucinogenic |
| Miststave | 7th: S+2 AP-, Concussive, Fleshbane | S+2, Poisoned (2+) |
| Star Bolas | 7th: 12" S6 AP2 Blast, One Use Only | Blast, Limited (1) |
| Zephyrglaive | 7th: S+1 and AP2 on the charge, else S User AP3; 10th: D2 | Impact (SM), AP 3, D 2 |
| Haywire Cannon | 7th: 24" S4 AP4 Heavy 1 Blast, Haywire | Blast, Shock (Stunned), Armourbane |
| Prismatic Cannon | 7th: Dispersed (S3 large blast), Focussed (S5 AP3 blast), Lance (S7 AP2) | three modes, RS 4/6/8 |
| Shuriken weapons | Bladestorm: a 6 to wound is AP2 | Breaching (6+) |
| Holo-suit | 2nd: -1 to hit and -1 WS in combat; 7th: 5++; 8th on: 4++ | 4++, with Dodge (3+) for the 2nd edition close-combat penalty |
| Flip Belt | 7th: ignores difficult terrain when moving and charging | Move Through Cover, moves over models and terrain |
| Holo-fields | 2nd: -1 to hit while moving; 7th: 5++ unless immobilised; 8th: 4++ | 5++, 4++ after a fast move |
| Solitaire | 7th: Impossible Form 3++, Blitz (Xd6" over everything, Attacks 10), Path of Damnation; 2nd: immune to psychology | 3+ invulnerable, Blitz as in 7th, ignores Fear |
| Death Jester | 7th: Death is Not Enough (Morale at -2 after a casualty); 10th: Cruel Amusement | both |

The relics are the 7th edition Enigmas of the Black Library: Cegorach's Rose (a Kiss with Shred, master-crafted), The
Storied Sword (S+1 AP3, master-crafted), Crescendo (a Quickfire shuriken pistol), The Laughing God's Eye (Adamantium
Will nearby, here +1 Willpower within 12"), The Mask of Secrets (Fearless, -2 Leadership nearby, here Fear (2)) and
Starmist Raiment (3++ after running). "Master-crafted" is Duellist's Edge (1).

Stats are scaled up from the older editions to put Harlequins on the Custodes power level the army is meant for; the
relative order holds (a 7th edition Player is WS5 I6 A2, a Troupe Master WS6 I7 A3, a Solitaire WS9 I10 A6).
