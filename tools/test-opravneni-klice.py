# -*- coding: utf-8 -*-
"""
PerpyX přijme jen klíč pro čtení (`/v5/user/query-api`).

  * klíč jen pro čtení → Test i Uložit projdou,
  * klíč s právem obchodovat → odmítnut, NEuloží se,
  * klíč s právem výběru → odmítnut, NEuloží se,
  * dřív uložený nebezpečný klíč → aplikace běží dál, ale ukáže varování.

Spuštění: python tools/test-opravneni-klice.py http://localhost:8075/index.html
"""
import os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock = "window.__klic = sessionStorage.getItem('__klic') || '';\n" + mock

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return None if 'exceptionDetails' in r else r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def nastaveni(klic, typ):
    ev(f"window.__klic = '{typ}'")
    ev("document.getElementById('settingsBtn').click()")
    time.sleep(0.4)
    ev(f"document.getElementById('apiKey').value = '{klic}'")
    ev("document.getElementById('apiSecret').value = 'NOVYSECRET1234567890abcdef'")


def zprava():
    return ev("document.getElementById('settingsMsg').textContent") or ''


p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
over(not (ev("document.getElementById('errorBar')?.hidden === false") and 'can trade' in (ev("document.getElementById('errorBar').textContent") or '')),
     'klíč jen pro čtení: žádné varování při startu')

print('obchodní klíč')
nastaveni('OBCHODNIKLIC123', 'trade')
ev("document.getElementById('testBtn').click()")
time.sleep(1)
over('can trade' in zprava(), f'Test odmítne ({zprava()[:50]})')
ev("document.getElementById('saveBtn').click()")
time.sleep(1)
over(ev("localStorage.getItem('perpdesk.apiKey')") != 'OBCHODNIKLIC123', 'obchodní klíč se neuložil')

print('klíč s výběrem')
nastaveni('VYBERKLIC123', 'withdraw')
ev("document.getElementById('saveBtn').click()")
time.sleep(1)
over('WITHDRAW' in zprava(), f'odmítnut s důrazem na výběr ({zprava()[:50]})')
over(ev("localStorage.getItem('perpdesk.apiKey')") != 'VYBERKLIC123', 'klíč s výběrem se neuložil')

print('klíč jen pro čtení')
nastaveni('CTECIKLIC123', '')
ev("document.getElementById('testBtn').click()")
time.sleep(1)
over('Connection works, the key is valid' in zprava(), f'Test projde ({zprava()[:40]})')
ev("document.getElementById('saveBtn').click()")
time.sleep(1.5)
over(ev("localStorage.getItem('perpdesk.apiKey')") == 'CTECIKLIC123', 'uložen')

print('dřív uložený obchodní klíč')
ev("sessionStorage.setItem('__klic', 'trade')")
p.prikaz('Page.reload')
time.sleep(6)
lista = ev("document.getElementById('errorBar')?.textContent || document.querySelector('.error-bar')?.textContent || ''") or ''
over('can trade' in lista, f'varování při startu ({lista[:60]})')
over(ev("document.querySelectorAll('.position').length") > 0, 'aplikace přesto ukazuje pozice')
ev("document.getElementById('refreshBtn').click()")
time.sleep(3)
lista = ev("document.getElementById('errorBar').hidden ? '' : document.getElementById('errorBar').textContent") or ''
over('can trade' in lista, 'varování přežije další úspěšné načtení pozic')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
