# -*- coding: utf-8 -*-
"""
Záložka Alarmy (v0.63.0, přání uživatele 2026-10-20 — jako alerty
v TabTraderu): všechny alarmy napříč páry, Aktivní / Neaktivní,
zapnout / vypnout, smazat na dvě klepnutí, smazat všechny neaktivní,
klepnutí otevře graf. Skutečné dotyky (přejíždění), rozměry Foldu.

Spuštění: python tools/test-zalozka-alarmy.py http://localhost:8080/index.html
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
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=880, deviceScaleFactor=2, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)

chyby = []


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('!!', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def over(podminka, text):
    print(('  ok   ' if podminka else '  CHYBA ') + text)
    if not podminka:
        chyby.append(text)


def snimek(nazev):
    d = p.prikaz('Page.captureScreenshot', format='png')['data']
    cesta = os.path.join(os.environ.get('TEMP', '.'), nazev)
    open(cesta, 'wb').write(base64.b64decode(d))
    print('  snímek:', cesta)


def klepni(selektor):
    """Skutečné klepnutí prstem doprostřed prvku (syntetický click by po
    přejetí sežral příznak „po přejetí potlač klepnutí")."""
    b = json.loads(ev(f"""JSON.stringify((() => {{ const r = document.querySelector({json.dumps(selektor)}).getBoundingClientRect();
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})())"""))
    bod = [{'x': b['x'], 'y': b['y'], 'radiusX': 5, 'radiusY': 5, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.4)


def radky():
    return json.loads(ev("""JSON.stringify([...document.querySelectorAll('#alertsList .alert-row')].map((r) => ({
      id: r.dataset.id, text: r.textContent, vypnuty: r.classList.contains('vypnuty') })))""") or '[]')


# Tři aktivní (blízko, daleko, čas) a dva neaktivní (jeden zazněl).
ev("""import('./js/alarmy.js').then((m) => {
  const ted = Date.now();
  m.uloz({ ...m.novy('JUPUSDT', 0.5), aktivni: true, id: 'daleko' });
  m.uloz({ ...m.novy('JUPUSDT', 0.31), aktivni: true, id: 'blizko', zprava: 'Breakout' });
  m.uloz({ ...m.novy('JUPUSDT', 0), typ: 'cas', cas: ted + 3600e3, aktivni: true, id: 'cas' });
  m.uloz({ ...m.novy('JUPUSDT', 0.28), aktivni: false, id: 'stary', spusteno: ted - 2 * 3600e3 });
  m.uloz({ ...m.novy('JUPUSDT', 0.27), aktivni: false, id: 'vypnuty' });
  return true; })""")

# ---- záložky se vejdou na zavřený Fold ----
zalozky = json.loads(ev("""JSON.stringify((() => { const n = document.querySelector('.tabs');
  return { preteka: n.scrollWidth > n.clientWidth + 1, sirka: n.clientWidth,
    orezane: [...n.querySelectorAll('.tab')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
    vyska: n.getBoundingClientRect().height }; })())"""))
print('záložky na 344 px:', zalozky)
over(not zalozky['preteka'] and not zalozky['orezane'], 'čtyři záložky se vejdou na 344 px bez oříznutí')
over(zalozky['vyska'] < 50, 'lišta záložek zůstala jednořádková')

# ---- přejetí z Historie → Alarmy (Aktivní) ----
klepni("[data-tab=history]")
time.sleep(1.5)
p.prejed(300, 500, 60, 505)
time.sleep(1)
over(ev("!document.getElementById('viewAlerts').hidden"), 'přejetí z Historie otevře Alarmy')
r = radky()
print('aktivní:', [x['id'] for x in r])
over([x['id'] for x in r] == ['blizko', 'daleko', 'cas'],
     'aktivní seřazené podle vzdálenosti od ceny (nejbližší nahoře)')
over(any('Breakout' in x['text'] for x in r), 'u alarmu je vidět jeho zpráva')
over(any('from price' in x['text'] for x in r), 'u aktivního alarmu je vzdálenost od ceny')
pocty = ev("[...document.querySelectorAll('#alertsTabs .list-tab')].map((b) => b.textContent).join(' | ')")
print('podzáložky:', pocty)
over(pocty and '3' in pocty and '2' in pocty, 'podzáložky ukazují počty (3 aktivní, 2 neaktivní)')
over(ev("document.getElementById('alertsClear').hidden"), 'v Aktivních není „smazat všechny"')
snimek('perpyx-alarmy-aktivni.png')

# ---- vypnout přepínačem → přejde do Neaktivních ----
klepni(".alert-row[data-id=daleko] .nastaveni-prepinac")
time.sleep(0.5)
over([x['id'] for x in radky()] == ['blizko', 'cas'], 'vypnutý alarm zmizí z Aktivních')

# ---- přejetí doleva → Neaktivní ----
p.prejed(300, 500, 60, 505)
time.sleep(1)
r = radky()
print('neaktivní:', [x['id'] for x in r])
over(ev("!document.getElementById('viewAlerts').hidden") and set(x['id'] for x in r) == {'daleko', 'stary', 'vypnuty'},
     'přejetí v Alarmech přepne na Neaktivní (ne na jinou záložku)')
over(any('Fired 2 h ago' in x['text'] for x in r), 'zazněný alarm říká, kdy zazněl')
snimek('perpyx-alarmy-neaktivni.png')

# ---- smazání jednoho na dvě klepnutí ----
klepni(".alert-row[data-id=vypnuty] .alert-smazat")
time.sleep(0.3)
over(len(radky()) == 3 and ev("document.querySelector('.alert-row[data-id=vypnuty] .alert-smazat').textContent") == 'Delete?',
     'první klepnutí na koš jen ptá „Delete?"')
klepni(".alert-row[data-id=vypnuty] .alert-smazat")
time.sleep(0.3)
over('vypnuty' not in [x['id'] for x in radky()], 'druhé klepnutí alarm smaže')

# ---- smazat všechny neaktivní ----
klepni('#alertsClear')
time.sleep(0.3)
txt = ev("document.getElementById('alertsClear').textContent")
print('tlačítko po prvním klepnutí:', txt)
over(len(radky()) == 2 and 'Tap again' in (txt or ''), 'první klepnutí na „smazat všechny" se jen zeptá')
klepni('#alertsClear')
time.sleep(0.5)
zbyle = ev("import('./js/alarmy.js').then((m) => m.vsechny().map((a) => a.id).sort().join(','))")
print('zbylé alarmy:', zbyle)
over(zbyle == 'blizko,cas', 'smazány všechny neaktivní, aktivní zůstaly')
over(not ev("document.getElementById('alertsEmpty').hidden"), 'prázdné Neaktivní mají text')

# ---- klepnutí otevře graf páru, zpět vrátí do Alarmů ----
klepni("#alertsTabs .list-tab")
time.sleep(0.5)
klepni(".alert-row[data-id=blizko]")
time.sleep(4)
over(ev("!document.getElementById('viewChart').hidden") and ev("document.getElementById('chartSymbol')?.textContent || document.querySelector('.chart-symbol')?.textContent || ''") is not None,
     'klepnutí na alarm otevře graf')
nadpis = ev("document.getElementById('viewChart').textContent.includes('JUPUSDT')")
over(nadpis, 'graf je pár alarmu')
ev("history.back()")
time.sleep(1.5)
over(ev("!document.getElementById('viewAlerts').hidden"), 'zpět z grafu vrátí do Alarmů')

# ---- systémové zpět z Alarmů → Pozice ----
ev("window.__krokZpet ? window.__krokZpet() : null")
time.sleep(0.8)
if ev("typeof window.__krokZpet") == 'function':
    over(ev("!document.getElementById('viewPositions').hidden"), 'zpět z Alarmů vede na Pozice')

# ---- rozevřený Fold ----
klepni("[data-tab=alerts]")
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=2, mobile=True)
time.sleep(1)
snimek('perpyx-alarmy-673.png')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(ev("document.querySelector('.alert-row[data-id=blizko] .nastaveni-prepinac')?.classList.contains('on')") is not False, 'přepínač aktivního alarmu svítí')
over(not konzole, f'bez chyb v konzoli {konzole}')

print()
print('VÝSLEDEK: ' + ('!!! NĚCO NESEDÍ' if chyby else 'ZÁLOŽKA ALARMY FUNGUJE'))
for c in chyby:
    print('  -', c)
