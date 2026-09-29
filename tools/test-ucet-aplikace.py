# -*- coding: utf-8 -*-
"""
Účet v aplikaci proti **ostrému** serveru perpyx.com.

Bybit je podstrčený (mock-bybit.js), ale volání na perpyx.com jdou
doopravdy — přihlášení, záloha i obnova se ověří celé, jak je uvidí
telefon. Testovací adresa `@test.perpyx.invalid` dostane kód v odpovědi
jen s klíčem AUTH_TEST_KEY; test ho přidá do hlavičky.

Scénář:
  1. přihlášení kódem (šest číslic přihlásí samo, bez tlačítka),
  2. první záloha hned po přihlášení, bez API klíče,
  3. změna seznamu → automatická záloha po odkladu (nová verze),
  4. „nový telefon" (prázdné úložiště) → přihlášení → nabídka obnovy
     → seznamy zpátky,
  5. smazání účtu.

Spuštění: python tools/test-ucet-aplikace.py http://localhost:8075/index.html soubor_s_klicem
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLIC = open(sys.argv[2]).read().strip()
EMAIL = f'app{int(time.time())}@test.perpyx.invalid'

pred = "window.__pravyFetch = window.fetch.bind(window); sessionStorage.setItem('__bezUctu', '1');"
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const bybit = window.fetch;
  window.__kod = '';
  // Dotazy přežijí přenačtení stránky po obnově (sessionStorage).
  window.confirm = (t) => {
    const d = JSON.parse(sessionStorage.getItem('__dotazy') || '[]');
    d.push(t);
    sessionStorage.setItem('__dotazy', JSON.stringify(d));
    return true;
  };
  window.fetch = async function (vstup, volby = {}) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (!u.startsWith('https://perpyx.com/')) return bybit(vstup, volby);
    const h = { ...(volby.headers || {}) };
    if (u.endsWith('/start')) h['X-Test-Key'] = %s;
    const res = await window.__pravyFetch(u, { ...volby, headers: h });
    if (u.endsWith('/start')) res.clone().json().then((d) => { window.__kod = d.testCode || ''; });
    return res;
  };
})();
""" % json.dumps(KLIC)

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


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def server(cesta):
    """Dotaz na server s tokenem z telefonu (mimo UI, jen pro kontrolu)."""
    return ev(f"""(async () => {{
      const r = JSON.parse(localStorage.getItem('perpdesk.session') || 'null');
      const res = await window.__pravyFetch('https://perpyx.com/api/account{cesta}',
        {{ headers: {{ Authorization: 'Bearer ' + (r && r.token) }} }});
      return res.json();
    }})()""", cekat=True) or {}


def prihlas():
    ev("document.getElementById('settingsBtn').click()")
    time.sleep(0.5)
    ev(f"document.getElementById('accountEmail').value = {json.dumps(EMAIL)}")
    ev("document.getElementById('accountSendBtn').click()")
    for _ in range(40):
        if ev("window.__kod"):
            break
        time.sleep(0.25)
    kod = ev("window.__kod")
    ev(f"""(() => {{ const i = document.getElementById('accountCode'); i.value = {json.dumps(kod)};
      i.dispatchEvent(new Event('input')); }})()""")
    time.sleep(4)
    return kod


def nacti():
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(5)


nacti()
ev("localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'all', seznamy: [{ id: 'fav', nazev: 'My watchlist', polozky: ['bybit:BTCUSDT'] }] }))")
nacti()

print('1) přihlášení')
over(ev("!document.getElementById('onboarding').hidden && !document.getElementById('onbLogin').hidden"),
     'nepřihlášený vidí povinné přihlášení (úvodní obrazovka)')
kod = prihlas()
over(len(kod or '') == 6, 'kód přišel')
over(ev("!document.getElementById('accountIn').hidden"), 'po šesti číslicích přihlášen bez tlačítka')
over(ev("document.getElementById('accountWho').textContent") == EMAIL, 'ukazuje e-mail účtu')

print('2) první záloha')
time.sleep(2)
me = server('/me')
over((me.get('backup') or {}).get('version') == 1, f'záloha hned po přihlášení ({me.get("backup")})')
z = server('/backup')
d = (z.get('backup') or {}).get('data', {})
over('bybit:BTCUSDT' in d.get('perpdesk.lists', ''), 'v záloze je seznam')
over(not any(k in d for k in ('perpdesk.apiKey', 'perpdesk.apiSecret', 'perpdesk.session')),
     'v záloze NENÍ API klíč, secret ani relace')
stav = ev("document.getElementById('accountBackupState').textContent") or ''
over('last backup' in stav, f'stav zálohy v nastavení ({stav})')

print('3) automatická záloha po změně')
ev("""import('./js/sestavy.js').then((m) => { m.prepni('fav', 'ETHUSDT'); })""", cekat=True)
time.sleep(18)
me = server('/me')
over((me.get('backup') or {}).get('version') == 2, f'po změně nová verze ({me.get("backup")})')

print('4) nový telefon')
token = json.loads(ev("localStorage.getItem('perpdesk.session')"))['token']
ev("localStorage.clear()")
nacti()
over(ev("localStorage.getItem('perpdesk.session')") is None, 'prázdný telefon není přihlášený')
prihlas()
time.sleep(3)
dotazy = json.loads(ev("sessionStorage.getItem('__dotazy') || '[]'"))
seznamy = json.loads(ev("localStorage.getItem('perpdesk.lists')") or '{}').get('seznamy', [])
polozky = seznamy[0]['polozky'] if seznamy else []
print('   dotaz:', (dotazy[-1] if dotazy else '')[:90].replace('\n', ' '))
over(dotazy and 'Restore it on this phone' in dotazy[-1], 'nabídnuta obnova (prázdný telefon)')
over(polozky == ['bybit:BTCUSDT', 'bybit:ETHUSDT'], f'seznam obnovený z cloudu ({polozky})')

print('5) smazání účtu')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.5)
ev("document.getElementById('accountDeleteBtn').click()")
time.sleep(2)
over(ev("!document.getElementById('onboarding').hidden && !document.getElementById('onbLogin').hidden"),
     'po smazání zase povinné přihlášení')
over(ev("localStorage.getItem('perpdesk.session')") is None, 'relace zapomenutá')
over(bool(json.loads(ev("localStorage.getItem('perpdesk.lists')") or '{}').get('seznamy')), 'data v telefonu zůstala')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
