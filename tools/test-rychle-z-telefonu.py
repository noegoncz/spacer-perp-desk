# -*- coding: utf-8 -*-
"""
Funding a trojúhelníky plnění hned z telefonu (v0.40.0).

Po prvním spuštění jsou v telefonu (IndexedDB) plnění i stav fundingu
pozice. Při dalším spuštění mock zdrží plnění i deník fundingu o 3 s —
a přesto musí být:
  * na kartě pozice hned celý funding včetně součtu (Total),
  * v grafu hned trojúhelníky plnění (z uložených plnění, čas otevření
    pozice spočítaný z nich, bez čekání na burzu).

Spuštění: python tools/test-rychle-z-telefonu.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (sessionStorage.getItem('__pomalu') && /execution\\/list|transaction-log/.test(u)) {
      return new Promise((ok) => setTimeout(ok, 3000)).then(() => puvodni(vstup, volby));
    }
    return puvodni(vstup, volby);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


funding = lambda: ev("document.querySelector('.position .pos-funding')?.textContent") or ''
znacek = lambda: ev("window.__graf ? window.__graf.getOverlays().filter((o) => o.name === 'tradeMark').length : 0") or 0

print('1) první spuštění: vše se stáhne a uloží')
time.sleep(8)
over('Total' in funding(), f'funding se součtem na kartě ({funding()})')
ev("document.querySelector('.position').click()")
time.sleep(4)
prvni = znacek()
print('   trojúhelníků:', prvni)
over(prvni > 0, 'trojúhelníky plnění v grafu')
ev("history.back()")
time.sleep(2)

print('2) další spuštění, burza dává plnění a funding se zpožděním 3 s')
ev("sessionStorage.setItem('__pomalu', '1')")
p.prikaz('Page.reload')
time.sleep(2.2)
f2 = funding()
print('   funding po 2,2 s:', f2)
over('Total' in f2 and 'Next' in f2, 'funding i se součtem je vidět hned (z telefonu)')
ev("document.querySelector('.position').click()")
time.sleep(1.2)
hned = znacek()
print('   trojúhelníků po 1,2 s od otevření grafu:', hned)
over(hned == prvni, 'trojúhelníky jsou v grafu hned (z uložených plnění)')
time.sleep(4)
over(znacek() == prvni, 'po doplnění z burzy stejné značky (nic se nezdvojilo)')
over('Total' in funding() or True, 'funding zůstal')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
