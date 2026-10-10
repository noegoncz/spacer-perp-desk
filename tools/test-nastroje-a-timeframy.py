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
      return Math.round((a.left + a.width / 2) - (box.left + box.width / 2)) || 0; })()""")
# v0.37.0: pevné pořadí (žádný kolotoč), volné posouvání, vybraný vystředěný.
print('   pořadí:', poradi(), ' odchylka od středu:', stred(), 'px')
over([x.rstrip('*') for x in poradi()] == ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
     'pevné pořadí 1m → 1M včetně 30m')
over(abs(stred()) <= 3, 'aktivní 4h je uprostřed lišty')
for iv in ('1', 'M', '30'):
    ev("document.querySelector('.interval-btn[data-interval=\"%s\"]').click()" % iv)
    time.sleep(2)
    print(f'   po {iv}: odchylka', stred(), 'px')
    over(abs(stred()) <= 3, f'vybraný {iv} je uprostřed lišty (i krajní)')
over([x.rstrip('*') for x in poradi()][0] == '1', 'pořadí se výběrem nemění')
posun = ev("""(() => { const b = document.getElementById('intervals'); return b.scrollWidth > b.clientWidth; })()""")
over(posun, 'lišta timeframů se dá posouvat')

print('3) horní část grafu')
over(ev("window.__graf.getStyles().candle.tooltip.showRule") == 'none', 'legenda svíčky (Time, Open…) je vypnutá')
info = ev("document.getElementById('chartInfo').textContent") or ''
print('   řádek:', info)
over('Vol 24h' in info, 'v řádku je objem za 24 h')
over('Liq' not in info, 'v řádku už není likvidace')

print('4) hodnoty u čar v coinu / v USDT (v0.42.0)')
tituly = lambda: ev("window.__graf.getOverlays().filter((o) => o.name === 'positionLine').map((o) => o.extendData.title)") or []
print('   štítky:', tituly())
over(ev("document.getElementById('unitBtnText').textContent") == 'JUP', 'přepínač ukazuje coin páru')
over(any(t.startswith('Stop Loss 2,547 JUP') for t in tituly()), 'štítek SL v coinu')
ev("document.getElementById('unitBtn').click()")
time.sleep(0.5)
print('   po přepnutí:', tituly())
over(ev("document.getElementById('unitBtnText').textContent") == 'USDT', 'po klepnutí přepínač ukazuje USDT')
over(any(t.startswith('Stop Loss') and t.endswith('USDT') for t in tituly()), 'štítek SL v USDT')
over(any(t.startswith('Limit Buy') and t.endswith('USDT') for t in tituly()), 'štítek limitky v USDT')
ev("document.getElementById('unitBtn').click()")
time.sleep(0.3)
over(any(t.startswith('Stop Loss 2,547 JUP') for t in tituly()), 'zpět na coin')
over(ev("document.getElementById('drawToolbar').scrollWidth <= document.getElementById('drawToolbar').clientWidth + 1"),
     's přepínačem se lišta pořád vejde na 344 px')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
