# -*- coding: utf-8 -*-
"""
Značka plnění na živé svíčce (v0.32.1).

Trojúhelník nákupu leží pod spodním knotem svíčky. U živé svíčky se ale
minimum mění s každým tickem — a značka si dřív pamatovala svíčku
z okamžiku výpočtu. Když po nákupu cena klesla níž, trojúhelník zůstal
u starého minima **uvnitř svíčky** (hlášeno z telefonu 2026-10-06).

Test: na poslední (živou) svíčku dá značku nákupu, pak přes podstrčený
WebSocket protáhne svíčku níž a z obrázku grafu změří, kde trojúhelník
leží proti novému minimu.

Spuštění: python tools/test-znacka-ziva-svicka.py http://localhost:8080/index.html
Na starém kódu padá.
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
window.__ws = [];
window.WebSocket = function (url) {
  this.url = url; this.readyState = 0; this.odeslano = [];
  this.send = (d) => { this.odeslano.push(d); };
  this.close = () => { this.readyState = 3; };
  window.__ws.push(this);
  setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 60);
};
window.WebSocket.OPEN = 1;
window.__zprava = (topic, data) => window.__ws.forEach((s) => s.onmessage && s.onmessage({ data: JSON.stringify({ topic, data }) }));
"""

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(5)


def ev(v, cekat=False):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=cekat)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


# Vrchol trojúhelníku (nejvyšší pixel barvy nákupu ve sloupci poslední svíčky)
# proti pixelu minima svíčky.
MERENI = """(async () => {
  const g = window.__graf;
  const d = g.getDataList().slice(-1)[0];
  const b = g.convertToPixel({ timestamp: d.timestamp, value: d.low }, { paneId: 'candle_pane' });
  const bod = Array.isArray(b) ? b[0] : b;
  const url = g.getConvertPictureUrl(true, 'png', '#000000');
  const img = new Image();
  await new Promise((ok) => { img.onload = ok; img.src = url; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const pomer = img.width / g.getSize().width;
  const x0 = Math.round(bod.x * pomer);
  let vrchol = null;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = x0 - 4; x <= x0 + 4; x += 1) {
      const [r, gg, bb] = ctx.getImageData(x, y, 1, 1).data;
      if (r < 110 && gg > 230 && bb > 100 && bb < 170) { vrchol = y / pomer; break; }
    }
    if (vrchol !== null) break;
  }
  return JSON.stringify({ minimum: Math.round(bod.y), vrchol: vrchol === null ? null : Math.round(vrchol), low: d.low });
})()"""

chyby = []
posledni = json.loads(ev("""(() => { const d = window.__graf.getDataList().slice(-1)[0];
  return JSON.stringify({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close }); })()"""))

# Značka nákupu na živé svíčce (jako by se teď přikoupilo). Ostatní značky pryč.
ev("""(() => {
  const g = window.__graf;
  g.removeOverlay({ groupId: 'znacky' });
  g.createOverlay({ name: 'tradeMark', groupId: 'znacky', lock: true,
    points: [{ timestamp: %d, value: %r }],
    extendData: { vstup: true, color: '#4dff88', maly: true } });
})()""" % (posledni['t'], posledni['c']))
time.sleep(0.8)
pred = json.loads(ev(MERENI, True) or '{}')
print('před poklesem:', pred)
if pred.get('vrchol') is None or pred['vrchol'] < pred['minimum']:
    chyby.append(f'značka nákupu neleží pod minimem svíčky už na začátku ({pred})')

# Cena klesne o kus níž — svíčka se protáhne dolů.
novy_low = round(posledni['l'] - (posledni['h'] - posledni['l']) * 1.5 - 0.002, 6)
ev("""window.__zprava('kline.240.JUPUSDT', [{ start: %d, open: '%s', high: '%s', low: '%s', close: '%s',
  volume: '1234', confirm: false }])""" % (posledni['t'], posledni['o'], posledni['h'], novy_low, posledni['c']))
time.sleep(1.2)
po = json.loads(ev(MERENI, True) or '{}')
print('po poklesu:   ', po, '(nové minimum', novy_low, ')')
if abs((po.get('low') or 0) - novy_low) > 1e-9:
    chyby.append('živá svíčka se neprotáhla — test nic neměří')
elif po.get('vrchol') is None or po['vrchol'] < po['minimum']:
    chyby.append(f"trojúhelník zůstal uvnitř svíčky: vrchol {po.get('vrchol')} px, minimum {po.get('minimum')} px")

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append('chyby v konzoli: ' + konzole)

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
    sys.exit(1)
print('VÝSLEDEK: ZNAČKA DRŽÍ POD ŽIVOU SVÍČKOU')
