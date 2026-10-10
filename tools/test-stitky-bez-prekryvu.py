# -*- coding: utf-8 -*-
"""
Štítky vpravo se nepřekrývají (v0.43.0).

Alarmy schválně těsně u SL a u vstupu: štítky v grafu i cenovky na ose
se musí rozestoupit nad / pod sebe (aspoň výška štítku od sebe), aktuální
cena (štítek knihovny s odpočtem) se nehýbe a ostatní jí uhnou. Čáry samy
zůstávají na svých cenách.

Spuštění: python tools/test-stitky-bez-prekryvu.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.alarms', JSON.stringify([
 {id:'a1', symbol:'JUPUSDT', typ:'cena', price:0.2953, smer:'any', aktivni:true, opakovat:false, platnostDnu:0},
 {id:'a2', symbol:'JUPUSDT', typ:'cena', price:0.3012, smer:'any', aktivni:false, opakovat:false, platnostDnu:0},
 {id:'a3', symbol:'JUPUSDT', typ:'cena', price:0.3001, smer:'any', aktivni:true, opakovat:false, platnostDnu:0}]));
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)


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


ev("document.querySelector('.position').click()")
time.sleep(5)
rozmisteni = ev("JSON.stringify(globalThis.__stitkyVpravo || {})")
mapa = json.loads(rozmisteni or '{}')
y = sorted(mapa.values())
print('štítků:', len(y), ' y:', [round(v) for v in y])
over(len(y) >= 6, 'v rozmístění jsou čáry pozice i alarmy')
mezery = [b - a for a, b in zip(y, y[1:])]
print('mezery:', [round(m, 1) for m in mezery])
over(all(m >= 16 for m in mezery), 'žádné dva štítky blíž než výška štítku')

cena = ev("""(() => { const g = window.__graf; const d = g.getDataList().slice(-1)[0];
  const p = g.convertToPixel({ value: d.close }, { paneId: 'candle_pane' }); return (Array.isArray(p) ? p[0] : p).y; })()""")
print('aktuální cena y:', round(cena or 0))
# Cenovka knihovny s odpočtem zabírá ~ y-8 … y+26; nic do ní nesmí zasahovat.
over(all(not (cena - 8 - 8 < v < cena + 26 + 8) for k, v in mapa.items() if k != '__cena'),
     'nic nezasahuje do cenovky aktuální ceny a odpočtu')
over(abs(mapa.get('__cena', cena + 9) - (cena + 9)) < 0.5, 'cenovka aktuální ceny se nehýbe')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
