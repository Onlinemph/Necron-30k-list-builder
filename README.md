# 30k List Builder

An army list builder for the Horus Heresy 3rd edition. Pick the army at the top of the page:

- **Every army in BSData's Horus Heresy 3rd edition data**: all eighteen Legions, Shattered Legions, Blackshields, Mechanicum, Solar Auxilia, Imperialis Militia, Legio Custodes, Legio Titanicus, Questoris Familia, Knights-Errant, Skitarii Conclaves, Daemons and Anathema Psykana. Imported from [BSData/horus-heresy-3rd-edition](https://github.com/BSData/horus-heresy-3rd-edition) by `scripts/import-bsdata.mjs`.
- **Necrons**: *Codex Xenologica – Necrons*, v1.4.2 (August 2026)
- **Orks**: *Xenos Forces of the Age of Darkness – Orks, 3rd Edition Rules* by Always Strikes First (October 2025)
- **Drukhari**: *Codex Xenologica – Drukhari*, v1.13 (March 2026)

Each army remembers its own current list, and saved lists and share links switch to the right army automatically.

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

## Orks

Every Ork unit picks its Great Clan (Bad Moons, Blood Axes, Deathskulls, Evil Sunz, Goffs, Snakebites or Freebooters), which unlocks clan wargear (Ammo Runts, Red Paint Job, Cyboars), clan Prime Advantages and clan rules. Auxiliary and Apex Detachments must share one clan, with Freebooters as the exception. The Ork detachments (Deffwing, Boss's Bodyguard, Green Tide, Dread Mob, Kult of Speed) sit in the Add detachment menu. "Must take" options such as a Deff Dread's weapons or a Gun Squiggoth's Big Gunz are checked, and Big Gunz Batteries scale their Gretchin crews per gun.

## Drukhari

Units pick their Partisan (Kabals, Cults or Covens) where the codex leaves it open, and units with [Combat Drugs] must pick a drug, whose +1 shows on the statline. The Kabal Archon can buy the drugs as an upgrade. The Court of the Archon and Cult Beast Pack are built from a menu of models with a total size limit (and one Beastmaster per four models), and Haemonculus Arcana items are once per army. The eleven Drukhari detachments are in the Add detachment menu; their slots were read from the icons, since the codex has no icon legend. Power From Pain's tiers show as situational reminders.

## BSData armies

`scripts/import-bsdata.mjs` converts BSData's BattleScribe catalogues into this builder's format. It resolves each army statically: rules that depend on which Legion or faction the army is (Thousand Sons' Prosperine Arcana, legion weapons, profile changes) are applied, and rules that depend on what else is in the roster are shown in their default state. Units, models, per-model costs, standard wargear, weapon swaps, upgrades, crews (Rapier Batteries) and all weapon, wargear and special-rule text come across. BSData's core special rules text also fills in the rules the fan codexes only name.

Not imported yet: Rites of War and other legion-specific detachments, Legion-specific Prime Advantages, the Assassins (their "Clade Operative" category has no battlefield role), roster-wide limits that BSData enforces with conditions, and mount swaps on mounted characters (a Mounted Praetor's Bulky value shows as "Bulky (X)"). BSData doesn't give page numbers, so BSData units have none.

To refresh from BSData:

```
git clone --depth 1 https://github.com/BSData/horus-heresy-3rd-edition /tmp/hh3
node scripts/import-bsdata.mjs /tmp/hh3
npm test
```

## Force organisation

The Primary Detachment follows the Horus Heresy 3rd edition Crusade chart: 1 High Command, 3 Command (1 Prime), 4 Troops (1 Prime), 4 Transport. Each filled Command slot unlocks one Auxiliary Detachment, and filling High Command unlocks one Apex Detachment. The core Auxiliary, Apex, Warlord and Lord of War Detachments are in the **Add detachment** menu next to the Necron ones, and the core Prime Advantages (Master Sergeant, Combat Veterans, Paragon of Battle, Special Assignment, Logistical Benefit) sit alongside the Necron ones. **Edit slots** on the Primary Detachment is there for rules that change the chart.

Rules from the core rulebook (Bulky, Deep Strike, Eternal Warrior…) show BSData's rules text.

## Data

Necrons: 70 units, 136 weapon profiles, 21 detachments and 12 Aeonic Sequelae in `data/parts/*.json`. Orks: 52 units, 87 weapon profiles, 5 detachments and 7 clans in `data/orks/`. Drukhari: 53 units, 103 weapon profiles and 11 detachments in `data/drukhari/`. The schema is in `data/SCHEMA.md` (army differences in `data/orks/NOTES.md` and `data/drukhari/NOTES.md`), and the per-page source text is in `source/`.

To add another army, put its parts in `data/<army>/parts/`, add an entry to `ARMIES` in `scripts/build-data.mjs`, and load `js/data-<army>.js` in `index.html`.

```
npm run build   # merge each army's parts → data/<army>.json + js/data-<army>.js, check references
npm test        # build, then run the engine tests
```

Known gaps in the codex itself (v1.4.2): *Dynastic Protocols (X)*, *Interception Protocols* and *Phase-Tunnel Cutters* are named but never printed in full. A few typos are kept as printed and flagged in each unit's `note`.
