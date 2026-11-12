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

The table is 72" × 48" with point-symmetric terrain (ruins and buildings block sight; ruins, woods, craters and
barricades give cover; ruins, woods and craters are difficult; buildings are impassable). Units are circles sized
from their models' bases. Ranges are edge to edge, and line of sight is three sight lines between the circles.

The mission has five objectives (3 VP in the centre, 2 VP on the diagonals, 1 VP on the flanks), 12" deployment
zones and five Battle Turns. Secondaries: Slay the Warlord, First Strike, Giant Killer and Last Man Standing.

Each Player Turn runs the HH3 phases in order:

- **Movement:** Reserves (Deep Strike from turn 2, one per turn; Outflank from the side edges; Flyers),
  moving, Rushing, embarking and disembarking (Disordered unless from an Assault Vehicle), and Fall Back Moves
  for Routed units.
- **Shooting:** one weapon per model (two Pistols, Firing Protocols (X), Walkers and Vehicles fire everything),
  Fire Groups, Hit Tests, Wound Tests or Armour Penetration, the best of Armour, Invulnerable and Cover saves,
  Feel No Pain and Shrouded, then the Morale Sub-Phase checks for Pinning, Suppressive, Stun, Panic and heavy
  casualties.
- **Assault:** the five-step charge (Set-up Move, Volleys, Charge Roll), challenges with gambits and the Focus
  Roll, Initiative Steps, Combat Resolution, Panic Checks, Fall Back and Pursuit.
- **End:** conditions that wear off, Statuses Sub-Phase (Cool, Leadership, Repair Tests), and scoring.

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
of the allotment (the bar rises as the allotment runs low). Simulated reactions:

| Trigger | Reactions |
|---|---|
| An enemy ends a move | Reposition, Chasing the Wind (White Scars), The Hunt Closes (Rangdan), Bastion of Fire (Imperial Fists) |
| An enemy arrives from Reserves | Moonfall (Rangdan) |
| A Shooting Attack | Return Fire, Smokescreen, Shieldwall!, Take Cover, Living Shields (Rangdan), Bitter Fury (Iron Warriors), Bestial Savagery (Space Wolves), Barbaran Endurance (Death Guard), Brutal Tide (World Eaters), Retribution Strike (Ultramarines), Shadow Veil (Raven Guard), Wrath of Angels (Blood Angels), Glorious Martyrdom (Word Bearers), Smoke and Mirrors (Alpha Legion) |
| A charge | Overwatch, The Choir Answers (Rangdan), Twisted Desire and Perfect Counter (Emperor's Children), Spite of the Gorgon (Iron Hands), Selfless Burden (Salamanders), Shieldwall!, Evade, Better Part of Valour (Night Lords), Furious Charge (World Eaters) |
| The end of a combat | Vengeance of the First Legion (Dark Angels) |
| A challenge | Warrior Pride (Sons of Horus) |

The Legion reactions go to an army by its Legion; BSData Legion lists don't put the Legion's Trait on each unit, so
the simulator adds it from the army. Fan armies list their reactions in their own rules. Adding one means adding
an option to the right trigger in `lib/reactions.cjs`.

### Psychic

Psykers are units with the Psyker Trait or a Psychic Discipline taken as wargear. Psychic Weapons fire and strike
like any other weapon; Force (X) takes a Willpower Check (less Fear) to double X, and any double is Perils of the
Warp. Titans and Ordinatus ignore Psychic Weapons; Anathema ignores Psychic damage and Perils. Of the Psychic Powers,
only those with full texts in the repo are played: Warpath (Power of the Waaagh!) for now. The core Disciplines'
Powers and Psychic Reactions aren't in the repo, so they're left out.

### Gambits

Before the Focus Roll each duellist may pick a gambit with a full text in the repo: the Rangdan three
(Throat-Hunter, Hunter's Stare, Feast of Memories) and character gambits with plain number effects. The core
rulebook's generic gambits aren't in the repo; a model without a gambit fights the challenge as normal.

## The AI

Every choice is scored in expected points (a Victory Point counts as 45 points): damage a unit can deal, damage
it will take where it stands when the enemy acts next, objectives it holds or approaches, and the value of
statuses it could inflict. Moves are picked from candidate spots (twelve directions, objectives, enemies, cover),
targets by expected points plus status value, charges by expected melee exchange against the shooting it takes
going in. It doesn't plan more than one turn ahead and doesn't coordinate units.

## What's assumed

Values marked CONFIRMED come from rule texts in this repo (data/bsdata/common.json, the army data). Everything
else is a best guess and lives in `lib/core.cjs` so it can be corrected in one place.

| Rule | Assumption |
|---|---|
| Battle length | 5 Battle Turns, scoring from turn 2 |
| Reaction Allotment | 1 + 1 per 1000 points of the points limit |
| Statuses | Pinned can't move or charge; Suppressed fires Snap Shots; Stunned can't shoot or react; Routed can't shoot, charge or react and falls back; any status fights at Initiative 1 |
| Fall Back | Initiative + D6 (Cavalry: + 2D6, CONFIRMED) |
| Failed charge | the Cool Check (CONFIRMED) gives Pinned on a fail |
| Heavy casualties | losing a quarter of the unit in one attack forces a Panic Check |
| Snap Shots | hit on 6s |
| Cover | 5+ from any cover piece; none for Cavalry |
| Vehicles answering Return Fire and Overwatch | weapons of Strength 6 or less |
| Vehicle Damage Table | 1–2 Pinned, 3–4 Suppressed, 5–6 Stunned |
| Charge range | charges declared within 12" |
| Set-up Move | half of M + I (M for Heavy), rounded up, capped at 6" (the cap is CONFIRMED) |
| Combat Resolution | wounds and Hull Points inflicted, +1 for more models; the loser tests Leadership minus the difference |
| Pursuit | Initiative + D6; matching the Fall Back distance destroys the unit |
| Refusing a challenge | the refuser is Disgraced and sits the fight out |
| Outside Support | +1 to the Focus Roll per 5 friendly models, at most +2 |
| Objectives | held within 3"; vehicles, Heedless, Automata and Cavalry (without Strike and Fade) can't hold them |
| Tactical Strength | 1 per model, plus Line (X) |
| Secondaries | Slay the Warlord 3, First Strike 1, Giant Killer 2, Last Man Standing 1 |
| Reserves | arrive on a 3+, all by turn 4 |
| Perils of the Warp | 1–3 Ætheric Feedback (D3 wounds), 4–6 Warp Rupture (Stunned) |
| Blast markers | a 3" marker covers 3 models of a packed unit, a 5" marker 5; a missed Blast scatters away harmlessly |
| Take Cover | belongs to the Imperialis Militia and Solar Auxilia |
| Furious Charge | the text makes the "Target Unit" Lost to the Nails; read as the reacting World Eaters unit |
| Anathema | Immaterial weapons wound only on a 5+ (from the rule's summary line; its full text is cut short) |

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
