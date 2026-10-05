# -*- coding: utf-8 -*-
"""
Lišta pod grafem a horní řádek (v0.32.0).

  * Kreslicí nástroje jsou v nabídce (#sheetTools) s velkými ikonami
    a názvy; tlačítko nabídky pak nese ikonu zvoleného nástroje
    a výběr nabídku zavře.
  * Timeframy: aktivní stojí uprostřed lišty a ostatní se točí dokola.
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

print('1) nabídka nástrojů')
over(ev("document.querySelectorAll('#drawToolbar .tool-item').length") == 0,
     'v liště nejsou jednotlivé nástroje')
sirka = ev("document.getElementById('drawToolbar').scrollWidth <= document.getElementById('drawToolbar').clientWidth + 1")
over(sirka, 'lišta se na 344 px vejde bez posouvání')
ev("document.getElementById('toolsBtn').click()")
time.sleep(0.5)
over(ev("!document.getElementById('sheetTools').hidden"), 'tlačítko otevře nabídku nástrojů')
popisky = ev("[...document.querySelectorAll('#sheetTools .tool-item span')].map((s) => s.textContent)") or []
print('   nástroje:', popisky)
over(len(popisky) == 11 and 'Trend line' in popisky and 'Measure' in popisky, 'nabídka má 11 nástrojů s názvy')
ev("document.querySelector('#sheetTools .tool-item[data-tool=segment]').click()")
time.sleep(0.5)
over(ev("document.getElementById('sheetTools').hidden"), 'výběr nástroje nabídku zavře')
over(ev("document.getElementById('toolsBtn').classList.contains('active')"), 'tlačítko nabídky svítí')
over(ev("!!document.querySelector('#toolsBtnIcon svg path[d^=\"M6 18L18 6\"]')"), 'tlačítko nese ikonu trendové čáry')
ev("document.querySelector('#drawToolbar .tool-btn[data-tool=\"\"]').click()")
time.sleep(0.3)
over(not ev("document.getElementById('toolsBtn').classList.contains('active')"), 'kurzor vrátí výchozí ikonu')

print('2) timeframy')
def poradi():
    return ev("[...document.querySelectorAll('#intervals .interval-btn')].map((b) => b.dataset.interval + (b.classList.contains('active') ? '*' : ''))")
def stred():
    return ev("""(() => { const box = document.getElementById('intervals').getBoundingClientRect();
      const a = document.querySelector('#intervals .interval-btn.active').getBoundingClientRect();
      return Math.round((a.left + a.width / 2) - (box.left + box.width / 2)); })()""")
print('   pořadí:', poradi(), ' odchylka od středu:', stred(), 'px')
over(poradi()[4] == '240*', 'aktivní 4h je uprostřed pořadí')
over(abs(stred()) <= 30, 'aktivní 4h je uprostřed viditelné lišty')
ev("document.querySelector('.interval-btn[data-interval=\"1\"]').click()")
time.sleep(2)
o = poradi()
print('   po 1m:', o, ' odchylka:', stred(), 'px')
over(o[4] == '1*' and o[3] == 'M' and o[5] == '5', 'po 1m se lišta otočí (1M | 1m | 5m)')
over(abs(stred()) <= 30, 'aktivní 1m je uprostřed viditelné lišty')

print('3) horní část grafu')
over(ev("window.__graf.getStyles().candle.tooltip.showRule") == 'none', 'legenda svíčky (Time, Open…) je vypnutá')
info = ev("document.getElementById('chartInfo').textContent") or ''
print('   řádek:', info)
over('Vol 24h' in info, 'v řádku je objem za 24 h')
over('Liq' not in info, 'v řádku už není likvidace')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
