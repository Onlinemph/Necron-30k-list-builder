# Battle simulator

Plays two army lists from the builder against each other on a simple table, turn by turn, with an AI making the
decisions for both sides. It's meant for testing lists and points, not for replacing a game: the table is
abstract and the rules are only as good as the texts in this repo (see "What's assumed" below).

```
node sim/run.cjs sim/lists/rangdan.json sim/lists/sons-of-horus.json --battles 100
node sim/run.cjs my-list.json "https://…#a=…" --battles 50 --seed 7 --log 2> battle.txt
```

A list is a JSON file saved from the builder, or a share link. Each battle gets a fresh table, and the two armies
swap deployment zones and the first turn every other battle. `--log` writes a readable play-by-play of the first
battle to stderr; `--out file.json` saves the summary (win rates, VP, points destroyed per unit, reactions used).

From code:

```js
const { runBattle } = require('./sim/lib/battle.cjs');
const r = runBattle(listA, listB, { seed: 3, log: true });
// r.winner (0, 1 or null), r.vp, r.pointsKilled, r.units, r.vpLog, r.reactions, r.powers, r.log
```

## What it plays

The table is 72" × 48" with point-symmetric terrain: ruins and buildings are Heavy (4+ cover, block sight),
woods and barricades Medium (5+ cover; woods block sight through more than 3"), craters Light (6+ cover); ruins,
woods and craters are difficult and buildings impassable. Units are circles sized
from their models' bases. Ranges are edge to edge, and line of sight is three sight lines between the circles.

The mission has five objectives (3 VP in the centre, 2 VP on the diagonals, 1 VP on the flanks), 12" deployment
zones and five Battle Turns. Secondaries: Slay the Warlord, First Strike, Giant Killer and Last Man Standing.

Each Player Turn runs the HH3 phases in order:

- **Before the battle:** roll-off, deployment, and Seize the Initiative on a 6.
- **Movement:** Reserves on a 3+ (Deep Strike from turn 2, one per turn; Outflank from the side edges; Flyers),
  moving, Rushing, embarking and disembarking (Disordered unless from an Assault Vehicle), and Fall Back Moves
  for Routed units (D6 + I; at the table edge a Leadership check, removed on a fail, Suppressed on a pass).
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
Support Unit, Expendable, Infiltrate, Deep Strike, Outflank, Firestorm, Skyfire, Prey Instinct and Worm Gestalt.
Profiles, rules and wargear come from the builder's own engine, so Legion rules, war-moons and wargear options
apply exactly as they do in the app.

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
going in. It doesn't plan more than one turn ahead and doesn't coordinate units.

## Where the rules come from

Three sources, marked in `lib/core.cjs`:

- CONFIRMED: the HH3 rule texts in this repo (data/bsdata/common.json and the army data), for weapon and unit
  special rules, reactions, Psychic Weapons and wargear.
- SHEET: the "How to Play – Horus Heresy 3rd Edition" quick reference by The Bearded Swede, for the turn
  sequence, the Hit Test tables, statuses, the Set-up Move, challenges, core gambits, Combat Resolution and its
  aftermath, the Reaction Allotment, Core Reactions, the Vehicle Damage Table, Perils and terrain. It's a
  summary, so details it leaves out are still guesses.
- ASSUMPTION: what neither settles. These are the ones left:

| Rule | Assumption |
|---|---|
| Battle length | 5 Battle Turns, scoring from turn 2 |
| Mission | 5 objectives (3/2/2/1/1 VP), held within 3"; Tactical Strength 1 per model plus Line (X) |
| Who holds objectives | not vehicles, Heedless, Automata, or Cavalry without Strike and Fade |
| Secondaries | Slay the Warlord 3, First Strike 1, Giant Killer 2, Last Man Standing 1 |
| Reserves | everything arrives by turn 4 |
| Cover | Cavalry can't claim it; which terrain piece is which density |
| Vehicles' Defensive weapons (Intercept) | Strength 6 or less |
| Master of the Legion | its extra Reaction Point only while it's on the battlefield |
| Blast markers | a 3" marker covers 3 models of a packed unit, a 5" marker 5; a missed Blast scatters away harmlessly |
| Engaged models | every model in a locked unit fights (no 2" engagement or pile-in geometry) |
| Morale after a charge | checks from Overwatch are taken straight after the charge |
| Disgraced | removed like other statuses, with a Cool Check |
| Perils names | Ætheric Feedback for the wounds, Warp Rupture for Stunned (Psy-Shock forces Warp Rupture) |
| Take Cover | belongs to the Imperialis Militia and Solar Auxilia |
| Furious Charge | the text makes the "Target Unit" Lost to the Nails; read as the reacting World Eaters unit |
| Anathema | Immaterial weapons wound only on a 5+ (from the rule's summary line; its full text is cut short) |
| Not simulated | Death or Glory (vehicles don't move through units here), Dangerous terrain, coherency |

Reactions made in answer to a reaction (a Return Fire against an Overwatch, say) aren't allowed.

## Files

| File | What it does |
|---|---|
| `run.cjs` | command line: plays N battles and prints a summary |
| `lib/battle.cjs` | the battle loop: deployment, Player Turns, scoring, secondaries |
| `lib/army.cjs` | loads lists through the builder's engine into units and models |
| `lib/table.cjs` | the table, terrain, distances, line of sight and movement |
| `lib/mission.cjs` | objectives and deployment zones |
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
| `lists/` | sample lists (Rangdan, Sons of Horus, an Ork Weirdboy mob) |
