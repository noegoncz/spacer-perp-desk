# -*- coding: utf-8 -*-
"""
Úvodní obrazovka: povinné přihlášení a připojení burzy (v0.23.0).

  1. první spuštění (bez účtu): úvodní okno je vidět hned, ještě před
     naběhnutím aplikace, a zavřít nejde,
  2. po přihlášení bez burzy rovnou krok „Připoj burzu" (Bybit, ostatní
     burzy „brzy"), jde přeskočit a po přenačtení se už nevnucuje,
  3. nastavení: klíč se nikde nezobrazuje, jen „••••" a konec klíče;
     přidání a výměna klíče jdou přes stejné okno (s křížkem),
  4. odhlášení vrátí povinné přihlášení.

Účet i Bybit jsou podstrčené (perpyx.com odpovídá tady v testu).

Spuštění: python tools/test-uvod.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pred = "sessionStorage.setItem('__bezUctu', '1'); sessionStorage.setItem('__bezKlice', '1');"
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const bybit = window.fetch;
  window.confirm = () => true;
  window.fetch = async function (vstup, volby = {}) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (!u.startsWith('https://perpyx.com/api/account')) return bybit(vstup, volby);
    const c = u.replace('https://perpyx.com/api/account', '');
    const odp = {
      '/start': { ok: true },
      '/verify': { ok: true, token: '1'.repeat(64), email: 'novy@example.com', created: '2026-09-29' },
      '/me': { ok: true, email: 'novy@example.com', backup: null },
    }[c] || { ok: true };
    return new Response(JSON.stringify(odp), { status: 200 });
  };
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive' || window.__prvni) return;
    window.__prvni = {
      obsah: getComputedStyle(document.querySelector('main')).visibility,
      uvod: getComputedStyle(document.getElementById('onboarding')).display,
    };
  });
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=pred + '\n' + mock + '\n' + po)


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


vidim = lambda i: ev(f"!document.getElementById('{i}').hidden")


def nacti():
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(4)


nacti()
print('1) první spuštění')
prvni = ev('window.__prvni') or {}
over(prvni.get('obsah') == 'hidden' and prvni.get('uvod') == 'block', f'úvodní okno hned, aplikace skrytá ({prvni})')
over(vidim('onboarding') and vidim('onbLogin') and not vidim('onbExchange'), 'krok přihlášení')
over(not vidim('onbCloseBtn'), 'přihlášení nemá křížek')
ev("document.getElementById('onbSkipBtn').click()")
time.sleep(0.3)
over(vidim('onboarding'), 'bez přihlášení se okno zavřít nedá')

print('2) přihlášení → burza')
ev("document.getElementById('accountEmail').value = 'novy@example.com'")
ev("document.getElementById('accountSendBtn').click()")
time.sleep(0.8)
ev("(() => { const i = document.getElementById('accountCode'); i.value = '123456'; i.dispatchEvent(new Event('input')); })()")
time.sleep(1.5)
over(vidim('onboarding') and vidim('onbExchange') and not vidim('onbLogin'), 'po přihlášení krok Připoj burzu')
burzy = ev("[...document.querySelectorAll('.exchange-btn')].map((b) => b.textContent.trim() + (b.disabled ? ':x' : ''))")
over(burzy and burzy[0] == 'Bybit' and all(b.endswith(':x') for b in burzy[1:]), f'Bybit a ostatní „brzy" ({burzy})')
ev("document.getElementById('onbSkipBtn').click()")
time.sleep(0.4)
over(not vidim('onboarding'), 'přeskočit jde')
nacti()
over(not vidim('onboarding'), 'po přenačtení se připojení burzy nevnucuje')

print('3) nastavení bez viditelného klíče')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
over('No exchange connected' in (ev("document.getElementById('exchangeList').textContent") or ''), 'bez burzy: „No exchange connected"')
ev("document.getElementById('exchangeAddBtn').click()")
time.sleep(0.3)
over(vidim('onbExchange') and vidim('onbCloseBtn') and not vidim('onbSkipBtn'), 'Přidat burzu otevře stejné okno s křížkem')
ev("document.getElementById('apiKey').value = 'MUJKLIC1234ABCD'")
ev("document.getElementById('apiSecret').value = 'MUJSECRET1234567890abcdef'")
ev("document.getElementById('saveBtn').click()")
time.sleep(2)
over(not vidim('onboarding'), 'po připojení se okno zavře')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
seznam = ev("document.getElementById('exchangeList').textContent") or ''
over('Bybit' in seznam and '••••ABCD' in seznam, f'burza v nastavení s koncem klíče ({seznam})')
text = ev("document.body.innerText") or ''
over('MUJKLIC1234ABCD' not in text and 'MUJSECRET' not in text, 'klíč ani secret nejsou nikde vidět')
over(ev("document.getElementById('apiKey').value") == '', 'formulář klíče se po uložení vyčistil')
over(not vidim('exchangeAddBtn'), 'druhou burzu zatím přidat nejde (není kterou)')

print('4) odhlášení')
ev("document.getElementById('accountLogoutBtn').click()")
time.sleep(1)
over(vidim('onboarding') and vidim('onbLogin'), 'po odhlášení povinné přihlášení')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
