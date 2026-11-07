# One-off: python3 tools/grindout/parse.py <dir of saved grindout guide pages> parsed.json, then GO_PARSED=parsed.json python3 tools/grindout/build.py
import json,re,os,sys,urllib.request,time
P=json.load(open(os.environ.get('GO_PARSED', 'parsed.json')))  # output of parse.py
REPO=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
F='F'  # first-encounter etc helper
STD=lambda n:{'First Encounter':0,'Second Encounter':1,'Third Encounter':2,'Fourth Encounter':3,'Boss Encounter':n-1}
S='secrets'
MAP={
 'crotas-end-raid':('crotas-end',{'Raid Entrance (Pre-Encounter)':0,'First Encounter':0,'Second Encounter':1,'Thrallway Secret Chest':2,'Third Encounter':2,'Fourth Encounter':3,'Necrochasm Exotic':S},[]),
 'deep-stone-crypt':('deep-stone-crypt',STD(4),[]),
 'duality':('duality',STD(3),[]),
 'equilibrium-guide':('equilibrium',STD(3),[]),
 'garden-of-salvation':('garden-of-salvation',STD(4),[]),
 'ghosts-of-the-deep':('ghosts-of-the-deep',STD(3),[]),
 'grasp-of-avarice':('grasp-of-avarice',{'First Encounter':0,'Second Encounter':2,'Boss Encounter':3},[(r'^First encounter',1)]),
 'kings-fall-raid':('kings-fall',{'Preparation':S,'Opening Gate (Entrance)':0,'First Hidden Chest':S,'Totems Encounter(1st)':1,'Second Hidden Chest':S,'Golgoroth Encounter(3rd)':3,'Third Hidden Chest':S,'The Daughters Encounter(4th)':4,'Oryx Encounter(Final Boss)':5,'Touch of Malice(Raid Exotic)':S},[(r'^Warpriest Encounter',2)]),
 'last-wish':('last-wish',{'First Encounter':0,'Second Encounter':1,'Third Encounter':2,'Fourth Encounter':3,'Boss Encounter':4},[]),
 'pit-of-heresy':('pit-of-heresy',{'First Encounter':0,'Second Encounter':1,'Third Encounter':1,'Fourth Encounter':2,'Boss Encounter':2},[]),
 'prophecy':('prophecy',STD(3),[]),
 'root-of-nightmares':('root-of-nightmares',STD(4),[]),
 'salvations-edge':('salvations-edge',STD(5),[]),
 'shattered-throne':('shattered-throne',STD(3),[]),
 'sundered-doctrine':('sundered-doctrine',STD(3),[]),
 'vault-of-glass':('vault-of-glass',{'First Encounter':0,'Second Encounter':2,'Third Encounter':3,'Fourth Encounter':4,'Boss Encounter':6},[(r'^First encounter$',1),(r'^Fourth Encounter$',5)]),
 'vespers-host':('vespers-host',{'First Encounter':0,'Second Encounter':1,'Boss Encounter':3},[(r'^Second Encounter',2)]),
 'votd-raid':('vow-of-the-disciple',{'Secret Chest Locations':S,'Symbols & Preparation':0,'Pre-Encounter (Entrance)':0,'First Encounter':0,'Second Encounter':1,'Third Encounter':2,'Boss Encounter (Rhulk)':3},[]),
 'warlords-ruin-dungeon':('warlords-ruin',{'Pre-Encounter':0,'First Encounter':0,'Second Encounter':1,'Third Encounter':2,'Collectibles':S},[]),
}
PROMO=re.compile(r"SKIP THE GRIND|\bBUY\b|DON'T WASTE|Boss (Farm|Kill)|Bundle|Carr(y|ies)\b|Sherpa|Power Boost|Solo Flawless|Table of Contents|About Grindout|grindout",re.I)
def fetch(src,dest):
    if os.path.exists(dest): return True
    base,ext=os.path.splitext(src)
    for u in ([base+'-768'+ext] if ext=='.webp' else [])+[src]:
        r=__import__('subprocess').run(['curl','-sSf','-m','30','-o',dest,'https://grindout.com'+__import__('urllib.parse').parse.quote(u)])
        if r.returncode==0 and os.path.getsize(dest)>500: return True
        if os.path.exists(dest): os.remove(dest)
    print('miss',src); return False
tot=0;size=0
for k,(g,navmap,over) in MAP.items():
    guide=json.load(open(f'{REPO}/data/guides/{g}.json')); n=len(guide['encounters'])
    out={'url':f'https://grindout.com/destiny-2/guides/{k}','enc':{},'secrets':[]}
    os.makedirs(f'{REPO}/img/grindout/{g}',exist_ok=True)
    seen=set()
    for s in P[k]:
        if s['nav'] in seen or s['nav'] not in navmap: continue
        seen.add(s['nav']); cur=navmap[s['nav']]; promo=False
        for it in s['items']:
            if it[0]=='h':
                for rx,i in over:
                    if re.search(rx,it[1],re.I): cur=i
                if PROMO.search(it[1]): promo=True; continue
                if promo and len(it[1])<40 and not re.search(r'Overview|Arena|Roles|Mechanics|DPS|Tips|Reaching|Encounter|Chest|Catalyst',it[1],re.I): continue
                promo=False
            else:
                promo=False
            if it[0] in('p','li') and (re.search(r'\$\d',it[1]) or it[1].startswith('Bundle') or 'grindout' in it[1].lower()): continue
            if it[0]=='img':
                name=re.sub(r'[^a-z0-9.-]+','-',os.path.basename(it[1]).lower()).replace('.png.webp','.webp')
                if not fetch(it[1],f'{REPO}/img/grindout/{g}/{name}'): continue
                size+=os.path.getsize(f'{REPO}/img/grindout/{g}/{name}'); tot+=1
                item=['img',f'img/grindout/{g}/{name}']
            else: item=[it[0],it[1]]
            dest=out['secrets'] if cur==S else out['enc'].setdefault(str(cur),[])
            assert cur==S or 0<=cur<n,(k,cur)
            if item not in dest: dest.append(item)
    # drop trailing lone headings
    os.makedirs(f'{REPO}/data/grindout',exist_ok=True)
    json.dump(out,open(f'{REPO}/data/grindout/{g}.json','w'),ensure_ascii=False,separators=(',',':'))
    print(g,{e:len(v) for e,v in out['enc'].items()},'secrets',len(out['secrets']))
print(tot,'images',size//1024,'KB')
