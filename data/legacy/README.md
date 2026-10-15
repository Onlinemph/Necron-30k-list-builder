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
  "wargear": [ { "name": "Artificer armour", "text": "..." } ],
  "weapons": {
    "ranged": [ { "name": "Archaeotech pistol", "R": 12, "FP": 1, "RS": 6, "AP": 3, "D": 1, "specialRules": ["Pistol"], "traits": [] } ],
    "melee":  [ { "name": "Ritual blade", "IM": "+1", "AM": "A", "SM": "+1", "AP": 3, "D": 1, "specialRules": [], "traits": ["Power"] } ]
  }
}
```

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

```jsonc
{
  "name": "The Butcher's Host",
  "flavor": "One line of in-world colour.",
  "text": "What the Rite does, in full, as players will read it in the configuration panel.",
  "roles":   [ { "units": ["rampager-squad"], "role": "Troops" } ],   // may also fill this slot
  "forbid":  [ { "match": { "role": "Armour" } } ],                    // can't be taken with this Rite
  "require": [ { "units": ["kharn-the-bloody", "praetor"], "min": 1, "note": "Led from the front." } ],
  "limit":   [ { "match": { "role": "Lord of War" }, "max": 0 } ],
  "points":  [ { "units": ["inductii-squad"], "delta": -10 } ],
  "options":   [ /* as above, only with this Rite */ ],
  "modifiers": [ /* as above, only with this Rite */ ],
  "rules":     [ { "name": "...", "text": "..." } ]
}
```

Write a Rite the 3rd edition way: one clear benefit, one clear cost, and a reason a player would pick it.
Keep the benefit tied to the Legion's story and the cost painful enough that the list changes shape.
