# -*- coding: utf-8 -*-
"""
Start aplikace musí přežít stránku, které chybí prvky.

Při aktualizaci umí prohlížeč krátce servírovat novou `index.html` se starým
`app.js`. Starý kód pak sahá na prvek, který v nové stránce není. Dřív na tom
spadl celý start — a protože registrace service workeru stála až za ním,
aplikace se nemohla sama opravit ani stažením nové verze.

Test servíruje zmrzačenou stránku (bez několika tlačítek) a ověřuje, že
aplikace přesto nastartuje, zaregistruje service worker a načte pozice.

Spouští si vlastní server, takže stačí:
    python tools/test-odolny-start.py
"""
import os, re, sys, time, json, shutil, threading, tempfile
import http.server, socketserver

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Tlačítka, která v „nové" stránce nebudou. Zastupují prvky odstraněné
# v novější verzi, na které se starší kód ještě odkazuje.
VYHODIT = ['hideBtn', 'refreshBtn', 'magnetBtn', 'indicatorBtn', 'settingsResetBtn']

posun = tempfile.mkdtemp(prefix='perpdesk-mrzak-')
for polozka in ['js', 'css', 'vendor', 'icons', 'sw.js', 'manifest.webmanifest']:
    zdroj = os.path.join(KOREN, polozka)
    if not os.path.exists(zdroj):
        continue
    cil = os.path.join(posun, polozka)
    shutil.copytree(zdroj, cil) if os.path.isdir(zdroj) else shutil.copy(zdroj, cil)

html = open(os.path.join(KOREN, 'index.html'), encoding='utf-8').read()
for id_prvku in VYHODIT:
    html, kolik = re.subn(r'<button[^>]*id="%s".*?</button>' % id_prvku, '', html, flags=re.S)
    assert kolik == 1, 'tlačítko %s se nepodařilo odstranit (%d)' % (id_prvku, kolik)
open(os.path.join(posun, 'index.html'), 'w', encoding='utf-8').write(html)
print('zmrzačená stránka bez tlačítek:', ', '.join(VYHODIT))

os.chdir(posun)
socketserver.TCPServer.allow_reuse_address = True
tichy = type('T', (http.server.SimpleHTTPRequestHandler,),
             {'log_message': lambda *a, **k: None})
server = socketserver.TCPServer(('127.0.0.1', 8078), tichy)
threading.Thread(target=server.serve_forever, daemon=True).start()

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
# Mock bez vypnutého service workeru — právě jeho registraci ověřujeme.
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
# ⚠ Neměříme `getRegistrations()`. V headless Chrome registrace uspěje
# (`register()` se splní), ale ve výpisu se stejně neobjeví — měřili bychom
# vrtoch prohlížeče, ne aplikaci. Zajímá nás jediné: jestli se start
# k registraci vůbec dostane, i když sestavení obrazovky selže.
mock += """
if (navigator.serviceWorker) {
  const puvodni = navigator.serviceWorker.register.bind(navigator.serviceWorker);
  window.__swPokusu = 0;
  navigator.serviceWorker.register = (...a) => { window.__swPokusu += 1; return puvodni(...a); };
}
"""
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url='http://127.0.0.1:8078/index.html')
time.sleep(6)


def ev(v):
    return p.prikaz('Runtime.evaluate', expression=v, returnByValue=True).get('result', {}).get('value')


chyby = ev('(window.__chyby||[]).join(" | ")') or ''
pozic = ev("document.querySelectorAll('.position').length")
sw = ev('window.__swPokusu')
lista = ev("document.getElementById('errorBar').hidden")
zalozky = ev("document.querySelectorAll('.tab').length")

print()
print('chyby při startu:      ', chyby or '(žádné)')
print('chybová lišta skrytá:  ', lista)
print('načtených pozic:       ', pozic, '(má být 1)')
print('záložky sestavené:     ', zalozky, '(má být 3)')
print('registrace SW spuštěna:', sw, 'x (má být aspoň 1x)')

# klepnutí na zbylé tlačítko musí dál fungovat
r = ev('(() => { const e=document.querySelector(".tab[data-tab=\'watchlist\']");'
       'const b=e.getBoundingClientRect(); return JSON.stringify('
       '{x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}); })()')
b = json.loads(r)
pt = [{'x': b['x'], 'y': b['y'], 'radiusX': 14, 'radiusY': 14, 'force': 1, 'id': 1}]
p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=pt)
p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
time.sleep(1.5)
prepnuto = ev("!document.getElementById('viewWatchlist').hidden")
print('zbylé ovládání funguje:', prepnuto)

server.shutdown()
shutil.rmtree(posun, ignore_errors=True)
print()
ok = (not chyby) and pozic == 1 and sw >= 1 and prepnuto and zalozky == 3
print('VÝSLEDEK:', 'START PŘEŽIL' if ok else '!!! START SE ROZPADL')
