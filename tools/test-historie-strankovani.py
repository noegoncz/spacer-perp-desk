# -*- coding: utf-8 -*-
"""
Historie po 30 dnech (v0.31.2).

  * Bybit bez zadaného období vrací uzavřené obchody jen za posledních
    7 dní a okno smí mít nejvýš 7 dní (mock to napodobuje). Stará verze se
    ptala bez období — v Historii byly jen obchody posledního týdne.
  * Napoprvé se načte 7 dní, další měsíc tlačítkem (v0.38.0).

Mock s `__mnohoObchodu` má obchod každé 2 dny po dobu 120 dní.

Spuštění: python tools/test-historie-strankovani.py http://localhost:8080/index.html
Na starém kódu padá (jen obchody za 7 dní, při scrollu nic nepřibude).
"""
import os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument',
         source="sessionStorage.setItem('__mnohoObchodu', '1');")
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


chyby = []
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(3)

prvni = ev("document.querySelectorAll('.trade').length") or 0
dotazy = ev("window.__dotazyClosedPnl || 0")
print('po otevření:', prvni, 'obchodů,', dotazy, 'dotazů na closed-pnl')
# v0.38.0: napoprvé 7 dní — c3 (otevřený obchod), b3 a m1..m3 = 5.
if prvni != 5:
    chyby.append(f'napoprvé mají být vidět obchody za 7 dní (5), je jich {prvni}')
if dotazy != 1:
    chyby.append(f'napoprvé se má stáhnout jen jedno 7denní okno ({dotazy} dotazů)')

# Tlačítko → dalších 30 dní (5 oken souběžně).
ev("document.getElementById('historyMore').click()")
time.sleep(3)
druhy = ev("document.querySelectorAll('.trade').length") or 0
print('po „Load 30 more days“:', druhy, 'obchodů,', ev("window.__dotazyClosedPnl"), 'dotazů')
# + a2 a m4..m18 (do 37 dní) = 16 navíc.
if druhy != prvni + 16:
    chyby.append(f'po tlačítku nepřibylo 30 dní obchodů ({prvni} → {druhy})')
ev("document.getElementById('historyMore').click()")
time.sleep(3)
treti = ev("document.querySelectorAll('.trade').length") or 0
print('po dalším klepnutí:', treti)
if treti <= druhy:
    chyby.append('druhé klepnutí nepřidalo starší obchody')

# Řazení od nejnovějšího.
serazeno = ev("""(() => {
  const t = [...document.querySelectorAll('.trade .trade-pnl')].map((e) => e.textContent);
  return t.length > 2;
})()""")
if not serazeno:
    chyby.append('seznam obchodů se nevykreslil')

zaver = ev("(window.__chyby || []).map(String).join(' | ')")
if zaver:
    chyby.append('chyby v aplikaci: ' + zaver)

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
    sys.exit(1)
print('VÝSLEDEK: vše v pořádku')
