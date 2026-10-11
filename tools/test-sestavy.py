# -*- coding: utf-8 -*-
"""
Watchlists: vlastní seznamy a vnořené přejíždění (od v0.46.0 bez „All").

Ověřuje:
  * dosavadní oblíbené (hvězdičky) se při prvním spuštění stanou seznamem
    „My watchlist"; v liště jsou jen seznamy, „+ New" stojí zvlášť
    napevno u pravého okraje,
  * uložený výběr „All" (starší verze) se převede na první seznam,
  * seznamy stojí pevně jako skupina uprostřed, při přepnutí se mění jen
    zvýraznění a ukazatel (v0.47.0); když se nevejdou, vybraný je vidět,
  * přejíždění **skutečným dotykem**: přepíná seznamy, za posledním
    pokračuje na Historii, před prvním na Pozice; z Historie zpátky
    přijde na poslední seznam,
  * smazání všech seznamů nechá prázdný „My watchlist",
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
    return ev("[...document.querySelectorAll('#watchList .tile')].map((r) => r.dataset.symbol)")


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



def new_vpravo():
    return ev("""(() => { const b = document.querySelector('#watchLists .list-new').getBoundingClientRect();
      const l = document.getElementById('watchLists').getBoundingClientRect(); return Math.round(l.right - b.right); })()""")


def listy():
    return ev("[...document.querySelectorAll('#watchLists .watch-lists-pas .chip')].map((b) => b.firstChild.textContent + (b.classList.contains('active') ? '*' : ''))")


SIRKA = 412
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
klik('.tab[data-tab=watchlist]')
time.sleep(1.5)

print('1) první spuštění')
l = listy()
print('   lišta:', l)
over(l == ['My watchlist*'], f'lišta: jen My watchlist, bez All ({l})')
over(ev("!!document.querySelector('#watchLists .list-vpravo .list-new') && !document.querySelector('.watch-lists-pas .list-new')"), '+ New je mimo pás seznamů')
over((new_vpravo() or 99) < 10, f'+ New u pravého okraje ({new_vpravo()} px)')
fav = ev("JSON.parse(localStorage.getItem('perpdesk.lists')).seznamy[0].polozky")
over(fav == ['bybit:BTCUSDT'], f'oblíbené převedené do seznamu jako burza:pár ({fav})')
over(ev("document.getElementById('watchCats').hidden") and ev("document.getElementById('watchTools').hidden"),
     'bez kategorií a hledání (patřily k All)')
over(radky() == ['BTCUSDT'], f'My watchlist ukazuje BTC ({radky()})')

print('2) seznamy stojí pevně uprostřed, mění se jen zvýraznění (v0.47.0)')
for nazev in ('Scalp', 'Swing'):
    klik('#watchLists .list-new')
    time.sleep(0.3)
    ev(f"document.getElementById('listName').value = {json.dumps(nazev)}")
    klik('#listSaveBtn')
    time.sleep(0.9)
l = listy()
over(l == ['My watchlist', 'Scalp', 'Swing*'], f'nový seznam je vybraný ({l})')
mista = lambda: ev("""[...document.querySelectorAll('#watchLists .list-tab:not(.list-new)')].map((b) => Math.round(b.getBoundingClientRect().left))""")
pred = mista()
skupina = ev("""(() => { const t = [...document.querySelectorAll('#watchLists .list-tab:not(.list-new)')].map((b) => b.getBoundingClientRect());
  return (t[0].left + t[t.length - 1].right) / 2; })()""")
over(abs(skupina - SIRKA / 2) < 8, f'skupina seznamů je uprostřed obrazovky ({round(skupina)})')
ev("[...document.querySelectorAll('#watchLists .list-tab')].find((b) => b.firstChild.textContent === 'My watchlist').click()")
time.sleep(0.6)
over(mista() == pred, f'po přepnutí se seznamy nepohnuly ({pred} → {mista()})')
ukaz = ev("""(() => { const u = document.querySelector('#watchLists .list-ukazatel').getBoundingClientRect();
  const a = document.querySelector('#watchLists .list-tab.active').getBoundingClientRect();
  return u.left >= a.left - 1 && u.right <= a.right + 1; })()""")
over(ukaz, 'ukazatel je pod vybraným seznamem')
over((new_vpravo() or 99) < 10, f'+ New zůstává u pravého okraje ({new_vpravo()} px)')
for nazev in ('Long term', 'Memes', 'AI coins'):
    klik('#watchLists .list-new')
    time.sleep(0.3)
    ev(f"document.getElementById('listName').value = {json.dumps(nazev)}")
    klik('#listSaveBtn')
    time.sleep(0.9)
l = listy()
over(l == ['My watchlist', 'Scalp', 'Swing', 'Long term', 'Memes', 'AI coins*'], f'šest seznamů, poslední vybraný ({l})')
vidno = ev("""(() => { const a = document.querySelector('#watchLists .list-tab.active').getBoundingClientRect();
  const p = document.querySelector('#watchLists .watch-lists-pas').getBoundingClientRect();
  return a.left >= p.left - 1 && a.right <= p.right + 1; })()""")
over(vidno, 'když se seznamy nevejdou, vybraný je celý vidět')
ev("[...document.querySelectorAll('#watchLists .list-tab')].find((b) => b.firstChild.textContent === 'Long term').click()")
time.sleep(0.9)

print('3) přejíždění skutečným dotykem')
y = ev("(() => { const r = document.getElementById('watchNote').getBoundingClientRect(); return r.top + 30; })()")
prejed(340, 80, y)       # Long term → Memes
time.sleep(0.6)
l = listy()
over(l and l[4] == 'Memes*', f'přejetí doleva přepne na další seznam ({l})')
over(ev("document.getElementById('watchList').classList.contains('prijezd-zprava')"),
     'obsah přijede zprava (přejetí jako listování)')
prejed(340, 80, y)       # → AI coins
prejed(340, 80, y)       # za posledním → Historie
over(zalozka() == 'history', f'za posledním seznamem přejetí přepne na Historii ({zalozka()})')
prejed(80, 340, 400)     # zpátky zprava → poslední seznam
l = listy()
over(zalozka() == 'watchlist' and l and l[-1] == 'AI coins*', f'z Historie přijde na poslední seznam ({l})')
for _ in range(5):
    prejed(80, 340, y)   # až na My watchlist
l = listy()
over(l and l[0] == 'My watchlist*', f'přejetí doprava vede na první seznam ({l})')
prejed(80, 340, y)       # před prvním → Pozice
over(zalozka() == 'positions', f'před prvním seznamem přejetí přepne na Pozice ({zalozka()})')

print('4) starší uložené „All" a smazání všech seznamů')
ev("""(() => { const s = JSON.parse(localStorage.getItem('perpdesk.lists')); s.aktivni = 'all';
  localStorage.setItem('perpdesk.lists', JSON.stringify(s)); })()""")
p.prikaz('Page.reload')
time.sleep(5)
klik('.tab[data-tab=watchlist]')
time.sleep(1.5)
l = listy()
over(l and l[0] == 'My watchlist*' and len(l) == 6, f'uložené All → první seznam, seznamy přežily přenačtení ({l})')
ev("""(() => { const s = JSON.parse(localStorage.getItem('perpdesk.lists')); s.seznamy = []; s.aktivni = 'all';
  localStorage.setItem('perpdesk.lists', JSON.stringify(s)); })()""")
p.prikaz('Page.reload')
time.sleep(5)
klik('.tab[data-tab=watchlist]')
time.sleep(1.5)
l = listy()
over(l == ['My watchlist*'], f'bez seznamů vznikne prázdný My watchlist ({l})')
over(ev("!document.getElementById('addPairBtn').hidden"), 'tlačítko + na přidání páru je vidět')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
