# -*- coding: utf-8 -*-
"""
Hlášení problému / nápadu z aplikace (js/hlaseni.js, beta).

  * tlačítko v rohu vidí přihlášený uživatel, nepřihlášený ne,
  * okno: Problém / Nápad, text, screenshot (skutečný výběr souboru přes
    CDP), náhled s možností odebrání, technické údaje vidět předem,
  * odeslání: snímek zmenšený na JPEG, text, druh, údaje — a **žádný
    API klíč** v celém požadavku,
  * prázdné hlášení se neodešle, po odeslání poděkování a vyčištění.

perpyx.com je tu podstrčený (zachytí požadavek); ostrý server ověřuje
tools/test-ucet-server.py.

Spuštění: python tools/test-hlaseni.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const bybit = window.fetch;
  window.__hlaseni = [];
  window.fetch = async function (vstup, volby = {}) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.endsWith('/api/account/feedback')) {
      window.__hlaseni.push(volby.body);
      return new Response('{"ok":true}', { status: 200 });
    }
    return bybit(vstup, volby);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable', 'DOM.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock + '\n' + po)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


vidim = lambda i: ev(f"!document.getElementById('{i}').hidden")

p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
print('1) tlačítko a okno')
over(vidim('feedbackBtn'), 'přihlášený vidí tlačítko v rohu')
ev("document.getElementById('feedbackBtn').click()")
time.sleep(0.4)
over(vidim('sheetFeedback'), 'klepnutí otevře okno hlášení')
info = ev("document.getElementById('feedbackInfo').textContent") or ''
over('version:' in info and 'device:' in info and 'FAKEKEY' not in info, f'technické údaje vidět předem, bez klíče')
ev("document.getElementById('feedbackSend').click()")
time.sleep(0.3)
over('Write a few words' in (ev("document.getElementById('feedbackMsg').textContent") or ''), 'prázdné hlášení se neodešle')

print('2) screenshot')
uzel = p.prikaz('DOM.getDocument')['root']['nodeId']
vstup = p.prikaz('DOM.querySelector', nodeId=uzel, selector='#feedbackFile')['nodeId']
p.prikaz('DOM.setFileInputFiles', nodeId=vstup, files=[os.path.join(KOREN, 'icons', 'icon-512.png'),
                                                       os.path.join(KOREN, 'icons', 'icon-192.png')])
time.sleep(1.2)
over(ev("document.querySelectorAll('.feedback-shot').length") == 2, 'náhledy dvou snímků')
ev("document.querySelector('.feedback-shot button').click()")
time.sleep(0.2)
over(ev("document.querySelectorAll('.feedback-shot').length") == 1, 'snímek jde odebrat')

print('3) odeslání')
ev("document.querySelector('.feedback-kind [data-kind=idea]').click()")
ev("document.getElementById('feedbackText').value = 'Graf by mohl mít tmavší mřížku.'")
ev("document.getElementById('feedbackSend').click()")
time.sleep(1)
tela = ev("window.__hlaseni") or []
over(len(tela) == 1, 'odešel jeden požadavek')
d = json.loads(tela[0]) if tela else {}
over(d.get('kind') == 'idea' and 'tmavší mřížku' in d.get('message', ''), 'druh a text')
obr = d.get('images') or []
over(len(obr) == 1 and obr[0].startswith('/9j/'), 'snímek zmenšený jako JPEG (base64)')
over(d.get('info', {}).get('version', '').startswith('0.') and d.get('info', {}).get('view'), f'technické údaje ({d.get("info")})')
over('FAKEKEY' not in tela[0] and 'FAKESECRET' not in tela[0], 'v požadavku NENÍ API klíč ani secret')
over('Thank you' in (ev("document.getElementById('feedbackMsg').textContent") or ''), 'poděkování')
over(ev("document.getElementById('feedbackText').value") == '' and ev("document.querySelectorAll('.feedback-shot').length") == 0,
     'po odeslání vyčištěno')
time.sleep(2)
over(not vidim('sheetFeedback'), 'okno se samo zavře')

print('4) bez účtu')
ev("sessionStorage.setItem('__bezUctu', '1'); localStorage.removeItem('perpdesk.session')")
p.prikaz('Page.reload')
time.sleep(4)
over(not vidim('feedbackBtn'), 'nepřihlášený tlačítko nevidí')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
