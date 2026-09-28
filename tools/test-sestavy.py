# -*- coding: utf-8 -*-
"""
Trhy: sestavy coinů, kategorie z CoinGecko a vnořené přejíždění.

Ověřuje:
  * dosavadní oblíbené (hvězdičky) se při prvním spuštění stanou sestavou
    „Favourites",
  * bez identifikovaných coinů je místo čipů tlačítko „Identify coins";
    po klepnutí se stáhne soubor kategorií a u párů se objeví kategorie
    (i u 1000PEPEUSDT → PEPE),
  * filtr kategorie, přidání páru do sestavy hvězdičkou, nová sestava,
    ruční oprava kategorie,
  * přejíždění **skutečným dotykem**: v Trzích přepíná sestavy, za
    poslední sestavou pokračuje na záložku Historie, před první na Pozice,
  * všechno přežije přenačtení stránky.

Spuštění: python tools/test-sestavy.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
KATEGORIE = {
    'verze': 1, 'vytvoreno': '2026-09-28T04:17:00Z', 'zdroj': 'CoinGecko',
    'kategorie': [{'id': 'artificial-intelligence', 'nazev': 'AI'}, {'id': 'meme-token', 'nazev': 'Meme'},
                  {'id': 'layer-1', 'nazev': 'L1'}],
    'coiny': {'BTC': ['Bitcoin', [2]], 'ETH': ['Ethereum', [2]], 'SOL': ['Solana', [2]],
              'PEPE': ['Pepe', [1]], 'DOGE': ['Dogecoin', [1]], 'FET': ['Fetch.ai', [0]]},
}
PARY = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', '1000PEPEUSDT', 'DOGEUSDT', 'FETUSDT', 'XYZUSDT']
mock += """
(() => {
  localStorage.setItem('perpdesk.favourites', JSON.stringify(['BTCUSDT']));
  const KAT = %s, PARY = %s;
  window.__stazeniKategorii = 0;
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/data/kategorie.json')) {
      window.__stazeniKategorii += 1;
      return Promise.resolve(new Response(JSON.stringify(KAT), { status: 200 }));
    }
    if (u.includes('/v5/market/tickers') && !u.includes('symbol=')) {
      return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: PARY.map((s, i) => ({
        symbol: s, lastPrice: String(100 - i), price24hPcnt: String(0.05 - i * 0.01), turnover24h: String(1e9 / (i + 1)), fundingRate: '0.0001', openInterestValue: '1000000' })) } }),
        { status: 200 }));
    }
    return puvodni(vstup, volby);
  };
})();
""" % (json.dumps(KATEGORIE), json.dumps(PARY))

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)


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


def klik(selektor):
    return ev(f"(() => {{ const e = document.querySelector({json.dumps(selektor)}); if (!e) return false; e.click(); return true; }})()")


def listy():
    return ev("[...document.querySelectorAll('#watchLists .chip')].map((b) => b.firstChild.textContent + (b.classList.contains('active') ? '*' : ''))")


def radky():
    return ev("[...document.querySelectorAll('#watchList .watch-row')].map((r) => r.dataset.symbol)")


def prejed(x1, x2, y):
    bod = lambda x: [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x1))
    for i in range(1, 11):
        p.prikaz('Input.dispatchTouchEvent', type='touchMove', touchPoints=bod(x1 + (x2 - x1) * i / 10))
        time.sleep(0.012)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.5)


def zalozka():
    return ev("document.querySelector('.tab.active')?.dataset.tab")


p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
klik('.tab[data-tab=watchlist]')
time.sleep(1.5)

print('1) první spuštění')
l = listy()
print('   lišta:', l)
over(l and l[0] == 'All*' and l[1] == 'My watchlist' and l[-1] == '+ New', 'lišta: All (aktivní), My watchlist, + New')
fav = ev("JSON.parse(localStorage.getItem('perpdesk.lists')).seznamy[0].polozky")
over(fav == ['bybit:BTCUSDT'], f'oblíbené převedené do sestavy jako burza:pár ({fav})')
over(ev("!!document.querySelector('#watchCats .identify-btn')"), 'místo kategorií tlačítko Identify coins')
over(ev("window.__stazeniKategorii") == 0, 'kategorie se samy nestahují')

print('2) identifikace coinů')
klik('#watchCats .identify-btn')
time.sleep(1)
cipy = ev("[...document.querySelectorAll('#watchCats .chip')].map((c) => c.textContent)")
print('   čipy:', cipy)
over(cipy and any(c.startswith('Meme') for c in cipy), 'po identifikaci jsou čipy kategorií')
pepe = ev("document.querySelector('.watch-row[data-symbol=\"1000PEPEUSDT\"] .watch-turnover')?.textContent")
over(pepe and 'Meme' in pepe, f'1000PEPEUSDT je Meme ({pepe})')

print('3) filtr kategorie')
ev("[...document.querySelectorAll('#watchCats .chip')].find((c) => c.textContent.startsWith('Meme')).click()")
time.sleep(0.4)
r = radky()
over(r == ['1000PEPEUSDT', 'DOGEUSDT'], f'Meme ukazuje jen PEPE a DOGE ({r})')
ev("[...document.querySelectorAll('#watchCats .chip')].find((c) => c.textContent.startsWith('No category')).click()")
time.sleep(0.4)
r = radky()
over(r == ['XYZUSDT'], f'„No category" ukazuje páry, které CoinGecko nezná ({r})')
ev("[...document.querySelectorAll('#watchCats .chip')].find((c) => c.textContent.startsWith('All')).click()")
time.sleep(0.4)

print('3b) řazení a přepnutí seznamu')
over(ev("document.getElementById('sortBtn').textContent") == 'Vol ↓', 'výchozí řazení podle objemu')
klik('#sortBtn')
time.sleep(0.3)
ev("[...document.querySelectorAll('#sortOptions .sheet-check')].find((b) => b.textContent.includes('Change')).click()")
time.sleep(0.3)
klik('#sortBtn')
time.sleep(0.3)
ev("[...document.querySelectorAll('#sortOptions .sheet-check')].find((b) => b.textContent.includes('Change')).click()")
time.sleep(0.3)
over(ev("document.getElementById('sortBtn').textContent") == '24h ↑', 'druhé klepnutí otočí směr')
r = radky()
over(r and r[0] == 'XYZUSDT', f'řazení podle změny vzestupně ({r[:3] if r else r})')
klik('#sortBtn'); time.sleep(0.2)
ev("[...document.querySelectorAll('#sortOptions .sheet-check')].find((b) => b.textContent.includes('Volume')).click()")
time.sleep(0.3)
# filtr kategorie a hledání se při přepnutí seznamu zruší
ev("[...document.querySelectorAll('#watchCats .chip')].find((c) => c.textContent.startsWith('Meme')).click()")
time.sleep(0.2)
ev("const i = document.getElementById('watchSearch'); i.value = 'PEPE'; i.dispatchEvent(new Event('input'))")
time.sleep(0.2)
ev("document.querySelectorAll('#watchLists .chip')[1].click()")
time.sleep(0.3)
ev("document.querySelectorAll('#watchLists .chip')[0].click()")
time.sleep(0.3)
over(len(radky() or []) == 7 and ev("document.getElementById('watchSearch').value") == '',
     'po přepnutí seznamu je vidět všechno (bez filtru a hledání)')

print('4) hvězdička a sestavy')
klik('.watch-row[data-symbol="SOLUSDT"] .watch-star')
time.sleep(0.3)
over(ev("!document.getElementById('sheetPair').hidden"), 'hvězdička otevře nabídku páru')
ev("[...document.querySelectorAll('#sheetPairLists .sheet-check')].find((b) => b.textContent.includes('My watchlist')).click()")
time.sleep(0.3)
klik('#sheetPairClose')
time.sleep(0.3)
over(ev("document.querySelector('.watch-row[data-symbol=\"SOLUSDT\"] .watch-star').classList.contains('on')"),
     'SOL má plnou hvězdičku')
klik('#watchLists .list-new')
time.sleep(0.3)
ev("document.getElementById('listName').value = 'Scalp'")
klik('#listSaveBtn')
time.sleep(0.4)
l = listy()
over(l and l[-2] == 'Scalp*', f'nová sestava Scalp je aktivní ({l})')
over('empty' in (ev("document.getElementById('watchNote').textContent") or ''), 'prázdná sestava má nápovědu')

print('5) přejíždění skutečným dotykem')
y = ev("(() => { const r = document.getElementById('watchNote').getBoundingClientRect(); return r.top + 30; })()")
prejed(340, 80, y)       # za poslední sestavou → Historie
over(zalozka() == 'history', f'za poslední sestavou přejetí přepne na Historii ({zalozka()})')
prejed(80, 340, 400)     # zpátky na Trhy (Scalp zůstává aktivní)
over(zalozka() == 'watchlist', 'přejetím zpátky na Trhy')
prejed(80, 340, 400)     # Scalp → Favourites
l = listy()
over(l and l[1] == 'My watchlist*', f'přejetí doprava přepne na předchozí sestavu ({l})')
r = radky()
over(r == ['BTCUSDT', 'SOLUSDT'], f'My watchlist obsahuje BTC a SOL ({r})')
prejed(80, 340, 400)     # Favourites → All
prejed(80, 340, 400)     # před první → Pozice
over(zalozka() == 'positions', f'před první sestavou přejetí přepne na Pozice ({zalozka()})')
klik('.tab[data-tab=watchlist]')
time.sleep(0.8)

print('6) ruční oprava kategorie')
klik('.watch-row[data-symbol="1000PEPEUSDT"] .watch-star')
time.sleep(0.3)
ev("[...document.querySelectorAll('#sheetPairCats .chip')].find((c) => c.textContent === 'AI').click()")
time.sleep(0.3)
over(ev("!document.getElementById('sheetPairReset').hidden"), 'po opravě je vidět tlačítko Reset')
klik('#sheetPairClose')
time.sleep(0.3)
pepe = ev("document.querySelector('.watch-row[data-symbol=\"1000PEPEUSDT\"] .watch-turnover')?.textContent")
over(pepe and 'AI' in pepe, f'PEPE má po opravě AI ({pepe})')

print('7) po přenačtení')
p.prikaz('Page.reload')
time.sleep(5)
klik('.tab[data-tab=watchlist]')
time.sleep(1.5)
l = listy()
over(l and l[0] == 'All*' and any(x.startswith('Scalp') for x in l), f'sestavy přežily přenačtení ({l})')
over(ev("!document.querySelector('#watchCats .identify-btn')") and ev("window.__stazeniKategorii") == 0,
     'kategorie jsou uložené, znovu se nestahují')

# magnet v grafu dřív sahal na zrušené tlačítko filtru oblíbených
ev("document.querySelector('.watch-row').click()")
time.sleep(2.5)
klik('#magnetBtn')
time.sleep(0.3)
konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
