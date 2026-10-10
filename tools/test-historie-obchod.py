# -*- coding: utf-8 -*-
"""
Prohlídka uzavřeného obchodu z historie (v0.17.0).

  * `closed-pnl` nedává čas otevření — `createdTime` je vznik záznamu, tedy
    skoro totéž co zavření. Karta proto nesmí ukazovat „od → do" s délkou
    pár milisekund, jen čas zavření.
  * V grafu obchodu smí být **jen jeho** nákupy a prodeje: od plnění, které
    pozici otevřelo, po zavírací příkaz. Mock má vedle něj starší obchod A
    a současnou pozici na stejném páru — ty se nesmí připlést.
  * Interval se volí podle skutečné délky obchodu (dopočtené z plnění).

Spuštění: python tools/test-historie-obchod.py http://localhost:8080/index.html
"""
import os, sys, time, json
# Konzole Windows (cp1250) neumí „→" ani typografické minus; nepadat na tom.
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


chyby = []
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(3)

# Od v0.38.0 jsou karty obchody (skupiny výstupů) a čas otevření se
# dopočítá z plnění — rozsah „Opened … → closed …" je tedy správně.
karty = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.trade')].map((k) => ({
  otevreny: k.classList.contains('otevreny'),
  pnl: k.querySelector('.trade-soucet .trade-pnl').textContent,
  kdy: k.querySelector('.trade-when').textContent })))""") or '[]')
for k in karty:
    print('karta:', k['pnl'], '|', k['kdy'])
uzavrene = [k for k in karty if not k['otevreny']]
if len(uzavrene) != 1:
    chyby.append(f'v posledních 7 dnech má být jeden uzavřený obchod (B), je jich {len(uzavrene)}')
if not all(k['kdy'].count('.') == 4 and '→' in k['kdy'] for k in uzavrene):
    chyby.append('uzavřený obchod neukazuje otevření a zavření')

# Uzavřený obchod B (otevřený je současná pozice). Otevřít ho.
ev("[...document.querySelectorAll('.trade')].find((k) => !k.classList.contains('otevreny')).click()")
time.sleep(6)

znacky = json.loads(ev("""JSON.stringify(window.__graf.getOverlays()
  .filter((o) => o.name === 'tradeMark')
  .map((o) => ({ vstup: o.extendData.vstup, cena: o.points[0].value,
                 dnu: Math.round((Date.now() - o.points[0].timestamp) / 864e5) })))""") or '[]')
print('značky v grafu obchodu:', znacky)
ceny = sorted(round(z['cena'], 5) for z in znacky)
# Obchod B: nákupy 0.2800 a 0.2850, zavírací prodej ve dvou plněních 0.2950
# a 0.2951. Plnění jednoho příkazu jsou od v0.31.2 jeden trojúhelník
# (vážený průměr 0.29504), ne sloupec značek.
if ceny != [0.28, 0.285, 0.29504]:
    chyby.append(f'v grafu nejsou přesně plnění obchodu B: {ceny}')
if sum(1 for z in znacky if z['vstup']) != 2:
    chyby.append('obchod B má mít dva vstupy')
if any(z['cena'] in (0.27, 0.26, 0.299, 0.305, 0.31) for z in znacky):
    chyby.append('do grafu se připletla plnění jiného obchodu')

interval = ev("document.querySelector('.interval-btn.active')?.dataset.interval")
print('zvolený interval:', interval)
# Obchod trval dva dny — minutové svíčky by ho roztáhly na stovky obrazovek.
if interval in ('1', '5', '15'):
    chyby.append(f'interval {interval} je na dvoudenní obchod moc jemný (délka se nedopočetla)')

# ---- Historie si timeframe jen půjčí ----
# Prohlídka obchodu zvolila interval podle délky obchodu. Běžný graf se pak
# musí otevřít zase na timeframu, který si zvolil uživatel (výchozí 4h),
# jinak by kresby nakreslené o dny dřív zmizely z obrazu minutového grafu.
ev("history.back()")
time.sleep(1.5)
ev("document.querySelector('[data-tab=positions]').click()")
time.sleep(1.5)
ev("document.querySelector('.position').click()")
time.sleep(4)
po_historii = ev("document.querySelector('.interval-btn.active')?.dataset.interval")
print('graf pozice otevřený po prohlídce z Historie, interval:', po_historii)
if po_historii != '240':
    chyby.append(f'po prohlídce z Historie zůstal její interval ({po_historii}) i pro běžný graf')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: OBCHOD Z HISTORIE UKAZUJE JEN SVÁ PLNĚNÍ')
