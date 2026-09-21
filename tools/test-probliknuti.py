# -*- coding: utf-8 -*-
"""
Kresby nesmí při přepnutí timeframu ani na okamžik zmizet.

Měří se poctivě z plátna: kresba dostane nepřehlédnutelnou barvu a během
přepínání se hustě vzorkuje, jestli je na plátně vidět. Počet vzorků bez ní
je délka probliknutí. Pouhé počítání overlayů by nestačilo — ty v paměti
existovat můžou a přesto se nekreslí.
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

BARVA = '#ff00ff'   # v grafu se jinak nevyskytuje

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
  localStorage.setItem('perpdesk.indicators','[]');
  localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([
    {name:'segment',
     points:[{timestamp:n-6*3600e3,value:0.292},{timestamp:n-1*3600e3,value:0.309}],
     style:{color:'%s', width:3, opacity:1}}])); })()""" % BARVA)
p.js("location.reload()")
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(4)


def ev(v):
    return p.prikaz('Runtime.evaluate', expression=v, returnByValue=True).get('result', {}).get('value')


# Vzorkovač běží ve stránce, ať měří hustě a nezdržuje ho CDP.
p.js("""(() => {
  const cil = [255, 0, 255];
  window.__vzorky = [];
  window.__mer = (ms) => new Promise((hotovo) => {
    window.__vzorky = [];
    const konec = performance.now() + ms;
    const krok = () => {
      let videt = false;
      for (const c of document.querySelectorAll('.chart-box canvas')) {
        let d;
        try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; }
        catch (e) { continue; }
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i]-cil[0]) < 40 && d[i+1] < 60 && Math.abs(d[i+2]-cil[2]) < 40) {
            videt = true; break;
          }
        }
        if (videt) break;
      }
      window.__vzorky.push(videt);
      if (performance.now() < konec) requestAnimationFrame(krok); else hotovo();
    };
    krok();
  });
  return 'ok';
})()""")

print('kresba je videt pred prepnutim:',
      ev("""(() => { const c = [...document.querySelectorAll('.chart-box canvas')];
        for (const x of c) { const d = x.getContext('2d').getImageData(0,0,x.width,x.height).data;
          for (let i=0;i<d.length;i+=4) if (d[i]>215 && d[i+1]<60 && d[i+2]>215) return true; }
        return false; })()"""))
print()

celkem_chybelo = 0
for iv, jmeno in [('60', '1h'), ('15', '15m'), ('240', '4h')]:
    r = json.loads(ev('(() => { const e=document.querySelector(%s);'
                      'const b=e.getBoundingClientRect(); return JSON.stringify('
                      '{x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}); })()'
                      % json.dumps('.interval-btn[data-interval="%s"]' % iv)))
    # měření se rozjede těsně před klepnutím
    p.prikaz('Runtime.evaluate', expression='window.__mer(2500)', awaitPromise=False)
    time.sleep(0.05)
    pt = [{'x': r['x'], 'y': r['y'], 'radiusX': 14, 'radiusY': 14, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=pt)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(3.2)
    vzorky = ev('JSON.stringify(window.__vzorky)')
    v = json.loads(vzorky) if vzorky else []
    chybelo = v.count(False)
    celkem_chybelo += chybelo
    print('prepnuti na %-4s vzorku %3d, kresba nevidet v %3d z nich  %s'
          % (jmeno, len(v), chybelo, '' if chybelo == 0 else '<- probliknuti'))

print()
print('kresba je videt po prepnuti:',
      ev("window.__graf.getOverlays({groupId:'kresby'}).length"), 'overlayu')
print('chyby v konzoli:', ev('(window.__chyby||[]).length'))
print()
print('VYSLEDEK:', 'BEZ PROBLIKNUTI' if celkem_chybelo == 0
      else '!!! KRESBA MIZI (%d vzorku)' % celkem_chybelo)
