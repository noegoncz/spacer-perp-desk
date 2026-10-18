# -*- coding: utf-8 -*-
"""
Karta „Last 30 days" na Pozicích a filtr pod tlačítkem (v0.62.0, varianta C
uživatele). Bybit podstrčený mockem (uzavřené obchody z /closed-pnl).

Ověřuje:
  * přehled účtu (Equity / Free / Margin) je schovaný,
  * karta ukazuje součet, počet uzavření a křivku s tečkou za každé zavření,
  * řazení a filtr jsou schované, tlačítko je rozbalí a zase sbalí,
  * nevýchozí filtr = tlačítko svítí a má tečku,
  * statistika se uloží do telefonu (perpdesk.stat30) a po přenačtení je hned,
  * snímky na zavřeném (344 px) a rozevřeném (673 px) Foldu.

Spuštění: python tools/test-statistika-30.py http://localhost:8075/index.html [složka na snímky]
"""
import os, sys, time, json, base64
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNIMKY = sys.argv[2] if len(sys.argv) > 2 else None
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=880, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def snimek(nazev):
    if not SNIMKY:
        return
    os.makedirs(SNIMKY, exist_ok=True)
    d = p.prikaz('Page.captureScreenshot', format='png')['data']
    open(os.path.join(SNIMKY, nazev), 'wb').write(base64.b64decode(d))


STAV = """JSON.stringify((() => {
  const $ = (id) => document.getElementById(id);
  return {
    karta: !$('stat30').hidden, ucet: !$('accountSummary').hidden,
    pnl: $('stat30Pnl').textContent, detail: $('stat30Detail').textContent,
    body: $('stat30Graf').querySelectorAll('circle').length,
    cara: !!$('stat30Graf').querySelector('path'),
    nastroje: !$('positionTools').hidden, tlacitko: !$('positionToolsBtn').hidden,
    svitı: $('positionToolsBtn').classList.contains('aktivni'), tecka: !$('positionToolsDot').hidden,
  };
})())"""

stav = {}
for _ in range(30):
    time.sleep(0.5)
    stav = json.loads(ev(STAV) or '{}')
    if stav.get('body'):
        break
print('  ', stav)
over(not stav.get('ucet'), 'přehled účtu (Equity / Free / Margin) je schovaný')
over(stav.get('karta'), 'karta „Last 30 days" je vidět')
over(stav.get('body', 0) >= 1 and stav.get('cara'), f"křivka s tečkou za každé zavření ({stav.get('body')})")
over('closes' in (stav.get('detail') or ''), f"počet uzavření a úspěšnost ({stav.get('detail')})")
over(any(ch.isdigit() for ch in stav.get('pnl', '')), f"součet za 30 dní ({stav.get('pnl')})")
over(not stav.get('nastroje') and stav.get('tlacitko'), 'řazení a filtr schované pod tlačítkem')
over(not stav.get('tecka'), 'výchozí filtr: tlačítko bez tečky')
snimek('pozice-344.png')

print('tlačítko')
ev("document.getElementById('positionToolsBtn').click()")
time.sleep(0.4)
stav = json.loads(ev(STAV) or '{}')
over(stav.get('nastroje'), 'klepnutí rozbalí řazení a filtr')
snimek('pozice-344-filtr.png')
ev("[...document.querySelectorAll('#filterGroup .list-btn')].find((b) => /Short/.test(b.textContent)).click()")
time.sleep(0.4)
stav = json.loads(ev(STAV) or '{}')
over(stav.get('tecka') and stav.get('svitı'), 'nevýchozí filtr: tlačítko svítí a má tečku')
ev("[...document.querySelectorAll('#filterGroup .list-btn')].find((b) => /All/.test(b.textContent)).click()")
time.sleep(0.3)
ev("document.getElementById('positionToolsBtn').click()")
time.sleep(0.4)
stav = json.loads(ev(STAV) or '{}')
over(not stav.get('nastroje') and not stav.get('tecka'), 'druhé klepnutí sbalí, výchozí filtr bez tečky')

ulozeno = json.loads(ev("localStorage.getItem('perpdesk.stat30') || '{}'") or '{}')
over(any(v.get('body') for v in ulozeno.values()), 'statistika uložená v telefonu')

print('rozevřený Fold a přenačtení')
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=2, mobile=True)
time.sleep(0.6)
sirka = ev("Math.round(document.getElementById('stat30Graf').getBoundingClientRect().width)")
vb = ev("document.getElementById('stat30Graf').getAttribute('viewBox')") or ''
print('   šířka grafu:', sirka, 'viewBox:', vb)
over(vb.split(' ')[2:3] == [str(sirka)], 'křivka se překreslila na novou šířku')
snimek('pozice-673.png')
p.prikaz('Page.reload')
time.sleep(1.2)
stav = json.loads(ev(STAV) or '{}')
over(stav.get('body', 0) >= 1, 'po přenačtení je statistika hned (z telefonu)')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
