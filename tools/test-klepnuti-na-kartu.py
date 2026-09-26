# -*- coding: utf-8 -*-
"""
Klepnutí na kartu pozice otevře graf **i při živých cenách** (v0.17.2).

Karty pozic se při každé změně mark ceny překreslují a Bybit posílá ticker
několikrát za vteřinu. Když se karta vyměnila mezi dotykem a zvednutím
prstu, klepnutí se ztratilo: karta problikla (`:active`), ale graf se
neotevřel. Na telefonu to vypadalo jako „někdy to reaguje, někdy ne".

Test pouští ticker každých 80 ms (jako Bybit při pohybu ceny) a dvacetkrát
klepne na kartu **skutečným dotykem** přes CDP, s prstem na displeji
150 ms jako člověk. Graf se musí otevřít pokaždé.

Spuštění: python tools/test-klepnuti-na-kartu.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
# Vlastní WebSocket, do kterého jde posílat zprávy jako z burzy.
mock += """
window.__ws = [];
window.WebSocket = function (url) {
  this.url = url;
  this.readyState = 0;
  this.send = () => {};
  this.close = () => { this.readyState = 3; };
  window.__ws.push(this);
  setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 60);
};
window.WebSocket.OPEN = 1;
window.__zprava = (topic, data) => {
  window.__ws.forEach((s) => { if (s.onmessage) s.onmessage({ data: JSON.stringify({ topic, data }) }); });
};
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


# Živé ceny: ticker každých 80 ms s pokaždé jinou mark cenou.
ev("""window.__tik = setInterval(() => {
  const m = (0.3058 + Math.random() * 0.001).toFixed(5);
  window.__zprava('tickers.JUPUSDT', { symbol: 'JUPUSDT', markPrice: m });
}, 80);""")
time.sleep(1)

prekresleni = ev("""(() => { const l = document.getElementById('positionList');
  let n = 0; new MutationObserver(() => { n += 1; }).observe(l, { childList: true });
  return new Promise((r) => setTimeout(() => r(n), 1000)); })()""")
r = p.prikaz('Runtime.evaluate', expression="""(() => { const l = document.getElementById('positionList');
  let n = 0; const o = new MutationObserver(() => { n += 1; }); o.observe(l, { childList: true });
  return new Promise((r) => setTimeout(() => { o.disconnect(); r(n); }, 1000)); })()""",
             returnByValue=True, awaitPromise=True)
print('překreslení seznamu za vteřinu:', r.get('result', {}).get('value'))

POKUSU = 20
otevreno = 0
for i in range(POKUSU):
    b = json.loads(ev("""(() => { const r = document.querySelector('.position .pos-ladder')
      .getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + 10 }); })()"""))
    bod = [{'x': b['x'], 'y': b['y'], 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.15)  # prst chvíli na displeji, jako u člověka
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.9)
    graf = ev("!document.getElementById('viewChart').hidden")
    if graf:
        otevreno += 1
        ev("history.back()")
        time.sleep(1.2)
print(f'graf se otevřel {otevreno}× z {POKUSU} klepnutí')

# ---- klepnutí hned po přejetí mezi záložkami ----
# ⚠ Tohle byla skutečná příčina: po přejetí zůstal viset příznak, který má
# potlačit klepnutí z téhož gesta. Android po přejetí žádné klepnutí
# nepošle, takže příznak snědl až první skutečné klepnutí na kartu.
def prejed(x1, x2, y):
    bod = lambda x: [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x1))
    for i in range(1, 11):
        p.prikaz('Input.dispatchTouchEvent', type='touchMove', touchPoints=bod(x1 + (x2 - x1) * i / 10))
        time.sleep(0.012)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.6)


PO_PREJETI = 5
po_prejeti = 0
for i in range(PO_PREJETI):
    prejed(340, 80, 600)   # na Trhy
    prejed(80, 340, 600)   # zpátky na Pozice
    zalozka = ev("document.querySelector('.tab.active')?.dataset.tab")
    b = json.loads(ev("""(() => { const r = document.querySelector('.position .pos-ladder')
      .getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + 10 }); })()"""))
    bod = [{'x': b['x'], 'y': b['y'], 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.15)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.9)
    if ev("!document.getElementById('viewChart').hidden"):
        po_prejeti += 1
        ev("history.back()")
        time.sleep(1.2)
    else:
        print(f'  pokus {i + 1}: záložka {zalozka}, klepnutí na kartu graf NEotevřelo')
print(f'hned po přejetí se graf otevřel {po_prejeti}× z {PO_PREJETI}')

ev("clearInterval(window.__tik)")
konzole = ev('(window.__chyby||[]).join(" | ")') or ''

print()
if otevreno == POKUSU and po_prejeti == PO_PREJETI and not konzole:
    print('VÝSLEDEK: KLEPNUTÍ NA KARTU OTEVŘE GRAF POKAŽDÉ')
else:
    print('VÝSLEDEK: !!! KLEPNUTÍ SE ZTRÁCÍ')
    if otevreno != POKUSU:
        print(f'  - graf se otevřel jen {otevreno}× z {POKUSU}')
    if po_prejeti != PO_PREJETI:
        print(f'  - hned po přejetí mezi záložkami se graf otevřel jen {po_prejeti}× z {PO_PREJETI}')
    if konzole:
        print(f'  - chyby v konzoli: {konzole}')
