"""Builds data/weapons.json, data/plugs.json and data/godrolls.json from the Bungie manifest and the Voltron wishlist.

Usage: python3 tools/build_data.py [manifest_cache_dir]
Standard library only, so the weekly GitHub Action can run it as is.
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BNET = 'https://www.bungie.net'
VOLTRON = 'https://raw.githubusercontent.com/48klocs/dim-wish-list-sources/master/voltron.txt'
TABLES = ['DestinyInventoryItemDefinition', 'DestinyPlugSetDefinition', 'DestinyStatDefinition', 'DestinyCollectibleDefinition',
          'DestinyLoreDefinition', 'DestinySocketCategoryDefinition', 'DestinyDamageTypeDefinition', 'DestinyStatGroupDefinition',
          'DestinyEquipableItemSetDefinition', 'DestinySandboxPerkDefinition']
SKIP_STATS = {1480404414, 1935470627}  # Attack, Power
AMMO = {1: 'Primary', 2: 'Special', 3: 'Heavy'}
SLOT = {1498876634: 'Kinetic', 2465295065: 'Energy', 953998645: 'Power'}
CLASS = {0: 'Titan', 1: 'Hunter', 2: 'Warlock'}


def api_key():
    key = os.environ.get('BUNGIE_API_KEY')
    if key: return key
    # the key is public by design (it ships in the site), so read it from the site config
    return re.search(r"apiKey:\s*'(\w+)'", open(os.path.join(ROOT, 'js', 'config.js')).read()).group(1)


def get(url, headers={}):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=300) as r:
        return r.read()


def load_manifest(cache):
    m = json.loads(get(BNET + '/Platform/Destiny2/Manifest/', {'X-API-Key': api_key()}))['Response']
    paths = m['jsonWorldComponentContentPaths']['en']
    os.makedirs(cache, exist_ok=True)
    out = {}
    for t in TABLES:
        f = os.path.join(cache, os.path.basename(paths[t]))
        if not os.path.exists(f):
            open(f, 'wb').write(get(BNET + paths[t]))
        out[t] = json.load(open(f, encoding='utf-8'))
    return m['version'], out


def plug_list(entry, plugsets):
    h = entry.get('randomizedPlugSetHash') or entry.get('reusablePlugSetHash')
    items = plugsets[str(h)]['reusablePlugItems'] if h and str(h) in plugsets else entry.get('reusablePlugItems', [])
    hashes = [p['plugItemHash'] for p in items if p.get('currentlyCanRoll', True)]
    if not hashes and entry.get('singleInitialItemHash'): hashes = [entry['singleInitialItemHash']]
    return list(dict.fromkeys(hashes))


def build(d):
    I, PS, ST = d['DestinyInventoryItemDefinition'], d['DestinyPlugSetDefinition'], d['DestinyStatDefinition']
    COL, LORE, CAT = d['DestinyCollectibleDefinition'], d['DestinyLoreDefinition'], d['DestinySocketCategoryDefinition']
    DMG, SG = d['DestinyDamageTypeDefinition'], d['DestinyStatGroupDefinition']
    stat_name = lambda h: ST.get(str(h), {}).get('displayProperties', {}).get('name', '')
    weapons, plugs = [], {}

    def add_plug(h):
        p = I.get(str(h))
        if not p: return False
        if str(h) not in plugs:
            dp = p['displayProperties']
            plugs[str(h)] = {'n': dp['name'], 'i': dp.get('icon', ''), 'd': dp.get('description', ''), 't': p.get('itemTypeDisplayName', ''),
                             'e': 1 if p.get('itemTypeDisplayName') == 'Enhanced Trait' or p['inventory'].get('tierType') == 3 and p.get('plug', {}).get('plugCategoryIdentifier') == 'origins' else 0,
                             's': [[stat_name(s['statTypeHash']), s['value']] for s in p.get('investmentStats', []) if s['value'] and not s.get('isConditionallyActive') and stat_name(s['statTypeHash'])]}
        return True

    for it in I.values():
        dp = it.get('displayProperties', {})
        if it.get('itemType') != 3 or it['inventory'].get('tierType') not in (5, 6) or not dp.get('name') or 3109687656 in it.get('itemCategoryHashes', []):
            continue
        col = COL.get(str(it.get('collectibleHash')), {})
        lore = LORE.get(str(it.get('loreHash')), {}).get('displayProperties', {}).get('description', '')
        group = SG.get(str(it['stats'].get('statGroupHash')), {})
        order = [s['statHash'] for s in group.get('scaledStats', [])]
        numeric = {s['statHash'] for s in group.get('scaledStats', []) if s.get('displayAsNumeric')}
        stats = [[stat_name(h), it['stats']['stats'][str(h)]['value'], 1 if h in numeric else 0] for h in order if str(h) in it['stats']['stats'] and h not in SKIP_STATS]
        columns = []
        sockets = it.get('sockets', {})
        for cat in sockets.get('socketCategories', []):
            cname = CAT.get(str(cat['socketCategoryHash']), {}).get('displayProperties', {}).get('name', '')
            if 'COSMETIC' in cname: continue
            for idx in cat['socketIndexes']:
                e = sockets['socketEntries'][idx]
                hashes = [h for h in plug_list(e, PS) if add_plug(h)]
                pci = I.get(str(hashes[0]), {}).get('plug', {}).get('plugCategoryIdentifier', '') if hashes else ''
                if not hashes or 'trackers' in pci or 'enhancers' in pci: continue
                if 'masterworks' in pci:  # one plug per stat (the top tier) instead of 10 tiers x stats
                    best = {}
                    for h in hashes: best[plugs[str(h)]['n'].split(': ')[-1]] = h
                    hashes = list(best.values())
                columns.append({'c': cname.title(), 'p': hashes, 'cur': e.get('singleInitialItemHash') or 0})
        weapons.append({'h': it['hash'], 'n': dp['name'], 'i': dp.get('icon', ''), 'ss': it.get('screenshot', ''), 'wm': it.get('iconWatermark', ''),
                        'ty': it.get('itemTypeDisplayName', ''), 'ti': it['inventory'].get('tierTypeName', ''),
                        'dm': DMG.get(str(it.get('defaultDamageTypeHash')), {}).get('displayProperties', {}).get('name', ''),
                        'am': AMMO.get(it.get('equippingBlock', {}).get('ammoType'), ''), 'sl': SLOT.get(it['inventory'].get('bucketTypeHash'), ''),
                        'fl': it.get('flavorText', ''), 'src': col.get('sourceString', ''), 'lore': lore, 'st': stats, 'cols': columns})
    weapons.sort(key=lambda w: (w['n'], -w['h']))
    return weapons, plugs


def build_armor(d):
    """Every legendary/exotic armor piece, the armor sets with their 2/4-piece bonuses, the archetypes and the six armor stats."""
    I, PS, ST, COL = d['DestinyInventoryItemDefinition'], d['DestinyPlugSetDefinition'], d['DestinyStatDefinition'], d['DestinyCollectibleDefinition']
    SETS, PERK = d['DestinyEquipableItemSetDefinition'], d['DestinySandboxPerkDefinition']
    dp = lambda x: x.get('displayProperties', {})
    sets = {}
    for h, st in SETS.items():
        perks = [[p['requiredSetCount'], dp(PERK.get(str(p['sandboxPerkHash']), {})).get('name', ''), dp(PERK.get(str(p['sandboxPerkHash']), {})).get('description', ''),
                  dp(PERK.get(str(p['sandboxPerkHash']), {})).get('icon', '')] for p in st.get('setPerks', [])]
        if dp(st).get('name') and perks: sets[h] = {'n': dp(st)['name'], 'perks': perks}
    archetypes, armor = {}, []
    for it in I.values():
        if it.get('itemType') != 2 or it['inventory'].get('tierType') not in (5, 6) or not dp(it).get('name'): continue
        a3, ex = 0, None
        for e in it.get('sockets', {}).get('socketEntries', []):
            for h in plug_list(e, PS):
                p = I.get(str(h), {})
                pci = p.get('plug', {}).get('plugCategoryIdentifier', '')
                if pci == 'armor_archetypes':
                    a3 = 1
                    archetypes[str(h)] = {'n': dp(p)['name'], 'd': dp(p).get('description', '')}
                elif pci == 'intrinsics' and it['inventory']['tierType'] == 6 and not ex:
                    ex = [dp(p)['name'], dp(p).get('description', ''), dp(p).get('icon', '')]
        set_hash = str(it.get('equippingBlock', {}).get('equipableItemSetHash') or '')
        armor.append({'h': it['hash'], 'n': dp(it)['name'], 'i': dp(it).get('icon', ''), 'wm': it.get('iconWatermark', ''), 'ss': it.get('screenshot', ''),
                      'ty': it.get('itemTypeDisplayName', ''), 'ti': it['inventory'].get('tierTypeName', ''), 'cl': CLASS.get(it.get('classType'), ''),
                      'set': set_hash if set_hash in sets else '', 'src': COL.get(str(it.get('collectibleHash')), {}).get('sourceString', ''),
                      'fl': it.get('flavorText', ''), 'ex': ex, 'a3': a3})
    armor.sort(key=lambda a: (a['n'], -a['h']))
    stats = {str(h): dp(ST[str(h)])['name'] for h in (2996146975, 392767087, 1943323491, 1735777505, 144602215, 4244567218)}  # Weapons, Health, Class, Grenade, Super, Melee
    return {'armor': armor, 'sets': sets, 'archetypes': archetypes, 'stats': stats}


def parse_wishlist(text, weapon_hashes):
    """Voltron/DIM wishlist lines: dimwishlist:item=<hash>&perks=<a>,<b>,...#notes:<text>. Negative item = trash roll, skipped."""
    rolls, notes = {}, ''
    for line in text.splitlines():
        if not line.strip(): notes = ''; continue
        if line.startswith('//notes:'): notes = line[8:].strip(); continue
        if not line.startswith('dimwishlist:'): continue
        m = re.match(r'dimwishlist:item=(-?\d+)(?:&perks=([\d,]*))?(?:#notes:(.*))?', line)
        if not m or m.group(1).startswith('-') or int(m.group(1)) not in weapon_hashes: continue
        perks = [int(p) for p in (m.group(2) or '').split(',') if p]
        rolls.setdefault(m.group(1), []).append({'p': perks, 'note': (m.group(3) or notes)[:300]})
    return rolls


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache')
    version, d = load_manifest(cache)
    weapons, plugs = build(d)
    armor = build_armor(d)
    rolls = parse_wishlist(get(VOLTRON).decode('utf-8'), {w['h'] for w in weapons})
    # Voltron spells each roll out as every perk combination, one line each. Collapse a note's lines back into
    # per-column options ([[a|b], [c|d]] = any of a/b plus any of c/d) when they are exactly that full product.
    for h, rs in rolls.items():
        by_note, out = {}, []
        for r in rs: by_note.setdefault(r['note'], set()).add(tuple(r['p']))
        for note, combos in by_note.items():
            groups = {}
            for c in combos: groups.setdefault(len(c), []).append(c)
            for n, cs in groups.items():
                cols = [sorted({c[i] for c in cs}) for i in range(n)]
                size = 1
                for col in cols: size *= len(col)
                out += [{'c': cols, 'note': note}] if size == len(cs) else [{'c': [[p] for p in c], 'note': note} for c in cs]
        rolls[h] = out
    notes = list(dict.fromkeys(r['note'] for rs in rolls.values() for r in rs))  # each note once; rolls point at it by index
    idx = {n: i for i, n in enumerate(notes)}
    for rs in rolls.values():
        for r in rs: r['note'] = idx[r['note']]
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    dump = lambda name, obj: json.dump(obj, open(os.path.join(ROOT, 'data', name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    dump('weapons.json', {'version': version, 'weapons': weapons})
    dump('plugs.json', plugs)
    dump('godrolls.json', {'notes': notes, 'rolls': rolls})
    dump('armor.json', armor)
    print(version, len(weapons), 'weapons', len(plugs), 'plugs', len(rolls), 'weapons with god rolls',
          len(armor['armor']), 'armor', len(armor['sets']), 'sets', len(armor['archetypes']), 'archetypes')
    assert len(weapons) > 1000 and len(rolls) > 300, 'manifest or wishlist parse looks broken'
    assert len(armor['armor']) > 1000 and len(armor['sets']) > 20 and len(armor['archetypes']) >= 6, 'armor parse looks broken'


if __name__ == '__main__':
    main()
