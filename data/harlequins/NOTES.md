# Harlequins: design notes

There is no fan codex for Harlequins, so this army list was written for the builder rather than transcribed. It follows
`data/SCHEMA.md` and the Drukhari and Ork conventions (`data/drukhari/NOTES.md`, `data/orks/NOTES.md`), with every
`page` set to `null` because there is no book to cite.

## How it follows Horus Heresy 3rd edition

An HH3 faction is a trait, a Tactica, Advanced Reactions, Gambits, Prime Advantages and detachments, and its Legions
differ through those rather than through statlines alone. Rules come with a cost attached (Only in Death, Vanguard,
Heedless). The Harlequins get the same set:

- **Traits**: Xenos (replaces Allegiance, as in the other fan codexes), Harlequin, [Masque], Masque Leader, Jink, Psyker.
- **Tactica, The Great Dance**: Rising Crescendo (charge after a Rush, the Harlequin army rule from 7th to 9th edition),
  and Disengage from any combat. The cost: a Harlequin unit that loses a combat must leave it.
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
  (`sameInDetachment`, as for Ork clans); the Solitaire has no Masque and is ignored.
- **Wargear lists** with once-per-army relics (the Enigmas of the Black Library), like the Haemonculus Arcana.
- **Every Force Organisation role a Harlequin army plausibly fills**, filled with invented-but-plausible units where the
  40k range has none, as the Drukhari codex does with the Rampage, Demilune or Raven Lord: the Webweaver, Prismweaver,
  Dreamweaver, Masque Court, Troupe Master on Skyweaver and Mimes (a Rogue Trader-era role) are written for this list.
  So are Vaelith Duskmirror and the rules for Sylandri Veilwalker.

## Individually as strong as Custodes, in their own way

Harlequins are priced so a model is worth about what a Custodian is, but they get there differently. Custodes are T5,
2+ armour and Eternal Warrior; Harlequins are T3 with a 6+ armour save, and rely on a 4+ invulnerable holo-suit,
Dodge (3+) in combat and against Reactions, Initiative 7 to 10 so they strike first, M8 with flip belts and Rising
Crescendo, and the Shadow Dance and Veil of Tears to avoid being shot at all.

Checked with `scripts/balance-sim.cjs --rank` against Legio Custodes (extended in a scratch copy to model Dodge and
Phase Field). Value per 100 points, summed over shooting and melee against Legionaries, Terminators and a Predator, and
durability against bolters, lascannons and power axes:

| Unit | Points | Value / 100 pts | Notes |
| --- | --- | --- | --- |
| Custodian Guard (6) | 270 | 6.26 | |
| Harlequin Troupe (5), Caresses | 215 | 6.06 | melee about equal per point; per point, a sixth as tough against bolters and 1.7 times as tough against lascannons |
| Harlequin Troupe (5), blades | 190 | 4.07 | the cheap loadout; struggles against 3+ armour |
| Constantin Valdor | 400 | 2.93 | |
| Vaelith Duskmirror | 375 | 2.88 | |
| Tribune | 250 | 3.10 | |
| Solitaire | 190 | 3.66 | before Blitz |

The sim can't see speed, Reactions, Rising Crescendo, Veil of Tears or Fear, which are where Harlequins earn the rest.

## Weapons and where they come from

The weapons follow the real Harlequin wargear, converted to HH3 terms:

- **Harlequin's Blade**: the basic sword, many attacks and little AP (9th edition: like a chainsword; 10th: AP-1 with
  Devastating Wounds), so AP 4 with Breaching (6+).
- **Harlequin's Kiss**: a tube on the forearm whose monofilament wire uncoils inside the victim. Rending in 4th edition,
  an instant-death Kiss of Death attack in 7th, D3 or D2 damage in 8th and 9th: here S+1, AP 3, D 2, Rending (6+) and
  Murderous (6+).
- **Harlequin's Caress**: a wrist-mounted phase field that lets the hand pass through armour (9th edition's Oblivion's
  Caress ignores invulnerable saves): S+2, AP 2, Phase Field (6+), a rule written like the Necron Æon Breach (X).
- **Harlequin's Embrace**: throws a cloud of monofilament wire as the wearer charges (8th edition AP-3, 9th edition
  mortal wounds on the charge): S+1, AP 3, Impact (AM), Rending (6+).
- **Shuriken Pistol** (AP 5, Breaching (6+), for bladestorm), **Neuro Disruptor** (a psycho-crystalline pistol that
  shuts down the nervous system: Poisoned (3+), Pinning), **Fusion Pistol** (a short-ranged meltagun).
- **Shrieker Cannon**: a single bio-toxin round that makes the victim burst (Deflagrate), or a shuriken burst. The Death
  Jester keeps Death is Not Enough (7th edition: Leadership at -2 after a casualty) and Cruel Amusement (10th edition).
- **Hallucinogen Grenade Launcher** (Panic), **Miststave** (Force), **Star Bolas** and **Zephyrglaive** (Skyweavers),
  **Prismatic Cannon** with the 10th-edition dispersed pulse and focused lances, **Haywire Cannon**.
- **Holo-suit** 4+ invulnerable (8th edition on), **Flip Belt**, **Domino Field** (a finer holo-field), **Holo-field**
  invulnerable save for vehicles (8th edition gave the Voidweaver a 4+), **Mirage Launchers**.

Research sources: the Warhammer Community article on the 2022 Kiss, Caress and Embrace rework, the Wahapedia 8th and
10th edition Harlequin datasheets, 7th edition codex reviews (From The Fang, 2015), and the Warhammer 40k fandom wiki
pages for the Kiss and Caress. Profiles were read through search results, so treat edition details as a guide, not a
transcription.
