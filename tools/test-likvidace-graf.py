# -*- coding: utf-8 -*-
"""
Likvidační mapa Hyperliquidu v grafu (v0.65.0) — proti **skutečným**
datům z perpyx.com (sbírá je server/likvidace.mjs od 2026-10-21) a
skutečným svíčkám Hyperliquidu / Binance.

  * graf BTC na Hyperliquidu (1m): svíčky se ukážou dřív, než se mapa
    vůbec začne stahovat (graf na mapu nečeká),
  * mapa je vrstva LIQMAP s pruhy a popiskem „Hyperliquid liquidations",
  * vrstva Likvidace v nabídce oka mapu sundá a vrátí,
  * graf BTC na Binance: stejná mapa, posunutá na cenu Binance (popisek),
  * pár, který na Hyperliquidu není, mapu nemá (a nic nespadne).
Ukládá snímky obrazovky do adresáře v proměnné SNIMKY (nepovinné).

Spuštění: python tools/test-likvidace-graf.py http://localhost:8075/index.html
"""
import base64, json, os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLICE = ['hyperliquid:BTCUSDC', 'binance:BTCUSDT', 'binance:SPCXUSDT']
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock = "sessionStorage.setItem('__mapaNaostro', '1');" + mock + """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'Main', polozky: %s }] }));
localStorage.setItem('perpdesk.chartView', JSON.stringify({ 'hyperliquid:BTCUSDC': { interval: '1' }, 'binance:BTCUSDT': { interval: '30' } }));
localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL']));
// Kdy dorazily svíčky a kdy se začala stahovat mapa.
window.__casy = {};
const __f = window.fetch;
window.fetch = function (u, o) {
  if (String(u).includes('/api/likvidace') && !window.__casy.mapa) window.__casy.mapa = performance.now();
  return __f.apply(this, arguments);
};
""" % json.dumps(KLICE)

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)
SNIMKY = os.environ.get('SNIMKY')


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  !!   ') + popis)
    if not podminka:
        chyby.append(popis)


def snimek(nazev):
    if SNIMKY:
        img = p.prikaz('Page.captureScreenshot', format='png')['data']
        open(os.path.join(SNIMKY, nazev), 'wb').write(base64.b64decode(img))


mapa = lambda: ev("window.__graf.getIndicators({ name: 'LIQMAP' }).length") or 0

print('1) BTC na Hyperliquidu (1m)')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(3)
ev("window.__casy = {}; window.__casy.klik = performance.now(); window.__nabehMapy = []")
ev("document.querySelector('#watchList .tile[data-klic=\"hyperliquid:BTCUSDC\"]').click()")
for _ in range(40):
    time.sleep(0.25)
    if not ev("window.__casy.svice") and (ev("window.__graf.getDataList().length") or 0) > 0:
        ev("window.__casy.svice = performance.now()")
    if mapa():
        break
time.sleep(1)
casy = ev("window.__casy") or {}
print('   časy (ms od klepnutí):', {k: round(v - casy.get('klik', 0)) for k, v in casy.items()})
over(casy.get('svice') and casy.get('mapa') and casy['mapa'] >= casy['svice'] - 300,
     'mapa se začne stahovat až po svíčkách')
over(mapa() == 1, 'vrstva LIQMAP v grafu')
time.sleep(0.8)
nabeh = ev("window.__nabehMapy") or []
over(len(nabeh) >= 5 and nabeh[0] < 0.6 and nabeh[-1] == 1 and nabeh == sorted(nabeh),
     f'mapa naběhne plynule ({len(nabeh)} snímků, {[round(x, 2) for x in nabeh[:4]]}… {nabeh[-1:] })')
pocet = ev("(() => { const d = window.__graf.getIndicators({ name: 'LIQMAP' })[0]; return d ? 1 : 0; })()")
time.sleep(1)
snimek('liq-hl-1m.png')

print('2) vrstva Likvidace')
ev("document.getElementById('layersBtn').click()")
time.sleep(0.5)
radek = ev("[...document.querySelectorAll('.nabidka-radek')].map((r) => r.textContent).find((x) => /Liquidations/.test(x)) || ''")
over(bool(radek), f'v nabídce oka je vrstva Likvidace ({radek[:40]})')
ev("[...document.querySelectorAll('.nabidka-radek')].find((r) => /Liquidations/.test(r.textContent)).click()")
time.sleep(0.5)
over(mapa() == 0, 'vypnutím vrstvy mapa zmizí')
ev("[...document.querySelectorAll('.nabidka-radek')].find((r) => /Liquidations/.test(r.textContent)).click()")
time.sleep(3)
over(mapa() == 1, 'zapnutím se vrátí')
print('2b) filtr šumu — žebřík na levé stěně (v0.84.0)')
ev("document.querySelector('[data-close=sheetLayers]').click()")
time.sleep(0.5)
over(ev("!document.getElementById('liqLista').hidden"), 'lišta mapy je v grafu vidět')
schody = ev("[...document.querySelectorAll('#liqZebrik button')].map((b) => b.textContent)") or []
print('   schody:', schody)
over(3 <= len(schody) <= 8, f'žebřík má 3–8 schodů ({len(schody)})')
over(schody and schody[-1].startswith('All'), 'dole schod All')
over(sum(1 for x in schody if x.startswith('≥')) >= 2, 'schody ukazují rozsah v USD')
pred = ev("window.__pruhyMapy") or 0


def klepni(sel):
    r = ev(f"(() => {{ const r = document.querySelector({sel!r}).getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()")
    bod = [{'x': r['x'], 'y': r['y'], 'radiusX': 6, 'radiusY': 6, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.8)


klepni('#liqZebrik button:first-child')   # nejvyšší schod = největší práh
po = ev("window.__pruhyMapy") or 0
print(f'   pruhů: {pred} → {po}')
over(pred > 0 and po < pred, f'nejvyšší schod schová malé pruhy ({pred} → {po})')
ulozeno = float(ev("localStorage.getItem('perpdesk.liqFilter')") or 0)
over(ulozeno >= 0.3, f'filtr se uložil ({ulozeno:.2f})')
over(ev("document.querySelector('#liqZebrik button:first-child').classList.contains('active')"), 'vybraný schod zvýrazněný')
klepni('#liqZebrik button:last-child')
over((ev("window.__pruhyMapy") or 0) >= pred, 'schod All = zase všechny pruhy')
ev("document.getElementById('layersBtn').click()")
time.sleep(0.5)
ev("[...document.querySelectorAll('.nabidka-radek')].find((r) => /Liquidations/.test(r.textContent)).click()")
time.sleep(0.5)
over(ev("document.getElementById('liqLista').hidden"), 'vypnutá vrstva = lišta schovaná')
ev("[...document.querySelectorAll('.nabidka-radek')].find((r) => /Liquidations/.test(r.textContent)).click()")
time.sleep(3)
ev("document.querySelector('[data-close=sheetLayers]').click()")
time.sleep(0.3)
ev("history.back()")
time.sleep(1.5)

print('3) BTC na Binance (4h) — posun na cenu Binance')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"]').click()")
for _ in range(40):
    time.sleep(0.25)
    if mapa():
        break
over(mapa() == 1, 'mapa i na grafu Binance')
time.sleep(1)
snimek('liq-binance-4h.png')
# v0.83.1: čáry nesmí přes popisky nahoře ani přes pruh objemu dole.
orez = ev("(() => { const o = window.__orezMapy; const h = window.__graf.getSize('candle_pane', 'main').height; const vol = window.__graf.getIndicators({ name: 'VOL', paneId: 'candle_pane' }).length; return { ...o, h, vol }; })()")
print('   ořez mapy:', orez)
over(orez and orez['horni'] >= 40, 'mapa začíná pod popisky')
over(orez and (orez['dolni'] < orez['h'] * 0.85 if orez['vol'] else orez['dolni'] >= orez['h'] - 3), 'mapa končí nad pruhem objemu (je-li zapnutý)')
ev("history.back()")
time.sleep(1.5)

print('4) pár bez Hyperliquidu')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:SPCXUSDT\"]').click()")
time.sleep(6)
over(not ev("document.getElementById('liqLista').hidden"), 'lišta se zdroji je vidět')
over(ev("document.querySelector('[data-zdroj=skutecne]').classList.contains('bez-dat')"), 'SPCX (na HL není): Actual zašedlé')
odhad = ev("document.querySelector('[data-zdroj=burza]').classList.contains('bez-dat')")
print('   odhad bez dat:', odhad, '· pruhů:', mapa())


def zdroj(z):
    r = ev(f"(() => {{ const r = document.querySelector('[data-zdroj={z}]').getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()")
    bod = [{'x': r['x'], 'y': r['y'], 'radiusX': 6, 'radiusY': 6, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(3)


zdroj('skutecne')
over(mapa() == 0, 'Actual: SPCX (na HL není) mapu nemá')
over(ev("document.querySelector('[data-zdroj=skutecne]').classList.contains('active')"), 'Real je vybraný')
if not odhad:
    zdroj('burza')
    over(mapa() > 0, f'Estimate: SPCX má odhad z Binance + Bybit ({mapa()})')
zdroj('shoda')
ev("history.back()")
time.sleep(1)

print('5) přepínač: burza grafu / všechny CEX / shoda (v0.79.0), výchozí podle burzy a objemy (v0.82.0)')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"]').click()")
time.sleep(8)
over(ev("document.querySelector('[data-zdroj=burza]').classList.contains('active')"), 'graf Binance otevře mapu Binance')
for _ in range(30):
    objemy = ev("[...document.querySelectorAll('#liqZdroj .liq-objem')].map((e) => e.textContent)") or []
    if objemy and all(o != '–' for o in objemy):
        break
    time.sleep(1)
print('   objemy:', objemy)
over(objemy and all(o != '–' for o in objemy), 'objemy všech zdrojů se doplnily samy')
over(ev("document.getElementById('liqZdrojBurza').textContent") == 'Binance', 'první volba nese název burzy grafu')
zdroj('burza')
time.sleep(3)
info = ev('window.__mapaInfo') or {}
print('  ', info)
over('Binance' in info.get('popis', '') and 'Bybit' not in info.get('popis', ''), 'Binance: jen burza grafu')
over(info.get('prubehu', 0) > 0, f"pruhy mají průběh hodnoty ({info.get('prubehu')})")
zdroj('vse')
time.sleep(6)
info = ev('window.__mapaInfo') or {}
print('  ', info)
over('Bybit' in info.get('popis', '') and 'Hyperliquid' not in info.get('popis', ''), 'All CEX: i Bybit, bez reálné')
over(ev("document.querySelector('[data-zdroj=vse]').classList.contains('active')"), 'All CEX je vybraný')
zdroj('shoda')
time.sleep(6)
info = ev('window.__mapaInfo') or {}
print('  ', info)
over('confirmed' in info.get('popis', ''), 'Shoda: reálné potvrzené kalkulovanou')
snimek('mapa-shoda.png')
poloha = ev("(() => { const a = document.getElementById('liqLista').getBoundingClientRect(), v = document.getElementById('chartBox').getBoundingClientRect(), h = window.__graf.getSize('candle_pane', 'main').height; return { x: a.left - v.left, y: a.top - v.top, dole: v.top + h - a.bottom }; })()")
over(poloha and poloha['x'] < 12 and poloha['y'] < 12 and poloha['dole'] >= 0, f'lišta vlevo nahoře a vejde se do plochy ({poloha})')
print('6) proběhlé likvidace podle zdroje (v0.84.0)')
over(ev("document.getElementById('liqProbehleZdroj').textContent") == 'Hyperliquid', 'Shoda → proběhlé z Hyperliquidu')
zdroj('vse')
over(ev("document.getElementById('liqProbehleZdroj').textContent") == 'All CEX', 'All CEX → proběhlé ze všech CEX')
zdroj('burza')
over(ev("document.getElementById('liqProbehleZdroj').textContent") == 'Binance', 'burza grafu → proběhlé z Binance')
klepni('#liqProbehle')
over(ev("document.getElementById('liqProbehle').getAttribute('aria-pressed')") == 'false', 'klepnutí proběhlé vypne')
over(ev("!window.__graf.getIndicators({ name: 'LIKVBUB' }).length"), 'bubliny pryč')
klepni('#liqProbehle')
over(ev("document.getElementById('liqProbehle').getAttribute('aria-pressed')") == 'true', 'a zase zapne')
ev("history.back()")
time.sleep(1)

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
