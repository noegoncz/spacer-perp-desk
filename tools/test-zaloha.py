# -*- coding: utf-8 -*-
"""
Záloha a obnova dat (js/zaloha.js).

Ověřuje:
  * záloha obsahuje seznamy, kresby, alarmy a nastavení, ale **nikdy
    API klíč ani secret**,
  * v APK jde soubor přes nativní Filesystem + Share (tady podstrčené),
    ve starším APK bez pluginů do schránky, v prohlížeči stažením,
  * obnova ze souboru (skutečný výběr souboru přes CDP) nahradí data,
    klíče nechá být a stránka se přenačte,
  * cizí soubor odmítne.

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
window.__stazeno = null;
const puvodniUrl = URL.createObjectURL;
URL.createObjectURL = (blob) => { blob.text().then((t) => { window.__stazeno = t; }); return puvodniUrl(blob); };
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


def zprava():
    return ev("document.getElementById('backupMsg').textContent") or ''


p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.5)

print('1) prohlížeč — stažení souboru')
ev("document.getElementById('backupExportBtn').click()")
time.sleep(0.8)
text = ev("window.__stazeno")
over(bool(text), 'záloha se stáhla')
z = json.loads(text or '{}')
d = z.get('data', {})
over(z.get('aplikace') == 'PerpyX' and z.get('typ') == 'zaloha', 'hlavička zálohy')
over('perpdesk.lists' in d and 'perpdesk.drawings.JUPUSDT' in d and 'perpdesk.alarms' in d,
     'obsahuje seznamy, kresby a alarmy')
over(not any(k in d for k in ('perpdesk.apiKey', 'perpdesk.apiSecret')) and 'FAKESECRET' not in (text or ''),
     'NEOBSAHUJE API klíč ani secret')
over('perpdesk.coinCategories' not in d, 'stažené kategorie se nezálohují')

print('2) APK — nativní sdílení')
ev("""window.Capacitor = { isNativePlatform: () => true, Plugins: {
  Filesystem: { writeFile: async (o) => { window.__zapsano = o; return { uri: 'file:///cache/' + o.path }; } },
  Share: { share: async (o) => { window.__sdileno = o; } } } };""")
ev("document.getElementById('backupExportBtn').click()")
time.sleep(0.5)
zap = ev("window.__zapsano") or {}
sd = ev("window.__sdileno") or {}
over(zap.get('directory') == 'CACHE' and zap.get('path', '').startswith('perpyx-backup-'), f'soubor zapsán do cache ({zap.get("path")})')
over(sd.get('files') == ['file:///cache/' + zap.get('path', '')], 'nabídnut ke sdílení')
over('choose where' in zprava(), f'hláška o sdílení ({zprava()[:40]})')

ev("window.Capacitor.Plugins.Share.share = async () => { throw new Error('Share canceled'); }")
ev("document.getElementById('backupMsg').hidden = true")
ev("document.getElementById('backupExportBtn').click()")
time.sleep(0.5)
over(ev("document.getElementById('backupMsg').hidden"), 'zrušené sdílení nehlásí chybu')

print('3) starší APK bez pluginů — schránka')
ev("""window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
navigator.clipboard.writeText = async (t) => { window.__schranka = t; };""")
ev("document.getElementById('backupExportBtn').click()")
time.sleep(0.5)
over('"aplikace": "PerpyX"' in (ev("window.__schranka") or ''), 'záloha ve schránce')
over('clipboard' in zprava(), 'hláška o schránce')
ev("delete window.Capacitor")

print('4) obnova ze souboru')
zmenena = dict(z)
zmenena['data'] = dict(d)
zmenena['data']['perpdesk.lists'] = json.dumps({'verze': 1, 'aktivni': 'all',
    'seznamy': [{'id': 'x', 'nazev': 'Z obnovy', 'polozky': ['bybit:SOLUSDT']}]})
zmenena['data']['perpdesk.apiKey'] = 'PODVRZENY'   # obnova ho nesmí zapsat
soubor = os.path.join(tempfile.gettempdir(), 'perpyx-zaloha-test.json')
with open(soubor, 'w', encoding='utf-8') as f:
    json.dump(zmenena, f)
ev("localStorage.setItem('perpdesk.drawings.ETHUSDT', '[]')")   # po obnově má zmizet
uzel = p.prikaz('DOM.getDocument')['root']['nodeId']
vstup = p.prikaz('DOM.querySelector', nodeId=uzel, selector='#backupFile')['nodeId']
p.prikaz('DOM.setFileInputFiles', nodeId=vstup, files=[soubor])
time.sleep(3)
seznamy = json.loads(ev("localStorage.getItem('perpdesk.lists')") or '{}').get('seznamy', [])
over(seznamy and seznamy[0]['nazev'] == 'Z obnovy', 'seznamy nahrazené zálohou')
over(ev("localStorage.getItem('perpdesk.drawings.ETHUSDT')") is None, 'data mimo zálohu smazaná (záloha = celý stav)')
# ⚠ Mock klíč při každém načtení stránky zapíše znovu, proto se obnova
# klíče ověřuje přímo voláním modulu, bez přenačtení.
klic = ev("""import('./js/zaloha.js').then((m) => {
  m.obnov({ data: { 'perpdesk.apiKey': 'PODVRZENY', 'perpdesk.apiSecret': 'X', 'perpdesk.magnet': '1' } });
  return [localStorage.getItem('perpdesk.apiKey'), localStorage.getItem('perpdesk.magnet')].join('|');
})""", cekat=True)
over(klic == 'FAKEKEY1234567890ab|1', f'obnova nezapíše klíč ze souboru, ostatní ano ({klic})')
over(ev("localStorage.getItem('perpdesk.coinCategories')") is not None, 'stažené kategorie zůstaly')

print('5) cizí soubor')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.5)
cizi = os.path.join(tempfile.gettempdir(), 'perpyx-cizi.json')
with open(cizi, 'w', encoding='utf-8') as f:
    f.write('{"hello": 1}')
uzel = p.prikaz('DOM.getDocument')['root']['nodeId']
vstup = p.prikaz('DOM.querySelector', nodeId=uzel, selector='#backupFile')['nodeId']
p.prikaz('DOM.setFileInputFiles', nodeId=vstup, files=[cizi])
time.sleep(0.8)
over('not a PerpyX backup' in zprava(), f'cizí soubor odmítnut ({zprava()})')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
