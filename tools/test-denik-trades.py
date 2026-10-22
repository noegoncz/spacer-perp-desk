# -*- coding: utf-8 -*-
"""
Journal → Trades: filtry a tabulka (v0.68.0).

  A) Node: filtruj() — stav, výsledek, setup (i „bez setupu"), signály
     („nebo"), confluence 3+, plán / bez zhodnocení, review, doba držení,
     období; pocetFiltru().
  B) Aplikace (skutečné dotyky): přepínač karty / tabulka, tabulka má
     řádek na obchod a vlastní posuv (stránka ne), souhrn výběru, okno
     filtrů s počtem na tlačítku, filtr stavu a plánu, „žádný obchod",
     Reset; filtr i rozložení přežijí přenačtení.

Spuštění: python tools/test-denik-trades.py http://localhost:8075/index.html [node]
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


print('A) filtruj()')
skript = r"""
import { filtruj, pocetFiltru } from './js/denik-statistiky.js';
const H = 3600e3, D = 86400e3, ted = 100 * D;
const o = (id, g, vstup, zhodnoceni) => ({ id, g, poznamka: vstup || zhodnoceni ? { vstup, zhodnoceni } : null });
const obchody = [
  o('a', { pnl: 20, otevreno: ted - 2 * D - H, zavreno: ted - 2 * D, posledni: ted - 2 * D }, { setup: 'retest', signaly: ['sr', 'htf', 'fib'] }, { plan: 'yes' }),
  o('b', { pnl: -10, otevreno: ted - 40 * D - 3 * D, zavreno: ted - 40 * D, posledni: ted - 40 * D }, { setup: null, signaly: ['sr'] }, { plan: 'no' }),
  o('c', { pnl: 5, otevreno: ted - 1 * D - 30 * 60e3, zavreno: ted - 1 * D, posledni: ted - 1 * D }, null, null),
  o('d', { pnl: 3, otevrena: true, otevreno: ted - 10 * H, zavreno: null, posledni: ted }, { setup: 'range', signaly: ['news', 'volume'] }, null),
];
const ids = (f) => filtruj(obchody, f, ted).map((x) => x.id).join('');
console.log(JSON.stringify({
  vse: ids({}), open: ids({ stav: 'open' }), closed: ids({ stav: 'closed' }), win: ids({ vysledek: 'win' }), loss: ids({ vysledek: 'loss' }),
  bezSetupu: ids({ setupy: ['-'] }), retestNebo: ids({ setupy: ['retest', 'range'] }), sigNebo: ids({ signaly: ['fib', 'news'] }),
  conf3: ids({ conf: ['3'] }), conf0: ids({ conf: ['0'] }), planNone: ids({ plan: ['none'] }), planNo: ids({ plan: ['no'] }),
  reviewMissing: ids({ review: 'missing' }), held1h: ids({ drzeni: ['h'] }), held1d: ids({ drzeni: ['d'] }), obdobi30: ids({ obdobi: 30 }),
  kombinace: ids({ stav: 'closed', signaly: ['sr'] }),
  pocet: pocetFiltru({ stav: 'open', setupy: [], signaly: ['sr'], obdobi: 30, vysledek: '' }),
}));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:500])
    over(False, 'Node spustil filtry')
else:
    d = json.loads(r.stdout)
    print('   ', d)
    cekam = {'vse': 'abcd', 'open': 'd', 'closed': 'abc', 'win': 'ac', 'loss': 'b', 'bezSetupu': 'bc', 'retestNebo': 'ad',
             'sigNebo': 'ad', 'conf3': 'a', 'conf0': 'c', 'planNone': 'cd', 'planNo': 'b', 'reviewMissing': 'c',
             'held1h': 'c', 'held1d': 'ad', 'obdobi30': 'acd', 'kombinace': 'ab', 'pocet': 3}
    for k, v in cekam.items():
        over(d.get(k) == v, f'{k}: {d.get(k)!r} (čekám {v!r})')

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
    bod = [{'x': b['x'], 'y': b['y'], 'radiusX': 10, 'radiusY': 10, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.5)
    return True


ev("document.querySelector('[data-tab=history]').click()")
time.sleep(4)
ev("[...document.querySelectorAll('#journalTabs [data-id], #journalTabs button')].find((b) => /Trades/.test(b.textContent))?.click()")
time.sleep(1)
over(ev("!document.getElementById('journalFilterBtn').hidden && !document.getElementById('journalLayout').hidden"), 'v Trades je tlačítko Filters a přepínač rozložení')
karet = ev("document.querySelectorAll('#historyList .trade').length") or 0
print('   karet:', karet)
over(karet >= 2, f'karty obchodů ({karet})')
souhrn = ev("document.getElementById('journalSouhrn').hidden ? '' : document.getElementById('journalSouhrn').textContent")
over(bool(souhrn) and 'Win rate' in souhrn, f'souhrn výběru nad seznamem ({souhrn})')

klepni("document.querySelector('#journalLayout [data-l=table]')")
radku = ev("document.querySelectorAll('#historyList .trades-tabulka tbody tr').length")
over(radku == karet, f'tabulka: řádek na obchod ({radku})')
hlavicka = ev("[...document.querySelectorAll('.trades-tabulka th')].map((x) => x.textContent).join('|')")
over(hlavicka == 'Closed|Pair|Setup|Sig.|R|PnL|Plan', f'sloupce ({hlavicka})')
over(not ev("document.documentElement.scrollWidth > innerWidth + 1"), 'stránka se do strany neposouvá (tabulka má vlastní posuv)')
over('Open' in (ev("document.querySelector('.trades-tabulka tbody tr.otevreny')?.textContent || ''") or ''), 'otevřený obchod v tabulce „Open"')
klepni("document.querySelector('.trades-tabulka tbody tr:not(.otevreny)')")
time.sleep(2)
over(ev("!document.getElementById('viewChart').hidden"), 'klepnutí na řádek otevře prohlídku obchodu')
ev("history.back()")
time.sleep(1.5)

klepni("document.getElementById('journalFilterBtn')")
time.sleep(0.4)
over(ev("!!document.querySelector('.denik-sheet:not([hidden])')"), 'otevřelo se okno filtrů')
tl = ev("document.querySelector('.denik-sheet .denik-ulozit').textContent")
over(tl == f'Show {karet} trades', f'tlačítko ukazuje počet ({tl})')
klepni("[...document.querySelectorAll('.denik-sheet .chip')].find((b) => b.dataset.h === 'open')")
tl = ev("document.querySelector('.denik-sheet .denik-ulozit').textContent")
over(tl == 'Show 1 trade', f'filtr Open → 1 obchod ({tl})')
over(ev("document.querySelectorAll('#historyList tbody tr').length") == 1, 'seznam pod oknem se změnil hned')
klepni("[...document.querySelectorAll('.denik-sheet .chip')].find((b) => b.dataset.h === 'yes')")
over(ev("document.querySelector('.denik-sheet .denik-ulozit').textContent") == 'Show 0 trades', 'Open + plán Yes → 0')
klepni("document.querySelector('.denik-sheet .denik-ulozit')")
over('No trades match' in (ev("document.getElementById('historyList').textContent") or ''), 'žádný obchod → hláška')
over(ev("document.getElementById('journalFilterBtn').textContent") == 'Filters · 2', 'tlačítko „Filters · 2" a svítí')
over(ev("document.getElementById('journalFilterBtn').classList.contains('on')"), 'tlačítko filtrů svítí')

print('   přenačtení')
p.prikaz('Page.reload')
time.sleep(9)
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(4)
over(ev("document.getElementById('journalFilterBtn').textContent") == 'Filters · 2', 'filtr přežil přenačtení')
klepni("document.getElementById('journalFilterBtn')")
klepni("[...document.querySelectorAll('.denik-sheet .secondary-btn')].find((b) => /Reset/.test(b.textContent))")
klepni("document.querySelector('.denik-sheet .denik-ulozit')")
over(ev("document.querySelectorAll('#historyList .trades-tabulka tbody tr').length") == karet, 'Reset → zase všechny, rozložení tabulka přežilo přenačtení')
klepni("document.querySelector('#journalLayout [data-l=cards]')")
over(ev("document.querySelectorAll('#historyList .trade').length") == karet, 'zpět na karty')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
