# -*- coding: utf-8 -*-
"""
Měření výkonu — co zabírá čas a proč.

Spustí aplikaci s podstrčenými daty, ale s **živým provozem jako od Bybitu**:
ticker každých 100 ms pro každou otevřenou pozici a u otevřeného grafu živá
svíčka každých 250 ms. Procesor se zpomalí (výchozí 4×), aby to odpovídalo
spíš telefonu než stolnímu počítači.

Měří se v několika scénářích:
  1. přehled pozic v klidu (jen tikají ceny),
  2. otevřený graf s kresbami a indikátory (tikají ceny i svíčka),
  3. interakce: otevření grafu, přepnutí timeframu, přepnutí záložky.

Pro každý scénář:
  * **profil procesoru** (vzorkovací profiler DevTools) — vlastní čas
    jednotlivých funkcí, sečtený i po souborech (app.js, ui.js, knihovna
    grafu…), plus čas na vykreslování stránky a úklid paměti,
  * metriky prohlížeče — čas skriptů, přepočtů stylů a rozvržení stránky,
  * **dlouhé úlohy** (> 50 ms), které uživatel cítí jako zaseknutí,
  * kolikrát se překreslil seznam pozic,
  * u interakcí doba od klepnutí po výsledek.

Spuštění (Chrome s čistým profilem na portu 9223, viz tools/README.md):
    python tools/mereni-vykonu.py http://localhost:8080/index.html [zpomaleni]

Výsledek se vypíše a celý uloží do %TEMP%/perpyx-vykon.json, aby šel
porovnat s pozdějším měřením (před optimalizací a po ní).
"""
import os, sys, time, json, tempfile
from collections import defaultdict
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

URL = sys.argv[1]
ZPOMALENI = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

# Čtyři pozice jako na telefonu uživatele, WebSocket, do kterého jde posílat
# zprávy, kresby a indikátory, a počítadla překreslení a dlouhých úloh.
mock += r"""
(() => {
  const PARY = [
    ['JUPUSDT', 'Buy', '2547', '0.30135', '0.30580'],
    ['WLDUSDT', 'Buy', '1538', '0.41670', '0.40780'],
    ['PENGUUSDT', 'Buy', '67200', '0.009699', '0.009733'],
    ['ETHUSDT', 'Buy', '0.01', '2665.92', '2674.04'],
  ];
  window.__pary = PARY.map((p) => p[0]);
  const puvodni = window.fetch;
  window.fetch = function (vstup) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/position/list')) {
      return Promise.resolve(new Response(JSON.stringify({ retCode: 0, result: { list: PARY.map(
        ([symbol, side, size, avg, mark]) => ({ symbol, side, size, avgPrice: avg, markPrice: mark,
          unrealisedPnl: '1', liqPrice: String(Number(avg) * 0.3), leverage: '10',
          positionValue: String(Number(size) * Number(mark)), stopLoss: String(Number(avg) * 0.95),
          takeProfit: String(Number(avg) * 1.1), positionIdx: 0 })) } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return puvodni(vstup);
  };
  window.__ws = [];
  window.WebSocket = function (url) {
    this.url = url; this.readyState = 0; this.send = () => {};
    this.close = () => { this.readyState = 3; };
    window.__ws.push(this);
    setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 60);
  };
  window.WebSocket.OPEN = 1;
  window.__zprava = (topic, data) => {
    const text = JSON.stringify({ topic, data });
    window.__ws.forEach((s) => { if (s.onmessage) s.onmessage({ data: text }); });
  };
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL', 'EMA', 'RSI']));
  const t = Date.now();
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([0, 1, 2, 3, 4].map((i) => ({
    name: i % 2 ? 'horizontalStraightLine' : 'segment',
    points: [{ timestamp: t - (30 - i * 3) * 14400e3, value: 0.296 + i * 0.003 },
             { timestamp: t - (10 - i) * 14400e3, value: 0.30 + i * 0.002 }],
    style: { color: '#e6edf5', width: 1, opacity: 1 } }))));

  // Počítadla: dlouhé úlohy a překreslení seznamu pozic.
  window.__dlouhe = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__dlouhe.push(e.duration)))
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { /* prohlížeč bez longtask */ }
  window.__prekresleni = 0;
  document.addEventListener('DOMContentLoaded', () => {
    const l = document.getElementById('positionList');
    if (l) new MutationObserver(() => { window.__prekresleni += 1; }).observe(l, { childList: true });
  });
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable', 'Performance.enable', 'Profiler.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=420, height=860, deviceScaleFactor=2, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=URL)
time.sleep(7)
p.prikaz('Emulation.setCPUThrottlingRate', rate=ZPOMALENI)
p.prikaz('Profiler.setSamplingInterval', interval=200)  # µs


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


def spust_provoz(graf):
    """Tickery pro všechny páry (100 ms) a u grafu živá svíčka (250 ms)."""
    ev("""(() => {
      clearInterval(window.__tik1); clearInterval(window.__tik2);
      window.__tik1 = setInterval(() => window.__pary.forEach((s, i) => {
        const zaklad = [0.3058, 0.4078, 0.009733, 2674][i];
        window.__zprava('tickers.' + s, { symbol: s,
          markPrice: String(zaklad * (1 + (Math.random() - 0.5) * 0.002)) });
      }), 100);
      if (%s) window.__tik2 = setInterval(() => {
        const g = window.__graf; if (!g) return;
        const d = g.getDataList(); const k = d[d.length - 1]; if (!k) return;
        const c = k.close * (1 + (Math.random() - 0.5) * 0.001);
        window.__zprava('kline.240.JUPUSDT', [{ start: k.timestamp, open: String(k.open),
          high: String(Math.max(k.high, c)), low: String(Math.min(k.low, c)), close: String(c),
          volume: '10', confirm: false }]);
      }, 250);
    })()""" % ('true' if graf else 'false'))


def zastav_provoz():
    ev("clearInterval(window.__tik1); clearInterval(window.__tik2);")


def metriky():
    return {m['name']: m['value'] for m in p.prikaz('Performance.getMetrics')['metrics']}


def soubor(url):
    if not url:
        return ''
    return url.rsplit('/', 1)[-1].split('?')[0]


def rozeber_profil(profil):
    """Vlastní čas funkcí a souborů z vzorkovacího profilu."""
    uzly = {n['id']: n for n in profil['nodes']}
    casy = profil.get('timeDeltas') or []
    vzorky = profil.get('samples') or []
    na_uzel = defaultdict(float)
    for i, u in enumerate(vzorky):
        na_uzel[u] += (casy[i] if i < len(casy) else 0) / 1000.0  # ms
    funkce = defaultdict(float)
    soubory = defaultdict(float)
    for uid, ms in na_uzel.items():
        cf = uzly[uid]['callFrame']
        jmeno = cf.get('functionName') or '(anonymní)'
        s = soubor(cf.get('url'))
        if jmeno in ('(idle)', '(program)', '(garbage collector)', '(root)'):
            klic = jmeno
            s = jmeno
        else:
            klic = f"{jmeno}  [{s or '?'}:{cf.get('lineNumber', 0) + 1}]"
        funkce[klic] += ms
        soubory[s or '(jiné)'] += ms
    return funkce, soubory


def scenar(nazev, trvani, akce=None, graf=False):
    """Změří jeden scénář: profil, metriky, dlouhé úlohy, překreslení."""
    ev("window.__dlouhe = []; window.__prekresleni = 0;")
    pred = metriky()
    p.prikaz('Profiler.start')
    spust_provoz(graf)
    t0 = time.time()
    doby = akce() if akce else {}
    zbyva = trvani - (time.time() - t0)
    if zbyva > 0:
        time.sleep(zbyva)
    zastav_provoz()
    profil = p.prikaz('Profiler.stop')['profile']
    po = metriky()
    skutecne = time.time() - t0
    funkce, soubory = rozeber_profil(profil)
    dlouhe = ev("window.__dlouhe") or []
    vysledek = {
        'scenar': nazev,
        'sekund': round(skutecne, 1),
        'skripty_ms': round((po.get('ScriptDuration', 0) - pred.get('ScriptDuration', 0)) * 1000),
        'styly_ms': round((po.get('RecalcStyleDuration', 0) - pred.get('RecalcStyleDuration', 0)) * 1000),
        'rozvrzeni_ms': round((po.get('LayoutDuration', 0) - pred.get('LayoutDuration', 0)) * 1000),
        'uloh_ms': round((po.get('TaskDuration', 0) - pred.get('TaskDuration', 0)) * 1000),
        'rozvrzeni_pocet': int(po.get('LayoutCount', 0) - pred.get('LayoutCount', 0)),
        'dlouhych_uloh': len(dlouhe),
        'dlouhe_ms_celkem': round(sum(dlouhe)),
        'dlouhe_ms_max': round(max(dlouhe) if dlouhe else 0),
        'prekresleni_seznamu': ev("window.__prekresleni") or 0,
        'pamet_mb': round(po.get('JSHeapUsedSize', 0) / 1e6, 1),
        'doby_interakci_ms': doby,
        'soubory_ms': dict(sorted(((k, round(v)) for k, v in soubory.items()), key=lambda x: -x[1])),
        'funkce_ms': [(k, round(v, 1)) for k, v in sorted(funkce.items(), key=lambda x: -x[1])[:25]],
    }
    return vysledek


def doba(vyraz_start, vyraz_hotovo, limit=5.0):
    """Doba od akce po splnění podmínky, měřená v prohlížeči."""
    ev("window.__t0 = performance.now();" + vyraz_start)
    konec = time.time() + limit
    while time.time() < konec:
        if ev(vyraz_hotovo):
            return round(ev("performance.now() - window.__t0"))
        time.sleep(0.02)
    return None


def interakce():
    d = {}
    d['otevreni_grafu'] = doba("document.querySelector('.position').click();",
        "!document.getElementById('viewChart').hidden && window.__graf && window.__graf.getDataList().length > 0"
        " && getComputedStyle(document.getElementById('chartBox')).visibility === 'visible'")
    time.sleep(1.5)
    d['timeframe_1h'] = doba("document.querySelector('.interval-btn[data-interval=\"60\"]').click();",
        "document.querySelector('.interval-btn.active')?.dataset.interval === '60'"
        " && window.__graf.getPeriod?.()?.span === 1")
    time.sleep(1.5)
    d['timeframe_4h'] = doba("document.querySelector('.interval-btn[data-interval=\"240\"]').click();",
        "document.querySelector('.interval-btn.active')?.dataset.interval === '240'")
    time.sleep(1.5)
    d['zavreni_grafu'] = doba("history.back();", "document.getElementById('viewChart').hidden")
    time.sleep(1)
    # Trhy se od v0.31.3 otevírají na prvním vlastním seznamu (může být
    # prázdný) — měří se doba do vykreslení záložky.
    d['zalozka_trhy'] = doba("document.querySelector('[data-tab=watchlist]').click();",
        "!document.getElementById('viewWatchlist').hidden && document.querySelectorAll('#watchLists .chip').length > 0")
    time.sleep(1)
    d['zalozka_pozice'] = doba("document.querySelector('[data-tab=positions]').click();",
        "!document.getElementById('viewPositions').hidden")
    return d


vysledky = []
print(f'Zpomalení procesoru: {ZPOMALENI}×\n')
vysledky.append(scenar('1) přehled pozic, živé ceny', 10))
vysledky.append(scenar('2) interakce (graf, timeframe, záložky)', 14, akce=interakce, graf=True))
ev("document.querySelector('[data-tab=positions]').click()")
time.sleep(1)
ev("document.querySelector('.position').click()")
time.sleep(4)
vysledky.append(scenar('3) otevřený graf, živé ceny i svíčka', 10, graf=True))

for v in vysledky:
    print('=' * 72)
    print(v['scenar'], f"({v['sekund']} s)")
    print('-' * 72)
    zateze = v['uloh_ms'] / (v['sekund'] * 1000) * 100 if v['sekund'] else 0
    print(f"  hlavní vlákno zaneprázdněné: {v['uloh_ms']} ms ({zateze:.0f} % času)")
    print(f"    z toho skripty {v['skripty_ms']} ms, styly {v['styly_ms']} ms, "
          f"rozvržení {v['rozvrzeni_ms']} ms ({v['rozvrzeni_pocet']}×)")
    print(f"  dlouhé úlohy (> 50 ms): {v['dlouhych_uloh']}×, celkem {v['dlouhe_ms_celkem']} ms, "
          f"nejdelší {v['dlouhe_ms_max']} ms")
    print(f"  překreslení seznamu pozic: {v['prekresleni_seznamu']}×")
    print(f"  paměť JS: {v['pamet_mb']} MB")
    if v['doby_interakci_ms']:
        print('  doby interakcí (ms):', v['doby_interakci_ms'])
    print('  čas podle souborů (ms):')
    for k, ms in list(v['soubory_ms'].items())[:8]:
        print(f'    {ms:>7}  {k}')
    print('  nejdražší funkce (vlastní čas, ms):')
    for k, ms in v['funkce_ms'][:12]:
        print(f'    {ms:>7}  {k}')

cesta = os.path.join(tempfile.gettempdir(), 'perpyx-vykon.json')
with open(cesta, 'w', encoding='utf-8') as f:
    json.dump({'zpomaleni': ZPOMALENI, 'scenare': vysledky}, f, ensure_ascii=False, indent=1)
print('\nCelý výsledek:', cesta)
