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

karty = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.trade')].map((k) => ({
  pnl: k.querySelector('.trade-pnl').textContent,
  kdy: k.querySelector('.trade-when').textContent })))""") or '[]')
for k in karty:
    print('karta:', k['pnl'], '|', k['kdy'])
if len(karty) != 2:
    chyby.append(f'v historii mají být dva obchody, je jich {len(karty)}')
if any('Duration' in k['kdy'] or '→' in k['kdy'] for k in karty):
    chyby.append('karta ukazuje rozsah od → do, přestože čas otevření Bybit nedává')
if not all(k['kdy'].startswith('closed ') for k in karty):
    chyby.append('karta neukazuje čas zavření')

# Obchod B je nahoře (novější). Otevřít ho.
ev("document.querySelector('.trade').click()")
time.sleep(6)

znacky = json.loads(ev("""JSON.stringify(window.__graf.getOverlays()
  .filter((o) => o.name === 'tradeMark')
  .map((o) => ({ vstup: o.extendData.vstup, cena: o.points[0].value,
                 dnu: Math.round((Date.now() - o.points[0].timestamp) / 864e5) })))""") or '[]')
print('značky v grafu obchodu:', znacky)
ceny = sorted(z['cena'] for z in znacky)
# Obchod B: nákupy 0.2800 a 0.2850, zavírací prodej ve dvou plněních 0.2950 a 0.2951.
if ceny != [0.28, 0.285, 0.295, 0.2951]:
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
