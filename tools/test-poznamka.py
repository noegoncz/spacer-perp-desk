# -*- coding: utf-8 -*-
"""
Nástroj Poznámka (Note) v grafu — hlášeno uživatelem 2026-10-22: šlo klepnout
do grafu, ale text nešel napsat ani upravit (vestavěná poznámka knihovny brala
text z `extendData`, kde máme uložený vzhled kresby).

  * po položení poznámky se otevře okno s textem, uložený text je v grafu,
  * klepnutí na poznámku ji vybere, tužka v paletě text upraví,
  * text přežije přenačtení stránky (ukládá se s kresbou),
  * příští kresba text nezdědí.
Skutečné dotyky. Spuštění: python tools/test-poznamka.py http://localhost:8075/index.html
"""
import json, os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += "\nif (!sessionStorage.getItem('__pozn')) { sessionStorage.setItem('__pozn', '1'); localStorage.removeItem('perpdesk.drawings.JUPUSDT'); }\n"

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=420, height=860, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)
chyby = []


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def over(podminka, popis):
    print(('  ok   ' if podminka else '  !!   ') + popis)
    if not podminka:
        chyby.append(popis)


def klepni(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.5)


def klepni_prvek(sel):
    b = ev(f"""(() => {{ const e = document.querySelector({json.dumps(sel)}); if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()""")
    if b:
        klepni(b['x'], b['y'])
    return bool(b)


poznamky = lambda: ev("JSON.stringify(window.__graf.getOverlays().filter((o) => o.name === 'simpleAnnotation').map((o) => o.extendData?.text ?? null))")


def otevri_graf():
    ev("document.querySelector('.position').click()")
    time.sleep(3)


otevri_graf()
vrstva = ev("""(() => { const r = document.getElementById('drawLayer').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()""")

print('1) položení poznámky')
ev("document.querySelector('.tool-btn[data-tool=simpleAnnotation]').click()")
time.sleep(0.5)
klepni(vrstva['x'], vrstva['y'])   # potvrdit bod pod křížem
over(not ev("document.getElementById('sheetNote').hidden"), 'po položení se otevře okno s textem')
over(ev("document.activeElement && document.activeElement.id") == 'noteText', 'kurzor je v poli s textem')
p.prikaz('Input.insertText', text='Support retest')
klepni_prvek('#noteSaveBtn')
over(ev("document.getElementById('sheetNote').hidden"), 'Uložit okno zavře')
over(json.loads(poznamky() or '[]') == ['Support retest'], f'text je v poznámce ({poznamky()})')

print('2) úprava textu')
klepni(vrstva['x'] + 120, vrstva['y'] + 150)   # klepnutí jinam zruší výběr
klepni(vrstva['x'], vrstva['y'] - 50)           # na štítek poznámky
over(not ev("document.getElementById('stylePanel').hidden"), 'klepnutí na poznámku ji vybere (paleta)')
over(ev("(() => { const r = document.getElementById('styleNoteBtn').getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; })()"), 'v paletě je tužka pro text, vidět bez posouvání')
klepni_prvek('#styleNoteBtn')
over(ev("document.getElementById('noteText').value") == 'Support retest', 'okno ukáže dosavadní text')
ev("document.getElementById('noteText').select()")
p.prikaz('Input.insertText', text='Breakout level')
klepni_prvek('#noteSaveBtn')
over(json.loads(poznamky() or '[]') == ['Breakout level'], f'text upravený ({poznamky()})')
ulozene = ev("localStorage.getItem('perpdesk.drawings.JUPUSDT') || ''")
over('Breakout level' in ulozene, 'text je uložený s kresbou')

print('3) po přenačtení')
p.prikaz('Page.reload')
time.sleep(7)
otevri_graf()
over(json.loads(poznamky() or '[]') == ['Breakout level'], f'text přežije přenačtení ({poznamky()})')
over('text' not in (ev("localStorage.getItem('perpdesk.drawStyle') || ''") or ''), 'vzhled příští kresby text nenese')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
