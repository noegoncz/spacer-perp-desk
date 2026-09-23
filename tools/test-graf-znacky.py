# -*- coding: utf-8 -*-
"""
Značení pozice v grafu a v proužku (v0.16.1).

Ověřuje, co si uživatel vyžádal:
  * v grafu **není** čára vstupu — místo ní jsou malé trojúhelníky plnění
    (zelené nákupy, červené prodeje),
  * aktuální cenu kreslí vlastní linka PNLLINE se ziskem v USDT i procentech,
    barevná podle zisku, a vestavěná linka poslední ceny je vypnutá,
  * SL i TP (celé i částečné) mají dlouhé přerušované čáry,
  * v proužku karty je vstup plná silnější fialová (je to **průměrná** cena),
  * součet zaplaceného fundingu je na kartě vidět, a když Bybit dlouhé okno
    odmítne, popisek netvrdí „celkem", ale za kolik dní součet je.

Spuštění: python tools/test-graf-znacky.py http://localhost:8080
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += "\nlocalStorage.removeItem('perpdesk.indicators');\n"

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Network.enable')
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True, awaitPromise=True)
    if 'exceptionDetails' in r:
        return 'VYJIMKA: ' + str(r['exceptionDetails'].get('exception', {}).get('description'))[:300]
    return r.get('result', {}).get('value')


chyby = []

# ---- proužek v kartě: vstup plnou fialovou ----
print('=== proužek v kartě ===')
styl = json.loads(ev("""(() => {
  const e = document.querySelector('.ladder-track .tick.entry');
  if (!e) return 'null';
  const s = getComputedStyle(e);
  return JSON.stringify({ sirka: s.width, pozadi: s.backgroundImage, barva: s.backgroundColor });
})()""") or 'null') or {}
print('vstup v proužku:', styl)
if styl.get('sirka') != '4px':
    chyby.append(f"vstup v proužku má být 4 px silný, je {styl.get('sirka')}")
if styl.get('pozadi') != 'none':
    chyby.append('vstup v proužku je pořád čárkovaný (má být plná barva)')
if styl.get('barva') != 'rgb(167, 139, 250)':
    chyby.append(f"vstup v proužku nemá fialovou: {styl.get('barva')}")

# ---- funding: součet za celou dobu držení ----
funding = ev("""(() => { const f = document.querySelector('.pos-funding');
  return f ? f.textContent : ''; })()""")
print('funding na kartě:', funding or '(chybí)')
if 'paid so far' not in (funding or ''):
    chyby.append('na kartě chybí součet zaplaceného fundingu')

# ---- graf ----
print()
print('=== graf ===')
ev("document.querySelector('.position').click()")
time.sleep(4)

cary = json.loads(ev("""JSON.stringify(
  window.__graf.getOverlays().filter((o) => o.name === 'positionLine')
    .map((o) => ({ title: o.extendData.title, dash: o.extendData.dash })))""") or '[]')
print('čáry pozice:', cary)
if any('Entry' in (c['title'] or '') for c in cary):
    chyby.append('čára vstupu se pořád kreslí, měla zmizet')
for c in cary:
    if c['title'].startswith('SL') or c['title'].startswith('TP'):
        if c['dash'] != [14, 6]:
            chyby.append(f"{c['title']} nemá dlouhou přerušovanou čáru: {c['dash']}")
if not any(c['title'].startswith('TP') for c in cary):
    chyby.append('v grafu chybí take profit')
if not any(c['title'].startswith('SL') for c in cary):
    chyby.append('v grafu chybí stop loss')

znacky = json.loads(ev("""JSON.stringify(
  window.__graf.getOverlays().filter((o) => o.name === 'tradeMark')
    .map((o) => ({ vstup: o.extendData.vstup, maly: o.extendData.maly,
                   barva: o.extendData.color, popis: o.extendData.title || '' })))""") or '[]')
print('značky plnění:', znacky)
# Mock má dva nákupy (vstup do longu) a jeden prodej (výstup).
if len(znacky) != 3:
    chyby.append(f'čekaly se 3 značky plnění, je jich {len(znacky)}')
if sum(1 for z in znacky if z['vstup']) != 2:
    chyby.append('vstupy nesedí — mají být dva nákupy')
if not all(z['maly'] for z in znacky):
    chyby.append('značky plnění mají být malé, bez popisku')
if any(z['popis'] for z in znacky):
    chyby.append('malé značky nemají mít popisek')
zelene = {z['barva'] for z in znacky if z['vstup']}
cervene = {z['barva'] for z in znacky if not z['vstup']}
print('barvy — vstupy:', zelene, ' výstupy:', cervene)
if zelene != {'#16c784'} or cervene != {'#ea3943'}:
    chyby.append('vstupy mají být zelené a výstupy červené')

# ---- linka aktuální ceny ----
linka = ev("window.__graf.getIndicators({ name: 'PNLLINE' }).length")
print('linka zisku v grafu:', linka, '(má být 1)')
if linka != 1:
    chyby.append('linka aktuální ceny se nepřidala')

vestavena = ev("""window.__graf.getStyles().candle.priceMark.last.line.show""")
print('vestavěná linka poslední ceny:', vestavena, '(má být False)')
if vestavena:
    chyby.append('vestavěná linka poslední ceny se nevypnula — kreslily by se dvě')

# Linka se nesmí zapsat mezi indikátory uživatele, jinak by ji příště
# aplikace obnovila i na páru bez pozice.
ulozene = ev("localStorage.getItem('perpdesk.indicators') || ''")
print('uložené indikátory:', ulozene or '(žádné)')
if 'PNLLINE' in (ulozene or ''):
    chyby.append('PNLLINE se uložila mezi indikátory uživatele')

# ---- pixely: linka i text jsou v pravé části plátna a v barvě zisku ----
# ⚠ Samotný počet barevných pixelů nic nedokazuje — zelené i červené jsou
# i svíčky. Měří se proto **rozdíl** proti plátnu bez linky: kolik barvy
# přibude jejím zapnutím. Plátna knihovny nemají id ani třídu, berou se
# podle šířky (nejširší je plocha se svíčkami).
#
# ⚠ Barva se určuje ze znaménka zisku, ne natvrdo. Poslední svíčka mocku je
# pod vstupem, takže je linka správně červená — hledat zelenou by nahlásilo
# chybu, která není. (Stálo to jeden falešný poplach.)
zisk = ev("""(() => { const d = window.__graf.getDataList();
  return d[d.length - 1].close - 0.30135; })()""")
zelena = zisk >= 0
print('zisk proti vstupu:', round(zisk, 5), '- čeká se',
      'zelená' if zelena else 'červená')

ev("""window.__barevne = (zelena) => {
  const vsechna = [...document.querySelectorAll('canvas')];
  const sirka = Math.max(...vsechna.map((c) => c.width));
  const platna = vsechna.filter((c) => c.width === sirka && c.height > 100);
  let vpravo = 0;
  for (const c of platna) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] < 40) continue;
      const sedi = zelena
        ? (d[i+1] > 140 && d[i] < 90 && d[i+2] < 150)
        : (d[i] > 180 && d[i+1] < 90 && d[i+2] < 90);
      if (sedi && (i / 4) % sirka > sirka * 0.6) vpravo += 1;
    }
  }
  return vpravo;
};""")
sLinkou = ev(f"window.__barevne({str(zelena).lower()})")
ev("window.__graf.removeIndicator({ name: 'PNLLINE' })")
time.sleep(0.6)
bezLinky = ev(f"window.__barevne({str(zelena).lower()})")
pribylo = (sLinkou or 0) - (bezLinky or 0)
print('barevné pixely vpravo — s linkou:', sLinkou,
      ' bez linky:', bezLinky, ' rozdíl:', pribylo)
# Čára přes ~40 % šířky plus text se ziskem: pár set pixelů. Kdyby se
# nekreslilo nic, rozdíl je nula.
if pribylo < 150:
    chyby.append(f'linka zisku na plátně skoro nic nepřidala ({pribylo} px)')
ev("window.__graf.createIndicator({ name: 'PNLLINE', paneId: 'candle_pane' })")

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
print('chyby v konzoli:', konzole or '(žádné)')
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

# ---- druhý běh: Bybit odmítne dlouhé okno fundingu ----
print()
print('=== funding s odmítnutým oknem ===')
p.prikaz('Page.addScriptToEvaluateOnNewDocument',
         source='window.__uzkeOknoFundingu = true;')
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)
kratky = ev("""(() => { const f = document.querySelector('.pos-funding');
  return f ? f.textContent : ''; })()""")
print('funding na kartě:', kratky or '(chybí)')
if 'paid' not in (kratky or ''):
    chyby.append('součet fundingu zmizel, když Bybit odmítl dlouhé okno')
elif 'so far' in (kratky or ''):
    chyby.append('popisek tvrdí „celkem", přestože jde jen o pár dní')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: ZNAČENÍ V GRAFU I V PROUŽKU SEDÍ')
