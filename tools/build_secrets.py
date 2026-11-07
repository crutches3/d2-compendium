"""Builds data/secrets.json from the Bungie manifest for the wiki guides' Secrets tab: each raid and dungeon's own triumphs (Bungie's
presentation node of the same name, the biggest one when there are two), the step text of the quests a guide names under "quests", and the
catalyst record of each weapon a guide names under "catalysts" (signed in, the page reads its progress from profile records).

Usage: python3 tools/build_secrets.py [manifest_cache_dir]
"""
import glob, json, os, sys, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_data

ROOT = build_data.ROOT
fold = lambda s: ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower().replace('’', "'").strip()


def build(d, guides):
    I, O, R, N = (d[t] for t in ['DestinyInventoryItemDefinition', 'DestinyObjectiveDefinition', 'DestinyRecordDefinition', 'DestinyPresentationNodeDefinition'])
    dp = lambda x: x.get('displayProperties', {})
    nodes = {}
    for n in N.values():
        recs = [R[str(r['recordHash'])] for r in n.get('children', {}).get('records', []) if str(r['recordHash']) in R]
        k = fold(dp(n).get('name', ''))
        if recs and len(recs) > len(nodes.get(k, [])): nodes[k] = recs
    quests = {}
    for it in I.values():
        sd = it.get('setData') or {}
        q, steps = sd.get('questLineName'), sd.get('itemList') or []
        if q and len(steps) > len(quests.get(q, {}).get('steps', [])):
            st = [I[str(s['itemHash'])] for s in steps if str(s['itemHash']) in I]
            quests[q] = {'i': dp(it).get('icon', ''), 'steps': [[dp(s).get('description', '').strip(),
                [O[str(o)].get('progressDescription', '').strip() for o in s.get('objectives', {}).get('objectiveHashes', []) if O.get(str(o), {}).get('progressDescription', '').strip()]]
                for s in st]}
    cats = {}
    for h, r in R.items():
        n = dp(r).get('name', '')
        if n.endswith(' Catalyst') and (n not in cats or r.get('parentNodeHashes')): cats[n] = [int(h), dp(r).get('description', '').strip()]
    out = {}
    for g in guides:
        e = {'triumphs': [[r['hash'], dp(r)['name'], dp(r).get('description', '').strip(), dp(r).get('icon', '')] for r in nodes.get(fold(g['name']), []) if dp(r).get('name')]}
        e['quests'] = {x['q']: quests[x['q']] for x in g.get('quests', []) if x['q'] in quests}
        e['catalysts'] = {x['w']: cats[x['w'] + ' Catalyst'] for x in g.get('catalysts', []) if x['w'] + ' Catalyst' in cats}
        missing = [x['q'] for x in g.get('quests', []) if x['q'] not in quests] + [x['w'] for x in g.get('catalysts', []) if x['w'] + ' Catalyst' not in cats]
        if missing: print(g['name'], 'not in the manifest:', missing)
        if any(e.values()): out[g['name']] = e
    return out


def main():
    build_data.TABLES = ['DestinyInventoryItemDefinition', 'DestinyObjectiveDefinition', 'DestinyRecordDefinition', 'DestinyPresentationNodeDefinition']
    _, d = build_data.load_manifest(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '.cache'))
    guides = [json.load(open(f, encoding='utf-8')) for f in sorted(glob.glob(os.path.join(ROOT, 'data', 'guides', '*.json')))]
    out = build(d, guides)
    json.dump(out, open(os.path.join(ROOT, 'data', 'secrets.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(len(out), 'activities,', sum(len(x['triumphs']) for x in out.values()), 'triumphs,', sum(len(x['quests']) for x in out.values()), 'quests,',
          sum(len(x['catalysts']) for x in out.values()), 'catalysts')
    assert len(out) > 15 and sum(len(x['triumphs']) for x in out.values()) > 200, 'triumph parse looks broken'
    want = sum(len(g.get('quests', [])) + len(g.get('catalysts', [])) for g in guides)
    assert sum(len(x['quests']) + len(x['catalysts']) for x in out.values()) == want, 'a quest or catalyst a guide names is missing from the manifest'


if __name__ == '__main__':
    main()
