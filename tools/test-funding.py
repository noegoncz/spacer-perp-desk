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


print('1) Funding na grafu Bybitu (mock, 4h) — výchozí odhad po svíčkách')
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
over(v and set(v[4]) == {0.01, -0.03}, f'odhad z premia: 0 → 0.01 %, −0.08 % → −0.03 % ({v and v[4]})')
over(v and v[6] > 1, f'každá svíčka svou hodnotu, ne schody po 8 h ({v and v[6]} různých z 9)')
over(bool(ev("(window.__premiumDotazy || []).some((u) => u.includes('interval=240'))")), 'premium index na timeframu grafu (4h)')
popis = ev(POPIS)
over('Predicted' in popis and '8h' in popis and 'Bybit' in popis, f'legenda „Predicted 8h · Bybit" ({popis!r})')
barvy = ev("""(() => { const i = window.__graf.getIndicators({ name: 'FUND' })[0]; const f = i.figures[0];
  return [f.styles({ data: { current: { rate: 0.01 } } }).color, f.styles({ data: { current: { rate: -0.02 } } }).color]; })()""")
over(barvy and barvy[0] != barvy[1] and barvy[0].lower() == '#16c784', f'kladné zeleně, záporné červeně ({barvy})')

print('1b) nastavení → Settled (vyúčtované sazby)')
ev("document.getElementById('indicatorBtn').click()")
time.sleep(0.5)
ev("document.querySelector('#indicatorList [data-indicator=FUND]').parentElement.querySelector('.sheet-ozubene').click()")
time.sleep(0.6)
ok_ = ev("""(() => { const b = [...document.querySelectorAll('.nastaveni-volba')].find((x) => x.textContent.trim() === 'Settled');
  if (!b) return false; b.click(); return true; })()""")
over(ok_, 'v nastavení volba Predicted / Settled')
ev("document.querySelectorAll('.sheet.open, .sheet:not([hidden])').forEach(() => {}); history.back && 0")
v = None
for _ in range(40):
    v = ev(FUND)
    if v and set(v[4]) <= {0.01, -0.02} and v[0] >= 100:
        break
    time.sleep(0.25)
print('   ', v)
over(v and set(v[4]) <= {0.01, -0.02}, f'Settled: 4h svíčky drží vyúčtovanou sazbu ({v and v[4]})')
over(v and abs(v[1] - 0.01) < 1e-9, f'Settled: živá svíčka = aktuální sazba 0.01 % ({v and v[1]})')
popis = ev(POPIS)
over('Predicted' not in popis and '8h' in popis, f'Settled: legenda {popis!r}')

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

# Zpátky na výchozí odhad (uloží se jako uživatelova volba → přenačíst).
ev("localStorage.setItem('perpdesk.ind.FUND', JSON.stringify({ rezim: 'predicted' }))")
p.prikaz('Page.reload')
time.sleep(7)
# Binance odhad z premia, OKX a Hyperliquid premium po svíčkách nemají → vyúčtované.
for klic, burza, interval, odhad in (('binance:BTCUSDT', 'Binance', '8h', True), ('okx:BTCUSDT', 'OKX', '8h', False), ('hyperliquid:BTCUSDC', 'Hyperliquid', '1h', False)):
    print(f'3) {burza} naostro')
    ev("document.querySelector('.tab[data-tab=watchlist]').click()")
    time.sleep(2)
    ev(f"document.querySelector('#watchList .tile[data-klic=\"{klic}\"]').click()")
    v = cekej(30, 25)
    print('   ', v and v[:5])
    over(v and v[0] >= 30 and all(abs(x) < 1 for x in v[4]), f'{burza}: sazby ze skutečné burzy ({v and v[0]} svíček)')
    popis = ev(POPIS)
    over(burza in popis and interval in popis and (('Predicted' in popis) == odhad), f'{burza}: legenda {popis!r}')
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
