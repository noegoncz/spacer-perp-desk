# -*- coding: utf-8 -*-
"""Rychle proklikani timeframu nesmi shodit kresby ani cary pozice."""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec
p = Prohlizec()
p.prikaz('Page.enable'); p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-bybit.js'), encoding='utf-8').read())
p.prikaz('Page.navigate', url=sys.argv[1]); time.sleep(5)
p.js("""(() => { const n = Date.now();
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([
    {name:'segment', points:[{timestamp:n-40*14400e3,value:0.29},{timestamp:n-10*14400e3,value:0.31}], style:{}},
    {name:'horizontalStraightLine', points:[{timestamp:n-20*14400e3,value:0.305}], style:{}}]));
  localStorage.setItem('perpdesk.indicators','[]'); })()""")
p.js("location.reload()"); time.sleep(5)
p.js("document.querySelector('.position').click()"); time.sleep(4)

def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return r.get('result', {}).get('value')
def rect(sel):
    r = ev('(() => { const e=document.querySelector(' + json.dumps(sel) + '); if(!e) return "null";'
           'const b=e.getBoundingClientRect(); return JSON.stringify({x:Math.round(b.left+b.width/2),'
           'y:Math.round(b.top+b.height/2)}); })()')
    return None if r in (None, 'null') else json.loads(r)
def klepni(sel, cekat=0.4):
    b = rect(sel)
    pt = [{'x':b['x'],'y':b['y'],'radiusX':14,'radiusY':14,'force':1,'id':1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=pt)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(cekat)
def stav(popis):
    d = json.loads(ev("""JSON.stringify({
      kresby: window.__graf.getOverlays({groupId:'kresby'}).length,
      cary:   window.__graf.getOverlays({groupId:'pozice'}).length,
      svicek: window.__graf.getDataList().length,
      aktivni: [...document.querySelectorAll('.interval-btn.active')].map(b => b.textContent.trim()),
      poslednidotaz: (window.__ivl||[]).slice(-1)[0] })"""))
    print('%-34s kresby=%d cary=%d svicek=%3d aktivni=%s posledni interval=%s'
          % (popis, d['kresby'], d['cary'], d['svicek'], d['aktivni'], d['poslednidotaz']))
    return d

z = stav('po otevreni grafu')
print()
print('=== rychle proklikani timeframu (hodinovy odpovida pomalu) ===')
for iv in ['60', '5', '15', '60', '1', '240']:
    klepni('.interval-btn[data-interval="%s"]' % iv, 0.12)
time.sleep(3.5)
r = stav('po rychlem proklikani')
ok2 = r['kresby'] == z['kresby'] and r['cary'] == z['cary'] and r['svicek'] > 0
print('  ->', 'V PORADKU' if ok2 else '!!! CHYBA: kresby nebo cary zmizely')
print('  ulozene kresby v telefonu:',
      len(json.loads(ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')"))), '(ma byt 2)')
print('CELKEM CHYB:', ev('(window.__chyby||[]).length'))
