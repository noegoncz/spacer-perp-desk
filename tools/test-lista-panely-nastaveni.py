# -*- coding: utf-8 -*-
"""Tlacitko CENTER v liste timeframu, vyska panelu RSI a sedive volby."""
import os, sys, tempfile, time, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec
p = Prohlizec()
p.prikaz('Page.enable'); p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-bybit.js'), encoding='utf-8').read())
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL','RSI']));"
     "localStorage.removeItem('perpdesk.ind.RSI'); localStorage.removeItem('perpdesk.ind.VOL');")
p.js("location.reload()")
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(4)

def rect(sel):
    r = p.js('(() => { const e=document.querySelector("%s");'
        'if(!e) return "null"; const b=e.getBoundingClientRect();'
        'if (b.width === 0) return "null";'
        'return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2),'
        'left:Math.round(b.left),right:Math.round(b.right)}); })()' % sel)
    return None if r in (None, 'null') else json.loads(r)

def klepni(x, y, cekat=1.0):
    bod = lambda a,b: [{'x':a,'y':b,'radiusX':14,'radiusY':14,'force':1,'id':1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x,y))
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(cekat)

print('=== 1. vyska panelu RSI ===')
def vyskaRsi():
    return p.js("""(() => {
      const g = window.__graf;
      const i = (g.getIndicators() || []).find(x => x.name === 'RSI');
      if (!i) return 'RSI vypnuty';
      const b = g.getSize(i.paneId, 'main');
      const c = g.getSize('candle_pane', 'main');
      return 'panel RSI ' + Math.round(b.height) + ' px, svicky '
           + Math.round(c.height) + ' px';
    })()""")
print('vychozi (25 %):', vyskaRsi())
bi = rect('#indicatorBtn')
klepni(bi['x'], bi['y'])
oz = rect('.sheet-radek:has(.sheet-item[data-indicator=RSI]) .sheet-ozubene')
klepni(oz['x'], oz['y'], 1.2)
souradnice = p.js("""(() => {
  const r = [...document.querySelectorAll('#settingsBody .nastaveni-radek')]
    .find(x => x.querySelector('.nastaveni-popisek').textContent.toLowerCase().includes('pane'));
  if (!r) return 'null';
  r.scrollIntoView({block:'center'});
  const b = [...r.querySelectorAll('.nastaveni-volba')].pop().getBoundingClientRect();
  return JSON.stringify({x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)});
})()""")
if souradnice == 'null':
    print('!! radek vysky panelu nenalezen')
else:
    s = json.loads(souradnice)
    klepni(s['x'], s['y'], 1.5)
    print('po volbe 40 %: ', vyskaRsi())
print()

print('=== 2. sedive zavisle volby ===')
def stavRadku():
    r = p.js("""JSON.stringify([...document.querySelectorAll('#settingsBody .nastaveni-radek')]
      .map(r => (r.classList.contains('nastaveni-radek--vypnuto') ? '[sede] ' : '       ')
                + r.querySelector('.nastaveni-popisek').textContent))""")
    return chr(10).join(json.loads(r)) if r else '(nic)'

print(stavRadku())
print()
# vypnout "show bands"
sb = p.js("""(() => {
  const r = [...document.querySelectorAll('#settingsBody .nastaveni-radek')]
    .find(x => x.querySelector('.nastaveni-popisek').textContent.toLowerCase().includes('show bands'));
  if (!r) return 'null';
  const b = r.querySelector('.nastaveni-prepinac').getBoundingClientRect();
  return JSON.stringify({x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)});
})()""")
if sb != 'null':
    s = json.loads(sb)
    klepni(s['x'], s['y'], 1.0)
    print('--- po vypnuti "Show bands" ---')
    print(stavRadku())
    print()
    print('jde na zesedle pole jeste sahnout:', p.js("""(() => {
      const r = [...document.querySelectorAll('.nastaveni-radek--vypnuto')];
      return r.length ? r.every(x => [...x.querySelectorAll('button,input')].every(b => b.disabled))
        ? 'ne, vsechna jsou zablokovana' : 'ANO - nekterá zustala aktivni!' : 'zadna zesedla';
    })()"""))
snap = p.prikaz('Page.captureScreenshot', format='png')
open(os.path.join(tempfile.gettempdir(), 'tri.png'),'wb').write(base64.b64decode(snap['data']))
print()
print('CELKEM CHYB:', p.js('(window.__chyby||[]).length'),
      p.js('(window.__chyby||[]).join(" | ")') or '')
