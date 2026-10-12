# -*- coding: utf-8 -*-
"""
Systémové tlačítko zpět v APK (v0.51.0).

Podstrčený plugin App Capacitoru zachytí posluchače `backButton`; test ho
„mačká" a hlídá, že se aplikace vrací o krok: nabídka → kreslení → graf →
nastavení → Watchlists / Historie → Pozice, a teprve na Pozicích se
minimalizuje (nezavře). Na starém kódu padá — posluchač vůbec nebyl.

Spuštění: python tools/test-tlacitko-zpet.py http://localhost:8075/index.html
"""
import os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
window.__minimalizace = 0;
window.Capacitor = Object.assign(window.Capacitor || {}, {
  isNativePlatform: () => true,
  Plugins: Object.assign((window.Capacitor && window.Capacitor.Plugins) || {}, {
    App: {
      addListener: (udalost, fn) => { if (udalost === 'backButton') window.__zpet = fn; return Promise.resolve({ remove() {} }); },
      minimizeApp: () => { window.__minimalizace += 1; return Promise.resolve(); },
      exitApp: () => { window.__ukonceno = true; },
    },
  }),
});
"""

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


def zpet():
    ev("window.__zpet && window.__zpet({ canGoBack: true })")
    time.sleep(0.8)


zalozka = lambda: ev("document.querySelector('.tab.active')?.dataset.tab")
graf = lambda: ev("!document.getElementById('viewChart').hidden")

over(ev("typeof window.__zpet") == 'function', 'aplikace poslouchá systémové tlačítko zpět')

print('1) Pozice: zpět aplikaci jen minimalizuje')
zpet()
over(ev("window.__minimalizace") == 1 and not ev("window.__ukonceno"), 'na Pozicích se aplikace minimalizuje, nezavře')

print('2) Watchlists → Pozice')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(1)
zpet()
over(zalozka() == 'positions', f'z Watchlists zpět na Pozice ({zalozka()})')

print('3) graf pozice: nabídka → kreslení → graf')
ev("document.querySelector('.position').click()")
time.sleep(3)
ev("document.getElementById('layersBtn').click()")
time.sleep(0.5)
zpet()
over(graf() and ev("document.getElementById('sheetLayers').hidden"), 'zpět zavře nabídku, graf zůstane')
ev("document.querySelector('.tool-btn[data-tool=mereni]').click()")
time.sleep(0.5)
zpet()
over(graf() and not ev("!!document.querySelector('#drawToolbar .tool-btn.active')"), 'zpět zruší kreslení, graf zůstane')
zpet()
over(not graf() and zalozka() == 'positions', 'další zpět zavře graf')
over(ev("window.__minimalizace") == 1, 'při tom se aplikace neminimalizovala')

print('4) Historie: prohlídka obchodu → Historie → Pozice')
ev("document.querySelector('.tab[data-tab=history]').click()")
time.sleep(3)
ev("[...document.querySelectorAll('.trade')].find((k) => !k.classList.contains('otevreny'))?.click()")
time.sleep(4)
over(graf(), 'prohlídka obchodu je otevřená')
zpet()
over(not graf() and zalozka() == 'history', f'zpět z prohlídky vede do Historie ({zalozka()})')
zpet()
over(zalozka() == 'positions', 'z Historie zpět na Pozice')

print('5) Nastavení → Pozice')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
zpet()
over(ev("document.getElementById('viewSettings').hidden") and zalozka() == 'positions', 'zpět zavře nastavení')
zpet()
over(ev("window.__minimalizace") == 2, 'až na Pozicích se znovu minimalizuje')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
