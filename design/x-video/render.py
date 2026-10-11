# Vyfotí úvod a závěr snímek po snímku (30 fps) do PNG.
import sys, os, time, base64
sys.path.insert(0, r'C:\Users\roman\Projekty\spacer-perp-desk\tools')
from dotyk import Prohlizec

KDE = os.path.dirname(os.path.abspath(__file__))
SCENY = {'uvod-nahled': 2.2, 'uvod': 2.2, 'zaver': 3.2}  # délka v sekundách
FPS = 30

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable'):
    p.prikaz(c)
p.prikaz('Emulation.setDeviceMetricsOverride', width=1080, height=1164, deviceScaleFactor=1, mobile=False)
for scena, delka in SCENY.items():
    slozka = os.path.join(KDE, scena)
    os.makedirs(slozka, exist_ok=True)
    p.prikaz('Page.navigate', url=f'http://localhost:8078/karty.html?scena={scena}')
    time.sleep(3)
    p.prikaz('Runtime.evaluate', expression='document.fonts.ready.then(() => 1)', awaitPromise=True)
    for i in range(int(delka * FPS)):
        p.prikaz('Runtime.evaluate', expression=f'nastavCas({i * 1000 / FPS})')
        d = p.prikaz('Page.captureScreenshot', format='png')['data']
        open(os.path.join(slozka, f'{i:04d}.png'), 'wb').write(base64.b64decode(d))
    print(scena, int(delka * FPS), 'snímků')
