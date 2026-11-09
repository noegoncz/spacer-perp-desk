# -*- coding: utf-8 -*-
"""
Dashboard reaguje po návratu z jiné aplikace (hlášeno uživatelem 2026-11-09:
„někdy při přechodu mezi aplikacemi pak nereaguje hlavní dashboard").

Android při přepnutí aplikace stránku skryje (visibilitychange) a po chvíli
zmrazí (časovače stojí — to CDP spolehlivě napodobit neumí); dotyk rozpracovaný v okamžiku přepnutí často
nedostane touchend ani touchcancel. Test to napodobí přes CDP
(podstrčené visibilityState) v několika
situacích a po návratu klepne skutečným dotykem na záložku a na kartu:
  A) prostý odchod a návrat,
  B) prst na kartě pozice v okamžiku odchodu (bez touchend),
  C) rozpracované vodorovné přejetí (bez touchend),
  D) podržená dlaždice ve Watchlists (bez touchend),
  E) otevřený graf, odchod, návrat, zpět.
Měří i dlouhé úlohy po návratu (zaseknuté hlavní vlákno = „nereaguje").

Spuštění: python tools/test-navrat-z-pozadi.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  let vis = 'visible';
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => vis });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => vis === 'hidden' });
  window.__nastavViditelnost = (v) => { vis = v; document.dispatchEvent(new Event('visibilitychange')); };
  window.__dlouhe = [];
  window.__ud = [];
  for (const t of ['touchstart', 'touchend', 'touchcancel', 'click'])
    document.addEventListener(t, (e) => window.__ud.push(t + ':' + (e.target?.dataset?.tab || String(e.target?.className || e.target?.tagName).slice(0, 20))
      + (e.touches ? '/' + e.touches.length : '')), true);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__dlouhe.push([Math.round(e.startTime), Math.round(e.duration)])))
      .observe({ type: 'longtask', buffered: true });
  } catch {}
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Emulation.setCPUThrottlingRate', rate=4)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(8)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def stred(sel):
    return json.loads(ev(f"""(() => {{ const e = document.querySelector({json.dumps(sel)});
      if (!e) return 'null'; const b = e.getBoundingClientRect();
      return JSON.stringify([b.left + b.width / 2, b.top + b.height / 2]); }})()""") or 'null')


def dotyk(typ, x=None, y=None):
    body = [] if x is None else [{'x': x, 'y': y, 'radiusX': 6, 'radiusY': 6, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type=typ, touchPoints=body)


def klepni(x, y):
    dotyk('touchStart', x, y)
    time.sleep(0.12)
    dotyk('touchEnd')


def odejdi_a_vrat(sekund=3, prst=False):
    # Android při přepnutí aplikace rozpracovaný dotyk zruší (touchcancel).
    # Bez toho CDP další touchStart se stejným id tiše zahodí — vypadalo by
    # to jako zaseknutá aplikace, ale je to vrtoch testu (ověřeno výpisem
    # událostí: první klepnutí nedoručilo vůbec nic).
    if prst:
        dotyk('touchCancel')
    ev("window.__nastavViditelnost('hidden')")
    time.sleep(0.2)
    # Page.setWebLifecycleState('frozen') nejde: po rozmrazení CDP už
    # nedoručí dotyk ani na prázdné stránce (vrtoch prohlížeče, ověřeno).
    time.sleep(sekund)
    ev("window.__dlouhe.length = 0; window.__navrat = performance.now()")
    ev("window.__nastavViditelnost('visible')")
    time.sleep(0.4)


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def zalozka():
    return ev("document.querySelector('.tab.active, .tab[aria-selected=true]')?.dataset.tab")


def na_zalozku(tab):
    s = stred(f'.tab[data-tab="{tab}"]')
    klepni(*s)
    time.sleep(0.8)
    return zalozka() == tab


def otevri_kartu():
    na_zalozku('positions')
    s = stred('.position')
    if not s:
        return False
    klepni(*s)
    time.sleep(1.5)
    ok = bool(ev("!document.getElementById('viewChart')?.hidden && !!document.querySelector('#viewChart')"))
    ok = ok or bool(ev("document.documentElement.classList.contains('graf-otevreny')"))
    if ok:
        ev("history.back()")
        time.sleep(1.2)
    return ok


def kontrola(nazev):
    ev("window.__ud.length = 0")
    over(na_zalozku('watchlist'), f'{nazev}: klepnutí na záložku Watchlists')
    print('     události prvního klepnutí:', ev("window.__ud.join(' ')"))
    over(na_zalozku('positions'), f'{nazev}: klepnutí na záložku Pozice')
    over(otevri_kartu(), f'{nazev}: klepnutí na kartu otevře graf')
    dl = ev("JSON.stringify(window.__dlouhe)")
    print('     dlouhé úlohy po návratu [začátek, ms]:', dl)


print('0) výchozí stav')
over(zalozka() == 'positions', 'start na Pozicích')
over(otevri_kartu(), 'karta otevře graf')

print('A) prostý odchod a návrat')
odejdi_a_vrat()
kontrola('A')

print('B) prst na kartě v okamžiku odchodu')
s = stred('.position')
dotyk('touchStart', *s)
time.sleep(0.15)
odejdi_a_vrat(prst=True)
kontrola('B')

print('C) rozpracované vodorovné přejetí')
dotyk('touchStart', 250, 500)
for i in range(1, 6):
    time.sleep(0.03)
    dotyk('touchMove', 250 - i * 20, 502)
odejdi_a_vrat(prst=True)
kontrola('C')

print('D) podržená dlaždice ve Watchlists')
na_zalozku('watchlist')
s = stred('.tile, .market-tile, [data-klic]')
if s:
    dotyk('touchStart', *s)
    time.sleep(0.8)
    odejdi_a_vrat(prst=True)
    print('     třídy dlaždice:', ev("document.querySelector('.drzena') ? 'drzena' : '-'"))
    kontrola('D')
else:
    print('     (žádná dlaždice — přeskakuji)')

print('E) otevřený graf, odchod, návrat, zpět')
na_zalozku('positions')
klepni(*stred('.position'))
time.sleep(1.5)
odejdi_a_vrat()
ev("history.back()")
time.sleep(1.2)
kontrola('E')

print('F) dlouhý odchod (20 s)')
odejdi_a_vrat(20)
kontrola('F')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:300]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
