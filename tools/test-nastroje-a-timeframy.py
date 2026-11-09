# -*- coding: utf-8 -*-
"""
Lišta pod grafem a horní řádek (v0.32.0).

  * Jedna lišta pod grafem (v0.92.0): kreslení ^ (i měření), indikátory,
    oko ^, celá obrazovka, magnet, timeframe ^, zpět — vejde se i na 344 px.
  * Kreslicí nástroje v nabídce (#sheetTools); tlačítko nese ikonu
    zvoleného nástroje a výběr nabídku zavře.
  * Timeframe: tlačítko otevře nabídku nahoru, širokou jako tlačítko.
  * Coin / USDT a smazání kreseb jsou v nabídce oka.
  * Legenda svíčky (Time, Open, High…) je vypnutá.
  * Řádek nad grafem: místo likvidace objem za 24 h.

Spuštění: python tools/test-nastroje-a-timeframy.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


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


ev("document.querySelector('.position').click()")
time.sleep(5)

def klepni_na(sel):
    """Skutečný dotyk doprostřed prvku."""
    r = ev("(() => { const r = document.querySelector(%s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()" % json.dumps(sel))
    bod = [{'x': r[0], 'y': r[1], 'radiusX': 6, 'radiusY': 6, 'force': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.4)


p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)

print('1) jedna lišta pod grafem (v0.92.0)')
over(ev("document.querySelectorAll('#drawToolbar .tool-item').length") == 0,
     'v liště nejsou jednotlivé nástroje')
PORADI = ['toolsBtn', 'indicatorBtn', 'layersBtn', 'fullscreenBtn', 'magnetBtn', 'tfBtn', 'chartBackBtnDole']
tlacitka = ev("[...document.querySelectorAll('#drawToolbar > .tool-btn, #drawToolbar > .tf-vyber > .tool-btn, #drawToolbar > .chart-back-big')].map((b) => b.id)") or []
print('   pořadí lišty:', tlacitka)
over(tlacitka == PORADI, 'kreslení, indikátory, oko, celá obrazovka, magnet, timeframe, zpět')
over(not ev("document.querySelector('.chart-tools')"), 'druhá řada (timeframy) zmizela')
for id_ in ('alarmBtn', 'unitBtn', 'eraseBtn'):
    over(not ev(f"document.getElementById('{id_}')"), f'{id_} v liště není')
def lista():
    return ev("""(() => { const l = document.getElementById('drawToolbar'); const r = l.getBoundingClientRect();
      const b = [...l.querySelectorAll(':scope > .tool-btn, :scope > .tf-vyber, :scope > .chart-back-big')].map((x) => x.getBoundingClientRect());
      return { vejde: l.scrollWidth <= l.clientWidth + 1 && b.every((x) => x.right <= r.right + 1 && x.left >= r.left - 1),
               min: Math.round(Math.min(...b.map((x) => x.width))), vyska: Math.round(r.height) }; })()""") or {}
uzka = lista()
print('   úzká lišta:', uzka)
over(uzka.get('vejde'), 'na 344 px se celá lišta vejde bez posouvání')
over((uzka.get('min') or 0) >= 40, 'tlačítka jsou aspoň 40 px široká')
klepni_na('#toolsBtn')
over(ev("!document.getElementById('sheetTools').hidden"), 'tlačítko otevře nabídku nástrojů')
popisky = ev("[...document.querySelectorAll('#sheetTools .tool-item span')].map((s) => s.textContent)") or []
print('   nástroje:', popisky)
over(len(popisky) == 11 and 'Trend line' in popisky and 'Measure' in popisky, 'nabídka má 11 nástrojů včetně měření')
over(not ev("document.getElementById('magnetRow')"), 'magnet už v nabídce není (je v liště)')
klepni_na('#sheetTools .tool-item[data-tool=segment]')
over(ev("document.getElementById('sheetTools').hidden"), 'výběr nástroje nabídku zavře')
over(ev("document.getElementById('toolsBtn').classList.contains('active')"), 'tlačítko nabídky svítí')
over(ev("!!document.querySelector('#toolsBtnIcon svg path[d^=\"M6 18L18 6\"]')"), 'tlačítko nese ikonu trendové čáry')
ev("document.querySelector('.tool-btn[data-tool].active').click()")  # druhé klepnutí zruší
time.sleep(0.3)
over(not ev("document.getElementById('toolsBtn').classList.contains('active')"), 'druhé klepnutí na nástroj vrátí výchozí ikonu')
ev("document.querySelector('#sheetTools .tool-item[data-tool=mereni]').click()")
time.sleep(0.4)
over(ev("document.getElementById('toolsBtn').classList.contains('active')") and
     ev("!!document.querySelector('#toolsBtnIcon svg path[d^=\"M3.5 16.5\"]')"), 'měření z nabídky: tlačítko svítí s ikonou měření')
ev("document.querySelector('.tool-btn[data-tool].active').click()")
time.sleep(0.3)

print('2) timeframe jako nabídka nahoru')
over(ev("document.getElementById('intervals').hidden"), 'nabídka timeframů je zavřená')
over(ev("document.getElementById('tfBtnText').textContent") == '4h', 'tlačítko ukazuje 4h')
klepni_na('#tfBtn')
otevrena = ev("""(() => { const n = document.getElementById('intervals'); if (n.hidden) return null;
  const r = n.getBoundingClientRect(), t = document.getElementById('tfBtn').getBoundingClientRect();
  return { pod: Math.round(r.bottom - t.top), sirka: Math.round(r.width), tl: Math.round(t.width), nahore: r.top >= 0,
           poradi: [...n.querySelectorAll('.interval-btn')].map((b) => b.dataset.interval) }; })()""")
print('   nabídka:', otevrena)
over(otevrena is not None, 'klepnutí nabídku otevře')
over(otevrena and otevrena['pod'] <= 0 and otevrena['nahore'], 'nabídka je nad tlačítkem a vejde se na displej')
over(otevrena and abs(otevrena['sirka'] - otevrena['tl']) <= 2, 'nabídka je široká jako tlačítko')
over(otevrena and otevrena['poradi'] == ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'], 'pevné pořadí 1m → 1M včetně 30m')
klepni_na('#intervals .interval-btn[data-interval="60"]')
time.sleep(1.5)
over(ev("document.getElementById('intervals').hidden"), 'výběr nabídku zavře')
over(ev("document.getElementById('tfBtnText').textContent") == '1h', 'tlačítko ukazuje 1h')
over(ev("document.querySelector('.interval-btn.active')?.dataset.interval") == '60', 'graf přepnul na 1h')
klepni_na('#tfBtn')
over(not ev("document.getElementById('intervals').hidden"), 'znovu otevřená')
r = ev("(() => { const r = document.getElementById('chartBox').getBoundingClientRect(); return [r.left + 60, r.top + 80]; })()")
bod = [{'x': r[0], 'y': r[1], 'radiusX': 6, 'radiusY': 6, 'force': 1}]
p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
time.sleep(0.4)
over(ev("document.getElementById('intervals').hidden"), 'klepnutí do grafu nabídku zavře')
over(ev("document.querySelector('.interval-btn.active')?.dataset.interval") == '60', 'timeframe zůstal 1h')
ev("document.querySelector('.interval-btn[data-interval=\"240\"]').click()")
time.sleep(1.5)

print('3) horní část grafu')
over(ev("window.__graf.getStyles().candle.tooltip.showRule") == 'none', 'legenda svíčky (Time, Open…) je vypnutá')
info = ev("document.getElementById('chartInfo').textContent") or ''
print('   řádek:', info)
over('Vol 24h' in info, 'v řádku je objem za 24 h')
over('Liq' not in info, 'v řádku už není likvidace')

print('4) hodnoty u čar v coinu / v USDT — v nabídce oka (v0.92.0)')
tituly = lambda: ev("window.__graf.getOverlays().filter((o) => o.name === 'positionLine').map((o) => o.extendData.title)") or []
over(any(t.startswith('Stop Loss 2,547 JUP') for t in tituly()), 'štítek SL v coinu')
klepni_na('#layersBtn')
volby = ev("[...document.querySelectorAll('#layersBody .nabidka-volba button')].map((b) => b.textContent)") or []
print('   volby v oku:', volby)
over(volby == ['JUP', 'USDT'], 'v nabídce oka je volba JUP / USDT')
over(ev("!!document.getElementById('layersEraseRow')"), 'v nabídce oka je smazání kreseb')
ev("document.querySelectorAll('#layersBody .nabidka-volba button')[1].click()")
time.sleep(0.5)
over(any(t.startswith('Stop Loss') and t.endswith('USDT') for t in tituly()), 'štítek SL v USDT')
ev("document.querySelectorAll('#layersBody .nabidka-volba button')[0].click()")
time.sleep(0.3)
over(any(t.startswith('Stop Loss 2,547 JUP') for t in tituly()), 'zpět na coin')
ev("document.querySelector('[data-close=sheetLayers]')?.click()")
time.sleep(0.3)

# Rozevřený Fold: stejná lišta, jen širší tlačítka.
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
time.sleep(1)
siroka = lista()
print('   lišta na rozevřeném Foldu:', siroka)
over(siroka.get('vejde') and (siroka.get('min') or 0) >= 70, 'široký displej: stejná lišta, širší tlačítka')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
