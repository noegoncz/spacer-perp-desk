# -*- coding: utf-8 -*-
"""
Historie po 30 dnech (v0.31.2).

  * Bybit bez zadaného období vrací uzavřené obchody jen za posledních
    7 dní a okno smí mít nejvýš 7 dní (mock to napodobuje). Stará verze se
    ptala bez období — v Historii byly jen obchody posledního týdne.
  * Napoprvé se načte 30 dní, další měsíc až po doscrollování na konec.

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
# 30 dní: b3, a2 a m1..m14 (každé 2 dny) = 16.
if not 14 <= prvni <= 17:
    chyby.append(f'napoprvé má být vidět obchody za 30 dní (~16), je jich {prvni}')
if dotazy and dotazy > 8:
    chyby.append(f'napoprvé se stahuje víc než měsíc ({dotazy} dotazů)')

# Doscrollovat na konec seznamu → načte se další měsíc.
for _ in range(3):
    ev("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2.5)
druhy = ev("document.querySelectorAll('.trade').length") or 0
print('po scrollu na konec:', druhy, 'obchodů')
if druhy <= prvni:
    chyby.append('po doscrollování na konec nepřibyly starší obchody')

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
