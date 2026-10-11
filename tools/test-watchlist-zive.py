# -*- coding: utf-8 -*-
"""
Živé ceny v dlaždicích Watchlists (v0.49.0).

Podstrčené spojení (WebSocket) zaznamená odběry a umí poslat změnu ceny
jako Bybit (ticker delta). Ověřuje:
  * páry vybraného seznamu se odebírají na veřejném streamu,
  * změna ceny se do dlaždice zapíše do ~1 s, **bez přestavění dlaždice**,
  * změna přišlá při otevřeném grafu je v dlaždici hned po návratu,
  * přepnutí seznamu přepne i odběr.
Na starém kódu padá.

Spuštění: python tools/test-watchlist-zive.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'Main', polozky: ['bybit:JUPUSDT', 'bybit:BTCUSDT'] },
            { id: 'b', nazev: 'Second', polozky: ['bybit:ETHUSDT'] }] }));
(() => {
  const f = window.fetch;
  window.fetch = function (v, o) {
    const u = String(v && v.url ? v.url : v);
    if (u.includes('/v5/market/tickers') && !u.includes('symbol=')) {
      return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: [
        ['JUPUSDT', '0.30580'], ['BTCUSDT', '83000'], ['ETHUSDT', '2500']].map(([symbol, lastPrice]) => ({
        symbol, lastPrice, price24hPcnt: '0.0123', turnover24h: '1234567', fundingRate: '0.0001',
        nextFundingTime: String(Date.now() + 3600e3) })) } }), { status: 200 }));
    }
    return f(v, o);
  };
  // Spojení, které zaznamená odběry a dovolí poslat zprávu jako burza.
  window.__ws = {};
  window.__odbery = new Set();
  window.WebSocket = function (url) {
    this.url = url; this.readyState = 0; window.__ws[url.includes('public') ? 'public' : 'private'] = this;
    this.send = (t) => { try { const m = JSON.parse(t);
      if (m.op === 'subscribe') m.args.forEach((a) => window.__odbery.add(a));
      if (m.op === 'unsubscribe') m.args.forEach((a) => window.__odbery.delete(a)); } catch {} };
    this.close = () => {};
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 50);
  };
  window.WebSocket.OPEN = 1;
  window.__posliTicker = (data) => window.__ws.public?.onmessage?.({ data: JSON.stringify({ topic: 'tickers.' + data.symbol, type: 'delta', data }) });
})();
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


def dlazdice(symbol):
    return ev(f"""(() => {{ const t = document.querySelector('#watchList .tile[data-symbol="{symbol}"]'); if (!t) return null;
      return {{ cena: t.querySelector('.tile-cena').textContent, zmena: t.querySelector('.tile-zmena').textContent,
               stejna: t.__oznacena === true }}; }})()""")


ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(1.5)
odbery = ev("[...window.__odbery].sort()") or []
print('odběry:', odbery)
over('tickers.BTCUSDT' in odbery and 'tickers.JUPUSDT' in odbery, 'páry vybraného seznamu se odebírají živě')

ev("document.querySelector('#watchList .tile[data-symbol=BTCUSDT]').__oznacena = true")
ev("window.__posliTicker({ symbol: 'BTCUSDT', lastPrice: '90000', price24hPcnt: '0.05' })")
time.sleep(0.3)
d = dlazdice('BTCUSDT')
print('hned po změně:', d)
time.sleep(1.2)
d = dlazdice('BTCUSDT')
print('po vteřině:', d)
over(d and d['cena'] == '90,000.00' and '5.00' in d['zmena'], 'dlaždice ukazuje novou cenu a změnu')
over(d and d['stejna'], 'dlaždice se nepřestavěla (jen čísla)')

print('změna při otevřeném grafu')
ev("document.querySelector('#watchList .tile[data-symbol=BTCUSDT]').click()")
time.sleep(2)
ev("window.__posliTicker({ symbol: 'BTCUSDT', lastPrice: '91234.5' })")
time.sleep(1.3)
ev("history.back()")
time.sleep(0.4)
d = dlazdice('BTCUSDT')
print('po návratu:', d)
over(d and d['cena'] == '91,234.50', 'po návratu z grafu je v dlaždici aktuální cena')
over(d and '5.00' in d['zmena'], 'změna 24 h z předchozí zprávy zůstala (delta bez pole)')

print('přepnutí seznamu')
ev("document.querySelector('#watchLists .list-tab[data-id=b]').click()")
time.sleep(0.6)
odbery = ev("[...window.__odbery].sort()") or []
print('odběry:', odbery)
over('tickers.ETHUSDT' in odbery and 'tickers.BTCUSDT' not in odbery, 'odběr se přepnul na nový seznam')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
