# Turns every saved sheet tab and xlsx sheet into trimmed row arrays (empty rows/cols dropped) for the app.
import csv, json, sys, glob, os, openpyxl
SRC = '/mnt/project-files/d2-compendium/'
NAMES = {}  # gid -> (sheet title, tab name), from htmlview
SHEETS = {'1_rsLAIFeGL3idS6b12zpBcLWu-9Er0slMjraNT8k4xI': "Llama's Sheets",
          '1i1KUwgVkd8qhwYj481gkV9sZNJQCE-C3Q-dpQutPCi4': 'Damage Buffs/Debuffs',
          '1WaxvbLx7UoSZaBqdFr1u32F2uWVLo-CJunJB4nlGUE4': 'Destiny Data Compendium'}
SKIP_XLSX = ('(old)', '(S28)', 'Home', 'Changelog', 'FAQ', 'Historical', 'Testing')

def trim(rows):
    rows = [[(c if c is not None else '') for c in r] for r in rows]
    rows = [[str(c).strip() for c in r] for r in rows if any(str(c).strip() for c in r)]
    if not rows: return []
    w = max(map(len, rows)); rows = [r + [''] * (w - len(r)) for r in rows]
    keep = [i for i in range(w) if any(r[i] for r in rows)]
    return [[r[i] for i in keep] for r in rows]

def main(names_file, out):
    names = dict(l.rstrip('\n').split('\t', 1) for l in open(names_file))
    tabs = []
    order = list(names)
    files = sorted(glob.glob(SRC + 'sheets-csv/*.csv'), key=lambda f: order.index(os.path.basename(f).split('.')[1]))
    for f in files:
        sid, gid, _ = os.path.basename(f).split('.')
        rows = trim(csv.reader(open(f, encoding='utf-8')))
        if len(rows) > 2: tabs.append({'source': SHEETS[sid], 'tab': names[gid], 'url': f'https://docs.google.com/spreadsheets/d/{sid}/edit?gid={gid}', 'rows': rows})
    for p in glob.glob(SRC + '*.xlsx'):
        wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
        for ws in wb.worksheets:
            if any(s in ws.title for s in SKIP_XLSX): continue
            rows = trim(ws.iter_rows(values_only=True))
            if len(rows) > 2: tabs.append({'source': os.path.basename(p)[:-5], 'tab': ws.title, 'rows': rows})
    json.dump(tabs, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
    for t in tabs: print(len(t['rows']), len(t['rows'][0]), t['source'], '|', t['tab'])
    assert all(t['rows'] and all(len(r) == len(t['rows'][0]) for r in t['rows']) for t in tabs)

if __name__ == '__main__': main(*sys.argv[1:])
