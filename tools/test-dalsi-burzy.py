# -*- coding: utf-8 -*-
"""
Další sada burz ve Watchlists (v0.57.0): OKX, Bitget, Gate, Hyperliquid
ze skutečných burz, bez klíče.

Ověřuje:
  * dlaždice všech čtyř mají název burzy, cenu a mini-graf,
  * hledání u + nabízí páry z nich (Hyperliquid jako BTCUSDC),
  * graf z dlaždice Hyperliquid má svíčky a v řádku nad grafem Hyperliquid,
  * nové burzy nejdou připojit klíčem (zatím jen veřejná data).

Spuštění: python tools/test-dalsi-burzy.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLICE = ['okx:BTCUSDT', 'bitget:ETHUSDT', 'gate:SOLUSDT', 'hyperliquid:BTCUSDC']
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'Main', polozky: %s }] }));
""" % json.dumps(KLICE)

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


def dlazdice():
    return json.loads(ev("""JSON.stringify([...document.querySelectorAll('#watchList .tile')].map((t) => ({
      klic: t.dataset.klic, burza: t.querySelector('.tile-burza').textContent,
      cena: t.querySelector('.tile-cena').textContent, graf: !!t.querySelector('.watch-spark .spark-cara') })))""") or '[]')


ev("document.querySelector('.tab[data-tab=watchlist]').click()")
d = []
for _ in range(40):
    time.sleep(0.5)
    d = dlazdice()
    if len(d) == 4 and all(any(ch.isdigit() for ch in x['cena']) and x['graf'] for x in d):
        break
for x in d:
    print('  ', x)
over([x['klic'] for x in d] == KLICE, 'čtyři dlaždice v pořadí seznamu')
over([x['burza'] for x in d] == ['OKX', 'BITGET', 'GATE', 'HYPERLIQUID'], 'každá nese svou burzu')
over(all(any(ch.isdigit() for ch in x['cena']) for x in d), 'všechny mají cenu')
over(all(x['graf'] for x in d), 'všechny mají mini-graf')

print('hledání')
ev("document.getElementById('addPairBtn').click()")
nalezeno = set()
for _ in range(40):
    time.sleep(0.5)
    ev("(() => { const i = document.getElementById('addPairSearch'); i.value = 'BTC'; i.dispatchEvent(new Event('input')); })()")
    nalezeno = set(ev("[...document.querySelectorAll('#addPairResults .pair-hit')].map((b) => b.dataset.klic)") or [])
    if {'okx:BTCUSDT', 'bitget:BTCUSDT', 'gate:BTCUSDT', 'hyperliquid:BTCUSDC'} <= nalezeno:
        break
print('   BTC:', sorted(k for k in nalezeno if k.endswith(('BTCUSDT', 'BTCUSDC'))))
over({'okx:BTCUSDT', 'bitget:BTCUSDT', 'gate:BTCUSDT', 'hyperliquid:BTCUSDC'} <= nalezeno, 'hledání nabízí BTC ze všech nových burz')
ev("document.getElementById('addPairClose').click()")
time.sleep(0.4)

print('graf z Hyperliquid')
ev("document.querySelector('#watchList .tile[data-klic=\"hyperliquid:BTCUSDC\"]').click()")
info, pocet = '', 0
for _ in range(40):
    time.sleep(0.5)
    info = ev("document.getElementById('chartInfo').textContent") or ''
    pocet = ev("window.__graf ? window.__graf.getDataList().length : 0") or 0
    if pocet > 50 and 'Hyperliquid' in info:
        break
posledni = ev("window.__graf.getDataList().slice(-1)[0].close") or 0
print('   hlavička:', info[:60], '| svíček:', pocet, '| poslední:', posledni)
over('Hyperliquid' in info and pocet > 50 and 10000 < posledni < 1e6, 'graf BTCUSDC z Hyperliquid')
ev("history.back()")
time.sleep(0.5)

print('připojení klíčem')
tlacitka = ev("[...document.querySelectorAll('.exchange-btn')].map((b) => (b.dataset.burza || b.textContent.trim()) + (b.disabled ? ':x' : ''))") or []
print('   úvod:', tlacitka)
over(not any(x.startswith(('okx', 'bitget', 'gate', 'mexc', 'hyperliquid')) and not x.endswith(':x') for x in tlacitka),
     'nové burzy zatím nejde připojit klíčem')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
