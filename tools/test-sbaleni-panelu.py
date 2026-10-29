# -*- coding: utf-8 -*-
"""
Minimalizace panelu indikátoru popiskem vlevo (v0.88.0, sloupec v0.88.1).

Skutečnými dotyky přes CDP: RSI a MACD ve vlastních panelech mají vlevo
sloupec přes celou výšku panelu, u všech stejně široký, s podkladem
(šipka, krátký název, parametry, hodnoty). Při tažení úchytu jede popisek
s panelem, madlo úchytu je uprostřed. Klepnutí panel
stáhne na proužek (svíčky dostanou místo), stav se uloží a přežije
přenačtení; další klepnutí panel vrátí na původní výšku. Úchyt výšky
je u sbaleného panelu schovaný. Snímky do TEMP (sbaleni-*.png).

Spuštění: python tools/test-sbaleni-panelu.py http://localhost:8080/index.html
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
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['RSI', 'MACD']));
  localStorage.removeItem('perpdesk.ind.RSI');
  localStorage.removeItem('perpdesk.ind.MACD');
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


def klepni(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 8, 'radiusY': 8, 'force': 1, 'id': 1}]
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


STAV = """(() => { const g = window.__graf; const box = document.getElementById('chartBox').getBoundingClientRect();
  const panel = (n) => { const i = g.getIndicators({ name: n })[0]; const s = i && g.getSize(i.paneId);
    const l = i && document.querySelector(`.pane-legenda[data-pane="${i.paneId}"]`); const lb = l && l.getBoundingClientRect();
    const u = i && document.querySelector(`.pane-uchyt[data-pane="${i.paneId}"]`);
    const m = u && u.querySelector('.pane-madlo').getBoundingClientRect();
    return { vyska: s ? Math.round(s.height) : null, top: s ? Math.round(s.top) : null, viditelny: i ? i.visible : null,
      legenda: lb ? { x: Math.round(lb.left - box.left), y: Math.round(lb.top - box.top), w: Math.round(lb.width),
        h: Math.round(lb.height), cx: lb.left + lb.width / 2, cy: lb.top + lb.height / 2,
        text: l.textContent, sbaleno: l.classList.contains('sbaleno'),
        nazev: l.querySelector('.pl-nazev').textContent,
        viditelnyText: [...l.querySelectorAll('.pl-param, .pl-hodnoty')].some((x) => x.offsetHeight > 0),
        pozadi: getComputedStyle(l).backgroundImage } : null,
      uchyt: u ? !u.hidden : null,
      madlo: m && m.width ? Math.round(m.left + m.width / 2 - box.left) : null,
      sipky: (() => { const s = document.querySelector(`.pane-poradi[data-pane="${i.paneId}"]`);
        if (!s || s.hidden) return null; const r = s.getBoundingClientRect();
        return { x: Math.round(r.left - box.left), y: Math.round(r.top - box.top),
          nahoru: !s.firstChild.hidden, dolu: !s.lastChild.hidden,
          dx: s.lastChild.getBoundingClientRect().left + 13, dy: r.top + 10 }; })(),
      ulozeno: JSON.parse(localStorage.getItem('perpdesk.ind.' + n) || '{}').sbaleno ?? null }; };
  return JSON.stringify({ RSI: panel('RSI'), MACD: panel('MACD'),
    svicky: Math.round(g.getSize('candle_pane', 'main').height), sirka: Math.round(box.width),
    kresba: Math.round(document.getElementById('drawLayer').getBoundingClientRect().height) }); })()"""


def stav():
    return json.loads(ev(STAV))


ev("document.querySelector('.position').click()")
time.sleep(5)

print('1) popisky panelů')
a = stav()
for n in ('RSI', 'MACD'):
    l = a[n]['legenda']
    over(l is not None, f'{n}: popisek existuje')
    if not l:
        continue
    over(abs(l['y'] - a[n]['top']) <= 2 and l['x'] <= 2, f'{n}: sloupec vlevo nahoře v panelu ({l["x"]}, {l["y"]} vs top {a[n]["top"]})')
    over(abs(l['h'] - a[n]['vyska']) <= 2, f'{n}: přes celou výšku panelu ({l["h"]} vs {a[n]["vyska"]} px)')
    over(abs(a[n]['madlo'] - a['sirka'] / 2) <= 3, f'{n}: madlo úchytu uprostřed ({a[n]["madlo"]} vs {a["sirka"] / 2})')
    over('linear-gradient' in (l['pozadi'] or '') and 'rgba(0, 0, 0, 0)' in l['pozadi'], f'{n}: podklad vpravo do ztracena ({l["pozadi"]})')
    over(not l['sbaleno'] and a[n]['uchyt'], f'{n}: rozbalený, úchyt výšky vidět')
over(a['RSI']['legenda']['w'] == a['MACD']['legenda']['w'] and 90 <= a['RSI']['legenda']['w'] <= 100,
     f'oba sloupce stejně široké ({a["RSI"]["legenda"]["w"]}, {a["MACD"]["legenda"]["w"]})')
over('14' in a['RSI']['legenda']['text'] and any(ch.isdigit() for ch in a['RSI']['legenda']['text'].split('Close')[-1]),
     f'RSI: název i hodnota ({a["RSI"]["legenda"]["text"]!r})')
over('DIF' in a['MACD']['legenda']['text'] and 'MACD -' in a['MACD']['legenda']['text'] or 'MACD 0' in a['MACD']['legenda']['text'], f'MACD: hodnoty čar ({a["MACD"]["legenda"]["text"]!r})')
# v0.88.2: šipky pořadí vedle sloupce, první panel nemá ▲, poslední ▼.
s1, s2 = a['RSI']['sipky'], a['MACD']['sipky']
over(s1 and s2 and abs(s1['x'] - a['RSI']['legenda']['w']) <= 4 and abs(s1['y'] - a['RSI']['top']) <= 3,
     f'šipky pořadí vedle popisku nahoře ({s1})')
over(s1 and s2 and not s1['nahoru'] and s1['dolu'] and s2['nahoru'] and not s2['dolu'], 'RSI jen ▼, MACD jen ▲')
legenda_knihovny = ev("window.__graf.getStyles().indicator.tooltip.showRule")
over(legenda_knihovny == 'none', 'legenda knihovny v plátně vypnutá (nekreslí se dvakrát)')
snimek('sbaleni-1-rozbaleno.png')

print('1b) při tažení úchytu jede popisek s panelem')
def dotyk(typ, x, y):
    body = [] if typ == 'touchEnd' else [{'x': x, 'y': y, 'radiusX': 10, 'radiusY': 10, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type=typ, touchPoints=body)
U = json.loads(ev("""(() => { const i = window.__graf.getIndicators({ name: 'MACD' })[0];
  const b = document.querySelector(`.pane-uchyt[data-pane="${i.paneId}"] .pane-madlo`).getBoundingClientRect();
  return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()"""))
dotyk('touchStart', U['x'], U['y'])
for k in range(1, 9):
    dotyk('touchMove', U['x'], U['y'] - 60 * k / 8); time.sleep(0.03)
time.sleep(0.2)
t = stav()
for n in ('RSI', 'MACD'):
    over(abs(t[n]['legenda']['y'] - t[n]['top']) <= 2, f'{n} během tažení: popisek u panelu ({t[n]["legenda"]["y"]} vs {t[n]["top"]})')
over(abs(t['MACD']['legenda']['h'] - t['MACD']['vyska']) <= 2, f'MACD během tažení: výška sloupce ({t["MACD"]["legenda"]["h"]} vs {t["MACD"]["vyska"]})')
dotyk('touchEnd', U['x'], U['y'] - 60)
time.sleep(0.8)
a = stav()

print('2) klepnutí na popisek RSI ho minimalizuje')
klepni(a['RSI']['legenda']['cx'], a['RSI']['legenda']['cy'])
b = stav()
over(b['RSI']['vyska'] <= 24, f'RSI stažené na proužek ({a["RSI"]["vyska"]} → {b["RSI"]["vyska"]} px)')
over(b['RSI']['viditelny'] is False, 'RSI se nekreslí')
over(b['RSI']['legenda']['sbaleno'], 'šipka nahoru (třída sbaleno)')
over(not b['RSI']['uchyt'], 'úchyt sbaleného panelu schovaný')
over(b['RSI']['ulozeno'] is True, 'stav uložený v nastavení')
over(b['svicky'] > a['svicky'] + 40, f'svíčky dostaly místo ({a["svicky"]} → {b["svicky"]} px)')
over(abs(b['kresba'] - b['svicky']) <= 2, f'kreslicí vrstva sedí na svíčkách ({b["kresba"]} vs {b["svicky"]})')
over(b['MACD']['vyska'] == a['MACD']['vyska'], f'MACD beze změny ({b["MACD"]["vyska"]} px)')
over(b['RSI']['legenda']['h'] <= b['RSI']['vyska'] + 1, 'popisek se vejde do proužku')
over(b['RSI']['legenda']['nazev'] == 'RSI' and not b['RSI']['legenda']['viditelnyText'], 'sbalený: jen krátký název „RSI"')
snimek('sbaleni-2-rsi-sbalene.png')

print('3) i MACD — oba sbalené')
klepni(b['MACD']['legenda']['cx'], b['MACD']['legenda']['cy'])
c = stav()
over(c['MACD']['vyska'] <= 24 and c['RSI']['vyska'] <= 24, f'oba proužky ({c["RSI"]["vyska"]}, {c["MACD"]["vyska"]})')
snimek('sbaleni-3-oba.png')

print('4) přežije přenačtení')
p.prikaz('Page.reload')
time.sleep(6)
ev("document.querySelector('.position').click()")
time.sleep(5)
d = stav()
over(d['RSI']['vyska'] <= 24 and d['MACD']['vyska'] <= 24 and d['RSI']['legenda']['sbaleno'],
     f'po přenačtení sbalené ({d["RSI"]["vyska"]}, {d["MACD"]["vyska"]})')

print('5) rozbalení vrátí výšku')
klepni(d['RSI']['legenda']['cx'], d['RSI']['legenda']['cy'])
e = stav()
over(abs(e['RSI']['vyska'] - a['RSI']['vyska']) <= 3, f'RSI zpět na {e["RSI"]["vyska"]} px (původně {a["RSI"]["vyska"]})')
over(e['RSI']['viditelny'] is True and e['RSI']['uchyt'] and not e['RSI']['legenda']['sbaleno'], 'RSI se kreslí, úchyt vidět, šipka dolů')
over(e['RSI']['ulozeno'] is False, 'uloženo rozbalené')

print('5b) šipka ▼ u RSI prohodí panely, pořadí přežije přenačtení')
klepni(e['RSI']['sipky']['dx'], e['RSI']['sipky']['dy'])
time.sleep(0.5)
g5 = stav()
over(g5['RSI']['top'] > g5['MACD']['top'], f'RSI pod MACD ({g5["RSI"]["top"]} vs {g5["MACD"]["top"]})')
over(abs(g5['RSI']['vyska'] - e['RSI']['vyska']) <= 3, f'výška RSI zůstala ({g5["RSI"]["vyska"]})')
over(abs(g5['RSI']['legenda']['y'] - g5['RSI']['top']) <= 2, 'popisek RSI se přesunul s panelem')
over(g5['RSI']['sipky'] and g5['RSI']['sipky']['nahoru'] and not g5['RSI']['sipky']['dolu'], 'RSI teď jen ▲')
poradi = ev("localStorage.getItem('perpdesk.indicators')")
over(poradi == '["MACD","RSI"]', f'pořadí uložené ({poradi})')
p.prikaz('Page.reload')
time.sleep(6)
ev("document.querySelector('.position').click()")
time.sleep(5)
h5 = stav()
over(h5['RSI']['top'] > h5['MACD']['top'], f'po přenačtení RSI dál pod MACD ({h5["RSI"]["top"]} vs {h5["MACD"]["top"]})')
snimek('sbaleni-5-poradi.png')

print('6) zavřený displej 344 px')
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=2, mobile=True)
time.sleep(1.5)
f = stav()
over(f['RSI']['legenda'] and 70 <= f['RSI']['legenda']['w'] <= 80, f'užší sloupec na 344 px ({f["RSI"]["legenda"] and f["RSI"]["legenda"]["w"]} px)')
over(abs(f['RSI']['madlo'] - f['sirka'] / 2) <= 3, f'344 px: madlo uprostřed ({f["RSI"]["madlo"]} vs {f["sirka"] / 2})')
for n in ('RSI', 'MACD'):
    if f[n]['legenda'] and f[n]['vyska'] > 30:
        over(abs(f[n]['legenda']['y'] - f[n]['top']) <= 2, f'344 px: popisek {n} u panelu po změně rozměrů ({f[n]["legenda"]["y"]} vs {f[n]["top"]})')
snimek('sbaleni-4-344.png')

print('7) rozbalený panel nejde stáhnout pod výšku popisku')
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
time.sleep(1.5)
ev("localStorage.setItem('__x','1')")
for n in ('MACD',):
    i7 = stav()
    if i7[n]['legenda']['sbaleno']:
        klepni(i7[n]['legenda']['cx'], i7[n]['legenda']['cy'])
U = json.loads(ev("""(() => { const i = window.__graf.getIndicators({ name: 'RSI' })[0];
  const b = document.querySelector(`.pane-uchyt[data-pane="${i.paneId}"] .pane-madlo`).getBoundingClientRect();
  return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()"""))
dotyk('touchStart', U['x'], U['y'])
for k in range(1, 13):
    dotyk('touchMove', U['x'], U['y'] + 400 * k / 12); time.sleep(0.03)
dotyk('touchEnd', U['x'], U['y'] + 400)
time.sleep(0.8)
g7 = stav()
potreba = ev("""(() => { const i = window.__graf.getIndicators({ name: 'RSI' })[0];
  const l = document.querySelector(`.pane-legenda[data-pane="${i.paneId}"]`);
  const c = [...l.children].reverse().find((x) => x.offsetHeight > 0); return c.offsetTop + c.offsetHeight; })()""")
over(g7['RSI']['vyska'] >= potreba, f'RSI stažené na {g7["RSI"]["vyska"]} px, popisek potřebuje {potreba} px')
over(abs(g7['RSI']['legenda']['y'] - g7['RSI']['top']) <= 2, 'popisek RSI u panelu po tažení')

chyby_app = ev('JSON.stringify(window.__chyby || [])')
over(chyby_app in ('[]', None), f'bez chyb v aplikaci ({chyby_app})')

print()
print('VÝSLEDEK:', 'OK' if not chyby else f'{len(chyby)} chyb')
sys.exit(1 if chyby else 0)
