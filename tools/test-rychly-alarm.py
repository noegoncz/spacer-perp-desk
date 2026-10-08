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
viditelne = lambda: ev("!document.getElementById('quickMenu').hidden")

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
# Během podržení: štítek s procenty od aktuální ceny u ceny kříže.
stitek = json.loads(ev("""(() => { const e = document.querySelector('.krizek-procenta');
  if (!e || e.hidden) return '{}';
  const b = e.getBoundingClientRect(); const box = document.getElementById('chartBox').getBoundingClientRect();
  const s = window.__graf.getSize('candle_pane', 'main');
  return JSON.stringify({ text: e.textContent, stred: b.top + b.height / 2, prave: b.right,
    osa: box.left + s.left + s.width }); })()""") or '{}')
posledni = ev("window.__graf.getDataList().slice(-1)[0].close")
print('   štítek během podržení:', stitek)
over(bool(stitek.get('text')), 'během podržení je u kříže štítek s procenty')
if stitek.get('text'):
    cena_prstu = ev("""(() => { const r = document.getElementById('chartBox').getBoundingClientRect();
      const s = window.__graf.getSize('candle_pane', 'main');
      const b = window.__graf.convertFromPixel([{ x: %f - r.left - s.left, y: %f - r.top - s.top }], { paneId: 'candle_pane' });
      return (Array.isArray(b) ? b[0] : b).value; })()""" % (x, y2))
    pct = (cena_prstu / posledni - 1) * 100
    ocek = f"{'+' if pct >= 0 else '−'}{abs(pct):.2f} %"
    over(stitek['text'] == ocek, f"procenta od aktuální ceny ({stitek['text']} vs {ocek})")
    over(abs(stitek['stred'] - y2) < 4 and stitek['prave'] <= stitek['osa'] + 1,
         'štítek stojí u ceny kříže vlevo od cenové osy')
dotyk('touchEnd', x, y2)
time.sleep(0.6)
over(ev("document.querySelector('.krizek-procenta').hidden"), 'po puštění štítek s procenty zmizí')
over(viditelne(), 'po puštění je u ceny nabídka alarmu')
text = ev("document.getElementById('quickMenuPrice').textContent") or ''
volby = ev("[...document.querySelectorAll('#quickMenu .quick-btn span')].map((s) => s.textContent)")
print('   nabídka:', text, volby)
ocekavana = ev("""(() => { const r = document.getElementById('chartBox').getBoundingClientRect();
  const s = window.__graf.getSize('candle_pane', 'main');
  const b = window.__graf.convertFromPixel([{ x: %f - r.left - s.left, y: %f - r.top - s.top }], { paneId: 'candle_pane' });
  return (Array.isArray(b) ? b[0] : b).value; })()""" % (x, y2))
over(volby == ['Set alarm', 'Horizontal line'], f'nabídka: alarm a vodorovná čára ({volby})')
over('%' in text, f'nabídka ukazuje cenu a procenta ({text})')
poloha = json.loads(ev("""(() => { const b = document.getElementById('quickMenu').getBoundingClientRect();
  return JSON.stringify({ l: b.left, r: b.right, t: b.top, b: b.bottom }); })()""") or '{}')
over(poloha['l'] - 2 <= x <= poloha['r'] + 2 and (0 < y2 - poloha['b'] < 60 or 0 < poloha['t'] - y2 < 60),
     f"nabídka stojí v místě, kde skončil prst ({poloha} vs {x:.0f},{y2:.0f})")

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

print('5) vodorovná čára z nabídky')
y3 = plocha['y'] + plocha['h'] * 0.3
dotyk('touchStart', x, y3); time.sleep(0.8)
dotyk('touchMove', x, y3 + 5); time.sleep(0.1)
dotyk('touchEnd', x, y3 + 5); time.sleep(0.6)
over(viditelne(), 'nabídka se ukáže znovu')
kresby_pred = ev("window.__graf.getOverlays({ groupId: 'kresby' }).length")
b = json.loads(ev("""(() => { const b = document.getElementById('quickLine').getBoundingClientRect();
  return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()"""))
dotyk('touchStart', b['x'], b['y']); time.sleep(0.08); dotyk('touchEnd', b['x'], b['y'])
time.sleep(0.8)
cary = json.loads(ev("""JSON.stringify(window.__graf.getOverlays({ groupId: 'kresby' })
  .filter((o) => o.name === 'horizontalStraightLine').map((o) => o.points[0].value))""") or '[]')
print('   vodorovné čáry:', cary)
over(ev("window.__graf.getOverlays({ groupId: 'kresby' }).length") == kresby_pred + 1, 'přibyla vodorovná čára')
ulozene = json.loads(ev("localStorage.getItem('perpdesk.drawings.JUPUSDT') || '[]'") or '[]')
over(any(k.get('name') == 'horizontalStraightLine' for k in ulozene), 'čára se uložila mezi kresby páru')
over('Line added' in (ev("document.getElementById('quickLineText').textContent") or ''), 'nabídka potvrdí „Line added“')
over(ev("JSON.parse(localStorage.getItem('perpdesk.alarms') || '[]').length") == len(seznam), 'čára nevytvořila alarm')


konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
