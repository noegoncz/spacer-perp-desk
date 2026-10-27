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

print('A2) confluence a obchody bez setupu (v0.67.0)')
skript = r"""
import { souhrn, vety } from './js/denik-statistiky.js';
const p = (setup, signaly, riziko) => ({ vstup: { setup, signaly, riziko } });
const o = [
  { pnl: 20, zavreno: 1, poznamka: p('retest', ['sr', 'htf', 'fib'], 10) },
  { pnl: 10, zavreno: 2, poznamka: p('retest', ['sr', 'htf', 'fib', 'volume'], 10) },
  { pnl: -5, zavreno: 3, poznamka: p('range', ['sr', 'htf', 'fib'], 10) },
  { pnl: -10, zavreno: 4, poznamka: p(null, ['sr'], 10) },
  { pnl: -10, zavreno: 5, poznamka: p(null, [], 10) },
  { pnl: 5, zavreno: 6, poznamka: p(null, ['news'], 10) },
];
const s = souhrn(o);
console.log(JSON.stringify({ c: s.confluence, b: s.bezSetupu, v: vety(s).map((x) => x.klic) }));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:500])
    over(False, 'Node spustil výpočty confluence')
else:
    d = json.loads(r.stdout)
    print('   ', d)
    over(d['c']['vysoka']['pocet'] == 3 and abs(d['c']['vysoka']['uspesnost'] - 2 / 3) < 1e-9, '3+ signály: 3 obchody, úspěšnost 67 %')
    over(d['c']['nizka']['pocet'] == 3 and abs(d['c']['nizka']['uspesnost'] - 1 / 3) < 1e-9, 'méně signálů: 3 obchody, 33 %')
    over(d['b']['pocet'] == 3 and abs(d['b']['prumerR'] + 0.5) < 1e-9, 'bez setupu: 3 obchody, průměr −0.5 R')
    over('confN' in d['v'] and 'noSetupR' in d['v'], f'věty confluence a bez setupu ({d["v"]})')

print('A3) MFE / MAE, nejdražší chyba, filtry chyb a emocí (v0.69.0)')
skript = r"""
import { mfeMae, intervalProMfe, souhrn, vety, filtruj } from './js/denik-statistiky.js';
const H = 3600e3;
// Long od 100 v čase 2h do 6h; svíčky po hodině.
const sv = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ time: i * H, high: 100 + i, low: 100 - (i === 4 ? 5 : 1), close: 100 }));
const m = mfeMae(sv, { long: true, entry: 100, otevreno: 2 * H + 1, zavreno: 6 * H - 1, delka: H });
const s = mfeMae(sv, { long: false, entry: 100, otevreno: 2 * H + 1, zavreno: 6 * H - 1, delka: H });
const p = (chyby, emoce, riziko) => ({ vstup: { riziko }, zhodnoceni: { chyby, emoce } });
const o = [
  { pnl: -20, zavreno: 1, poznamka: p(['fomo'], 'greedy', 10) },
  { pnl: -10, zavreno: 2, poznamka: p(['fomo', 'exitLate'], 'revenge', 10) },
  { pnl: 15, zavreno: 3, poznamka: p([], 'calm', 10) },
  { pnl: -5, zavreno: 4, poznamka: p(['exitLate'], 'calm', null) },
];
const st = souhrn(o);
const g = (i) => ({ id: i, g: { pnl: o[i].pnl, zavreno: 1, posledni: 1 }, poznamka: o[i].poznamka });
const f = (x) => filtruj([0, 1, 2, 3].map(g), x).map((y) => y.id).join('');
console.log(JSON.stringify({ m, s, interval: intervalProMfe(10 * H, { 1: 60e3, 5: 300e3, 15: 900e3 }), chyba: st.chyba, vety: vety(st).map((x) => x.klic),
  fFomo: f({ chyby: ['fomo'] }), fNone: f({ chyby: ['none'] }), fCalm: f({ emoce: ['calm'] }) }));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:500])
    over(False, 'Node spustil MFE / chyby')
else:
    d = json.loads(r.stdout)
    print('   ', d)
    over(d['m']['mfe'] == 5 and d['m']['mae'] == 5, 'long: MFE +5 (high 105), MAE 5 (low 95) jen ze svíček obchodu')
    over(d['s']['mfe'] == 5 and d['s']['mae'] == 5, 'short: MFE z minima, MAE z maxima')
    over(d['interval'] == '5', f'interval pro MFE: 10 h → 5m (do 300 svíček) ({d["interval"]})')
    over(d['chyba'] and d['chyba']['chyba'] == 'fomo' and d['chyba']['pnl'] == -30 and d['chyba']['pocet'] == 2, 'nejdražší chyba FOMO: −30 ve 2 obchodech')
    over('mistakeCostR' in d['vety'], 'věta o nejdražší chybě')
    over(d['fFomo'] == '01' and d['fNone'] == '2' and d['fCalm'] == '23', 'filtry chyb (i „bez chyb“) a emocí')

print('A4) obchody vynechané ze statistik (v0.85.0)')
skript = r"""
import { souhrn, filtruj } from './js/denik-statistiky.js';
const o = [
  { pnl: 10, zavreno: 1, poznamka: null },
  { pnl: -50, zavreno: 2, poznamka: { vynechano: 5 } },
  { pnl: 5, zavreno: 3, poznamka: { vstup: {}, vynechano: 6 } },
];
const s = souhrn(o);
const g = (i) => ({ id: i, g: { pnl: o[i].pnl, zavreno: 1, posledni: 1 }, poznamka: o[i].poznamka });
const f = (x) => filtruj([0, 1, 2].map(g), x).map((y) => y.id).join('');
console.log(JSON.stringify({ pocet: s.pocet, pnl: s.pnl, bez: s.bezZhodnoceni, ex: f({ review: 'excluded' }), miss: f({ review: 'missing' }) }));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:500])
    over(False, 'Node spustil vynechání')
else:
    d = json.loads(r.stdout)
    print('   ', d)
    over(d['pocet'] == 1 and d['pnl'] == 10 and d['bez'] == 1, 'souhrn počítá jen nevynechaný obchod (+10, 1 bez zhodnocení)')
    over(d['ex'] == '12' and d['miss'] == '0', 'filtr „Not counted“ a vynechané nečekají na zhodnocení')

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

print('C) nepočítat do statistik (v0.85.0)')
vyber('journalPeriod', '30')
time.sleep(1.5)
over('2 trades' in edge(), 'Edge 30 dní: 2 obchody')
klepni('#journalTabs .list-tab[data-id=trades]')
time.sleep(1.5)
cekaPred = ev("document.querySelectorAll('#historyList .denik-btn-review.ceka').length") or 0
klepni('#historyList .denik-btn-review.ceka')
time.sleep(1)
over(ev("!!document.querySelector('.denik-vynechat .nastaveni-prepinac[aria-pressed=false]')"), 'v okně přepínač „Don’t count in stats“ (vypnutý)')
klepni('.denik-vynechat .nastaveni-prepinac')
time.sleep(0.3)
klepni('.denik-ulozit')
time.sleep(1)
over(ev("document.querySelectorAll('#historyList .denik-vynechano').length") == 1, 'karta má štítek „Not counted“')
over(ev("document.querySelectorAll('#historyList .denik-btn-review.ceka').length") == cekaPred - 1, 'vynechaný obchod nečeká na zhodnocení')
klepni('#journalTabs .list-tab[data-id=edge]')
time.sleep(1)
text = edge()
over('1 trade' in text and '2 trades' not in text, f'Edge 30 dní: vynechaný obchod se nepočítá ({text[:80]})')
klepni('#journalTabs .list-tab[data-id=trades]')
time.sleep(1)
klepni('#historyList .denik-vynechano')
time.sleep(1)
over(ev("!!document.querySelector('.denik-vynechat .nastaveni-prepinac[aria-pressed=true]')"), 'štítek otevře okno se zapnutým přepínačem')
klepni('.denik-vynechat .nastaveni-prepinac')
klepni('.denik-ulozit')
time.sleep(1)
over(ev("document.querySelectorAll('#historyList .denik-vynechano').length") == 0, 'vynechání jde zrušit')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
