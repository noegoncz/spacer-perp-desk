# -*- coding: utf-8 -*-
"""
Likvidační mapa Hyperliquidu v grafu (v0.65.0) — proti **skutečným**
datům z perpyx.com (sbírá je server/likvidace.mjs od 2026-10-21) a
skutečným svíčkám Hyperliquidu / Binance.

  * graf BTC na Hyperliquidu (1m): svíčky se ukážou dřív, než se mapa
    vůbec začne stahovat (graf na mapu nečeká),
  * mapa je vrstva LIQMAP s pruhy a popiskem „Hyperliquid liquidations",
  * mapa je indikátor LIQ (v0.91.0): převod z vrstvy ho zapne, nabídka
    indikátorů ho vypne a vrátí, ovládání je panel pod svíčkami
    (sbalený s čipy, rozbalený bez nadpisů, na širokém displeji v řádku),
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
mock = "sessionStorage.setItem('__mapaNaostro', '1'); sessionStorage.setItem('__liqVychozi', '1');" + mock + """
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

print('2) indikátor Likvidační mapa (v0.91.0)')
over(ev("JSON.parse(localStorage.getItem('perpdesk.indicators'))[0]") == 'LIQ', 'převod z vrstvy: LIQ zapnutý a první')
over(ev("window.__graf.getIndicators({ name: 'LIQ' }).length") == 1, 'panel LIQ v grafu')
ev("document.getElementById('layersBtn').click()")
time.sleep(0.5)
over(not ev("[...document.querySelectorAll('.nabidka-radek')].some((r) => /Liquidations/.test(r.textContent))"), 'v nabídce oka mapa už není')
ev("document.querySelector('[data-close=sheetLayers]').click()")
time.sleep(0.3)
ev("document.querySelector('#indicatorList [data-indicator=LIQ]').click()")
time.sleep(0.8)
over(mapa() == 0, 'vypnutím indikátoru mapa zmizí')
over(ev("document.getElementById('liqLista').hidden"), 'a panel s ovládáním taky')
ev("document.querySelector('#indicatorList [data-indicator=LIQ]').click()")
time.sleep(3)
over(mapa() == 1, 'zapnutím se vrátí')
over(not ev("document.getElementById('liqLista').hidden"), 'panel s ovládáním je vidět')


def klepni(sel):
    r = ev(f"(() => {{ const r = document.querySelector({sel!r}).getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()")
    bod = [{'x': r['x'], 'y': r['y'], 'radiusX': 6, 'radiusY': 6, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.8)


PANEL_JS = """(() => { const a = document.getElementById('liqLista').getBoundingClientRect(),
  v = document.getElementById('chartBox').getBoundingClientRect(),
  s = window.__graf.getSize('candle_pane', 'main'),
  q = window.__graf.getSize(window.__graf.getIndicators({ name: 'LIQ' })[0].paneId);
  return { top: a.top - v.top, vyska: a.height, sirka: a.width, dole: s.top + s.height, panelTop: q.top, panelVyska: q.height }; })()"""
panel = lambda: ev(PANEL_JS) or {}

print('2b) panel sbalený / rozbalený, filtr (v0.91.0)')
pp = panel()
print('   ', pp)
over(ev("document.getElementById('liqLista').classList.contains('sbaleno')"), 'výchozí sbalený')
over(pp.get('vyska', 99) <= 34, f"sbalený je jeden řádek ({pp.get('vyska')} px)")
over(abs(pp.get('top', 0) - pp.get('panelTop', -99)) <= 1 and abs(pp.get('vyska', 0) - pp.get('panelVyska', 0)) <= 1, 'leží přesně v panelu indikátoru')
over(pp.get('top', 0) >= pp.get('dole', 999) - 1, 'nepřekrývá svíčky')
sh = ev("document.querySelector('#liqShrnuti .sh-filtr')?.textContent") or ''
over(sh == 'All' or sh.startswith('≥'), f'souhrn ukazuje stupeň filtru ({sh})')
over(bool(ev("document.querySelector('#liqShrnuti .sh-zdroj')?.textContent")), 'souhrn ukazuje zdroj')
over(ev("getComputedStyle(document.getElementById('liqZebrik')).display") == 'none', 'stupně ve sbaleném schované')
# v0.91.2: panel končí u svislice cenové osy, tlačítka Mapa / Proběhlé
# ve sbaleném na úzkém displeji v pruhu osy (jen ikony).
osa = ev("""(() => { const p = document.getElementById('liqLista').getBoundingClientRect(),
  q = window.__graf.getIndicators({ name: 'LIQ' })[0].paneId, m = window.__graf.getSize(q, 'main'),
  v = document.getElementById('chartBox').getBoundingClientRect(),
  t = ['liqCary', 'liqProbehle'].map((id) => document.getElementById(id).getBoundingClientRect());
  return { pravy: p.right - v.left, plocha: m.width, tl: t.map((r) => ({ l: r.left - p.right, w: r.width, h: r.height, t: r.top - p.top })) }; })()""")
print('   osa:', osa)
over(osa and abs(osa['pravy'] - osa['plocha']) <= 1, 'panel končí u cenové osy jako ostatní indikátory')
over(osa and all(t['l'] >= -0.5 and t['w'] >= 20 and t['t'] >= -0.5 and t['h'] <= 22 for t in osa['tl']), 'tlačítka Mapa / Proběhlé v pruhu osy')
# v0.91.1: sloupec popisku stejně široký jako u ostatních indikátorů, šipky vedle něj.
sl = ev("""(() => { const p = document.getElementById('liqLista'), h = document.getElementById('liqSbal').getBoundingClientRect(),
  m = p.querySelector('[data-misto-sipek]').getBoundingClientRect(), r = p.getBoundingClientRect();
  return { sloupec: parseFloat(getComputedStyle(p).getPropertyValue('--sl')), hlava: h.left - r.left, misto: m.left - r.left }; })()""")
print('   sloupec:', sl)
over(sl and sl['sloupec'] in (76, 96) and sl['hlava'] <= 1 and sl['misto'] >= sl['sloupec'], 'vlevo sloupec popisku, šipky za ním')
snimek('liq-panel-sbaleny.png')
klepni('#liqShrnuti')
time.sleep(0.5)
pp = panel()
over(not ev("document.getElementById('liqLista').classList.contains('sbaleno')"), 'klepnutí na čip panel rozbalí')
over(pp.get('vyska', 99) <= 80, f"rozbalený nízký, bez nadpisů ({pp.get('vyska')} px)")
over(abs(pp.get('vyska', 0) - pp.get('panelVyska', 0)) <= 1, 'panel grafu má výšku ovládání')
schody = ev("[...document.querySelectorAll('#liqZebrik button')].map((b) => b.textContent)") or []
print('   stupně:', schody)
over(len(schody) == 4 and schody[0] == 'All', 'čtyři stupně, první All')
over(sum(1 for x in schody if x.startswith('≥')) >= 2, 'stupně ukazují práh v USD')
over(not ev("document.querySelector('.liq-nadpis')"), 'žádné nadpisy')
PRESAH_JS = """(() => { const p = document.getElementById('liqLista').getBoundingClientRect();
  return [...document.querySelectorAll('#liqLista button')].filter((b) => b.offsetParent && !b.closest('.liq-prepinace'))
    .filter((b) => { const r = b.getBoundingClientRect(); return r.right > p.right + 1 || r.bottom > p.bottom + 1 || r.width < 8; })
    .map((b) => b.id || b.textContent); })()"""
over(not ev(PRESAH_JS), f'nic nepřetéká za okraj panelu ({ev(PRESAH_JS)})')
print('2c) s RSI pod mapou: šipky pořadí se s tlačítky nekryjí')
ev("document.querySelector('#indicatorList [data-indicator=RSI]').click()")
time.sleep(1.5)
sip = ev("""(() => { const s = [...document.querySelectorAll('.pane-poradi.v-ovladani')].find((x) => !x.hidden);
  if (!s) return null; const r = s.getBoundingClientRect(), p = document.getElementById('liqLista').getBoundingClientRect();
  const kryti = [...document.querySelectorAll('#liqLista button')].filter((b) => b.offsetParent).filter((b) => {
    const q = b.getBoundingClientRect(); return q.right > r.left && q.left < r.right && q.bottom > r.top && q.top < r.bottom; }).map((b) => b.id || b.textContent);
  return { uvnitr: r.top >= p.top && r.bottom <= p.bottom + 1 && r.right <= p.right, kryti }; })()""")
print('   ', sip)
over(sip and sip['uvnitr'], 'šipky pořadí jsou v panelu mapy')
over(sip and not sip['kryti'], 'a nekryjí tlačítka')
over(not ev(PRESAH_JS), 'nic nepřetéká ani se šipkami')
snimek('liq-panel-s-rsi.png')
ev("document.querySelector('#indicatorList [data-indicator=RSI]').click()")
time.sleep(1)
snimek('liq-panel-rozbaleny.png')
pred = ev("window.__pruhyMapy") or 0
klepni('#liqZebrik button:last-child')   # největší práh
po = ev("window.__pruhyMapy") or 0
print(f'   pruhů: {pred} → {po}')
over(pred > 0 and po < pred, f'nejvyšší stupeň schová malé pruhy ({pred} → {po})')
ulozeno = float(ev("localStorage.getItem('perpdesk.liqFilter')") or 0)
over(ulozeno >= 0.3, f'filtr se uložil ({ulozeno:.2f})')
over(ev("document.querySelector('#liqZebrik button:last-child').classList.contains('active')"), 'vybraný stupeň zvýrazněný')
klepni('#liqZebrik button:first-child')
over((ev("window.__pruhyMapy") or 0) >= pred, 'stupeň All = zase všechny pruhy')
print('2d) přepínač Mapa (v0.91.1)')
klepni('#liqCary')
over(ev("document.getElementById('liqCary').getAttribute('aria-pressed')") == 'false', 'klepnutí mapu vypne')
over(ev("!window.__graf.getIndicators({ name: 'LIQMAP' }).length"), 'čáry mapy zmizely')
over(ev("localStorage.getItem('perpdesk.liqCary')") == 'false', 'volba se pamatuje')
klepni('#liqCary')
time.sleep(0.5)
over(ev("window.__graf.getIndicators({ name: 'LIQMAP' }).length") == 1, 'a zase zapne')
klepni('#liqSbal')
over(ev("document.getElementById('liqLista').classList.contains('sbaleno')"), 'šipka panel zase sbalí')
over(ev("JSON.parse(localStorage.getItem('perpdesk.ind.LIQ') || '{}').sbaleno") is True, 'stav sbalení se pamatuje')
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
    # Zdroje jsou vidět jen v rozbaleném panelu (v0.91.0).
    if ev("document.getElementById('liqLista').classList.contains('sbaleno')"):
        ev("document.getElementById('liqSbal').click()")
        time.sleep(0.6)
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
# v0.91.3: jen tři zdroje — burza grafu, Real, Match (All CEX zrušené).
over(ev("[...document.querySelectorAll('#liqZdroj [data-zdroj]')].map((b) => b.dataset.zdroj).join()") == 'burza,skutecne,shoda', 'tři zdroje, bez All CEX')
zdroj('shoda')
time.sleep(6)
info = ev('window.__mapaInfo') or {}
print('  ', info)
over('confirmed' in info.get('popis', ''), 'Shoda: reálné potvrzené kalkulovanou')
snimek('mapa-shoda.png')
pp = panel()
over(pp.get('top', 0) >= pp.get('dole', 999) - 1, f'panel pod svíčkami ({pp})')
print('6) Executed v rozbaleném panelu, souhrn ve sbaleném (v0.91.1)')
zdroj('burza')
klepni('#liqProbehle')
over(ev("document.getElementById('liqProbehle').getAttribute('aria-pressed')") == 'false', 'klepnutí bubliny vypne')
over(ev("!window.__graf.getIndicators({ name: 'LIKVBUB' }).length"), 'bubliny pryč')
over(ev("localStorage.getItem('perpdesk.liqBubliny')") == 'false', 'volba se pamatuje')
klepni('#liqSbal')
klepni('#liqProbehle')
over(ev("document.getElementById('liqProbehle').getAttribute('aria-pressed')") == 'true', 've sbaleném jde přepnout tlačítkem v ose')
over(ev("document.getElementById('liqLista').classList.contains('sbaleno')"), 'a panel zůstane sbalený')
klepni('#liqProbehle')
klepni('#liqShrnuti')
klepni('#liqProbehle')
over(ev("document.getElementById('liqProbehle').getAttribute('aria-pressed')") == 'true', 'a zase zapne')
print('7) široký displej (rozevřený Fold): vše v jednom řádku')
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=2, mobile=True)
time.sleep(2)
pp = panel()
print('   ', pp)
over(ev("document.getElementById('liqLista').classList.contains('siroky')"), 'panel je široký')
over(not ev("document.getElementById('liqLista').classList.contains('sbaleno')"), 'rozbalený')
over(pp.get('vyska', 99) <= 42, f"jeden řádek ({pp.get('vyska')} px)")
over(ev("getComputedStyle(document.getElementById('liqZebrik')).display") != 'none' and ev("getComputedStyle(document.getElementById('liqZdroj')).display") != 'none', 'stupně i zdroje vidět')
over(not ev(PRESAH_JS), f'nic nepřetéká ({ev(PRESAH_JS)})')
preteka = ev("[...document.querySelectorAll('#liqLista button')].filter((b) => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent)") or []
over(not preteka, f'texty se vejdou ({preteka})')
snimek('liq-panel-siroky.png')
klepni('#liqSbal')
over(ev("document.getElementById('liqLista').classList.contains('sbaleno')") and (panel().get('vyska') or 99) <= 23, 'i široký jde sbalit na řádek 22 px')
TLACITKA_JS = """(() => { const p = document.getElementById('liqLista').getBoundingClientRect();
  const [a, b] = ['liqCary', 'liqProbehle'].map((id) => document.getElementById(id).getBoundingClientRect());
  return { vOse: a.left >= p.right - 0.5 && b.left >= p.right - 0.5, vedle: Math.abs(a.top - b.top) < 1, pod: b.top >= a.bottom - 0.5 }; })()"""
tl = ev(TLACITKA_JS)
over(tl and tl['vOse'] and tl['vedle'], f'sbalený široký: tlačítka v pruhu osy vedle sebe ({tl})')
klepni('#liqSbal')
tl = ev(TLACITKA_JS)
over(tl and tl['vOse'] and tl['vedle'], f'rozbalený široký: v pruhu osy vedle sebe ({tl})')
klepni('#liqSbal')
snimek('liq-panel-siroky-sbaleny.png')
klepni('#liqSbal')
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=2, mobile=True)
time.sleep(1.5)
if ev("document.getElementById('liqLista').classList.contains('sbaleno')"):
    klepni('#liqSbal')
tl = ev(TLACITKA_JS)
over(tl and tl['vOse'] and tl['pod'], f'úzký rozbalený: tlačítka v pruhu osy nad sebou ({tl})')
snimek('liq-panel-uzky-rozbaleny.png')
ev("history.back()")
time.sleep(1)

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
