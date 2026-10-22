# -*- coding: utf-8 -*-
"""
Zdi v knize příkazů — sběr na serveru (server/zdi.mjs, v0.72.0).

  A) Node: najdiZdi() (pásma, medián × NASOBEK, strany) a Sledovani
     (od kdy, min / max, tolerance výpadku, uzavření až po MIN_TRVANI,
     krátké zdi se neukládají, změna kroku vše uzavře).
  B) Naostro (ZKOUSKA, nic se neposílá): 12 trhů + žádost o trh mimo
     výběr; po dvou minutách mají Binance, Bybit i Hyperliquid zdi,
     nákupní pod středem, prodejní nad, od ≤ teď, min ≤ usd ≤ max.

Spuštění: python tools/test-zdi-server.py <node>
"""
import json, os, subprocess, sys, tempfile, time
sys.stdout.reconfigure(errors='replace')
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = sys.argv[1] if len(sys.argv) > 1 else 'node'
chyby = []


def over(podminka, popis):
    print(('  OK  ' if podminka else '  !!  ') + popis)
    if not podminka:
        chyby.append(popis)


print('A) výpočet a sledování')
skript = r"""
import { najdiZdi, Sledovani, MIN_TRVANI } from './js/zdi-format.js';
// Kniha kolem 100: všude 1 000 USD na pásmo, zeď 50 000 na 99 (bid) a 102 (ask).
const bids = [], asks = [];
for (let i = 1; i <= 50; i += 1) { bids.push([100 - i * 0.1, 10]); asks.push([100 + i * 0.1, 10]); }
bids.push([99, 500]); asks.push([102, 500]);
const v = najdiZdi(bids, asks);
const s = new Sledovani();
const M = 60000;
const kroky = [];
for (let m = 0; m < 6; m += 1) kroky.push(s.krok(m * M, { ...v, zdi: v.zdi.map((z) => [z[0], z[1], z[2] + m * 1000]) }));
const zive = s.ted();
// Zeď zmizí: 2 min tolerance, pak hotová.
const bez = { ...v, zdi: [] };
const h1 = s.krok(6 * M, bez), h2 = s.krok(7 * M, bez), h3 = s.krok(8 * M, bez);
// Krátká zeď (1 min) se neuloží.
const k = new Sledovani();
k.krok(0, v); const kratka = [k.krok(M, bez), k.krok(2 * M, bez), k.krok(3 * M, bez), k.krok(4 * M, bez)].flat();
console.log(JSON.stringify({ v, kroky, zive, h1, h2, h3, kratka, MIN_TRVANI }));
"""
r = subprocess.run([NODE, '--input-type=module', '-e', skript], cwd=KOREN, capture_output=True, text=True, encoding='utf-8')
if r.returncode:
    print(r.stderr[:600])
    over(False, 'Node spustil výpočet')
else:
    d = json.loads(r.stdout)
    v = d['v']
    print('    zdi:', v['zdi'], 'krok', v['krok'])
    over(len(v['zdi']) == 2, 'právě dvě zdi')
    strany = {z[0]: z for z in v['zdi']}
    over(abs(strany[0][1] * v['krok'] - 99) < 1e-9 and abs(strany[1][1] * v['krok'] - 102) < 1e-9, 'nákupní na 99, prodejní na 102')
    over(strany[0][2] >= 49000, f'velikost v USD ({strany[0][2]})')
    over(all(not x for x in d['kroky']), 'během stání nic hotového')
    z0 = next(z for z in d['zive'] if z[0] == 0)
    over(z0[3] == 0 and z0[4] < z0[5] and z0[2] == z0[5], f'živá zeď: od 0, min < max, teď = max ({z0})')
    over(not d['h1'] and not d['h2'], 'výpadek do 2 min zeď neuzavře')
    over(len(d['h3']) == 2 and d['h3'][0][2] == 0 and d['h3'][0][3] == 5 * 60000, f'po 2 min hotová: od 0 do 5. minuty ({d["h3"]})')
    over(not d['kratka'], 'zeď na 1 minutu se neukládá')

print('B) naostro')
stav = tempfile.mkdtemp(prefix='zdi-')
beh = os.path.join(stav, 'beh.mjs')
url = 'file:///' + os.path.join(KOREN, 'server', 'zdi.mjs').replace('\\', '/')
open(beh, 'w', encoding='utf-8').write(f"""
import {{ spustZdi }} from '{url}';
spustZdi({{ log: (...a) => console.log(...a), API: '', TOKEN: '', ZKOUSKA: true, STAV: process.argv[2], limitTrhu: 12 }});
setTimeout(() => process.exit(0), 150000);
""")
env = dict(os.environ, ZKOUSKA='1', ZDI_ZADOSTI='binance:ZECUSDT,bybit:WIFUSDT')
r = subprocess.run([NODE, beh, stav], env=env, capture_output=True, text=True, encoding='utf-8', timeout=200)
print('   ', r.stdout.strip().splitlines()[0] if r.stdout.strip() else r.stderr[:300])
try:
    ted = json.load(open(os.path.join(stav, 'zdi-ted.json'), encoding='utf-8'))
    info = json.load(open(os.path.join(stav, 'zdi-info.json'), encoding='utf-8'))
except Exception as e:
    ted, info = {'k': {}}, {}
    over(False, f'výstup zapsán ({e})')
print('    info:', info)
klice = list(ted['k'])
over(info.get('synchro') == info.get('trhu') and info.get('trhu', 0) >= 12, 'všechny knihy synchronizované')
for b in ('binance:', 'bybit:', 'hyperliquid:'):
    over(any(k.startswith(b) and ted['k'][k][2] for k in klice), f'{b} má zdi')
over('binance:ZECUSDT' in klice and 'bybit:WIFUSDT' in klice, 'trhy z žádostí aplikace se sledují')
spatne = []
for k, (mid, krok, zdi) in ted['k'].items():
    for s, cena, usd, od, mn, mx in zdi:
        if (s == 0 and cena > mid * 1.001) or (s == 1 and cena < mid * 0.999) or not (mn <= usd <= mx) or od > ted['t']:
            spatne.append((k, s, cena, mid))
over(not spatne, f'nákupní pod středem, prodejní nad, min ≤ teď ≤ max ({spatne[:3]})')
print()
print('VÝSLEDEK:', 'PROŠLO' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
