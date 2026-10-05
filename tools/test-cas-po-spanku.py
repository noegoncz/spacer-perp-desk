# -*- coding: utf-8 -*-
"""
Nesoulad času po probuzení z pozadí (v0.31.5).

Po dlouhém spánku aplikace hlásil Bybit 10002 a v liště chyb na chvíli
viselo „Clock mismatch", přestože hodiny telefonu byly v pořádku.
Aplikace teď na 10002 znovu změří čas serveru a dotaz jednou potichu
zopakuje.

Test: mock odpoví na první podepsaný dotaz na pozice chybou 10002.
Pozice se musí načíst a lišta chyb nesmí nic ukázat. Když 10002 přijde
pořád (hodiny opravdu mimo), hláška se ukázat musí.

Spuštění: python tools/test-cas-po-spanku.py http://localhost:8080/index.html
Na starém kódu padá (lišta ukáže „Clock mismatch").
"""
import os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()


def podvrh(kolikrat):
    return mock + """
(() => {
  let zbyva = %d;
  window.__chyby10002 = 0;
  window.__lista = [];
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/position/list') && zbyva !== 0) {
      if (zbyva > 0) zbyva -= 1;
      window.__chyby10002 += 1;
      return Promise.resolve(new Response(JSON.stringify({ retCode: 10002,
        retMsg: 'invalid request, please check your server timestamp or recv_window param', result: {} }),
        { status: 200 }));
    }
    return puvodni(vstup, volby);
  };
  // Zaznamenat všechno, co se kdy v liště chyb objevilo (i na chvíli).
  document.addEventListener('DOMContentLoaded', () => {
    const lista = document.getElementById('errorBar');
    new MutationObserver(() => {
      if (!lista.hidden && lista.textContent.trim()) window.__lista.push(lista.textContent.trim());
    }).observe(lista, { attributes: true, childList: true, subtree: true, characterData: true });
  });
})();
""" % kolikrat


p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
skript = None


def spust(kolikrat):
    global skript
    if skript:
        p.prikaz('Page.removeScriptToEvaluateOnNewDocument', identifier=skript)
    # Čisté úložiště, ať druhý běh nezačíná se stavem z prvního.
    p.prikaz('Runtime.evaluate', expression="try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}")
    skript = p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=podvrh(kolikrat)).get('identifier')
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(8)

    def ev(v):
        r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
        return r.get('result', {}).get('value')
    return ev


chyby = []

print('1) jednou 10002 (spánek na pozadí)')
ev = spust(1)
karet = ev("document.querySelectorAll('.position, .pos-card').length")
lista = ev("window.__lista")
print('   pozic:', karet, ' 10002 vráceno:', ev("window.__chyby10002"), ' lišta:', lista)
if not karet:
    chyby.append('po jednom 10002 se pozice nenačetly')
if lista:
    chyby.append(f'po jednom 10002 se ukázala hláška: {lista}')

print('2) 10002 pořád (hodiny opravdu mimo)')
ev = spust(-1)
lista = ev("window.__lista") or []
print('   lišta:', lista)
if not any('Clock' in x or 'clock' in x for x in lista):
    chyby.append('při trvalém 10002 se hláška o hodinách neukázala')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
    sys.exit(1)
print('VÝSLEDEK: VŠE V POŘÁDKU')
