# -*- coding: utf-8 -*-
"""
Výběr burzy v aplikaci (v0.54.0).

1) Úvodní obrazovka bez klíče: Binance jde vybrat, ukáže se volba Demo
   Tradingu a návod pro Binance (Bybit ho skryje).
2) Zkouška vymyšleného klíče Binance skončí srozumitelnou chybou,
   aplikace nespadne a nic se neuloží.
3) S uloženou volbou Binance (zatím bez klíče) aplikace bere veřejná data
   ze **skutečného Binance** přes CCXT: dlaždice ve Watchlists nesou BINANCE
   a ceny, graf má svíčky.

Spuštění: python tools/test-vyber-burzy.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
predem = """
sessionStorage.setItem('__bezKlice', '1');
if (sessionStorage.getItem('__binance')) {
  localStorage.setItem('perpdesk.burza', 'binance');
  localStorage.setItem('perpdesk.exchangeSkipped', 'true');
  localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
    seznamy: [{ id: 'a', nazev: 'Main', polozky: ['bybit:BTCUSDT', 'bybit:ETHUSDT'] }] }));
}
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=predem + mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


print('1) úvodní obrazovka')
over(ev("!document.getElementById('onbExchange').hidden"), 'úvodní obrazovka s burzou je vidět')
over(ev("!document.querySelector('#onbExchange .exchange-btn[data-burza=binance]').disabled"), 'Binance jde vybrat (už ne „brzy“)')
over(ev("document.getElementById('exDemoRow').hidden"), 'u Bybitu volba Demo není')
ev("document.querySelector('#onbExchange .exchange-btn[data-burza=binance]').click()")
time.sleep(0.3)
over(ev("document.querySelector('#onbExchange .exchange-btn[data-burza=binance]').classList.contains('active')"), 'Binance je vybraný')
over(ev("!document.getElementById('exDemoRow').hidden && document.getElementById('helpBybit').hidden && !document.getElementById('helpBinance').hidden"),
     'u Binance je volba Demo a návod pro Binance')

print('2) vymyšlený klíč Binance')
ev("document.getElementById('apiKey').value = 'VYMYSLENY'; document.getElementById('apiSecret').value = 'VYMYSLENY'")
ev("document.getElementById('saveBtn').click()")
for _ in range(30):
    time.sleep(1)
    if not ev("document.getElementById('settingsMsg').hidden"):
        break
zprava = ev("document.getElementById('settingsMsg').textContent") or ''
print('   hláška:', zprava[:120])
over(zprava and ev("document.getElementById('settingsMsg').classList.contains('fail')"), 'neplatný klíč hlásí chybu')
over(not ev("localStorage.getItem('perpdesk.apiKey')") and not ev("localStorage.getItem('perpdesk.burza')"), 'nic se neuložilo')

print('3) aplikace s Binance bez klíče — veřejná data ze skutečné burzy')
ev("sessionStorage.setItem('__binance', '1')")
p.prikaz('Page.reload')
time.sleep(6)
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
for _ in range(25):
    time.sleep(1)
    if ev("[...document.querySelectorAll('#watchList .tile .tile-cena')].every((c) => c.textContent && c.textContent !== '—') && document.querySelectorAll('#watchList .tile').length === 2"):
        break
dl = json.loads(ev("""JSON.stringify([...document.querySelectorAll('#watchList .tile')].map((t) => ({
  s: t.dataset.symbol, burza: t.querySelector('.tile-burza').textContent, cena: t.querySelector('.tile-cena').textContent })))""") or '[]')
print('   dlaždice:', dl)
over(len(dl) == 2 and all(x['burza'] == 'BINANCE' and x['cena'] for x in dl), 'dlaždice nesou BINANCE a ceny z Binance')
over(ev("typeof window.ccxt !== 'undefined'"), 'knihovna CCXT se načetla (jen proto, že je zvolený Binance)')
ev("[...document.querySelectorAll('#watchList .tile')].find((t) => t.dataset.symbol === 'BTCUSDT').click()")
for _ in range(20):
    time.sleep(1)
    if (ev("window.__graf ? window.__graf.getDataList().length : 0") or 0) > 50:
        break
svic = ev("window.__graf ? window.__graf.getDataList().length : 0") or 0
posledni = ev("window.__graf ? window.__graf.getDataList().slice(-1)[0]?.close : null")
print(f'   graf BTCUSDT: {svic} svíček, poslední close {posledni}')
over(svic > 50 and posledni and posledni > 1000, 'graf má svíčky BTC z Binance')
info = ev("document.getElementById('chartInfo').textContent") or ''
print('   řádek nad grafem:', info[:80])
over(info.startswith('Binance'), 'řádek nad grafem uvádí Binance')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
ev("sessionStorage.removeItem('__binance')")
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
