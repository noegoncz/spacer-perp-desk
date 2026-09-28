# -*- coding: utf-8 -*-
"""
Indikátory v hlavním panelu se vrství, nemažou se navzájem (v0.17.5).

⚠ Knihovna grafu indikátor do panelu bez druhého argumentu `true`
nepřidá, ale **vymění** — `addIndicator` nejdřív smaže všechno, co v panelu
je. Linka zisku (PNLLINE) je taky indikátor v hlavním panelu, takže po
otevření grafu pozice potichu smazala objem (i EMA, Bollingera…): v nabídce
svítil jako zapnutý, v grafu nebyl. Vypnutí a zapnutí ho vrátilo, jenže
tím zase zmizela linka zisku.

Dál: RSI bez prázdných okrajů nad 100 a pod 0 a nabídka výšky panelu
i s 10 a 15 %.

Spuštění: python tools/test-indikatory-vrstveni.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL', 'EMA', 'RSI']));
localStorage.removeItem('perpdesk.ind.RSI');
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=420, height=860,
         deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


V_GRAFU = "JSON.stringify(window.__graf.getIndicators().map((i) => i.name).sort())"
chyby = []

ev("document.querySelector('.position').click()")
time.sleep(5)

# ---- 1) po otevření grafu pozice jsou tam všechny uložené + linka zisku ----
v_grafu = json.loads(ev(V_GRAFU) or '[]')
print('indikátory po otevření grafu pozice:', v_grafu)
for nazev in ('VOL', 'EMA', 'RSI', 'PNLLINE'):
    if nazev not in v_grafu:
        chyby.append(f'{nazev} v grafu chybí (smazal ho jiný indikátor v hlavním panelu)')

# ---- 2) zapnutí dalšího indikátoru do hlavního panelu nic nesmaže ----
ev("""(() => { const b = [...document.querySelectorAll('#indicatorList .sheet-item')]
  .find((x) => x.dataset.indicator === 'BOLL'); b && b.click(); })()""")
time.sleep(1.5)
po_boll = json.loads(ev(V_GRAFU) or '[]')
print('po zapnutí Bollingera:', po_boll)
for nazev in ('VOL', 'EMA', 'RSI', 'PNLLINE', 'BOLL'):
    if nazev not in po_boll:
        chyby.append(f'po zapnutí Bollingera zmizel {nazev}')

# ---- 3) objem je opravdu vidět (sloupce ve spodní části hlavního panelu) ----
pixelu = ev("""(() => { const g = window.__graf;
  const h = g.getSize('candle_pane', 'main').height;
  const vsechna = [...document.querySelectorAll('canvas')];
  const sirka = Math.max(...vsechna.map((c) => c.width));
  let n = 0;
  for (const c of vsechna.filter((c) => c.width === sirka && c.height > 200)) {
    const d = c.getContext('2d').getImageData(0, Math.round(h * 0.9), c.width, Math.round(h * 0.09)).data;
    for (let k = 0; k < d.length; k += 4) if (d[k+3] > 20 && (d[k+1] > 60 || d[k] > 60)) n += 1;
  }
  return n; })()""")
print('pixelů sloupců objemu ve spodku panelu:', pixelu)
if (pixelu or 0) < 500:
    chyby.append(f'objem není v grafu vidět ({pixelu} px)')

# ---- 4) RSI bez prázdných okrajů ----
osa = json.loads(ev("""(() => { const g = window.__graf;
  const rsi = g.getIndicators({ name: 'RSI' })[0];
  const h = g.getSize(rsi.paneId, 'main').height;
  const y = (v) => { const b = g.convertToPixel({ value: v }, { paneId: rsi.paneId });
    return (Array.isArray(b) ? b[0] : b).y; };
  return JSON.stringify({ vyska: Math.round(h), y100: Math.round(y(100)), y0: Math.round(y(0)) }); })()""") or '{}')
print('panel RSI:', osa)
if osa:
    nahore = osa['y100']
    dole = osa['vyska'] - osa['y0']
    print(f'  prázdno nad 100: {nahore} px, pod 0: {dole} px')
    if nahore > 10 or dole > 10:
        chyby.append(f'RSI má pořád velké prázdné okraje (nad 100 {nahore} px, pod 0 {dole} px)')
    if nahore < 3 or dole < 3:
        chyby.append('popisky 100 a 0 se do panelu nevejdou celé')

# ---- 5) výška panelu i 10 a 15 % ----
volby = ev("""import('./js/indikatory.js').then((m) => JSON.stringify(
  (m.SCHEMATA.RSI.find((p) => p.klic === 'vyskaPanelu') || {}).moznosti?.map((v) => v.hodnota) || []))""", cekat=True)
print('volby výšky panelu RSI:', volby)
if not volby or 10 not in json.loads(volby) or 15 not in json.loads(volby):
    chyby.append(f've výšce panelu chybí 10 nebo 15 %: {volby}')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: INDIKÁTORY SE VRSTVÍ A RSI NEPLÝTVÁ MÍSTEM')
