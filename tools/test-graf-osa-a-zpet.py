# -*- coding: utf-8 -*-
"""
Cenovky SL/TP/likvidace na cenové ose a velké tlačítko zpět (v0.16.9).

  * Každá čára pozice kromě limitek má na cenové ose štítek s cenou ve své
    barvě, stejně jako aktuální cena. Měří se v pixelech osy: v řádku čáry
    musí být barva té čáry.
  * Vpravo dole v liště timeframů je velké tlačítko zpět na přehled
    (na palec pravé ruky). Klepnutí jde **skutečným dotykem** přes CDP —
    syntetická událost z JavaScriptu obchází rozhodování prohlížeče.

Spuštění: python tools/test-graf-osa-a-zpet.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

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


chyby = []
ev("document.querySelector('.position').click()")
time.sleep(4)

# ---- cenovky na ose ----
# Pro každou čáru pozice: kde leží (y) a jakou má barvu; pak se podívat do
# plátna cenové osy, jestli je v tom řádku ta barva.
vysledek = json.loads(ev("""(() => {
  const g = window.__graf;
  const cary = g.getOverlays().filter((o) => o.name === 'positionLine');
  const platna = [...document.querySelectorAll('canvas')];
  // Cenová osa je úzké vysoké plátno vpravo.
  const osy = platna.filter((c) => c.width < 120 && c.height > 200);
  const vzorek = (y, hex) => {
    const n = parseInt(hex.slice(1), 16);
    const cil = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    let zasahu = 0;
    for (const c of osy) {
      const d = c.getContext('2d').getImageData(0, Math.max(0, Math.round(y) - 3), c.width, 7).data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - cil[0]) < 30 && Math.abs(d[i+1] - cil[1]) < 30
            && Math.abs(d[i+2] - cil[2]) < 30) zasahu += 1;
      }
    }
    return zasahu;
  };
  return JSON.stringify(cary.map((o) => {
    const b = g.convertToPixel({ value: o.points[0].value }, { paneId: 'candle_pane' });
    const y = (Array.isArray(b) ? b[0] : b).y;
    return { titulek: o.extendData.title, bez: !!o.extendData.bezCenovky,
             y: Math.round(y), barvy: vzorek(y, o.extendData.color) };
  }));
})()""") or '[]')
vyska = ev("window.__graf.getSize('candle_pane', 'main').height") or 0
viditelnych = 0
for c in vysledek:
    print(f"{c['titulek']:<12} y={c['y']:<5} bez cenovky={c['bez']!s:<5} pixelů barvy na ose: {c['barvy']}")
    # Čára mimo viditelnou část grafu cenovku mít nemůže — není kam ji dát.
    if c['bez'] or not (0 < c['y'] < vyska):
        continue
    viditelnych += 1
    if c['barvy'] < 40:
        chyby.append(f"{c['titulek']} nemá na cenové ose cenovku ({c['barvy']} px)")
if not viditelnych:
    chyby.append('žádná čára s cenovkou není vidět, není co měřit')

# Take profit i likvidace leží v mocku mimo viditelnou část. Aby se ověřila
# i zelená cenovka (s bílým písmem, ne tmavým jako oranžový SL), přidá se
# zkušební čára doprostřed viditelného rozsahu.
zelena = ev("""(() => {
  const g = window.__graf;
  const h = g.getSize('candle_pane', 'main').height;
  const b = g.convertFromPixel([{ y: h * 0.4 }], { paneId: 'candle_pane' });
  const cena = (Array.isArray(b) ? b[0] : b).value;
  g.createOverlay({ name: 'positionLine', groupId: 'test', lock: true,
    points: [{ value: cena }], extendData: { color: '#16c784', title: 'TEST', dash: [14, 6] } });
  return Math.round(h * 0.4); })()""")
time.sleep(0.5)
zasahu = ev("""(() => {
  const osy = [...document.querySelectorAll('canvas')].filter((c) => c.width < 120 && c.height > 200);
  let n = 0;
  for (const c of osy) {
    const d = c.getContext('2d').getImageData(0, %d - 3, c.width, 7).data;
    for (let i = 0; i < d.length; i += 4)
      if (Math.abs(d[i] - 22) < 30 && Math.abs(d[i+1] - 199) < 30 && Math.abs(d[i+2] - 132) < 30) n += 1;
  }
  return n; })()""" % zelena)
print(f'zelená zkušební čára: pixelů barvy na ose: {zasahu}')
if (zasahu or 0) < 40:
    chyby.append(f'zelená čára nemá na cenové ose cenovku ({zasahu} px)')
ev("window.__graf.removeOverlay({ groupId: 'test' })")

# ---- tlačítko zpět dole vpravo ----
b = json.loads(ev("""(() => { const e = document.getElementById('chartBackBtnDole');
  if (!e) return 'null';
  const r = e.getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2,
    w: r.width, h: r.height, vpravo: innerWidth - r.right, dole: innerHeight - r.bottom }); })()""") or 'null')
print('tlačítko zpět dole:', b)
if not b:
    chyby.append('tlačítko zpět dole chybí')
else:
    if b['w'] < 48 or b['h'] < 44:
        chyby.append(f"tlačítko zpět je malé: {b['w']}×{b['h']}")
    if b['vpravo'] > 16:
        chyby.append(f"tlačítko zpět není u pravého okraje ({b['vpravo']} px)")
    # skutečné klepnutí prstem
    for typ, body in (('touchStart', [{'x': b['x'], 'y': b['y'], 'id': 1}]),
                      ('touchEnd', [])):
        p.prikaz('Input.dispatchTouchEvent', type=typ, touchPoints=body)
        time.sleep(0.05)
    time.sleep(1.2)
    zavreno = ev("document.getElementById('viewChart').hidden")
    seznam = ev("!document.getElementById('viewPositions').hidden")
    print('po klepnutí: graf zavřený =', zavreno, ', seznam vidět =', seznam)
    if not zavreno or not seznam:
        chyby.append('klepnutí na tlačítko zpět graf nezavřelo')

# timeframy se nesmí tlačítkem rozbít (třída interval-btn = přepnutí intervalu)
if ev("document.getElementById('chartBackBtnDole').classList.contains('interval-btn')"):
    chyby.append('tlačítko zpět má třídu interval-btn — bralo by se jako timeframe')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: CENOVKY I TLAČÍTKO ZPĚT SEDÍ')
