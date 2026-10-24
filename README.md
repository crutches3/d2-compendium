# D2 Compendium

A Destiny 2 compendium in one static site: light.gg-style weapon and armor pages, armor set bonuses, community reference sheets, Bungie sign-in to check your vault for god rolls and plan what to farm next, and a Builds page that opens DIM loadout links (dim.gg) through DIM's public share API.

Live at https://crutches3.github.io/d2-compendium/

## Data

- `data/weapons.json`, `data/plugs.json`, `data/godrolls.json`, `data/armor.json` (armor, sets, archetypes), `data/artifacts.json` (the seasonal artifacts and their perks by tier), `data/wiki.json` (banner art and icons for wiki pages, matched by the names the community sheets use, plus each destination's lost sectors): built by `tools/build_data.py` from the Bungie manifest and Aegis's [Destiny 2: Endgame Analysis](https://docs.google.com/spreadsheets/d/1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY) sheet (each weapon's tier, rank and recommended roll). Copies are graded against it: perfect (Barrel, Magazine, Perk 1 and Perk 2 all match), god roll (both main perks), partial (one main perk) or no match, plus a purple "build roll" grade against perks you pick for a saved build on the weapon page. A GitHub Action refreshes them every Tuesday after reset; run it by hand from the Actions tab after a patch.
- `data/rotation.json`: the weekly schedule (featured raids, dungeons, Pantheon, Grandmaster and PvP event) from the Weekly Reset tab of Llama's sheets, built by `tools/build_rotation.py`. The farming plan files what you're after under this week's featured activities. The same Tuesday Action refreshes it. The always-featured raid and dungeon (Desert Perpetual, Equilibrium) are listed by hand in that script.
- `data/destinations.json`: hand-kept facts for the wiki's destination pages that the Bungie API doesn't carry: which public events run where, how to make each Heroic, lost sector entrances, Distortions and other activities. Its `_about` line says where each part comes from. Edit by hand.
- `data/tabs.json`: community sheets (Destiny Data Compendium, Court's damage buffs sheet, Llama's sheets, theaegisrelic's Boss Damage, Monument of Triumph loot sources), built by `tools/build_tabs.py` from CSV exports. Refreshed by hand.
- `img/`: armor set bonus and artifact perk infographics.

## Bungie app

`js/config.js` holds the API key and OAuth client id (both public by design, like every browser-based Destiny app). The Bungie app's redirect URL must be the live site URL above.
