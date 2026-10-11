# -*- coding: utf-8 -*-
"""
Watchlists připravené dopředu (v0.48.0).

1) Po startu, jakmile dorazí pozice, se **bez otevření Watchlists**
   stáhnou ceny párů a mini-grafy všech párů ze seznamů.
2) Otevření Watchlists pak ukáže dlaždice hned s cenou i mini-grafem.
3) Po přenačtení s **pomalou burzou** (ceny a svíčky zdržené o 4 s) jsou
   dlaždice plné hned ze snímku v telefonu, ne prázdné.
4) Nástroje bývalého „All" (hledání) během načítání neprobliknou.

Na starém kódu padá. Spuštění:
python tools/test-watchlist-predem.py http://localhost:8075/index.html
"""
import os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!localStorage.getItem('perpdesk.lists')) localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
  seznamy: [{ id: 'a', nazev: 'Main', polozky: ['bybit:JUPUSDT', 'bybit:BTCUSDT'] },
            { id: 'b', nazev: 'Second', polozky: ['bybit:ETHUSDT'] }] }));
(() => {
  window.__dotazy = { tickery: 0, grafy: 0 };
  const pomalu = sessionStorage.getItem('__pomalaBurza') === '1';
  const f = window.fetch;
  window.fetch = function (v, o) {
    const u = String(v && v.url ? v.url : v);
    const tickery = u.includes('/v5/market/tickers') && !u.includes('symbol=');
    const graf = u.includes('/v5/market/kline') && u.includes('limit=24');
    if (tickery) window.__dotazy.tickery += 1;
    if (graf) window.__dotazy.grafy += 1;
    const odpoved = () => (tickery
      ? Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: [
          ['JUPUSDT', '0.30580'], ['BTCUSDT', '83000'], ['ETHUSDT', '2500']].map(([symbol, lastPrice]) => ({
          symbol, lastPrice, price24hPcnt: '0.0123', turnover24h: '1234567', fundingRate: '0.0001',
          nextFundingTime: String(Date.now() + 3600e3) })) } }), { status: 200 }))
      : f(v, o));
    if (pomalu && (tickery || graf)) return new Promise((r) => setTimeout(r, 4000)).then(odpoved);
    return odpoved();
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)


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


DLAZDICE = """JSON.stringify([...document.querySelectorAll('#watchList .tile')].map((t) => ({
  s: t.dataset.symbol, cena: (t.querySelector('.tile-cena') || {}).textContent || '',
  graf: !!t.querySelector('.watch-spark polyline') })))"""

print('1) předčtení po startu')
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)
d = ev("window.__dotazy")
print('   dotazy bez otevření Watchlists:', d)
over(d and d['tickery'] >= 1, 'ceny párů se stáhly bez otevření Watchlists')
over(d and d['grafy'] >= 3, 'mini-grafy všech tří párů ze seznamů se stáhly')
over(ev("!!localStorage.getItem('perpdesk.trhySnimek')"), 'snímek trhů je uložený v telefonu')

print('2) otevření Watchlists je hned plné')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(0.15)
import json
dl = json.loads(ev(DLAZDICE) or '[]')
print('   dlaždice:', dl)
over(len(dl) == 2 and all(x['cena'] and x['graf'] for x in dl), 'dlaždice mají hned cenu i mini-graf')
ev("document.querySelector('#watchLists .list-tab[data-id=b]').click()")
time.sleep(0.15)
dl = json.loads(ev(DLAZDICE) or '[]')
over(len(dl) == 1 and dl[0]['graf'], f'i druhý seznam má mini-graf hned ({dl})')

print('3) přenačtení s pomalou burzou')
ev("sessionStorage.setItem('__pomalaBurza', '1')")
ev("document.querySelector('.tab[data-tab=positions]').click()")
p.prikaz('Page.reload')
time.sleep(2.5)
nastroje = []
ev("""(() => { window.__nastroje = 0; const t = document.getElementById('watchTools');
  new MutationObserver(() => { if (!t.hidden) window.__nastroje += 1; }).observe(t, { attributes: true }); })()""")
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(0.3)
dl = json.loads(ev(DLAZDICE) or '[]')
print('   dlaždice při zdržené burze:', dl)
over(len(dl) >= 1 and all(x['cena'] and x['graf'] for x in dl), 'dlaždice jsou plné ze snímku, ne prázdné')
over(ev("document.getElementById('watchTools').hidden") and not ev("window.__nastroje"),
     'hledání bývalého „All" nebliká')
time.sleep(5)
over((ev("window.__dotazy.tickery") or 0) >= 1, 'čerstvé ceny se po chvíli dotáhly')
ev("sessionStorage.removeItem('__pomalaBurza')")

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
