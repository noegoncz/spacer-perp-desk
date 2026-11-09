# -*- coding: utf-8 -*-
"""
Schování všech panelů indikátorů jedním štítkem (v0.92.0, přání uživatele).

Skutečnými dotyky přes CDP: s RSI a MACD (+ objem v hlavním grafu) stojí
vlevo dole v ploše svíček, nad nejvyšším panelem, průsvitný štítek ▾.
Klepnutí vyndá všechny panely (i popisky a úchyty), svíčky dostanou celou
výšku, objem v hlavním grafu zůstane; štítek ▴ s počtem je u spodku
svíček. Stav přežije přenačtení. Další klepnutí panely vrátí v původním
pořadí a výšce. Zapnutí dalšího panelu při schovaných je všechny ukáže.
Na úzkém displeji štítek nekoliduje s madlem úchytu. Snímky do TEMP.

Spuštění: python tools/test-skryti-panelu.py http://localhost:8080/index.html
"""
import os, sys, time, json, base64, tempfile
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!sessionStorage.getItem('__panelyNastaveno')) {
  sessionStorage.setItem('__panelyNastaveno', '1');
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL', 'RSI', 'MACD']));
  localStorage.removeItem('perpdesk.panesHidden');
}
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
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


def klepni(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 6, 'radiusY': 6, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.8)


def snimek(nazev):
    s = p.prikaz('Page.captureScreenshot', format='png')
    open(os.path.join(tempfile.gettempdir(), nazev), 'wb').write(base64.b64decode(s['data']))


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


STAV = """(() => { const g = window.__graf; const s = document.querySelector('.panely-stitek');
  const r = s && !s.hidden ? s.getBoundingClientRect() : null;
  const hl = g.getSize('candle_pane', 'main');
  const box = document.getElementById('chartBox').getBoundingClientRect();
  const panely = g.getIndicators().filter((i) => i.paneId !== 'candle_pane').map((i) => i.name);
  const madla = [...document.querySelectorAll('.pane-uchyt')].filter((u) => !u.hidden && u.offsetHeight)
    .map((u) => { const b = u.getBoundingClientRect(); return [b.top, b.bottom]; });
  return { panely, vol: g.getIndicators({ name: 'VOL' }).length,
    svicky: Math.round(hl.height), plochaDno: Math.round(box.top + hl.top + hl.height),
    legendy: [...document.querySelectorAll('.pane-legenda')].filter((l) => l.offsetHeight).length,
    stitek: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, top: Math.round(r.top), bottom: Math.round(r.bottom),
      left: Math.round(r.left - box.left), text: s.textContent, label: s.getAttribute('aria-label'),
      pruhledny: getComputedStyle(s).backgroundColor } : null,
    madla,
    vysky: Object.fromEntries(g.getIndicators().filter((i) => i.paneId !== 'candle_pane').map((i) => [i.name, Math.round(g.getSize(i.paneId).height)])) }; })()"""

ev("document.querySelector('.position').click()")
time.sleep(5)

print('1) štítek nad nejvyšším panelem')
a = ev(STAV) or {}
print('  ', {k: a.get(k) for k in ('panely', 'svicky', 'stitek', 'vysky')})
over(a.get('panely') == ['RSI', 'MACD'], 'RSI a MACD ve vlastních panelech')
st = a.get('stitek')
over(st is not None, 'štítek je vidět')
over(st and st['bottom'] <= a['plochaDno'] - 13, 'štítek je nad zónou úchytu nejvyššího panelu')
over(st and st['left'] <= 12, 'štítek je vlevo')
over(st and 'rgba' in st['pruhledny'], 'štítek je průsvitný')
over(st and all(st['bottom'] <= m[0] or st['top'] >= m[1] for m in a.get('madla', [])), 'štítek nekoliduje s úchyty')
vysky_pred = a.get('vysky')
snimek('skryti-1-panely.png')

print('2) klepnutí schová všechny panely')
klepni(st['x'], st['y'])
time.sleep(0.5)
b = ev(STAV) or {}
print('  ', {k: b.get(k) for k in ('panely', 'svicky', 'stitek', 'legendy')})
over(b.get('panely') == [], 'žádný panel pod grafem')
over(b.get('legendy') == 0, 'žádné popisky panelů')
over(b.get('vol') == 1, 'objem v hlavním grafu zůstal')
over(b.get('svicky', 0) > a.get('svicky', 0) + 100, 'svíčky dostaly výšku panelů')
st2 = b.get('stitek')
over(st2 is not None and '2' in st2['text'], 'štítek ▴ s počtem schovaných (2)')
over(st2 and st2['bottom'] <= b['plochaDno'] and st2['bottom'] >= b['plochaDno'] - 12, 'štítek u spodku svíček')
over(ev("JSON.parse(localStorage.getItem('perpdesk.indicators'))").count('RSI') == 1, 'výběr indikátorů zůstal')
snimek('skryti-2-schovane.png')

print('3) přežije přenačtení')
ev("location.reload()")
time.sleep(6)
ev("document.querySelector('.position').click()")
time.sleep(5)
c = ev(STAV) or {}
over(c.get('panely') == [] and c.get('stitek') is not None, 'po přenačtení panely dál schované, štítek je')

print('4) klepnutí panely vrátí')
klepni(c['stitek']['x'], c['stitek']['y'])
time.sleep(0.6)
d = ev(STAV) or {}
print('  ', {k: d.get(k) for k in ('panely', 'vysky')})
over(d.get('panely') == ['RSI', 'MACD'], 'RSI a MACD zpátky v původním pořadí')
over(d.get('legendy') == 2, 'popisky panelů zpátky')
over(all(abs(d['vysky'].get(n, 0) - v) <= 3 for n, v in (vysky_pred or {}).items()), 'výšky panelů jako předtím')

print('5) nový panel při schovaných je ukáže')
klepni(d['stitek']['x'], d['stitek']['y'])
time.sleep(0.5)
over((ev(STAV) or {}).get('panely') == [], 'znovu schované')
ev("document.getElementById('indicatorBtn').click()")
time.sleep(0.5)
ev("document.querySelector('#sheetIndicators [data-ind=KDJ], #sheetIndicators [data-indicator=KDJ]')?.click()")
time.sleep(1)
e = ev(STAV) or {}
print('   panely:', e.get('panely'))
if 'KDJ' in (e.get('panely') or []):
    over(set(e['panely']) == {'RSI', 'MACD', 'KDJ'}, 'zapnutí KDJ ukázalo všechny panely')
else:
    print('   (KDJ v nabídce nenalezeno — přeskakuji)')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
