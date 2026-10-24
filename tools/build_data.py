"""Builds data/weapons.json, data/plugs.json, data/armor.json, data/artifacts.json, data/wiki.json and data/godrolls.json from the Bungie manifest and
Aegis's Destiny 2: Endgame Analysis sheet (tiers and recommended rolls).

Usage: python3 tools/build_data.py [manifest_cache_dir]
Standard library only, so the weekly GitHub Action can run it as is.
"""
import csv, io, json, os, re, sys, unicodedata, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BNET = 'https://www.bungie.net'
ENDGAME = '1JM-0SlxVDAi-C6rGVlLxa-J1WGewEeL8Qvq4htWZHhY'  # Google Sheet id of Destiny 2: Endgame Analysis
TABLES = ['DestinyInventoryItemDefinition', 'DestinyPlugSetDefinition', 'DestinyStatDefinition', 'DestinyCollectibleDefinition',
          'DestinyLoreDefinition', 'DestinySocketCategoryDefinition', 'DestinyDamageTypeDefinition', 'DestinyStatGroupDefinition',
          'DestinyEquipableItemSetDefinition', 'DestinySandboxPerkDefinition', 'DestinyActivityDefinition', 'DestinyVendorDefinition',
          'DestinyDestinationDefinition', 'DestinyActivityTypeDefinition']
LOST_SECTOR = 103143560  # DestinyActivityTypeDefinition "Lost Sector"
PLACE_ALIAS = {'arcadian valley': 'nessus'}  # the manifest's name for Nessus's patrol zone
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
    weapons, plugs, scales = [], {}, []

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
        # perks add to the investment value; a stat whose display curve isn't 1:1 (magazine, RPM, impact) also gets that value and its curve's index
        inv = {s['statTypeHash']: s['value'] for s in it.get('investmentStats', [])}
        for st, sc in zip(stats, [next(s for s in group['scaledStats'] if s['statHash'] == h) for h in order if str(h) in it['stats']['stats'] and h not in SKIP_STATS]):
            pts = [[p['value'], p['weight']] for p in sc['displayInterpolation']]
            if pts and pts != [[0, 0], [100, 100]]:
                if pts not in scales: scales.append(pts)
                st += [inv.get(sc['statHash'], 0), scales.index(pts)]
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
    return weapons, plugs, scales


def fold(t):
    return unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode().lower().strip()


def build_wiki(d, tabs):
    """Art for wiki pages, keyed by the lowercased names the community sheets use: activity banners, vendor art and item icons
    (abilities, aspects, fragments, mods), plus each element's icon."""
    A, V, I, DMG = d['DestinyActivityDefinition'], d['DestinyVendorDefinition'], d['DestinyInventoryItemDefinition'], d['DestinyDamageTypeDefinition']
    cells = {c.strip().split('\n')[0].strip().lower() for t in tabs for r in t['rows'] for c in r if c and c.strip()}
    cells = {c for c in cells if len(c) <= 60}
    acts, vendors, icons = {}, {}, {}
    for a in A.values():
        n, pg = a.get('displayProperties', {}).get('name', ''), a.get('pgcrImage', '')
        if n and pg and 'missing' not in pg:
            for k in (fold(n), fold(n.split(':')[0])): acts.setdefault(k, pg)
    for v in V.values():
        dp = v.get('displayProperties', {})
        if dp.get('name') and dp.get('largeIcon'): vendors.setdefault(fold(dp['name']), dp['largeIcon'])
    for it in I.values():
        dp = it.get('displayProperties', {})
        if dp.get('icon') and it.get('itemType') not in (2, 3) and dp.get('name', '').lower() in cells: icons.setdefault(dp['name'].lower(), dp['icon'])
    img = {}
    for c in cells:
        f = fold(c)
        for k in (f, 'the ' + f, re.sub(r'^the ', '', f), f.split(' & ')[0], 'the ' + f.split(' & ')[0], f.split(' | ')[0]):
            if k in acts or k in vendors: img[c] = acts.get(k) or vendors[k]; break
    for t in DMG.values():
        dp = t.get('displayProperties', {})
        if dp.get('icon') and dp.get('name'): icons[dp['name'].lower()] = dp['icon']
    return {'img': img, 'icon': icons, 'places': build_places(d)}


def build_places(d):
    """Each destination's banner and Bungie description, plus its lost sectors: picture, difficulties, champions, shields and modifiers.
    Keyed like the site's fold() (lowercase, no accents, no leading "the")."""
    A, D, AT = d['DestinyActivityDefinition'], d['DestinyDestinationDefinition'], d['DestinyActivityTypeDefinition']
    key = lambda n: PLACE_ALIAS.get(re.sub(r'^the ', '', fold(n)), re.sub(r'^the ', '', fold(n)))
    places = {}
    for dest in D.values():
        n, fr = dest['displayProperties'].get('name', ''), A.get(str(dest.get('defaultFreeroamActivityHash')), {})
        if n and fr.get('pgcrImage') and 'placeholder' not in fr['pgcrImage']:
            places.setdefault(key(n), {'img': fr['pgcrImage'], 'd': dest['displayProperties'].get('description', ''), 'lost': {}})
    # a place without a destination of its own (the Lawless Frontier) takes the banner of an activity of its type
    for h, t in AT.items():
        k = key(t.get('displayProperties', {}).get('name', '') or '-')
        if k in places or not any(a.get('activityTypeHash') == int(h) for a in A.values()): continue
        pg = next((a['pgcrImage'] for a in A.values() if a.get('activityTypeHash') == int(h) and 'pgcr/' in a.get('pgcrImage', '')), '')
        if pg and k in ('lawless frontier',): places[k] = {'img': pg, 'd': '', 'lost': {}}
    rank = {'Expert': 0, 'Legend': 1, 'Master': 2}
    for a in A.values():
        m = re.match(r'^(.+): (Expert|Legend|Master)$', a['displayProperties'].get('name', ''))
        p = places.get(key(D.get(str(a.get('destinationHash')), {}).get('displayProperties', {}).get('name', '')))
        if a.get('activityTypeHash') != LOST_SECTOR or not m or p is None: continue
        ls = p['lost'].setdefault(m[1], {'n': m[1], 'img': a.get('pgcrImage', ''), 'diffs': []})
        if m[2] not in ls['diffs']: ls['diffs'].append(m[2])
        # the hardest version's description lists its champions, shields and modifiers ("Champions: [Disruption] Overload, ...")
        if rank[m[2]] >= max(rank[x] for x in ls['diffs']):
            f = dict(re.findall(r'^(\w+): (.+)$', a['displayProperties'].get('description', ''), re.M))
            clean = lambda v: [re.sub(r'\[[^\]]*\]\s*', '', x).strip() for x in v.split(',') if x.strip()] if v else []
            ls.update(champs=clean(f.get('Champions')), shields=clean(f.get('Shields')), threat=clean(f.get('Threat') or f.get('Burn')), mods=clean(f.get('Modifiers')))
    for p in places.values():
        p['lost'] = sorted(({**x, 'diffs': sorted(x['diffs'], key=rank.get)} for x in p['lost'].values()), key=lambda x: x['n'])
    return places


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


def build_artifacts(d):
    """The seasonal artifacts you can equip: each tier's slots and the perks it unlocks. A tier's sockets also take the perks of the
    tiers below it, so each tier lists only its new perks."""
    I, PS, PERK = d['DestinyInventoryItemDefinition'], d['DestinyPlugSetDefinition'], d['DestinySandboxPerkDefinition']
    out = []
    for h, x in I.items():
        if x.get('itemTypeDisplayName') != 'Artifact' or not x.get('sockets'): continue
        tiers = {}
        for e in x['sockets']['socketEntries']:
            perks = [I[str(p)] | {'h': p} for p in plug_list(e, PS) if I.get(str(p), {}).get('itemTypeDisplayName') == 'Artifact Perk']
            if perks: tiers.setdefault(e.get('reusablePlugSetHash') or e.get('randomizedPlugSetHash'), [0, perks])[0] += 1
        # "[Arc]" and the like are inline icons in Bungie's text
        desc = lambda p: ' '.join(re.sub(r'\[[^\]]*\]', '', p['displayProperties']['description'] or ' '.join(
            PERK[str(k['perkHash'])]['displayProperties']['description'] for k in p.get('perks', []) if str(k['perkHash']) in PERK)).split())
        seen = set()
        out.append({'h': int(h), 'n': x['displayProperties']['name'], 'i': x['displayProperties']['icon'],
                    # "Works best with: Elements: [Kill] [Void] ... Weapons: [Sword] ..."; [Kill] is the Kinetic glyph
                    **dict(zip(['el', 'wp'], [re.findall(r'\[([^\]]+)\]', part.replace('[Kill]', '[Kinetic]')) for part in x['displayProperties']['description'].partition('Weapons:')[::2]])),
                    'tiers': [{'slots': n, 'perks': [{'h': p['h'], 'n': p['displayProperties']['name'], 'i': p['displayProperties']['icon'], 'd': desc(p)}
                                                     for p in perks if p['h'] not in seen and not seen.add(p['h'])]}
                              for n, perks in sorted(tiers.values(), key=lambda t: len(t[1]))]})
    return sorted(out, key=lambda a: a['n'])


def endgame_tabs():
    """(name, rows) for each weapon tab of the Endgame Analysis sheet, found from its tab list so new tabs are picked up."""
    page = get(f'https://docs.google.com/spreadsheets/d/{ENDGAME}/htmlview').decode('utf-8')
    for name, gid in re.findall(r'name: "([^"]+)", pageUrl: "[^"]*gid=(\d+)', page):
        rows = list(csv.reader(io.StringIO(get(f'https://docs.google.com/spreadsheets/d/{ENDGAME}/gviz/tq?tqx=out:csv&gid={gid}').decode('utf-8'))))
        if rows and 'Tier' in rows[0] and (any(h.endswith('Perk 1') for h in rows[0]) or name == 'Exotic Weapons'):
            yield name, rows


def parse_endgame(tabs, weapons, plugs):
    """Aegis's tier and recommended roll for each weapon, on every version that shares its name.
    {hash: {t: tier, r: rank, of: weapons in tab, tab, note, d (exotics: what it does), mw, o (origin trait),
    p: {column label: [perk names]}, c: [[Perk 1 hashes], [Perk 2 hashes]] (a copy is a god roll when it has one of each)}}"""
    key = lambda n: re.sub(r'[^a-z0-9]', '', n.lower())
    versions = {}
    for w in weapons: versions.setdefault(key(re.sub(r' \((Adept|Timelost|Harrowed)\)$', '', w['n'])), []).append(w)
    split = lambda cell: [x.strip() for x in cell.split('\n') if x.strip() and x.strip().lower() not in ('none', 'n/a', '-')]
    rolls, missing = {}, []
    for tab, rows in tabs:
        head = rows[0]
        col = lambda label: next((i for i, h in enumerate(head) if h.strip().endswith(label)), None)
        name, tier, rank = col('Name'), len(head) - 1 - head[::-1].index('Tier'), col('#')
        listed = [r for r in rows[1:] if r[name].strip() and r[tier].strip()]
        for pos, r in enumerate(listed, 1):
            # a second line in the name cell says which reissue was rated, e.g. "Prosecutor\nRotN version"
            title, _, which = r[name].strip().partition('\n')
            vs = versions.get(key(title))
            if not vs: missing.append(title); continue
            base = {'t': r[tier].strip(), 'r': int(r[rank]) if rank is not None and r[rank].isdigit() else pos, 'of': len(listed), 'tab': tab}
            if tab == 'Exotic Weapons':
                base.update(note=r[col('Usage')].strip(), d=r[col('Description')].strip())
                for w in vs: rolls.setdefault(str(w['h']), base)
                continue
            p = {label: split(r[col(h)]) for label, h in (('Barrel', 'Barrel'), ('Magazine', 'Mag'), ('Perk 1', 'Perk 1'), ('Perk 2', 'Perk 2'))}
            base.update(note=(f'Rated: {which.strip()}. ' if which.strip() else '') + r[col('Notes')].strip(), mw=' or '.join(split(r[col('MW')])), o=', '.join(split(r[col('Origin Trait')])), p=p)
            fits = []
            for w in vs:
                pool = {}
                for c in w['cols']:
                    for h in c['p']: pool.setdefault(key(plugs[str(h)]['n']), []).append(h)
                c = [sorted({h for n in p[label] for h in pool.get(key(n), [])}) for label in ('Perk 1', 'Perk 2')]
                if all(c): fits.append((w, c))
            # older versions that can't roll the recommended perks weren't the ones rated
            for w, c in fits or [(w, []) for w in vs]:
                rolls.setdefault(str(w['h']), {**base, 'c': c})  # first row listing a weapon wins
    return rolls, missing


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache')
    version, d = load_manifest(cache)
    weapons, plugs, scales = build(d)
    wiki = build_wiki(d, json.load(open(os.path.join(ROOT, 'data', 'tabs.json'), encoding='utf-8')))
    armor = build_armor(d)
    artifacts = build_artifacts(d)
    rolls, missing = parse_endgame(list(endgame_tabs()), weapons, plugs)
    if missing: print('Endgame Analysis names not in the manifest:', missing)
    os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
    dump = lambda name, obj: json.dump(obj, open(os.path.join(ROOT, 'data', name), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    dump('weapons.json', {'version': version, 'scales': scales, 'weapons': weapons})
    dump('wiki.json', wiki)
    dump('plugs.json', plugs)
    dump('godrolls.json', {'source': f'https://docs.google.com/spreadsheets/d/{ENDGAME}', 'rolls': rolls})
    dump('armor.json', armor)
    dump('artifacts.json', artifacts)
    print(version, len(weapons), 'weapons', len(plugs), 'plugs', len(rolls), 'weapons with an Endgame Analysis tier',
          len(armor['armor']), 'armor', len(armor['sets']), 'sets', len(armor['archetypes']), 'archetypes')
    assert len(weapons) > 1000 and len(rolls) > 500 and sum(bool(r.get('c')) for r in rolls.values()) > 300, 'manifest or Endgame Analysis parse looks broken'
    assert len(armor['armor']) > 1000 and len(armor['sets']) > 20 and len(armor['archetypes']) >= 6, 'armor parse looks broken'
    assert len(scales) > 10 and "king's fall" in wiki['img'] and 'arc' in wiki['icon'], 'stat curve or wiki art parse looks broken'
    assert len(wiki['places']['moon']['lost']) >= 4 and wiki['places']['nessus']['img'], 'destination or lost sector parse looks broken'
    assert artifacts and all(len(a['tiers']) == 3 and all(t['perks'] for t in a['tiers']) for a in artifacts), 'artifact parse looks broken'


if __name__ == '__main__':
    main()
