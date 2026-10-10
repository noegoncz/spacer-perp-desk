# -*- coding: utf-8 -*-
"""
Pozice otevřená na páru, jehož graf je otevřený (v0.35.0, jako v TabTraderu).

Uživatel kouká na graf páru bez pozice, vstoupí přes burzu a po návratu
do aplikace má pozici vidět hned v grafu (odznak, PnL, čáry), ne až po
zavření a znovuotevření grafu. Po zavření pozice graf zase přejde do
režimu bez pozice.

Test: graf BTCUSDT (bez pozice) z Trhů → podstrčená burza začne vracet
i pozici na BTCUSDT → obnovení pozic → graf ji musí ukázat.

Spuštění: python tools/test-nova-pozice-v-grafu.py http://localhost:8080/index.html
Na starém kódu padá.
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/position/list') && window.__btcPozice) {
      return puvodni(vstup, volby).then((r) => r.json()).then((j) => {
        const jup = j.result.list[0];
        const btc = { ...jup, symbol: 'BTCUSDT', side: 'Buy', size: '0.01', avgPrice: '0.29',
                      markPrice: '0.30', positionValue: '0.0029', stopLoss: '0.28', takeProfit: '0.33',
                      liqPrice: '0.2', unrealisedPnl: '0.0001' };
        j.result.list = window.__btcPozice === 'zavrena' ? [jup] : [jup, btc];
        return new Response(JSON.stringify(j), { status: 200 });
      });
    }
    if (u.includes('/v5/market/tickers') && !u.includes('symbol=')) {
      return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: [
        { symbol: 'JUPUSDT', lastPrice: '0.30', price24hPcnt: '0.01', turnover24h: '9000000', fundingRate: '0.0001', openInterestValue: '1' },
        { symbol: 'BTCUSDT', lastPrice: '0.30', price24hPcnt: '0.01', turnover24h: '9999999', fundingRate: '0.0001', openInterestValue: '1' },
      ] } }), { status: 200 }));
    }
    return puvodni(vstup, volby);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
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


STAV = """JSON.stringify({ par: document.getElementById('chartSymbol').textContent,
  odznak: document.getElementById('chartBadge').textContent.trim(),
  pnl: document.getElementById('chartPnl').textContent.trim(),
  cary: window.__graf.getOverlays().filter((o) => o.name === 'positionLine').map((o) => o.extendData.title),
  linkaZisku: window.__graf.getIndicators({ name: 'PNLLINE' }).length })"""

ev("document.querySelector('[data-tab=watchlist]').click()")
time.sleep(1)
ev("[...document.querySelectorAll('#watchLists .chip')].find((c) => c.textContent.startsWith('All'))?.click()")
time.sleep(0.5)
ev("[...document.querySelectorAll('.tile')].find((r) => r.textContent.includes('BTCUSDT')).click()")
time.sleep(4)
a = json.loads(ev(STAV) or '{}')
print('graf BTC bez pozice:', a)
over(a.get('par') == 'BTCUSDT' and not a.get('odznak'), 'graf BTCUSDT je otevřený bez pozice')

print('-> na burze se otevře pozice na BTCUSDT')
ev("window.__btcPozice = 'otevrena'; document.querySelector('[data-tab=positions]').click(); document.getElementById('refreshBtn').click()")
time.sleep(2)
b = json.loads(ev(STAV) or '{}')
print('po obnovení pozic:', b)
over(b.get('odznak', '').startswith('LONG'), 'v hlavičce grafu je pozice (LONG)')
over('USDT' in b.get('pnl', ''), 'v hlavičce je PnL pozice')
over(any(t.startswith('Stop Loss') for t in b.get('cary', [])) and any(t.startswith('Take Profit') for t in b.get('cary', [])),
     'v grafu jsou čáry SL a TP nové pozice')
over(b.get('linkaZisku') == 1, 'v grafu je linka zisku')
over(ev("!document.getElementById('viewChart').hidden") and b.get('par') == 'BTCUSDT', 'graf zůstal otevřený na stejném páru')

print('-> pozice se zavře')
ev("window.__btcPozice = 'zavrena'; document.querySelector('[data-tab=positions]').click(); document.getElementById('refreshBtn').click()")
time.sleep(2)
c = json.loads(ev(STAV) or '{}')
print('po zavření:', c)
over(not c.get('odznak'), 'odznak pozice zmizel')
over(not any(t.startswith('Stop Loss') for t in c.get('cary', [])), 'čáry pozice zmizely')
over(c.get('linkaZisku') == 0, 'linka zisku zmizela')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
