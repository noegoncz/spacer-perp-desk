# -*- coding: utf-8 -*-
"""
Historie po obchodech (v0.38.0).

  * Napoprvé jen posledních 7 dní (jeden dotaz na closed-pnl), starší po
    30 dnech tlačítkem „Load 30 more days"; nad seznamem stojí, od kdy.
  * Záznamy zavíracích příkazů se seskupí do obchodů podle plnění:
    částečný výstup otevřené pozice (mock: c3) patří do **otevřeného**
    obchodu s časem otevření z plnění, ne jako samostatný obchod.
  * Každý výstup má řádek (datum, doba držení, velikost, vstup → výstup,
    PnL), dole podtržený součet.
  * Klepnutí na otevřený obchod otevře graf živé pozice.

Spuštění: python tools/test-historie-skupiny.py http://localhost:8080/index.html
"""
import os, re, sys, time, json, base64
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


KARTY = """JSON.stringify([...document.querySelectorAll('#historyList .trade')].map((k) => ({
  otevreny: k.classList.contains('otevreny'),
  hlava: k.querySelector('.trade-titul').textContent,
  kdy: k.querySelector('.trade-when').textContent,
  vystupu: k.querySelectorAll('.trade-vystup').length,
  radky: [...k.querySelectorAll('.trade-vystup')].map((r) => r.textContent),
  soucet: k.querySelector('.trade-soucet').textContent })))"""

ev("window.__dotazyClosedPnl = 0")
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(3)
karty = json.loads(ev(KARTY) or '[]')
for k in karty:
    print('  karta:', k)
print('  dotazů na closed-pnl:', ev("window.__dotazyClosedPnl"))
over(ev("window.__dotazyClosedPnl") == 1, 'napoprvé jeden dotaz (7 dní)')
over('since' in (ev("document.getElementById('historyNote').textContent") or ''), 'nad seznamem stojí, od kdy jsou obchody')
over(len(karty) == 2, f'v posledních 7 dnech dva obchody (otevřený JUP a uzavřený B), je jich {len(karty)}')
otevreny = next((k for k in karty if k['otevreny']), None)
over(otevreny is not None, 'částečný výstup otevřené pozice je otevřený obchod')
if otevreny:
    over('Open' in otevreny['hlava'], 'otevřený obchod má štítek Open')
    # v0.38.1: jen „d.m.rrrr → Open", bez doprovodného textu.
    over(re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{4}\s+→\s+Open', otevreny['kdy'].strip()) is not None,
         f"datum otevření → Open ({otevreny['kdy']})")
    over(otevreny['vystupu'] == 1 and re.fullmatch(r'1,000 JUP \(310 USD\) → 0\.31000 \(\+2\.9 %\)\+2\.20',
                                                    otevreny['radky'][0]) is not None,
         f"výstup na jednom řádku podle vzoru ({otevreny['radky'][0]})")
    over('Total' in otevreny['soucet'] and '+2.20' in otevreny['soucet'], f"podtržený součet ({otevreny['soucet']})")
uzavreny = next((k for k in karty if not k['otevreny']), None)
if uzavreny:
    over(re.fullmatch(r'\d{1,2}\.\d{1,2}\.\d{4}\s+→\s+\d{1,2}\.\d{1,2}\.\d{4}', uzavreny['kdy'].strip()) is not None,
         f"uzavřený obchod: datum otevření → zavření ({uzavreny['kdy']})")
over(ev("!document.getElementById('historyMore').hidden"), 'pod seznamem tlačítko pro starší obchody')

r = p.prikaz('Page.captureScreenshot', format='png')
cesta = os.path.join(os.environ.get('TEMP', '.'), 'historie-skupiny.png')
open(cesta, 'wb').write(base64.b64decode(r['data']))
print('  snímek:', cesta)

ev("document.getElementById('historyMore').click()")
time.sleep(3)
karty2 = json.loads(ev(KARTY) or '[]')
print('  po načtení dalších 30 dní:', len(karty2), 'obchodů, dotazů', ev("window.__dotazyClosedPnl"))
over(len(karty2) == 3, 'přibyl starší obchod A (9 dní)')
over(bool(karty2) and karty2[0]['otevreny'], 'otevřený obchod je nahoře')

ev("[...document.querySelectorAll('#historyList .trade')].find((k) => k.classList.contains('otevreny')).click()")
time.sleep(3)
over(ev("!document.getElementById('viewChart').hidden") and bool(ev("document.getElementById('chartBadge').textContent")),
     'klepnutí na otevřený obchod otevře graf živé pozice')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
