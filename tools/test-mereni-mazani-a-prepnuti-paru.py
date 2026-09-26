# -*- coding: utf-8 -*-
"""
Smazání měření a žádný cizí graf při přepnutí páru (v0.17.3).

  * Měření jde klepnutím vybrat: objeví se úchyty na obou bodech a paleta
    **jen s košem** (barvy, tloušťka ani alarm tam smysl nemají). Košem se
    měření smaže. Dřív na něj nešlo klepnout a nešlo ho odstranit.
  * Při otevření jiného páru se do příchodu jeho svíček **neukazuje graf
    předchozího páru**. Instance grafu se recykluje a na pomalejší síti
    (telefon) bylo půl vteřiny vidět staré svíčky, než to přebliklo.
    Mock zdrží svíčky druhého páru o vteřinu a test se během té doby
    podívá, co je vidět.

Ovládání skutečnými dotyky přes CDP.

Spuštění: python tools/test-mereni-mazani-a-prepnuti-paru.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
# Druhý pár v Trzích; jeho svíčky přijdou se zdržením jako na pomalé síti.
mock += """
(() => {
  const t = Date.now();
  const puvodni = window.fetch;
  window.fetch = function (vstup) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/market/tickers') && !u.includes('symbol=')) {
      return Promise.resolve(new Response(JSON.stringify({retCode:0, result:{list:[
        {symbol:'JUPUSDT', lastPrice:'0.30580', price24hPcnt:'0.0123', turnover24h:'1234567', fundingRate:'0.0001', nextFundingTime:String(t+3600e3)},
        {symbol:'BTCUSDT', lastPrice:'0.30000', price24hPcnt:'0.01', turnover24h:'9999999', fundingRate:'0.0001', nextFundingTime:String(t+3600e3)},
      ]}}), {status:200, headers:{'Content-Type':'application/json'}}));
    }
    if (u.includes('/v5/market/kline') && u.includes('symbol=BTCUSDT')) {
      return new Promise((r) => setTimeout(() => r(puvodni(vstup)), 1000));
    }
    return puvodni(vstup);
  };
  localStorage.removeItem('perpdesk.indicators');
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=420, height=860,
         deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


def klepni(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.5)


def tahni(x1, y1, x2, y2, kroku=12):
    bod = lambda x, y: [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x1, y1))
    for i in range(1, kroku + 1):
        p.prikaz('Input.dispatchTouchEvent', type='touchMove',
                 touchPoints=bod(x1 + (x2 - x1) * i / kroku, y1 + (y2 - y1) * i / kroku))
        time.sleep(0.015)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.3)


MERENI = "window.__graf.getOverlays().filter((o) => o.name === 'mereni').length"
chyby = []
ev("document.querySelector('.position').click()")
time.sleep(5)

# ---- 1) měření: vytvořit, klepnutím vybrat, smazat košem ----
v = json.loads(ev("""(() => { const r = document.getElementById('drawLayer').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top }); })()"""))
ev("document.querySelector('.tool-btn[data-tool=mereni]').click()")
time.sleep(0.5)
klepni(v['x'], v['y'])
tahni(v['x'], v['y'], v['x'] + 90, v['y'] - 80)
klepni(v['x'], v['y'])
print('měření v grafu:', ev(MERENI))
if ev(MERENI) != 1:
    chyby.append('měření se nevytvořilo, není co mazat')

# Klepnout doprostřed obdélníku měření.
stred = json.loads(ev("""(() => { const g = window.__graf;
  const o = g.getOverlays().find((x) => x.name === 'mereni');
  const b = g.convertToPixel(o.points, { paneId: 'candle_pane' });
  const r = document.getElementById('drawLayer').getBoundingClientRect();
  return JSON.stringify({ x: r.left + (b[0].x + b[1].x) / 2, y: r.top + (b[0].y + b[1].y) / 2 }); })()"""))
klepni(stred['x'], stred['y'])
paleta = json.loads(ev("""(() => { const pnl = document.getElementById('stylePanel');
  const videt = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'
    && !e.closest('[hidden]'); };
  return JSON.stringify({ paleta: !pnl.hidden, jenSmazat: pnl.classList.contains('jen-smazat'),
    kos: videt('styleDeleteBtn'), barvy: videt('styleColors'), alarm: videt('styleAlarmBtn'),
    uchytu: document.querySelectorAll('.draw-handle').length }); })()""") or '{}')
print('po klepnutí na měření:', paleta)
if not paleta.get('paleta'):
    chyby.append('klepnutí na měření ho nevybralo (paleta se neukázala)')
if not paleta.get('kos'):
    chyby.append('u vybraného měření chybí koš')
if paleta.get('barvy') or paleta.get('alarm'):
    chyby.append('u měření se nabízí barvy nebo alarm, které tam nedávají smysl')
if paleta.get('uchytu') != 2:
    chyby.append(f"u měření mají být dva úchyty na změnu velikosti, je jich {paleta.get('uchytu')}")

# Bez viditelné palety by se klepalo naslepo do rohu obrazovky (na šipku
# zpět) — to by test jen zmátlo.
if paleta.get('kos'):
    kos = json.loads(ev("""(() => { const r = document.getElementById('styleDeleteBtn').getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()"""))
    klepni(kos['x'], kos['y'])
print('měření po klepnutí na koš:', ev(MERENI))
if ev(MERENI) != 0:
    chyby.append('košem se měření nesmazalo')
if ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')") not in (None, '[]'):
    kresby = json.loads(ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')"))
    if kresby:
        chyby.append('smazání měření nechalo v kresbách něco navíc')

# ---- 2) přepnutí páru: žádný graf předchozího páru ----
ev("document.getElementById('viewChart').hidden || history.back()")
time.sleep(1.2)
ev("document.querySelector('[data-tab=watchlist]').click()")
time.sleep(3)
ev("[...document.querySelectorAll('.watch-row')].find((r) => r.textContent.includes('BTCUSDT')).click()")
time.sleep(0.35)  # svíčky BTC přijdou až za vteřinu
behem = json.loads(ev("""JSON.stringify({
  viditelnost: getComputedStyle(document.getElementById('chartBox')).visibility,
  svicek: window.__graf.getDataList().length,
  symbol: window.__graf.getSymbol()?.ticker })""") or '{}')
print('během čekání na svíčky BTC:', behem)
if behem.get('viditelnost') != 'hidden' and behem.get('svicek', 0) > 0:
    chyby.append('během čekání na nový pár je vidět graf předchozího páru')
time.sleep(1.5)
po = json.loads(ev("""JSON.stringify({
  viditelnost: getComputedStyle(document.getElementById('chartBox')).visibility,
  svicek: window.__graf.getDataList().length })""") or '{}')
print('po příchodu svíček BTC:', po)
if po.get('viditelnost') != 'visible' or not po.get('svicek'):
    chyby.append('po příchodu svíček se graf neodkryl')

# Návrat na stejný pár nic neschovává (data už jsou, nic se nenačítá navíc).
ev("document.getElementById('viewChart').hidden || history.back()")
time.sleep(1.2)
ev("[...document.querySelectorAll('.watch-row')].find((r) => r.textContent.includes('BTCUSDT')).click()")
time.sleep(0.2)
stejny = ev("getComputedStyle(document.getElementById('chartBox')).visibility")
print('znovu stejný pár, hned po otevření:', stejny)
if stejny != 'visible':
    chyby.append('při znovuotevření stejného páru se graf zbytečně schoval')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: MĚŘENÍ JDE SMAZAT A CIZÍ GRAF NEPROBLIKNE')
