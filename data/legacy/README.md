# Legacy house rules

Optional extras layered over the official BSData armies: Rites of War, restored Legion wargear and
options, and more varied statlines. None of it is official 3rd edition content. A list only sees it after
picking **House rules → Legacy rules** in the Army configuration panel; a Rite of War is then a second
choice in the same panel. Lists that don't opt in are untouched.

`scripts/build-data.mjs` merges these files through `scripts/legacy.mjs` and fails the build on any
unknown unit id, stat or option kind.

All text here is written for this builder. Don't paste rules text from published books.

## Files

- `legiones-astartes.json` applies to every Legion (and the Blackshields and Shattered Legions).
- `<army-id>.json` applies to that army only (`world-eaters.json`, `solar-auxilia.json`...).

## Top level

```jsonc
{
  "rites": [ /* Rites of War, see below */ ],
  "options": [ /* extra options, live whenever Legacy rules is on */ ],
  "modifiers": [ /* statline and rule changes, live whenever Legacy rules is on */ ],
  "points": [ { "units": ["rhino"], "delta": -5 } ],
  "rules": [ { "name": "Blood Frenzy", "text": "..." } ],
  "armyRules": [ { "name": "Warrior Brotherhood", "text": "...", "match": { "notUnitType": "Vehicle" } } ],
  "wargear": [ { "name": "Artificer armour", "text": "..." } ],
  "weapons": {
    "ranged": [ { "name": "Archaeotech pistol", "R": 12, "FP": 1, "RS": 6, "AP": 3, "D": 1, "specialRules": ["Pistol"], "traits": [] } ],
    "melee":  [ { "name": "Ritual blade", "IM": "+1", "AM": "A", "SM": "+1", "AP": 3, "D": 1, "specialRules": [], "traits": ["Power"] } ]
  }
}
```

`armyRules` are the army's own special rules (old-style Legion rules). They show as rule chips in the Army
configuration panel while Legacy rules is on, print on the roster, and are added to the datasheets of the
units given by `units`/`match` (leave both out for a rule that's only army-wide text). They may carry
`stats` and `condition` like a modifier.

Names of new weapons, wargear and rules must not match an official BSData name; the build rejects a clash.
Weapon and wargear names must match option choices exactly so the app can show their profiles.
Special rules named on weapons, units or modifiers should exist in the core rules (`Rending (X)`,
`Feel No Pain (X)`, `Fear (X)`...) or be defined under `rules`.

## Targeting units

Every option, modifier, points change, role and limit names the units it touches with either or both of:

- `"units": ["tactical-squad", "veteran-tactical-squad"]` (ids from `data/bsdata/<army>/parts/units.json`;
  `"*"` means every unit). Add `"optionalUnits": true` in the shared file when a unit might be missing.
- `"match": { "role": "Troops", "roles": [...], "nameIncludes": ["Terminator"], "trait": "...",
  "category": "...", "unitType": "Antigrav" }`. All filters given must hold.

## Options

```jsonc
{ "units": ["tactical-squad"], "option": {
    "id": "veteran-sergeant", "kind": "upgrade", "model": "Sergeant",
    "text": "The Sergeant may be upgraded to a Veteran Sergeant",
    "choices": [ { "name": "Veteran Sergeant", "points": 10 } ] } }
```

`kind` is `one` (swap, `replaces` lists what goes), `any`, `perModel` (with `max`) or `upgrade`.
`model` is a model name in the unit, or null for the whole unit. The text gets a "Legacy:" prefix.

## Modifiers

```jsonc
{ "units": ["rampager-squad"], "models": ["Rampager Champion"], "text": "Butcher's Nails: +1 A.",
  "stats": { "A": "+1", "WS": "+1", "SAV": "best:2+", "LD": "=9" },
  "addRules": ["Rending (6+)"], "removeRules": [], "scope": "model" }
```

Stat changes are `+N`, `-N`, `=X` (set) or `best:N+` (use this save if it's better). Add `"item": "Name"`
to make the change ride on a piece of wargear (Artificer armour giving 2+); it only applies while Legacy rules (or that Rite) is on.
Add `"condition": "when charging"` to show the change as a reminder instead of applying it.

## Rites of War

A Rite reads like the ones in the old books: a line of flavour, then Benefits and Limitations. It changes
how the army fights and what it may take. It never changes points (the build rejects `points` in a Rite).

```jsonc
{
  "name": "The Butcher's Due",
  "flavor": "One line of in-world colour.",
  "text": "Optional sentence on what the Rite is about.",
  "benefits": [ "Red Butchers may fill Troops slots and gain The Butcher's Chosen...", "Inductii gain +1 Attack." ],
  "limitations": [ "Angron or Kharn must be in the army.", "No Recon units." ],
  "roles":   [ { "units": ["red-butchers"], "role": "Troops" } ],      // may also fill this slot
  "forbid":  [ { "match": { "role": "Recon" } } ],                     // can't be taken with this Rite
  "require": [ { "units": ["angron", "kharn-the-bloody"], "min": 1, "note": "Angron or Kharn must lead." } ],
  "limit":   [ { "match": { "role": "Heavy Transport" }, "max": 1 } ],
  "options":   [ /* as above, only with this Rite */ ],
  "modifiers": [ { "units": ["red-butchers"], "addRules": ["The Butcher's Chosen", "Fear (1)"] } ],
  "rules":     [ { "name": "The Butcher's Chosen", "text": "Legacy house rule (The Butcher's Due). ..." } ]
}
```

The benefits and limitations are what players read in the configuration panel, so they must describe
everything the data does, plus any table-top rule the builder can't check (deployment, Reserves, who
must charge whom). Give a Rite's signature effect a named rule under `rules` and put it on the units with
`addRules`, so it shows on their datasheets. Benefits should be a named rule, a role change or a small
stat change; limitations should change the list's shape.
