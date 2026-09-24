# -*- coding: utf-8 -*-
"""
Okraje systémových lišt v APK (v0.16.8).

Obal Capacitoru kreslí aplikaci pod stavovou i navigační lištu a okraje
předává jako CSS proměnné `--safe-area-inset-*`. Android WebView přitom
z `env(safe-area-inset-*)` vrací nulu. V prvním APK proto obsah zalezl pod
lišty: na timeframy nešlo klepnout, překryl je panel aplikací Foldu.

Test napodobí obal (dosadí proměnné jako Capacitor) a ověří, že hlavička,
konec seznamu i timeframy v grafu stojí mimo lišty.

Spuštění: python tools/test-okraje-apk.py http://localhost:8080/index.html
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

NAHORE, DOLE = 32, 56

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
document.addEventListener('DOMContentLoaded', () => {
  const r = document.documentElement.style;
  r.setProperty('--safe-area-inset-top', '%dpx');
  r.setProperty('--safe-area-inset-bottom', '%dpx');
});
""" % (NAHORE, DOLE)

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
# Rozevřený Fold — tam je dole panel aplikací, který timeframy překryl.
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841,
         deviceScaleFactor=0, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(8)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


chyby = []

nahore = ev("Math.round(document.querySelector('.topbar').getBoundingClientRect().top)")
print(f'hlavička od horního okraje: {nahore} px (aspoň {NAHORE})')
if nahore is None or nahore < NAHORE:
    chyby.append('hlavička zalezla pod stavovou lištu')

pod = ev("""Math.round(document.body.scrollHeight
  - document.querySelector('.footer').getBoundingClientRect().bottom - window.scrollY)""")
print(f'místo pod patičkou na konci stránky: {pod} px (aspoň {DOLE})')
if pod is None or pod < DOLE:
    chyby.append('konec seznamu zalezl pod navigační lištu')

ev("document.querySelector('.position').click()")
time.sleep(4)

tf = ev("""(() => { const b = [...document.querySelectorAll('.interval-btn[data-interval]')]
  .pop().getBoundingClientRect(); return Math.round(innerHeight - b.bottom); })()""")
print(f'timeframy od spodního okraje: {tf} px (aspoň {DOLE})')
if tf is None or tf < DOLE:
    chyby.append('timeframy v grafu zalezly pod navigační lištu')

hlavaGrafu = ev("Math.round(document.querySelector('.chart-head').getBoundingClientRect().top)")
print(f'hlavička grafu od horního okraje: {hlavaGrafu} px (aspoň {NAHORE})')
if hlavaGrafu is None or hlavaGrafu < NAHORE:
    chyby.append('hlavička grafu zalezla pod stavovou lištu')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO ZALEZLO POD LIŠTU')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: NIC NEZALEZLO POD LIŠTY')
