# Necron 30k List Builder

An army list builder for **Codex Xenologica – Necrons (Horus Heresy 3rd edition)**, v1.4.2 (August 2026).

Open `index.html` in a browser. There's no build step and no server needed, and it works offline from `file://`. You can also host the folder on GitHub Pages.

## What it does

- Fills Force Organisation slots in a Crusade Primary Detachment, plus the codex's Auxiliary and Apex Detachments (unlocks and restrictions are shown on each one).
- Unit editor: model counts, model swaps (Triarch Wardens, Macrocyte Accelerators…), every wargear option from the codex with live points, shared lists (Nobility Melee/Wargear, Necron Cannons) and Crypto-Arkana weapon/techno-arkana lists that follow the chosen arkana.
- Prime slots and Prime Advantages. Picking Dynastic Advisors adds the two Crypto-Arkana Command slots.
- Aeonic Sequelae, limited to one, or two if the army has a Nemesor or Phaeron. Their list-building effects apply automatically: Dark Harvest's 30-strong Warrior units and Flensing Scarabs, Cult of Annihilation's Destroyer Lord as High Command, Horrors of Old's restricted unit list, the Plasmacyte, Charnel Displays, Hyperspace Hunter and Nemesor upgrades, and so on (`data/sequela-effects.json`).
- Checks: points limit, the 25% Warlord/Lord of War cap, named characters and 0-1 units, slot roles, detachment restrictions ("Only Units with the Canoptek Trait…"), option limits, a missing Crypto-Arkana, detachment unlocks.
- Full statlines, weapon profiles and special rules text for every unit. Click a rule chip to read it.
- Roster view with a rules glossary, ready to print.
- Save lists in the browser. Export as text, JSON or a share link, and import them back.

## The one thing you have to set

The Crusade Force Organisation Chart is printed in the Horus Heresy 3rd edition rulebook, not in the Necron codex. The builder starts with a guessed slot layout (`data/forceorg.json`). Use **Edit slots** on the Primary Detachment to match your rulebook. The app remembers your layout for new lists. Core rulebook detachments you want to use can be added as a **Custom** detachment.

Rules from the core rulebook (Bulky, Deep Strike, Eternal Warrior…) are labelled `core` because their text isn't in the codex.

## Data

All 70 units, 136 weapon profiles, 21 detachments and 12 Aeonic Sequelae are transcribed from the codex PDF into `data/parts/*.json` (schema in `data/SCHEMA.md`). The per-page source text lives in `source/pages/`.

```
npm run build   # merge data/parts → data/necrons.json + js/data.js, check references
npm test        # build, then run the engine tests
```

Known gaps in the codex itself (v1.4.2): *Dynastic Protocols (X)*, *Interception Protocols* and *Phase-Tunnel Cutters* are named but never printed in full. A few typos are kept as printed and flagged in each unit's `note`.
