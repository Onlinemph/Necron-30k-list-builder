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

### Legion Tacticas

Each Legion's Tactica (from the Legion Tactica or base Rite of War text in its army data) applies to units made
only of that Legion's models (`lib/legions.cjs`): The Angel of Death, Flawless Execution, The Bitter End, Swift of
Action, The Hunter's Strike, Fire Discipline, A Talent for Murder, Encarmine Fury, The Gorgon's Scales, Violence
Incarnate, Tactical Flexibility, Remorseless Advance, Cult Arcana, Death Dealers, Unwavering Conviction,
Promethean Endurance and Blood of Fire, Shadow Walkers, and Lies and Obfuscation. The Legion's Advanced Reaction is
listed under Reactions; Legion gambits aren't played yet.

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

Psykers are units with the Psyker Trait or a Psychic Discipline taken as wargear. Psychic Weapons fire and strike
like any other weapon; Force (X) takes a Willpower Check (less Fear) to double X, and any double is Perils of the
Warp. Titans and Ordinatus ignore Psychic Weapons; Anathema ignores Psychic damage and Perils. Of the Psychic Powers,
only those with full texts in the repo are played: Warpath (Power of the Waaagh!) for now. Perils of the Warp is a
D6: on a 1 or 6 the psyker takes 13 minus its Willpower in wounds with only Invulnerable Saves, otherwise the
unit is Stunned. The core Disciplines'
Powers and Psychic Reactions aren't in the repo, so they're left out.

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
| `tournament.cjs` | round robin between many lists, in parallel workers |
| `report.cjs` | standings, ratings and unit efficiency from a tournament |
| `lists/` | sample lists: two Rangdan (`rangdan.json`, the original mixed list, and `rangdan-iron-wall.json`), Sons of Horus at 2585 and 3000 points, an Ork Weirdboy mob |
