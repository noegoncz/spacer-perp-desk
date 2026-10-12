# -*- coding: utf-8 -*-
"""
Kresby a alarmy patří jen ke svému grafu (v0.56.1, přání uživatele).

BTCUSDT na Bybitu a na Binance jsou dva grafy (svíčky se liší), takže se
kresby ani alarmy nesmí přenášet. Bybit si nechává dosavadní klíč
(`perpdesk.drawings.JUPUSDT`, alarm se `symbol: 'JUPUSDT'`), ostatní burzy
„burza:pár". Binance jde ze skutečné burzy bez klíče.

Ověřuje:
  * graf JUP z Bybitu má své 2 kresby a 1 alarm,
  * graf JUP z Binance jen svou 1 kresbu a žádný alarm,
  * smazání kreseb na Binance kresby Bybitu nechá,
  * na server jdou jen alarmy Bybitu (hlídač bere ceny z Bybitu).
Na starém kódu padá (Binance graf ukazuje kresby Bybitu).

Spuštění: python tools/test-graf-podle-burzy.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!sessionStorage.getItem('__grafBurzy')) {
  sessionStorage.setItem('__grafBurzy', '1');
  const t = Math.floor(Date.now() / 14400e3) * 14400e3;
  const cara = (v, c) => ({ name: 'horizontalStraightLine', points: [{ timestamp: t - 20 * 14400e3, value: v }],
    style: { color: c, width: 1, opacity: 1 } });
  localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
    seznamy: [{ id: 'a', nazev: 'Main', polozky: ['bybit:JUPUSDT', 'binance:JUPUSDT'] }] }));
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([cara(0.30, '#e6edf5'), cara(0.31, '#f0b90b')]));
  localStorage.setItem('perpdesk.drawings.binance:JUPUSDT', JSON.stringify([cara(0.33, '#22d3ee')]));
  localStorage.setItem('perpdesk.alarms', JSON.stringify([
    { id: 'a1', symbol: 'JUPUSDT', typ: 'cena', price: 0.32, smer: 'any', aktivni: true, opakovat: false },
    { id: 'a2', symbol: 'binance:XRPUSDT', typ: 'cena', price: 2, smer: 'any', aktivni: true, opakovat: false }]));
}
(() => {
  const f = window.fetch;
  window.__odeslaneAlarmy = null;
  window.fetch = function (v, o = {}) {
    const u = String(v && v.url ? v.url : v);
    if (u.startsWith('https://perpyx.com/api/account/alarms') && o.method === 'PUT') {
      try { window.__odeslaneAlarmy = JSON.parse(o.body).alarms.map((a) => a.symbol); } catch {}
    }
    return f(v, o);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


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


def otevri(klic):
    ev("document.querySelector('.tab[data-tab=watchlist]').click()")
    for _ in range(30):
        time.sleep(0.5)
        if ev(f"!!document.querySelector('#watchList .tile[data-klic=\"{klic}\"]')"):
            break
    ev(f"document.querySelector('#watchList .tile[data-klic=\"{klic}\"]').click()")
    for _ in range(30):
        time.sleep(0.5)
        if (ev("window.__graf ? window.__graf.getDataList().length : 0") or 0) > 50:
            break
    time.sleep(1)
    return {
        'kresby': sorted(ev("window.__graf.getOverlays({ groupId: 'kresby' }).map((o) => o.points[0].value)") or []),
        'alarmy': ev("window.__graf.getOverlays({ groupId: 'alarmy' }).length"),
    }


g = otevri('bybit:JUPUSDT')
print('Bybit:', g)
over(g['kresby'] == [0.3, 0.31] and g['alarmy'] == 1, 'graf Bybitu má své 2 kresby a 1 alarm')
ev("history.back()")
time.sleep(0.6)

g = otevri('binance:JUPUSDT')
print('Binance:', g)
over(g['kresby'] == [0.33], 'graf Binance má jen svou kresbu (ne kresby Bybitu)')
over(g['alarmy'] == 0, 'graf Binance nemá alarm z Bybitu')
ev("window.confirm = () => true")
ev("document.getElementById('eraseBtn').click()")
time.sleep(0.8)
ev("history.back()")
time.sleep(0.6)
over(ev("localStorage.getItem('perpdesk.drawings.binance:JUPUSDT')") in (None, '[]'), 'smazání na Binance smazalo kresby Binance')
over(len(json.loads(ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')") or '[]')) == 2, 'kresby Bybitu zůstaly')

for _ in range(10):
    if ev("window.__odeslaneAlarmy") is not None:
        break
    time.sleep(0.5)
odeslane = ev("window.__odeslaneAlarmy")
print('na server:', odeslane)
over(odeslane == ['JUPUSDT'], 'na server jdou jen alarmy Bybitu')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
