# Drukhari data: differences from data/SCHEMA.md

Source: *Codex Xenologica – Drukhari (Horus Heresy 3rd edition)*, v1.13, March 2026, by Ana — the same
author and layout as the Necron codex, so follow `data/SCHEMA.md` exactly and use the Necron files in
`data/parts/` as worked examples. Per-page text: `source/drukhari/pages/pNNN.txt` (PDF page N == printed page N).

Differences:

- **[Partisan] trait.** Units whose Traits list `[Partisan]` get `"factionChoice": true`. Units printed with a
  specific partisan trait get `"fixedChoice": "Kabals"` / `"Cults"` / `"Covens"`. Do not list the partisan
  trait in `traits`.
- **[Combat Drugs] trait.** Units whose Traits list `[Combat Drugs]` get `"combatDrugs": true` (the app adds the
  drug choice itself — do not write an option for it). If a unit prints a specific drug, set
  `"fixedDrug": "<name>"`. Do not list the drug trait in `traits`.
- **Wargear list items limited to once per army** (e.g. Haemonculus Arcana): add `"oncePerArmy": true` to the item.
- Roles: "War Engines" → `War Engine`, "Lords of War" → `Lord of War`, "Heavy Transports" → `Heavy Transport`.
- Keep sub-types like "(Light, Sergeant)" inside each model's `unitType`.
