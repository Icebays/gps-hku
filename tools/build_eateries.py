"""HKU's eateries (Catering Services, catering.hku.hk/en/eateries) for the map's info cards: each outlet's photos,
online order page, mode of service, food and opening hours, from its page on the Catering Services site.

    python3 tools/build_eateries.py [cache folder]      -> data/eateries.json
      { source, outlets: { <place id>: { page, order, photos: [url], service, food, hours: [[days, times]] } } }

The outlets themselves are places in data/places.json (category 'dining', 'in' = the building they are in); OUTLETS
below matches their pages to them. Photos stay on the Catering Services site (linked, not copied). A cache folder
keeps the fetched pages (the site often drops connections: each page is tried a few times).
"""
import html, json, os, re, sys, time, urllib.request

SITE = 'https://catering.hku.hk'
OUTLETS = {   # page code on the site -> place id
    'FSCACR': 'juying-tai', 'mlc': 'urban-coffee-roaster', 'CCOutletB': 'tamjai-samgor', 'cymc': 'so330',
    'CCOutletC': 'asian-gourmet', 'CCOutletA': 'alfafa-bistro', 'cymr': 'cym-canteen', 'hkdaily': 'hong-kong-daily',
    'COII': 'subway-centennial', 'COIII': 'sandwich-club-kiosk-centennial', 'halalcorner': '27-kebab-house',
    'UR': 'union-restaurant', 'COBG03': 'starbucks-composite', 'COBG02': 'tai-tai-foodtopia', 'COBG01': 'oori-hansik',
    'COBG05': 'vending-nook', 'CCOutletD': 'bijas-vegetarian', 'bridge': 'the-good-bridge', '3SRC': 'grove',
    '6SRKiosk': 'sandwich-club-kiosk-sassoon', 'FanPuiOutpost': 'subway-sassoon', 'FOMBCK': 'starbucks-kiosk-medicine',
    'LabBlockGF': 'wholesome-hub', '1887': 'restaurant-1887', 'CYMGF': 'vending-hub-cym', 'SCR': 'senior-common-room',
}
cache = sys.argv[1] if len(sys.argv) > 1 else None

def get(path, name):
    f = cache and os.path.join(cache, name)
    if f and os.path.exists(f) and os.path.getsize(f) > 1000: return open(f, encoding='utf-8').read()
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(SITE + path, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as r:
                s = r.read().decode('utf-8')
            if f: open(f, 'w', encoding='utf-8').write(s)
            return s
        except Exception as e:
            print('retry', path, e); time.sleep(2 * (k + 1))
    raise SystemExit('could not fetch ' + path)

def text(s):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
    t = html.unescape(re.sub(r'<[^>]+>', '\n', t))
    return [l.strip() for l in t.split('\n') if l.strip()]

listing = get('/en/eateries/', 'eateries.html')
# the listing's cards: each outlet's thumbnail and its "Order Now" link
cards = {}
idx = [m.start() for m in re.finditer(r'<a href="/en/eateries/[^"/]+/" class="thumbnail"', listing)] + [len(listing)]
for a, b in zip(idx, idx[1:]):
    c = listing[a:b]
    code = re.search(r'href="/en/eateries/([^"/]+)/"', c).group(1)
    img = re.search(r'<img[^>]+src="(/cache/img/[^"]+)"', c)
    order = [html.unescape(h) for h in re.findall(r'href="(https?://[^"]+)"', c) if 'catering.hku.hk' not in h]
    cards[code] = {'thumb': SITE + img.group(1) if img else None, 'order': order[0] if order else None}

out = {}
for code, pid in OUTLETS.items():
    s = get(f'/en/eateries/{code}/', f'd_{code}.html')
    L = text(s)
    def after(label, stop):
        if label not in L: return None
        i = L.index(label) + 1; vals = []
        while i < len(L) and L[i] not in stop: vals.append(L[i]); i += 1
        return vals
    STOP = {'Mode of Services', 'Food Offerings', 'Order Now', 'OPENING HOURS', 'LOVE IT?', 'Close'}
    service = after('Mode of Services', STOP)
    food = after('Food Offerings', STOP)
    hours = after('OPENING HOURS', STOP) or []
    # the gallery: the outlet's own pictures (not the site's logos), the listing's thumbnail first
    pics = [SITE + p for p in dict.fromkeys(re.findall(r'<img[^>]+src="(/cache/img/[^"]+)"', s))]
    pics = [p for p in pics if not p.endswith('.png')] or pics
    if cards.get(code, {}).get('thumb'): pics = [cards[code]['thumb']] + [p for p in pics if p != cards[code]['thumb']]
    out[pid] = {
        'page': f'{SITE}/en/eateries/{code}/', 'order': cards.get(code, {}).get('order'), 'photos': pics[:6],
        'service': ' '.join(service) if service else None, 'food': ' '.join(food) if food else None,
        'hours': [r for r in ([hours[i], hours[i + 1]] for i in range(0, len(hours) - 1, 2)) if not re.search(r'order|menu', r[0], re.I)],
    }
    print(pid, len(out[pid]['photos']), 'photos', 'order' if out[pid]['order'] else '-', out[pid]['hours'][:1])
json.dump({'source': 'HKU Catering Services, catering.hku.hk (photos linked from there)', 'outlets': out},
          open('data/eateries.json', 'w'), ensure_ascii=False, indent=1)
