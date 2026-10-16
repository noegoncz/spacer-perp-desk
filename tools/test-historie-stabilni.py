# -*- coding: utf-8 -*-
"""
Historie se při dalším otevření neskládá jinak (v0.59.11, hlášení
uživatele: obchody Bybitu se nejdřív ukázaly nesložené a pak se složily).

Po prvním načtení Historie (obchody i plnění v telefonu) se stránka
přenačte s pomalou burzou (plnění a uzavřené obchody zdržené o 4 s):
  a) plnění v telefonu jsou → první vykreslení je stejné jako konečné,
  b) plnění v telefonu chybí (např. po vyčištění mezipaměti) → Historie
     se neukáže nesložená; počká na plnění a ukáže rovnou složené obchody.

Spuštění: python tools/test-historie-stabilni.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  if (sessionStorage.getItem('__pomaleHistorie') !== '1') return;
  const f = window.fetch;
  window.fetch = function (v, o) {
    const u = String(v && v.url ? v.url : v);
    if (/execution\\/list|closed-pnl/.test(u)) return new Promise((ok) => setTimeout(ok, 4000)).then(() => f.call(this, v, o));
    return f.call(this, v, o);
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


KARTY = """JSON.stringify([...document.querySelectorAll('#historyList .trade')].map((k) =>
  k.querySelector('.trade-titul').textContent + ' ' + k.querySelectorAll('.trade-vystup').length))"""
karty = lambda: json.loads(ev(KARTY) or '[]')

ev("document.querySelector('.tab[data-tab=history]').click()")
time.sleep(5)
konecne = karty()
print('po prvním načtení:', konecne)
over(len(konecne) > 0, 'Historie má obchody')


def znovu(smazat_plneni):
    if smazat_plneni:
        ev("""new Promise((ok) => { const r = indexedDB.open('perpyx-mezipamet'); r.onsuccess = () => {
          const s = r.result.transaction('data', 'readwrite').objectStore('data'); const q = s.getAllKeys();
          q.onsuccess = () => { q.result.filter((k) => String(k).includes('|plneni:')).forEach((k) => s.delete(k)); };
          s.transaction.oncomplete = () => { r.result.close(); ok(); }; }; })""", True)
    ev("sessionStorage.setItem('__pomaleHistorie', '1')")
    p.prikaz('Page.reload')
    time.sleep(4)
    ev("document.querySelector('.tab[data-tab=history]').click()")
    videne = []
    for _ in range(40):
        time.sleep(0.25)
        k = karty()
        if not videne or videne[-1] != k:
            videne.append(k)
    ev("sessionStorage.removeItem('__pomaleHistorie')")
    return videne


print('a) plnění v telefonu')
videne = znovu(False)
print('   vykreslení:', videne)
over(all(v == konecne for v in videne if v), 'každé vykreslení je stejné jako konečné (nic se nepřeskládá)')

print('b) plnění v telefonu chybí')
videne = znovu(True)
print('   vykreslení:', videne)
nesložené = [v for v in videne if v and v != konecne]
over(not nesložené, f'Historie se neukázala nesložená ({nesložené[:1]})')
over(videne and videne[-1] == konecne, 'nakonec rovnou složené obchody')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
