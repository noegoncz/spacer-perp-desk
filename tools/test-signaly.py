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
  const ocekavane = m.divergence(data, vysl.map((x) => x.rsi));
  return JSON.stringify({ svicek: data.length, vGrafu: vGrafu.length, ocekavane: ocekavane.length,
    shoda: JSON.stringify(vGrafu.map((d) => [d.typ, d.od.i, d.do.i]).sort()) === JSON.stringify(ocekavane.map((d) => [d.typ, d.od.i, d.do.i]).sort()),
    chyby: (window.__chyby || []).length });
})()"""

p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)

print('1. signálový alarm na serveru')
sig = posledniSignaly()
over(sig is not None and len(sig) == 1, f'jeden záznam typ divergence ({sig and len(sig)})')
if sig:
    s = sig[0]
    over(set(s['symboly']) == {'BTCUSDT', 'binance:ETHUSDT', 'JUPUSDT'},
         f'páry seznamu + pozice, bez OKX (hlídač ho nezná): {s["symboly"]}')
    over(s['intervaly'] == ['60', '240'] and s['aktivni'] and s['symbol'] == 'signaly', f'1h + 4h, aktivní: {s["intervaly"]}')

print('2. nastavení')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.6)
stav = json.loads(ev("""JSON.stringify({ videt: !document.getElementById('signalsCard').hidden
  && document.getElementById('signalsCard').offsetHeight > 0,
  zapnuto: document.getElementById('signalsDivBtn').classList.contains('on'),
  tf: [...document.querySelectorAll('[data-interval-signalu]')].map((b) => b.classList.contains('active')),
  text: document.getElementById('signalsState').textContent })""") or '{}')
over(stav.get('videt') and stav.get('zapnuto') and stav.get('tf') == [True, True], f'karta vidět, zapnuto, 1h i 4h: {stav}')
over('3' in stav.get('text', ''), f'počet hlídaných párů: {stav.get("text")}')
ev("document.querySelector('[data-interval-signalu=\"60\"]').click()")
time.sleep(2.8)
sig = posledniSignaly()
over(sig and sig[0]['intervaly'] == ['240'], f'bez 1h jde jen 4h: {sig and sig[0]["intervaly"]}')
ev("document.getElementById('signalsDivBtn').click()")
time.sleep(2.8)
sig = posledniSignaly()
over(sig == [], f'vypnuto → žádný signálový alarm ({sig})')
over(ev("document.querySelector('[data-interval-signalu=\"240\"]').disabled") is True, 'timeframy vypnutého signálu zašedlé')
ev("document.getElementById('signalsDivBtn').click(); document.querySelector('[data-interval-signalu=\"60\"]').click()")
time.sleep(2.8)
sig = posledniSignaly()
over(sig and sig[0]['intervaly'] == ['60', '240'], 'zapnuto zpátky s 1h i 4h')
ev("document.getElementById('backBtn').click()")
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
