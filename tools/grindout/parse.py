import re,html,json,sys,glob,os
def clean(x): return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',x))).strip()
def parse(path):
    s=open(path,encoding='utf-8').read()
    s=s.replace('\\/','/').replace('\\"','"').replace('\\r\\n','\n').replace('\\n','\n').replace('\\t',' ')
    s=re.sub(r'\\u([0-9a-fA-F]{4})',lambda m: chr(int(m.group(1),16)),s)
    s=re.sub(r'<div[^>]*productfeed[^>]*>.*?</div>','',s,flags=re.S)
    s=re.sub(r'<a[^>]*>(?:(?!</a>).)*?product-card.*?</a>','',s,flags=re.S)
    out=[]
    for sec in re.finditer(r'<section data-nav="([^"]*)"[^>]*>(.*?)</section>',s,re.S):
        nav,b=sec.groups(); items=[]
        for m in re.finditer(r'<(h[1-5])[^>]*>(.*?)</\1>|<img[^>]*src="(/storage/guide-images/[^"]+)"[^>]*>|<p[^>]*>(.*?)</p>|<li[^>]*>(.*?)</li>',b,re.S):
            h,ht,src,p,li=m.groups()
            if h and clean(ht): items.append(['h',clean(ht)])
            elif src:
                alt=re.search(r'alt="([^"]*)"',m.group(0)); items.append(['img',src,alt.group(1) if alt else ''])
            elif p and clean(p): items.append(['p',clean(p)])
            elif li and clean(li): items.append(['li',clean(li)])
        out.append({'nav':html.unescape(nav),'items':items})
    return out
if __name__=='__main__':
    res={os.path.basename(f)[:-5]:parse(f) for f in sorted(glob.glob(sys.argv[1]+'/*.html'))}
    json.dump(res,open(sys.argv[2],'w'),ensure_ascii=False,indent=1)
    for k,v in res.items(): print(k,len(v),'sections',sum(1 for x in v for i in x['items'] if i[0]=='img'),'imgs |',' / '.join(x['nav'] for x in v)[:250])
