# -*- coding: utf-8 -*-
"""
Víc připojených burz (v0.55.0) — od v0.59.0 všechny účty najednou.

1) Dosavadní jediný klíč se převede na první připojení (nic se neztratí).
2) Dva účty běží současně: pozice obou v jednom seznamu, u karet štítek
   účtu, v nastavení žádné „Přepnout"; Historie má volbu účtu.
3) Odebrání jednoho účtu nechá druhý běžet (jeho pozice zůstanou).
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
    return json.loads(ev("""JSON.stringify([...document.querySelectorAll('#exchangeList .exchange-row[data-pripojeni]')].map((r) => ({
      id: r.dataset.pripojeni, nazev: r.closest('.exchange-blok').querySelector('.exchange-name').textContent,
      klic: r.querySelector('.exchange-key').textContent })))""") or '[]')


print('1) převod dosavadního klíče')
r = radky()
print('   připojení:', r)
over(len(r) == 1 and r[0]['nazev'] == 'Bybit', 'dosavadní klíč je první připojení')

print('2) dva účty najednou')
ev("""(() => { const s = JSON.parse(localStorage.getItem('perpdesk.pripojeni'));
  s.push({ id: 'druhy', burza: 'bybit', volby: {}, apiKey: 'DRUHYKLIC9999', apiSecret: 'TAJNE' });
  localStorage.setItem('perpdesk.pripojeni', JSON.stringify(s)); })()""")
p.prikaz('Page.reload')
time.sleep(6)
r = radky()
print('   připojení:', r)
over(len(r) == 2, 'v nastavení jsou oba účty')
over(not ev("document.querySelector('#exchangeList .exchange-row[data-pripojeni] .secondary-btn')"), 'žádné tlačítko Přepnout')
ev("document.getElementById('backBtn').click()")
time.sleep(0.5)
karty = ev("[...document.querySelectorAll('.position')].map((k) => (k.querySelector('.pos-burza') || {}).textContent + ' ' + k.querySelector('.pos-symbol').textContent)") or []
print('   karty:', karty)
over(len(karty) == 2 and len(set(karty)) == 2 and all('Bybit ••' in k for k in karty),
     'pozice obou účtů v jednom seznamu, každá se štítkem účtu')
ev("document.querySelector('.tab[data-tab=history]').click()")
time.sleep(1.5)
ucty = ev("[...document.querySelectorAll('#historyAccounts .list-tab')].map((b) => b.textContent + (b.classList.contains('active') ? '*' : ''))") or []
print('   Historie:', ucty)
over(len(ucty) == 2 and sum(u.endswith('*') for u in ucty) == 1, 'Historie nabízí volbu účtu')
ev("document.querySelectorAll('#historyAccounts .list-tab')[1].click()")
time.sleep(1.5)
over(ev("document.querySelectorAll('#historyAccounts .list-tab')[1].classList.contains('active')"), 'volba účtu v Historii funguje')
over(ev("document.querySelectorAll('.position').length") == 2, 'pozice obou účtů běží dál')
ev("document.querySelector('.tab[data-tab=positions]').click()")
time.sleep(0.5)

print('3) odebrání')
ev("window.confirm = () => true")
r = radky()
prvni = [x['id'] for x in r if x['id'] != 'druhy'][0] if r else ''
ev(f"document.querySelector('#exchangeList .exchange-row[data-pripojeni={prvni}] .text-btn').click()")
time.sleep(1.5)
r = radky()
over(len(r) == 1 and r[0]['id'] == 'druhy', 'odebrání jednoho účtu nechá druhý')
ev("document.getElementById('backBtn').click()")
time.sleep(0.5)
over(ev("document.querySelectorAll('.position').length") == 1 and not ev("document.querySelector('.pos-burza')"),
     'zbyla pozice druhého účtu (u jednoho účtu bez štítku)')
over(ev("localStorage.getItem('perpdesk.apiKey')") == 'DRUHYKLIC9999', 'aktivní klíč = zbylý účet')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.5)
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
