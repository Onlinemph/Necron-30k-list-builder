# Rangdan: design notes

The Rangda have never had rules, models or pictures, so this army list was written for the builder. It follows
`data/SCHEMA.md` and the Harlequin conventions (`data/harlequins/NOTES.md`), with every `page` set to `null`.

## What canon gives us

Not much, and it contradicts itself, because the Dark Angels purged most of the records. What survives:

- The Rangda are a xenos species out of the Halo Stars, first met at Advex-Mors. The Imperium fought three wars to
  wipe them out in the 840s–860s M30 (the Rangdan Xenocides), among the costliest campaigns of the Great Crusade,
  mostly fought by the Dark Angels and Space Wolves. One account has 50,000 Dark Angels dying against a single
  invasion; the Third Xenocide burned every Rangdan-tainted world, Imperial ones included.
- They were tall and lithe, "towering and monstrous", and vaguely vulpine, with some kind of mimicry no source explains.
- They carried Shadow Blasters (electromagnetic radioactive blasts that disintegrate their targets), their officers
  had personal shield fields, their warships looked like iron jellyfish trailing spines and metal tentacles, and they
  built war-moons crewed by millions of slaves held by neural collars.
- *Betrayal* (p.99) and a plate in Book 1 place the Slaugth at Rangda during the wars, without saying why.

Sources were read from search summaries of Lexicanum, the 40k fandom wiki, warhammer40k.wiki.gg, 1d6chan and a
Bolter & Chainsword thread, not the books, so treat the details as fan-wiki level.

## The army

Three halves that play differently:

- **The Rangda** are few and terrifying: 70–90 points a model, Fear (2), and **Prey Instinct** (+1 to Wound Tests,
  shooting and melee, against a unit with any Tactical Status). Only their officers have shroud-fields (a 4+
  invulnerable save); the rank and file have a 5+.
- **The Thralls** are captured Imperial Army and Solar Auxilia, with their own HH3 wargear (lasrifles, battlecannons,
  bayonets) and **Neural Collars**: they automatically pass Leadership and Cool Checks within 12" of a Rangda, and
  fall to LD 5 with no Reactions outside it. Rangdan characters can **Overload** a collared unit once a turn
  (Collar-master): +1 Strength and Attacks for a Fight Sub-Phase, then D3 wounds with no saves.
- **The Slaugth** follow the hunt and eat the dead. **Worm Gestalt** gives Feel No Pain (5+) that fire ignores (the
  Flame Trait or Aflame), **Carrion Feast** gives back a wound for each enemy model killed in melee, and their
  weapons carry Phage (T), which softens a unit for the Rangda to finish.

The loop: thrall battlecannons and Vassal spines pin, Iron Medusa shadow cannons suppress, Mimics panic, Fear (2)
makes every one of those checks harder to pass, and Prey Instinct turns each marker into easier wounds.

Every rule is a modifier, a status or a standard HH3 rule. There are no re-rolls, and nothing the opponent has to
remember that isn't on the table (an adaptive "learned hatred" draft was cut for that reason).

### Force organisation

Every Troops unit is a Thrall, so the Crusade Primary Detachment's Troops slots go to the herd and the Rangda come
in through Command slots and Auxiliary Detachments:

| Detachment | Type | Slots | Takes |
| --- | --- | --- | --- |
| The Hunt | Auxiliary | 2 Elites, Recon, Support | Rangda |
| The Herd | Auxiliary | 3 Troops, Heavy Assault, Armour | Thralls |
| Medusa Shoal | Auxiliary | 2 Fast Attack, 2 Armour | Rangda |
| The Carrion Court | Auxiliary, needs a Slaugth Dream-Eater in a Command slot | 2 Elites, Fast Attack, War Engine | Slaugth |
| The Sovereign's Hunt | Apex | Elites (Prime), 2 Elites, Recon | Rangda |

Prime Advantages: Apex Predators (Rangda infantry, Fear +1), Collared Legion (Thrall Troops, Line (1) and an 18"
collar), Sated Gestalt (Slaugth with Carrion Feast regain two wounds).

### Units

| Unit | Role | Points | Notes |
| --- | --- | --- | --- |
| Hunt-Sovereign | High Command | 260 | Paragon, WS 7, W6 T6, Sovereign's Glaive, one War-moon Strike a battle |
| Rangda Huntmaster | Command | 155 | WS 6, spine glaive, shroud-field |
| Collar-Wright | Command | 135 | WS 6; Overloads twice a turn; 18" collar range |
| Hunt-Pack | Elites | 70 a model | M9 WS5 S5 T5 W4 I6 A4, 3+/5++, spine glaive (AP 3, D 2, Breaching 5+) |
| Shadow Lancers | Support | 85 a model | Shadow lances (S9 AP2 D2 Armourbane) |
| Mimics | Recon | 70 a model | Infiltrate (9); Stolen Voices gives their shooting Panic (1) |
| Tendril Skiffs | Fast Attack | 85 each | Small jellyfish skimmers |
| Iron Medusa | Armour | 160 | Shadow cannon (Blast, Deflagrate, Suppressive) |
| Spine-Leviathan | Lord of War | 620 | Super-heavy skimmer |
| Thrall Cohort | Troops | 120 for 20, +6 | Imperial Army, Expendable (2) |
| Collared Auxilia | Troops | 55 for 10, +5 | Solar Auxilia in void armour |
| Collared Ogryns | Heavy Assault | 95 for 3, +30 | The obvious thing to Overload |
| Thrall Armour | Armour | 130 | A captured Leman Russ, priced like the Militia one |
| Slaugth Dream-Eater | Command | 135 | Unlocks the Carrion Court; heals fully on killing a character in a Challenge |
| Slaugth Kindred | Elites | 45 a model | W3 T5 4+ with Feel No Pain (5+) |
| Vassal Swarm | Fast Attack | 15 a model | Floating constructs whose spines pin |
| Harvester | War Engine | 200 | Walker that heals by eating infantry |

## Calibration

Measured with the balance sim (`scripts/balance-sim.cjs`, extended for Deflagrate, Worm Gestalt and Prey Instinct)
as value per 100 points against the Legio Custodes medians, the same yardstick as the Harlequins:

| Unit | Points | Value | Benchmark |
| --- | --- | --- | --- |
| Hunt-Pack | 210 | 5.04 (5.63 with blasters); about 4.8 counting WS 5+ enemies | Custodian Guard 6.60, Legion Veterans 4.74, Echoes 4.93 |
| Shadow Lancers | 255 | 4.92 | anti-tank 1.29 per 100 pts vs Predator 1.50, Venatari 1.16 |
| Mimics | 210 | 4.48 | Venatari 5.83 |
| Hunt-Sovereign | 260 | 4.22 | Tribune 3.04; the sim fires the one-shot War-moon Strike every turn, so this reads high |
| Thrall Cohort | 120 | 4.46 | Levy Troop 4.87 |
| Collared Auxilia | 55 | 7.98 | Lasrifle Section 8.68 |
| Thrall Armour | 130 | 8.19 | Militia Leman Russ 8.19 |
| Iron Medusa | 160 | 6.69 | Leman Russ Strike 7.48; the 5+ invulnerable against shooting isn't measured |
| Spine-Leviathan | 620 | 2.77 | Fellblade 2.60, same caveat |
| Slaugth Kindred | 135 | 3.42 | Sons of Horus median 3.52; Phage and Carrion Feast aren't measured |
| Harvester | 200 | 4.02 | Contemptor 3.44 |

Weapon Skill runs 5 in the ranks, 6 for Command characters and 7 for the Hunt-Sovereign. The sim's yardsticks are all WS 4,
which WS 5 and WS 6 both hit on 3+, so the change from WS 6 shows only against WS 5+ enemies (Custodes, characters),
where a WS 5 Rangda hits on 4+ instead of 3+. Counting a third of melee targets as WS 5+, that costs a Hunt-Pack about
4% of its value (75 to 70 a model, since half its value is melee) and Shadow Lancers and Mimics about 1%, too little to
move them off 85 and 70. The Huntmaster (WS 7 to 6) dropped 5 points and the Collar-Wright (WS 5 to 6) gained 5.

Prey Instinct adds about 0.3–0.5 when it applies. Before it, a Hunt-Pack kills about five Legionaries a round in
combat and takes 24 power-axe attacks per model to kill. A Tactical Squad does about half a wound back to it each
round, so three Rangda wipe a ten-man squad in two rounds.
