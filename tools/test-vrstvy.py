# -*- coding: utf-8 -*-
"""
Vrstvy grafu (v0.26.0): Kresby, Alarmy, Indikátory, Obchod.

  * každá vrstva jde skrýt a zase ukázat; skrytá data se nemažou,
  * Obchod = čáry pozice, trojúhelníky plnění a linka zisku (PNLLINE),
  * skryté indikátory se z grafu vyndají i s panelem (RSI) a plocha se
    svíčkami vyroste; s odkrytím se vrátí,
  * ikona vrstev svítí, když je něco skryté; volba přežije restart,
  * skrytá kresba nejde vybrat klepnutím; zvolený nástroj kresby ukáže,
  * zapnutí indikátoru v nabídce ukáže vrstvu indikátorů,
  * Skrýt vše / Zobrazit vše.

Spuštění: python tools/test-vrstvy.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
if (!sessionStorage.getItem('__pripraveno')) {
  sessionStorage.setItem('__pripraveno', '1');
  const n = Date.now();
  localStorage.removeItem('perpdesk.layers');
  localStorage.setItem('perpdesk.indicators', JSON.stringify(['EMA', 'RSI']));
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([{ name: 'horizontalStraightLine',
    points: [{ timestamp: n - 6 * 3600e3, value: 0.303 }], style: { color: '#4c9aff', width: 2, opacity: 1 } }]));
  localStorage.setItem('perpdesk.alarms', JSON.stringify([{ id: 'a1', symbol: 'JUPUSDT', typ: 'cena',
    price: 0.31, smer: 'any', opakovat: true, platnostDnu: 0, aktivni: true, zprava: '' }]));
}
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return None if 'exceptionDetails' in r else r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def stav():
    return json.loads(ev("""(() => { const g = window.__graf;
      const vid = (sk) => g.getOverlays({ groupId: sk }).filter((o) => o.visible).length;
      const vse = (sk) => g.getOverlays({ groupId: sk }).length;
      return JSON.stringify({
        kresby: vid('kresby'), kresbyVse: vse('kresby'),
        alarmy: vid('alarmy'), alarmyVse: vse('alarmy'),
        pozice: vid('pozice'), poziceVse: vse('pozice'), znacky: vid('znacky'),
        ind: g.getIndicators().map((i) => i.name).sort(),
        svicky: g.getSize('candle_pane', 'main')?.height || 0,
        sviti: document.getElementById('layersBtn').classList.contains('active'),
      }); })()""") or '{}')


def prepni(klic):
    ev(f"document.querySelector('#layersBody [data-vrstva={klic}] .nastaveni-prepinac').click()")
    time.sleep(0.4)


def otevri_graf():
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(4.5)
    ev("document.querySelector('.position').click()")
    time.sleep(3)


otevri_graf()
s0 = stav()
print('výchozí:', s0)
over(s0['kresby'] == 1 and s0['alarmy'] == 1 and s0['pozice'] >= 3 and s0['znacky'] > 0, 'všechno vidět')
over({'EMA', 'RSI', 'PNLLINE'} <= set(s0['ind']) and not s0['sviti'], 'indikátory i linka zisku, ikona nesvítí')

ev("document.getElementById('layersBtn').click()")
time.sleep(0.4)
over(ev("!document.getElementById('sheetLayers').hidden"), 'nabídka vrstev se otevře')
over(ev("document.querySelectorAll('#layersBody .nastaveni-radek').length") == 4, 'čtyři vrstvy')

print('1) jednotlivé vrstvy')
prepni('kresby')
s = stav()
over(s['kresby'] == 0 and s['kresbyVse'] == 1 and s['sviti'], f'kresby skryté, ne smazané; ikona svítí ({s["kresby"]}/{s["kresbyVse"]})')
prepni('alarmy')
s = stav()
over(s['alarmy'] == 0 and s['alarmyVse'] == 1, 'alarmy skryté, ne smazané')
prepni('obchod')
s = stav()
over(s['pozice'] == 0 and s['znacky'] == 0 and 'PNLLINE' not in s['ind'], f'obchod skrytý: čáry, plnění i linka zisku ({s["ind"]})')
prepni('indikatory')
s = stav()
over(not ({'EMA', 'RSI'} & set(s['ind'])) and s['svicky'] > s0['svicky'] + 30,
     f'indikátory pryč, panel RSI sbalený (svíčky {s0["svicky"]} → {s["svicky"]} px)')
over(json.loads(ev("localStorage.getItem('perpdesk.indicators')")) == ['EMA', 'RSI'], 'výběr indikátorů zůstal uložený')
ulozene = json.loads(ev("localStorage.getItem('perpdesk.layers')") or '{}')
over(ulozene == {'kresby': False, 'alarmy': False, 'indikatory': False, 'obchod': False}, f'uloženo ({ulozene})')

print('2) po restartu')
ev("document.querySelector('[data-close=sheetLayers]').click()")
otevri_graf()
s = stav()
over(s['kresby'] == 0 and s['alarmy'] == 0 and s['pozice'] == 0 and not ({'EMA', 'RSI', 'PNLLINE'} & set(s['ind'])) and s['sviti'],
     f'skryté zůstaly skryté ({s})')
# skrytá kresba nejde vybrat klepnutím
y = ev("""(() => { const v = document.getElementById('drawLayer').getBoundingClientRect();
  const yy = window.__graf.convertToPixel({ value: 0.303 }, { paneId: 'candle_pane' });
  return v.top + (Array.isArray(yy) ? yy[0].y : yy.y); })()""")
bod = [{'x': 150, 'y': y, 'radiusX': 10, 'radiusY': 10, 'force': 1, 'id': 1}]
p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
time.sleep(0.05)
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
time.sleep(0.5)
over(ev("document.getElementById('stylePanel').hidden"), 'skrytá kresba se klepnutím nevybere')

print('3) samo se ukáže, co uživatel začne používat')
ev("document.querySelector('.tool-btn[data-tool=segment]').click()")
time.sleep(0.3)
over(stav()['kresby'] == 1, 'zvolený nástroj kreslení ukáže kresby')
ev("document.querySelector('.tool-btn[data-tool=segment]').click(); document.querySelector('.tool-btn[data-tool]').click()")
ev("document.getElementById('indicatorBtn').click()")
time.sleep(0.3)
ev("document.querySelector('[data-indicator=MACD]').click()")
time.sleep(0.6)
s = stav()
over({'EMA', 'RSI', 'MACD'} <= set(s['ind']), f'zapnutí indikátoru ukáže i ostatní ({s["ind"]})')

print('4) Skrýt vše / Zobrazit vše')
ev("document.getElementById('layersBtn').click()")
time.sleep(0.3)
over(ev("document.getElementById('layersAllBtn').textContent") == 'Show all', 'když je něco skryté: Show all')
ev("document.getElementById('layersAllBtn').click()")
time.sleep(0.6)
s = stav()
over(s['kresby'] == 1 and s['alarmy'] == 1 and s['pozice'] >= 3 and 'PNLLINE' in s['ind'] and not s['sviti'], 'Show all vrátí vše')
over(ev("document.getElementById('layersAllBtn').textContent") == 'Hide all', '… a tlačítko se změní na Hide all')
ev("document.getElementById('layersAllBtn').click()")
time.sleep(0.6)
s = stav()
over(s['kresby'] == 0 and s['alarmy'] == 0 and s['pozice'] == 0 and s['ind'] == [], f'Hide all: jen svíčky ({s["ind"]})')
ev("document.getElementById('layersAllBtn').click()")
time.sleep(0.4)

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
