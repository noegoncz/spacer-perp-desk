# -*- coding: utf-8 -*-
"""
Obsah zálohy a obnova dat (js/zaloha.js).

Ověřuje:
  * záloha (obsah cloudové zálohy účtu) obsahuje seznamy, kresby, alarmy
    a nastavení, ale **nikdy API klíč ani secret**,
  * v nastavení není stažení ani obnova ze souboru (v0.58.1),
  * obnova (tu dělá účet po přihlášení; tlačítko obnovy ze souboru zmizelo
    ve v0.58.0) nahradí data a klíče nechá být,
  * cizí soubor modul odmítne.

Spuštění: python tools/test-zaloha.py http://localhost:8075/index.html
"""
import os, sys, time, json, tempfile
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  if (sessionStorage.getItem('__pripraveno')) return;
  sessionStorage.setItem('__pripraveno', '1');
  localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'all',
    seznamy: [{ id: 'fav', nazev: 'My watchlist', polozky: ['bybit:BTCUSDT', 'bybit:ETHUSDT'] }] }));
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([{ name: 'segment',
    points: [{ timestamp: 1, value: 1 }, { timestamp: 2, value: 2 }] }]));
  localStorage.setItem('perpdesk.alarms', JSON.stringify([{ id: 'a1', symbol: 'JUPUSDT', typ: 'cena', cena: 0.31 }]));
  localStorage.setItem('perpdesk.coinCategories', JSON.stringify({ coiny: {} }));
})();
window.confirm = () => true;
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable', 'DOM.enable'):
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


p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.5)

print('1) obsah zálohy (jde na účet)')
over(ev("!document.getElementById('backupExportBtn')"), 'v nastavení není stažení dat (v0.58.1: účet zálohuje sám)')
text = ev("import('./js/zaloha.js').then((m) => JSON.stringify(m.sestavZalohu()))", cekat=True)
z = json.loads(text or '{}')
d = z.get('data', {})
over(z.get('aplikace') == 'PerpyX' and z.get('typ') == 'zaloha', 'hlavička zálohy')
over('perpdesk.lists' in d and 'perpdesk.drawings.JUPUSDT' in d and 'perpdesk.alarms' in d,
     'obsahuje seznamy, kresby a alarmy')
over(not any(k in d for k in ('perpdesk.apiKey', 'perpdesk.apiSecret')) and 'FAKESECRET' not in (text or ''),
     'NEOBSAHUJE API klíč ani secret')
over('perpdesk.coinCategories' not in d, 'stažené kategorie se nezálohují')

print('4) obnova (modul, jak ho volá účet)')
over(ev("!document.getElementById('backupImportBtn') && !document.getElementById('backupFile')"),
     'v nastavení už není obnova ze souboru (jen stažení dat)')
zmenena = dict(z)
zmenena['data'] = dict(d)
zmenena['data']['perpdesk.lists'] = json.dumps({'verze': 1, 'aktivni': 'all',
    'seznamy': [{'id': 'x', 'nazev': 'Z obnovy', 'polozky': ['bybit:SOLUSDT']}]})
zmenena['data']['perpdesk.apiKey'] = 'PODVRZENY'   # obnova ho nesmí zapsat
ev("localStorage.setItem('perpdesk.drawings.ETHUSDT', '[]')")   # po obnově má zmizet
vysl = ev("""import('./js/zaloha.js').then((m) => {
  m.obnov(m.prectiZalohu(%s));
  return JSON.stringify([localStorage.getItem('perpdesk.lists'), localStorage.getItem('perpdesk.drawings.ETHUSDT'),
    localStorage.getItem('perpdesk.apiKey')]);
})""" % json.dumps(json.dumps(zmenena)), cekat=True)
seznamy_json, kresba_eth, klic = json.loads(vysl or '[null, null, null]')
seznamy = json.loads(seznamy_json or '{}').get('seznamy', [])
over(seznamy and seznamy[0]['nazev'] == 'Z obnovy', 'seznamy nahrazené zálohou')
over(kresba_eth is None, 'data mimo zálohu smazaná (záloha = celý stav)')
over(klic == 'FAKEKEY1234567890ab', f'obnova nezapíše klíč ze zálohy ({klic})')
over(ev("localStorage.getItem('perpdesk.coinCategories')") is not None, 'stažené kategorie zůstaly')

print('5) cizí soubor')
cizi = ev("""import('./js/zaloha.js').then((m) => { try { m.prectiZalohu('{"hello": 1}'); return 'prijato'; }
  catch (e) { return 'odmitnuto'; } })""", cekat=True)
over(cizi == 'odmitnuto', 'cizí soubor odmítnut')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
