# -*- coding: utf-8 -*-
"""
Zámek aplikace (js/zamek.js): PIN a volitelně otisk prstu.

  1. zapnutí v nastavení (PIN dvakrát), otisk se v prohlížeči nenabízí,
  2. po načtení je aplikace zamčená, špatný PIN neprojde, správný odemkne,
  3. pět špatných pokusů → čekání,
  4. zamčení po odchodu z aplikace (volba „Hned"),
  5. otisk prstu (podstrčený nativní plugin): zapnutí, samo odemkne při
     startu, výzva se nevyvolává dokola,
  6. zapomenutý PIN smaže klíč, ne ostatní data; PIN se nezálohuje,
  7. vypnutí zámku jen se současným PINem.

Spuštění: python tools/test-zamek.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
window.confirm = () => true;
// Co je vidět v okamžiku, kdy je stránka sestavená, ale moduly aplikace
// ještě neběží (readyState „interactive" předchází spuštění modulů;
// DOMContentLoaded až po nich). Se zapnutým zámkem nesmí být vidět obsah.
document.addEventListener('readystatechange', () => {
  if (document.readyState !== 'interactive' || window.__prvniPohled) return;
  window.__prvniPohled = {
    obsah: getComputedStyle(document.querySelector('main')).visibility,
    zamek: getComputedStyle(document.getElementById('lockScreen')).display,
    appBezi: Boolean(window.__graf || document.documentElement.classList.contains('zamceno')),
  };
});
if (sessionStorage.getItem('__otisk')) {
  window.__vyzev = 0;
  window.Capacitor = { isNativePlatform: () => true, Plugins: { NativeBiometric: {
    isAvailable: async () => ({ isAvailable: true, biometryType: 3 }),
    verifyIdentity: async () => { window.__vyzev += 1; },
  } } };
}
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)


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


def zamceno():
    return ev("!document.getElementById('lockScreen').hidden")


def napis(pin):
    for c in pin:
        ev(f"document.querySelector('#lockPad [data-k=\"{c}\"]').click()")
        time.sleep(0.05)
    time.sleep(1.2)   # PBKDF2


def pin_v_nastaveni(pin):
    ev(f"document.getElementById('lockPinInput').value = '{pin}'")
    ev("document.getElementById('lockSetupOk').click()")
    time.sleep(1.2)


def nacti():
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(4)


nacti()
print('1) zapnutí')
over(not zamceno(), 'bez zámku se nic nezamyká')
over(ev("document.getElementById('errorBar').hidden"), 'bez zámku žádná chybová hláška při startu')
over((ev("window.__prvniPohled") or {}).get('obsah') == 'visible', 'bez zámku je obsah vidět hned')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
ev("document.getElementById('lockPinToggle').click()")
time.sleep(0.3)
pin_v_nastaveni('12a')
over('4 to 6 digits' in (ev("document.getElementById('lockSettingsMsg').textContent") or ''), 'neplatný PIN odmítnut')
pin_v_nastaveni('1234')
pin_v_nastaveni('9999')
over('do not match' in (ev("document.getElementById('lockSettingsMsg').textContent") or ''), 'neshodné PINy odmítnuty')
pin_v_nastaveni('1234')
pin_v_nastaveni('1234')
over('is on' in (ev("document.getElementById('lockSettingsMsg').textContent") or ''), 'zámek zapnut')
ulozeno = ev("localStorage.getItem('perpdesk.lock')") or ''
over('1234' not in ulozeno and '"hash"' in ulozeno, 'PIN uložen jen jako otisk')
over(ev("document.getElementById('lockBioRow').hidden"), 'v prohlížeči se otisk nenabízí')

print('2) zamčeno po načtení')
nacti()
over(zamceno(), 'po načtení zamčeno')
prvni = ev("window.__prvniPohled") or {}
over(prvni.get('obsah') == 'hidden' and prvni.get('zamek') == 'flex',
     f'obsah neproblikne — zámek je vidět už před naběhnutím aplikace ({prvni})')
napis('1235')
over(zamceno() and 'Wrong' in (ev("document.getElementById('lockMsg').textContent") or ''), 'špatný PIN neprojde')
napis('1234')
over(not zamceno(), 'správný PIN odemkne')

print('3) pět špatných pokusů')
nacti()
for _ in range(5):
    napis('0000')
over('Try again in' in (ev("document.getElementById('lockMsg').textContent") or ''), 'po pěti chybách čekání')
napis('1234')
over(zamceno(), 'během čekání neprojde ani správný PIN')
ev("""(() => { const z = JSON.parse(localStorage.getItem('perpdesk.lock')); z.cekatDo = 0; z.chyb = 0;
  localStorage.setItem('perpdesk.lock', JSON.stringify(z)); })()""")
nacti()
napis('1234')
over(not zamceno(), 'po uplynutí čekání správný PIN projde')

print('4) zamčení po odchodu z aplikace')
ev("""Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
document.dispatchEvent(new Event('visibilitychange'));""")
time.sleep(0.2)
over(zamceno(), 'odchod z aplikace zamkne (volba Hned)')
napis('1234')

print('5) otisk prstu')
ev("sessionStorage.setItem('__otisk', '1')")
ev("localStorage.setItem('__pin', localStorage.getItem('perpdesk.lock')); localStorage.removeItem('perpdesk.lock')")
nacti()
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
over(not ev("document.getElementById('lockBioRow').hidden") and ev("document.getElementById('lockBioRow').classList.contains('zasedle')")
     and not ev("document.getElementById('lockBioHint').hidden"), 'bez PINu je otisk vidět zašedlý s vysvětlením')
ev("document.getElementById('lockBioToggle').click()")
time.sleep(0.3)
over(ev("window.__vyzev") == 0, 'bez PINu otisk zapnout nejde')
ev("localStorage.setItem('perpdesk.lock', localStorage.getItem('__pin'))")
nacti()
napis('1234')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
over(not ev("document.getElementById('lockBioRow').hidden"), 'se čtečkou se otisk nabízí')
ev("document.getElementById('lockBioToggle').click()")
time.sleep(0.5)
over(ev("document.getElementById('lockBioToggle').classList.contains('on')") and ev("window.__vyzev") == 1,
     'zapnutí otisku chce přiložit prst')
nacti()
time.sleep(1.5)
over(not zamceno(), 'při startu odemkne otisk bez PINu')
over(ev("window.__vyzev") == 1, f'výzva jen jednou ({ev("window.__vyzev")})')
ev("sessionStorage.removeItem('__otisk')")

print('6) zapomenutý PIN a záloha')
zaloha = ev("import('./js/zaloha.js').then((m) => JSON.stringify(m.sestavZalohu()))", cekat=True) or ''
over('perpdesk.lock' not in zaloha, 'nastavení zámku se nezálohuje')
ev("localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'all', seznamy: [] }))")
vysledek = ev("""import('./js/zamek.js').then((m) => { m.zapomenutyPin();
  return [localStorage.getItem('perpdesk.apiKey'), localStorage.getItem('perpdesk.lock'),
          localStorage.getItem('perpdesk.lists') !== null].join('|'); })""", cekat=True)
over(vysledek == '||true', f'zapomenutý PIN: klíč i zámek pryč, seznamy zůstaly ({vysledek})')

print('7) vypnutí jen se současným PINem')
nacti()
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
ev("document.getElementById('lockPinToggle').click()"); time.sleep(0.2)
pin_v_nastaveni('4321'); pin_v_nastaveni('4321')
ev("document.getElementById('lockPinToggle').click()"); time.sleep(0.2)
pin_v_nastaveni('1111')
over(ev("localStorage.getItem('perpdesk.lock')") is not None, 'špatným PINem se vypnout nedá')
pin_v_nastaveni('4321')
over(ev("localStorage.getItem('perpdesk.lock')") is None, 'současným PINem vypnuto')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
