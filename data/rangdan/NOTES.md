# Rangdan: design notes

The Rangda have never had rules, models or pictures, so this army list was written for the builder. It follows
`data/SCHEMA.md` and the Harlequin conventions (`data/harlequins/NOTES.md`), with every `page` set to `null`.

## What canon gives us

Not much, and it contradicts itself, because the Dark Angels purged most of the records. What survives:

- The Rangda are a xenos species out of the Halo Stars, first met at Advex-Mors. The Imperium fought three wars to
  wipe them out in the 840s–860s M30 (the Rangdan Xenocides), among the costliest campaigns of the Great Crusade,
  mostly fought by the Dark Angels and Space Wolves. One account has 50,000 Dark Angels dying against a single
  invasion; the Third Xenocide burned every Rangdan-tainted world, Imperial ones included. The records were sealed on
  the Sigillite's order, and the Dark Angels kept a small Order of Broken Claws watching for their return.
- They were tall and lithe, "towering and monstrous", and vaguely vulpine, with some kind of mimicry no source explains.
- They carried Shadow Blasters (electromagnetic radioactive blasts that disintegrate their targets), their officers
  had personal shield fields, their warships looked like iron jellyfish trailing spines and metal tentacles, and they
  built war-moons crewed by millions of slaves held by neural collars.
- *Betrayal* (p.99) and a plate in Book 1 place the Slaugth at Rangda during the wars, without saying why.

Sources were read from search summaries of Lexicanum, the 40k fandom wiki, warhammer40k.wiki.gg, 1d6chan and a
Bolter & Chainsword thread, not the books, so treat the details as fan-wiki level.

## Why the Rangda are sealed (our invention)

Canon never says what the "taint" was. This list's answer:

- **The taint is the collar.** The collared are not dead and not free; they are still in there, and a Rangda can
  speak with any of their voices. With mimicry, a world could fall without a shot, and nobody could tell which
  neighbour, officer or vox channel was still theirs. The only cure was fire, which is why the Third Xenocide burned
  Imperial worlds.
- **The secret is that it worked on Astartes.** Some of the Dark Angels lost against the Rangda were not killed but
  collared and sent back against their brothers. In 30k Chaos is still a rumour the Imperial Truth denies; the
  Rangda were proof that the Emperor's Angels can be owned by xenos. That is what the Sigillite sealed, what the
  Order of Broken Claws watches for, and what the Lion does not talk about.

The rules try to make an opponent feel that: the Hunting Cry pins whole squads in the voices of their own dead,
losing a unit to the Rangda in combat can rout its neighbours, and The Broken put collared Legionaries on the table.

## The army

Three halves that play differently:

- **The Rangda** are few and terrifying: 70–95 points a model, Fear (1) in the squads and Fear (2) on their officers,
  **Prey Instinct** (+1 to Wound Tests,
  shooting and melee, against a unit with any Tactical Status), the **Horror of the Taken** (when they destroy a unit
  in combat, every enemy unit within 6" takes a Leadership Check or is Routed) and a **Hunting Cry** each: R12, FP 2,
  S 3, AP –, D 1, Assault, Pinning (2). Pinning triggers on any wound, saved or not, and with a squad's Fear (1) at
  that range a Legion squad passes its Cool Check on 4 or less. A unit either kills or screams, never both in one Shooting Attack.
  Only officers and the Hunt-Court have shroud-fields (a 4+ invulnerable save); the rank and file have a 5+.
- **The Thralls** are captured Imperial Army, Solar Auxilia, Ogryns, armour, a Basilisk, a Questoris Knight and The
  Broken, with their own HH3 wargear and **Neural Collars**: they automatically pass Leadership and Cool Checks within
  12" of a Rangda, and fall to LD 5 with no Reactions outside it. Rangdan characters can **Overload** a collared unit
  once a turn (Collar-master): +1 Strength and Attacks for a Fight Sub-Phase, then D3 wounds with no saves.
- **The Slaugth** follow the hunt and eat the dead. **Worm Gestalt** gives Feel No Pain (5+) that fire ignores (the
  Flame Trait or Aflame), **Carrion Feast** gives back a wound for each enemy model killed in melee, and their
  weapons carry Phage (T), which softens a unit for the Rangda to finish.

The loop: Hunting Cries and thrall battlecannons pin, shadow cannons suppress, Mimics panic, Fear makes every one of
those checks harder to pass, Prey Instinct turns each marker into easier wounds, and each squad the Rangda wipe out in
combat can rout the units around it.

Every rule is a modifier, a status or a standard HH3 rule. There are no re-rolls, and nothing the opponent has to
remember that isn't on the table (an adaptive "learned hatred" draft and a "mark your prey" army rule were cut for
that reason; the Hunting Cry replaced the second as a weapon).

### Army rules

| Rule | Kind |
| --- | --- |
| Prey Instinct, Horror of the Taken | Rangda Tactica |
| Neural Collars, Collar-master | Thralls and Rangdan characters |
| Worm Gestalt, Carrion Feast | Slaugth |
| Living Shields (a thrall unit within 3" takes the shots), The Hunt Closes (move up to M toward a unit with a status that ends a move within 12") | Advanced Reactions |
| Hunter's Stare (Cool Check or the Rangda gets +2 to the Focus Roll), Feast of Memories (a Slaugth that kills in a Challenge heals and steals a Special Rule) | Gambits |
| Additional Reaction Point with a Rangda in the Primary Detachment's High Command or Warlord slot | Army list |

### War-moons

Rangda and Thrall units pick the war-moon they serve, like a Harlequin Masque; the Slaugth have none, and named
characters are locked to theirs. Auxiliary and Apex Detachments share one war-moon.

| War-moon | Tactica (benefit / cost) | Extra | Auxiliary Detachment (needs a Command model of the moon) |
| --- | --- | --- | --- |
| Silent Choir | Rangda Fear +1 (squads to Fear (2), officers to Fear (3)) / Rangda BS -1 | Reaction: The Choir Answers (a charging unit tests Cool or is Pinned and its charge fails) | The Choir's Hunt: 2 Elites, 2 Recon |
| Iron Chain | Thrall collars reach 18"; Overloaded units also get +1 WS / Overload costs D3+1 wounds | Prime Advantage: Collar-bombs (detonate a Prime Thrall infantry unit: D6 S6 AP4 hits on every enemy unit within 3") | The Chained Host: 3 Troops, 2 Heavy Assault, Support |
| Long Hunt | Rangda infantry Fast (2) / must charge a visible enemy within 12" if able | Gambit: Throat-Hunter (Breaching (4+), +1 Focus against a target with a status) | The Running Pack: 2 Elites, 2 Fast Attack, Transport |
| Burning Sky | Shadow weapons +6" range; War-moon Strikes scatter half / Rangda Initiative -1 | Reaction: Moonfall (once per battle, an orbital strike on a unit arriving from Reserves within 18") | The Sky-Burners: 2 Support, 2 Armour, Fast Attack |

### Force organisation

Every Troops unit is a Thrall, so the Crusade Primary Detachment's Troops slots go to the herd and the Rangda come
in through Command slots and Auxiliary Detachments:

| Detachment | Type | Slots | Takes |
| --- | --- | --- | --- |
| The Hunt | Auxiliary | 2 Elites, Recon, Support, Transport | Rangda |
| The Herd | Auxiliary | 3 Troops, Heavy Assault, Support, Armour, Transport | Thralls |
| Medusa Shoal | Auxiliary | 2 Fast Attack, 2 Armour | Rangda |
| The Carrion Court | Auxiliary, needs a Dream-Eater or the Hollow Choir in a Command slot | 2 Elites, Fast Attack, War Engine, Transport | Slaugth |
| The Sovereign's Hunt | Apex | Elites (Prime), 2 Elites, Recon | Rangda |
| The Collared Host | Apex | Troops (Prime), Troops, Armour | Thralls |
| Shoal of Iron | Apex | Armour (Prime), Armour, Fast Attack | Rangda |
| The Great Feast | Apex, needs a Dream-Eater or the Hollow Choir in a Command slot | Elites (Prime), Elites, War Engine | Slaugth |
| Four war-moon Auxiliaries | Auxiliary | see above | that moon |

The core Warlord Detachment fills with a War-moon Regent, a Hunt-Court and a Brood-ship.

Prime Advantages: Apex Predators (Rangda infantry, Fear +1), Collared Legion (Thrall Troops, Line (1) and an 18"
collar), Sated Gestalt (Slaugth with Carrion Feast regain two wounds), Collar-bombs (Iron Chain).

There is no Fortification: no army in the data has one and no HH3 chart has a slot for it.

### Units

| Unit | Role | Points | Notes |
| --- | --- | --- | --- |
| War-moon Regent | Warlord | 475 | 0-1. Paragon, WS 8, W8 T6, Eternal Warrior (1), Fear (3); fires a War-moon Barrage every turn |
| Ithrakk, the First Voice | High Command | 295 | Unique, Silent Choir. His Hunting Cry reaches 18" with Pinning (3) |
| Hunt-Sovereign | High Command | 265 | Paragon, WS 7, W6 T6, Sovereign's Glaive, one War-moon Strike a battle |
| Rangda Huntmaster | Command | 160 | WS 6, spine glaive, shroud-field |
| Collar-Wright | Command | 140 | WS 6; Overloads twice a turn; 18" collar range |
| Hunt-Court | Retinue | 95 a model | Court Hunters with shroud-fields and blasters; +1 A while a Sovereign, Regent or Ithrakk leads them |
| Hunt-Pack | Elites | 75 a model | M9 WS5 S5 T5 W4 I6 A4, 3+/5++, spine glaive (AP 3, D 2, Breaching 5+) |
| Shadow Lancers | Support | 85 a model | Shadow lances (S9 AP2 D2 Armourbane) |
| Mimics | Recon | 70 a model | Infiltrate (9); Stolen Voices gives their shooting Panic (1) |
| Tendril Skiffs | Fast Attack | 85 each | Small jellyfish skimmers |
| Shadow Kite | Fast Attack | 105 | Flyer with two shadow lances |
| Iron Medusa | Armour | 160 | Shadow cannon (Blast, Deflagrate, Suppressive) |
| Tendril Barge | Transport | 85 | Capacity 12 (four Rangda), Assault Vehicle |
| Brood-ship | Heavy Transport | 160 | Capacity 20 (six Rangda or a herd), Assault Vehicle |
| Spine-Leviathan | Lord of War | 620 | Super-heavy skimmer |
| Thrall Cohort | Troops | 60 for 20, +3 | Imperial Army, Expendable (2); cheap bodies, the millions of slaves the canon describes |
| Collared Auxilia | Troops | 55 for 10, +5 | Solar Auxilia in void armour |
| The Broken | Troops | 90 for 10, +9 | 0-1. Collared Legionaries: Heedless, and enemy infantry fighting them gain Hatred (Thrall) |
| Marshal Casimir Vehl | Command | 85 | Unique, Iron Chain. Collared units within 12" of him count as near a Rangda; once a battle two Thrall units' shooting gains Pinning (1) |
| Collared Ogryns | Heavy Assault | 95 for 3, +30 | The obvious thing to Overload |
| Thrall Gun-teams | Support | 20 a team | Two gunners a model, heavy bolters or a Gun-team Weapon |
| Thrall Basilisk | Support | 115 | A captured Basilisk |
| Thrall Armour | Armour | 130 | A captured Leman Russ, priced like the Militia one |
| Thrall Carrier | Transport | 50 | A captured Aurox; Light Transport, so no Ogryns |
| Thrall Knight | Lord of War | 400 | A Questoris with a collared pilot; thermal cannon +15 |
| Slaugth Dream-Eater | Command | 135 | Unlocks the Carrion Court; heals fully on killing a character in a Challenge |
| The Hollow Choir | Command | 180 | Unique. Heals on any character kill; once a battle names an enemy Advanced Reaction that can't be used that turn |
| Slaugth Kindred | Elites | 45 a model | W3 T5 4+ with Feel No Pain (5+) |
| Vassal Swarm | Fast Attack | 15 a model | Floating constructs whose spines pin |
| Harvester | War Engine | 200 | Walker that heals by eating infantry |
| Charnel Barge | Transport | 65 | Capacity 8 (four Kindred); regains a Hull Point on a 5+ each turn |

### Wargear

| Who | Options |
| --- | --- |
| Every Rangda on foot | A Hunting Cry as well as their weapons |
| Hunt-Pack | Rangdan Sidearms (Shadow Pistol, Shadow Blaster +10); Flensing Hooks (A+1, AP 3, D 1) for any model; one Severing Maul (S+3, AP 2, D 2, I-2) per three, +20; a Pack-Alpha (A5, shroud-field) +15 |
| Huntmaster, Collar-Wright | Sidearms; the Huntmaster also takes Hunting Weapons or a Severing Maul; the Fang of the First Xenocide +25; one Relic of the Hunt |
| Hunt-Sovereign | The Fang +20; one Relic of the Hunt |
| Relics of the Hunt (once per army) | Skin-thief Cloak (Shrouded 5+) 15, Dread-mask (Fear +1) 10, War-moon Beacon (a War-moon Strike, or a second one for the Hunt-Sovereign) 25, Collar-key of Advex-Mors (18" Overload that costs D3-1 wounds) 10 |
| Shadow Lancers | Shadow Caster (R30 FP2 S6 AP3 Blast 3", Suppressive) in place of the lance |
| Tendril Skiffs, Iron Medusa, Spine-Leviathan | Shadow lances or lance arrays in place of blasters and cannons |
| Thrall Cohort | One Captured Heavy Weapon per ten (heavy stubber, heavy bolter 5, missile launcher 10, lascannon 15, autocannon 20) |
| Thrall Gun-teams | Heavy bolter or heavy stubber, missile launcher +5, lascannon +10, autocannon +15 |
| Collared Auxilia | One Captured Special Weapon per ten (flamer, volkite charger 5, meltagun 15) |
| Thrall Armour | Demolisher or Executioner turret, hull lascannon or heavy flamer, sponson heavy bolters or lascannons, pintle stubber, hunter-killer |
| Slaugth | Necrotic Spewers for the Dream-Eater (+10), one Kindred in three (+10) and the Harvester (+15); one Nerve-lash per three Kindred; Corpse-cloak (Shrouded 5+) for the Dream-Eater |

Every captured Imperial weapon is copied from BSData's HH3 profile when the data is generated, so it can't drift.
Option prices come from the sim: a Severing Maul is worth about 25 points a model before counting its Initiative
penalty and its melee anti-tank, which the yardstick overweights, hence +20 and one per three.

## Calibration

Measured with the balance sim (`scripts/balance-sim.cjs`, extended for Deflagrate, Worm Gestalt and Prey Instinct)
as value per 100 points against the Legio Custodes medians, the same yardstick as the Harlequins. Two changes to the
sim for this army: the melee hit chart follows HH3 (2+ against half your WS or less, 3+ against lower, 4+ equal, 5+
against higher, 6+ against double or more; the stock sim gives 4+ to any lower WS short of double), and it adds a WS 5
elite target and a WS 5 power-axe attacker, so Weapon Skill above 4 shows up in the numbers. The sim can't see
statuses, so the Hunting Cry, Horror of the Taken and the war-moons are priced by judgement: about 5 points a Rangda.

| Unit | Points | Value | Benchmark |
| --- | --- | --- | --- |
| War-moon Regent | 475 | 5.63 | Horus Lupercal 5.83 at 530, Constantin Valdor 4.31 at 400 |
| Hunt-Sovereign | 265 | 5.82 | Tribune 4.73; the sim fires the one-shot War-moon Strike every turn, so this reads high |
| Ithrakk | 295 | 5.01 | The same body as the Sovereign at Silent Choir BS, plus the First Voice |
| Hunt-Court | 285 | 7.24 | Hunt-Pack 6.84; Sworn to the Hunt isn't measured |
| Hunt-Pack | 225 | 6.84 (7.16 with blasters) | Custodian Guard 8.73, Aquilon 7.99, Legion Veterans 5.70 |
| Shadow Lancers | 255 | 5.80 | anti-tank about 1.3 per 100 pts vs Predator 1.55, Venatari 1.17 |
| Mimics | 210 | 5.31 | Venatari 6.25 |
| Rangda Huntmaster | 160 | 4.87 | Shield Captain 4.02 |
| Collar-Wright | 140 | 3.89 | Shield Captain 4.02 |
| The Broken | 90 | 9.12 | Tactical Squad 8.32 at 100; Heedless and the lost Line (2) aren't measured |
| Thrall Cohort | 60 | 9.56 | Collared Auxilia 9.18 (an Auxiliary is worth about 1.75 Thralls: a 4+ save holds against bolters, a 5+ doesn't), Lasrifle Section 9.91, Levy Troop 4.67 |
| Collared Auxilia | 55 | 9.18 | Lasrifle Section 9.91 |
| Thrall Basilisk | 115 | 11.77 | Basilisk 11.26 at 120 |
| Thrall Armour | 130 | 11.19 | Militia Leman Russ 11.16 |
| Thrall Knight | 400 | 6.00 | priced like a Questoris Paladin (410) less the collars |
| Iron Medusa | 160 | 9.12 | Leman Russ Strike 10.26; the 5+ invulnerable against shooting isn't measured |
| Brood-ship | 160 | 9.20 | Dracosan 11.14 at 140; Assault Vehicle and the shroud aren't measured |
| Spine-Leviathan | 620 | 3.42 | Fellblade 3.22, same caveat |
| Shadow Kite | 105 | 6.97 | Xiphon 8.49; the 5+ invulnerable against shooting isn't measured |
| Tendril Barge | 85 | 7.35 | Rhino 9.51; Assault Vehicle and the shroud aren't measured |
| Thrall Carrier | 50 | 10.19 | Aurox 9.56 |
| Slaugth Kindred | 135 | 3.98 | Sons of Horus median 4.60; Phage and Carrion Feast aren't measured |
| The Hollow Choir | 180 | 3.25 | Dream-Eater 3.20 at 135; Stolen Memories isn't measured |
| Harvester | 200 | 5.01 | Contemptor 4.06 |
| Charnel Barge | 65 | 9.19 | Rhino 9.51 |

The army's median is 6.00 against 5.84 for Custodes, 4.60 for the Sons of Horus and 5.51 for the Solar Auxilia.

Weapon Skill runs 5 in the ranks, 6 for Command characters, 7 for High Command and 8 for the Regent. Against WS 4
Legionaries, WS 5 and WS 6 make no difference: either hits on 3+ and is hit on 5+. Against WS 5 elites and
characters, a WS 5 Rangda hits on 4+ instead of 3+ and is hit on 4+ instead of 5+, which cost a Hunt-Pack about 10%
of its value when the ranks dropped from WS 6.

Prey Instinct adds about 0.3–0.5 when it applies. Before it, a Hunt-Pack kills about five Legionaries a round in
combat and takes 36 power-axe attacks per model to kill. A Tactical Squad hits it on 5+ and does about a third of a
wound back each round, so three Rangda wipe a ten-man squad in two rounds, and the Horror of the Taken then tests
every squad within 6".

### The terror check

Fear (2) on every squad plus the Hunting Cry's Pinning (2) was tested against real HH3 Cool and Leadership values
(statuses as described in reviews of the core book: a Pinned unit can't Move or Charge, a unit with any status can't
score objectives and fights at Initiative 1, and each status is tested off with Cool at the end of the unit's own turn,
with Fear applying). With Fear (2) a Tactical Squad hit by one 3-Rangda Cry was Pinned 71% of the time, shook it off
only 28% of the time each turn (about three and a half turns pinned), and the Horror of the Taken routed 72% of Legion
squads within 12"; Militia never recovered. Pinning only modifies the first test, so lowering it to (1) only moved the
first number to 65%. Fear modifies the first test, the recovery test and the rout test, so it was the lever.

Now squads have Fear (1) and the Horror reaches 6". Against a Tactical Squad: Pinned 65% of the time by one Cry,
recovering 42% of the time each turn, and only units within 6" test for rout, at 58%. Custodian Guard are Pinned
21% of the time and recover 83%. A squad led by an officer still projects Fear (2), so the strongest version of the
loop needs a character.

In melee, statuses barely matter: a 3-Rangda Hunt-Pack wipes a Tactical or Assault Squad in about two rounds either
way without losing a model, beats Cataphractii with fists 69% of the time (80% when they're Pinned), and loses to
six Custodian Guard three times in four.
