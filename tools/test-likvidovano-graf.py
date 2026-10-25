# -*- coding: utf-8 -*-
"""
Skutečné likvidace v grafu (v0.83.0) — bubliny na svíčkách.

  * podstrčené likvidace u skutečných svíček BTC na Binance (15m):
    vrstva LIKVBUB v grafu, bubliny nakreslené (barvy kontrolovat na snímku),
  * vrstva „Liquidations that happened" v nabídce oka je sundá a vrátí,
  * graf páru s násobkem (1000PEPE) se ptá na coin PEPE.
Ukládá snímek do adresáře v SNIMKY (nepovinné).

Spuštění: python tools/test-likvidovano-graf.py http://localhost:8075/index.html
"""
import base64, json, os, sys, time, urllib.request
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLICE = ['binance:BTCUSDT', 'binance:1000PEPEUSDT']

# Likvidace u posledních 40 svíček BTC 15m (skutečné ceny z Binance).
sv = json.load(urllib.request.urlopen('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=40'))
udalosti = []
for i, s in enumerate(sv):
    t, hi, lo = int(s[0]), float(s[2]), float(s[3])
    if i % 3 == 0:
        udalosti.append([t + 60000, lo, 50000 + i * 40000, 0, i % 3])
    if i % 4 == 1:
        udalosti.append([t + 120000, hi, 30000 + i * 20000, 1, 1])
odpoved = json.dumps({'ok': True, 't': int(time.time() * 1000), 'u': udalosti})

mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock = "sessionStorage.setItem('__likvidovano', %s);" % json.dumps(odpoved) + mock + """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a', seznamy: [{ id: 'a', nazev: 'Main', polozky: %s }] }));
localStorage.setItem('perpdesk.chartView', JSON.stringify({ 'binance:BTCUSDT': { interval: '15' }, 'binance:1000PEPEUSDT': { interval: '15' } }));
window.__dotazyLikv = [];
const __f = window.fetch;
window.fetch = function (v, o) { const u = String(v && v.url ? v.url : v); if (u.includes('/api/likvidovano')) window.__dotazyLikv.push(u); return __f(v, o); };
""" % json.dumps(KLICE)

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable'):
    p.prikaz(c)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=2, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)
SNIMKY = os.environ.get('SNIMKY')
chyby = []


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def over(podminka, popis):
    print(('  ok   ' if podminka else '  !!   ') + popis)
    if not podminka:
        chyby.append(popis)


vrstva = lambda: ev("window.__graf.getIndicators({ name: 'LIKVBUB' }).length") or 0

print('1) BTC na Binance s likvidacemi')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(3)
ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"]').click()")
for _ in range(60):
    time.sleep(0.25)
    if vrstva():
        break
time.sleep(1.5)
over(vrstva() == 1, 'vrstva LIKVBUB v grafu')
n = ev('window.__bublinyLikv') or 0
over(n >= 10, f'bubliny nakreslené ({n})')
over(any('c=BTC&' in u for u in ev('window.__dotazyLikv') or []), 'dotaz na coin BTC')
if SNIMKY:
    open(os.path.join(SNIMKY, 'likvidovano-btc.png'), 'wb').write(base64.b64decode(p.prikaz('Page.captureScreenshot', format='png')['data']))

print('2) tlačítko Proběhlé likvidace na liště mapy (v0.84.0)')
over(ev("!document.getElementById('liqLista').hidden"), 'lišta mapy je vidět')
ev("document.getElementById('liqProbehle').click()")
time.sleep(0.5)
over(vrstva() == 0, 'vypnutím bubliny zmizí')
ev("document.getElementById('liqProbehle').click()")
time.sleep(2)
over(vrstva() == 1, 'zapnutím se vrátí')
over(not ev("[...document.querySelectorAll('.nabidka-radek')].some((r) => /Liquidations that happened/.test(r.textContent))"), 'v nabídce oka už řádek není')
ev("history.back()")
time.sleep(1.5)

print('3) 1000PEPE se ptá na coin PEPE')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:1000PEPEUSDT\"]').click()")
time.sleep(5)
over(any('c=PEPE&' in u for u in ev('window.__dotazyLikv') or []), 'dotaz na coin PEPE')
chyby_app = ev('window.__chyby') or []
over(not chyby_app, f'bez chyb v aplikaci {chyby_app[:2]}')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'{len(chyby)} chyb')
sys.exit(1 if chyby else 0)
