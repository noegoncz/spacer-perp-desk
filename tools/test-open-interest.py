# -*- coding: utf-8 -*-
"""
Open interest v grafu a „kdo platí funding" na kartě (v0.66.0).

  * karta pozice: u sazby fundingu stojí „longs pay" (kladná sazba),
  * indikátor OI z nabídky: panel s křivkou v USD (OI × close), data
    z burzy grafu (Bybit podstrčený mockem),
  * změna timeframu = nová řada OI (1D → intervalTime=1d),
  * Binance BTCUSDT naostro: OI ze skutečné burzy,
  * Hyperliquid (historii OI nedává): panel bez křivky, nic nespadne,
  * zapnutý OI přežije přenačtení a načte se sám.

Spuštění: python tools/test-open-interest.py http://localhost:8075/index.html
"""
import json, os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KLICE = ['binance:BTCUSDT', 'hyperliquid:BTCUSDC']
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!sessionStorage.getItem('__oi')) { sessionStorage.setItem('__oi', '1');
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


# Hodnoty OI v grafu: [počet svíček s hodnotou, poslední hodnota, poslední close]
OI = """(() => { const i = window.__graf.getIndicators({ name: 'OI' })[0]; if (!i) return null;
  const r = (i.result || []).filter((x) => x && Number.isFinite(x.oi));
  const d = window.__graf.getDataList();
  return [r.length, r.length ? r[r.length - 1].oi : null, d.length ? d[d.length - 1].close : null]; })()"""


def cekej_oi(nejmene=1, s=10):
    for _ in range(int(s * 4)):
        v = ev(OI)
        if v and v[0] >= nejmene:
            return v
        time.sleep(0.25)
    return ev(OI)


print('1) funding na kartě')
kdo = ev("document.querySelector('.pos-funding .fp-kdo')?.textContent || ''")
over(kdo == 'longs pay', f'u kladné sazby stojí „longs pay" ({kdo!r})')

print('2) OI na grafu Bybitu')
ev("document.querySelector('.position').click()")
time.sleep(3)
ev("document.getElementById('indicatorBtn').click()")
time.sleep(0.5)
over(bool(ev("!!document.querySelector('#indicatorList [data-indicator=OI]')")), 'OI je v nabídce indikátorů')
ev("document.querySelector('#indicatorList [data-indicator=OI]').click()")
v = cekej_oi(100)
over(v and v[0] >= 100, f'panel OI má hodnoty ({v and v[0]} svíček)')
over(v and v[2] and abs(v[1] - (5e6 + 0) * v[2]) / (5e6 * v[2]) < 0.01,
     f'poslední hodnota = nejnovější OI × close ({v and round(v[1])})')
dotazy = ev("(window.__oiDotazy || []).slice(-1)[0] || ''")
over('intervalTime=4h' in dotazy, f'4h graf → OI po 4 h ({dotazy[-60:]})')

print('3) změna timeframu')
ev("document.querySelector('.interval-btn[data-interval=D]').click()")
time.sleep(3)
dotazy = ev("(window.__oiDotazy || []).slice(-1)[0] || ''")
over('intervalTime=1d' in dotazy, 'na 1D se stáhne denní OI')
v = cekej_oi(50)
over(v and v[0] >= 50, f'po změně timeframu panel zase má hodnoty ({v and v[0]})')
ev("history.back()")
time.sleep(1.5)

print('4) Binance naostro')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(3)
ev("document.querySelector('#watchList .tile[data-klic=\"binance:BTCUSDT\"]').click()")
# Binance drží OI jen 30 dní: na 1D (timeframe zůstal z kroku 3) je to ~30 svíček.
v = cekej_oi(25, 20)
over(v and v[0] >= 25 and v[1] > 1e9, f'OI BTC z Binance (svíček {v and v[0]}, poslední {v and round((v[1] or 0) / 1e9, 2)} mld USD)')
popis = ev("window.__graf.getIndicators({ name: 'OI' })[0]?.createTooltipDataSource?.({})?.calcParamsText || ''")
over('Binance' in (popis or ''), f'legenda nese burzu ({popis!r})')
ev("history.back()")
time.sleep(1.5)

print('5) Hyperliquid (historii OI nedává)')
ev("document.querySelector('#watchList .tile[data-klic=\"hyperliquid:BTCUSDC\"]').click()")
time.sleep(6)
v = ev(OI)
over(v is not None and v[0] == 0, f'panel bez křivky ({v})')
ev("history.back()")
time.sleep(1.5)

print('6) po přenačtení')
p.prikaz('Page.reload')
time.sleep(7)
ev("document.querySelector('.tab[data-tab=positions]')?.click()")
time.sleep(1)
ev("document.querySelector('.position').click()")
v = cekej_oi(50)
over(v and v[0] >= 50, f'zapnutý OI se po přenačtení načte sám ({v and v[0]})')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
