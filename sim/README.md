# Battle simulator

Plays two army lists from the builder against each other on a simple table, turn by turn, with an AI making the
decisions for both sides. It's meant for testing lists and points, not for replacing a game: the table is
abstract and the rules are only as good as the texts in this repo (see "What's assumed" below).

```
node sim/run.cjs sim/lists/rangdan.json sim/lists/sons-of-horus.json --battles 100
node sim/run.cjs my-list.json "https://…#a=…" --battles 50 --mission high-ground --variant hammerblow
node sim/run.cjs a.json b.json --battles 1 --mission no-quarter --deployment tip-of-the-spear --log 2> battle.txt
```

A list is a JSON file saved from the builder, or a share link. By default each battle rolls its own Core Mission
(a D3 for the Archetype, a D3 for the Mission) and Deployment Map (a D6), like a pick-up game; `--mission` and
`--deployment` fix them. The two lists swap sides every other battle. `--log` writes a readable play-by-play of
the first battle to stderr; `--out file.json` saves the summary (win rates overall and per mission, VP, points
destroyed per unit, reactions used).

A round robin plays every list against every other and summarises it:

```
node sim/tournament.cjs sim/lists/legions/*.json --battles 24 --workers 4 --out tournament.json
node sim/report.cjs tournament.json
```

The report gives standings with a Bradley-Terry rating (an Elo-like number that accounts for who each list
played), results by mission Archetype, the most one-sided matchups and the units that earned their points.
`sim/lists/legions/` has one list per Legion, made by `sim/lists/legions/make.cjs`: the same core (Praetor, three
Centurions, Tactical Squads, Rhinos, lascannon Heavy Support, four Predators, a Contemptor where a slot is left)
plus two or three of the Legion's own units, legal in the builder and filled to just under 3000 points.

`sim/lists/strong/` has a second list per Legion, made by `sim/lists/strong/make.cjs`, built on what that Legion
does well in the simulator: its Tactica, its Advanced Reaction and its best units by the simulator's own combat
numbers. Melee Legions carry their assault units in Assault Vehicles (a Spartan, Land Raider Carriers) so
Violence Incarnate, Encarmine Fury and the Hunter's Strike land on the turn they arrive; gunline Legions stack
what their Tactica rewards (bolters for Fire Discipline, long-range guns for Shadow Walkers, Heavy weapons that
walk for Remorseless Advance); every list keeps Line Tactical Squads to hold markers. Each plan in `make.cjs`
says what the army is for. Both sets share `sim/lists/builder.cjs`, which makes units, places them in the
Primary Detachment or the Auxiliary and Apex Detachments it opens, grows squads and checks the army in the
builder's engine. For the strength lists it also picks each open weapon choice by the simulator's combat maths,
like for like (a melee weapon for a melee weapon, a gun for a gun) and only among the choices that cost no more
than the cheapest, so a squad gets a better weapon but never fewer bodies.

Each Legion had up to four versions: its generic list, a first plan built purely on its theme, a second plan
(its best units, carried in Assault Vehicles where they fight in melee, around four lascannon Predators,
lascannon Heavy Support and Tactical Squads on foot) and the generic list with better weapons at the same price.
The World Eaters later got a third plan, Despoilers in Rhinos (see below), which replaced their second. Every version played all 19 lists of the field (the generic lists and the Iron Wall, 72 games each) and the best
one became the strength list. Those lists then played the field again on fresh seeds, 108 games each:

| Legion | Version | What it does | Strength list | Generic list |
|---|---|---|---|---|
| Raven Guard | first plan | long-range gunline (Shadow Walkers), Deliverers Deep Strike | 78% | 57% |
| Iron Hands | generic, better weapons | Medusan Immortals and Gorgons under the Gorgon's Scales | 74% | 69% |
| Sons of Horus | second plan | two Reaver squads and Justaerin behind four Predators | 74% | 76% |
| Space Wolves | second plan | Varagyr in a Spartan and a Land Raider | 69% | 66% |
| Salamanders | generic, better weapons | Firedrakes and Pyroclasts, lascannons, Predators | 68% | 61% |
| Word Bearers | generic, better weapons | Gal Vorbak and Ashen Circle, lascannons, Predators | 67% | 66% |
| Ultramarines | second plan | two Fulmentarus squads, Invictus in a Land Raider | 63% | 64% |
| Imperial Fists | first plan | bolters in bulk for Fire Discipline, Huscarls | 63% | 46% |
| Death Guard | second plan | Grave Wardens and moving lascannons (Remorseless Advance) | 60% | 65% |
| Thousand Sons | second plan | Sekhmet in a Spartan, Sorcerers leading | 60% | 50% |
| Emperor's Children | generic, better weapons | Palatine Blades, Kakophoni, lascannons | 56% | 56% |
| Iron Warriors | generic, better weapons | Tyrants and Iron Havocs (the Bitter End) | 56% | 63% |
| Dark Angels | second plan | two Cenobium squads in Land Raiders | 55% | 40% |
| White Scars | second plan | fast Tactical Squads (Swift of Action), Ebon Keshig | 49% | 31% |
| Blood Angels | second plan | Dawnbreakers in a Spartan, Paladins in a Land Raider | 46% | 39% |
| Alpha Legion | generic | nothing beat the generic list | 45% | 56% |
| Night Lords | second plan | heavy bolters break, Atramentar and Contekar strike | 40% | 26% |
| World Eaters | third plan | six Despoiler squads in Rhinos, Predators and lascannons | 29% | 20% |

Thirteen of eighteen beat their generic list, the average goes from 53% to 59%, and differences of five points
or less are within the noise of 108 games. The Alpha Legion row is the same list played twice. What the
simulator rewards shows in the picks: long guns and armour (every strength list fields four Predators, eleven of them all with lascannons),
assault units that arrive in Assault Vehicles rather than on foot, and bodies on markers. Melee infantry that
has to walk across the table (Rampagers, Night Raptors, Grey Slayers) is still the weakest thing a Legion can
take.

Once Legion gambits, Primarchs and named characters were in, every strength list played the field again with
and without its Primarch, and the Emperor's Children and World Eaters lists in both Legion versions (72 games
each). A Primarch made most lists worse, often by a lot (Blood Angels 60% to 24%, Dark Angels 65% to 25%):
he's 425 to 530 points in one unit, enemy characters refuse his challenges rather than duel him, and when he
falls the enemy scores both Slay the Warlord and Giant Killer. Only the Night Lords clearly gained from theirs
(Konrad Curze, 25% to 34%), so theirs is the one strength list with a Primarch. Legiones Hereticus suits the
Emperor's Children better (60% to 53%); for the World Eaters the two versions are level, and their list uses
Legiones Astartes. The simulator leaves out the Primarchs' psychic rules and their Sire of the Legion list
rules, so it likely undervalues the psychic Primarchs in particular.

With every rule above in, the final strength lists played a round robin (24 battles a pairing, 432 games per
list, the Iron Wall as a guest):

| | Score | | Score | | Score |
|---|---|---|---|---|---|
| Salamanders | 72% | Thousand Sons | 59% | Word Bearers | 48% |
| Space Wolves | 71% | Ultramarines | 54% | Iron Warriors | 45% |
| Iron Hands | 65% | Dark Angels | 51% | Alpha Legion | 42% |
| Raven Guard | 64% | Emperor's Children | 50% | Imperial Fists | 39% |
| Sons of Horus | 62% | Blood Angels | 49% | World Eaters | 25% |
| Death Guard | 60% | White Scars | 48% | Night Lords | 24% |
| | | | | Iron Wall (Rangdan) | 22% |

Why the World Eaters lose: it's board control, not killing. Against the strength lists they score 14.6 VP a game
from markers and Sectors to their opponents' 29.7, while Kill Points and the secondaries are close to even, and Seize
Ground is their worst mission. Their Legion rules are average: the same army fielded as seven Legions scored 8% to
19%, World Eaters 11% (Astartes) and 9% (Hereticus). Their signature units are the problem in this ruleset. Red
Butchers survive and kill but are Heedless, so they can't hold or contest a marker. Rampagers reach combat and win
their first fight, then die in 93% of games, mostly to shooting after it: power armour, no invulnerable save, and
Vanguard caps what they score from a marker at 1 VP. A unit riding in a transport or locked in combat controls
nothing, and that's where World Eaters spend the game. More Tactical Squads, more Red Butchers and better AI play
didn't move them; even 900 extra points of World Eaters (3,900 against 3,000) only reached 36%. One reading to check
in the mission pack: the simulator also keeps Heedless units out of Seize Ground Sectors, though the rule's text only
mentions Objective Markers.

What helped was Line bodies that move. Six squads of eleven Despoilers (Line, chainaxes, Violence Incarnate) in
Rhinos, with four Predators, two lascannon Heavy Support Squads and two Veteran Tactical Squads, now make the World
Eaters strength list. Over about 530 games each against both fields it won 29% to the Spartan list's 21%, and it
loses by about 11 VP a game where the Spartan list loses by 19. In the first run (114 games) its profile was the
reverse of the Spartan list's: 44% in the marker and Sector missions (the Spartans managed 12-14%) and 24% in
Annihilation (45%). The round robin
above was played with the Spartan list. A horde of twenty-strong Despoiler squads on foot did no better than the
Spartans (22%): they reach the markers but die walking there. The same Rhino list built 375 to 725 points short,
as a first attempt was, scored 8% to 24%, so the gain is the list, not the AI changes below, which measured level.

Melee units now earn their points once they're carried in (Firedrakes, the Inner Circle Knights Cenobium,
Palatine Blades, Invictus Suzerains and Grave Wardens are among the most efficient units, and the Space Wolves
are second), but the World Eaters and Night Lords are still far behind, and the first player won 58% of decided
games.

From code:

```js
const { runBattle } = require('./sim/lib/battle.cjs');
const r = runBattle(listA, listB, { seed: 3, log: true });
// r.winner (0, 1 or null), r.vp, r.pointsKilled, r.units, r.vpLog, r.reactions, r.powers, r.log
```

## Missions

The nine Core Missions of the Core Mission Pack: Imperium at War, on its six Deployment Maps (Search and Destroy,
Hammer and Anvil, Dawn of War, Flanking Strike, Determined Push, Tip of the Spear):

| Archetype | Missions | Primary Objective |
|---|---|---|
| Resupply | `crucial-supplies`, `hidden-caches`, `unknown-munitions` | Claim Supplies: control Objective Markers |
| Annihilation | `no-quarter`, `cut-off-the-head`, `thin-the-ranks` | Destroy the Enemy: Kill Points (points / 100, rounded) |
| Conquest | `high-ground`, `shattered-earth`, `secure-the-highway` | Seize Ground: control Sectors |

Claim Supplies and Seize Ground score each turn from Battle Turn 2 (Escalation) or once at the end
(`--variant hammerblow`). A unit controls an Objective Marker with a model within 3"; when both sides have a unit
there, the single unit with the higher Tactical Strength (models within 3", plus Line (X) per model) controls it.
A Sector goes to the side with more models in it, plus Line (X) where the Sector touches its own zone and
Vanguard (X) where it touches the enemy's. Units that are Stunned, Suppressed, Pinned, Routed, Locked in Combat,
Embarked, Automata or Heedless can't control anything; vehicles and Cavalry can. Line adds to a marker's VP,
Vanguard caps it at 1 (and scores for breaking units on objectives), Support Unit caps it, Expendable takes VP off
what the opponent scores for the unit.

Every mission has Slay the Warlord (X, or X+1 for High Command), Giant Killer, Breakthrough and First Strike at its
own values, Reserves (3+, automatic from turn 4; units still in Reserves at the end count as destroyed) and Seize
the Initiative. Mission rules: Hidden Caches (markers scatter 3" when scored), Unknown Munitions (D3 values per
player), No Quarter (a VP as an aftermath option), Cut Off the Head (2 VP for slaying a model in a challenge),
Thin the Ranks (bonus Kill Points), Tectonic Instability (a Sector turns difficult each turn and is worth 5) and
Supply Road (no terrain on the highway, vehicles get +2" along it). Five Battle Turns, then a sixth on a 4+.

The battlefield follows the pack's suggestion, laid out point-symmetrically: two 8" and four 6" zones of Area
Terrain (Light, 6+ cover, or Medium, 5+ cover and sight through at most 3"), and six 4" Terrain Features
(Impassable and blocking sight, or ruins counted as Medium Area Terrain). Units are circles sized from their
models' bases. Ranges are edge to edge, and line of sight is three sight lines between the circles.

## What it plays

Each Player Turn runs the HH3 phases in order:

- **Before the battle:** the Core Mission Sequence: mission, terrain, Objective Markers, Deployment Map; the
  roll-off loser picks a zone, the winner deploys first and goes first (Seize the Initiative on a 6); units with
  nowhere to stand go into Reserves.
- **Movement:** Reserves on a 3+, automatic from turn 4 (from the edge of your own zone; Deep Strike from turn 2,
  one per turn; Outflank from any edge outside the enemy zone and 7" from the enemy; Flyers),
  moving, Rushing, embarking and disembarking (Disordered unless from an Assault Vehicle), and Fall Back Moves
  for Routed units (D6 + I towards their own zone's edge; there a Leadership check, removed on a fail, Suppressed
  on a pass).
- **Shooting:** one weapon per model (two Pistols, Firing Protocols (X), Walkers and Vehicles fire everything),
  Fire Groups, the Hit Test table (Critical Hits from BS 6, the Snap Shot column), Wound Tests or Armour
  Penetration, the best of Armour, Invulnerable and Cover saves, Feel No Pain and Shrouded, the Vehicle Damage
  Table, then the Morale Sub-Phase checks for Pinning and Panic (on a wound), Suppressive and Stun (on a hit)
  and 25% casualties.
- **Assault:** the five-step charge (Line of Sight and 12", the Set-up Move table, Volleys that never inflict
  statuses, the Charge Roll, Stunned on a failed Cool Check after a failed charge), challenges (rounds of
  Face-Off, Focus Roll and Strike, Challenge Advantage, Glory), Initiative Steps, Combat Resolution (models
  removed, Glory, outnumbering, standards), Panic Checks and the aftermath: Fall Back, Pursue, Gun Down,
  Disengage, Hold and Consolidate.
- **End:** conditions that wear off, Statuses Sub-Phase (Cool, Leadership, Repair Tests), and scoring.

Statuses work as the quick reference lists them: any status makes the unit's charges Disordered, sets Combat
Initiative to 1, stops it holding objectives and denies it the Stationary bonus; Pinned stops moving, Rushing,
charging and Pursuing; Suppressed forces Snap Shots; Stunned stops reactions; Routed falls back and takes every
other penalty; Disgraced halves the model's WS and LD.

Weapon and unit rules handled: Rending, Breaching, Shred, Poisoned, Precision, Critical Hit, Melta, Armourbane,
Murderous, Bypass, Deflagrate, Phage, Shock, Blast (one Hit Test, every model under the marker hit), Template,
Barrage, Heavy, Ordnance, Limited, Overload (Misfire Groups), Force, Psy-Shock, Impact, Reaping Blow, Hatred,
Eternal Warrior, Feel No Pain, Shrouded, Fear, Explodes, Malefic, Anathema, Adamantium Will, Vanguard, Line,
Support Unit, Expendable, Infiltrate, Deep Strike, Outflank, Firestorm, Skyfire, and the Rangdan army rules:
Prey Instinct, Neural Collars (automatic Leadership and Cool passes within 12" of a Rangda model, 18" for Iron
Chain or Collared Legion; Leadership and Cool 5 and no reactions out of reach), Collar-master (overloading a
collared unit in combat), Horror of the Taken, Worm Gestalt, Carrion Feast, the Medusa Shroud, and the war-moons
(Burning Sky's +6" range and Long Hunt's forced charge; the builder applies their profile changes).
Profiles, rules and wargear come from the builder's own engine, so Legion rules, war-moons and wargear options
apply exactly as they do in the app.

### Characters joining units

Before deployment each side's characters join units (`lib/characters.cjs`), following the HH3 texts: a model with
the Command or Specialist Sub-Type joins a unit of its own kind (Infantry with Infantry, Cavalry with Cavalry), a
Paragon joins a unit that includes Infantry, nobody joins a vehicle, a Flyer or a Fortification, Malefic models
only mix with Malefic models, and a model with Lone Killer neither joins nor is joined. A character also can't take
a unit into Deep Strike, Outflank or Infiltrate unless it has the rule too.

The AI picks each character's unit in points order, the most expensive first. It wants a Retinue first, then a
unit whose way of fighting matches the character's (a melee Praetor with Terminators, a Centurion with a Tactical
Squad that needs its Leadership), a scoring unit, and not one the character would slow down. A Rangda master
never joins a collared unit, since Neural Collars only work in a unit of collared models.

On the table the character is one more model of the unit: it moves with it at the pace of the slowest model,
lends it its Leadership, embarks with it, can be picked out by Precision hits and fights its challenges. For
scoring it stays a unit of its own: its Kill Points, Slay the Warlord and First Strike count when it falls, and
the unit's own Kill Points use the unit's points without it.

### Primarchs

Every Legion's Primarch can be fielded (`lists/builder.cjs` opens the Warlord Detachment for one). A Primarch is
a Paragon, so he joins an Infantry unit before deployment like any character, and counts as High Command for Slay
the Warlord (ASSUMPTION) and as a Warlord for Giant Killer. Their rules (CONFIRMED, from the army data):

- Gambits: Angelic Descent, The Lion's Choler, Bulwark of the Imperium, The Breaker, A Death Long Foreseen (on a
  5+ each Face-Off), The Shadowed Lord, The Undying Fire, Howl of the Death Wolf, Calculating Swordsman, Death by a
  Thousand Cuts.
- In challenges: Sublime Swordsman, Battle of the Wills, Preternatural Resilience, Avatar of Perfection (Fulgrim
  Transfigured must have a challenge declared), Lord of the Red Sands (Angron fights further challenges).
- Elsewhere: Shadow of the Reaper, The Power of the Word, and each Legion's Tactica on its Primarch.

Not played: the psychic Primarch rules (Arch-Sorcerer, Stoneform, Kine Shield, Seal the Veil), Everywhere and
Nowhere, and the Sire of the Legion rules, which change list building rather than the battle. Battlesmith (Ferrus
Manus) is played like everyone else's (see Named characters). Enemy units usually refuse a Primarch's challenge and
take Disgraced on a lesser model, so his gambits come up rarely; he does his work in the fight itself.

### Named characters

The Legions' named characters (the unique High Command, Command, Elites and War Engine choices that aren't
Primarchs) are fielded like any unit, and the single-model ones join a unit before deployment. Their rules are
played from their texts in the army data (CONFIRMED; the code marks each interpretation ASSUMPTION):

- Gambits (`lib/gambits.cjs`): Bite of the Betrayed (Saul Tarvitz, first Face-Off against an Emperor's Children,
  World Eaters, Sons of Horus or Death Guard model, lasting the challenge), Seeker of Atonement (Hibou Khan),
  Head-taker (Hvarl Red-Blade), Death's Champion (Sigismund), Hammerblow (Alexis Polux), Executioner's Tax (Fafnir
  Rann), Dirty Fighter (Sevatar), Archein of Wisdom (Raldoron), Witchblood (Calas Typhon, once per battle), Every
  Strike Foreseen (Ahzek Ahriman, Magistus Amon, and any Divination psyker), and The Faultless Blade (Lucius's
  Paragon of Excellence at +4).
- In challenges (`lib/assault.cjs`): Slayer of Kings (Sigismund must be the Challenger and picks the Challenged; a
  pick that refuses gives Combat Resolution Points equal to its Wounds and the next pick must accept), Shield Master
  (Fafnir Rann), Vengeful Hate (Rylanor may fight Fulgrim, and must be his Challenged), Broken in Body (the AI keeps
  Maloghurst out of challenges he would refuse), Haunted (2 VP for Aximand slaying Loken), and Thunderstrike
  (Armillus Dynat's blade, in challenges and fights).
- Not Removed as a Casualty: Born Survivor (Loken), The Ghost of Saiph (Aster Crohne), and Seeker of Atonement, for
  damage from attacks. Drakenscale Armour (Cassian Dracos) takes Flame, Plasma, Melta and Volkite wounds at Damage 1.
- Start Phase (`lib/battle.cjs`): Dark Dreams (Sevatar), Dark Oratory (Kor Phaeron), Shadow of the Conquerer and
  Level-headed (Lotara Sarrin). The Guns of the Conqueror fire only through their own Advanced Reaction, for 3
  Reaction Points (the text's "automatically unsuccessful" Hit Test is read as successful); while Annihilate stands
  the AI keeps those points unless another reaction is worth as much.
- Shooting: The Blood Crow (Kaedes Nex), and Cameleoline (his wargear, also on Corvus Corax and Mor Deythan).
- Reserves and deployment: Chosen of the Khagan (Qin Xa), the Vox-interlink (Remus Ventanus), Void Commander (Alexis
  Polux with Breachers) and Master of the Justaerin (Abaddon with Justaerin) giving the unit Deep Strike and Feel No
  Pain (5+) when it arrives, Harrowmaster (Armillus Dynat's Infiltrate (12)).
- The rest: Ancient of War (Marduk Sedras), Hatred (Traitor) and Hatred (Loyalist) (worked from each list's
  allegiance; a joined character's Hatred is his own, not his unit's), Jealous Command (Kor Phaeron), Lord of the
  Blessed (Erebus joins Malefic units), Consul-Delegatus (Autilon Skorr counts as High Command for Slay the
  Warlord), Battlesmith (N'rik Dreygur, Shadrak Meduson, Cassian Dracos and anyone else with it; a servo-arm repairs
  one more), and the wargear Icon of Calth, Icon of the Warmaster, Panoply of Flame and Sonic shriekers.
- Rules on other units that name a character or a Primarch: Sworn Loyalty (Atramentar may use Sevatar's
  Leadership), Corax's Shame, Wolf-kin of Russ, and Lair of the Iron Tyrant.

Played already through the Legion Tactica: The Angels of Death, Fire Discipline, Cult Arcana and Unwavering
Conviction. Not played: rules that only change list building (Officer of the Line, Harbinger of Chaos, Master of
Automata, Consul-Delegatus's Apex Detachment); psychic powers and disciplines, which have no framework (Arch-Magister
of the Corvidae, Magister of Dust, Binder of Souls, Witchblood's Biomancy, Seal the Veil, and Resurrection, whose
text isn't in the data); Cybertheurgy (Cybertheurgic Status: Null, Whispers of Isstvan); Eyes of the Warmaster (the
simulator has no Leadership penalty for mixed Faction Traits); the Cortex controller (Dreygur can't join Automata
here); The Tyrant's Regalia (the data already gives Evander Garrius Feel No Pain (5+) at all times); and Those Once
Honoured and The Shield of the Iron Tyrant (Perturabo can't join those Automata units anyway). A character's own
gambit is valued like any other, so he picks it only when it beats the core ones (Finishing Blow often does).

### Unit rules

Besides the weapon and unit rules listed above, the simulator plays these unit rules from the lists' datasheets
(CONFIRMED): Slow and Purposeful (no Pursuit), Bitter Duty and Ravening Madmen (who may join whom), Fury of the
Legion (a Tactical Squad's bolters gain Heavy (FP)), Ravening Madmen (Hit Tests against them count WS 3), The Blood
is Forever (Feel No Pain when outnumbered), Death Cloud, Templar Assault, Cloaked in Murder, Ferrum Occularis,
Fatal Strike (the AI uses it the first time it can), Lordsbane, Lords of Ultramar and Set the Sky Aflame. Still
not played: Phalanx Formation, The Dreams of the Death Wolf (its profile isn't in the data), the Thousand Sons'
Prosperine Sorcery, Conduit and Bladeweaving, the Orders of the Hekatonystika, and Harbingers of Truth.

### Legion Tacticas

Each Legion's Tactica (from the Legion Tactica or base Rite of War text in its army data) applies to units made
only of that Legion's models (`lib/legions.cjs`): The Angel of Death, Flawless Execution, The Bitter End, Swift of
Action, The Hunter's Strike, Fire Discipline, A Talent for Murder, Encarmine Fury, The Gorgon's Scales, Violence
Incarnate, Tactical Flexibility, Remorseless Advance, Cult Arcana, Death Dealers, Unwavering Conviction,
Promethean Endurance and Blood of Fire, Shadow Walkers, and Lies and Obfuscation. The Legion's Advanced Reaction is
listed under Reactions, and its gambit under Challenges and gambits.

### Legiones Astartes and Legiones Hereticus

Emperor's Children and World Eaters choose a version in the army's configuration, and the simulator follows the
list's choice. Legiones Astartes has the Tactica, gambit and Advanced Reaction listed above (Flawless Execution
and Perfect Counter; Violence Incarnate and Brutal Tide). Legiones Hereticus replaces all three: Lords of
Profligacy (after a Shooting Attack at them a unit may become Stupefied) and Twisted Desire for the Emperor's
Children; The Nails' Bite (a unit that fails a Leadership Check may become Lost to the Nails) and Furious Charge for
the World Eaters. The AI always takes The Nails' Bite, and takes Stupefied when the unit already has a status,
faces a check it will likely fail, or fights better than it shoots. The rules marked "Legacy house rule" in the
army data (Warrior Brotherhood, Death Before Dishonour, the builder's own Rites of War) aren't played.

### Reactions

Each enemy Player Turn a side has a Reaction Allotment, and each unit reacts at most once per Player Turn. At every
trigger the AI prices each reaction it could make in expected points and makes the best one if it's worth a point
of the allotment (the bar rises as the allotment runs low, and before the Assault Phase the last point is kept
when enemy assault units could charge). The allotment is 1, +1 above 1500 points or +2 above 3500, +1 for a
Master of the Legion. A unit locked in combat, Stunned or Routed can't react. Return Fire is a full Shooting
Attack made before casualties are removed; Overwatch is a full Shooting Attack in place of the target's Volley.
Simulated reactions:

| Trigger | Reactions |
|---|---|
| An enemy ends a move | Reposition, Chasing the Wind (White Scars), The Hunt Closes (Rangdan), Bastion of Fire (Imperial Fists) |
| An enemy arrives from Reserves | Intercept, Moonfall (Rangdan) |
| A Shooting Attack | Return Fire, Smokescreen, Shieldwall!, Take Cover, Living Shields (Rangdan), Bitter Fury (Iron Warriors), Bestial Savagery (Space Wolves), Barbaran Endurance (Death Guard), Brutal Tide (World Eaters), Retribution Strike (Ultramarines), Shadow Veil (Raven Guard), Wrath of Angels (Blood Angels), Glorious Martyrdom (Word Bearers), Smoke and Mirrors (Alpha Legion) |
| A charge | Overwatch, The Choir Answers (Rangdan), Twisted Desire and Perfect Counter (Emperor's Children), Spite of the Gorgon (Iron Hands), Selfless Burden (Salamanders), Shieldwall!, Evade, Better Part of Valour (Night Lords), Furious Charge (World Eaters) |
| The end of a combat | Vengeance of the First Legion (Dark Angels) |
| A challenge | Heroic Intervention, Warrior Pride (Sons of Horus) |

The Legion reactions go to an army by its Legion; BSData Legion lists don't put the Legion's Trait on each unit, so
the simulator adds it from the army. Fan armies list their reactions in their own rules. Adding one means adding
an option to the right trigger in `lib/reactions.cjs`.

### Psychic

Psykers are units with the Psyker Trait or a Psychic Discipline. Psychic Weapons fire and strike like any other
weapon; Force (X) takes a Willpower Check (less Fear) to double X, and any double is Perils of the Warp. The AI
only takes the check when doubling X would change something against the target: more Damage than any of its models
has Wounds, or AP 2 against a save AP alone already beats, does nothing. Titans and Ordinatus ignore Psychic
Weapons; Anathema ignores Psychic damage and Perils. Perils of the Warp is a D6: on a 1 or 6 the psyker takes 13
minus its Willpower in wounds with only Invulnerable Saves, otherwise the unit is Stunned.

A Psychic Discipline, whether chosen for a model or granted by a rule, gives the model the discipline's Psychic
Weapon: Biomantic Slam for Biomancy, Wildfire for Pyromancy, Immovable Force for Telekinesis (CONFIRMED by
Prosperine Sorcery, which names each with its discipline). So Prosperine Sorcerers carry all three, Magnus carries
those of the disciplines picked for him, and Calas Typhon (Witchblood, without Mortarion) carries Biomantic Slam;
Conduit adds 1 to their Strength. That alone took the Thousand Sons strength list from 52% to 66% against the
eight strongest lists in the field. Warpath (Power of the Waaagh!) is played as a Blessing.

`lib/psychic.cjs` keeps a registry of every psychic power the army data names, and every power goes through one
Manifestation step (a Willpower Check, Perils on a double, a count for the battle report). The repo has no rules
text for the rest, so they're listed there and wait for it: the Divination, Telepathy and Thaumaturgy powers
(Foresight's Blessing, Mind-burst, Resurrection), the five Prosperine Arcana (Raptora, Pyrae, Pavoni, Corvidae,
Athanaean), the Khenetai's Bladeweaving and Mindsong of Blades, Zardu Layak's Soul Binding and Breach the Veil,
Magnus's Stoneform and Kine Shield, and Lorgar's Seal the Veil.

### Challenges and gambits

The Active Player may challenge with a Command, Champion or Paragon model; if they don't, the Reactive Player may
with Heroic Intervention. Refusing makes a model of the challenger's choosing Disgraced. Each round both duellists
pick a gambit, roll Focus (D6 + Combat Initiative − wounds lost, −1 Heavy, +1 Light, +1 Shield or Company
Standard, +1 per 5 friendly models), and the winner strikes first with +1 Attack and Challenge Advantage, which
decides whether to fight another round. The duellist who inflicted more wounds scores them as Glory (the slain
model's full Wounds if it died).

Gambits: the seven core ones (Seize the Initiative, Flurry of Blows, Test the Foe, Guard Up, Taunt and Bait,
Grandstand, Finishing Blow), the Rangdan three (Throat-Hunter, Hunter's Stare, Feast of Memories) and character
gambits with plain number effects.

Each Legion's own gambit is played too (CONFIRMED, from the army data): I Am Alpharius, Thrall of the Red Thirst,
Sword of the Order, the Death Guard's Gambit, Paragon of Excellence or The Broken Mirror, A Wall Unyielding, Legion
of One, Spiteful Demise, Nostraman Courage, Decapitation Strike, Duty is Sacrifice, Merciless Strike, A Saga Woven
of Glory and No Prey Escapes, Prophetic Duellist, Aegis of Wisdom, The Path of the Warrior, Beseech the Gods, and
Brutal Dismemberment or Violent Overkill. The AI weighs each by the wounds it changes in the coming Strike Step and
by what it does to the Focus Roll, worked out from the challenge's own sums. Two assumptions: the data leaves out
the Spiteful Demise weapon profile, so the falling model strikes with its own best weapon; and Violent Overkill
passes on the attacks not yet made, rather than wounds already rolled.

## The AI

Every choice is scored in expected points (a Victory Point counts as 45 points): damage a unit can deal, damage
it will take where it stands when the enemy acts next, objectives it holds or approaches, and the value of
statuses it could inflict. Moves are picked from candidate spots (twelve directions, objectives, enemies, cover),
targets by expected points plus status value, charges by expected melee exchange against the shooting it takes
going in. It doesn't plan more than one turn ahead, and coordinates units only through the objectives (below).

Units play to their battlefield role, from the Line and Vanguard rule texts:

- Line units hold markers. They weigh a marker half again as much as other units do, and won't charge off one
  unless the fight is worth more than the marker or the target sits on the same marker. A marker a friendly
  unit already holds is worth little to them, so they press on to the next free marker or one the enemy holds.
  Between two friendly units on a marker, a Line unit outranks one without Line, then the bigger Line value, then
  the bigger unit; the other moves on.
- Vanguard units hunt the enemy units that hold markers, because removing the last model of one, or breaking
  it in combat, scores their Vanguard (X) Victory Points (once per marker per Player Turn). Targets, charges
  and moves all count that prize against the chance of earning it, and a little extra for every point taken
  off a holder. They're drawn towards holders from anywhere on the table, care less about holding markers
  themselves (they'd score 1 VP at most) and accept half the usual risk to get there.
- Any unit counts a marker the enemy holds as worth contesting, for the Victory Points it denies them, and no
  unit weighs more risk than the points it has left.

Seize Ground and Destroy the Enemy have no markers, so there units play as before.

Transports deliver. A transport's move counts what its passengers could do from where it stops (charge, shoot
or hold once they get out beside it), and one carrying an assault unit is drawn towards the enemy that unit
fights best and accepts half the usual risk to get there. While the transport can still move, passengers only
get out if they can charge from that spot or hold a marker (assault units only a marker, and only if they're
Line); otherwise they ride. Getting out of anything but an Assault Vehicle makes the charge Disordered, with no
Set-up Move, and the AI weighs the charge that way: a Despoiler squad in a Rhino gets out within a Charge Roll of
its target, not a Set-up Move and a Charge Roll. Neither change moved the World Eaters or the six other Rhino armies
(Alpha Legion, Emperor's Children, Iron Hands, Iron Warriors, Salamanders, Word Bearers: 56% before, 56% after).

A move goes straight when nothing stops it short; when a unit or impassable terrain is in the way, the unit takes
the shortest way round (`lib/path.cjs`: a 1" grid, pulled straight, with the distance measured along the path and
difficult terrain still costing its flat 2" once). Charges and pursuits stay straight lines at their target. The AI
scores each candidate move at the point it would really reach, not at the point it aims for. Before this, 44% of
the World Eaters' Rhino moves stopped short of a spot the AI rated higher, two thirds of them behind a friendly
unit; now 34% do, and nearly all of those are spots the way round can't reach in one move or at all. The average
Rhino move went from 6.3" to 7.1".

After a fight a unit consolidates for safety (cover, out of sight) and for markers and Sectors, with no Vanguard
boldness, since the enemy shoots next. A unit locked in combat controls nothing, so a charge also costs what the
charger scores where it stands, a marker or its share of a Sector, unless the target scores in the same place.
Together these added about three points to five melee lists against the eight strongest lists.

The army also keeps a plan from one turn to the next (`lib/plan.cjs`): each assault unit, and the transport
carrying it, commits to a target and keeps it unless another is clearly better, rather than re-deciding every turn.
A second part, waves (assault units staging in cover until two of them can strike in the same turn), is there with
`SIM_PLAN=wave` but off: against the strength lists it cost melee armies about a point, since holding back only
gives a gunline more turns to shoot. Keeping targets gained about one point.

Melee is still the weaker way to play in the simulator. A typical assault unit now reaches combat on turn 2 and
often wipes its target in one round, which leaves it in the open for the enemy's whole army to shoot. Steering
charges towards targets that keep the charger locked in combat (out of the guns) made no measurable difference.

## Where the rules come from

Four sources, marked in the code:

- CONFIRMED: the HH3 rule texts in this repo (data/bsdata/common.json and the army data), for weapon and unit
  special rules, reactions, Psychic Weapons and wargear.
- SHEET: the "How to Play – Horus Heresy 3rd Edition" quick reference by The Bearded Swede, for the turn
  sequence, the Hit Test tables, statuses, the Set-up Move, challenges, core gambits, Combat Resolution and its
  aftermath, the Reaction Allotment, Core Reactions, the Vehicle Damage Table, Perils and terrain. It's a
  summary, so details it leaves out are still guesses.
- MISSION: the Core Mission Pack: Imperium at War (the missions, Deployment Maps, objective control, Kill Points,
  Sectors, secondaries, Reserves, battle length and terrain).
- ASSUMPTION: what none of them settles. These are the ones left:

| Rule | Assumption |
|---|---|
| Objective Markers | placed at random where the mission allows (players placing them for advantage isn't modelled); the roll-off loser picks the zone nearer the valuable markers |
| Controlling | a unit's models within 3" of a marker are the share of its footprint in range; in Seize Ground all of a unit's models count in the Sector holding its centre |
| Terrain | Medium Area Terrain is difficult, Light isn't; no Heavy Area Terrain; Cavalry can't claim cover |
| Vehicles' Defensive weapons (Intercept) | Strength 6 or less |
| Master of the Legion | its extra Reaction Point only while it's on the battlefield |
| Blast markers | a 3" marker covers 3 models of a packed unit, a 5" marker 5; a missed Blast scatters away harmlessly |
| Engaged models | every model in a locked unit fights (no 2" engagement or pile-in geometry) |
| Vehicle saves | vehicles take Invulnerable Saves against Penetrating and Glancing Hits, but not Cover Saves |
| Collar-master | the AI overloads a collared unit of five or more models that is in combat |
| Swift of Action | the White Scars always take the +2 Movement, so it counts in the enemy turn too |
| Unchosen weapons | where a list leaves a required weapon pick unset, a model takes the default its exchange option names, or the cheapest melee weapon from its weapon group. Since the builder's data now gives those units their default weapons, this only matters for hand-written lists that skip a required pick |
| Morale after a charge | checks from Overwatch are taken straight after the charge |
| Disgraced | removed like other statuses, with a Cool Check |
| Perils names | Ætheric Feedback for the wounds, Warp Rupture for Stunned (Psy-Shock forces Warp Rupture) |
| Thin the Ranks | a Prime unit counts as improved when its Prime Advantage changes its profile |
| Take Cover | belongs to the Imperialis Militia and Solar Auxilia |
| Furious Charge | the text makes the "Target Unit" Lost to the Nails; read as the reacting World Eaters unit |
| Anathema | Immaterial weapons wound only on a 5+ (from the rule's summary line; its full text is cut short) |
| Characters | join before deployment and stay with their unit (they don't leave mid-battle); one character per unit |
| Not simulated | Death or Glory (vehicles don't move through units here), Dangerous terrain, coherency |

Reactions made in answer to a reaction (a Return Fire against an Overwatch, say) aren't allowed.

## Files

| File | What it does |
|---|---|
| `run.cjs` | command line: plays N battles and prints a summary |
| `lib/battle.cjs` | the battle loop: deployment, Player Turns, scoring, secondaries |
| `lib/army.cjs` | loads lists through the builder's engine into units and models |
| `lib/table.cjs` | the table, terrain, distances, line of sight and movement |
| `lib/mission.cjs` | the nine Core Missions, Deployment Maps, Sectors and Objective Marker set-up |
| `lib/scoring.cjs` | controlling markers and Sectors, Kill Points, secondaries and the scoring mission rules |
| `lib/move.cjs` | Reserves, moving, Rushing, transports, Fall Back |
| `lib/shoot.cjs` | Shooting Attacks and the Morale Sub-Phase |
| `lib/assault.cjs` | charges, challenges, fights and Combat Resolution |
| `lib/attack.cjs` | Hit and Wound Tests, saves and damage for one group of attacks |
| `lib/fire.cjs` | which weapons each model fires |
| `lib/checks.cjs` | Characteristic Checks, Fear, Tactical Statuses |
| `lib/reactions.cjs` | every reaction, its trigger and its value to the AI |
| `lib/psychic.cjs` | Willpower Checks, Force, Perils, Psy-Shock and Psychic Powers |
| `lib/gambits.cjs` | gambits for challenges |
| `lib/ai.cjs` | the decisions: moves, targets, charges, reactions |
| `lib/core.cjs` | every core-rule number and assumption in one place |
| `lib/legions.cjs` | the Legion Tacticas and where each applies |
| `lib/characters.cjs` | which characters may join which units, and the AI's choice |
| `lib/plan.cjs` | the army's plan kept between turns: assault targets, and optional waves |
| `lib/path.cjs` | the way round units and impassable terrain when a straight move is blocked |
| `tournament.cjs` | round robin between many lists, in parallel workers |
| `report.cjs` | standings, ratings and unit efficiency from a tournament |
| `lists/` | sample lists: two Rangdan (`rangdan.json`, the original mixed list, and `rangdan-iron-wall.json`), Sons of Horus at 2585 and 3000 points, an Ork Weirdboy mob |
| `lists/legions/`, `lists/strong/` | a generic list and a strength list per Legion, and the scripts that make them; `lists/builder.cjs` is shared |
