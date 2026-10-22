# -*- coding: utf-8 -*-
"""
Journal → Calendar (v0.70.0).

  A) Node: kalendar() — PnL a počet po dnech zavření, jen daný měsíc,
     otevřené obchody ne; klicDne(); filtr dne ve filtruj().
  B) Aplikace (skutečné dotyky, 344 px): třetí podzáložka Calendar,
     buňka dne s uzavřeným obchodem (zelená, částka, počet), dnešek
     orámovaný, šipka „další" na aktuálním měsíci zakázaná, předchozí
     měsíc a zpět; klepnutí na den → Trades jen s obchody toho dne
     a „Filters · 1"; nic nepřetéká do strany.

Spuštění: python tools/test-denik-kalendar.py http://localhost:8075/index.html [node]
"""
import json, os, subprocess, sys, time
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = sys.argv[2] if len(sys.argv) > 2 else 'node'
chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  !!   ') + popis)
    if not podminka:
        chyby.append(popis)


print('A) kalendar()')
skript = r"""
import { kalendar, klicDne, filtruj } from './js/denik-statistiky.js';
const t = (d, h) => new Date(2026, 9, d, h).getTime();
const o = [
  { id: 'a', g: { pnl: 10, zavreno: t(5, 10) } },
  { id: 'b', g: { pnl: -4, zavreno: t(5, 22) } },
  { id: 'c', g: { pnl: -7, zavreno: t(12, 9) } },
  { id: 'd', g: { pnl: 3, zavreno: new Date(2026, 10, 1, 1).getTime() } },
  { id: 'e', g: { pnl: 99, otevrena: true, zavreno: null } },
];
const k = kalendar(o, 2026, 9);
console.log(JSON.stringify({ k, klic: klicDne(t(5, 10)), den: filtruj(o, { den: '2026-10-05' }).map((x) => x.id).join('') }));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:500])
    over(False, 'Node spustil kalendář')
else:
    d = json.loads(r.stdout)
    k = d['k']
    print('   ', d)
    over(k['dny'].get('2026-10-05') == {'pnl': 6, 'pocet': 2, 'vyhranych': 1}, '5. 10.: +6 ze 2 obchodů')
    over(k['dny'].get('2026-10-12', {}).get('pnl') == -7, '12. 10.: −7')
    over(k['pocet'] == 3 and k['pnl'] == -1, 'měsíc: 3 obchody, −1 (listopad a otevřený se nepočítají)')
    over(k['dnyZisk'] == 1 and k['dnyZtrata'] == 1, '1 zelený a 1 červený den')
    over(d['klic'] == '2026-10-05' and d['den'] == 'ab', 'klíč dne a filtr dne')

print('B) aplikace')
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(8)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def klepni(sel):
    b = ev(f"""(() => {{ const e = {sel}; if (!e) return null; e.scrollIntoView({{ block: 'center' }});
      const r = e.getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()""")
    if not b:
        return False
    time.sleep(0.15)
    bod = [{'x': b['x'], 'y': b['y'], 'radiusX': 8, 'radiusY': 8, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.6)
    return True


ev("document.querySelector('[data-tab=history]').click()")
time.sleep(4)
zalozky = ev("[...document.querySelectorAll('#journalTabs button')].map((b) => b.textContent.trim()).filter(Boolean).join('|')")
over('Calendar' in (zalozky or ''), f'podzáložky ({zalozky})')
klepni("[...document.querySelectorAll('#journalTabs button')].find((b) => /Calendar/.test(b.textContent))")
time.sleep(0.6)
over(ev("!document.getElementById('journalCalendar').hidden && document.getElementById('journalTrades').hidden"), 'kalendář je vidět, Trades ne')
bunky = json.loads(ev("JSON.stringify([...document.querySelectorAll('.kal-bunka[data-den]')].map((b) => [b.dataset.den, b.className, b.textContent]))") or '[]')
print('   dny s obchody:', bunky)
zelene = [b for b in bunky if 'zisk' in b[1]]
cervene = [b for b in bunky if 'ztrata' in b[1]]
over(zelene and '+' in zelene[0][2], 'ziskový den je zelený s částkou')
over(all('−' in b[2] for b in cervene), 'ztrátový den je červený se záporem')
over(len(bunky) >= 2, 'kalendář si dotáhl historii od začátku měsíce (víc než prvních 7 dní)')
over(ev("!!document.querySelector('.kal-bunka.dnes')"), 'dnešek je orámovaný')
over(ev("document.querySelectorAll('.kal-sipka')[1].disabled"), 'na aktuálním měsíci nejde dál')
mesic = ev("document.querySelector('.kal-mesic').textContent")
klepni("document.querySelectorAll('.kal-sipka')[0]")
over(ev("document.querySelector('.kal-mesic').textContent") != mesic, 'šipka zpět → předchozí měsíc')
klepni("document.querySelectorAll('.kal-sipka')[1]")
over(ev("document.querySelector('.kal-mesic').textContent") == mesic, 'šipka vpřed → zpět na aktuální')
over(not ev("document.documentElement.scrollWidth > innerWidth + 1"), 'na 344 px nic nepřetéká')
den = zelene[0][0] if zelene else ''
klepni(f"document.querySelector('.kal-bunka[data-den=\"{den}\"]')")
time.sleep(0.6)
over(ev("!document.getElementById('journalTrades').hidden"), 'klepnutí na den přepne na Trades')
over(ev("document.getElementById('journalFilterBtn').textContent") == 'Filters · 1', 'filtr dne je zapnutý (Filters · 1)')
datumy = ev("[...document.querySelectorAll('#historyList .trade .trade-when')].map((x) => x.textContent).join(' | ')") or ''
d = den.split('-')
over(datumy and all(f'{int(d[2])}.{int(d[1])}.{d[0]}' in x for x in datumy.split(' | ')), f'jen obchody toho dne ({datumy})')
over(not ev("[...document.querySelectorAll('#historyList .trade')].some((k) => k.classList.contains('otevreny'))"), 'otevřený obchod mezi nimi není')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
