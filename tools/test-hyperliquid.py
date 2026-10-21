# -*- coding: utf-8 -*-
"""
Hyperliquid v aplikaci (v0.60.0) — připojení adresou peněženky, naostro.

Účet na Hyperliquidu je veřejný, takže test jde proti skutečné burze bez
klíčů: adresa z HL_ADRESA, jinak vybere z veřejného žebříčku účet
s pozicemi, TP/SL a obchody za poslední týden. Bybit je podstrčený
(tools/mock-bybit.js pouští ostatní burzy do sítě).

1) Nastavení → Burzy → Hyperliquid → Připojit: formulář chce jen adresu
   (žádný secret), nesmysl odmítne srozumitelnou hláškou.
2) Po uložení jsou v Pozicích i pozice Hyperliquidu (páry v USDC, štítek
   účtu), s fundingem po hodinách; přehled účtu sčítá oba účty.
3) Graf pozice Hyperliquidu: svíčky, živá svíčka z proudu burzy, čáry.
4) Historie účtu Hyperliquid: uzavřené obchody.
5) Odpojení: pozice Hyperliquidu zmizí, Bybit běží dál.

Spuštění: python tools/test-hyperliquid.py http://localhost:8080/index.html
"""
import os, sys, time, json, urllib.request
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()


def adresa_hyperliquid():
    if os.environ.get('HL_ADRESA'):
        return os.environ['HL_ADRESA']

    def dotaz(url, telo=None):
        req = urllib.request.Request(url, data=json.dumps(telo).encode() if telo else None,
                                     headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'})
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    radky = dotaz('https://stats-data.hyperliquid.xyz/Mainnet/leaderboard').get('leaderboardRows', [])
    radky.sort(key=lambda r: -float(r.get('accountValue') or 0))
    ted = int(time.time() * 1000)
    for r in radky[:300]:
        a = r['ethAddress']
        info = lambda typ, **x: dotaz('https://api.hyperliquid.xyz/info', {'type': typ, 'user': a, **x})
        if not info('clearinghouseState').get('assetPositions'):
            continue
        if any('Close' in f.get('dir', '') for f in info('userFillsByTime', startTime=ted - 7 * 864 * 10 ** 5)):
            return a
    return ''


ADRESA = adresa_hyperliquid()
if not ADRESA:
    raise SystemExit('Nenašel jsem veřejný účet Hyperliquidu s pozicemi a obchody')
print('veřejný účet', ADRESA[:6] + '…' + ADRESA[-4:])

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
# Počítadla: zprávy proudu Hyperliquidu podle kanálu, dotazy /info podle typu.
SLEDOVANI = r"""(() => {
  window.__hlProud = {}; window.__hlInfo = {};
  const W = window.WebSocket;
  window.WebSocket = function (url, ...x) {
    const ws = new W(url, ...x);
    if (String(url).includes('hyperliquid')) ws.addEventListener('message', (e) => {
      const k = (String(e.data).match(/"channel":"(\w+)"/) || [])[1] || '?';
      window.__hlProud[k] = (window.__hlProud[k] || 0) + 1;
    });
    return ws;
  };
  window.WebSocket.prototype = W.prototype;
  Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
  const f = window.fetch;
  window.fetch = function (v, o) {
    const u = String(v && v.url ? v.url : v);
    if (u.includes('api.hyperliquid.xyz/info')) {
      try {
        const b = JSON.parse(o && o.body || '{}');
        const t = b.type === 'candleSnapshot' ? `candleSnapshot:${b.req && b.req.coin}` : b.type;
        window.__hlInfo[t] = (window.__hlInfo[t] || 0) + 1;
      } catch {}
    }
    return f.apply(this, arguments);
  };
})();"""
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock + SLEDOVANI)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)


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


viditelne = lambda id_: ev(f"(() => {{ const e = document.getElementById('{id_}'); return !!e && !e.closest('[hidden]') && e.offsetParent !== null; }})()")

print('1) připojení adresou')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
ev("document.querySelector('#exchangeList .exchange-blok[data-burza=hyperliquid] button').click()")
time.sleep(0.8)
over(not viditelne('apiSecret'), 'formulář Hyperliquidu nemá pole secret')
over(ev("document.getElementById('apiKeyLabel').textContent") == 'Wallet address', 'popisek pole je „Wallet address"')
over(viditelne('helpHyperliquid') and not viditelne('helpBybit'), 'návod pro Hyperliquid, ne pro Bybit')
ev("document.getElementById('apiKey').value = 'muj-klic-123'; document.getElementById('testBtn').click()")
time.sleep(1)
hlaska = ev("document.getElementById('settingsMsg').textContent") or ''
over('0x' in hlaska, f'nesmysl místo adresy odmítnut srozumitelně („{hlaska[:60]}")')
ev(f"document.getElementById('apiKey').value = '{ADRESA}'; document.getElementById('saveBtn').click()")
time.sleep(12)
over(not ev("document.documentElement.classList.contains('uvod')"), 'po uložení se okno zavřelo')
ulozene = json.loads(ev("localStorage.getItem('perpdesk.pripojeni')") or '[]')
hl = [x for x in ulozene if x.get('burza') == 'hyperliquid']
over(len(hl) == 1 and hl[0].get('apiKey') == ADRESA and not hl[0].get('apiSecret'), 'uloženo připojení s adresou bez secretu')

print('2) pozice Hyperliquidu v seznamu')
ev("document.querySelector('[data-tab=positions]').click()")
time.sleep(3)
karty = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.position')].map((k) => k.textContent))""") or '[]')
hl_karty = [k for k in karty if 'USDC' in k and 'Hyperliquid' in k]
print('   karet:', len(karty), '· Hyperliquid:', len(hl_karty))
over(len(hl_karty) >= 1, 'karty pozic Hyperliquidu se štítkem účtu')
over(any('/1h' in k or '/ 1h' in k or '1 h' in k for k in hl_karty), 'funding po hodinách na kartě')
over(any('Bybit' in k for k in karty), 'pozice Bybitu dál v seznamu')

print('3) graf pozice Hyperliquidu')
ev("[...document.querySelectorAll('.position')].find((k) => k.textContent.includes('Hyperliquid')).click()")
time.sleep(6)
graf = json.loads(ev("""JSON.stringify({ svic: window.__graf.getDataList().length,
  posledni: window.__graf.getDataList().slice(-1)[0]?.timestamp,
  cary: window.__graf.getOverlays().filter((o) => o.name === 'positionLine').length,
  hlavicka: document.querySelector('.chart-info, #chartInfo')?.textContent || '' })""") or '{}')
print('   ', graf)
over(graf.get('svic', 0) > 100, 'graf má svíčky')
over('Hyperliquid' in graf.get('hlavicka', ''), 'nad grafem burza Hyperliquid')
pred = ev("window.__graf.getDataList().slice(-1)[0]?.close")
time.sleep(8)
po = ev("window.__graf.getDataList().slice(-1)[0]?.close")
pocet_zive = ev("window.__graf.getDataList().length")
print('    živá svíčka:', pred, '→', po)
over(pocet_zive and pocet_zive >= graf.get('svic', 0), 'živá svíčka se do grafu zapisuje (nic se neztratilo)')
pred_info = json.loads(ev("JSON.stringify(window.__hlInfo)") or '{}')
time.sleep(20)
po_info = json.loads(ev("JSON.stringify(window.__hlInfo)") or '{}')
proud = json.loads(ev("JSON.stringify(window.__hlProud)") or '{}')
rozdil = {k: po_info.get(k, 0) - pred_info.get(k, 0) for k in po_info}
print('    proud:', proud, '· dotazy za 20 s:', rozdil)
over(proud.get('candle', 0) > 0, 'živá svíčka chodí proudem Hyperliquidu (candle)')
over(proud.get('activeAssetCtx', 0) > 0, 'ceny chodí proudem (activeAssetCtx)')
# Svíčky jiných párů smí jít (předčtení na pozadí), svíčky páru grafu ne.
coin_grafu = ev("(document.querySelector('#chartSymbol, .chart-symbol')?.textContent || '').replace(/USDC$/, '')") or ''
print('    pár grafu:', coin_grafu)
over(rozdil.get('metaAndAssetCtxs', 0) <= 1 and rozdil.get(f'candleSnapshot:{coin_grafu}', 0) <= 1
     and rozdil.get('allMids', 0) == 0,
     'graf se nedotazuje na ceny ani na své svíčky dokola (limit vah burzy)')
over(rozdil.get('clearinghouseState', 0) >= 3, 'pozice se obnovují dotazem (clearinghouseState)')
ev("history.back()")
time.sleep(1.5)

print('4) Historie účtu Hyperliquid')
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(2)
# Deník (v0.64.0): účet je filtr — vybrat Hyperliquid (je-li víc účtů).
ev("""(() => { const v = document.getElementById('journalAccount');
  const o = [...v.options].find((x) => x.textContent.includes('Hyperliquid'));
  if (o) { v.value = o.value; v.dispatchEvent(new Event('change')); } })()""")
time.sleep(10)
obchody = json.loads(ev("JSON.stringify([...document.querySelectorAll('.trade')].map((k) => k.textContent.slice(0, 80)))") or '[]')
print('   obchodů:', len(obchody), obchody[:2])
over(len(obchody) >= 1 and all('USDC' in o for o in obchody), 'Historie ukazuje uzavřené obchody Hyperliquidu')

print('5) odpojení')
ev("window.confirm = () => true")
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
ev("document.querySelector('#exchangeList .exchange-blok[data-burza=hyperliquid] .danger').click()")
time.sleep(3)
ev("document.querySelector('[data-tab=positions]').click()")
time.sleep(2)
karty = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.position')].map((k) => k.textContent))""") or '[]')
over(not any('USDC' in k and 'Hyperliquid' in k for k in karty), 'po odpojení pozice Hyperliquidu zmizely')
over(any('JUPUSDT' in k for k in karty), 'Bybit běží dál')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
