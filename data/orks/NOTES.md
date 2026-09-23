# Orks data: differences from data/SCHEMA.md

Source: *Xenos Forces of the Age of Darkness – Orks, 3rd Edition Rules* by Always Strikes First
(unofficial, October 2025). Per-page text: `source/orks/pages/pNNN.txt` (PDF page N == printed page N).

Follow `data/SCHEMA.md` for units, options, lists, weapons, wargear and rules, with these changes:

- **Great Clan choice.** Units whose Traits include `[Orks]` get `"factionChoice": true`
  (instead of `cryptoArkana`). Units printed with a specific clan trait (e.g. `Freebooters`,
  `Bad Moons`) get `"fixedChoice": "<Clan>"`. Do not list `[Orks]` in `traits`; do list `Xenos`.
- Clan names, exactly: `Bad Moons`, `Blood Axes`, `Deathskulls`, `Evil Sunz`, `Goffs`, `Snakebites`, `Freebooters` (spelled as on the clan pages 44–49; the list on page 3 has typos).
  (Page 3 prints "Bad Moons" twice; check the clan rules pages 43–49 for the real list and note any difference.)
- Roles use the same names as the Necron list: "WAR-ENGINE" → `War Engine`, "LORDS OF WAR" → `Lord of War`.
- Sub-types like "(Sergeant, Light)" stay inside each model's `unitType` string.

## clans.json → `{ "arkana": [ ... ] }`  (same shape as Crypto-Arkana, one entry per clan)

```jsonc
{ "name": "Bad Moons", "page": 44,
  "harbinger": { "name": "Bad Moons", "text": "<every clan rule on the page, verbatim, as one text>" },
  "wargear": [ { "name": "Ammo Runt", "text": "..." } ],     // clan-specific wargear rules text
  "gambits": [ { "name": "Ostentatious Showoff", "text": "..." } ],
  "reactions": [ { "name": "...", "text": "..." } ] }
```

## choice-effects.json → `{ "effects": [ ... ] }`  (clan list-building effects)

Same shape as `data/sequela-effects.json` options, but keyed by clan instead of Sequela:

```jsonc
{ "choice": ["Bad Moons", "Freebooters"],          // clans that get it
  "type": "option",
  "filter": { "unitTypeAny": ["Command", "Champion", "Specialist"] },   // and/or "units": [ids], "trait", "role"
  "units": ["flash-gitz-mob"],                      // optional: OR-ed with filter when "anyOf": true
  "anyOf": true,
  "option": { "id": "clan-ammo-runt", "kind": "perModel", "text": "<verbatim>", "choices": [ { "name": "Ammo Runt", "points": 5 } ] } }
```

Clan Prime Advantages go in `granted-prime-advantages.json`:
`{ "grantedPrimeAdvantages": [ { "name", "page", "text", "eligible": { "choice": ["Blood Axes"], "roles": ["Command"] }, "extraSlot": true|false } ] }`
(`extraSlot: true` when the advantage adds a Force Organisation slot like Logistical Benefit.)

Clan effects that change a datasheet go in `modifiers.json` (schema in data/SCHEMA.md) with
`"source": { "type": "arkana", "name": "<Clan>" }`.
