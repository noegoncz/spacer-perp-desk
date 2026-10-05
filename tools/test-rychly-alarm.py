# -*- coding: utf-8 -*-
"""
Rychlý alarm podržením prstu v grafu (v0.33.0, jako v TabTraderu).

Skutečnými dotyky přes CDP:
  * podržet prst v ploše svíček, kříž posunout, pustit → u ceny se objeví
    tlačítko „Set alarm at …",
  * klepnutí na něj alarm rovnou uloží a zapne (bez okna s nastavením),
    cena odpovídá místu, kde prst skončil,
  * krátké klepnutí ani posun grafu tlačítko neukážou.

Spuštění: python tools/test-rychly-alarm.py http://localhost:8080/index.html
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


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


ev("document.querySelector('.position').click()")
time.sleep(5)
plocha = json.loads(ev("""(() => { const r = document.getElementById('chartBox').getBoundingClientRect();
  const s = window.__graf.getSize('candle_pane', 'main');
  return JSON.stringify({ x: r.left + s.left, y: r.top + s.top, w: s.width, h: s.height }); })()"""))
x = plocha['x'] + plocha['w'] * 0.5
y1 = plocha['y'] + plocha['h'] * 0.4
y2 = plocha['y'] + plocha['h'] * 0.55
pocet_pred = ev("JSON.parse(localStorage.getItem('perpdesk.alarms') || '[]').length")
viditelne = lambda: ev("!document.getElementById('quickAlarm').hidden")

print('1) krátké klepnutí')
dotyk('touchStart', x, y1); time.sleep(0.1); dotyk('touchEnd', x, y1); time.sleep(0.5)
over(not viditelne(), 'krátké klepnutí nabídku neukáže')

print('2) posun grafu')
dotyk('touchStart', x, y1)
for i in range(1, 9):
    dotyk('touchMove', x - i * 20, y1); time.sleep(0.02)
time.sleep(0.6)
dotyk('touchEnd', x - 160, y1); time.sleep(0.6)
over(not viditelne(), 'posun grafu nabídku neukáže')

print('3) podržet, posunout kříž, pustit')
dotyk('touchStart', x, y1)
time.sleep(0.8)
for i in range(1, 7):
    dotyk('touchMove', x, y1 + (y2 - y1) * i / 6); time.sleep(0.05)
time.sleep(0.2)
dotyk('touchEnd', x, y2)
time.sleep(0.6)
over(viditelne(), 'po puštění je u ceny nabídka alarmu')
text = ev("document.getElementById('quickAlarmText').textContent") or ''
print('   nabídka:', text)
ocekavana = ev("""(() => { const r = document.getElementById('chartBox').getBoundingClientRect();
  const s = window.__graf.getSize('candle_pane', 'main');
  const b = window.__graf.convertFromPixel([{ x: %f - r.left - s.left, y: %f - r.top - s.top }], { paneId: 'candle_pane' });
  return (Array.isArray(b) ? b[0] : b).value; })()""" % (x, y2))
over(text.startswith('Set alarm at'), 'text nabídky „Set alarm at …“')
poloha = json.loads(ev("""(() => { const b = document.getElementById('quickAlarm').getBoundingClientRect();
  return JSON.stringify({ stred: b.top + b.height / 2 }); })()""") or '{}')
over(abs(poloha.get('stred', 0) - y2) < 6, f"nabídka stojí u místa, kde skončil prst ({poloha.get('stred')} vs {y2:.0f})")

r = p.prikaz('Page.captureScreenshot', format='png')
cesta = os.path.join(os.environ.get('TEMP', '.'), 'rychly-alarm.png')
open(cesta, 'wb').write(base64.b64decode(r['data']))
print('   snímek:', cesta)

print('4) klepnutí na nabídku')
b = json.loads(ev("""(() => { const b = document.getElementById('quickAlarm').getBoundingClientRect();
  return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()"""))
dotyk('touchStart', b['x'], b['y']); time.sleep(0.08); dotyk('touchEnd', b['x'], b['y'])
time.sleep(0.6)
seznam = json.loads(ev("localStorage.getItem('perpdesk.alarms') || '[]'") or '[]')
novy = seznam[-1] if len(seznam) > (pocet_pred or 0) else None
print('   uložený alarm:', novy and {k: novy[k] for k in ('symbol', 'price', 'aktivni', 'smer')})
over(novy is not None, 'alarm se uložil bez okna s nastavením')
over(ev("document.getElementById('sheetAlarm').hidden"), 'okno s nastavením se neotevřelo')
if novy:
    over(novy['aktivni'] is True and novy['symbol'] == 'JUPUSDT', 'alarm je zapnutý a na správném páru')
    over(ocekavana and abs(novy['price'] - ocekavana) / ocekavana < 0.002,
         f"cena sedí s místem prstu ({novy['price']} vs {ocekavana})")
over('Alarm set' in (ev("document.getElementById('quickAlarmText').textContent") or ''), 'nabídka potvrdí „Alarm set“')
time.sleep(1.8)
over(not viditelne(), 'potvrzení samo zmizí')
over(ev("window.__graf.getOverlays().filter((o) => o.name === 'alarmLine').length") >= 1, 'čára alarmu je v grafu')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
