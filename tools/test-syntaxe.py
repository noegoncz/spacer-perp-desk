# -*- coding: utf-8 -*-
"""
Naimportuje v prohlížeči každý modul aplikace (js/*.js, js/i18n/*.js).

⚠ Syntaktická chyba v kterémkoli modulu shodí celou aplikaci ještě před
spuštěním — ve v0.23.1 to byl neescapovaný apostrof v anglickém slovníku
(„wasn't" v řetězci v jednoduchých uvozovkách). Zamykací obrazovka
z <head> pak zůstala viset bez obsluhy: nešlo zadat PIN ani „Forgot PIN".
`node --check` takovou chybu v souboru bez package.json nenašel, proto
se to zkouší tam, kde aplikace opravdu běží — v prohlížeči.

Pouštěj po každé úpravě textů. Spuštění:
    python tools/test-syntaxe.py http://localhost:8075
"""
import glob, json, os, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

ZAKLAD = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8075').rstrip('/')
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
soubory = sorted(os.path.relpath(f, KOREN).replace(os.sep, '/')
                 for f in glob.glob(os.path.join(KOREN, 'js', '*.js')) + glob.glob(os.path.join(KOREN, 'js', 'i18n', '*.js')))

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
# Prázdná stránka na stejném původu — moduly se jen načtou, aplikace se nespustí.
p.prikaz('Page.navigate', url=ZAKLAD + '/manifest.webmanifest')
time.sleep(1)
r = p.prikaz('Runtime.evaluate', awaitPromise=True, returnByValue=True, expression="""
(async () => { const vysl = {}; for (const f of %s) {
  try { await import('/' + f + '?t=' + Date.now()); vysl[f] = 'ok'; }
  catch (e) { vysl[f] = String(e); } }
  return vysl; })()""" % json.dumps(soubory))
v = r.get('result', {}).get('value') or {}
# app.js se při importu rovnou spustí a mimo svou stránku padá na chybějící
# prvky — u něj se hledá jen SyntaxError (ten vznikne ještě před spuštěním).
if 'js/app.js' in v and 'SyntaxError' not in v['js/app.js']:
    v['js/app.js'] = 'ok'
spatne = {k: x for k, x in v.items() if x != 'ok'}
for k, x in spatne.items():
    print('  CHYBA', k, x[:160])
print(f'{len(v)} modulů')
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if v and not spatne else f'!!! {len(spatne) or "žádný modul"} chyb')
