# -*- coding: utf-8 -*-
"""
Indikátor Funding (v0.86.0) — panel jako OI / RSI, sloupce sazby v %.

  * je v nabídce indikátorů, zapnutím vznikne vlastní panel,
  * Bybit (mock): sazby po 8 h, kladné zelené, záporné červené,
    na 4h grafu každá svíčka drží poslední vyúčtovanou sazbu,
  * živá svíčka = aktuální odhad sazby z tickeru (mock 0.0001 → 0.01 %),
  * 1D graf: průměr sazeb vyúčtovaných během svíčky,
  * legenda nese interval a burzu („8h · Bybit · %"),
  * Binance, OKX a Hyperliquid naostro: sazby ze skutečné burzy
    (Hyperliquid po 1 h),
  * zapnutý indikátor přežije přenačtení.

Spuštění: python tools/test-funding.py http://localhost:8075/index.html
"""
import json, os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLICE = ['binance:BTCUSDT', 'okx:BTCUSDT', 'hyperliquid:BTCUSDC']
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!sessionStorage.getItem('__fund')) { sessionStorage.setItem('__fund', '1');
  localStorage.removeItem('perpdesk.indicators');
  localStorage.setItem('perpdesk.lists', JSON.stringify({ verze: 1, aktivni: 'a',
    seznamy: [{ id: 'a', nazev: 'Main', polozky: %s }] })); }
""" % json.dumps(KLICE)

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)
chyby = []


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def over(podminka, popis):
    print(('  ok   ' if podminka else '  !!   ') + popis)
    if not podminka:
        chyby.append(popis)


# [svíček s hodnotou, poslední hodnota, kladných, záporných, unikátní hodnoty (prvních 6)]
FUND = """(() => { const i = window.__graf.getIndicators({ name: 'FUND' })[0]; if (!i) return null;
  const r = (i.result || []).filter((x) => x && Number.isFinite(x.rate)).map((x) => x.rate);
  return [r.length, r.length ? r[r.length - 1] : null, r.filter((x) => x > 0).length, r.filter((x) => x < 0).length,
    [...new Set(r.map((x) => +x.toFixed(6)))].slice(0, 6), i.paneId,
    new Set(r.slice(-10, -1).map((x) => +x.toFixed(6))).size]; })()"""
POPIS = "window.__graf.getIndicators({ name: 'FUND' })[0]?.createTooltipDataSource?.({})?.calcParamsText || ''"


def cekej(nejmene=1, s=12):
    for _ in range(int(s * 4)):
        v = ev(FUND)
        if v and v[0] >= nejmene:
            return v
        time.sleep(0.25)
    return ev(FUND)


print('1) Funding na grafu Bybitu (mock, 4h)')
ev("document.querySelector('.position').click()")
time.sleep(3)
ev("document.getElementById('indicatorBtn').click()")
time.sleep(0.5)
over(bool(ev("!!document.querySelector('#indicatorList [data-indicator=FUND]')")), 'Funding je v nabídce indikátorů')
ev("document.querySelector('#indicatorList [data-indicator=FUND]').click()")
v = cekej(100)
print('   ', v)
over(v and v[0] >= 100, f'panel má hodnoty ({v and v[0]} svíček)')
over(v and v[5] and v[5] != 'candle_pane', f'vlastní panel ({v and v[5]})')
over(v and v[2] > 0 and v[3] > 0, f'kladné i záporné sazby ({v and v[2]} / {v and v[3]})')
over(v and set(v[4]) <= {0.01, -0.02}, f'4h svíčky drží vyúčtovanou sazbu v % ({v and v[4]})')
over(v and abs(v[1] - 0.01) < 1e-9, f'živá svíčka = aktuální sazba z tickeru 0.01 % ({v and v[1]})')
popis = ev(POPIS)
over('8h' in popis and 'Bybit' in popis, f'legenda s intervalem a burzou ({popis!r})')
barvy = ev("""(() => { const i = window.__graf.getIndicators({ name: 'FUND' })[0]; const f = i.figures[0];
  return [f.styles({ data: { current: { rate: 0.01 } } }).color, f.styles({ data: { current: { rate: -0.02 } } }).color]; })()""")
over(barvy and barvy[0] != barvy[1] and barvy[0].lower() == '#16c784', f'kladné zeleně, záporné červeně ({barvy})')

print('2) 1D = průměr sazeb za den')
ev("document.querySelector('.interval-btn[data-interval=D]').click()")
time.sleep(3)
v = cekej(50)
print('   ', v)
# Den = 3 vyúčtování, jedno ze čtyř záporné → průměry (0.01+0.01+0.01)/3, (0.01+0.01−0.02)/3…
over(v and v[0] >= 50 and any(abs(x) > 1e-9 and abs(abs(x) - 0.01) > 1e-6 and abs(abs(x) - 0.02) > 1e-6 for x in v[4]) or (v and 0 in v[4]),
     f'denní svíčky mají průměr, ne jednu sazbu ({v and v[4]})')
ev("document.querySelector('.interval-btn[data-interval=\"240\"]').click()")
time.sleep(2)
ev("history.back()")
time.sleep(1.5)

for klic, burza, interval in (('binance:BTCUSDT', 'Binance', '8h'), ('okx:BTCUSDT', 'OKX', '8h'), ('hyperliquid:BTCUSDC', 'Hyperliquid', '1h')):
    print(f'3) {burza} naostro')
    ev("document.querySelector('.tab[data-tab=watchlist]').click()")
    time.sleep(2)
    ev(f"document.querySelector('#watchList .tile[data-klic=\"{klic}\"]').click()")
    v = cekej(30, 25)
    print('   ', v and v[:5])
    over(v and v[0] >= 30 and all(abs(x) < 1 for x in v[4]), f'{burza}: sazby ze skutečné burzy ({v and v[0]} svíček)')
    popis = ev(POPIS)
    over(burza in popis and interval in popis, f'{burza}: legenda {popis!r}')
    over(v and v[6] > 1, f'{burza}: poslední svíčky mají čerstvé sazby, ne jednu starou ({v and v[6]} různých z 9)')
    ev("history.back()")
    time.sleep(1.5)

print('4) po přenačtení')
p.prikaz('Page.reload')
time.sleep(7)
ev("document.querySelector('.tab[data-tab=positions]')?.click()")
time.sleep(1)
ev("document.querySelector('.position').click()")
v = cekej(50)
over(v and v[0] >= 50, f'zapnutý Funding se po přenačtení načte sám ({v and v[0]})')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
