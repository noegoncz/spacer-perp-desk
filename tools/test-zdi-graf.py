# -*- coding: utf-8 -*-
"""
Zdi v knize příkazů v grafu (v0.72.0) — proti **skutečnému** serveru
(perpyx.com/api/zdi, sbírá server/zdi.mjs) a skutečným burzám.

  * BTC na Binance: vrstva ZDIMAP s pruhy,
  * klepnutí na zeď ukáže detail (druh, teď, min / max, od kdy),
  * vrstva „Order book walls" v nabídce oka zdi sundá a vrátí,
  * trh, který server nesleduje: zdi z knihy burzy „od teď".
Ukládá snímek do adresáře v SNIMKY (nepovinné).

Spuštění: python tools/test-zdi-graf.py http://localhost:8075/index.html
"""
import base64, json, os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLICE = ['binance:BTCUSDT', 'binance:SPCXUSDT']
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock = "sessionStorage.setItem('__zdiNaostro', '1');" + mock + """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a', seznamy: [{ id: 'a', nazev: 'Main', polozky: %s }] }));
localStorage.setItem('perpdesk.chartView', JSON.stringify({ 'binance:BTCUSDT': { interval: '15' }, 'binance:SPCXUSDT': { interval: '15' } }));
""" % json.dumps(KLICE)

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
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


def dotyk(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 6, 'radiusY': 6, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.6)


zdi = lambda: ev("window.__graf.getIndicators({ name: 'ZDIMAP' }).length") or 0
detail = lambda: ev("document.getElementById('mapDetail').hidden ? '' : document.getElementById('mapDetail').textContent") or ''

print('1) BTC na Binance')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(3)
ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"]').click()")
for _ in range(60):
    time.sleep(0.25)
    if zdi():
        break
time.sleep(1.2)
over(zdi() == 1, 'vrstva ZDIMAP v grafu')
pruhu = ev("window.__pruhyZdi") or 0
over(pruhu >= 4, f'zdi nakreslené ({pruhu} pruhů)')
if SNIMKY:
    open(os.path.join(SNIMKY, 'zdi-btc.png'), 'wb').write(base64.b64decode(p.prikaz('Page.captureScreenshot', format='png')['data']))

print('2) klepnutí na zeď')
bod = ev("""(async () => {
  const z = await (await fetch('https://perpyx.com/api/zdi?k=binance:BTCUSDT')).json();
  const r = document.getElementById('drawLayer').getBoundingClientRect();
  const yy = (c) => { const b = window.__graf.convertToPixel({ value: c }, { paneId: 'candle_pane' }); return (Array.isArray(b) ? b[0] : b).y; };
  // Živá zeď uvnitř obrazu (vzdálené jsou mimo); jinak nejbližší ceně.
  const zed = z.zdi.filter((x) => yy(x[1]) > 30 && yy(x[1]) < r.height - 30).sort((a, b) => Math.abs(a[1] - z.mid) - Math.abs(b[1] - z.mid))[0]
    || z.zdi.sort((a, b) => Math.abs(a[1] - z.mid) - Math.abs(b[1] - z.mid))[0];
  const y = yy(zed[1]);
  return { x: r.left + r.width - 40, y: r.top + y, cena: zed[1], strana: zed[0] };
})()""")
print('   zeď:', bod)
if bod:
    dotyk(bod['x'], bod['y'])
    text = detail()
    print('   detail:', text)
    over(('Buy wall' in text or 'Sell wall' in text) and 'Min / max' in text and 'Since' in text and 'USD' in text,
         'detail zdi: druh, teď, min / max, od kdy')
    if SNIMKY:
        open(os.path.join(SNIMKY, 'zdi-detail.png'), 'wb').write(base64.b64decode(p.prikaz('Page.captureScreenshot', format='png')['data']))

print('3) vrstva zdí')
ev("document.getElementById('layersBtn').click()")
time.sleep(0.5)
radek = ev("[...document.querySelectorAll('.nabidka-radek')].map((r) => r.textContent).find((x) => /Order book walls/.test(x)) || ''")
over(bool(radek), f'v nabídce oka je vrstva zdí ({radek[:40]})')
ev("[...document.querySelectorAll('.nabidka-radek')].find((r) => /Order book walls/.test(r.textContent)).click()")
time.sleep(0.5)
over(zdi() == 0, 'vypnutím zdi zmizí')
ev("[...document.querySelectorAll('.nabidka-radek')].find((r) => /Order book walls/.test(r.textContent)).click()")
time.sleep(3)
over(zdi() == 1, 'zapnutím se vrátí')
ev("history.back()")
time.sleep(1.5)

print('4) trh, který server nesleduje')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(1)
ev("document.querySelector('#watchList .tile[data-klic=\"binance:SPCXUSDT\"]').click()")
for _ in range(60):
    time.sleep(0.25)
    if zdi():
        break
time.sleep(1)
over(zdi() == 1, 'nesledovaný trh: zdi z knihy burzy')
ev("history.back()")

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
