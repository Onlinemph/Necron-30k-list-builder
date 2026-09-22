# Data schema

All army data lives in `data/*.json` and is transcribed from
*Codex Xenologica – Necrons (Horus Heresy 3rd edition) v1.4.2, August 2026*.
The per-page text lives in `source/pages/pNNN.txt` (PDF page N == printed page N).

Rules for transcription:

- Copy names, numbers and rules text exactly as printed. Fix obvious PDF-extraction
  junk (broken words, doubled spaces, "--" bullet markers), but never "correct" game content.
  If the source itself contains an obvious typo (e.g. "Immortal Guardian" on the Hierotek
  Circle page), keep the source text and add a `"note"` field explaining it.
- Use `–` (en dash) for a characteristic printed as a dash.
- Every object has a `"page"` field (the printed page number).
- Characteristics are strings (`"2+"`, `"–"`, `"D3"`, `"+2"`, `"I"`, `"A"`) or numbers when plainly numeric.

## units.json  →  `{ "units": [Unit, ...] }`

```jsonc
{
  "id": "necron-overlord",            // kebab-case, unique
  "name": "Necron Overlord",          // as printed in the page heading
  "role": "High Command",             // one of: Warlord, High Command, Command, Retinue, Elites,
                                      // Heavy Assault, Troops, Support, War Engine, Transport,
                                      // Heavy Transport, Recon, Fast Attack, Armour, Lord of War, Fortification
  "page": 10,
  "limit": null,                      // "0-1" if the heading says 0-1, else null
  "unique": false,                    // true for Dramatis Personae (named characters)
  "basePoints": 100,
  "composition": "1 Overlord",        // the printed "Unit composition" text
  "models": [                         // every model type that can appear in the unit
    {
      "name": "Overlord",
      "min": 1,                       // how many of this model the base unit contains
      "max": 1,                       // maximum of this model type (after additions)
      "costPerExtra": 0,              // points per model added above min (0 if none can be added)
      "profile": {                    // infantry-style profile ...
        "M": 6, "WS": 5, "BS": 5, "S": 6, "T": 6, "W": 6, "I": 4, "A": 4,
        "LD": 10, "CL": 10, "WP": 9, "IN": 9, "SAV": "2+", "INV": "–"
      },
      // ... OR vehicle-style profile:
      // "profile": { "M": 12, "BS": 4, "FRONT": 12, "SIDE": 12, "REAR": 10, "HP": 5, "CAPACITY": 10 }
      "wargear": ["Voidblade"],       // default wargear of THIS model type
      "unitType": "Infantry (Command)",// the printed unit type for THIS model type
      "specialRules": []              // special rules that apply ONLY to this model type
    }
  ],
  "traits": ["Xenos", "Necron"],      // traits of the whole unit (per-model traits: put in note)
  "specialRules": ["Eternal Warrior (1)", "Ever-Living (5+)", "My Will Be Done (3)"],
  "unitRules": [                      // special rules printed in full ON the unit page
    { "name": "Among the Ranks", "text": "..." }
  ],
  "cryptoArkana": false,              // true if the unit has the [Crypto-Arkana] placeholder trait
  "fixedArkana": null,                // e.g. "Chronomancy" for a named Cryptek with a fixed arkana
  "options": [Option, ...],
  "note": null
}
```

Model swaps that change the model type (e.g. "Any Royal Warden may be exchanged for 1 Triarch
Warden for +20 points", "one Macrocyte Warrior may be exchanged for a Macrocyte Accelerator for
+10 points") are modelled as an extra entry in `models` with `min: 0`, and an Option of kind
`"swapModel"` (see below).

### Option

Every printed bullet under Options / Special Rules that offers a choice becomes one Option.
The `text` field always holds the printed bullet text verbatim.

```jsonc
{
  "id": "melee",                      // unique within the unit
  "text": "This model may have its Voidblade exchanged for one item from the Nobility Melee Weapons List or for a Voidscythe at +20 points.",
  "kind": "one",                      // see kinds below
  "model": "Overlord",                // model type the option applies to (null = whole unit)
  "replaces": ["Voidblade"],          // wargear removed when a choice is taken ([] if nothing)
  "choices": [
    { "list": "nobility-melee" },     // pull in every item of a shared list (lists.json)
    { "name": "Voidscythe", "points": 20 }
  ],
  "max": null,                        // see "max" below
  "requires": null                    // option id that must have a selection first, if any
}
```

Kinds:

- `"one"`    – pick at most one choice for the unit / single model. Points added once.
- `"any"`    – each choice is a checkbox; any combination. Points added once per choice.
- `"perModel"` – the choice can be taken by several models ("Any model in the unit may…",
  "For every 5 models…", "Up to two models…"). The user enters a count per choice.
  Points are multiplied by the count. Use `max` to express the limit.
- `"swapModel"` – exchange a model of type `model` for the model type named in
  `choices[0].name`, costing `choices[0].points` each. Uses `max` like perModel.
- `"upgrade"` – a single yes/no upgrade (e.g. "may be upgraded to have the Dynastic Scion
  Special Rule … +20 points"). Exactly one choice.

`max` (only for perModel / swapModel):

- `null`                        → no limit other than the number of eligible models
- `{ "fixed": 2 }`              → at most 2 in the unit
- `{ "per": 5, "count": 1 }`    → one for every 5 models in the unit
- `{ "shared": "grp" }`         → all options with the same `shared` key draw from one pool of
                                  eligible models (use this when "any model may take ONE of
                                  the following" is split across two options)

Crypto-Arkana lists: for Crypteks use `{ "list": "arkana-weapons" }` and
`{ "list": "techno-arkana" }`; the app resolves them against the arkana chosen for the unit.

## lists.json  →  `{ "lists": [ { "id", "name", "page", "items": [ { "name", "points" } ] } ] }`

Shared wargear lists. Known ids: `nobility-melee`, `nobility-wargear`, `necron-cannons`,
`arkana-weapons:Chronomancy` (… one per arkana), `techno-arkana:Chronomancy` (… one per arkana).
`points` is a number (0 for "free").

## arkana.json → `{ "arkana": [ { "name": "Chronomancy", "page": 20, "harbinger": {"name", "text"}, "wargear": [ {"name","text"} ] } ] }`

## weapons.json → `{ "ranged": [...], "melee": [...] }`

```jsonc
// ranged
{ "name": "Gauss Flayer", "page": 107, "R": 24, "FP": 1, "RS": 5, "AP": 4, "D": 1,
  "specialRules": ["Breaching (6+)"], "traits": ["Gauss"],
  "modes": null }            // or modes: [ { "name": "Low Power", "R":..,"FP":..,"RS":..,"AP":..,"D":..,"specialRules":[...],"traits":[...] } ]
// melee
{ "name": "Voidblade", "page": 111, "IM": "I", "AM": "A", "SM": "+1", "AP": 3, "D": 1,
  "specialRules": [], "traits": ["Power"], "modes": null }
```

A weapon that has both a ranged and a melee profile appears in both arrays.

## wargear.json → `{ "wargear": [ { "name", "page", "text" } ] }`  (non-weapon items)

## rules.json → `{ "specialRules": [ { "name", "page", "text" } ], "reactions": [...], "gambits": [...], "primeAdvantages": [...], "traits": [...] , "powersOfTheCtan": [...] }`

Names of variable rules are generic: `"Ever-Living (X)"`, `"Firing Protocols (X)"`.

## detachments.json

```jsonc
{ "detachments": [ {
  "id": "canoptek-phalanx", "name": "Canoptek Phalanx", "type": "Auxiliary" | "Apex",
  "page": 91,
  "unlock": "text of the unlock condition",
  "unlockedBy": { "commandTrait": "[Crypto-Arkana]" } | { "sequela": "Awoken Vaults" } | null,
  "slots": [ { "role": "Recon", "prime": false, "flexible": false } ],   // one entry per slot icon
  "restrictions": [ "Only Units with the Canoptek Trait may be selected to fill any Slots in this Detachment." ],
  "rules": [ { "name", "text" } ]
} ] }
```

## sequelae.json → `{ "intro": "...", "sequelae": [ { "name", "page", "text", "restrictions": [...] } ] }`
