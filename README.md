# D2 Compendium

A Destiny 2 compendium in one static site: light.gg-style weapon pages, community reference sheets, and Bungie sign-in to check your vault for god rolls and plan what to farm next.

Live at https://crutches3.github.io/d2-compendium/

## Data

- `data/weapons.json`, `data/plugs.json`, `data/godrolls.json`: built by `tools/build_data.py` from the Bungie manifest and the [Voltron wishlist](https://github.com/48klocs/dim-wish-list-sources). A GitHub Action refreshes them every Tuesday after reset; run it by hand from the Actions tab after a patch.
- `data/tabs.json`: community sheets (Destiny Data Compendium, Court's damage buffs sheet, Llama's sheets, theaegisrelic's Boss Damage, Monument of Triumph loot sources), built by `tools/build_tabs.py` from CSV exports. Refreshed by hand.
- `img/`: armor set bonus and artifact perk infographics.

## Bungie app

`js/config.js` holds the API key and OAuth client id (both public by design, like every browser-based Destiny app). The Bungie app's redirect URL must be the live site URL above.
