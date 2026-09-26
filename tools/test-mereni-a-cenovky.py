# -*- coding: utf-8 -*-
"""
Měření, cenovky vodorovných kreseb a linka zisku přes celou šířku (v0.17.1).

  * Linka aktuální ceny vede přes **celou šířku** grafu, ne jen od poslední
    svíčky. Měří se, jak velká část řádku linky je v její barvě.
  * Vodorovná čára i cenová čára uživatele mají na cenové ose **trvalý**
    štítek s cenou (dřív ho ukazoval jen kříž při kreslení a pak zmizel).
  * Při kreslení je u ceny kříže vzdálenost od vstupu v procentech.
  * Nástroj Měření: dva body, obdélník s rozdílem ceny a času. Čísla se
    ukazují už **během tažení** druhého bodu a měření se neukládá mezi
    kresby.

Ovládání jde skutečnými dotyky přes CDP — syntetické události z JavaScriptu
obcházejí rozhodování prohlížeče o gestech.

Spuštění: python tools/test-mereni-a-cenovky.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
# Dvě uložené kresby na páru: vodorovná čára a cenová čára, obě ve
# viditelném rozsahu cen. Barva bílá (výchozí), cenovka tedy světlá.
mock += """
(() => {
  const t = Date.now();
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([
    { name: 'horizontalStraightLine', points: [{ timestamp: t - 30 * 14400e3, value: 0.3080 }],
      style: { color: '#e6edf5', width: 1, opacity: 1 } },
    { name: 'priceLine', points: [{ timestamp: t - 15 * 14400e3, value: 0.2985 }],
      style: { color: '#f0b90b', width: 1, opacity: 1 } },
  ]));
  localStorage.removeItem('perpdesk.indicators');
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=420, height=860,
         deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return None
    return r.get('result', {}).get('value')


def klepni(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.4)


def tahni(x1, y1, x2, y2, kroku=12, pustit=True):
    bod = lambda x, y: [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x1, y1))
    for i in range(1, kroku + 1):
        p.prikaz('Input.dispatchTouchEvent', type='touchMove',
                 touchPoints=bod(x1 + (x2 - x1) * i / kroku, y1 + (y2 - y1) * i / kroku))
        time.sleep(0.015)
    if pustit:
        p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.3)


def pixely_osy(y, hex_barva, tolerance=30):
    """Kolik pixelů dané barvy je na cenové ose v řádku y (±3 px)."""
    return ev("""(() => {
      const n = parseInt('%s'.slice(1), 16);
      const cil = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const osy = [...document.querySelectorAll('canvas')].filter((c) => c.width < 120 && c.height > 200);
      let z = 0;
      for (const c of osy) {
        const d = c.getContext('2d').getImageData(0, Math.max(0, Math.round(%s) - 3), c.width, 7).data;
        for (let i = 0; i < d.length; i += 4)
          if (Math.abs(d[i] - cil[0]) < %d && Math.abs(d[i+1] - cil[1]) < %d
              && Math.abs(d[i+2] - cil[2]) < %d) z += 1;
      }
      return z; })()""" % (hex_barva, y, tolerance, tolerance, tolerance))


def y_ceny(cena):
    b = ev("""(() => { const b = window.__graf.convertToPixel({ value: %s }, { paneId: 'candle_pane' });
      return (Array.isArray(b) ? b[0] : b).y; })()""" % cena)
    return b


chyby = []
ev("document.querySelector('.position').click()")
time.sleep(5)

# ---- 1) linka aktuální ceny přes celou šířku ----
radek = json.loads(ev("""(() => {
  const g = window.__graf;
  const data = g.getDataList();
  const b = g.convertToPixel({ dataIndex: data.length - 1, value: data[data.length - 1].close },
                             { paneId: 'candle_pane' });
  const y = Math.round((Array.isArray(b) ? b[0] : b).y);
  const vsechna = [...document.querySelectorAll('canvas')];
  const sirka = Math.max(...vsechna.map((c) => c.width));
  const platna = vsechna.filter((c) => c.width === sirka && c.height > 100);
  // Levá polovina — tam linka dřív vůbec nebyla.
  let barevnych = 0, celkem = 0;
  for (let x = 2; x < sirka / 2; x += 1) {
    celkem += 1;
    let zasah = false;
    for (const c of platna) for (const dy of [-1, 0, 1]) {
      const d = c.getContext('2d').getImageData(x, y + dy, 1, 1).data;
      if (d[3] > 60 && ((d[0] > 180 && d[1] < 110) || (d[1] > 180 && d[0] < 120))) zasah = true;
    }
    if (zasah) barevnych += 1;
  }
  return JSON.stringify({ y, barevnych, celkem });
})()""") or '{}')
podil = radek.get('barevnych', 0) / max(1, radek.get('celkem', 1))
print(f"linka zisku v levé polovině grafu: {podil:.0%} řádku v její barvě")
# Svíčky ji místy překryjí, proto ne 100 %.
if podil < 0.6:
    chyby.append(f'linka aktuální ceny nevede přes celou šířku ({podil:.0%} v levé polovině)')

# ---- 2) cenovky vodorovných kreseb na ose ----
for nazev, cena, barva in (('vodorovná čára', 0.3080, '#e6edf5'), ('cenová čára', 0.2985, '#f0b90b')):
    y = y_ceny(cena)
    n = pixely_osy(y, barva)
    print(f'{nazev} {cena}: y={round(y or -1)}, pixelů její barvy na ose: {n}')
    if (n or 0) < 40:
        chyby.append(f'{nazev} nemá na cenové ose cenovku ({n} px)')

# ---- 3) procenta u kříže při kreslení ----
ev("document.querySelector('.tool-btn[data-tool=horizontalStraightLine]').click()")
time.sleep(0.5)
vrstva = json.loads(ev("""(() => { const r = document.getElementById('drawLayer').getBoundingClientRect();
  return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, t: r.top }); })()"""))
tahni(vrstva['x'], vrstva['y'], vrstva['x'], vrstva['y'] - 40, pustit=False)
procenta = ev("(document.querySelector('.draw-badge-pct') || {}).textContent || ''")
videt = ev("(() => { const e = document.querySelector('.draw-badge-pct'); return e && e.style.display !== 'none'; })()")
print('štítek u kříže:', repr(procenta), '| vidět:', videt)
if not videt or '%' not in procenta or 'vs entry' not in procenta:
    chyby.append(f'u ceny kříže chybí vzdálenost od vstupu: {procenta!r}')
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
time.sleep(0.3)
ev("document.querySelector('.draw-banner-cancel').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))")
ev("document.querySelector('.tool-btn[data-tool=\"\"]').click()")
time.sleep(0.4)

# ---- 4) měření ----
ulozeno_pred = ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')")
ev("document.querySelector('.tool-btn[data-tool=mereni]').click()")
time.sleep(0.5)
klepni(vrstva['x'], vrstva['y'])            # 1. bod pod křížem uprostřed
tahni(vrstva['x'], vrstva['y'], vrstva['x'] + 90, vrstva['y'] - 80, pustit=False)
behem = json.loads(ev("""JSON.stringify(window.__graf.getOverlays()
  .filter((o) => o.name === 'mereni').map((o) => o.points.map((b) => b.value)))""") or '[]')
print('měření během tažení druhého bodu:', behem)
if not behem:
    chyby.append('během tažení druhého bodu se měření neukazuje')
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
time.sleep(0.3)
klepni(vrstva['x'], vrstva['y'])            # potvrdit 2. bod (kříž se mezitím posunul)
time.sleep(0.4)
mereni = json.loads(ev("""JSON.stringify(window.__graf.getOverlays()
  .filter((o) => o.name === 'mereni').map((o) => ({ skupina: o.groupId,
    body: o.points.map((b) => ({ cena: b.value, cas: b.timestamp })) })))""") or '[]')
print('hotové měření:', mereni)
if len(mereni) != 1:
    chyby.append(f'má být právě jedno měření, je jich {len(mereni)}')
else:
    a, b = mereni[0]['body']
    if not b['cena'] > a['cena']:
        chyby.append('tah nahoru má dát vyšší cenu druhého bodu')
    if not b['cas'] > a['cas']:
        chyby.append('tah doprava má dát pozdější čas druhého bodu')
# Měření se neukládá mezi kresby.
if ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')") != ulozeno_pred:
    chyby.append('měření se uložilo mezi kresby')
if 'mereni' in (ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')") or ''):
    chyby.append('v uložených kresbách je měření')

# Štítek měření je na plátně: modrá (nahoru) nad obdélníkem.
modre = ev("""(() => {
  const vsechna = [...document.querySelectorAll('canvas')];
  const sirka = Math.max(...vsechna.map((c) => c.width));
  let n = 0;
  for (const c of vsechna.filter((c) => c.width === sirka && c.height > 100)) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4)
      if (Math.abs(d[i] - 76) < 20 && Math.abs(d[i+1] - 154) < 20 && Math.abs(d[i+2] - 255) < 20) n += 1;
  }
  return n; })()""")
print('modrých pixelů měření na plátně:', modre)
if (modre or 0) < 300:
    chyby.append(f'měření se na plátně nevykreslilo ({modre} modrých px)')

# Nové otevření grafu začíná bez měření.
ev("history.back()")
time.sleep(1.2)
ev("document.querySelector('.position').click()")
time.sleep(4)
if ev("window.__graf.getOverlays().filter((o) => o.name === 'mereni').length"):
    chyby.append('měření zůstalo i po zavření a novém otevření grafu')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: MĚŘENÍ, CENOVKY I LINKA ZISKU SEDÍ')
