# -*- coding: utf-8 -*-
import os, sys, tempfile, time, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec
p = Prohlizec()
p.prikaz('Page.enable'); p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-bybit.js'), encoding='utf-8').read())
p.prikaz('Page.navigate', url=sys.argv[1]); time.sleep(5)
p.js("localStorage.setItem('perpdesk.indicators','[\"RSI\"]'); localStorage.removeItem('perpdesk.ind.RSI');")
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
def tap(x, y, c=0.9):
    pt = [{'x':x,'y':y,'radiusX':14,'radiusY':14,'force':1,'id':1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=pt)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[]); time.sleep(c)
def tlacitko(radek, text):
    """souradnice tlacitka s textem v radku podle popisku"""
    r = ev('(() => { const r=[...document.querySelectorAll("#settingsBody .nastaveni-radek")]'
           '.find(x=>x.querySelector(".nastaveni-popisek").textContent===' + json.dumps(radek) + ');'
           'if(!r) return "null"; const b=[...r.querySelectorAll("button")]'
           '.find(x=>x.textContent.trim()===' + json.dumps(text) + ' || (' + json.dumps(text) + '==="toggle" && x.classList.contains("nastaveni-prepinac")));'
           'if(!b) return "null"; const q=b.getBoundingClientRect();'
           'return JSON.stringify({x:Math.round(q.left+q.width/2),y:Math.round(q.top+q.height/2)}); })()')
    return None if r in (None, 'null') else json.loads(r)
def posledni():
    return json.loads(ev("""JSON.stringify((() => {
      const i = window.__graf.getIndicators({name:'RSI'})[0];
      const r = i.result[i.result.length-1] || {};
      return { rsi: r.rsi, ma: r.ma, params: i.calcParams }; })())"""))

tap(*[rect('#indicatorBtn')[k] for k in ('x','y')])
o = rect('.sheet-radek:has(.sheet-item[data-indicator=RSI]) .sheet-ozubene'); tap(o['x'], o['y'], 1.2)
print('radek "Smoothing type" ma zesedle:',
      ev("document.querySelector('.nastaveni-radek--vypnuto .nastaveni-popisek') && [...document.querySelectorAll('.nastaveni-radek--vypnuto .nastaveni-popisek')].map(x=>x.textContent).join(', ')"))
t = tlacitko('Show MA', 'toggle'); tap(t['x'], t['y'])
print('po zapnuti Show MA zesedle:', ev("[...document.querySelectorAll('.nastaveni-radek--vypnuto .nastaveni-popisek')].map(x=>x.textContent).join(', ') || '(nic)'"))
print()
print('%-8s %-10s %-10s %s' % ('typ', 'RSI', 'MA', 'calcParams'))
vysl = {}
for typ in ['SMA', 'EMA', 'SMMA', 'WMA']:
    b = tlacitko('Smoothing type', typ); tap(b['x'], b['y'], 0.8)
    s = posledni(); vysl[typ] = s
    print('%-8s %-10.4f %-10.4f %s' % (typ, s['rsi'], s['ma'], s['params']))
print('  -> typy davaji ruzne hodnoty MA:', 'ANO' if len({round(v['ma'], 4) for v in vysl.values()}) == 4 else 'NE')
print('  -> RSI samotne se typem nemeni:', 'ANO' if len({round(v['rsi'], 4) for v in vysl.values()}) == 1 else 'NE')
print('  -> ulozeno:', ev("JSON.parse(localStorage.getItem('perpdesk.ind.RSI')).typMa"), '(WMA = 3)')
print()
print('=== zdroj ceny ===')
pred = posledni()['rsi']
b = tlacitko('Source', 'Open'); tap(b['x'], b['y'], 0.8)
po = posledni()
print('RSI se zdrojem Close: %.4f   se zdrojem Open: %.4f   params %s' % (pred, po['rsi'], po['params']))
print('  -> zdroj ma vliv:', 'ANO' if abs(pred - po['rsi']) > 1e-6 else 'NE (bug zustava)')
p.js("document.getElementById('sheetBackdrop').click()"); time.sleep(0.8)
snap = p.prikaz('Page.captureScreenshot', format='png')
open(os.path.join(tempfile.gettempdir(), 'rsi_ma.png'),'wb').write(base64.b64decode(snap['data']))
print('CELKEM CHYB:', ev('(window.__chyby||[]).length'), ev('(window.__chyby||[]).join(" | ")') or '')
