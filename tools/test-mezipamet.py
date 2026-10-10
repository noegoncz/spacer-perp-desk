# -*- coding: utf-8 -*-
"""
Mezipaměť uzavřených obchodů a plnění v telefonu (v0.39.0).

  * Co se jednou stáhlo, je příště v Historii hned — i když burza
    odpovídá pomalu (mock ji při druhém načtení zdrží o 3 s).
  * Z burzy se pak dotahuje jen úsek od posledního stažení (s hodinovým
    překryvem), ne znovu celé období.
  * Rozšíření tlačítkem „Load 30 more days" se taky uloží.
  * ⟳ v Historii stáhne znovu celé načtené období (plná kontrola).
  * Odpojení burzy mezipaměť smaže.

Spuštění: python tools/test-mezipamet.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  window.__log = [];
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    const m = /\\/v5\\/(position\\/closed-pnl|execution\\/list)\\?.*startTime=(\\d+)/.exec(u);
    if (m) window.__log.push({ co: m[1], od: Number(m[2]), cas: performance.now() });
    if (m && m[1] === 'position/closed-pnl' && sessionStorage.getItem('__pomalu')) {
      return new Promise((ok) => setTimeout(ok, 3000)).then(() => puvodni(vstup, volby));
    }
    return puvodni(vstup, volby);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


karet = lambda: ev("document.querySelectorAll('#historyList .trade').length") or 0
log = lambda: json.loads(ev("JSON.stringify(window.__log)") or '[]')
KLICE_DB = """new Promise((ok) => { const r = indexedDB.open('perpyx-mezipamet', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('data');
  r.onsuccess = () => { const tx = r.result.transaction('data', 'readonly');
    const k = tx.objectStore('data').getAllKeys(); k.onsuccess = () => { ok(JSON.stringify(k.result)); r.result.close(); }; };
  r.onerror = () => ok('[]'); })"""

print('1) první otevření Historie, „Load 30 more days“')
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(3)
ev("document.getElementById('historyMore').click()")
time.sleep(3)
prvni = karet()
klice = json.loads(ev(KLICE_DB, True) or '[]')
print('   obchodů:', prvni, ' v telefonu:', klice)
over(prvni == 3, 'tři obchody (37 dní)')
over('historie' in klice and any(k.startswith('plneni:') for k in klice), 'obchody i plnění se uložily do telefonu')

print('2) další spuštění, burza pomalá (3 s)')
ev("sessionStorage.setItem('__pomalu', '1')")
p.prikaz('Page.reload')
time.sleep(5)
ev("window.__log = []")
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(0.8)
hned = karet()
print('   obchodů po 0,8 s (burza ještě neodpověděla):', hned)
over(hned == 3, 'uložené obchody jsou vidět hned, i rozšířené období')
time.sleep(3.5)
zaznam = log()
ted = ev("Date.now()")
closed = [z for z in zaznam if z['co'] == 'position/closed-pnl']
plneni = [z for z in zaznam if z['co'] == 'execution/list']
print('   dotazy na pozadí:', [(z['co'], round((ted - z['od']) / 3600e3, 1)) for z in zaznam])
over(len(closed) == 1 and ted - closed[0]['od'] < 3 * 3600e3, 'uzavřené obchody: jen jeden dotaz na poslední úsek (~1 h)')
over(all(ted - z['od'] < 3 * 3600e3 for z in plneni), 'plnění: jen poslední úsek, ne znovu 37 dní')
over(karet() == 3, 'po doplnění pořád tři obchody (nic se nezdvojilo)')

print('3) ⟳ v Historii = plná kontrola')
ev("sessionStorage.removeItem('__pomalu'); window.__log = []")
ev("document.getElementById('refreshBtn').click()")
time.sleep(3)
closed = [z for z in log() if z['co'] == 'position/closed-pnl']
print('   dotazů na closed-pnl:', len(closed))
over(len(closed) >= 6, 'stáhne znovu celé načtené období (6 týdenních oken)')
over(karet() == 3, 'po kontrole tři obchody')

print('4) odpojení burzy smaže mezipaměť')
ev("window.confirm = () => true; document.getElementById('settingsBtn').click()")
time.sleep(1)
ev("[...document.querySelectorAll('button.text-btn.danger')].find((b) => b.textContent === 'Disconnect').click()")
time.sleep(1.5)
klice = json.loads(ev(KLICE_DB, True) or '[]')
print('   v telefonu po odpojení:', klice)
over(not any(k == 'historie' or k.startswith('plneni:') for k in klice), 'uložené obchody a plnění jsou pryč')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
