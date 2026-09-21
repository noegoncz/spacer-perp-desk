# -*- coding: utf-8 -*-
"""Zoom dvema prsty se spravnou identitou prstu (id), vcetne zvedani po jednom."""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec
p = Prohlizec()
p.prikaz('Page.enable'); p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-bybit.js'), encoding='utf-8').read())
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(3)

p.js("""(() => {
  const g = window.__graf;
  window.__log = [];
  const puvodni = g.setBarSpace.bind(g);
  g.setBarSpace = function (v) {
    window.__log.push('   -> sirka := ' + Number(v).toFixed(2));
    return puvodni(v);
  };
  const box = document.querySelector('.chart-box');
  ['touchstart','touchmove','touchend'].forEach((jm) => {
    box.addEventListener(jm, (e) => {
      window.__log.push(jm + ' prstu=' + e.touches.length
        + ' [' + [...e.touches].map(t => Math.round(t.clientX)).join(',') + ']');
    }, true);
  });
  return 'ok';
})()""")

box = json.loads(p.js("""(() => { const b = document.querySelector('.chart-box')
  .getBoundingClientRect();
  return JSON.stringify({x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)}); })()"""))
cx, cy = box['x'], box['y']
P = lambda i, x, y: {'x': x, 'y': y, 'id': i, 'radiusX': 12, 'radiusY': 12, 'force': 1}

def stav():
    return p.js("""(() => { const g = window.__graf; const r = g.getVisibleRange();
      return 'sirka ' + g.getBarSpace().bar.toFixed(2) + '  svicky ' + r.from + '-' + r.to
      + '  posun ' + (g.isScrollEnabled() ? 'ZAP' : 'vyp'); })()""")

print('pred gestem:           ', stav())
# dva prsty dolu
p.prikaz('Input.dispatchTouchEvent', type='touchStart',
         touchPoints=[P(1, cx-60, cy), P(2, cx+60, cy)])
time.sleep(0.06)
# roztazeni
for k in range(1, 6):
    d = 60 + k * 16
    p.prikaz('Input.dispatchTouchEvent', type='touchMove',
             touchPoints=[P(1, cx-d, cy), P(2, cx+d, cy)])
    time.sleep(0.03)
time.sleep(0.2)
print('po roztazeni (2.33x):  ', stav())
sirkaPredZvednutim = p.js("window.__graf.getBarSpace().bar")

p.js("window.__log.push('--- zvedam prvni prst, druhy jeste ujizdi ---')")
# prst 2 se zvedne, prst 1 zustava dole
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[P(2, cx+140, cy)])
time.sleep(0.06)
# zbyly prst 1 se jeste chvili veze, jak to dela palec
for k in range(1, 6):
    p.prikaz('Input.dispatchTouchEvent', type='touchMove',
             touchPoints=[P(1, cx-140+k*14, cy+k*7)])
    time.sleep(0.03)
time.sleep(0.25)
print('po ujeti zbylym prstem:', stav())
sirkaPoZvednuti = p.js("window.__graf.getBarSpace().bar")

p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[P(1, cx-70, cy+35)])
time.sleep(0.3)
print('po zvednuti obou:      ', stav())
print()
print('ZMENA MERITKA PO ZVEDNUTI PRVNIHO PRSTU: %.2f -> %.2f  %s'
      % (sirkaPredZvednutim, sirkaPoZvednuti,
         'v poradku, nehnulo se' if abs(sirkaPredZvednutim - sirkaPoZvednuti) < 0.01
         else '!!! ODSKOK'))
print()
print('--- posun jednim prstem musi dal fungovat ---')
pred = p.js("JSON.stringify(window.__graf.getVisibleRange())")
p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=[P(1, cx+60, cy)])
for k in range(1, 9):
    p.prikaz('Input.dispatchTouchEvent', type='touchMove', touchPoints=[P(1, cx+60-k*14, cy)])
    time.sleep(0.03)
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[P(1, cx-52, cy)])
time.sleep(0.3)
po = p.js("JSON.stringify(window.__graf.getVisibleRange())")
print('rozsah pred posunem:', pred)
print('rozsah po posunu:   ', po)
print('posun funguje:', 'ANO' if pred != po else 'NE - graf se nehnul!')
print()
print('--- prubeh udalosti ---')
for r in json.loads(p.js('JSON.stringify(window.__log)'))[:40]:
    print(' ', r)
print('chyby:', p.js('(window.__chyby||[]).join(" | ")') or '(zadne)')
