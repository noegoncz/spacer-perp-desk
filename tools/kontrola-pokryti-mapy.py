"""Pokrytí reálné mapy: kolik % otevřených pozic na Hyperliquidu náš sběr sleduje.

Zdroj pravdy = veřejné API Hyperliquidu (metaAndAssetCtxs: openInterest v coinech).
Naše = poslední snímek /api/likvidace (pole `sledovano` = součet hodnoty sledovaných
pozic, longy i shorty). Všechny pozice dohromady = 2 × OI × mark.
"""
import json
import time
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36'}


def get(url, data=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data else None,
                                 headers={**UA, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


meta, ctx = get('https://api.hyperliquid.xyz/info', {'type': 'metaAndAssetCtxs'})
trhy = []
for a, c in zip(meta['universe'], ctx):
    if a.get('isDelisted'):
        continue
    mark = float(c['markPx'] or 0)
    oi = float(c['openInterest'] or 0) * mark
    trhy.append((a['name'], oi, mark))
trhy.sort(key=lambda x: -x[1])

ted = int(time.time() * 1000)
print(f"{'coin':8} {'OI HL (1 strana)':>16} {'sledujeme':>12} {'pokrytí':>8} {'stáří snímku':>13}")
souhrn = []
for name, oi, mark in trhy[:20]:
    try:
        d = get(f'https://perpyx.com/api/likvidace?c={name}&r=1&od={ted - 3 * 3600000}&do={ted}')
    except Exception as e:  # noqa: BLE001
        print(name, 'chyba', e)
        continue
    radky = [r for _, data in d.get('hodiny', []) for r in data.split('\n') if r.strip()]
    if not radky:
        print(f'{name:8} {oi / 1e6:13.1f} M   — žádný snímek za 3 h')
        continue
    posl = json.loads(radky[-1])
    t, sled = posl[0], posl[4]
    pokryti = sled / (2 * oi) if oi else 0
    souhrn.append((name, oi, pokryti))
    print(f'{name:8} {oi / 1e6:13.1f} M {sled / 1e6:9.1f} M {pokryti * 100:7.1f} % {(ted - t) / 60000:9.0f} min')

if souhrn:
    vazene = sum(o * p for _, o, p in souhrn) / sum(o for _, o, _ in souhrn)
    print(f'\nvážené pokrytí (podle OI): {vazene * 100:.1f} %')
