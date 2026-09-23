# -*- coding: utf-8 -*-
"""
Značení pozice v grafu a v kartě (v0.16.2).

Ověřuje, co si uživatel vyžádal:
  * v grafu **není** čára vstupu — místo ní jsou malé trojúhelníky plnění
    (světle zelené nákupy, oranžové prodeje; barvy svíček by splynuly),
  * karta: velikost v hlavičce, mřížka s hodnotami pryč, nad proužkem se
    hýbe jen aktuální cena, vstup stojí pod proužkem mezi SL a TP,
    likvidace v patičce u fundingu a pod proužkem částky, které SL a TP
    znamenají v penězích,
  * aktuální cenu kreslí vlastní linka PNLLINE se ziskem v USDT i procentech,
    barevná podle zisku, a vestavěná linka poslední ceny je vypnutá,
  * SL i TP (celé i částečné) mají dlouhé přerušované čáry,
  * v proužku karty je vstup plná silnější fialová (je to **průměrná** cena),
  * součet zaplaceného fundingu je na kartě vidět za **celou dobu držení**
    (mock napodobuje skutečná omezení deníku: časy jen v páru, okno max
    7 dní, filtr jen na baseCoin), a když čas otevření pozice neznáme,
    popisek netvrdí „celkem", ale za kolik dní součet je.

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

# ---- hlavička: velikost v coinu i v USDT ----
velikost = ev("(document.querySelector('.pos-size') || {}).textContent || ''")
print('velikost v hlavičce:', velikost or '(chybí)')
for kus in ('2,547 JUP', '778.87 USDT'):
    if kus not in velikost:
        chyby.append(f'v hlavičce chybí {kus}')

# ---- mřížka s hodnotami je pryč, všechno se čte u proužku ----
mrizka = ev("document.querySelectorAll('.position .pos-grid').length")
print('mřížek v kartě:', mrizka, '(má být 0)')
if mrizka:
    chyby.append('karta má pořád mřížku s hodnotami')

# ---- nad proužkem se hýbe jediná věc: aktuální cena ----
ceny = json.loads(ev("""(() => {
  const nahore = [...document.querySelectorAll('.ladder-ceny span')];
  const m = document.querySelector('.ladder-ceny .cena-mark');
  const u = document.querySelector('.ladder-now');
  return JSON.stringify({ pocet: nahore.length, mark: m && m.textContent,
    markLeft: m && m.style.left, ukazatel: u && u.style.left }); })()""") or '{}')
print('nad proužkem:', ceny)
if ceny.get('pocet') != 1:
    chyby.append(f"nad proužkem má stát jediná cena, je jich {ceny.get('pocet')}")
if ceny.get('mark') != '0.30580':
    chyby.append('nad proužkem chybí mark cena')
# Mark cena musí jezdit se svým ukazatelem, jinak by ukazovala jinam než čára.
if ceny.get('markLeft') != ceny.get('ukazatel'):
    chyby.append(f"mark cena {ceny.get('markLeft')} nesedí na ukazatel {ceny.get('ukazatel')}")

# ---- vstup patří pod proužek, mezi SL a TP ----
legenda = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.ladder-legend span')]
  .map((e) => [e.className, e.textContent]))""") or '[]')
print('legenda pod proužkem:', legenda)
if len(legenda) != 3 or legenda[1][0] != 'cena-vstup':
    chyby.append(f'vstup nestojí mezi SL a TP: {legenda}')
elif '0.30135' not in legenda[1][1]:
    chyby.append(f'v legendě chybí cena vstupu: {legenda[1][1]}')

# ---- likvidace v patičce u fundingu ----
paticka = ev("(document.querySelector('.pos-funding .liq') || {}).textContent || ''")
print('likvidace v patičce:', paticka or '(chybí)')
if 'Liquidation' not in paticka or '0.07233' not in paticka:
    chyby.append('likvidace není v patičce na jednom řádku s popiskem')
if 'To liquidation' in ev("document.querySelector('.position').textContent"):
    chyby.append('vzdálenost k likvidaci se má už neukazovat')

# ---- druhý řádek pod proužkem: kolik to dělá v penězích ----
castky = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.ladder-castky span')]
  .map((e) => e.textContent))""") or '[]')
print('částky k SL a TP:', [c.replace('−', '-') for c in castky])
# Bere se **nejbližší** úroveň na každé straně, stejně jako u procent
# o řádek výš: SL 0.295 = ztráta, částečný TP 0.340 = zisk.
if len(castky) != 2:
    chyby.append(f'pod proužkem mají být dvě částky, jsou {len(castky)}')
elif not (castky[0].startswith('−') and 'USDT' in castky[0]
          and castky[1].startswith('+') and 'USDT' in castky[1]):
    chyby.append(f'částky k SL a TP nesedí: {castky}')

# ---- funding: součet za celou dobu držení ----
funding = ev("""(() => { const f = document.querySelector('.pos-funding');
  return f ? f.textContent : ''; })()""")
print('funding na kartě:', funding or '(chybí)')
# Pozice je otevřená tři dny, tedy devět stržení po 0,062 USDT.
if 'paid so far 0.56 USDT' not in (funding or ''):
    chyby.append('součet fundingu za celou dobu držení nesedí')

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
# ⚠ Schválně **jiné barvy než svíčky** (#16c784 / #ea3943) — značka
# v barvě svíčky, na které leží, není vidět.
if zelene != {'#7dffb8'} or cervene != {'#ff9f43'}:
    chyby.append('nákupy mají mít světlou zelenou a prodeje oranžovou')
if zelene & {'#16c784'} or cervene & {'#ea3943'}:
    chyby.append('značky mají barvu svíček, ve kterých splynou')

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

# ---- druhý běh: pozice bez známého času otevření ----
# Pak se dá sečíst jen posledních sedm dní a popisek to musí přiznat.
print()
print('=== funding u pozice bez createdTime ===')
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source="""
(() => {
  const puvodni = window.fetch;
  window.fetch = function (vstup) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/position/list')) {
      return puvodni(vstup).then(async (r) => {
        const d = await r.json();
        d.result.list.forEach((x) => { delete x.createdTime; });
        return new Response(JSON.stringify(d),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    }
    return puvodni(vstup);
  };
})();
""")
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(6)
kratky = ev("""(() => { const f = document.querySelector('.pos-funding');
  return f ? f.textContent : ''; })()""")
print('funding na kartě:', kratky or '(chybí)')
if 'paid' not in (kratky or ''):
    chyby.append('součet fundingu zmizel, když není známý čas otevření pozice')
elif 'so far' in (kratky or ''):
    chyby.append('popisek tvrdí „celkem", přestože se počítalo jen posledních pár dní')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: ZNAČENÍ V GRAFU I V PROUŽKU SEDÍ')
