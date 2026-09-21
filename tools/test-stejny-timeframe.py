# -*- coding: utf-8 -*-
"""
Druhé klepnutí na **už aktivní** timeframe nesmí kresby shodit.

Knihovna na stejné období znovu nesáhne pro data, takže se callback
`getBars` nezavolá — a právě v něm se kresby vracejí zpátky do grafu.
Bez ošetření zmizely až do přepnutí na jiný timeframe.
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=open(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mock-bybit.js'),
    encoding='utf-8').read())
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("""(() => { const n = Date.now();
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([
    {name:'segment', points:[{timestamp:n-40*14400e3,value:0.29},
                             {timestamp:n-10*14400e3,value:0.31}], style:{}},
    {name:'horizontalStraightLine', points:[{timestamp:n-20*14400e3,value:0.305}], style:{}}]));
  localStorage.setItem('perpdesk.indicators','[]'); })()""")
p.js("location.reload()")
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(4)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    return r.get('result', {}).get('value')


def klepni(sel, cekat=1.4):
    r = ev('(() => { const e=document.querySelector(' + json.dumps(sel) + '); if(!e) return "null";'
           'const b=e.getBoundingClientRect(); return JSON.stringify('
           '{x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}); })()')
    b = json.loads(r)
    pt = [{'x': b['x'], 'y': b['y'], 'radiusX': 14, 'radiusY': 14, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=pt)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(cekat)


def kresby():
    return ev("window.__graf.getOverlays({groupId:'kresby'}).length")


ok = True
print('kreseb po otevreni grafu:', kresby(), '(ma byt 2)')
print()
print('=== opakovana klepnuti na TENTYZ timeframe ===')
for i in range(1, 4):
    klepni('.interval-btn[data-interval="240"]')   # 4h uz je aktivni
    k = kresby()
    print('  %d. klepnuti na aktivni 4h -> kreseb %d %s'
          % (i, k, '' if k == 2 else '  !!! CHYBA'))
    if k != 2:
        ok = False

print()
print('=== prepnuti na jiny a zpet ===')
for iv, jmeno in [('60', '1h'), ('240', '4h')]:
    klepni('.interval-btn[data-interval="%s"]' % iv)
    k = kresby()
    print('  po prepnuti na %-3s -> kreseb %d %s' % (jmeno, k, '' if k == 2 else '  !!! CHYBA'))
    if k != 2:
        ok = False

print()
print('=== zavrit a znovu otevrit graf (stejny interval) ===')
# Pojistka k opravě: na stejné období se `getBars` nezavolá, takže se
# srovnání pohledu muselo doplnit zvlášť. Graf musí začínat u posledních
# svíček, ne tam, kde ho uživatel minule nechal.
p.js("window.__graf.scrollByDistance(-500)")
time.sleep(1.2)
pred = ev("JSON.stringify(window.__graf.getVisibleRange())")
p.js("document.getElementById('chartBackBtn').click()")
time.sleep(1.5)
p.js("document.querySelector('.position').click()")
time.sleep(3)
po = json.loads(ev("JSON.stringify(window.__graf.getVisibleRange())"))
celkem = ev("window.__graf.getDataList().length")
print('  odscrollovano do historie:', pred)
print('  po znovuotevreni:         ', json.dumps(po))
naKonci = po['to'] >= celkem
print('  graf zacina u poslednich svicek:', 'ANO' if naKonci else '!!! NE')
print('  kreseb po znovuotevreni:', kresby(), '(ma byt 2)')
if not naKonci or kresby() != 2:
    ok = False

print()
print('ulozene kresby v telefonu:',
      len(json.loads(ev("localStorage.getItem('perpdesk.drawings.JUPUSDT')"))), '(ma byt 2)')
print('aktivni timeframe:',
      ev("[...document.querySelectorAll('.interval-btn.active')].map(b=>b.textContent.trim()).join(',')"))
print('chyby v konzoli:', ev('(window.__chyby||[]).length'))
print()
print('VYSLEDEK:', 'V PORADKU' if ok else '!!! KRESBY MIZI')
