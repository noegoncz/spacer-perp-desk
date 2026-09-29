# -*- coding: utf-8 -*-
"""
Alarmy se zhasnutým displejem — celý řetězec naostro:
aplikace → perpyx.com → hlídač na Hetzneru (skutečné ceny z Bybitu) → Firebase.

Aplikace běží v prohlížeči s podstrčeným Bybitem a podstrčeným nativním
pluginem push (vydá vymyšlený token). Účet, API i hlídač jsou skutečné.
Alarmy se položí těsně nad a pod aktuální cenu BTC, takže je trh brzy
protne a zazní na serveru.

Ověřuje:
  1. po přihlášení se telefon zaregistruje k push a stav je „zapnuto",
  2. alarmy se po změně samy odešlou na server,
  3. hlídač alarm zachytí, nahlásí zaznění a telefon si jednorázový alarm
     vypne (stáhne stav),
  4. Firebase vymyšlený token odmítl a hlídač ho z účtu smazal — což
     dokazuje, že se hlídač k Firebase opravdu přihlásil a push posílá,
  5. push, který dorazí do otevřené aplikace, se ozve jen jednou (dvojité
     zvonění), a klepnutí na notifikaci otevře graf páru,
  6. odhlášení odebere telefon z push.

Spuštění: python tools/test-alarmy-server.py http://localhost:8075/index.html \\
          soubor_s_AUTH_TEST_KEY soubor_s_WATCHER_TOKEN
"""
import os, sys, time, json, urllib.request
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLIC = open(sys.argv[2]).read().strip()
WATCHER = open(sys.argv[3]).read().strip()
EMAIL = f'push{int(time.time())}@test.perpyx.invalid'
TOKEN = f'test-fcm-token-{int(time.time())}-abcdefghijklmnopqrstuvwxyz'
cena = float(json.load(urllib.request.urlopen(
    'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', timeout=15))['result']['list'][0]['lastPrice'])
print('BTC teď:', cena)

pred = "window.__pravyFetch = window.fetch.bind(window); sessionStorage.setItem('__bezUctu', '1');"
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const bybit = window.fetch;
  window.__kod = '';
  window.__volani = [];
  window.__vibrace = 0;
  navigator.vibrate = () => { window.__vibrace += 1; return true; };
  window.confirm = () => true;
  window.fetch = async function (vstup, volby = {}) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (!u.startsWith('https://perpyx.com/')) return bybit(vstup, volby);
    window.__volani.push((volby.method || 'GET') + ' ' + u.replace('https://perpyx.com/api/account', ''));
    const h = { ...(volby.headers || {}) };
    if (u.endsWith('/start')) h['X-Test-Key'] = %s;
    const res = await window.__pravyFetch(u, { ...volby, headers: h });
    if (u.endsWith('/start')) res.clone().json().then((d) => { window.__kod = d.testCode || ''; });
    return res;
  };
  // Nativní plugin push, jak ho vystaví Capacitor v APK.
  const posluchaci = {};
  window.__push = posluchaci;
  window.Capacitor = { isNativePlatform: () => true, Plugins: { PushNotifications: {
    createChannel: async () => {},
    checkPermissions: async () => ({ receive: 'granted' }),
    requestPermissions: async () => ({ receive: 'granted' }),
    addListener: async (jmeno, fn) => { (posluchaci[jmeno] ||= []).push(fn); return { remove() {} }; },
    register: async () => { setTimeout(() => (posluchaci.registration || []).forEach((f) => f({ value: %s })), 50); },
  } } };
})();
""" % (json.dumps(KLIC), json.dumps(TOKEN))

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=pred + '\n' + mock + '\n' + po)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


def hlidac():
    r = urllib.request.Request('https://perpyx.com/api/watcher/alarms', headers={
        'X-Watcher-Token': WATCHER, 'User-Agent': 'Mozilla/5.0 PerpyX-test'})
    return json.load(urllib.request.urlopen(r, timeout=20))


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)

print('1) přihlášení a push')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
ev(f"document.getElementById('accountEmail').value = {json.dumps(EMAIL)}")
ev("document.getElementById('accountSendBtn').click()")
for _ in range(40):
    if ev("window.__kod"):
        break
    time.sleep(0.25)
ev("""(() => { const i = document.getElementById('accountCode'); i.value = window.__kod; i.dispatchEvent(new Event('input')); })()""")
time.sleep(6)
volani = ev("window.__volani") or []
over(any(v.startswith('POST /push-token') for v in volani), 'telefon se po přihlášení zaregistroval k push')
stav = ev("document.getElementById('accountPushState').textContent") or ''
over('on' in stav, f'stav v nastavení ({stav[:70]})')

print('2) alarmy na server')
ev(f"""import('./js/alarmy.js').then((m) => {{
  for (const [c, id] of [[{cena + 0.6}, 'nad'], [{cena - 0.6}, 'pod'], [{cena * 3}, 'daleko']]) {{
    const a = m.novy('BTCUSDT', c); a.id = 'test-' + id; m.uloz(a);
  }}
}})""", cekat=True)
time.sleep(4)
over(any(v.startswith('PUT /alarms') for v in (ev("window.__volani") or [])), 'alarmy se po změně odeslaly')
d = hlidac()
nase = [a['id'] for a in d['alarms'] if a['id'].startswith('test-')]
over(set(nase) >= {'test-nad', 'test-pod', 'test-daleko'}, f'hlídač alarmy vidí ({nase})')

print('3) zaznění na serveru (čekám na pohyb ceny, nejvýš 5 min)')
zaznel = None
konec = time.time() + 300
while time.time() < konec and not zaznel:
    time.sleep(10)
    ev("import('./js/alarmy-server.js').then((m) => m.stahniStav())", cekat=True)
    stavy = ev("""import('./js/alarmy.js').then((m) => m.vsechny().filter((a) => a.id.startsWith('test-'))
      .map((a) => ({ id: a.id, aktivni: a.aktivni, spusteno: a.spusteno })))""", cekat=True) or []
    zaznel = next((s for s in stavy if not s['aktivni'] and s['spusteno']), None)
over(bool(zaznel), f'hlídač alarm zachytil a telefon ho vypnul ({zaznel})')
daleko = next((s for s in (stavy or []) if s['id'] == 'test-daleko'), {})
over(daleko.get('aktivni') is True, 'vzdálený alarm zůstal zapnutý')

print('4) Firebase')
time.sleep(3)
st = json.load(urllib.request.urlopen(urllib.request.Request('https://perpyx.com/api/watcher/status', headers={
    'X-Watcher-Token': WATCHER, 'User-Agent': 'Mozilla/5.0 PerpyX-test'}), timeout=20))
print('   stav hlídače:', st.get('seenAt'), st.get('info'))
tokeny = []
for ucet, t in hlidac().get('tokens', {}).items():
    tokeny += t
over(TOKEN not in tokeny, 'Firebase vymyšlený token odmítl a hlídač ho smazal (přihlášení k Firebase funguje)')

print('5) push do otevřené aplikace')
ev("window.__vibrace = 0")
data = json.dumps({'alarmId': 'test-daleko', 'symbol': 'BTCUSDT', 'price': str(cena * 3)})
ev(f"(window.__push.pushNotificationReceived || []).forEach((f) => f({{ data: {data} }}))")
time.sleep(1)
ev(f"(window.__push.pushNotificationReceived || []).forEach((f) => f({{ data: {data} }}))")
time.sleep(1)
over(ev("window.__vibrace") == 1, f'dvakrát doručený push zazvoní jen jednou ({ev("window.__vibrace")}×)')
ev(f"(window.__push.pushNotificationActionPerformed || []).forEach((f) => f({{ notification: {{ data: {data} }} }}))")
time.sleep(2)
over(not ev("document.getElementById('viewChart').hidden") and 'BTCUSDT' in (ev("document.getElementById('chartSymbol')?.textContent || document.querySelector('.chart-head')?.textContent") or ''),
     'klepnutí na notifikaci otevře graf páru')
ev("history.back()")
time.sleep(1)

print('6) odhlášení')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
ev("document.getElementById('accountLogoutBtn').click()")
time.sleep(3)
over(any(v.startswith('DELETE /push-token') for v in (ev("window.__volani") or [])), 'odhlášení odebere telefon z push')

# úklid: přihlásit znovu a smazat testovací účet
ev(f"document.getElementById('accountEmail').value = {json.dumps(EMAIL)}; window.__kod = ''")
ev("document.getElementById('accountSendBtn').click()")
for _ in range(40):
    if ev("window.__kod"):
        break
    time.sleep(0.25)
ev("""(() => { const i = document.getElementById('accountCode'); i.value = window.__kod; i.dispatchEvent(new Event('input')); })()""")
time.sleep(5)
ev("document.getElementById('accountDeleteBtn').click()")
time.sleep(3)

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
