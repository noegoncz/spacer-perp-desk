# -*- coding: utf-8 -*-
"""
Trhy jako dlaždice (v0.36.0, podle TabTraderu) — skutečné dotyky přes CDP.

  * vlastní seznam jako dlaždice v pořadí uživatele, přepínač rozložení
    (mřížka / široké) se pamatuje,
  * plovoucí + otevře vyhledávání: výběr páru ho přidá s potvrzením,
    pole se vyprázdní a zůstane připravené na další hledání; podruhé
    stejný pár → „už je v seznamu",
  * podržet a táhnout dlaždici → přesun v seznamu,
  * podržet a pustit bez pohybu → nabídka, odebrat ze seznamu,
  * klepnutí na dlaždici otevře graf, „All" je ve výchozím stavu široké.

Spuštění: python tools/test-dlazdice.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
PARY = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'JUPUSDT', 'DOGEUSDT', 'ETHFIUSDT']
mock += """
(() => {
  if (!sessionStorage.getItem('__seznamy')) {
    sessionStorage.setItem('__seznamy', '1');
    localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'fav', seznamy: [
      { id: 'fav', nazev: 'Myspot', polozky: ['bybit:BTCUSDT', 'bybit:SOLUSDT', 'bybit:JUPUSDT'] }] }));
    localStorage.removeItem('perpdesk.marketsLayout');
  }
  const PARY = %s;
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/market/tickers') && !u.includes('symbol=')) {
      return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: PARY.map((s, i) => ({
        symbol: s, lastPrice: String(100 - i), price24hPcnt: '0.01', turnover24h: String(1e9 / (i + 1)),
        fundingRate: '0.0001', openInterestValue: '1000000' })) } }), { status: 200 }));
    }
    return puvodni(vstup, volby);
  };
})();
""" % json.dumps(PARY)

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def dotyk(typ, x, y):
    body = [] if typ == 'touchEnd' else [{'x': x, 'y': y, 'radiusX': 8, 'radiusY': 8, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type=typ, touchPoints=body)


def stred(sel):
    return json.loads(ev("""(() => { const e = document.querySelector(%s); if (!e) return 'null';
      const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()"""
                         % json.dumps(sel)) or 'null')


def klepni(sel):
    b = stred(sel)
    dotyk('touchStart', b['x'], b['y']); time.sleep(0.06); dotyk('touchEnd', b['x'], b['y'])
    time.sleep(0.5)


poradi = lambda: ev("[...document.querySelectorAll('#watchList .tile')].map((t) => t.dataset.symbol)")
ulozene = lambda: json.loads(ev("localStorage.getItem('perpdesk.lists')"))['seznamy'][0]['polozky']
chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


klepni('.tab[data-tab=watchlist]')
time.sleep(1)

print('1) seznam jako dlaždice')
over(poradi() == ['BTCUSDT', 'SOLUSDT', 'JUPUSDT'], f'dlaždice v pořadí seznamu ({poradi()})')
over(ev("document.getElementById('watchList').classList.contains('mrizka')"), 'výchozí rozložení je mřížka')
over(ev("!document.getElementById('addPairBtn').hidden"), 'vpravo dole je tlačítko +')
over(ev("document.getElementById('watchTools').hidden"), 've vlastním seznamu není hledání ani řazení')
sloupce = ev("""(() => { const t = [...document.querySelectorAll('#watchList .tile')].map((e) => e.getBoundingClientRect().top);
  return t[0] === t[1]; })()""")
over(sloupce, 'na úzkém displeji dvě dlaždice vedle sebe')
pozice = ev("document.querySelector('.tile[data-symbol=JUPUSDT] .tile-poz').textContent")
over('USDT' in (pozice or ''), f'u páru s pozicí je vlevo dole její hodnota ({pozice})')
klepni('#layoutBtn')
over(ev("document.getElementById('watchList').classList.contains('siroke')"), 'přepínač → široké dlaždice')
over(json.loads(ev("localStorage.getItem('perpdesk.marketsLayout')") or '{}').get('seznam') == 'siroke', 'rozložení se zapamatovalo')
klepni('#layoutBtn')

print('2) + a vyhledávání')
klepni('#addPairBtn')
over(ev("!document.getElementById('sheetAddPair').hidden"), '+ otevře vyhledávání')
over(ev("document.activeElement && document.activeElement.id") == 'addPairSearch', 'pole hledání má kurzor')
ev("(() => { const i = document.getElementById('addPairSearch'); i.value = 'eth'; i.dispatchEvent(new Event('input')); })()")
time.sleep(0.3)
vysl = ev("[...document.querySelectorAll('#addPairResults .pair-hit')].map((b) => b.dataset.symbol)")
print('   výsledky „eth“:', vysl)
over(vysl == ['ETHUSDT', 'ETHFIUSDT'], 'hledání najde ETH páry seřazené podle objemu')
over('BYBIT' in (ev("document.querySelector('.pair-hit .pair-hit-sub').textContent") or ''), 'u výsledku je burza a objem')
klepni('.pair-hit[data-symbol=ETHUSDT]')
toast = ev("document.getElementById('addPairToast').textContent")
print('   potvrzení:', toast)
over('ETHUSDT' in (toast or '') and 'added' in toast, 'krátké potvrzení přidání')
over(ev("document.getElementById('addPairSearch').value") == '', 'pole hledání se vyprázdnilo')
over(ev("document.activeElement && document.activeElement.id") == 'addPairSearch', 'kurzor zůstal v poli pro další hledání')
over(ulozene()[-1] == 'bybit:ETHUSDT', 'pár přibyl na konec seznamu')
ev("(() => { const i = document.getElementById('addPairSearch'); i.value = 'ETHUSDT'; i.dispatchEvent(new Event('input')); })()")
time.sleep(0.3)
over(ev("document.querySelector('.pair-hit[data-symbol=ETHUSDT]').classList.contains('pridano')"), 'přidaný pár má ve výsledcích fajfku')
klepni('.pair-hit[data-symbol=ETHUSDT]')
over('already' in (ev("document.getElementById('addPairToast').textContent") or ''), 'podruhé stejný pár → „už je v seznamu“')
over(ulozene().count('bybit:ETHUSDT') == 1, 'pár není v seznamu dvakrát')
klepni('#addPairClose')
over(poradi() == ['BTCUSDT', 'SOLUSDT', 'JUPUSDT', 'ETHUSDT'], f'nová dlaždice v seznamu ({poradi()})')

print('3) podržet a táhnout = přesun')
a = stred('.tile[data-symbol=BTCUSDT]')
b = stred('.tile[data-symbol=JUPUSDT]')
dotyk('touchStart', a['x'], a['y']); time.sleep(0.7)
for i in range(1, 11):
    dotyk('touchMove', a['x'] + (b['x'] - a['x']) * i / 10, a['y'] + (b['y'] - a['y']) * i / 10); time.sleep(0.03)
dotyk('touchEnd', b['x'], b['y']); time.sleep(0.8)
print('   po přesunu BTC na JUP:', poradi())
over(poradi() == ['JUPUSDT', 'SOLUSDT', 'BTCUSDT', 'ETHUSDT'], 'BTC a JUP si vyměnily místa')
over([x.split(':')[1] for x in ulozene()] == poradi(), 'nové pořadí se uložilo')
over(ev("!document.getElementById('viewChart').hidden") is False, 'přesun neotevřel graf')

print('4) podržet a pustit = nabídka, odebrat')
c = stred('.tile[data-symbol=SOLUSDT]')
dotyk('touchStart', c['x'], c['y']); time.sleep(0.7); dotyk('touchEnd', c['x'], c['y']); time.sleep(0.6)
over(ev("!document.getElementById('tileMenu').hidden"), 'nabídka u dlaždice')
over('Remove from Myspot' in (ev("document.getElementById('tileMenuRemove').textContent") or ''), 'nabídka nabízí odebrání')
over(ev("document.getElementById('viewChart').hidden"), 'podržení neotevřelo graf')
klepni('#tileMenuRemove')
over(poradi() == ['JUPUSDT', 'BTCUSDT', 'ETHUSDT'], f'SOL odebrán ({poradi()})')
sloupce = ev("""(() => { const t = [...document.querySelectorAll('#watchList .tile')].map((e) => Math.round(e.getBoundingClientRect().top));
  return new Set(t.slice(0, 2)).size === 1 && t[2] !== t[0]; })()""")
over(sloupce, 'mřížka má přesně dva sloupce')

print('5) klepnutí otevře graf, All je široké')
klepni('.tile[data-symbol=BTCUSDT]')
time.sleep(1.5)
over(ev("!document.getElementById('viewChart').hidden") and ev("document.getElementById('chartSymbol').textContent") == 'BTCUSDT',
     'klepnutí na dlaždici otevře graf')
ev("history.back()")
time.sleep(1)
ev("[...document.querySelectorAll('#watchLists .chip')].find((c) => c.textContent.startsWith('All')).click()")
time.sleep(0.6)
ev("[...document.querySelectorAll('#watchLists .chip')].find((c) => c.textContent.startsWith('All')).click()")
time.sleep(0.6)
over(ev("document.getElementById('watchList').classList.contains('siroke')"), '„All“ je ve výchozím stavu široké')
over(ev("document.getElementById('addPairBtn').hidden"), 'v „All“ není tlačítko +')
over(ev("document.querySelectorAll('#watchList .tile .tile-star').length") == len(PARY), 'v „All“ má každá dlaždice záložku')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
