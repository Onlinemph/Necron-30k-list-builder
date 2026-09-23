# Necron 30k List Builder

An army list builder for **Codex Xenologica – Necrons (Horus Heresy 3rd edition)**, v1.4.2 (August 2026).

**Live site:** https://onlinemph.github.io/Necron-30k-list-builder/

You can also open `index.html` straight from a download. There's no build step and no server needed, and it works offline from `file://`.

## Hosting on GitHub Pages

One-time setup: in the repo go to **Settings → Pages**, and under **Build and deployment → Source** choose **GitHub Actions**. That's it.

From then on, every push to the default branch runs the tests and publishes the app (`.github/workflows/pages.yml`). Pushes to other branches only run the tests. To redeploy by hand, open the **Actions** tab, pick **Deploy to GitHub Pages** and click **Run workflow**.

On a phone, open the site and use **Add to Home Screen**; it launches like an app.

## What it does

- Fills Force Organisation slots in a Crusade Primary Detachment, plus the codex's Auxiliary and Apex Detachments (unlocks and restrictions are shown on each one).
- Unit editor: model counts, model swaps (Triarch Wardens, Macrocyte Accelerators…), every wargear option from the codex with live points, shared lists (Nobility Melee/Wargear, Necron Cannons) and Crypto-Arkana weapon/techno-arkana lists that follow the chosen arkana.
- Prime slots and Prime Advantages. Picking Dynastic Advisors adds the two Crypto-Arkana Command slots.
- Aeonic Sequelae, limited to one, or two if the army has a Nemesor or Phaeron. Their list-building effects apply automatically: Dark Harvest's 30-strong Warrior units and Flensing Scarabs, Cult of Annihilation's Destroyer Lord as High Command, Horrors of Old's restricted unit list, the Plasmacyte, Charnel Displays, Hyperspace Hunter and Nemesor upgrades, and so on (`data/sequela-effects.json`).
- Checks: points limit, the 25% Warlord/Lord of War cap, named characters and 0-1 units, slot roles, detachment restrictions ("Only Units with the Canoptek Trait…"), option limits, a missing Crypto-Arkana, detachment unlocks.
- Full statlines, weapon profiles and special rules text for every unit. Click a rule chip to read it.
- Battlefield effects change the datasheet: Sequelae, Crypto-Arkana harbingers, wargear such as the Timesplinter Mantle or Canoptek Cloak, and Prime Advantages (including the ones Anrakyr, Zahndrekh, Toholk and Szeras grant) update the statline, rules, traits and unit type. Changed values are highlighted and lost rules are struck through. Effects that depend on the situation ("while joined by a Nemesor") are listed as reminders instead of being applied (`data/modifiers.json`).
- Roster view with a rules glossary, ready to print.
- Save lists in the browser. Export as text, JSON or a share link, and import them back.

## Force organisation

The Primary Detachment follows the Horus Heresy 3rd edition Crusade chart: 1 High Command, 3 Command (1 Prime), 4 Troops (1 Prime), 4 Transport. Each filled Command slot unlocks one Auxiliary Detachment, and filling High Command unlocks one Apex Detachment. The core Auxiliary, Apex, Warlord and Lord of War Detachments are in the **Add detachment** menu next to the Necron ones, and the core Prime Advantages (Master Sergeant, Combat Veterans, Paragon of Battle, Special Assignment, Logistical Benefit) sit alongside the Necron ones. **Edit slots** on the Primary Detachment is there for rules that change the chart.

Rules from the core rulebook (Bulky, Deep Strike, Eternal Warrior…) are labelled `core` because their text isn't in the codex.

## Data

All 70 units, 136 weapon profiles, 21 detachments and 12 Aeonic Sequelae are transcribed from the codex PDF into `data/parts/*.json` (schema in `data/SCHEMA.md`). The per-page source text lives in `source/pages/`.

```
npm run build   # merge data/parts → data/necrons.json + js/data.js, check references
npm test        # build, then run the engine tests
```

Known gaps in the codex itself (v1.4.2): *Dynastic Protocols (X)*, *Interception Protocols* and *Phase-Tunnel Cutters* are named but never printed in full. A few typos are kept as printed and flagged in each unit's `note`.
