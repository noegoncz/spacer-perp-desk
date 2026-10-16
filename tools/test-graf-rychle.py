# -*- coding: utf-8 -*-
"""
Graf z CCXT burzy se otevře rychle (v0.59.3, video uživatele 2026-10-14:
graf Binance ~5 s prázdný, pak osa 0–10, teprve pak svíčky).

Příčina: omezovač dotazů CCXT má každá instance jeden a u připojeného účtu
Binance v něm stály pozice, zůstatek a příkazy — svíčky grafu čekaly za
nimi. Ověřuje (Binance ze skutečné burzy, klíč vymyšlený):
  1) adaptér s klíčem má pro veřejná data vlastní instanci,
  2) s plnou frontou soukromé instance (jako na telefonu) přijdou svíčky
     do 2 s,
  3) aplikace svíčky grafu předčte: po startu je pro dlaždice všech
     seznamů (v0.59.5) stáhne dopředu a graf z dlaždice se otevře bez dalšího
     dotazu na svíčky (500) a hned.
Na starém kódu padá v bodech 1–3.

Spuštění: python tools/test-graf-rychle.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'BTC', polozky: ['binance:BTCUSDT', 'okx:BTCUSDT', 'binance:ETHUSDT'] },
            { id: 'b', nazev: 'Druhy', polozky: ['binance:SOLUSDT'] }] }));
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(4)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


print('1–2) adaptér Binance s klíčem, plná fronta soukromé instance')
r = ev("""(async () => {
  const { vytvorBurzu } = await import('/js/burzy/index.js');
  const k = vytvorBurzu('binance', {});
  k.setCredentials('VYMYSLENY', 'VYMYSLENY');
  const soukroma = await k.burzaCcxt();
  // Fronta jako na telefonu: pozice, zůstatek a příkazy (50 jednotek) dokola.
  for (let i = 0; i < 6; i += 1) soukroma.throttle(50);
  const verejna = k.burzaVerejna ? await k.burzaVerejna() : soukroma;
  const t0 = performance.now();
  const svice = await k.getKlines('BTCUSDT', '240', 500);
  return { oddelene: verejna !== soukroma, ms: Math.round(performance.now() - t0), n: svice.length };
})()""", True)
print('  ', r)
over(r and r['oddelene'], 'veřejná data mají vlastní instanci CCXT')
over(r and r['n'] > 400 and r['ms'] < 2000, f"svíčky přišly do 2 s i s plnou frontou účtu ({r and r['ms']} ms)")

print('3) předčtení svíček pro dlaždice')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
for _ in range(40):
    time.sleep(0.5)
    if ev("performance.getEntriesByType('resource').some(e => /fapi\\/v1\\/klines.*limit=500.*symbol=ETHUSDT/.test(e.name))"):
        break
time.sleep(1.5)
predem = ev("performance.getEntriesByType('resource').filter(e => /klines.*limit=500/.test(e.name)).map(e => e.name.slice(0, 90))") or []
print('   předčteno:', len(predem))
over(any('symbol=BTCUSDT' in u for u in predem) and any('symbol=ETHUSDT' in u for u in predem),
     'svíčky Binance pro dlaždice seznamu se stáhly dopředu')
over(any('symbol=SOLUSDT' in u for u in predem), 'i páry neotevřeného seznamu se stáhly dopředu (v0.59.5)')
ev("performance.clearResourceTimings()")
ev("document.querySelector('#watchList .tile[data-klic=\"binance:ETHUSDT\"]').click()")
t0 = time.time()
n = 0
for _ in range(40):
    time.sleep(0.1)
    n = ev("window.__graf ? window.__graf.getDataList().length : 0") or 0
    skryto = ev("!!document.querySelector('.ceka-na-data')")
    if n > 400 and not skryto:
        break
trvani = time.time() - t0
posledni = ev("window.__graf.getDataList().slice(-1)[0].close") or 0
znovu = ev("performance.getEntriesByType('resource').filter(e => /klines.*limit=500/.test(e.name)).length")
print(f'   graf: {n} svíček za {trvani:.2f} s, poslední {posledni}, nových dotazů na 500 svíček: {znovu}')
over(n > 400 and 300 < posledni < 100000, 'graf ETH z Binance má svíčky')
over(znovu == 0, 'graf vzal předčtené svíčky (žádný nový dotaz)')
over(trvani < 0.8, f'graf se otevřel hned ({trvani:.2f} s)')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
