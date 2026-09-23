# -*- coding: utf-8 -*-
"""
Checkpointy 7 a 8 — data o účtu a pohodlí.

Checkpoint 7:
  * přehled účtu (equity, volné, využitý margin) z wallet-balance,
  * ⚠ klíč bez oprávnění Wallet nesmí shodit pozice — jen se ukáže vysvětlení,
  * funding na kartě pozice (sazba, směr platby, náklad za den),
  * otevřené příkazy jako samostatný seznam.

Checkpoint 8:
  * řazení pozic (velikost / PnL / do likvidace) a otočení směru,
  * filtr long/short,
  * karta zčervená podle nastaveného prahu likvidace,
  * upozornění při protnutí SL/TP mark cenou,
  * volume profile jako vlastní indikátor.
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

# Druhá pozice, ať je co řadit a filtrovat: short blízko likvidace.
mock += """
localStorage.removeItem('perpdesk.posSort');
localStorage.removeItem('perpdesk.posFilter');
localStorage.removeItem('perpdesk.liqThreshold');
// ⚠ Zapnuté indikátory přežívají v localStorage mezi běhy. Bez vyčištění
// by druhý běh testu profil naopak vypnul a hlásil chybu, která není.
localStorage.removeItem('perpdesk.indicators');
window.__vibrace = 0;
navigator.vibrate = () => { window.__vibrace += 1; return true; };
(() => {
  const puvodni = window.fetch;
  window.fetch = function (vstup) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.includes('/v5/position/list')) {
      return Promise.resolve(new Response(JSON.stringify({retCode:0, result:{list:[
        {symbol:'JUPUSDT', side:'Buy', size:'2547', avgPrice:'0.30135',
         markPrice:'0.30580', unrealisedPnl:'11.34', liqPrice:'0.07233',
         leverage:'10', positionValue:'778.87', stopLoss:'0.295',
         takeProfit:'0.365', positionIdx:0},
        {symbol:'ETHUSDT', side:'Sell', size:'0.5', avgPrice:'2500',
         markPrice:'2560', unrealisedPnl:'-30.00', liqPrice:'2680',
         leverage:'20', positionValue:'1280', stopLoss:'', takeProfit:'',
         positionIdx:0},
      ]}}), {status:200, headers:{'Content-Type':'application/json'}}));
    }
    return puvodni(vstup);
  };
})();
"""

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Network.enable')
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        return 'VYJIMKA: ' + str(r['exceptionDetails'].get('exception', {}).get('description'))[:200]
    return r.get('result', {}).get('value')


def poradi():
    return json.loads(ev("""JSON.stringify(
      [...document.querySelectorAll('.position .pos-symbol')].map((e) => e.textContent))"""))


chyby = []

# ---- checkpoint 7: přehled účtu ----
print('=== checkpoint 7 ===')
equity = ev("document.getElementById('accEquity').textContent")
volne = ev("document.getElementById('accAvailable').textContent")
margin = ev("document.getElementById('accMargin').textContent")
skryty = ev("document.getElementById('accountSummary').hidden")
print('přehled účtu:', equity, '/', volne, '/', margin, ' (skrytý:', skryty, ')')
if skryty or '1,250.50' not in (equity or '') or '9.6' not in (margin or ''):
    chyby.append('přehled účtu se nezobrazil správně')

# ---- funding na kartě ----
def funding_karty(symbol):
    return ev("""(() => {
      const karta = [...document.querySelectorAll('.position')]
        .find((k) => k.querySelector('.pos-symbol').textContent === '%s');
      const f = karta && karta.querySelector('.pos-funding');
      return f ? f.textContent : ''; })()""" % symbol)


fundingLong = funding_karty('JUPUSDT')
fundingShort = funding_karty('ETHUSDT')
print('funding u longu (JUP): ', fundingLong or '(chybí)')
print('funding u shortu (ETH):', fundingShort or '(chybí)')
if 'Funding' not in (fundingLong or '') or 'USDT/day' not in (fundingLong or ''):
    chyby.append('funding na kartě chybí')
# ⚠ Musí být vidět částka za jedno stržení i za den. Samotná denní částka
# působila, jako by se funding platil jednou za 24 h — platí se po 8 h.
if 'USDT/8 h' not in (fundingLong or ''):
    chyby.append('u fundingu chybí částka za jedno stržení (8 h)')
# Kladná sazba: long platí shortovi. Směr musí být na kartě vidět, ze
# samotného „+0,01 %" ho nikdo nepozná.
if 'you pay' not in (fundingLong or ''):
    chyby.append('u longu s kladnou sazbou má stát „you pay"')
if 'you receive' not in (fundingShort or ''):
    chyby.append('u shortu s kladnou sazbou má stát „you receive"')

# ---- příkazy: v kartě proužek, v seznamu jen páry bez pozice ----
# Mock vrací dva příkazy na JUPUSDT, kde pozice je — ty patří do proužku
# v kartě, ne do seznamu pod ním.
prikazu = ev("document.querySelectorAll('.order-row').length")
print('příkazů v seznamu „bez pozice":', prikazu, '(má být 0 — oba jsou na páru s pozicí)')
if prikazu != 0:
    chyby.append(f'seznam má ukazovat jen příkazy bez pozice, je jich {prikazu}')

znacky = json.loads(ev("""(() => {
  const karta = [...document.querySelectorAll('.position')]
    .find((k) => k.querySelector('.pos-symbol').textContent === 'JUPUSDT');
  const t = karta && karta.querySelectorAll('.ladder-track .tick');
  return JSON.stringify(t ? [...t].map((e) => e.className) : []); })()""") or '[]')
print('značky na proužku JUP:', znacky)
# vstup + SL celé pozice + TP celé pozice + podmíněný TP z příkazu
if 'tick entry' not in znacky:
    chyby.append('na proužku chybí vstup')
if not any(z.startswith('tick sl') for z in znacky):
    chyby.append('na proužku chybí stop loss')
if not any(z.startswith('tick tp') for z in znacky):
    chyby.append('na proužku chybí take profit')

# Ukazatel ceny musí být vpravo od vstupu — pozice je v zisku.
nyni = ev("""(() => {
  const karta = [...document.querySelectorAll('.position')]
    .find((k) => k.querySelector('.pos-symbol').textContent === 'JUPUSDT');
  const e = karta && karta.querySelector('.ladder-now');
  return e ? parseFloat(e.style.left) : null; })()""")
print('ukazatel ceny na proužku:', nyni, '% (u ziskové pozice > 50)')
if not nyni or nyni <= 50:
    chyby.append(f'ukazatel ceny má být vpravo od vstupu, je na {nyni} %')

# ---- checkpoint 8: řazení ----
print()
print('=== checkpoint 8 ===')
vychozi = poradi()
print('výchozí pořadí (velikost):', vychozi)
if vychozi != ['ETHUSDT', 'JUPUSDT']:
    chyby.append(f'výchozí řazení podle velikosti nesedí: {vychozi}')

ev("""[...document.querySelectorAll('#sortGroup .list-btn')]
  .find((b) => b.textContent.startsWith('PnL')).click()""")
time.sleep(0.4)
podlePnl = poradi()
print('podle PnL sestupně:       ', podlePnl)
if podlePnl != ['JUPUSDT', 'ETHUSDT']:
    chyby.append(f'řazení podle PnL nesedí: {podlePnl}')

# druhé klepnutí otočí směr
ev("""[...document.querySelectorAll('#sortGroup .list-btn')]
  .find((b) => b.textContent.startsWith('PnL')).click()""")
time.sleep(0.4)
opacne = poradi()
print('podle PnL vzestupně:      ', opacne)
if opacne != ['ETHUSDT', 'JUPUSDT']:
    chyby.append(f'druhé klepnutí neotočilo směr řazení: {opacne}')

ev("""[...document.querySelectorAll('#sortGroup .list-btn')]
  .find((b) => b.textContent.startsWith('To liquidation')).click()""")
time.sleep(0.4)
podleLikvidace = poradi()
print('podle blízkosti likvidace:', podleLikvidace)
# ETH má 4,7 % do likvidace, JUP 76 % — ETH musí být první.
if podleLikvidace[0] != 'ETHUSDT':
    chyby.append(f'podle likvidace má být první ETHUSDT: {podleLikvidace}')

# ---- filtr ----
ev("""[...document.querySelectorAll('#filterGroup .list-btn')]
  .find((b) => b.textContent === 'Short').click()""")
time.sleep(0.4)
jenShort = poradi()
print('filtr Short:              ', jenShort)
if jenShort != ['ETHUSDT']:
    chyby.append(f'filtr short nesedí: {jenShort}')

ev("""[...document.querySelectorAll('#filterGroup .list-btn')]
  .find((b) => b.textContent === 'All').click()""")
time.sleep(0.4)

# ---- varování před likvidací ----
varovani = ev("document.querySelectorAll('.position.blizko-likvidace').length")
print('karet s varováním (práh 10 %):', varovani, '(má být 1 — ETH)')
if varovani != 1:
    chyby.append(f'varování před likvidací: čekala se 1 karta, je {varovani}')

# práh na 2 % → ETH (4,7 %) už varovat nemá
ev("""(() => { const i = document.getElementById('liqThreshold');
  i.value = '2'; i.dispatchEvent(new Event('change', { bubbles: true })); })()""")
time.sleep(0.4)
poZmene = ev("document.querySelectorAll('.position.blizko-likvidace').length")
print('po snížení prahu na 2 %:      ', poZmene, '(má být 0)')
if poZmene != 0:
    chyby.append('změna prahu likvidace se neprojevila')

# ---- volume profile ----
ev("document.querySelector('.position').click()")
time.sleep(3)
ev("""(() => { const b = [...document.querySelectorAll('#indicatorList .sheet-item')]
  .find((x) => x.dataset.indicator === 'VPROFILE'); b && b.click(); })()""")
time.sleep(1.5)
profil = ev("window.__graf.getIndicators({ name: 'VPROFILE' }).length")
print()
print('volume profile v grafu:', profil, '(má být 1)')
if profil != 1:
    chyby.append('volume profile se nepřidal do grafu')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
print('chyby v konzoli:', konzole or '(žádné)')
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: ÚČET I POHODLÍ FUNGUJÍ')
