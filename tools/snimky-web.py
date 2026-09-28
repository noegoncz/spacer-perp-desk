# -*- coding: utf-8 -*-
"""
Snímky aplikace pro webovou stránku (web/public/img/, WebP).

Veřejná data jdou **ze skutečného Bybitu** (svíčky, tickery, seznam trhů),
takže grafy vypadají jako doopravdy. Soukromá data (pozice, účet, příkazy,
plnění, funding) jsou **vymyšlená** kolem aktuálních cen — žádný API klíč
se nepoužívá a nic ze skutečného účtu se na snímky nedostane.

Spuštění (Chrome s čistým profilem na portu 9223, viz tools/README.md):
    python tools/snimky-web.py http://localhost:8075/index.html
"""
import os, sys, time, json, base64, urllib.request
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

URL = sys.argv[1]
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CIL = os.path.join(KOREN, 'web', 'public', 'img')
os.makedirs(CIL, exist_ok=True)


def bybit(cesta):
    return json.load(urllib.request.urlopen('https://api.bybit.com' + cesta, timeout=15))['result']


ceny = {s: float(bybit(f'/v5/market/tickers?category=linear&symbol={s}')['list'][0]['lastPrice'])
        for s in ('BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT')}
print('ceny:', ceny)

# Svíčky BTC (4h) — podle nich se rozmístí úrovně pozice a kresby, aby
# byly v grafu vidět (po otevření je vidět zhruba posledních 48 svíček).
svicky = bybit('/v5/market/kline?category=linear&symbol=BTCUSDT&interval=240&limit=200')['list']
svicky = [(int(s[0]), float(s[2]), float(s[3])) for s in reversed(svicky)]  # čas, high, low
okno = svicky[-46:]
dno, vrch = min(s[2] for s in okno), max(s[1] for s in okno)
rozpeti = vrch - dno
btc_vstup = dno + 0.30 * rozpeti

# (pár, strana, velikost, vstup vůči ceně, SL, TP vůči vstupu, desetinná místa)
NAVRH = [
    ('BTCUSDT', 'Buy', 0.05, btc_vstup / ceny['BTCUSDT'],
     (dno + 0.06 * rozpeti) / btc_vstup, (vrch - 0.06 * rozpeti) / btc_vstup, 1),
    ('ETHUSDT', 'Buy', 0.8, 1.012, 0.965, 1.06, 2),
    ('SOLUSDT', 'Sell', 12, 1.025, 1.03, 0.92, 3),
    ('WLDUSDT', 'Buy', 1500, 0.955, 0.93, 1.17, 4),
]
TED = int(time.time() * 1000)
pozice, prikazy, plneni = [], [], []
for sym, strana, vel, k, sl, tp, dm in NAVRH:
    mark = ceny[sym]
    vstup = round(mark * k, dm)
    smer = 1 if strana == 'Buy' else -1
    pozice.append({
        'symbol': sym, 'side': strana, 'size': str(vel), 'avgPrice': str(vstup),
        'markPrice': str(mark), 'unrealisedPnl': f'{(mark - vstup) * vel * smer:.4f}',
        'liqPrice': str(round(vstup * (1 - 0.19 * smer), dm)), 'leverage': '5',
        'positionValue': f'{vel * mark:.2f}', 'stopLoss': str(round(vstup * sl, dm)),
        'takeProfit': str(round(vstup * tp, dm)), 'positionIdx': 0,
        'createdTime': str(TED - 90 * 86400000),
    })
    # Dvě plnění, která pozici otevřela (dohromady přesně její velikost).
    for i, (hod, podil, odchylka) in enumerate(((52, 0.6, 1.004), (19, 0.4, 0.994))):
        plneni.append({'symbol': sym, 'side': strana, 'execType': 'Trade',
                       'execPrice': str(round(vstup * odchylka, dm)), 'orderId': f'{sym}-{i}',
                       'execQty': str(round(vel * podil, 6)), 'execTime': str(TED - hod * 3600000)})
    if sym == 'BTCUSDT':
        prikazy += [
            {'orderId': 'p1', 'symbol': sym, 'side': 'Sell', 'orderType': 'Market',
             'stopOrderType': 'PartialTakeProfit', 'triggerPrice': str(round(vrch - 0.3 * rozpeti, 1)),
             'qty': '0.02', 'cumExecQty': '0', 'reduceOnly': True, 'createdTime': str(TED - 7200000)},
            {'orderId': 'p2', 'symbol': sym, 'side': 'Buy', 'orderType': 'Limit',
             'price': str(round(dno + 0.14 * rozpeti, 1)), 'qty': '0.02', 'cumExecQty': '0',
             'reduceOnly': False, 'createdTime': str(TED - 3600000)},
        ]

# Kresby na BTC: trendová čára po dvou minimech a vodorovná úroveň u maxima.
starsi = min(svicky[-44:-24], key=lambda s: s[2])
novejsi = min(svicky[-20:-4], key=lambda s: s[2])
maximum = max(okno, key=lambda s: s[1])
kresby = [
    {'name': 'segment', 'points': [{'timestamp': starsi[0], 'value': starsi[2]},
                                   {'timestamp': novejsi[0], 'value': novejsi[2]}],
     'style': {'color': '#e6edf5', 'width': 1, 'opacity': 1}},
    {'name': 'horizontalStraightLine', 'points': [{'timestamp': maximum[0], 'value': maximum[1]}],
     'style': {'color': '#f5c542', 'width': 1, 'opacity': 1}},
]

podstrc = r"""
(() => {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = () => Promise.reject(new Error('snimky'));
    navigator.serviceWorker.getRegistrations().then((r) => r.forEach((x) => x.unregister())).catch(() => {});
  }
  // Knihovna grafu píše písmem „Helvetica Neue"; na Windows by místo něj
  // vyskočilo patkové. V telefonu se použije Roboto, tak i tady.
  const pismo = document.createElement('style');
  pismo.textContent = "@font-face { font-family: 'Helvetica Neue'; src: local('Roboto'), local('Segoe UI'); }";
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(pismo));
  const POZICE = %(pozice)s, PRIKAZY = %(prikazy)s, PLNENI = %(plneni)s;
  localStorage.setItem('perpdesk.apiKey', 'UKAZKA-BEZ-KLICE');
  localStorage.setItem('perpdesk.apiSecret', 'UKAZKA-BEZ-KLICE');
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL', 'EMA', 'RSI']));
  localStorage.setItem('perpdesk.favourites', JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT']));
  localStorage.setItem('perpdesk.drawings.BTCUSDT', JSON.stringify(%(kresby)s));
  const ok = (t) => Promise.resolve(new Response(JSON.stringify(t),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const skutecny = window.fetch.bind(window);
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    const q = new URL(u, location.origin).searchParams;
    if (u.includes('/v5/position/list')) return ok({ retCode: 0, result: { list: POZICE } });
    if (u.includes('/v5/order/realtime')) {
      const s = q.get('symbol');
      return ok({ retCode: 0, result: { list: PRIKAZY.filter((p) => !s || p.symbol === s) } });
    }
    if (u.includes('/v5/execution/list')) {
      const s = q.get('symbol'), od = Number(q.get('startTime')) || 0, az = Number(q.get('endTime')) || Date.now();
      return ok({ retCode: 0, result: { list: PLNENI.filter((e) => (!s || e.symbol === s)
        && +e.execTime >= od && +e.execTime <= az).sort((a, b) => b.execTime - a.execTime) } });
    }
    if (u.includes('/v5/account/wallet-balance')) {
      return ok({ retCode: 0, result: { list: [{ totalEquity: '4820.35', totalAvailableBalance: '3915.10',
        totalInitialMargin: '905.25', accountIMRate: '0.1878' }] } });
    }
    if (u.includes('/v5/account/transaction-log')) {
      const od = Number(q.get('startTime')), az = Number(q.get('endTime')), zaklad = q.get('baseCoin');
      const l = [];
      POZICE.forEach((p, i) => {
        if (zaklad && !p.symbol.startsWith(zaklad)) return;
        const otevreno = Date.now() - 52 * 3600e3;
        for (let t = Math.ceil(Math.max(od, otevreno) / 288e5) * 288e5; t < Math.min(az, Date.now()); t += 288e5) {
          l.push({ symbol: p.symbol, type: 'SETTLEMENT', currency: 'USDT',
            funding: String(-(0.00008 + i * 0.00002) * Number(p.positionValue)), transactionTime: String(t) });
        }
      });
      return ok({ retCode: 0, result: { list: l.slice(0, 50), nextPageCursor: '' } });
    }
    if (u.includes('/v5/position/closed-pnl')) return ok({ retCode: 0, result: { list: [] } });
    return skutecny(vstup, volby);
  };
  // Soukromý stream je vymyšlený (přihlášení vždy projde), veřejný jde na burzu.
  const PravyWS = window.WebSocket;
  window.WebSocket = function (url, ...zbytek) {
    if (!String(url).includes('/private')) return new PravyWS(url, ...zbytek);
    const ws = { url, readyState: 0, close() { this.readyState = 3; } };
    const odpovez = (m) => setTimeout(() => ws.onmessage && ws.onmessage({ data: JSON.stringify(m) }), 30);
    ws.send = (text) => {
      const m = JSON.parse(text);
      if (m.op === 'auth' || m.op === 'subscribe') odpovez({ op: m.op, success: true });
    };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); }, 60);
    return ws;
  };
  window.WebSocket.OPEN = 1;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.CLOSED = 3;
})();
""" % {'pozice': json.dumps(pozice), 'prikazy': json.dumps(prikazy),
       'plneni': json.dumps(plneni), 'kresby': json.dumps(kresby)}

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return None if 'exceptionDetails' in r else r.get('result', {}).get('value')


def snimek(nazev):
    data = p.prikaz('Page.captureScreenshot', format='webp', quality=90)['data']
    with open(os.path.join(CIL, nazev), 'wb') as f:
        f.write(base64.b64decode(data))
    print('uloženo', nazev)


def spust(sirka, vyska):
    p.prikaz('Emulation.setDeviceMetricsOverride', width=sirka, height=vyska,
             deviceScaleFactor=2, mobile=True)
    p.prikaz('Page.navigate', url=URL)
    time.sleep(9)


p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=podstrc)

# 1) Přehled pozic
spust(412, 880)
snimek('pozice.webp')

# 2) Graf BTC s kresbami a indikátory
ev("""[...document.querySelectorAll('.position')].find((k) => k.textContent.includes('BTCUSDT')).click()""")
time.sleep(6)
snimek('graf.webp')

# 3) Trhy
ev("history.back()")
time.sleep(1)
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(7)
snimek('trhy.webp')

# 4) Graf na rozevřeném Foldu
spust(673, 841)
ev("""[...document.querySelectorAll('.position')].find((k) => k.textContent.includes('BTCUSDT')).click()""")
time.sleep(6)
snimek('graf-fold.webp')

print('chyby:', ev('(window.__chyby||[]).join(" | ")'))
