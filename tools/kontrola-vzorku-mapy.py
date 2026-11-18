"""Vzorek: velké pozice přímo z Hyperliquidu → leží v naší reálné mapě?

Pro N největších účtů z veřejného žebříčku stáhne clearinghouseState a pro
každou pozici s likvidační cenou do ±25 % od marku zkontroluje poslední
snímek /api/likvidace: pásmo round(liq / krok) na správné straně má objem
aspoň ~hodnotu pozice (|szi| × liq). Data mapy jsou až několik minut stará
a pozice se mezitím mění — malé rozdíly jsou v pořádku.
"""
import json
import sys
import time
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', 'Content-Type': 'application/json'}
N = int(sys.argv[1]) if len(sys.argv) > 1 else 40


def get(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


lb = get('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard')['leaderboardRows']
lb.sort(key=lambda r: -float(r.get('accountValue') or 0))
ucty = [r['ethAddress'] for r in lb[:N]]

pozice = []
for a in ucty:
    try:
        st = get('https://api.hyperliquid.xyz/info', {'type': 'clearinghouseState', 'user': a})
    except Exception as e:  # noqa: BLE001
        print('účet chyba', a[:10], e)
        continue
    for ap in st.get('assetPositions', []):
        p = ap['position']
        szi = float(p['szi'])
        liq = p.get('liquidationPx')
        if not szi or not liq:
            continue
        pozice.append({'u': a, 'c': p['coin'], 'long': szi > 0, 'szi': abs(szi), 'liq': float(liq),
                       'v': abs(szi) * float(liq)})
    time.sleep(0.15)

pozice = [p for p in pozice if p['v'] >= 200_000]
pozice.sort(key=lambda p: -p['v'])
print(f'účtů {len(ucty)}, pozic ≥ 200 k USD s likvidační cenou: {len(pozice)}')

ted = int(time.time() * 1000)
snimky = {}


def snimek(coin):
    if coin not in snimky:
        d = get(f'https://perpyx.com/api/likvidace?c={coin}&r=1&od={ted - 3 * 3600000}&do={ted}')
        radky = [json.loads(r) for _, data in d.get('hodiny', []) for r in data.split('\n') if r.strip()]
        pasma = {}
        posl = None
        for r in radky:  # K = celý snímek, D = změny (0 = pásmo zmizelo)
            t, mark, krok, typ, sled, zmeny = r
            if typ == 'K':
                pasma = {}
            for i, l, s in zmeny:
                if l or s:
                    pasma[i] = (l, s)
                else:
                    pasma.pop(i, None)
            posl = (t, mark, krok)
        snimky[coin] = (posl, pasma)
    return snimky[coin]


meta, ctx = get('https://api.hyperliquid.xyz/info', {'type': 'metaAndAssetCtxs'})
marky = {a['name']: float(c['markPx']) for a, c in zip(meta['universe'], ctx) if c.get('markPx')}
sedi = mimo = chybi = bez = 0
for p in pozice:
    try:
        (t, mark, krok), pasma = snimek(p['c'])
    except Exception:  # noqa: BLE001
        # Coin bez dat v mapě: v pořádku, jen když je pozice mimo ±25 %.
        m = marky.get(p['c'])
        if m and abs(p['liq'] / m - 1) > 0.25:
            mimo += 1
        else:
            bez += 1
            print(f"?? {p['u']} {p['c']:6} bez dat v mapě, liq {p['liq']:g}, mark {m}, pozice {p['v'] / 1e6:.2f} M")
        continue
    if abs(p["liq"] / mark - 1) > 0.25:
        mimo += 1
        continue
    i = round(p['liq'] / krok)
    strana = 0 if p['long'] else 1
    # ±1 % ceny: u účtů v režimu cross se likvidační cena hýbe se ziskem
    # ostatních pozic a mapa je pár minut stará (po restartu sběru i 25 min).
    sirka = max(1, round(p['liq'] * 0.01 / krok))
    objem = max(pasma.get(j, (0, 0))[strana] for j in range(i - sirka, i + sirka + 1))
    ok = objem >= 0.8 * p['v']
    sedi += ok
    if not ok:
        chybi += 1
    print(f"{'OK ' if ok else '?? ' + p['u']} {p['c']:6} {'long ' if p['long'] else 'short'} liq {p['liq']:<10g} pozice {p['v'] / 1e6:7.2f} M  pásmo {objem / 1e6:7.2f} M  (snímek {(ted - t) / 60000:.0f} min)")

print(f'\nsedí {sedi}, nesedí {chybi}, mimo ±25 % {mimo}, coin bez dat v mapě (malé coiny) {bez}')
