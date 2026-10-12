# -*- coding: utf-8 -*-
"""
Lišta pod grafem a horní řádek (v0.32.0).

  * Kreslicí nástroje jsou v nabídce (#sheetTools) s velkými ikonami
    a názvy; tlačítko nabídky pak nese ikonu zvoleného nástroje
    a výběr nabídku zavře.
  * Timeframy: pevné pořadí, vybraný se nestředí, jen je celý vidět;
    na začátku lišty není prázdná mezera (v0.50.1).
  * Lišta pod grafem: všech 9 tlačítek, pořadí od nejpoužívanějších,
    na úzkém displeji se posouvá do strany (v0.50.1).
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
PORADI = ['toolsBtn', 'alarmBtn', 'mereni', 'indicatorBtn', 'layersBtn', 'fullscreenBtn', 'magnetBtn', 'unitBtn', 'eraseBtn']
tlacitka = ev("[...document.querySelectorAll('#drawToolbar .tool-btn')].map((b) => b.id || b.dataset.tool)") or []
print('   pořadí lišty:', tlacitka)
over(tlacitka == PORADI, 'pořadí od nejpoužívanějších, všech 9 tlačítek')
uzka = ev("""(() => { const l = document.getElementById('drawToolbar'); const r = l.getBoundingClientRect();
  const celych = [...l.querySelectorAll('.tool-btn')].filter((b) => b.getBoundingClientRect().right <= r.right + 1).length;
  return { posouva: l.scrollWidth > l.clientWidth + 1, celych,
           sirka: Math.round(l.querySelector('.tool-btn').getBoundingClientRect().width),
           vytraci: getComputedStyle(l).webkitMaskImage !== 'none' }; })()""") or {}
print('   úzká lišta:', uzka)
over(uzka.get('posouva') and uzka.get('celych', 0) >= 6, 'na 344 px se lišta posouvá a prvních 6 tlačítek je celých')
over((uzka.get('sirka') or 0) >= 44, 'tlačítka lišty jsou aspoň 44 px široká')
over(uzka.get('vytraci'), 'pravý okraj se vytrácí (napoví posun)')
ev("document.getElementById('toolsBtn').click()")
time.sleep(0.5)
over(ev("!document.getElementById('sheetTools').hidden"), 'tlačítko otevře nabídku nástrojů')
popisky = ev("[...document.querySelectorAll('#sheetTools .tool-item span')].map((s) => s.textContent)") or []
print('   nástroje:', popisky)
over(len(popisky) == 10 and 'Trend line' in popisky and 'Measure' not in popisky, 'nabídka má 10 nástrojů s názvy (měření je v liště)')
over(ev("!!document.getElementById('magnetRow')"), 'v nabídce kreslení je magnet')
ev("document.querySelector('#sheetTools .tool-item[data-tool=segment]').click()")
time.sleep(0.5)
over(ev("document.getElementById('sheetTools').hidden"), 'výběr nástroje nabídku zavře')
over(ev("document.getElementById('toolsBtn').classList.contains('active')"), 'tlačítko nabídky svítí')
over(ev("!!document.querySelector('#toolsBtnIcon svg path[d^=\"M6 18L18 6\"]')"), 'tlačítko nese ikonu trendové čáry')
ev("document.querySelector('.tool-btn[data-tool].active').click()")  # druhé klepnutí zruší (v0.50.0 bez kurzoru)
time.sleep(0.3)
over(not ev("document.getElementById('toolsBtn').classList.contains('active')"), 'druhé klepnutí na nástroj vrátí výchozí ikonu')

print('2) timeframy')
def poradi():
    return ev("[...document.querySelectorAll('#intervals .interval-btn')].map((b) => b.dataset.interval + (b.classList.contains('active') ? '*' : ''))")
def vidno():
    return ev("""(() => { const box = document.getElementById('intervals').getBoundingClientRect();
      const a = document.querySelector('#intervals .interval-btn.active').getBoundingClientRect();
      return a.left >= box.left - 1 && a.right <= box.right + 1; })()""")
def mezera_vlevo():
    return ev("""(() => { const b = document.getElementById('intervals');
      return Math.round(b.querySelector('.interval-btn').getBoundingClientRect().left - b.getBoundingClientRect().left + b.scrollLeft); })()""")
# v0.50.1: pevné pořadí, volné posouvání, vybraný jen celý vidět (nestředí se).
print('   pořadí:', poradi(), ' mezera před 1m:', mezera_vlevo(), 'px')
over([x.rstrip('*') for x in poradi()] == ['1', '5', '15', '30', '60', '240', 'D', 'W', 'M'],
     'pevné pořadí 1m → 1M včetně 30m')
over(vidno(), 'aktivní 4h je celý vidět')
over((mezera_vlevo() or 0) <= 12, 'před 1m není prázdná mezera')
for iv in ('1', 'M', '30'):
    ev("document.querySelector('.interval-btn[data-interval=\"%s\"]').click()" % iv)
    time.sleep(2)
    over(vidno(), f'vybraný {iv} je celý vidět')
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


# Rozevřený Fold: v liště navíc magnet, coin/USDT a koš (9 tlačítek).
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
time.sleep(1)
siroka = ev("""(() => { const l = document.getElementById('drawToolbar');
  return { pocet: [...l.querySelectorAll('.tool-btn')].filter((b) => b.offsetWidth > 0).length,
           vejde: l.scrollWidth <= l.clientWidth + 1 }; })()""") or {}
print('   lišta na rozevřeném Foldu:', siroka)
over(siroka.get('pocet') == 9 and siroka.get('vejde'), 'široký displej: všech 9 tlačítek se vejde bez posouvání')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
