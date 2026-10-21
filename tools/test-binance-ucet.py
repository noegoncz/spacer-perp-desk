# -*- coding: utf-8 -*-
"""
Účet Binance: TP/SL v grafu, chyby po návratu do aplikace, Historie
(v0.59.4, snímky uživatele 2026-10-16 se skutečným obchodem JUPUSDT).

Soukromé API Binance je podstrčené (tools/mock-binance.js), veřejná data
jdou ze skutečné burzy. Ověřuje:
  1) TP/SL ze služby Algo Orders jsou v grafu i na kartě pozice
     (dřív jen likvidace — TP/SL Binance od konce 2025 v běžném dotazu
     na příkazy nejsou); „Position TP/SL" (closePosition) je SL/TP pozice.
  2) Odmítnutí kvůli času (-1021) po návratu z jiné aplikace se potichu
     zopakuje — v grafu žádná hláška; a když chyba trvá, hláška je
     přeložená, bez adresy dotazu a podpisu.
  3) Přepnutí Historie na Binance a zpět: uložená historie Bybitu
     zůstane (dřív ji jiný klíč smazal), hlavní vlákno nezamrzá.
Na starém kódu padá v bodech 1–3.

Spuštění: python tools/test-binance-ucet.py http://localhost:8075/index.html
"""
import os, re, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += open(os.path.join(KOREN, 'tools', 'mock-binance.js'), encoding='utf-8').read()
mock += """
window.__dlouhe = [];
try {
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__dlouhe.push(Math.round(e.duration))))
    .observe({ type: 'longtask', buffered: true });
} catch (e) {}
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


# Bybit z mocku + Binance (vymyšlený klíč, soukromá data podstrčená).
ev("""(() => { const s = JSON.parse(localStorage.getItem('perpdesk.pripojeni') || '[]');
  s.push({ id: 'bn', burza: 'binance', volby: {}, apiKey: 'BINANCEKLIC0001', apiSecret: 'TAJNE' });
  localStorage.setItem('perpdesk.pripojeni', JSON.stringify(s)); })()""")
p.prikaz('Page.reload')
time.sleep(9)

print('1) TP/SL Binance')
karta = ev("""(() => { const k = [...document.querySelectorAll('.position')].find((x) => /binance/i.test((x.querySelector('.pos-burza') || {}).textContent || ''));
  return k ? k.textContent.replace(/\\s+/g, ' ') : null; })()""")
print('   karta:', (karta or '')[:220])
over(karta and 'JUPUSDT' in karta, 'karta pozice Binance JUPUSDT')
over(karta and 'SL —' not in karta and 'TP —' not in karta, 'karta má SL i TP (ne „—")')
ev("""[...document.querySelectorAll('.position')].find((x) => /binance/i.test((x.querySelector('.pos-burza') || {}).textContent || '')).click()""")
time.sleep(5)
cary = json.loads(ev("""JSON.stringify(window.__graf.getOverlays().filter((o) => o.name === 'positionLine')
  .map((o) => ({ t: o.extendData.title, c: o.points[0].value })))""") or '[]')
print('   čáry:', cary)
ceny = sorted(round(c['c'], 4) for c in cary)
for cena, popis in ((2.0, 'TP 2.0'), (0.5464, 'TP 0.5464'), (0.2607, 'SL 0.2607'), (1.0, 'TP pozice 1.0'),
                    (0.1, 'SL pozice 0.1'), (0.28, 'limitka 0.28'), (0.0494, 'likvidace')):
    over(any(abs(c - cena) < 0.0002 for c in ceny), f'v grafu je {popis}')
over(sum(1 for c in ceny if abs(c - 1.0) < 1e-6) == 1, 'TP pozice jen jednou (příkaz i vlastnost pozice = jedna čára)')
over(not ev("!document.getElementById('chartError').hidden"), 'v grafu žádná chyba')

print('2) -1021 po návratu z jiné aplikace')
ev("history.back()")
time.sleep(1)
ev("window.__binanceChyba1021 = 1; window.__binanceDotazy = []")
ev("""[...document.querySelectorAll('.position')].find((x) => /binance/i.test((x.querySelector('.pos-burza') || {}).textContent || '')).click()""")
time.sleep(5)
chyba = ev("document.getElementById('chartError').hidden ? '' : document.getElementById('chartError').textContent")
print('   hláška:', repr(chyba), '| dotazy na příkazy:', [d for d in (ev('window.__binanceDotazy') or []) if 'Orders' in d])
over(not chyba, 'jednorázové -1021 se potichu zopakovalo (žádná hláška)')
plneni = len([d for d in (ev('window.__binanceDotazy') or []) if d.endswith('/userTrades')])
over(plneni <= 27, f'plnění jen za 6 měsíců, co Binance vydá ({plneni} dotazů po 7 dnech)')
over(any(abs(c['c'] - 0.2607) < 1e-4 for c in json.loads(ev("""JSON.stringify(window.__graf.getOverlays()
  .filter((o) => o.name === 'positionLine').map((o) => ({ c: o.points[0].value })))""") or '[]')), 'TP/SL v grafu i po opakování')
ev("history.back()")
time.sleep(1)
ev("window.__binanceChyba1021 = 20")
ev("""[...document.querySelectorAll('.position')].find((x) => /binance/i.test((x.querySelector('.pos-burza') || {}).textContent || '')).click()""")
time.sleep(6)
chyba = ev("document.getElementById('chartError').hidden ? '' : document.getElementById('chartError').textContent") or ''
print('   trvalá chyba:', repr(chyba))
over(chyba and not any(x in chyba.lower() for x in ('binanceusdm', 'http', 'signature', '{')),
     'trvalá chyba je přeložená, bez adresy a podpisu')
ev("window.__binanceChyba1021 = 0")
ev("history.back()")
time.sleep(1)

print('2b) z grafu Bybitu na graf Binance: žádné čáry z Bybitu (v0.59.6)')
KARTA = "[...document.querySelectorAll('.position')].find((x) => {burza}.test((x.querySelector('.pos-burza') || {{}}).textContent || '')).click()"
ev(KARTA.format(burza='/bybit/i'))
time.sleep(4)
ev("history.back()")
time.sleep(1)
ev("window.__binanceZdrzeniPrikazu = 2500")
ev(KARTA.format(burza='/binance/i'))
cizi = set()
for _ in range(40):
    time.sleep(0.05)
    for c in json.loads(ev("""JSON.stringify(window.__graf.getOverlays().filter((o) => o.name === 'positionLine')
      .map((o) => ({ t: o.extendData.title, c: o.points[0].value })))""") or '[]'):
        if '2,547' in c['t'] or abs(c['c'] - 0.30135) < 1e-6 or abs(c['c'] - 0.285) < 1e-6:
            cizi.add(f"{c['t']} @ {c['c']}")
print('   čáry z Bybitu na grafu Binance:', cizi or 'žádné')
over(not cizi, 'na grafu Binance se ani na okamžik neobjevily čáry pozice z Bybitu')
ev("window.__binanceZdrzeniPrikazu = 0")
time.sleep(3)
ev("history.back()")
time.sleep(1)

print('3) Deník: filtr účtu (v0.64.0, dřív lišta účtů)')


def vyber_ucet(binance):
    # Filtr účtu v deníku je výběr (select) — vybrat účet Binance / Bybit.
    ev(f"""(() => {{ const v = document.getElementById('journalAccount');
      const o = [...v.options].find((x) => x.value !== 'all' && /binance/i.test(x.textContent) === {'true' if binance else 'false'});
      v.value = o.value; v.dispatchEvent(new Event('change')); }})()""")


ev("document.querySelector('.tab[data-tab=history]').click()")
time.sleep(4)
ucty = ev("[...document.querySelectorAll('#journalAccount option')].map((o) => o.textContent)") or []
print('   účty:', ucty)
ulozeno_pred = ev("""new Promise((ok) => { const r = indexedDB.open('perpyx-mezipamet'); r.onsuccess = () => {
  const q = r.result.transaction('data').objectStore('data').getAllKeys(); q.onsuccess = () => ok(q.result.map(String)); }; })""") or []
print('   mezipaměť před:', ulozeno_pred)
ev("window.__dlouhe = []")
vyber_ucet(True)
t0 = time.time()
pozn = ''
for _ in range(60):
    time.sleep(0.25)
    pozn = ev("document.getElementById('historyNote').textContent") or ''
    if pozn and 'Loading' not in pozn:
        break
print(f'   Binance: „{pozn}“ za {time.time() - t0:.1f} s, dlouhé úlohy: {ev("window.__dlouhe")}')
over(pozn and 'Loading' not in pozn, 'Historie Binance se načetla')
over(max(ev("window.__dlouhe") or [0]) < 300, 'hlavní vlákno nezamrzlo (žádná úloha nad 300 ms)')
vyber_ucet(False)
time.sleep(4)
ulozeno_po = ev("""new Promise((ok) => { const r = indexedDB.open('perpyx-mezipamet'); r.onsuccess = () => {
  const q = r.result.transaction('data').objectStore('data').getAllKeys(); q.onsuccess = () => ok(q.result.map(String)); }; })""") or []
print('   mezipaměť po:', ulozeno_po)
hist = [k for k in ulozeno_po if k.endswith('|historie')]
over(len(hist) >= 2, f'historie obou účtů zůstala v telefonu ({len(hist)} oddíly)')

print('3b) obchod z Binance ukazuje jen svá plnění, i po přepnutí za běhu (v0.59.11)')
# Historie Bybitu stahuje plnění pomalu; uprostřed přepnutí na Binance.
ev("""(() => { const f = window.fetch; window.fetch = function (v, o) { const u = String(v && v.url ? v.url : v);
  if (/execution\/list/.test(u) && window.__pomalyBybit) return new Promise((ok) => setTimeout(ok, 3000)).then(() => f.call(this, v, o));
  return f.call(this, v, o); }; })()""")
vyber_ucet(False)
time.sleep(0.3)
ev("window.__pomalyBybit = true; document.querySelector('#historyMore') && document.getElementById('refreshBtn').click()")
time.sleep(0.5)
vyber_ucet(True)
time.sleep(5)
ev("window.__pomalyBybit = false")
# Smíchaná data se projeví při čtení z telefonu → přenačíst a otevřít Historii Binance.
p.prikaz('Page.reload')
time.sleep(8)
ev("document.querySelector('.tab[data-tab=history]').click()")
time.sleep(2)
vyber_ucet(True)
time.sleep(6)
karta = ev("[...document.querySelectorAll('#historyList .trade')].map((k) => k.textContent.replace(/\s+/g, ' ')).join(' || ')") or ''
print('   Historie Binance:', karta[:220])
over('JUPUSDT' in karta, 'Historie Binance má obchody JUPUSDT')
# Binance dává realizedPnl bez poplatků, jeho Position History s nimi
# (uživatel 2026-10-18: −0.42 vs −0.44). Mock: zisk 0.2, poplatky 0.02 + 0.03.
uzavreny = next((x for x in karta.split(' || ') if 'JUPUSDT' in x and 'Open' not in x), '')
over('Total+0.15' in uzavreny, f'uzavřený obchod po poplatcích otevření i zavření (+0.15): {uzavreny[-60:]}')
ev("[...document.querySelectorAll('#historyList .trade')].find((k) => /JUPUSDT/.test(k.textContent) && !k.classList.contains('otevreny')).click()")
time.sleep(5)
znacky = ev("window.__graf.getOverlays().filter((o) => o.name === 'tradeMark').map((o) => o.extendData.title || '').join(',')") or ''
print('   značky v prohlídce:', znacky)
over(znacky.split(',') == ['I1', 'O1'] or sorted(znacky.split(',')) == ['I1', 'O1'], 'v prohlídce jen jeden vstup a jeden výstup (ne plnění z Bybitu)')
ev("history.back()")
time.sleep(1)
klice = ev("""new Promise((ok) => { const r = indexedDB.open('perpyx-mezipamet'); r.onsuccess = () => {
  const q = r.result.transaction('data').objectStore('data').getAllKeys(); q.onsuccess = () => ok(q.result.map(String)); }; })""") or []
bn = [k for k in klice if k.endswith('|plneni:JUPUSDT')]
print('   uložená plnění JUP:', bn)

print('5) funding Binance (v0.59.8)')
ev("document.querySelector('.tab[data-tab=positions]').click()")
fund = ''
for _ in range(30):
    time.sleep(1)
    fund = ev("""(() => { const k = [...document.querySelectorAll('.position')].find((x) => /binance/i.test((x.querySelector('.pos-burza') || {}).textContent || ''));
      const f = k && k.querySelector('.pos-funding'); return f ? f.textContent.replace(/\s+/g, ' ') : ''; })()""") or ''
    if 'Total' in fund:
        break
print('   funding:', fund, '| dotazy:', ev('window.__binanceIncome'))
# Interval je skutečný z Binance (/fapi/v1/fundingInfo, JUP má 4 h) — jen že tam je.
over('Funding' in fund and re.search(r'%/\d+ h', fund), 'karta Binance má sazbu fundingu s intervalem')
over('Next' in fund and 'Day' in fund, 'příští stržení a denní částka')
# 9 stržení po 0.002 od otevření; první 8 h po otevření → doba „2 d".
over('Total' in fund and '−0.02' in fund and '(2 d' in fund, 'zaplacený funding od otevření (9 × −0.002)')
over(all('endTime=' in x for x in (ev('window.__binanceIncome') or ['x'])), 'deník fundingu se ptá po oknech (endTime)')
ev("document.querySelector('.tab[data-tab=history]').click()")
time.sleep(2)

print('4) podzáložky deníku jako seznamy ve Watchlists (v0.64.0)')


def prejed(x1, x2, y):
    bod = lambda x: [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x1))
    for i in range(1, 11):
        p.prikaz('Input.dispatchTouchEvent', type='touchMove', touchPoints=bod(x1 + (x2 - x1) * i / 10))
        time.sleep(0.012)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(1.5)


pohled = lambda: ev("(document.querySelector('#journalTabs .list-tab.active') || {}).dataset?.id")
zalozka = lambda: ev("document.querySelector('.tab.active')?.dataset.tab")
over(ev("document.querySelector('.tabs').classList.contains('s-podzalozkami')"), 'deník: záložka napojená na podmenu')
over(ev("!!document.querySelector('#journalTabs .watch-lists-pas .list-ukazatel')"), 'lišta podzáložek má ukazatel jako seznamy')
print('   podzáložka:', pohled())
prejed(80, 330, 600)
print('   po přejetí doprava:', pohled(), zalozka())
over(zalozka() == 'history' and pohled() == 'edge', 'přejetí doprava z Trades → Edge')
over(not ev("document.getElementById('journalEdge').hidden") and ev("document.getElementById('journalTrades').hidden"),
     'Edge je vidět, seznam obchodů ne')
prejed(330, 80, 600)
over(zalozka() == 'history' and pohled() == 'trades', 'přejetí doleva z Edge → Trades')
prejed(80, 330, 600)
prejed(80, 330, 600)
print('   za první podzáložkou:', zalozka())
over(zalozka() == 'watchlist', 'za Edge pokračuje přejetí na Watchlists')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
