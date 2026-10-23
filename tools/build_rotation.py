"""Builds data/rotation.json from Court's Weekly Reset schedule in Llama's sheet: each week's featured raids,
dungeons, Pantheon encounters, Grandmaster strike and weapons, and PvP event. The sheet lists weeks ahead.

Usage: python3 tools/build_rotation.py
"""
import csv, io, json, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://docs.google.com/spreadsheets/d/1_rsLAIFeGL3idS6b12zpBcLWu-9Er0slMjraNT8k4xI/gviz/tq?tqx=out:csv&gid=1728967379'
ALWAYS = ['Desert Perpetual', 'Equilibrium']  # shortcut: hand-kept from the sheet's header note; update when a new raid or dungeon launches
COLUMNS = {'gm': 'Featured Grandmaster', 'shiny': 'Shiny', 'focus': 'Bonus Focus', 'pvp': 'PvP Event', 'raid1': 'Raid 1', 'raid2': 'Raid 2',
           'dungeon1': 'Dungeon 1', 'dungeon2': 'Dungeon 2', 'reprise': 'Reprise', 'encore': 'Encore'}


def parse(rows):
    head = rows[0]
    col = {k: next(i for i, h in enumerate(head) if label in h) for k, label in COLUMNS.items()}
    weeks = []
    for r in rows[1:]:
        m = re.fullmatch(r'(\d\d)/(\d\d)/(\d{4})', r[1].strip()) if len(r) > 1 else None
        if not m: continue
        # the header sits on the first column of each merged pair, the value on either column
        raw = lambda k: next((c for c in r[col[k]:col[k] + 2] if c.strip()), '')
        cell = lambda k: (lambda v: '' if v == '-' else v)(re.sub(r'[★^]', '', raw(k)).strip())  # ★ = Master available, ^^ = footnote
        names = lambda *ks: [cell(k) for k in ks if cell(k)]
        weeks.append({'start': f'{m[3]}-{m[2]}-{m[1]}', 'week': int(r[2]) if r[2].strip().isdigit() else None,
                      'gm': cell('gm'), 'gmWeapons': names('shiny', 'focus'), 'pvp': cell('pvp'),
                      'raids': names('raid1', 'raid2'), 'dungeons': names('dungeon1', 'dungeon2'), 'pantheon': names('reprise', 'encore'),
                      'master': [cell(k) for k in ('raid1', 'raid2', 'dungeon1', 'dungeon2') if '★' in raw(k)]})
    return sorted(weeks, key=lambda w: w['start'])


def main():
    with urllib.request.urlopen(URL, timeout=120) as f:
        weeks = parse(list(csv.reader(io.StringIO(f.read().decode('utf-8')))))
    assert len(weeks) > 4 and all(w['raids'] and w['dungeons'] for w in weeks), 'Weekly Reset parse looks broken'
    # the sheet's note: the newest raid and dungeon are featured every week
    json.dump({'always': ALWAYS, 'weeks': weeks}, open(os.path.join(ROOT, 'data', 'rotation.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
    print(len(weeks), 'weeks,', weeks[0]['start'], 'to', weeks[-1]['start'])


if __name__ == '__main__':
    main()
