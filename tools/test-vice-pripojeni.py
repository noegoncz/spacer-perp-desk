# -*- coding: utf-8 -*-
"""
Víc připojených burz (v0.55.0, první část).

1) Dosavadní jediný klíč se převede na první připojení (nic se neztratí).
2) V nastavení jsou všechna připojení; aktivní má štítek, ostatní „Přepnout"
   — přepnutí bez nového zadávání klíče, pozice se načtou znovu.
3) Odebrání neaktivního připojení nechá aktivní běžet; odebrání aktivního
   přepne na zbývající.
4) Připojení (s klíči) se nikdy nedostanou do zálohy.

Druhé připojení je Bybit s jiným (vymyšleným) klíčem — podstrčená burza
přijme jakýkoli klíč.

Spuštění: python tools/test-vice-pripojeni.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


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


def radky():
    ev("document.getElementById('settingsBtn').click()")
    time.sleep(0.6)
    return json.loads(ev("""JSON.stringify([...document.querySelectorAll('#exchangeList .exchange-row')].map((r) => ({
      id: r.dataset.pripojeni, nazev: r.querySelector('.exchange-name').firstChild.textContent,
      aktivni: r.classList.contains('aktivni'), klic: r.querySelector('.exchange-key').textContent })))""") or '[]')


print('1) převod dosavadního klíče')
r = radky()
print('   připojení:', r)
over(len(r) == 1 and r[0]['aktivni'] and r[0]['nazev'] == 'Bybit', 'dosavadní klíč je první, aktivní připojení')

print('2) druhé připojení a přepnutí')
ev("""(() => { const s = JSON.parse(localStorage.getItem('perpdesk.pripojeni'));
  s.push({ id: 'druhy', burza: 'bybit', volby: {}, apiKey: 'DRUHYKLIC9999', apiSecret: 'TAJNE' });
  localStorage.setItem('perpdesk.pripojeni', JSON.stringify(s)); })()""")
p.prikaz('Page.reload')
time.sleep(5)
r = radky()
print('   připojení:', r)
over(len(r) == 2 and r[0]['aktivni'] and not r[1]['aktivni'], 'v nastavení jsou obě, aktivní je první')
ev("document.querySelector('#exchangeList .exchange-row[data-pripojeni=druhy] .secondary-btn').click()")
time.sleep(4)
over(ev("localStorage.getItem('perpdesk.apiKey')") == 'DRUHYKLIC9999', 'přepnutí udělalo aktivním druhý klíč')
over(ev("document.querySelectorAll('.position').length") >= 1, 'pozice se po přepnutí načetly')
r = radky()
over(r and r[1]['aktivni'] and not r[0]['aktivni'], 'štítek Aktivní je u druhého')

print('3) odebrání')
ev("window.confirm = () => true")
prvni = r[0]['id'] if r else ''
ev(f"document.querySelector('#exchangeList .exchange-row[data-pripojeni={prvni}] .text-btn').click()")
time.sleep(1)
r = radky()
over(len(r) == 1 and r[0]['id'] == 'druhy' and r[0]['aktivni'], 'odebrání neaktivního nechá aktivní')
over(ev("localStorage.getItem('perpdesk.apiKey')") == 'DRUHYKLIC9999', 'aktivní klíč zůstal')
ev("document.querySelector('#exchangeList .exchange-row[data-pripojeni=druhy] .text-btn').click()")
time.sleep(1)
over(not ev("localStorage.getItem('perpdesk.apiKey')") and ev("localStorage.getItem('perpdesk.pripojeni')") in (None, '[]'),
     'odebrání posledního smaže klíč i seznam')

print('4) záloha bez klíčů')
zaloha = ev("""(async () => 1)() && JSON.stringify(Object.keys(localStorage))""") or ''
mod = ev("""(() => { try { return typeof window.__zalohaKlice; } catch { return ''; } })()""")
klice = json.loads(ev("""JSON.stringify((() => { const k = []; for (let i = 0; i < localStorage.length; i++) k.push(localStorage.key(i)); return k; })())""") or '[]')
ev("""(() => { const s = [{ id: 'z', burza: 'bybit', volby: {}, apiKey: 'ZALOHA', apiSecret: 'TAJNE' }];
  localStorage.setItem('perpdesk.pripojeni', JSON.stringify(s)); })()""")
obsah = p.prikaz('Runtime.evaluate', awaitPromise=True, returnByValue=True, expression="""
  import('./js/zaloha.js').then((z) => JSON.stringify(z.sestavZalohu()))""").get('result', {}).get('value') or ''
over(obsah and 'perpdesk.pripojeni' not in obsah and 'ZALOHA' not in obsah, 'připojení s klíči nejsou v záloze')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
