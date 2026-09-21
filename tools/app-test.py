"""
Spustí aplikaci s podstrčenými odpověďmi Bybitu — bez API klíčů.

Umožňuje ověřit cesty v kódu, které se bez přihlášení vůbec nespustí:
vykreslení pozic, chování při chybě i při zaseknutém spojení. Právě tak
se našlo, že `fetch` bez časového limitu zmrazil aplikaci natrvalo.

Vyžaduje `tools/touch-test.py` ve stejné složce (třída Prohlizec).

Použití:
    python -m http.server 8075
    chrome --headless=new --remote-debugging-port=9222            --user-data-dir=/tmp/cdp --window-size=412,915 about:blank
    python tools/app-test.py http://localhost:8075/index.html
"""
import sys, time
from importlib.machinery import SourceFileLoader
import os

Prohlizec = SourceFileLoader(
    "touch_test", os.path.join(os.path.dirname(__file__), "touch-test.py")
).load_module().Prohlizec

url = sys.argv[1]
p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')

p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=r"""
window.__chyby = [];
window.addEventListener('error', (e) => window.__chyby.push(
  'error: ' + e.message + ' @ ' + (e.filename||'').split('/').pop() + ':' + e.lineno + ':' + e.colno));
window.addEventListener('unhandledrejection', (e) => window.__chyby.push(
  'slib: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

localStorage.setItem('perpdesk.apiKey','FAKEKEY1234567890ab');
localStorage.setItem('perpdesk.apiSecret','FAKESECRET1234567890abcdef');

// WebSocket nahradit tichou atrapou, ať se nepokouší o spojení
window.WebSocket = function () {
  this.readyState = 0;
  this.send = () => {};
  this.close = () => {};
};
window.WebSocket.OPEN = 1;

const pozice = {
  symbol: 'JUPUSDT', side: 'Buy', size: '3125', avgPrice: '0.27261',
  markPrice: '0.27960', unrealisedPnl: '21.52', liqPrice: '0.14516',
  leverage: '10', positionValue: '873.75', stopLoss: '0.265',
  takeProfit: '0.2858', positionIdx: 0,
};

const odpoved = (telo) => Promise.resolve(new Response(JSON.stringify(telo),
  { status: 200, headers: { 'Content-Type': 'application/json' } }));

window.fetch = (vstup) => {
  const u = String(vstup && vstup.url ? vstup.url : vstup);
  window.__chyby.push('fetch: ' + u.split('?')[0].split('bybit.com')[1]);
  if (u.includes('/v5/market/time')) {
    return odpoved({ retCode: 0, result: { timeNano: String(Date.now() * 1e6) }, time: Date.now() });
  }
  if (u.includes('/v5/position/list')) {
    return odpoved({ retCode: 0, result: { list: [pozice] } });
  }
  if (u.includes('/v5/order/realtime')) return odpoved({ retCode: 0, result: { list: [] } });
  if (u.includes('/v5/position/closed-pnl')) return odpoved({ retCode: 0, result: { list: [] } });
  if (u.includes('/v5/market/tickers')) return odpoved({ retCode: 0, result: { list: [] } });
  if (u.includes('/v5/market/kline')) return odpoved({ retCode: 0, result: { list: [] } });
  return odpoved({ retCode: 0, result: {} });
};
""")

p.prikaz('Page.navigate', url=url)
time.sleep(6)

print('verze:            ', p.js("document.getElementById('versionLabel').textContent"))
print('placeholder:      ', p.js("document.getElementById('placeholderText').textContent"))
print('placeholder vidět:', p.js("!document.getElementById('placeholder').hidden"))
print('karet pozic:      ', p.js("document.querySelectorAll('.position').length"))
print('souhrn PnL:       ', p.js("document.getElementById('totalPnl').textContent"))
print('chybová lišta:    ', p.js("document.getElementById('errorBar').hidden ? '(skrytá)' "
                                 ": document.getElementById('errorBar').textContent"))
print()
zaznam = p.js('(window.__chyby||[]).join("\\n")') or ''
volani = [r for r in zaznam.split('\n') if r.startswith('fetch:')]
chyby = [r for r in zaznam.split('\n') if r and not r.startswith('fetch:')]
print('volání na Bybit:  ', ', '.join(v.replace('fetch: ', '') for v in volani) or '(žádné)')
print()
print('ZACHYCENÉ CHYBY:')
print('\n'.join('  ' + c for c in chyby) if chyby else '  (žádné)')
