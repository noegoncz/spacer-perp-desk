# -*- coding: utf-8 -*-
"""
Vlnka po chycení bodu kresby se po dohrání uklidí (v0.47.1).

Na telefonu po každém otevření grafu (třeba z Historie) dvakrát problikl
modrý kroužek na stejném místě: třída `play` na vlnce zůstala viset
a prohlížeč animaci spustil znovu, kdykoli se schovaný graf zase ukázal.
Test vlnku spustí stejně jako kreslení (sundat třídu, reflow, přidat),
počká na dohrání, graf zavře a znovu otevře a hlídá, že se animace
nespustila znovu. Na starém kódu padá.

Spuštění: python tools/test-vlnka.py http://localhost:8075/index.html
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
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


ev("document.querySelector('.position').click()")
time.sleep(4)
over(ev("!!document.querySelector('.draw-ripple')"), 'vlnka v kreslicí vrstvě existuje')
# Totéž, co dělá prehrajVlnku() při chycení bodu.
ev("""(() => { const v = document.querySelector('.draw-ripple'); v.classList.remove('play');
  void v.getBoundingClientRect(); v.classList.add('play');
  window.__startuVlnky = 0; v.addEventListener('animationstart', () => { window.__startuVlnky += 1; }); })()""")
time.sleep(2.4)  # 2 × 850 ms
over(not ev("document.querySelector('.draw-ripple').classList.contains('play')"), 'po dohrání vlnka nemá třídu play')

ev("history.back()")
time.sleep(1.5)
ev("window.__startuVlnky = 0")
ev("document.querySelector('.position').click()")
time.sleep(3)
starty = ev("window.__startuVlnky")
over(starty == 0, f'po novém otevření grafu se vlnka sama nespustila ({starty}×)')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
