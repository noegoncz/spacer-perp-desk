# -*- coding: utf-8 -*-
"""
Vzhled grafu po párech (v0.59.13, přání uživatele, jako TabTrader):
každý graf si pamatuje svůj timeframe a šířku svíček (zoom dvěma prsty),
i po přenačtení aplikace. JUPUSDT (Bybit) a binance:BTCUSDT jsou dva grafy.

Spuštění: python tools/test-vzhled-grafu-k-paru.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
seznam = """(() => { if (!sessionStorage.getItem('__seznamVzhled')) { sessionStorage.setItem('__seznamVzhled', '1');
  localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'fav', seznamy: [
    { id: 'fav', nazev: 'Mine', polozky: ['bybit:JUPUSDT', 'binance:BTCUSDT'] }] }));
  localStorage.setItem('perpdesk.marketsLayout', JSON.stringify({ seznam: 'siroke' })); } })();"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable'):
    p.prikaz(c)
p.prikaz('Emulation.setDeviceMetricsOverride', width=430, height=820, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=seznam + mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


chyby = []
interval = lambda: ev("document.querySelector('.interval-btn.active')?.dataset.interval")
sirka = lambda: ev("window.__graf.getBarSpace().bar")


def zpet():
    ev("history.back()")
    time.sleep(1.5)


def otevri_jup():
    ev("document.querySelector('[data-tab=positions]').click()")
    time.sleep(1)
    ev("document.querySelector('.position').click()")
    time.sleep(4)


def otevri_btc():
    ev("document.querySelector('[data-tab=watchlist]').click()")
    time.sleep(4)
    ev("document.querySelector('.tile[data-klic=\"binance:BTCUSDT\"]').click()")
    time.sleep(6)


def klepni_interval(i):
    ev(f"document.querySelector('.interval-btn[data-interval=\"{i}\"]').click()")
    time.sleep(3)


def roztahni():
    box = json.loads(ev("""JSON.stringify((() => { const b = document.querySelector('.chart-box').getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })())"""))
    cx, cy = box['x'], box['y']
    P = lambda i, x, y: {'x': x, 'y': y, 'id': i, 'radiusX': 12, 'radiusY': 12, 'force': 1}
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=[P(1, cx - 50, cy), P(2, cx + 50, cy)])
    time.sleep(0.06)
    for k in range(1, 8):
        d = 50 + k * 15
        p.prikaz('Input.dispatchTouchEvent', type='touchMove', touchPoints=[P(1, cx - d, cy), P(2, cx + d, cy)])
        time.sleep(0.03)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.5)


# 1) JUP: výchozí 4h, přepnout na 1h a přiblížit.
otevri_jup()
print('JUP poprvé:', interval(), sirka())
if interval() != '240':
    chyby.append(f'JUP se poprvé neotevřel na 4h ({interval()})')
klepni_interval('60')
roztahni()
sirka_jup = sirka()
print('JUP po 1h a zoomu:', interval(), sirka_jup)
if not sirka_jup or sirka_jup <= 12:
    chyby.append(f'zoom dvěma prsty svíčky nerozšířil ({sirka_jup})')
zpet()

# 2) BTC na Binance: nový graf → naposledy zvolený timeframe, výchozí šířka; přepnout na 1D.
otevri_btc()
print('BTC poprvé:', interval(), sirka())
if interval() != '60':
    chyby.append(f'nový graf BTC nevzal naposledy zvolený timeframe 1h ({interval()})')
if abs((sirka() or 0) - 10) > 0.5:
    chyby.append(f'nový graf BTC převzal zoom JUP ({sirka()})')
klepni_interval('D')
zpet()

# 3) Po přenačtení aplikace: každý graf na svém.
print('uloženo:', ev("localStorage.getItem('perpdesk.chartView')"))
p.prikaz('Page.reload')
time.sleep(7)
otevri_jup()
print('JUP po restartu:', interval(), sirka())
if interval() != '60':
    chyby.append(f'JUP se po restartu neotevřel na svém 1h ({interval()})')
if abs((sirka() or 0) - sirka_jup) > 0.5:
    chyby.append(f'JUP po restartu ztratil zoom ({sirka()} místo {sirka_jup})')
# Zoom platí i po změně timeframu (srovnání pohledu ho nesmí vrátit na výchozí).
klepni_interval('15')
if abs((sirka() or 0) - sirka_jup) > 0.5:
    chyby.append(f'změna timeframu vrátila zoom JUP na výchozí ({sirka()})')
klepni_interval('60')
zpet()
otevri_btc()
print('BTC po restartu:', interval(), sirka())
if interval() != 'D':
    chyby.append(f'BTC se po restartu neotevřel na svém 1D ({interval()})')
if abs((sirka() or 0) - 10) > 0.5:
    chyby.append(f'BTC má cizí zoom ({sirka()})')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: KAŽDÝ GRAF SI PAMATUJE SVŮJ TIMEFRAME A ZOOM')
