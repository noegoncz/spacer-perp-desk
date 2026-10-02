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
# SNIMEK=zahlavi: jen přehled pozic pro záhlaví na X (design/x-profil),
# s pozicemi v plusu, poměrem stran jako displej telefonu (393 × 870).
PRO_ZAHLAVI = os.environ.get('SNIMEK') == 'zahlavi'
if PRO_ZAHLAVI:
    CIL = os.path.join(KOREN, 'design', 'x-profil')
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
if PRO_ZAHLAVI:
    def k(sym, vel, pnl):
        # vstup vůči ceně tak, aby nerealizovaný zisk long pozice byl `pnl` USDT
        return (ceny[sym] - pnl / vel) / ceny[sym]
    NAVRH = [
        ('BTCUSDT', 'Buy', 0.05, k('BTCUSDT', 0.05, 47.3), 0.985, 1.03, 1),
        ('ETHUSDT', 'Buy', 1.2, k('ETHUSDT', 1.2, 136.8), 0.96, 1.07, 2),
        ('WLDUSDT', 'Buy', 1500, k('WLDUSDT', 1500, -7.4), 0.93, 1.15, 4),
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

# Uzavřený obchod na BTC pro snímek Historie: dva nákupy u dna, prodej
# u vrcholu — ze skutečných svíček, aby značky seděly na grafu. Leží před
# plněními současné pozice (52 h a 19 h zpátky), takže se nepletou.
dno_h = min(svicky[-44:-30], key=lambda s: s[2])
dno_h2 = min(svicky[-30:-24], key=lambda s: s[2])
vrch_h = max(svicky[-24:-14], key=lambda s: s[1])
nakupy_h = [(dno_h[0], round(dno_h[2] + 0.15 * (dno_h[1] - dno_h[2]), 1), 0.03),
            (dno_h2[0], round(dno_h2[2] + 0.2 * (dno_h2[1] - dno_h2[2]), 1), 0.02)]
prodej_h = (vrch_h[0] + 3600000, round(vrch_h[1] - 0.15 * (vrch_h[1] - vrch_h[2]), 1))
vstup_h = sum(c * q for _, c, q in nakupy_h) / 0.05
uzavrene = [{
    'symbol': 'BTCUSDT', 'orderId': 'hist-btc', 'side': 'Sell', 'qty': '0.05', 'closedSize': '0.05',
    'avgEntryPrice': f'{vstup_h:.1f}', 'avgExitPrice': str(prodej_h[1]),
    'closedPnl': f'{(prodej_h[1] - vstup_h) * 0.05:.4f}', 'cumEntryValue': f'{vstup_h * 0.05:.2f}',
    'leverage': '5', 'createdTime': str(prodej_h[0]), 'updatedTime': str(prodej_h[0] + 19),
}]

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

# Alarm na BTC kousek nad aktuální cenou — kvůli snímku okna alarmu.
alarm_cena = round(ceny['BTCUSDT'] * 1.012, 1)
alarmy_data = [{'id': 'snimek1', 'symbol': 'BTCUSDT', 'typ': 'cena', 'price': alarm_cena,
                'smer': 'up', 'opakovat': False, 'platnostDnu': 7, 'aktivni': True, 'zprava': 'Breakout'}]

# Kategorie z webu (stejný soubor, který si stáhne aplikace tlačítkem
# Identify coins) a dva seznamy, ať jsou na snímku Trhů vidět.
kategorie = json.load(urllib.request.urlopen(urllib.request.Request(
    'https://perpyx.com/data/kategorie.json', headers={'User-Agent': 'Mozilla/5.0'}), timeout=15))
kategorie['stazeno'] = TED
seznamy = {'verze': 1, 'aktivni': 'fav', 'seznamy': [
    {'id': 'fav', 'nazev': 'My watchlist', 'polozky': ['bybit:' + s for s in (
        'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT', 'HYPEUSDT',
        'TAOUSDT', 'LINKUSDT', 'AVAXUSDT', 'PEPEUSDT' if False else '1000PEPEUSDT')]},
    {'id': 'ai', 'nazev': 'AI plays', 'polozky': ['bybit:' + s for s in (
        'TAOUSDT', 'FETUSDT', 'WLDUSDT', 'RENDERUSDT', 'VIRTUALUSDT')]},
]}

for i, (cas, cena, mnozstvi) in enumerate(nakupy_h):
    plneni.append({'symbol': 'BTCUSDT', 'side': 'Buy', 'execType': 'Trade', 'execPrice': str(cena),
                   'orderId': f'hist-buy-{i}', 'execQty': str(mnozstvi), 'execTime': str(cas + 1800000)})
plneni.append({'symbol': 'BTCUSDT', 'side': 'Sell', 'execType': 'Trade', 'execPrice': str(prodej_h[1]),
               'orderId': 'hist-btc', 'execQty': '0.05', 'execTime': str(prodej_h[0])})

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
  const POZICE = %(pozice)s, PRIKAZY = %(prikazy)s, PLNENI = %(plneni)s, UZAVRENE = %(uzavrene)s;
  localStorage.setItem('perpdesk.apiKey', 'UKAZKA-BEZ-KLICE');
  localStorage.setItem('perpdesk.apiSecret', 'UKAZKA-BEZ-KLICE');
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL', 'EMA', 'RSI']));
  localStorage.setItem('perpdesk.favourites', JSON.stringify(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'WLDUSDT']));
  localStorage.setItem('perpdesk.drawings.BTCUSDT', JSON.stringify(%(kresby)s));
  // Aplikace od v0.23 chce účet; podstrčený (volání perpyx.com/api se
  // zachytí níž). Upozornění a bublina hlášení na snímky nepatří.
  localStorage.setItem('perpdesk.session', JSON.stringify({ token: '0'.repeat(64), email: 'demo@perpyx.com' }));
  localStorage.setItem('perpdesk.disclaimerSeen', '1');
  localStorage.setItem('perpdesk.alarms', JSON.stringify(%(alarmy)s));
  localStorage.setItem('perpdesk.coinCategories', JSON.stringify(%(kategorie)s));
  localStorage.setItem('perpdesk.lists', JSON.stringify(%(seznamy)s));
  localStorage.removeItem('perpdesk.layers');
  const bezBubliny = document.createElement('style');
  bezBubliny.textContent = '#feedbackBtn { display: none !important; }';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(bezBubliny));
  const ok = (t) => Promise.resolve(new Response(JSON.stringify(t),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const skutecny = window.fetch.bind(window);
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    const q = new URL(u, location.origin).searchParams;
    // Hlídač „žije" — jinak by okno alarmu psalo, že server není dostupný.
    if (u.includes('perpyx.com/api/')) return ok({ ok: true, alarms: [], watcherSeen: new Date().toISOString() });
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
    if (u.includes('/v5/position/closed-pnl')) return ok({ retCode: 0, result: { list: UZAVRENE } });
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
  // Push jako v APK (podstrčený), ať aplikace ví, že alarmy hlídá server.
  const posl = {};
  window.Capacitor = { isNativePlatform: () => true, Plugins: { PushNotifications: {
    createChannel: async () => {},
    checkPermissions: async () => ({ receive: 'granted' }),
    requestPermissions: async () => ({ receive: 'granted' }),
    addListener: async (j, fn) => { (posl[j] ||= []).push(fn); return { remove() {} }; },
    register: async () => { setTimeout(() => (posl.registration || []).forEach((f) => f({ value: 'snimky' })), 20); },
  } } };
  // Instance grafu do window.__graf (kvůli klepnutí na hladinu alarmu).
  (function cekej() {
    if (!window.klinecharts || !window.klinecharts.init) return setTimeout(cekej, 50);
    const puvodni = window.klinecharts.init;
    window.klinecharts.init = function (...a) { return (window.__graf = puvodni.apply(this, a)); };
  })();
})();
""" % {'pozice': json.dumps(pozice), 'prikazy': json.dumps(prikazy),
       'plneni': json.dumps(plneni), 'kresby': json.dumps(kresby),
       'alarmy': json.dumps(alarmy_data), 'kategorie': json.dumps(kategorie),
       'seznamy': json.dumps(seznamy), 'uzavrene': json.dumps(uzavrene)}

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
if PRO_ZAHLAVI:
    spust(393, 870)
    snimek('pozice-zahlavi.webp')
    sys.exit(0)
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

# 5) Okno alarmu na rozevřeném Foldu — klepnutím na hladinu alarmu
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
y = ev("""(() => { const v = document.getElementById('drawLayer').getBoundingClientRect();
  const yy = window.__graf.convertToPixel({ value: %s }, { paneId: 'candle_pane' });
  return v.top + (Array.isArray(yy) ? yy[0].y : yy.y); })()""" % alarm_cena)
bod = [{'x': 300, 'y': y, 'radiusX': 10, 'radiusY': 10, 'force': 1, 'id': 1}]
p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
time.sleep(0.05)
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
time.sleep(1.2)
print('okno alarmu:', ev("!document.getElementById('sheetAlarm').hidden"))
snimek('alarm.webp')

# 6) Historie: uzavřený obchod v grafu se značkami nákupů a prodeje
spust(412, 880)
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(4)
ev("document.querySelector('.trade') && document.querySelector('.trade').click()")
time.sleep(7)
print('graf obchodu:', ev("!document.getElementById('viewChart').hidden"))
snimek('historie.webp')

print('chyby:', ev('(window.__chyby||[]).join(" | ")'))
