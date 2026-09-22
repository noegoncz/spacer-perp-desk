# -*- coding: utf-8 -*-
"""
Checkpoint 5 — stav appky musí přežít přeložení Foldu (zavřený ⇄ rozevřený),
beze ztráty a beze změny rozměrů okna nereloaduje.

Ověřuje se na dvou úrovních:
  1. Stav grafu (pár, interval, zoom/scroll) je stejný před i po změně
     rozměrů okna — Android při přeložení stránku nereloaduje, jen mění
     rozměry, takže tohle je čistě otázka, jestli si to JS pamatuje.
  2. Karta pozice (`pos-grid`) se na širokém rozevřeném displeji nerozsype
     do nevyváženého posledního řádku — proto `@media (min-width: 480px)
     and (min-aspect-ratio: 3/4)` v css/style.css přidává pátý sloupec.

Rozměry podle Samsung Galaxy Z Fold 5: zavřený cover ~344×882,
rozevřený hlavní displej ~673×841 (málem čtvercový).
"""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Network.enable')
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(4)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return 'VYJIMKA: ' + str(r['exceptionDetails'].get('exception', {}).get('description'))[:200]
    return r.get('result', {}).get('value')


chyby = []

# ---- karta pozice na zavřeném displeji: 2 sloupce ----
sloupcu_cover = ev("getComputedStyle(document.querySelector('.pos-grid')).gridTemplateColumns.split(' ').length")
print('sloupců karty pozice na zavřeném displeji:', sloupcu_cover, '(má být 2)')
if sloupcu_cover != 2:
    chyby.append('pos-grid na cover nemá 2 sloupce')

# ---- otevřít graf, nastavit stav, který se snadno resetuje ----
ev("document.querySelector('.position').click()")
time.sleep(3)
ev("window.__graf.setBarSpace(28)")
ev("window.__graf.scrollToDataIndex(200)")
time.sleep(0.3)

pred = json.loads(ev("""JSON.stringify({
  symbol: document.getElementById('chartSymbol').textContent,
  interval: document.querySelector('.interval-btn.active')?.dataset.interval,
  bar: window.__graf.getBarSpace().bar,
  chartVisible: !document.getElementById('viewChart').hidden,
})"""))
print('stav před přeložením:', pred)

# ---- přeložení: zavřený -> rozevřený, BEZ reloadu ----
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=2, mobile=True)
time.sleep(1.5)

po = json.loads(ev("""JSON.stringify({
  symbol: document.getElementById('chartSymbol').textContent,
  interval: document.querySelector('.interval-btn.active')?.dataset.interval,
  bar: window.__graf.getBarSpace().bar,
  chartVisible: !document.getElementById('viewChart').hidden,
})"""))
print('stav po přeložení:  ', po)

for klic in ('symbol', 'interval', 'chartVisible'):
    if pred[klic] != po[klic]:
        chyby.append(f'{klic} se po přeložení změnil: {pred[klic]!r} -> {po[klic]!r}')
if abs(pred['bar'] - po['bar']) > 0.5:
    chyby.append(f'zoom (bar) se resetoval: {pred["bar"]} -> {po["bar"]}')

# ---- karta pozice po rozevření: 5 sloupců, beze zbytku ----
ev("history.back()")
time.sleep(1)
bunek = ev("document.querySelectorAll('.pos-grid .pos-cell').length")
sloupcu_open = ev("getComputedStyle(document.querySelector('.pos-grid')).gridTemplateColumns.split(' ').length")
print('buněk / sloupců karty pozice na rozevřeném displeji:', bunek, '/', sloupcu_open)
if bunek == 5 and sloupcu_open != 5:
    chyby.append(f'pos-grid na rozevřeném displeji nemá 5 sloupců pro 5 buněk (má {sloupcu_open})')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
print('chyby v konzoli:', konzole or '(žádné)')
print()
if chyby:
    print('VÝSLEDEK: !!! PŘELOŽENÍ MÁ CHYBU')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: STAV PŘEŽIL PŘELOŽENÍ')
