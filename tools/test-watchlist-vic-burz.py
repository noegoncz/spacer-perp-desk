# -*- coding: utf-8 -*-
"""
Watchlists z libovolné burzy (v0.56.0, přání uživatele).

Seznam obsahuje páry Bybitu i Binance, připojený je jen (podstrčený) Bybit.
Binance jde ze **skutečné burzy, bez klíče** (veřejná data přes CCXT).
Ověřuje:
  * dlaždice Binance má název burzy, cenu a mini-graf,
  * cena se v ní živě mění (dotazováním) bez přestavění dlaždice,
  * tentýž pár na dvou burzách jsou dvě dlaždice,
  * klepnutí otevře graf se svíčkami z Binance a v hlavičce stojí Binance,
  * pozice z Bybitu se do dlaždice Binance nepřipíše.
Na starém kódu padá (Binance dlaždice se vůbec neukáže).

Spuštění: python tools/test-watchlist-vic-burz.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'Main', polozky: ['bybit:JUPUSDT', 'binance:JUPUSDT', 'binance:ETHUSDT'] }] }));
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


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


def dlazdice(klic):
    return ev(f"""(() => {{ const t = document.querySelector('#watchList .tile[data-klic="{klic}"]'); if (!t) return null;
      return {{ burza: t.querySelector('.tile-burza').textContent, cena: t.querySelector('.tile-cena').textContent,
               graf: !!t.querySelector('.watch-spark polyline'),
               hodnota: (t.querySelector('.tile-pozice') || {{}}).textContent || '',
               stejna: t.__oznacena === true }}; }})()""")


ev("document.querySelector('.tab[data-tab=watchlist]').click()")
d = None
for _ in range(30):
    time.sleep(0.5)
    d = dlazdice('binance:JUPUSDT')
    if d and d['cena'] not in ('', '—', '-') and d['graf']:
        break
print('binance:JUPUSDT', d)
print('bybit:JUPUSDT', dlazdice('bybit:JUPUSDT'))
poradi = ev("[...document.querySelectorAll('#watchList .tile')].map((t) => t.dataset.klic)")
over(poradi == ['bybit:JUPUSDT', 'binance:JUPUSDT', 'binance:ETHUSDT'], f'tři dlaždice v pořadí seznamu ({poradi})')
over(d and d['burza'] == 'BINANCE', 'dlaždice Binance nese název burzy')
over(d and any(ch.isdigit() for ch in d['cena']), 'dlaždice Binance má cenu (bez klíče)')
over(d and d['graf'], 'dlaždice Binance má mini-graf')
b = dlazdice('bybit:JUPUSDT')
over(b and b['burza'] == 'BYBIT', 'dlaždice Bybitu nese Bybit')

print('živá cena')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:JUPUSDT\"]').__oznacena = true")
ceny = set()
for _ in range(40):
    time.sleep(1)
    x = dlazdice('binance:JUPUSDT')
    if x:
        ceny.add(x['cena'])
    if len(ceny) > 1:
        break
print('   ceny:', ceny)
x = dlazdice('binance:JUPUSDT')
over(len(ceny) > 1, 'cena Binance se v dlaždici mění sama')
over(x and x['stejna'], 'dlaždice se nepřestavěla (jen čísla)')

print('graf z dlaždice Binance')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:ETHUSDT\"]').click()")
info = ''
pocet = 0
for _ in range(30):
    time.sleep(0.5)
    info = ev("document.getElementById('chartInfo').textContent") or ''
    pocet = ev("window.__graf ? window.__graf.getDataList().length : 0") or 0
    if pocet > 50 and 'Binance' in info:
        break
posledni = ev("window.__graf ? window.__graf.getDataList().slice(-1)[0].close : 0") or 0
print('   hlavička:', info[:80], '| svíček:', pocet, '| poslední:', posledni)
over('Binance' in info and 'Bybit' not in info, 'v řádku nad grafem stojí Binance')
over(pocet > 50 and 300 < posledni < 100000, 'svíčky ETH z Binance (skutečná cena)')
ev("history.back()")
time.sleep(0.5)

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
