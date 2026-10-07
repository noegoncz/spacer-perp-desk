# -*- coding: utf-8 -*-
"""
Výška panelu indikátoru tažením hranice (v0.34.0).

Skutečnými dotyky přes CDP: na hranici mezi grafem a RSI je úchyt;
tažení nahoru panel RSI zvětší, dolů zmenší. Nová výška se uloží do
nastavení indikátoru jako procento plochy a přežije přenačtení.
Svíčkám vždy zůstane aspoň 45 % plochy.

Spuštění: python tools/test-vyska-panelu-tazenim.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!sessionStorage.getItem('__rsiNastaveno')) {
  sessionStorage.setItem('__rsiNastaveno', '1');
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['RSI']));
  localStorage.removeItem('perpdesk.ind.RSI');
}
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def dotyk(typ, x, y):
    body = [] if typ == 'touchEnd' else [{'x': x, 'y': y, 'radiusX': 10, 'radiusY': 10, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type=typ, touchPoints=body)


def tahni(dy):
    u = json.loads(ev("""(() => { const b = document.querySelector('.pane-uchyt').getBoundingClientRect();
      return JSON.stringify({ x: b.left + b.width * 0.3, y: b.top + b.height / 2 }); })()"""))
    dotyk('touchStart', u['x'], u['y'])
    for i in range(1, 11):
        dotyk('touchMove', u['x'], u['y'] + dy * i / 10); time.sleep(0.02)
    dotyk('touchEnd', u['x'], u['y'] + dy)
    time.sleep(0.6)


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


RSI = """(() => { const g = window.__graf; const i = g.getIndicators({ name: 'RSI' })[0];
  const s = i && g.getSize(i.paneId); const u = document.querySelector('.pane-uchyt');
  const ub = u && u.getBoundingClientRect(); const box = document.getElementById('chartBox').getBoundingClientRect();
  return JSON.stringify({ vyska: s ? Math.round(s.height) : null, top: s ? Math.round(s.top) : null,
    uchyt: ub ? Math.round(ub.top + ub.height / 2 - box.top) : null,
    ulozeno: JSON.parse(localStorage.getItem('perpdesk.ind.RSI') || '{}').vyskaPanelu ?? null,
    plocha: document.getElementById('chartBox').clientHeight }); })()"""

ev("document.querySelector('.position').click()")
time.sleep(5)
a = json.loads(ev(RSI))
print('na začátku:', a)
over(a['vyska'] is not None, 'RSI má vlastní panel')
over(a['uchyt'] is not None and abs(a['uchyt'] - a['top']) <= 2, 'úchyt sedí na hranici panelu RSI')

tahni(-120)
b = json.loads(ev(RSI))
print('po tažení nahoru o 120 px:', b)
over(abs((b['vyska'] - a['vyska']) - 120) <= 3, f"panel RSI je o 120 px vyšší ({a['vyska']} → {b['vyska']})")
over(b['ulozeno'] is not None and abs(b['ulozeno'] - round(b['vyska'] / b['plocha'] * 100)) <= 1,
     f"výška se uložila v procentech ({b['ulozeno']} %)")
over(abs(b['uchyt'] - b['top']) <= 2, 'úchyt se posunul s hranicí')

tahni(2000)
c = json.loads(ev(RSI))
print('po tažení daleko dolů:', c)
over(c['vyska'] >= 40, f"panel nejde zmenšit pod 40 px ({c['vyska']})")
tahni(-3000)
d = json.loads(ev(RSI))
print('po tažení daleko nahoru:', d)
over(d['vyska'] <= d['plocha'] * 0.55 + 2, f"svíčkám zůstane aspoň 45 % plochy ({d['vyska']} z {d['plocha']})")

tahni(150)
e = json.loads(ev(RSI))
print('nakonec:', e)
p.prikaz('Page.reload')
time.sleep(6)
ev("document.querySelector('.position').click()")
time.sleep(5)
f = json.loads(ev(RSI))
print('po přenačtení:', f)
over(abs(f['vyska'] - e['vyska']) <= 4, f"výška přežila přenačtení ({e['vyska']} → {f['vyska']})")

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
