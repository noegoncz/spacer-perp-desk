# -*- coding: utf-8 -*-
"""
Měření startu aplikace — co ho zdržuje.

Simuluje telefon: procesor 4× zpomalený, síť se zpožděním (RTT ~150 ms)
a odpovědi Bybitu zdržené o ZPOZDENI_BYBIT ms (podstrčené, bez klíčů).
Měří se **druhé** načtení (service worker už má soubory v cache) —
tak startuje aplikace v telefonu.

Vypíše časovou osu od začátku navigace:
  * načtení a spuštění skriptů (DOMContentLoaded, start app.js, boot),
  * kdy se ukázaly obrysy karet a kdy první pozice,
  * všechny síťové požadavky (soubory i Bybit/perpyx.com) s časy,
  * dlouhé úlohy hlavního vlákna (> 50 ms) a vlastní čas skriptů.

Spuštění: python tools/mereni-startu.py http://localhost:8080/index.html
Výsledek i do %TEMP%/perpyx-start.json (srovnání před a po změně).
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

ZPOZDENI_BYBIT = 250
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
(() => {
  // Bybit a perpyx.com odpovídají se zpožděním jako přes mobilní síť.
  const puvodni = window.fetch;
  window.__dotazy = [];
  const t0 = performance.timeOrigin;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    const vzdaleny = /bybit|perpyx\\.com/.test(u);
    const zaznam = { url: u.replace(/^https?:\\/\\/[^/]+/, '').slice(0, 70), od: performance.now() };
    window.__dotazy.push(zaznam);
    const hotovo = (r) => { zaznam.do = performance.now(); return r; };
    if (!vzdaleny) return puvodni(vstup, volby).then(hotovo);
    return new Promise((ok) => setTimeout(ok, %d)).then(() => puvodni(vstup, volby)).then(hotovo);
  };
  window.__znacky = {};
  const znacka = (n) => { if (!window.__znacky[n]) window.__znacky[n] = Math.round(performance.now()); };
  document.addEventListener('DOMContentLoaded', () => znacka('DOMContentLoaded'));
  window.addEventListener('load', () => znacka('load'));
  new MutationObserver(() => {
    if (document.querySelector('.placeholder.nacitani, #placeholder.nacitani')) znacka('obrysy karet');
    if (document.querySelector('.position')) znacka('první pozice');
    if (document.querySelector('.account-summary:not([hidden]), #accountSummary:not([hidden])')) znacka('přehled účtu');
  }).observe(document, { childList: true, subtree: true, attributes: true });
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => {
      (window.__dlouhe = window.__dlouhe || []).push({ od: Math.round(e.startTime), ms: Math.round(e.duration) });
    })).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
})();
""" % ZPOZDENI_BYBIT

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable', 'Profiler.enable'):
    p.prikaz(c)
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)

# 1. načtení: service worker se nainstaluje a nacachuje soubory.
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(8)

# 2. načtení jako v telefonu: pomalý procesor, mobilní síť.
p.prikaz('Emulation.setCPUThrottlingRate', rate=4)
p.prikaz('Network.emulateNetworkConditions', offline=False, latency=150,
         downloadThroughput=1_500_000 / 8 * 8, uploadThroughput=750_000 / 8 * 8)
p.prikaz('Profiler.setSamplingInterval', interval=200)
p.prikaz('Profiler.start')
p.prikaz('Page.navigate', url=sys.argv[1])

# Síťové události pro soubory (načítání z cache SW i ze sítě).
soubory = {}
konec = time.time() + 12
while time.time() < konec:
    try:
        p.ws.s.settimeout(0.5)
        z = p.ws.prijmi()
    except Exception:
        continue
    m = z.get('method')
    par = z.get('params', {})
    if m == 'Network.requestWillBeSent':
        soubory[par['requestId']] = {'url': par['request']['url'], 'od': par['timestamp']}
    elif m == 'Network.loadingFinished' and par.get('requestId') in soubory:
        soubory[par['requestId']]['do'] = par['timestamp']
p.ws.s.settimeout(20)

profil = p.prikaz('Profiler.stop')['profile']
p.prikaz('Emulation.setCPUThrottlingRate', rate=1)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return r.get('result', {}).get('value')


znacky = ev('JSON.stringify(window.__znacky)')
dotazy = json.loads(ev('JSON.stringify(window.__dotazy)') or '[]')
dlouhe = json.loads(ev('JSON.stringify(window.__dlouhe || [])') or '[]')
nav = json.loads(ev("""JSON.stringify((() => { const n = performance.getEntriesByType('navigation')[0];
  return { odpovedStranky: Math.round(n.responseEnd), domInteractive: Math.round(n.domInteractive),
           domContentLoaded: Math.round(n.domContentLoadedEventEnd) }; })())"""))
zdroje = json.loads(ev("""JSON.stringify(performance.getEntriesByType('resource')
  .filter((r) => !/bybit|perpyx\\.com/.test(r.name))
  .map((r) => ({ url: r.name.replace(location.origin, ''), od: Math.round(r.startTime), do: Math.round(r.responseEnd) })))""") or '[]')

print('=== časová osa startu (ms od začátku navigace, CPU 4×, síť 150 ms, Bybit +%d ms) ===' % ZPOZDENI_BYBIT)
print('index.html doručena:        ', nav['odpovedStranky'])
print('DOM sestaven (interactive): ', nav['domInteractive'])
print('DOMContentLoaded (moduly):  ', nav['domContentLoaded'])
for k, v in sorted(json.loads(znacky or '{}').items(), key=lambda x: x[1]):
    print(f'{k:28s} {v}')

print('\n=== soubory aplikace ===')
for z in sorted(zdroje, key=lambda x: x['od']):
    print(f"{z['od']:6d} → {z['do']:6d}  ({z['do'] - z['od']:5d} ms)  {z['url']}")

print('\n=== dotazy na Bybit / perpyx.com (v pořadí) ===')
for d in dotazy:
    if 'do' not in d:
        d['do'] = -1
    print(f"{round(d['od']):6d} → {round(d['do']):6d}  {d['url']}")

print('\n=== dlouhé úlohy hlavního vlákna (> 50 ms) ===')
for d in dlouhe:
    print(f"  od {d['od']:6d}  {d['ms']:5d} ms")
print('  celkem:', sum(d['ms'] for d in dlouhe), 'ms')

# Vlastní čas podle souborů a funkcí.
uzly = {n['id']: n for n in profil['nodes']}
cas = {}
interval = (profil['endTime'] - profil['startTime']) / max(1, len(profil['samples'])) / 1000
for s in profil['samples']:
    n = uzly[s]
    cf = n['callFrame']
    soubor = cf['url'].split('/')[-1] or '(prohlížeč)'
    klic = (soubor, cf['functionName'] or '(anonymní)')
    cas[klic] = cas.get(klic, 0) + interval
podle_souboru = {}
for (soubor, f), ms in cas.items():
    podle_souboru[soubor] = podle_souboru.get(soubor, 0) + ms
print('\n=== vlastní čas podle souborů (ms, CPU 4×) ===')
for soubor, ms in sorted(podle_souboru.items(), key=lambda x: -x[1])[:12]:
    print(f'  {ms:7.0f}  {soubor}')
print('\n=== nejdražší funkce ===')
for (soubor, f), ms in sorted(cas.items(), key=lambda x: -x[1])[:20]:
    if soubor in ('(prohlížeč)',) and f in ('(idle)', '(program)'):
        continue
    print(f'  {ms:7.0f}  {soubor}: {f}')

vysledek = {'znacky': json.loads(znacky or '{}'), 'nav': nav, 'dotazy': dotazy, 'dlouhe': dlouhe,
            'soubory': podle_souboru}
open(os.path.join(os.environ.get('TEMP', '.'), 'perpyx-start.json'), 'w', encoding='utf-8').write(
    json.dumps(vysledek, ensure_ascii=False, indent=1))
