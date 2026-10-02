# -*- coding: utf-8 -*-
"""
Vyrobí záhlaví profilu na X (1500 × 500, varianty a–d) a profilovou fotku
(400 × 400) ze zahlavi.html přes headless Chrome (port 9223, viz tools/README.md).
Navíc náhled, jak záhlaví vypadá v profilu s fotkou vlevo dole.

Spuštění: python design/x-profil/vyrob.py
"""
import sys, time, base64, pathlib
ZDE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ZDE.parent.parent / 'tools'))
from dotyk import Prohlizec

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable'):
    p.prikaz(c)


def vyfot(kotva, w, h, nazev, skala=2):
    p.prikaz('Emulation.setDeviceMetricsOverride', width=w, height=h, deviceScaleFactor=skala, mobile=False)
    p.prikaz('Page.navigate', url=(ZDE / 'zahlavi.html').as_uri() + '#' + kotva)
    time.sleep(1.5)
    p.prikaz('Page.reload')  # změna kotvy sama stránku nepřenačte
    time.sleep(1.5)
    data = p.prikaz('Page.captureScreenshot', format='png', clip={'x': 0, 'y': 0, 'width': w, 'height': h, 'scale': 1})['data']
    (ZDE / nazev).write_bytes(base64.b64decode(data))
    print('uloženo', nazev)


for v in 'abcde':
    vyfot(v, 1500, 500, f'zahlavi-{v}.png')
vyfot('avatar', 400, 400, 'profilova-fotka.png', skala=1)
