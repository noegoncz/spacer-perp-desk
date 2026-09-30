# -*- coding: utf-8 -*-
"""
Start bez probliknutí a pohodlné tlačítko zpět v grafu (v0.24.1).

  1. při startu se místo „Loading positions…", „Try again" a diagnostiky
     ukážou jen tiché obrysy karet (hlášeno z telefonu: text s tlačítkem
     na chvilku probleskl a vypadal jako chyba),
  2. když pozice nejdou ani po 6 s, diagnostika a „Try again" se ukážou,
  3. tlačítko zpět v grafu: na rozevřeném Foldu vyplní místo za
     timeframy, na úzkém displeji je aspoň dvakrát širší než dřív (56 px),
     a nikdy nesahá až k pravému kraji.

Spuštění: python tools/test-start-a-zpet.py http://localhost:8075/index.html
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
  const rezim = sessionStorage.getItem('__pozice') || '';
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/position/list')) {
      if (rezim === 'visi') return new Promise(() => {});
      if (rezim === 'pomalu') return new Promise((r) => setTimeout(() => r(puvodni(vstup, volby)), 2500));
    }
    return puvodni(vstup, volby);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock + '\n' + po)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return None if 'exceptionDetails' in r else r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def rozmery(w, h):
    p.prikaz('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=1, mobile=True)


rozmery(344, 882)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(0.5)
ev("sessionStorage.setItem('__pozice', 'pomalu')")
p.prikaz('Page.reload')
time.sleep(1.2)
print('1) start')
stav = ev("""JSON.stringify({
  nacitani: document.getElementById('placeholder').classList.contains('nacitani'),
  kostry: getComputedStyle(document.querySelector('.kostry')).display,
  text: getComputedStyle(document.getElementById('placeholderText')).display === 'none' ? '' : document.getElementById('placeholderText').textContent,
  retry: !document.getElementById('retryBtn').hidden,
  diag: !document.getElementById('diagLine').hidden })""")
s = json.loads(stav or '{}')
over(s.get('nacitani') and s.get('kostry') == 'grid', f'při načítání obrysy karet ({s})')
over(not s.get('text') and not s.get('retry') and not s.get('diag'), 'žádný text, Try again ani diagnostika')
time.sleep(3)
over(ev("document.querySelectorAll('.position').length") > 0, 'po načtení pozice')

print('2) když pozice nejdou')
ev("sessionStorage.setItem('__pozice', 'visi')")
p.prikaz('Page.reload')
time.sleep(3)
over(ev("document.getElementById('retryBtn').hidden"), 'po 3 s ještě nic nestraší')
time.sleep(5)
over(not ev("document.getElementById('retryBtn').hidden") and not ev("document.getElementById('diagLine').hidden"),
     'po 6 s diagnostika a Try again')
ev("sessionStorage.removeItem('__pozice')")

print('3) tlačítko zpět')
for w, h, nazev, min_sirka in ((673, 841, 'rozevřený Fold', 150), (344, 882, 'zavřený Fold', 104)):
    rozmery(w, h)
    p.prikaz('Page.reload')
    time.sleep(4)
    ev("document.querySelector('.position').click()")
    time.sleep(2.5)
    r = json.loads(ev("""(() => { const b = document.getElementById('chartBackBtnDole').getBoundingClientRect();
      const posl = [...document.querySelectorAll('.interval-btn[data-interval]')].pop().getBoundingClientRect();
      const lista = document.querySelector('.intervals').getBoundingClientRect();
      return JSON.stringify({ sirka: b.width, vpravo: innerWidth - b.right, odTf: b.left - Math.min(posl.right, lista.right) }); })()""") or '{}')
    print(f'   {nazev}: {r}')
    over(r.get('sirka', 0) >= min_sirka, f'{nazev}: tlačítko zpět široké ({r.get("sirka")} px)')
    over(r.get('vpravo', 0) >= 10, f'{nazev}: odstup od pravého kraje ({r.get("vpravo")} px)')
    over(r.get('odTf', -1) >= 0, f'{nazev}: nepřekrývá timeframy')
    ev("history.back()")
    time.sleep(1)

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
