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
  **Prey Instinct** (shooting and melee against a unit with Tactical Statuses gain Critical Hit (6+) for one status,
  (5+) for two and (4+) for three or more), the **Horror of the Taken** (when they destroy a unit
  in combat, every enemy unit within 6" takes a Leadership Check or is Routed) and a **Hunting Cry** each: R12, FP 2,
  S 3, AP –, D 1, Assault, Pinning (2). Pinning triggers on any wound, saved or not, and with a squad's Fear (1) at
  that range a Legion squad passes its Cool Check on 4 or less. A unit either kills or screams, never both in one Shooting Attack.
  Only officers and the Hunt-Court have shroud-fields (a 4+ invulnerable save); the rank and file have a 5+.
- **The Thralls** are captured Imperial Army, Solar Auxilia, Ogryns, armour, a Basilisk, a Questoris Knight and the
  Broken Legion (below), with their own HH3 wargear and **Neural Collars**: they automatically pass Leadership and Cool Checks within
  12" of a Rangda, and fall to LD 5 with no Reactions outside it. Rangdan characters can **Overload** a collared unit
  once a turn (Collar-master): +1 Strength and Attacks for a Fight Sub-Phase, then D3 wounds with no saves.
- **The Slaugth** follow the hunt and eat the dead. **Worm Gestalt** gives Feel No Pain (5+) that fire ignores (the
  Flame Trait or Aflame), **Carrion Feast** gives back a wound for each enemy model killed in melee, and their
  weapons carry Phage (T), which softens a unit for the Rangda to finish.

### The Broken Legion

The Broken are collared Legionaries, and they're why the Xenocide records are sealed. They were one 0-1 squad; now
they're a captured Legion company with its own detachment:

| Unit | Role | Points | Legion original |
| --- | --- | --- | --- |
| Broken Centurion | Command | 85 | Centurion with a power sword (90). The Old Command: Broken units within 12" of him count as near a Rangda for their collars. Unlocks the Broken Legion |
| The Broken | Troops | 95 for 10, +9 | Tactical Squad (100). Line (1), not the Legion's Line (2); a captured special weapon per ten, one power weapon |
| Broken Assault Squad | Troops | 125 for 10, +11 | Assault Squad (140). Jump packs, Deep Strike, Vanguard (2) |
| Broken Heavy Support Squad | Support | 90 for 5, +18 | Heavy Support Squad (100). The whole squad swaps its heavy bolters, paying per model as the Legion does |
| Broken Terminators | Heavy Assault | 200 for 5, +40 | Cataphractii with combi-bolters and power fists (225). Vanguard (3) |
| Collared Contemptor | War Engine | 155 | Contemptor with a kheres assault cannon and a gravis power fist (170) |
| Broken Rhino | Transport | 55 | Rhino (60). Light Transport |
| Broken Veterans | Elites | 75 for 5, +13 | Veteran Tactical Squad (85). Line (1); any model takes a special weapon or heavy bolter |
| Broken Predator | Armour | 90 | Predator with heavy bolter sponsons (100). Twin lascannon, flamestorm or executioner turret; lascannon sponsons +20 |
| Broken Land Raider | Heavy Transport | 240 | Land Raider Carrier (265). Not a Light Transport, so it carries Broken Terminators |

Every statline is copied from BSData's Legion unit (Blackshields, so no Legion-specific changes) when the data is
generated, and a test checks they still match. The Broken keep their Legion unit rules (Line, Vanguard, Bulky,
Deep Strike) but not Legion-wide ones (the Legion Tactica, Fury of the Legion, Officer of the Line), and they gain
Neural Collars and **Still in There**: enemy infantry fighting them gain Hatred (Thrall), because they know their
brothers' names. Each costs the Legion price for the same loadout less about 10%. The sim puts them 5 to 18% above
their Legion originals per point, which pays for the Legion rules they lose, the Hatred they hand the enemy and a
collar that drops them to LD 5 with no Reactions away from a Rangda or their Centurion.

The Broken used to be Heedless, which means they couldn't hold or contest objectives at all. That was fine for one
0-1 squad, but it would make a whole Broken detachment a trap, so they hold ground with Line (1) like the herd.

| Detachment | Type | Slots | Takes |
| --- | --- | --- | --- |
| The Broken Legion | Auxiliary, needs a Broken Centurion in a Command slot | 2 Troops, Elites, Heavy Assault, Support, War Engine, Armour, Transport | Broken |

The Broken are Thralls too, so they also fill the Herd, the Collared Host and the Crusade chart's Troops slots, pick
a war-moon, and can take Collared Legion or Collar-bombs.

The loop: Hunting Cries and thrall battlecannons pin, shadow cannons suppress, Mimics panic, Fear makes every one of
those checks harder to pass, Prey Instinct turns each marker into more critical hits, and each squad the Rangda wipe out in
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
| Long Hunt | Rangda infantry Fast (2) / must charge a visible enemy within 12" if able | Gambit: Throat-Hunter (Breaching (4+), or Shred (6+) on a weapon already AP 2; +1 Focus against a target with a status) | The Running Pack: 2 Elites, 2 Fast Attack, Transport |
| Burning Sky | Shadow weapons +6" range; War-moon Strikes scatter half / Rangda Initiative -1 | Reaction: Moonfall (once per battle, an orbital strike on a unit arriving from Reserves within 18") | The Sky-Burners: 2 Support, 2 Armour, Fast Attack |

### Force organisation

Every Troops unit is a Thrall, so the Crusade Primary Detachment's Troops slots go to the herd and the Rangda come
in through Command slots and Auxiliary Detachments:

| Detachment | Type | Slots | Takes |
| --- | --- | --- | --- |
| The Hunt | Auxiliary | 2 Elites, Recon, Support, Transport | Rangda |
| The Herd | Auxiliary | 3 Troops, Heavy Assault, Support, Recon, Armour, Transport, Heavy Transport | Thralls |
| Medusa Shoal | Auxiliary | 2 Fast Attack, 2 Armour | Rangda |
| The Carrion Court | Auxiliary, needs a Dream-Eater or the Hollow Choir in a Command slot | 2 Elites, Fast Attack, War Engine, Transport | Slaugth |
| The Ossuary | Auxiliary, needs a Corpse-Shepherd in a Command slot | 2 Heavy Assault, Support, Recon, Transport | Slaugth |
| The Broken Legion | Auxiliary, needs a Broken Centurion in a Command slot | 2 Troops, Elites, Heavy Assault, Support, War Engine, Armour, Transport | Broken |
| The Sovereign's Hunt | Apex | Elites (Prime), 2 Elites, Recon | Rangda |
| The Collared Host | Apex | Troops (Prime), Troops, Armour | Thralls |
| Shoal of Iron | Apex | Armour (Prime), Armour, Fast Attack | Rangda |
| The Great Feast | Apex, needs a Dream-Eater or the Hollow Choir in a Command slot | Elites (Prime), Elites, War Engine | Slaugth |
| Four war-moon Auxiliaries | Auxiliary | see above | that moon |

The core Warlord Detachment fills with a War-moon Regent, a Hunt-Court and a Brood-ship.

Prime Advantages: Apex Predators (Rangda infantry, Fear +1), Collared Legion (Thrall Troops, Line +1 and an 18"
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
| Hunt-Court | Retinue | 300 for 3, +95 | Vanguard (3). Court Hunters with shroud-fields and blasters; +1 A while a Sovereign, Regent or Ithrakk leads them |
| Hunt-Pack | Elites | 240 for 3, +75 | 3–9 models, Vanguard (3). M9 WS5 S5 T5 W4 I6 A4, 3+/5++, spine glaive (AP 3, D 2, Breaching 5+) |
| Skyhunters | Fast Attack | 250 for 3, +80 | 3–6 models, Vanguard (2). Hunters on grav-harnesses: M14, Antigrav, Deep Strike |
| Ironhide Hunters | Heavy Assault | 330 for 3, +105 | 3–6 models, Vanguard (3). War-plate: M7 T6 I5, 2+/5++, great glaive (S+1 AP2 D2) and shadow blaster |
| Hunt-Hounds | Fast Attack | 75 for 5, +15 | 5–10 beasts. M12 W2 A3, Fast (2), Heedless; no Hunting Cry, and they don't count as Rangda for collars |
| Shroud-Weaver | Command | 130 | WS 6. Its Shroud Projector gives the unit it joins a 4+ invulnerable save against shooting |
| Moon-callers | Support | 70 a model | 1–3 models with a Moon-caller Array: R72 S8 AP3 Blast (3"), Barrage, Pinning (1) |
| Spine-Stalker | War Engine | 210 | A Rangdan walker: T7 W7 3+/5++, stalker talons, shadow lance (or cannon) and flails; fills the Medusa Shoal's new War Engine slot |
| Shadow Lancers | Support | 85 a model | 3–6 models. Shadow lances (S9 AP2 D2 Armourbane) |
| Mimics | Recon | 220 for 3, +70 | 3–6 models, Vanguard (2). Infiltrate (9); Stolen Voices gives their shooting Panic (1) |
| Needle-Hunters | Elites | 210 for 3, +70 | 3–6 snipers, Infiltrate (9). Needle lances (R36 S6 AP3 D2, Precision (5+), Pinning (1), Breaching (5+)) pick out officers and pin the squad around them |
| Rangda Trackers | Recon | 230 for 3, +75 | 3–6 models, M10 W3 4+, Outflank, Fast (2), Vanguard (2), spine glaives. On the Scent: their Hunting Cry reaches 18" |
| Tendril Skiffs | Fast Attack | 85 each | Small jellyfish skimmers |
| Shadow Kite | Fast Attack | 105 each | 1–2 flyers with two shadow lances each |
| Iron Medusa | Armour | 160 each | Squadrons of 1–3. Shadow cannon (Blast, Deflagrate, Suppressive), or a lance array for +15 as a tank hunter |
| Grave-Bell | Armour | 300 | The Rangdan heavy tank: 14/13/12, HP 9, antigrav, shroud; shadow annihilator turret, sponson blasters (lances +10) and flails |
| Tendril Barge | Transport | 110 | 12/12/10, HP 5, capacity 12 (four Rangda), Assault Vehicle, Firing Point (2) |
| Spine-pod | Transport | 115 | A drop pod from a war-moon: Deep Strike, Drop Transport (four Rangda or a Spine-Stalker) |
| Collar-Ark | Transport | 105 | Carries 12 and its Collar Beacon keeps every Thrall within 12" (or aboard) obedient; shadow cannon |
| Medusa Drop-ship | Fast Attack | 210 | Flyer transport for five Rangda: Assault Vehicle, Firing Point (2), lance array and two blasters |
| Brood-ship | Heavy Transport | 205 | 13/13/11, HP 8, capacity 30 (a full nine-model Hunt-Pack and its Huntmaster, or a herd), Assault Vehicle, Firing Point (3) |
| Spine-Leviathan | Lord of War | 620 | Super-heavy skimmer |
| Thrall Cohort | Troops | 70 for 20, +3 | Line (1), Expendable (2). Imperial Army; cheap bodies, the millions of slaves the canon describes |
| Collared Auxilia | Troops | 60 for 10, +5 | Line (1). Solar Auxilia in void armour |
| The Broken | Troops | 95 for 10, +9 | Collared Legionaries with Line (1); enemy infantry fighting them gain Hatred (Thrall). The rest of the Broken Legion is listed above |
| Marshal Casimir Vehl | Command | 85 | Unique, Iron Chain. Collared units within 12" of him count as near a Rangda; once a battle two Thrall units' shooting gains Pinning (1) |
| Collared Ogryns | Heavy Assault | 95 for 3, +30 | The obvious thing to Overload |
| Thrall Gun-teams | Support | 20 a team | Two gunners a model, heavy bolters or a Gun-team Weapon |
| Thrall Basilisk | Support | 115 | A captured Basilisk |
| Thrall Armour | Armour | 130 | A captured Leman Russ, priced like the Militia one |
| Thrall Malcador | Armour | 165 | A captured Malcador with the Militia profile; lascannon sponsons +15 |
| Thrall Dracosan | Heavy Transport | 135 | A captured Dracosan (capacity 22) with the Solar Auxilia profile |
| Thrall Carrier | Transport | 50 | A captured Aurox; Light Transport, so no Ogryns; heavy bolter or multi-laser +5 |
| Thrall Sentinels | Recon | 30 for 2, +15 | Captured Solar Auxilia Hermes light sentinels: Outflank, multi-lasers or grenade launchers (+5) |
| Thrall Knight | Lord of War | 400 | A Questoris with a collared pilot; thermal cannon +15 |
| Slaugth Dream-Eater | Command | 135 | Unlocks the Carrion Court; heals fully on killing a character in a Challenge |
| The Hollow Choir | Command | 180 | Unique. Heals on any character kill; once a battle names an enemy Advanced Reaction that can't be used that turn |
| Slaugth Kindred | Elites | 45 a model | W3 T5 4+ with Feel No Pain (5+) |
| Mind-Eaters | Elites | 165 for 3, +55 | WS5 Slaugth with memory-spikes and a mind-lash (R18 Pinning (1), Panic (1)); Fear (1); an enemy unit fighting them can't declare Reactions |
| Vassal Swarm | Fast Attack | 15 a model | Floating constructs whose spines pin |
| Harvester | War Engine | 200 | Walker that heals by eating infantry; AP2 claws |
| Charnel Barge | Transport | 80 | 12/11/10, HP 5, capacity 10 (five Kindred), Assault Vehicle; regains a Hull Point on a 5+ each turn |
| The Ridden | Heavy Assault | 90 for 10, +9 | 10–30 worm-filled corpses: Already Dead (never Pinned, Suppressed or Routed), Worm Gestalt, Expendable (2) |
| Corpse-Shepherd | Command | 120 | Ridden within 12" get +1 WS and A; once a battle it raises D6 fallen Ridden. Unlocks the Ossuary |
| Gorger Kindred | Heavy Assault | 195 for 3, +65 | Bloated feeders: T6 W4, gorging maws (AP3 D2 Shred 5+); Carrion Feast keeps them up |
| Rot-Casters | Support | 135 for 3, +45 | Necrotic cannons (R24 S6 AP4, Phage (T)) |
| Skin-Wearers | Recon | 135 for 3, +45 | Infiltrate (9); Borrowed Faces makes shooting at them from beyond 12" Snap Shots |
| Ossuary Colossus | Lord of War | 420 | A Walker (Heavy) of bone and worms: T8 W12 3+, Feel No Pain (5+), claws (S+1 AP2 D3 Reaping Blow 2), necrotic cannons and a spewer |
| Slaugth Ambush-craft | Fast Attack | 105 | The canon's ambush void-craft: a flyer with Outflank, two necrotic cannons (R24 S6 AP4, Phage) and a spewer; Living Hull |

### Wargear

| Who | Options |
| --- | --- |
| Every Rangda on foot | A Hunting Cry as well as their weapons (not the hounds or the Spine-Stalker) |
| Every Rangda squad | An Alpha (A+1, LD 11, shroud-field) for +15: Pack-Alpha, Sky-Alpha, Ironhide-Alpha, Lance-Alpha, Mimic-Alpha. The hounds get a Pack-Leader Hound (WS 5, S 5, W 3, A 4) for +10 |
| Rangdan Heavy Weapons | Shadow Scourer (Template S5 AP4, Deflagrate (4), Panic (1)) 10, Shadow Caster 10, Shadow Lance 15 |
| Hunt-Pack | Rangdan Sidearms (Shadow Pistol, Shadow Blaster +10); one model in three trades its pistol for a Rangdan Heavy Weapon instead; Flensing Hooks (A+1, AP 3, D 1) for any model; one Severing Maul (S+3, AP 2, D 2, I-2) per three, +20; a Pack-Alpha +15 |
| Skyhunters | As the Hunt-Pack, heavy weapons included |
| Hunt-Court | Flensing Hooks for any model; one Severing Maul per three (+20); one blaster in three for a Scourer, a Caster or a Lance (+10); a Court Standard (+1 Fear for the whole unit, to Fear (2)) for +15 |
| Ironhide Hunters | One Severing Maul per three (+15) or Ironhide Talons (A+2, AP 3, D 1, Shred (5+)) for any model, in place of the great glaive; Shadow Scourers for the blasters, or one Shadow Lance per three (+15) |
| Mimics | Shadow Scourers for the blasters; Flensing Hooks for the claws, +15 a model |
| Moon-callers | Moon-caller Lance (R72 S9 AP2 D2, Armourbane, Barrage (1)) for the array, +20 a model |
| Hunt-Sovereign, War-moon Regent | A Shadow Scourer for the blaster, or a Shadow Lance for +5; one Relic of the Hunt; the Sovereign also takes the Fang (+20) |
| Huntmaster, Collar-Wright, Shroud-Weaver | Hunting Weapons or a Severing Maul (+20), sidearms, the Fang of the First Xenocide (+25), one Relic of the Hunt |
| Relics of the Hunt (once per army) | Skin-thief Cloak (Shrouded 5+) 15, Dread-mask (Fear +1) 10, War-moon Beacon (a War-moon Strike, or a second one for the Hunt-Sovereign) 25, Collar-key of Advex-Mors (18" Overload that costs D3-1 wounds) 10 |
| Shadow Lancers | Shadow Caster (R30 FP2 S6 AP3 Blast 3", Suppressive) in place of the lance |
| Spine-Stalker | A shadow cannon for the lance; a shadow blaster for the flails (+5) |
| Rangdan vehicles | Lances for the Skiffs' blasters (+10); a lance array for the cannon on the Iron Medusa (+15), Collar-Ark (+15) and Brood-ship (+25); sponson lances on the Grave-Bell (+10) and lance arrays on the Spine-Leviathan (+15); shadow cannons for the Shadow Kite's lances or the Drop-ship's array; blasters for the Barge's and Brood-ship's flails (+5) |
| Thrall Cohort | One Captured Heavy Weapon per ten (heavy stubber, heavy bolter 5, missile launcher 10, lascannon 15, autocannon 20) |
| Thrall Gun-teams | Heavy bolter or heavy stubber, missile launcher +5, lascannon +10, autocannon +15 |
| Collared Auxilia | One Captured Special Weapon per ten (flamer, volkite charger 5, meltagun 15) |
| Thrall Armour | Demolisher or Executioner turret, hull lascannon or heavy flamer, sponson heavy bolters or lascannons, pintle stubber, hunter-killer |
| Dream-Eater, Corpse-Shepherd | Necrotic Spewer (+10), Corpse-cloak (Shrouded 5+, +10), Marrow Scythe (I-1, S+1, AP 2, D 2, Phage (T)) for the nerve-lash (+20), one Relic of the Feast |
| Relics of the Feast (once per army) | Memory-Jar (one free Advanced Reaction a battle) 20, Crown of Worms (Worm Gestalt gives Feel No Pain (4+)) 15, Bone-Pipes (Shepherd of the Ridden reaches 18", and Ridden within 12" gain Fear (1)) 10 |
| Slaugth Kindred | One in three takes a Necrotic Spewer or a Necrotic Cannon (+10 each); one Nerve-lash per three (+5); a Slaugth Elder (WS 5, W 4, A 4) for +15 |
| Gorger Kindred | Bile-sacs: a Necrotic Spewer for any model, +10 a model |
| Rot-Casters, Ossuary Colossus | Rot-mortars (R48 FP2 S6 AP4, Blast (3"), Barrage (1), Phage (T)) for the necrotic cannons |
| Skin-Wearers | One in three carries a stolen Imperial gun for its projector: flamer +10, volkite charger +5, meltagun +25 |
| The Ridden | Rusted Blades (AP 5, Breaching (6+)) for the grasping dead, +1 a model |
| Harvester, Charnel Barge | Spewers for the Harvester's projectors (+15) and a Corpse-flail (I-1, A+1, S+1, AP 3, Reaping Blow (2), Shred (6+)) for its claws; a necrotic cannon for the Barge's spewer |

Every captured Imperial weapon is copied from BSData's HH3 profile when the data is generated, so it can't drift.
Option prices come from the sim: a Severing Maul is worth about 25 points a model before counting its Initiative
penalty and its melee anti-tank, which the yardstick overweights, hence +20 and one per three. The heavy weapons
break even on the yardstick at their prices. A Marrow Scythe makes a Dream-Eater about as good a fighter per point as
a Collar-Wright with a maul, so it costs the same +20. The stolen meltagun is dearer on Skin-Wearers (+25) than on the
Auxilia (+15) because it's one gun in three models, not one in ten. Ironhide Talons and the Rot-mortar score below
what they replace: the yardstick fights Legionaries, not hordes, and can't see indirect fire, which is what they're for.
No AP 2 weapon carries Breaching, since it would do nothing there.

## How the Rangdan score

HH3 scores objectives. **Line (X)** adds X Victory Points every time a unit scores an objective and helps it claim
one; a Tactical Squad has Line (2). **Vanguard (X)** caps a unit at 1 VP for holding, but scores X VP when it wipes
out an enemy unit that is controlling or contesting an objective, or breaks one in combat (it Falls Back or is
Massacred) that started the Assault Phase within 3" of an objective; Custodian Guard have Vanguard (2), Aquilon and
Venatari Vanguard (3). A unit with any Tactical Status can't control or contest an objective at all.

The two halves of the army score differently:

- **The Thralls hold.** Thrall Cohorts and Collared Auxilia have Line (1), like a Lasrifle Section, and Collared
  Legion raises one Prime Troops unit to Line (2), like a Tactical Squad. Expendable (2) on the Cohort cuts what the
  enemy scores for killing them. The Broken are Heedless and never hold.
- **The Rangda hunt.** Hunt-Packs, Ironhide Hunters and the Hunt-Court have Vanguard (3), and Skyhunters and Mimics Vanguard (2). They never hold
  ground; they score by taking whatever stands on it.
- **The Cry decides which.** A Pinned unit can't hold or contest, so pinning a squad on an objective stops it
  scoring. Breaking a unit in combat near an objective scores Vanguard whether or not it was Pinned, but wiping one out
  only scores if it was still holding, which a Pinned unit isn't. Every turn the Rangdan player chooses between
  pinning the enemy off an objective and leaving them on it to be killed for points.

Line and Vanguard are per-unit rules, so their cost sits on the unit's base, not on each model: +10 on a Cohort, +5 on
the Auxilia, +15 on a Hunt-Pack or Hunt-Court and +10 on the Mimics. The sim measures neither.

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
| Hunt-Court | 300 | 6.88 | Hunt-Pack; Sworn to the Hunt and Vanguard aren't measured |
| Hunt-Pack | 240 | 6.41 (6.76 with blasters) | Custodian Guard 8.73, Aquilon 7.99, Legion Veterans 5.70; Vanguard isn't measured |
| Shadow Lancers | 255 | 5.80 | anti-tank about 1.3 per 100 pts vs Predator 1.55, Venatari 1.17 |
| Mimics | 220 | 5.07 | Venatari 6.25 |
| Rangda Huntmaster | 160 | 4.87 | Shield Captain 4.02 |
| Collar-Wright | 140 | 3.89 | Shield Captain 4.02 |
| The Broken | 95 | 8.76 | Tactical Squad 8.32 at 100; the Legion's Line (2) and Fury of the Legion aren't measured |
| Broken Terminators | 200 | 9.89 | Cataphractii with the same wargear 8.79 at 225 |
| Collared Contemptor | 155 | 10.06 | Contemptor with the same wargear 9.17 at 170 |
| Thrall Cohort | 70 | 8.19 | Collared Auxilia 9.18 (an Auxiliary is worth about 1.75 Thralls: a 4+ save holds against bolters, a 5+ doesn't), Lasrifle Section 9.91, Levy Troop 4.67 |
| Collared Auxilia | 60 | 8.42 | Lasrifle Section 9.91 (also Line (1)) |
| Thrall Basilisk | 115 | 11.77 | Basilisk 11.26 at 120 |
| Thrall Armour | 130 | 11.19 | Militia Leman Russ 11.16 |
| Thrall Knight | 400 | 6.00 | priced like a Questoris Paladin (410) less the collars |
| Iron Medusa | 160 | 9.12 | Leman Russ Strike 10.26; the 5+ invulnerable against shooting isn't measured |
| Brood-ship | 205 | 7.42 | Coronus Grav-Carrier 11.46 at 180, Dracosan 11.14; capacity, Assault Vehicle and Firing Point aren't measured. Capacity went from 20 to 30 for +15 so a full Hunt-Pack fits |
| Spine-Leviathan | 620 | 3.42 | Fellblade 3.22, same caveat |
| Shadow Kite | 105 | 6.97 | Xiphon 8.49; the 5+ invulnerable against shooting isn't measured |
| Tendril Barge | 110 | 13.41 | Rhino 9.51 at 60; at 12 side armour it's immune to bolters like a Rhino, and it has guns |
| Thrall Carrier | 50 | 10.19 | Aurox 9.56 |
| Slaugth Kindred | 135 | 3.98 | Sons of Horus median 4.60; Phage and Carrion Feast aren't measured |
| The Hollow Choir | 180 | 3.25 | Dream-Eater 3.20 at 135; Stolen Memories isn't measured |
| Harvester | 200 | 5.49 | AP3 claws left it losing points-matched fights to every elite (net −13 per 100 points); AP2 makes it +26, near a Legion Contemptor's +32 |
| Needle-Hunters | 210 | 5.12 | Mimics 5.01; Precision and Pinning aren't measured |
| Rangda Trackers | 230 | 6.00 | Hunt-Pack 6.37; with claws instead of glaives they scored 3.72 and couldn't finish what they pinned |
| Mind-Eaters | 165 | 5.45 | Gorger Kindred 6.73; Eaters of Memory and the mind-lash's statuses aren't measured |
| Broken Veterans | 75 | 7.40 | Veteran Tactical Squad with bolters about 6.5 at 85 |
| Broken Predator | 90 | 18.33 | Predator 16.50 at 100 (the yardstick rates every Predator highly) |
| Broken Land Raider | 240 | 7.15 | Land Raider Carrier 6.47 at 265 |
| Thrall Sentinels | 30 | 9.29 | Hermes Light Sentinels 8.71 at 32 |
| Skyhunters | 250 | 6.15 | Hunt-Pack 6.41 with the same body; speed and Deep Strike aren't measured |
| Ironhide Hunters | 330 | 8.02 | Aquilon 7.99 |
| Hunt-Hounds | 75 | 5.16 | Assault Squad 4.69; Heedless isn't measured |
| Shroud-Weaver | 130 | 4.16 | Shield Captain 4.02; the Shroud Projector isn't measured |
| Moon-callers | 70 a model | 4.77 | indirect Pinning fire; Barrage isn't measured |
| Spine-Stalker | 210 | 7.05 | Contemptor 4.06 (unarmed in the sim), Contemptor-Achillus 10.23 |
| Charnel Barge | 80 | 8.29 | Rhino 9.51 |
| Collar-Ark | 105 | 13.59 | Rhino 9.51; the Collar Beacon isn't measured |
| Spine-pod | 115 | 11.53 | Dreadclaw 11.53 at 115 |
| Medusa Drop-ship | 210 | 8.39 | Storm Eagle 7.70 at 200 |
| Thrall Dracosan | 135 | 11.59 | Dracosan 11.14 at 140 |
| Thrall Malcador | 165 | 8.98 | Militia Malcador 8.70 at 170 |
| Slaugth Ambush-craft | 105 | 13.94 | Thunderbolt 13.27 at 120 |
| Grave-Bell | 300 | 6.77 | Kratos Assault Tank 6.36 at 280: far more anti-tank (3.34 to 1.36), less armour, plus the shroud the sim doesn't count |
| The Ridden | 90 | 5.28 | Levy Troop 4.67; Already Dead isn't measured |
| Gorger Kindred | 195 | 6.66 | Charonite Ogryns 12.19 at 120, Ogryn Brutes 3.72 |
| Rot-Casters | 135 | 5.09 | Phage isn't measured |
| Skin-Wearers | 135 | 4.09 | Seeker Squad 4.19; Borrowed Faces isn't measured |
| Ossuary Colossus | 420 | 4.65 | Telemon 3.96 at 360, Knight Styrix 5.29 at 455 |
| Corpse-Shepherd | 120 | 2.85 | Dream-Eater 3.21; its aura isn't measured |
| Iron Medusa with lance array | 175 | 9.99 | Sicaran Venator 10.59 at 170 |

The transports were the army's weak point: the Barge and Charnel Barge had 11 armour and 4 Hull Points (a Rhino has
12/11/10 and 5), the Brood-ship sat below a Coronus, and none could fire out. They now match or beat their Imperial
counterparts and the Rangdan ones carry Firing Point, so a squad aboard can still use its Hunting Cries.

The army's median is 6.24 against 5.99 for Custodes, 5.26 for the Solar Auxilia, 4.82 for the Militia and 4.64 for the
Sons of Horus.

The sim's random number generator was broken until November 2026. The usual LCG, `(seed * 1103515245 + 12345) &
0x7fffffff`, overflows what a JavaScript number holds exactly, so the dice fell into a loop of 10,466 rolls whatever the
seed. Re-measured with a working generator (mulberry32), the army median didn't move and the Custodes median rose from
5.84 to 5.99. No unit moved more than 8 places in percentile against the reference armies: many-dice infantry rose up
to 7% (as Lasrifle Sections did) and transports fell up to 7% (as the Imperial ones did). The melee fights moved by 4
net points at most. So no prices changed. The per-unit numbers in the table above are the original measurements and
sit within a few percent of the new ones.

Weapon Skill runs 5 in the ranks, 6 for Command characters, 7 for High Command and 8 for the Regent. Against WS 4
Legionaries, WS 5 and WS 6 make no difference: either hits on 3+ and is hit on 5+. Against WS 5 elites and
characters, a WS 5 Rangda hits on 4+ instead of 3+ and is hit on 4+ instead of 5+, which cost a Hunt-Pack about 10%
of its value when the ranks dropped from WS 6.

Prey Instinct used to be +1 to wound, which did nothing for any weapon that already wounded Legionaries on 2+: the
Ironhides' great glaives, the officers' glaives, blasters, lances, mauls and the Spine-Stalker. It's now a Critical
Hit that grows with the target's statuses. A critical hit wounds automatically, adds 1 Damage and counts as a 6, so it
also sets off the Breaching (5+) on most Rangdan weapons. With the sim, a Hunt-Pack in combat:

| Target's statuses | Legionaries killed | Wounds on Terminators |
| --- | --- | --- |
| none | 5.4 | 3.3 |
| one (old +1 to wound) | 6.7 | 3.8 |
| one (Critical Hit 6+) | 6.1 | 4.5 |
| two (Critical Hit 5+) | 6.8 | 5.9 |
| three or more (Critical Hit 4+) | 7.4 | 7.2 |

Against one status it's worth about what the old rule was, and every Rangdan unit now gains something: an Ironhide
squad, a Sovereign or a Spine-Stalker 5–7%, shooting at Terminators 40–70%. Against two or three it's the reward for
stacking Hunting Cries, suppression, Shock and Fear on one unit. The sim prices units without Prey Instinct, since
it depends on the table, so no points moved. Before it, a Hunt-Pack kills about five Legionaries a round in
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
