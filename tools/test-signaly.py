# -*- coding: utf-8 -*-
"""
Signály v grafech — RSI divergence (v0.89.0, přání uživatele: hlídat
na serveru a poslat push, timeframy 1h a 4h).

  A. výpočet a hlídač (Node, svíčky naostro): tools/test-signaly-node.mjs,
     když je zadaná cesta k node.exe,
  1. aplikace pošle na perpyx.com signálový alarm (typ divergence) s páry
     seznamu a pozice a s timeframy 1h + 4h,
  2. nastavení: karta Signály, vypnutí → na server nejde nic, 1h jde
     odebrat,
  3. RSI v grafu nese divergence spočítané stejným modulem jako server
     a kreslí se bez chyb (a s vypnutou volbou se nic nemění),
  4. klepnutí na notifikaci signálu otevře graf páru na timeframu signálu.

Spuštění: python tools/test-signaly.py http://localhost:8075/index.html [node.exe]
"""
import os, sys, time, json, subprocess
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


if len(sys.argv) > 2:
    print('A. výpočet a hlídač (Node)')
    r = subprocess.run([sys.argv[2], os.path.join(KOREN, 'tools', 'test-signaly-node.mjs'), KOREN],
                       capture_output=True, text=True, encoding='utf-8', timeout=180)
    print(r.stdout.rstrip())
    over(r.returncode == 0, 'Node část prošla' + (f' ({r.stderr.strip()[:300]})' if r.stderr.strip() else ''))

mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  if (!sessionStorage.getItem('__sig')) {
    sessionStorage.setItem('__sig', '1');
    localStorage.setItem('perpdesk.indicators', JSON.stringify(['RSI']));
    localStorage.setItem('perpdesk.lists', JSON.stringify({ aktivni: 'w1', seznamy: [
      { id: 'w1', nazev: 'Test', polozky: ['bybit:BTCUSDT', 'binance:ETHUSDT', 'okx:SOLUSDT'] }] }));
  }
  const puvodni = window.fetch;
  window.__odeslane = [];
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('perpyx.com/api/account/alarms') && volby && volby.method === 'PUT') {
      window.__odeslane.push(JSON.parse(volby.body));
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }
    return puvodni(vstup, volby);
  };
  const posluchaci = {};
  window.__klepni = (data) => (posluchaci.pushNotificationActionPerformed || [])
    .forEach((f) => f({ notification: { data } }));
  window.Capacitor = { isNativePlatform: () => true, Plugins: { PushNotifications: {
    createChannel: async () => {},
    checkPermissions: async () => ({ receive: 'granted' }),
    requestPermissions: async () => ({ receive: 'granted' }),
    addListener: async (jmeno, fn) => { (posluchaci[jmeno] ||= []).push(fn); return { remove() {} }; },
    register: async () => { setTimeout(() => (posluchaci.registration || []).forEach((f) => f({ value: 'tok' })), 20); },
  } } };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock + '\n' + po)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('    (výjimka)', json.dumps(r['exceptionDetails'])[:300])
        return None
    return r.get('result', {}).get('value')


def posledniSignaly():
    return json.loads(ev("""JSON.stringify((() => { const o = window.__odeslane.at(-1);
      return o ? o.alarms.filter((a) => a.typ === 'divergence') : null; })())""") or 'null')


KONTROLA_RSI = """(async () => {
  const m = await import('./js/divergence.js');
  const g = window.__graf;
  const ind = g.getIndicators({ name: 'RSI' })[0];
  const vysl = ind.result || [];
  const vGrafu = vysl.flatMap((x) => x.div || []);
  const data = g.getDataList();
  const rada = vysl.map((x) => x.rsi);
  const ocekavane = [...m.divergence(data, rada), ...m.rozpracovane(data, rada)];
  return JSON.stringify({ svicek: data.length, vGrafu: vGrafu.length, ocekavane: ocekavane.length,
    shoda: JSON.stringify(vGrafu.map((d) => [d.typ, d.od.i, d.do.i]).sort()) === JSON.stringify(ocekavane.map((d) => [d.typ, d.od.i, d.do.i]).sort()),
    chyby: (window.__chyby || []).length });
})()"""

p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)

print('1. bez zapnutí nic na server')
sig = posledniSignaly()
over(sig is not None and sig == [], f'žádná pravidla, žádný signál (už ne plošně seznamy) ({sig})')

print('2. zvonek v panelu RSI → okno → uložit')
ev("document.querySelector('.position').click()")
time.sleep(4)
zv = json.loads(ev("""JSON.stringify((() => { const z = [...document.querySelectorAll('.pane-poradi')]
  .find((s) => s.dataset.nazev === 'RSI')?.querySelector('.pane-zvonek');
  return z ? { videt: !z.hidden && !z.closest('.pane-poradi').hidden && z.offsetWidth > 0, on: z.classList.contains('on') } : null; })())""") or 'null')
over(zv and zv['videt'] and not zv['on'], f'zvonek v panelu RSI vidět, nesvítí ({zv})')
ev("[...document.querySelectorAll('.pane-poradi')].find((s) => s.dataset.nazev === 'RSI').querySelector('.pane-zvonek').click()")
time.sleep(0.6)
okno = json.loads(ev("""JSON.stringify({ videt: !document.getElementById('sheetSignal').hidden,
  par: document.getElementById('signalPair').textContent,
  tf: [...document.querySelectorAll('#signalTf .chip')].map((b) => [b.textContent, b.classList.contains('active')]),
  faze: [...document.querySelectorAll('#signalFaze .chip')].map((b) => b.classList.contains('active')),
  smazat: !document.getElementById('signalDeleteBtn').hidden })""") or '{}')
over(okno.get('videt') and 'JUPUSDT' in okno.get('par', ''), f'okno pro pár: {okno.get("par")}')
over(len(okno.get('tf', [])) == 8 and [x[0] for x in okno['tf'] if x[1]] == ['4h'],
     f'všech 8 timeframů, předvybraný timeframe grafu: {okno.get("tf")}')
over(okno.get('faze') == [False, True, False] and not okno.get('smazat'), 'výchozí „Předem 2/3", bez Smazat')
ev("[...document.querySelectorAll('#signalTf .chip')].find((b) => b.textContent === '1h').click()")
ev("[...document.querySelectorAll('#signalTf .chip')].find((b) => b.textContent === '1D').click()")
# v0.90.3: fáze jdou kombinovat — přidat Potvrzenou, odebrat a vrátit 2/3.
ev("document.querySelectorAll('#signalFaze .chip')[2].click()")
ev("document.querySelectorAll('#signalFaze .chip')[1].click()")
ev("document.querySelectorAll('#signalFaze .chip')[0].click()")
ev("document.querySelectorAll('#signalFaze .chip')[0].click()")
ev("document.querySelectorAll('#signalFaze .chip')[1].click()")
kombinace = json.loads(ev("""JSON.stringify({ faze: [...document.querySelectorAll('#signalFaze .chip')].map((b) => b.classList.contains('active')),
  napovedy: document.querySelectorAll('#signalFazeHint .signal-faze-radek').length })""") or '{}')
over(kombinace.get('faze') == [False, True, True] and kombinace.get('napovedy') == 2,
     f'víc fází naráz (2/3 + Potvrzená), nápověda ke každé: {kombinace}')
ev("document.querySelectorAll('#signalFaze .chip')[1].click()")
ev("document.querySelectorAll('#signalFaze .chip')[2].click()")
over(ev("document.getElementById('signalSaveBtn').disabled"), 'bez vybrané fáze nejde uložit')
ev("document.querySelectorAll('#signalFaze .chip')[1].click()")
ev("document.querySelectorAll('#signalFaze .chip')[2].click()")
ev("document.getElementById('signalSaveBtn').click()")
time.sleep(2.8)
sig = posledniSignaly()
over(sig and len(sig) == 1 and sig[0]['symbol'] == 'JUPUSDT' and sig[0]['intervaly'] == ['60', '240', 'D']
     and sig[0]['faze'] == [2, 3] and sig[0]['aktivni'] and sig[0]['id'].startswith('sig-'),
     f'na server jde pravidlo páru: {sig}')
over(ev("[...document.querySelectorAll('.pane-poradi')].find((s) => s.dataset.nazev === 'RSI').querySelector('.pane-zvonek').classList.contains('on')"),
     'zvonek po uložení svítí')
ev("history.back()")
time.sleep(1)

print('2b. záložka Notifikace')
ev("document.querySelector('.tab[data-tab=\"alerts\"]').click()")
time.sleep(0.8)
z = json.loads(ev("""JSON.stringify({ tab: document.querySelector('.tab[data-tab="alerts"]').textContent.trim(),
  pod: [...document.querySelectorAll('#alertsTabs [data-id]')].map((b) => b.dataset.id),
  rezim: !document.getElementById('alertsRezim').hidden })""") or '{}')
over(z.get('tab') == 'Notifications' and z.get('pod', [])[:2] == ['alarmy', 'rsi'] and z.get('rezim'),
     f'záložka Notifications, podzáložky Alerts | RSI, Active/Inactive vidět: {z}')
ev("document.querySelector('#alertsTabs [data-id=\"rsi\"]').click()")
time.sleep(0.6)
r = json.loads(ev("""JSON.stringify({ rezim: !document.getElementById('alertsRezim').hidden,
  radky: [...document.querySelectorAll('#alertsList .alert-row')].map((x) => x.textContent) })""") or '{}')
over(not r.get('rezim') and len(r.get('radky', [])) == 1 and 'JUPUSDT' in r['radky'][0] and '1h · 4h · 1D' in r['radky'][0] and '2/3 · ' in r['radky'][0],
     f'RSI: řádek páru s timeframy, Active/Inactive schované: {r}')
ev("document.querySelector('#alertsList .alert-row .nastaveni-prepinac').click()")
time.sleep(2.8)
sig = posledniSignaly()
over(sig and sig[0]['aktivni'] is False, f'vypnutí → na serveru neaktivní ({sig and sig[0]["aktivni"]})')
ev("document.querySelector('#alertsList .alert-row .alert-smazat').click()")
time.sleep(0.3)
ev("document.querySelector('#alertsList .alert-row .alert-smazat').click()")
time.sleep(2.8)
sig = posledniSignaly()
over(sig == [] and not ev("document.querySelectorAll('#alertsList .alert-row').length"), f'smazáno dvěma klepnutími ({sig})')
ev("document.querySelector('.tab[data-tab=\"positions\"]').click()")
time.sleep(0.5)

print('3. RSI divergence v grafu')
ev("document.querySelector('.position').click()")
time.sleep(4)
r = json.loads(ev(KONTROLA_RSI) or '{}')
over(r.get('svicek', 0) > 100 and r.get('shoda'), f'divergence v RSI = výpočet modulu ({r})')
over(r.get('chyby') == 0, 'kreslení bez chyb')

print('4. klepnutí na notifikaci signálu')
ev("history.back()")
time.sleep(1)
ev("""window.__klepni({ symbol: 'binance:ETHUSDT', interval: '60', typ: 'divergence', alarmId: 'sig:x' })""")
time.sleep(5)
g = json.loads(ev("""JSON.stringify({ otevreny: !document.getElementById('viewChart').hidden,
  par: document.getElementById('chartSymbol').textContent,
  tf: document.querySelector('.interval-btn[data-interval].active')?.dataset.interval })""") or '{}')
over(g.get('otevreny') and 'ETH' in g.get('par', '') and g.get('tf') == '60', f'graf ETH na 1h: {g}')
ev("""window.__klepni({ symbol: 'binance:ETHUSDT', interval: '240', typ: 'divergence', alarmId: 'sig:y' })""")
time.sleep(2)
tf = ev("document.querySelector('.interval-btn[data-interval].active')?.dataset.interval")
over(tf == '240', f'otevřený graf téhož páru přepne timeframe ({tf})')
time.sleep(3)
print('5. RSI divergence na skutečných grafech Binance (první pár, kde nějaká je)')
# Přísná pravidla (v0.89.1) jich najdou málo — zkouší se páry, dokud se nějaká neukáže.
nalezeno = None
for par, tf in [('binance:ETHUSDT', '240'), ('binance:ADAUSDT', '60'), ('binance:SOLUSDT', '60'),
                ('binance:DOGEUSDT', '60'), ('binance:BTCUSDT', '60'), ('binance:XRPUSDT', '240')]:
    ev(f"window.__klepni({{ symbol: '{par}', interval: '{tf}', typ: 'divergence', alarmId: 'sig:{par}' }})")
    time.sleep(5)
    r = json.loads(ev(KONTROLA_RSI) or '{}')
    over(r.get('svicek', 0) > 100 and r.get('shoda'), f'{par} {tf}: v grafu = výpočet modulu ({r})')
    if r.get('vGrafu', 0) > 0:
        nalezeno = par
        break
over(nalezeno, f'aspoň jeden graf s divergencí ({nalezeno})')
ev("window.__graf.scrollToRealTime?.(); window.__graf.resize?.()")
time.sleep(0.5)
# ⚠ „ResizeObserver loop…" je hláška prohlížeče, ne chyba aplikace.
skutecne = json.loads(ev("JSON.stringify((window.__chyby || []).filter((x) => !/ResizeObserver loop/.test(String(x))))") or '[]')
over(not skutecne, f'bez chyb v aplikaci ({skutecne})')

print('VÝSLEDEK: ' + (f'!!! {len(chyby)} chyb' if chyby else 'VŠE V POŘÁDKU'))
