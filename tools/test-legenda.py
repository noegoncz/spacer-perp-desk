# -*- coding: utf-8 -*-
"""
Legenda indikatoru musi byt citelna, ne surove calcParams.

Knihovna sama vypisuje "RSI(14,14,0,0)"; chceme "RSI 14 - Close - WMA 14",
a text se musi menit podle nastaveni.
"""
import os, sys, time, json, base64, tempfile
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(KOREN, 'tools'))
from dotyk import Prohlizec
p = Prohlizec()
p.prikaz('Page.enable'); p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read())
p.prikaz('Page.navigate', url=sys.argv[1]); time.sleep(5)
p.js("localStorage.setItem('perpdesk.indicators','[\"VOL\",\"RSI\"]');"
     "localStorage.removeItem('perpdesk.ind.RSI'); localStorage.removeItem('perpdesk.ind.VOL');")
p.js("location.reload()"); time.sleep(5)
p.js("document.querySelector('.position').click()"); time.sleep(4)
def ev(v): return p.prikaz('Runtime.evaluate', expression=v, returnByValue=True).get('result',{}).get('value')
def rect(sel):
    r = ev('(() => { const e=document.querySelector(%s); if(!e) return "null";'
           'const b=e.getBoundingClientRect(); if(!b.width) return "null";'
           'return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}); })()' % json.dumps(sel))
    return None if r in (None,'null') else json.loads(r)
def tap(x,y,c=0.9):
    pt=[{'x':x,'y':y,'radiusX':14,'radiusY':14,'force':1,'id':1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=pt)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[]); time.sleep(c)

# legendy se ctou primo z platna pres verejne API knihovny
def legendy():
    return ev("""(() => {
      return (window.__graf.getIndicators()||[]).map(i => {
        const cp = i.calcParams || [];
        return i.name + ' surove=(' + cp.join(',') + ')';
      }).join(' | ');
    })()""")
print('calcParams:', legendy())
snap = p.prikaz('Page.captureScreenshot', format='png')
open(os.path.join(tempfile.gettempdir(), 'legenda_pred.png'),'wb').write(base64.b64decode(snap['data']))

def nastav(kod, popisek, hodnota):
    tap(*[rect('#indicatorBtn')[k] for k in ('x','y')])
    o = rect('.sheet-radek:has(.sheet-item[data-indicator=%s]) .sheet-ozubene' % kod); tap(o['x'], o['y'], 1.2)
    b = ev('(() => { const r=[...document.querySelectorAll("#settingsBody .nastaveni-radek")]'
           '.find(x=>x.querySelector(".nastaveni-popisek").textContent===%s); if(!r) return "null";'
           'r.scrollIntoView({block:"center"});'
           'const q=[...r.querySelectorAll("button")].find(x=>x.textContent.trim()===%s'
           ' || (%s==="toggle" && x.classList.contains("nastaveni-prepinac")));'
           'if(!q) return "null"; const c=q.getBoundingClientRect();'
           'return JSON.stringify({x:Math.round(c.left+c.width/2),y:Math.round(c.top+c.height/2)}); })()'
           % (json.dumps(popisek), json.dumps(hodnota), json.dumps(hodnota)))
    if b == 'null': print('  !! nenalezeno:', kod, popisek, hodnota); return
    q = json.loads(b); tap(q['x'], q['y'], 0.8)
    p.js("document.getElementById('sheetBackdrop').click()"); time.sleep(0.6)

nastav('RSI', 'Show MA', 'toggle')       # zapnout prumer
nastav('RSI', 'Smoothing type', 'WMA')
nastav('RSI', 'Source', 'High')
print('po zmenach calcParams:', legendy())
snap = p.prikaz('Page.captureScreenshot', format='png')
open(os.path.join(tempfile.gettempdir(), 'legenda_po.png'),'wb').write(base64.b64decode(snap['data']))
print('chyby:', ev('(window.__chyby||[]).length'))
print('snimky v TEMP: legenda_pred.png, legenda_po.png')
