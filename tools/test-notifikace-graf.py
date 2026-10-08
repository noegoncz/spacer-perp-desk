# -*- coding: utf-8 -*-
"""
Klepnutí na notifikaci alarmu otevře graf páru — s otevřenou pozicí (v0.25.0).

Dřív se graf z notifikace otevíral jako z Trhů, **bez pozice** (žádné čáry
vstupu, SL, TP ani PnL), a po probuzení telefonu klepnutí mohlo přijít
dřív, než dorazily pozice. Test:

  1. studený start s pomalými pozicemi (2 s) a klepnutím hned na začátku
     → graf JUPUSDT se otevře až s pozicí (panel údajů o pozici),
  2. otevřený graf jiného páru → nahradí ho graf z notifikace a v historii
     přibude jen jeden záznam (zpět zavře graf jedním klepnutím),
  3. pár bez pozice → graf bez pozice, bez zbytečného čekání.

Push plugin Capacitoru je podstrčený (jako v test-alarmy-server.py),
volání perpyx.com zachycená.

Spuštění: python tools/test-notifikace-graf.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('perpyx.com')) return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    if (u.includes('/v5/position/list') && sessionStorage.getItem('__pomalu'))
      return new Promise((r) => setTimeout(() => r(puvodni(vstup, volby)), 2000));
    return puvodni(vstup, volby);
  };
  const posluchaci = {};
  window.__klepni = (symbol) => (posluchaci.pushNotificationActionPerformed || [])
    .forEach((f) => f({ notification: { data: { symbol, alarmId: 'x' } } }));
  window.__maPosluchace = () => Boolean((posluchaci.pushNotificationActionPerformed || []).length);
  window.Capacitor = { isNativePlatform: () => true, Plugins: { PushNotifications: {
    createChannel: async () => {},
    checkPermissions: async () => ({ receive: 'granted' }),
    requestPermissions: async () => ({ receive: 'granted' }),
    addListener: async (jmeno, fn) => { (posluchaci[jmeno] ||= []).push(fn); return { remove() {} }; },
    register: async () => { setTimeout(() => (posluchaci.registration || []).forEach((f) => f({ value: 'tok' })), 20); },
  } } };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock + '\n' + po)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return None if 'exceptionDetails' in r else r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


graf = lambda: json.loads(ev("""JSON.stringify({ otevreny: !document.getElementById('viewChart').hidden,
  par: document.getElementById('chartSymbol').textContent,
  pozice: Boolean(document.getElementById('chartBadge').textContent.trim()) })""") or '{}')

p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(0.5)
ev("sessionStorage.setItem('__pomalu', '1')")
# Bez uloženého posledního stavu (v0.34.0) — test ověřuje čekání na pozice.
ev("localStorage.removeItem('perpdesk.startSnimek')")
p.prikaz('Page.reload')
print('1) studený start, pozice přijdou za 2 s')
for _ in range(40):
    if ev("window.__maPosluchace && window.__maPosluchace()"):
        break
    time.sleep(0.05)
ev("window.__klepni('JUPUSDT')")
time.sleep(0.6)
g = graf()
over(not g.get('otevreny'), f'na pozice se čeká, graf ještě ne ({g})')
time.sleep(2.5)
g = graf()
over(g.get('otevreny') and g.get('par', '').startswith('JUP') and g.get('pozice'), f'graf JUPUSDT s pozicí ({g})')

print('2) otevřený graf jiného páru')
ev("sessionStorage.removeItem('__pomalu')")
ev("history.back()")
time.sleep(0.8)
delka = ev("history.length")
ev("window.__klepni('BTCUSDT')")
time.sleep(1.2)
g = graf()
over(g.get('otevreny') and g.get('par', '').startswith('BTC') and not g.get('pozice'), f'pár bez pozice: graf bez pozice ({g})')
ev("window.__klepni('JUPUSDT')")
time.sleep(1.2)
g = graf()
over(g.get('par', '').startswith('JUP') and g.get('pozice'), f'nahrazen grafem JUPUSDT s pozicí ({g})')
over(ev("history.length") - delka <= 1, 'v historii přibyl jen jeden záznam')
ev("history.back()")
time.sleep(0.8)
over(not graf().get('otevreny'), 'jedno zpět graf zavře')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
