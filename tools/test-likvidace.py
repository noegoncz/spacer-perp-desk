# -*- coding: utf-8 -*-
"""
Sběr likvidační mapy (server/likvidace.mjs) proti **skutečnému**
Hyperliquidu, v režimu ZKOUSKA=1 (nic neposílá, řádky píše do souborů).

Služba běží ~7 minut s 1 500 největšími účty žebříčku a „hodinou“
zkrácenou na 3 minuty (HODINA_MS), ať je vidět její střídání. Ověřuje se:
  * pozice se načítají (účty s pozicí, žádné 429, skoro žádné chyby),
  * každá „hodina“ coinu začíná řádkem K (jinak by D neměl základ),
  * z řádků K + D se dá složit přesně ten snímek, který služba
    spočítala (kontrola.jsonl = celé snímky 3 největších coinů),
  * hotové hodiny mají kompaktní řádek (snímky po čtvrt hodině, jen K),
  * hodnoty dávají smysl: BTC má likvidace a pásma sedí na kroku ceny.

Potřebuje Node 22: python tools/test-likvidace.py cesta/k/node[.exe]
"""
import json, os, subprocess, sys, tempfile, time
sys.stdout.reconfigure(errors='replace')

NODE = sys.argv[1] if len(sys.argv) > 1 else 'node'
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOBA = int(os.environ.get('DOBA', 420))
HODINA = 180000
stav = tempfile.mkdtemp(prefix='perpyx-liq-')

env = dict(os.environ, ZKOUSKA='1', LIMIT_UCTU='1500', HODINA_MS=str(HODINA), STAV=stav)
print(f'Služba běží {DOBA} s, stav v {stav}')
p = subprocess.Popen([NODE, os.path.join(KOREN, 'server', 'likvidace.mjs')], env=env,
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
time.sleep(DOBA)
p.terminate()
vypis = p.communicate(timeout=10)[0]
print(vypis[-1500:])

chyby = []
def over(podminka, popis):
    print(('  OK  ' if podminka else '  CHYBA  ') + popis)
    if not podminka:
        chyby.append(popis)

info = json.load(open(os.path.join(stav, 'info.json'), encoding='utf-8'))
print('info:', info)
over(info['sPozici'] > 300, f"účty s pozicí: {info['sPozici']}")
over(info['limit429'] == 0, f"žádné 429 ({info['limit429']})")
over(info['chyb'] <= max(5, info['dotazu'] // 50), f"chyby dotazů {info['chyb']} z {info['dotazu']}")
over(info['ws'], 'stream obchodů běží')

# Řádky po coinech a hodinách
radky = {}
for r in open(os.path.join(stav, 'radky.txt'), encoding='utf-8'):
    c, h, d = r.rstrip('\n').split('\t')
    radky.setdefault((c, int(h)), []).append(json.loads(d))
over(len(radky) > 20, f'hodin × coinů s řádky: {len(radky)}')
spatne = [k for k, v in radky.items() if v[0][3] != 'K']
over(not spatne, f'každá hodina začíná řádkem K (špatně: {spatne[:3]})')
hodin = {h for _, h in radky}
over(len(hodin) >= 2, f'vystřídalo se víc hodin: {len(hodin)}')

# Složení snímků (stejně jako rozbal() v js/likvidace-format.js)
slozene = {}
for (c, h), seznam in radky.items():
    pasma = None
    for t, mark, krok, typ, sled, zmeny in seznam:
        if typ == 'K':
            pasma = {}
        else:
            pasma = dict(pasma)
        for i, l, s in zmeny:
            if l or s:
                pasma[i] = [l, s]
            else:
                pasma.pop(i, None)
        slozene[(c, t)] = pasma

kontrola = [json.loads(r) for r in open(os.path.join(stav, 'kontrola.jsonl'), encoding='utf-8')]
porovnano, rozdilne = 0, []
for k in kontrola:
    s = slozene.get((k['c'], k['t']))
    if s is None:
        continue   # v tu minutu coin nic neposlal (beze změny)
    porovnano += 1
    ocekavane = {int(i): b for i, b in k['pasma']}
    if s != ocekavane:
        rozdilne.append((k['c'], k['t']))
over(porovnano >= 10, f'porovnaných snímků: {porovnano}')
over(not rozdilne, f'složené snímky sedí na spočítané (nesedí: {rozdilne[:3]})')

# Kompaktní hodiny
kompakt = [r.rstrip('\n').split('\t') for r in open(os.path.join(stav, 'kompakt.txt'), encoding='utf-8')]
over(len(kompakt) > 5, f'kompaktních hodin: {len(kompakt)}')
jen_k = all(json.loads(x)[3] == 'K' for _, _, d in kompakt for x in json.loads(d).split('\n') if x)
over(jen_k, 'kompaktní řádky jsou jen K')

# Smysl hodnot: BTC
btc = [v for (c, _), v in radky.items() if c == 'BTC']
over(bool(btc), 'BTC má řádky')
if btc:
    t, mark, krok, typ, sled, pasma = btc[-1][0]
    soucet = sum(l + s for _, l, s in pasma)
    print(f'  BTC: mark {mark}, krok {krok}, pásem {len(pasma)}, likvidací {soucet / 1e6:.1f} M USD, sledováno {sled / 1e6:.0f} M')
    over(soucet > 10e6, 'BTC: likvidace přes 10 M USD')
    ceny = [i * krok for i, _, _ in pasma]
    over(all(abs(c / mark - 1) <= 0.25 + krok / mark for c in ceny), 'pásma do ±25 % od ceny')
    longy_pod = all(i * krok < mark * 1.001 for i, l, s in pasma if l and not s)
    over(longy_pod, 'likvidace longů leží pod cenou')

velikost = os.path.getsize(os.path.join(stav, 'radky.txt'))
print(f'  data: {velikost / 1024:.0f} kB řádků za {DOBA} s')
print('\nVÝSLEDEK:', 'PROŠLO' if not chyby else f'{len(chyby)} chyb')
sys.exit(1 if chyby else 0)
