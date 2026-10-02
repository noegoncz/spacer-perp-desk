# -*- coding: utf-8 -*-
"""
Lišta nové verze a „Co je nového" (v0.27.0).

Skutečný čekající service worker se v testu vyrobit nedá, proto se lišta
zobrazí přímo a obsah se vykreslí funkcemi z js/ui.js nad skutečným
novinky.json. Ověřuje se:

  * novinky.json jde načíst a má verzi, novinky a opravy v en i cs,
  * titulek nese číslo verze, „Co je nového" rozbalí seznam a zase sbalí,
  * novinky stojí nad opravami, česky i anglicky,
  * na úzkém displeji Foldu se lišta vejde na jeden řádek (tlačítko vpravo).

Spuštění: python tools/test-nova-verze.py http://localhost:8075/index.html
"""
import os, sys, time, json, base64
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(4)

n = json.loads(ev("fetch('novinky.json?t=' + Date.now()).then(r => r.text())", True) or '{}')
over(n.get('verze') and n.get('novinky') and n.get('opravy'), f'novinky.json: verze {n.get("verze")}, novinky i opravy')
over(all(x.get('en') and x.get('cs') for x in n.get('novinky', []) + n.get('opravy', [])), 'každá položka anglicky i česky')

def ukaz(jazyk):
    return ev(f"""(async () => {{
      const ui = await import('./js/ui.js');
      const n = await (await fetch('novinky.json?t=' + Date.now())).json();
      ui.showUpdateBar(true);
      ui.renderUpdateNotes(n, '{jazyk}');
      return true; }})()""", True)

print('1) lišta a rozbalení')
ukaz('en')
time.sleep(0.3)
over(n.get('verze', '') in (ev("document.getElementById('updateTitle').textContent") or ''), 'titulek s číslem verze')
over(ev("document.getElementById('updateNotes').hidden"), 'seznam je zpočátku sbalený')
ev("document.getElementById('updateInfo').click()")
time.sleep(0.2)
over(not ev("document.getElementById('updateNotes').hidden")
     and ev("document.getElementById('updateInfo').getAttribute('aria-expanded')") == 'true', 'klepnutí rozbalí Co je nového')
poradi = ev("[...document.querySelectorAll('#updateNotes > div')].map(d => d.className).join(',')")
over(poradi == 'novinky,opravy', f'novinky nad opravami ({poradi})')
over(n['novinky'][0]['en'] in (ev("document.getElementById('updateNotes').textContent") or ''), 'anglický text novinky')
radek = json.loads(ev("""(() => { const a = document.getElementById('updateInfo').getBoundingClientRect();
  const b = document.getElementById('updateBtn').getBoundingClientRect();
  return JSON.stringify({ stejnyRadek: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 12, vpravo: innerWidth - b.right }); })()""") or '{}')
over(radek.get('stejnyRadek') and radek.get('vpravo', 99) < 20, f'na 344 px: Co je nového vlevo, Aktualizovat vpravo ({radek})')
os.makedirs(os.path.join(KOREN, 'tools', 'snimky'), exist_ok=True)
d = p.prikaz('Page.captureScreenshot', format='png', clip={'x': 0, 'y': 0, 'width': 344, 'height': 300, 'scale': 1})['data']
open(os.path.join(os.environ.get('TEMP', '.'), 'nova-verze.png'), 'wb').write(base64.b64decode(d))
ev("document.getElementById('updateInfo').click()")
time.sleep(0.2)
over(ev("document.getElementById('updateNotes').hidden"), 'druhé klepnutí sbalí')

print('2) česky')
ukaz('cs')
time.sleep(0.2)
over(n['novinky'][0]['cs'] in (ev("document.getElementById('updateNotes').textContent") or ''), 'český text novinky')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
