# -*- coding: utf-8 -*-
"""
Živý proud Binance (v0.59.10): ceny dlaždic a živá svíčka grafu chodí
proudem `wss://fstream.binance.com/market/ws` místo dotazu po 2 s.
Skutečná burza, bez klíče. Ověřuje:
  1) dlaždice Binance odebírají `@miniTicker` a cena se v nich mění,
     aniž by se ceny stahovaly dotazem,
  2) graf Binance odebírá `@kline_<interval>`, živá svíčka se hýbe
     a dotaz na poslední svíčky (limit=2) se neposílá,
  3) na pozadí se proud zavře, po návratu otevře znovu.
Na starém kódu padá (proud žádný, vše dotazem).

Spuštění: python tools/test-binance-proud.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'BN', polozky: ['binance:BTCUSDT', 'binance:ETHUSDT'] }] }));
// Záznam živých spojení na Binance: adresa, odeslané zprávy, stav.
(() => {
  const Puvodni = window.WebSocket;
  window.__proudy = [];
  window.WebSocket = function (url, p) {
    const ws = new Puvodni(url, p);
    if (String(url).includes('binance')) {
      const z = { url: String(url), odeslano: [], zprav: 0, zavreno: false };
      window.__proudy.push(z);
      const send = ws.send.bind(ws);
      ws.send = (d) => { z.odeslano.push(String(d)); return send(d); };
      ws.addEventListener('message', () => { z.zprav += 1; });
      ws.addEventListener('close', () => { z.zavreno = true; });
    }
    return ws;
  };
  window.WebSocket.prototype = Puvodni.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
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


proudy = lambda: json.loads(ev('JSON.stringify(window.__proudy)') or '[]')
dotazy = lambda vzor: ev(f"performance.getEntriesByType('resource').filter((e) => /{vzor}/.test(e.name)).length") or 0

print('1) dlaždice')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(6)
pr = proudy()
temata = ' '.join(' '.join(x['odeslano']) for x in pr)
print('   proudy:', [(x['url'], x['zprav'], x['zavreno']) for x in pr])
over(any(x['url'].endswith('/market/ws') for x in pr), 'proud na /market/ws (ne starou /ws)')
over('btcusdt@miniTicker' in temata and 'ethusdt@miniTicker' in temata, 'dlaždice odebírají @miniTicker')
ev("performance.clearResourceTimings()")
ceny = set()
for _ in range(12):
    time.sleep(1)
    ceny.add(ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"] .tile-cena')?.textContent"))
tickery = dotazy('ticker.24hr')
print('   ceny BTC:', ceny, '| dotazů na ceny:', tickery)
over(len(ceny) > 1, 'cena v dlaždici se mění')
over(tickery == 0, f'ceny nejdou dotazem, ale proudem ({tickery} dotazů za 12 s)')

print('2) graf')
ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"]').click()")
time.sleep(5)
temata = ' '.join(' '.join(x['odeslano']) for x in proudy())
over('btcusdt@kline_' in temata, 'graf odebírá @kline')
ev("performance.clearResourceTimings()")
zavreni = set()
for _ in range(12):
    time.sleep(1)
    zavreni.add(ev("window.__graf.getDataList().slice(-1)[0].close"))
dvojky = dotazy('klines.*limit=2')
print('   poslední svíčka:', zavreni, '| dotazů na živou svíčku:', dvojky)
over(len(zavreni) > 1, 'živá svíčka se hýbe')
over(dvojky == 0, f'živá svíčka nejde dotazem ({dvojky} dotazů za 12 s)')
ev("history.back()")
time.sleep(1)

print('3) pozadí')
nastav = lambda stav: ev(f"""Object.defineProperty(document, 'visibilityState', {{ configurable: true, get: () => '{stav}' }});
  document.dispatchEvent(new Event('visibilitychange'))""")
nastav('hidden')
time.sleep(6)  # zavírací handshake s Binance trvá 2–3 s
otevrene = [x for x in proudy() if not x['zavreno']]
print('   otevřené na pozadí:', len(otevrene))
over(not otevrene, 'na pozadí se proud zavře')
nastav('visible')
time.sleep(6)
otevrene = [x for x in proudy() if not x['zavreno']]
over(len(otevrene) == 1, f'po návratu jeden otevřený proud ({len(otevrene)})')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
