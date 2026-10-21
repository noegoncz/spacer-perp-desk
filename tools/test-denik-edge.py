# -*- coding: utf-8 -*-
"""
Deník fáze 2 (v0.64.0): záložka Journal s podzáložkami Edge / Trades.

A) Výpočty Edge (js/denik-statistiky.js) přes Node: součet, úspěšnost,
   profit factor, průměrné R jen z obchodů se SL, dodržení plánu, věty
   jen od 3 obchodů setupu, cena porušeného plánu.
B) Aplikace (mock Bybitu, skutečné dotyky):
   * záložka se jmenuje Journal, výchozí podzáložka Edge,
   * Edge za 30 dní: Net PnL a počet sedí na uzavřené obchody v mocku
     (b3 +14.04, a2 −10 → +4.04, 2 obchody, úspěšnost 50 %, PF 1.40),
     a2 je 9 dní stará → Edge si dotáhne starší historii sám,
   * období 7 dní → jen b3; volba se pamatuje po přenačtení,
   * čekající zhodnocení → klepnutí přepne na Trades,
   * poslední obchod klepnutím otevře prohlídku,
   * skryté částky (oko) schovají PnL i v Edge.

Spuštění: python tools/test-denik-edge.py http://localhost:8075/index.html [node]
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


print('A) výpočty Edge')
skript = r"""
import { souhrn, vety } from './js/denik-statistiky.js';
const p = (setup, riziko, plan) => ({ vstup: { setup, riziko }, zhodnoceni: plan ? { plan } : null });
const o = [
  { pnl: 20, zavreno: 1, poznamka: p('Retest', 10, 'yes') },     // +2 R
  { pnl: 10, zavreno: 2, poznamka: p('Retest', 10, 'yes') },     // +1 R
  { pnl: -10, zavreno: 3, poznamka: p('Retest', 10, 'no') },     // −1 R, plán porušen
  { pnl: -15, zavreno: 4, poznamka: p('Breakout', null, 'no') }, // bez SL → bez R
  { pnl: 5, zavreno: 5, poznamka: null },                        // bez poznámky
];
const s = souhrn(o);
console.log(JSON.stringify({ s, v: vety(s) }));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:500])
    over(False, 'Node spustil výpočty')
else:
    d = json.loads(r.stdout)
    s, v = d['s'], d['v']
    print('   ', {k: s[k] for k in ('pocet', 'pnl', 'uspesnost', 'profitFactor', 'prumerR', 'planDodrzen', 'bezZhodnoceni')})
    over(s['pocet'] == 5 and abs(s['pnl'] - 10) < 1e-9, 'součet +10 z 5 obchodů')
    over(abs(s['uspesnost'] - 0.6) < 1e-9, 'úspěšnost 60 %')
    over(abs(s['profitFactor'] - 35 / 25) < 1e-9, 'profit factor 35 / 25 = 1.4')
    over(abs(s['prumerR'] - 2 / 3) < 1e-9, 'průměrné R jen z obchodů se SL: (2 + 1 − 1) / 3')
    over(abs(s['planDodrzen'] - 0.5) < 1e-9, 'plán dodržen ve 2 ze 4 zhodnocení')
    over(s['bezZhodnoceni'] == 1, 'jeden obchod bez zhodnocení')
    over([x['v'] for x in s['krivka']] == [20, 30, 20, 5, 10], 'křivka = průběžný součet podle zavření')
    klice = [x['klic'] for x in v]
    print('    věty:', klice)
    over(klice[0] == 'bestSetupR' and v[0]['data']['nazev'] == 'Retest', 'nejlepší setup Retest (3 obchody, R)')
    over('worstSetup' not in klice and 'worstSetupR' not in klice, 'Breakout (1 obchod) bez věty — malý vzorek')
    plan = next((x for x in v if x['klic'].startswith('planCost')), None)
    over(plan and abs(plan['data']['pnl'] + 25) < 1e-9 and abs(plan['data']['r'] + 1) < 1e-9,
         'porušený plán: −25 USD, −1 R (R jen z obchodu se SL)')

print('B) aplikace')
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=2, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True)
# Deník ve výchozím stavu (Edge), ne v pohledu Trades jako starší testy.
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source="sessionStorage.setItem('__denikVychozi', '1');")
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


def klepni(selektor):
    b = ev(f"""(() => {{ const e = document.querySelector({json.dumps(selektor)}); if (!e) return null;
      e.scrollIntoView({{ block: 'center' }}); const r = e.getBoundingClientRect();
      return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()""")
    if not b:
        return False
    bod = [{'x': b['x'], 'y': b['y'], 'radiusX': 8, 'radiusY': 8, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    return True


def vyber(id_, hodnota):
    ev(f"(() => {{ const v = document.getElementById('{id_}'); v.value = '{hodnota}'; v.dispatchEvent(new Event('change')); }})()")


over(ev("document.querySelector('.tab[data-tab=history]').textContent.trim()") == 'Journal', 'záložka se jmenuje Journal')
klepni('.tab[data-tab=history]')
time.sleep(4)
pohled = ev("(document.querySelector('#journalTabs .list-tab.active') || {}).dataset?.id")
over(pohled == 'edge', f'výchozí podzáložka je Edge ({pohled})')
over(not ev("document.getElementById('journalEdge').hidden") and ev("document.getElementById('journalTrades').hidden"),
     'Edge vidět, seznam obchodů schovaný')
over(ev("document.getElementById('journalPeriod').value") == '30', 'výchozí období 30 dní')
edge = lambda: ev("document.getElementById('journalEdge').innerText.replace(/\\s+/g, ' ')") or ''
for _ in range(20):
    if '2 trades' in edge():
        break
    time.sleep(0.5)
text = edge()
print('   Edge:', text[:260])
over('+4.04' in text and '2 trades' in text, 'Net PnL +4.04 ze 2 obchodů (a2 je 9 dní stará — dotažena sama)')
over('50 %' in text and '1.40' in text, 'úspěšnost 50 %, profit factor 1.40')
over(ev("!!document.querySelector('#journalEdge .edge-krivka path.edge-cara')"), 'křivka průběžného součtu')
over(ev("document.querySelectorAll('#journalEdge .edge-obchod').length") == 2, 'poslední obchody (2)')

vyber('journalPeriod', '7')
time.sleep(1)
text = edge()
over('+14.04' in text and '1 trade' in text, f'7 dní → jen b3 (+14.04): {text[:80]}')
p.prikaz('Page.reload')
time.sleep(7)
klepni('.tab[data-tab=history]')
time.sleep(3)
over(ev("document.getElementById('journalPeriod').value") == '7' and
     ev("(document.querySelector('#journalTabs .list-tab.active') || {}).dataset?.id") == 'edge',
     'období a podzáložka se pamatují po přenačtení')

over(ev("!!document.querySelector('#journalEdge .edge-review')"), 'pruh „čeká na zhodnocení"')
klepni('#journalEdge .edge-review')
time.sleep(1)
over(ev("(document.querySelector('#journalTabs .list-tab.active') || {}).dataset?.id") == 'trades'
     and not ev("document.getElementById('journalTrades').hidden"), 'klepnutí na pruh přepne na Trades')
klepni('#journalTabs .list-tab[data-id=edge]')
time.sleep(1)
over(ev("(document.querySelector('#journalTabs .list-tab.active') || {}).dataset?.id") == 'edge', 'klepnutí na Edge v liště')

klepni('#journalEdge .edge-obchod')
time.sleep(4)
over(ev("!document.getElementById('viewChart')?.hidden") and ev("window.__graf && window.__graf.getOverlays().some((o) => o.name === 'tradeMark')"),
     'poslední obchod otevře prohlídku se značkami plnění')
ev("history.back()")
time.sleep(1.5)

klepni('#hideBtn')
time.sleep(0.8)
text = edge()
over('••••' in text and '+14.04' not in text, 'skryté částky i v Edge')
klepni('#hideBtn')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
