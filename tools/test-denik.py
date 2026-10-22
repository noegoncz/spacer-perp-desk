# -*- coding: utf-8 -*-
"""
Deník obchodů — okno Plan / Review (v0.67.0, dřív „Why?" a zvlášť
zhodnocení). Skutečné dotyky na dlaždice.

  1) Karta pozice: tlačítko „＋ Plan"; okno s přepínačem Plan | Review
     (Review zašedlé — obchod běží). Dlaždice: setupy (+ No setup, + Own),
     signály; Confluence = počet signálů. ⓘ i podržení dlaždice ukáže
     detail s kresbou. Uložit → „✓ Plan" a „Retest · 2 signals".
  2) Poznámka během obchodu přežije přenačtení; nejpoužívanější setup
     je při dalším otevření první.
  3) Journal: uzavřený obchod má Plan a Review (čeká); Review otevře
     okno na Review, přepnutí na Plan a zpět; po uložení „✓ Review".
     Plán doplněný po zavření dostane štítek „edited after close".
  4) Minimum signálů v nastavení → „Below your rule".
  5) Vlastní signál (skupina, nápověda), odebrání a vrácení výchozího.
  6) Rozevřený Fold: 6 dlaždic v řadě.
  7) Převod starého deníku (verze 1, přeložené názvy, setup Divergence).

Spuštění: python tools/test-denik.py http://localhost:8075/index.html
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
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=900, deviceScaleFactor=1, mobile=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(7)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def dotyk(x, y, drzet=0.05):
    bod = [{'x': x, 'y': y, 'radiusX': 10, 'radiusY': 10, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(drzet)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.45)


def klepni(sel, drzet=0.05):
    """Skutečný dotyk na prvek (posune ho do obrazu)."""
    b = ev(f"""(() => {{ const e = {sel}; if (!e) return null; e.scrollIntoView({{ block: 'center' }});
      const r = e.getBoundingClientRect(); return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }}; }})()""")
    if b:
        time.sleep(0.15)
        dotyk(b['x'], b['y'], drzet)
    return bool(b)


tile = lambda typ, id_: f"document.querySelector('.denik-{typ} .denik-tile[data-id=\"{id_}\"]')"
okno = lambda: ev("(() => { const s = document.querySelector('.denik-sheet'); return !!s && !s.hidden; })()")
denik = lambda: json.loads(ev("localStorage.getItem('perpdesk.denik') || '{}'") or '{}')
radek_pozice = lambda: ev("document.querySelector('.position .denik-radek')?.textContent || ''") or ''
uloz = lambda: klepni("document.querySelector('.denik-sheet .denik-ulozit')")

print('1) Plan u běžící pozice')
time.sleep(4)  # čas otevření pozice z plnění
over('Plan' in radek_pozice() and '＋' in radek_pozice(), f'karta pozice nabízí „＋ Plan" ({radek_pozice()})')
klepni("document.querySelector('.position .denik-btn-plan')")
time.sleep(0.6)
over(okno(), 'okno se otevřelo')
over(not ev("!document.getElementById('viewChart').hidden"), 'klepnutí na Plan neotevřelo graf')
zal = json.loads(ev("JSON.stringify([...document.querySelectorAll('.denik-zalozka')].map((b) => [b.textContent, b.classList.contains('on'), b.disabled]))") or '[]')
over(len(zal) == 2 and zal[0][1] and zal[1][2], f'přepínač Plan | Review, Review zašedlé u běžícího obchodu ({zal})')
pocty = ev("[document.querySelectorAll('.denik-setupy .denik-tile[data-id]').length, document.querySelectorAll('.denik-signaly .denik-tile[data-id]').length, !!document.querySelector('.denik-setupy .denik-nic.on'), document.querySelectorAll('.denik-vlastni').length]")
over(pocty == [6, 11, True, 2], f'6 setupů, 11 signálů, vybrané „No setup", dvakrát „+ Own" ({pocty})')
over(ev("document.querySelectorAll('.denik-setupy .denik-tile svg').length") == 6, 'setupy mají kresby')
klepni(tile('setupy', 'retest'))
klepni(tile('setupy', 'breakout'))
over(ev(f"{tile('setupy', 'breakout')}.classList.contains('on') && !{tile('setupy', 'retest')}.classList.contains('on')"), 'setup je jen jeden (druhý vybraný nahradí první)')
klepni(tile('setupy', 'retest'))
klepni(tile('signaly', 'sr'))
klepni(tile('signaly', 'htf'))
conf = ev("document.querySelector('.denik-conf').textContent")
over(conf == 'Confluence 2', f'Confluence = počet signálů ({conf})')
klepni(f"{tile('signaly', 'fib')}.querySelector('.denik-tile-info')")
detail = ev("document.querySelector('.denik-vrstva')?.textContent || ''")
over('Fib level' in detail and '0.618' in detail and ev("!!document.querySelector('.denik-vrstva svg')"), f'ⓘ ukáže detail s kresbou ({detail[:60]}…)')
over(not ev(f"{tile('signaly', 'fib')}.classList.contains('on')"), 'ⓘ signál nevybere')
dotyk(200, 120)
over(not ev("!!document.querySelector('.denik-vrstva')"), 'klepnutí detail zavře')
klepni(tile('signaly', 'volume'), drzet=0.7)
over('Volume spike' in (ev("document.querySelector('.denik-vrstva')?.textContent || ''") or ''), 'podržení dlaždice ukáže detail')
over(not ev(f"{tile('signaly', 'volume')}.classList.contains('on')"), 'podržení signál nevybere')
dotyk(200, 120)
klepni("[...document.querySelectorAll('.denik-cislo')][3]")
ev("(() => { const a = document.querySelector('.denik-sheet textarea'); a.value = 'Retest 4h range high'; a.dispatchEvent(new Event('input')); })()")
over('Entry' in (ev("document.querySelector('.denik-auto')?.textContent || ''") or ''), 'okno ukazuje automaticky uložený vstup')
uloz()
time.sleep(0.8)
over(not okno(), 'po uložení se okno zavřelo')
r = radek_pozice()
print('   karta:', r)
over('✓ Plan' in r and 'Retest' in r and '2 signals' in r, 'na kartě „✓ Plan" a „Retest · 2 signals"')
d = denik()
pozn = list(d.get('poznamky', {}).items())
v = pozn[0][1].get('vstup', {}) if pozn else {}
over(len(pozn) == 1 and v.get('setup') == 'retest' and v.get('signaly') == ['sr', 'htf'] and v.get('jistota') == 4, f'v úložišti id: {v.get("setup")}, {v.get("signaly")}')
over(':?:' not in (pozn[0][0] if pozn else ''), 'klíč obsahuje čas otevření pozice')
over(not v.get('poZavreni'), 'plán běžícího obchodu není „po zavření"')

print('2) poznámka během obchodu, pořadí podle použití')
klepni("document.querySelector('.position .denik-btn-plan')")
time.sleep(0.6)
prvni = ev("document.querySelector('.denik-setupy .denik-tile[data-id]').dataset.id")
over(prvni == 'retest', f'nejpoužívanější setup je první ({prvni})')
over(ev("[...document.querySelectorAll('.denik-signaly .denik-tile[data-id]')].slice(0, 2).map((x) => x.dataset.id).join()") == 'sr,htf', 'použité signály jsou napřed')
ev("(() => { const i = document.querySelector('.denik-sheet .denik-pole[maxlength=\"300\"]'); i.value = 'SL na break-even'; i.nextElementSibling.click(); })()")
time.sleep(0.4)
over('SL na break-even' in (ev("document.querySelector('.denik-behem')?.textContent || ''") or ''), 'poznámka během obchodu se ukázala v okně')
ev("document.querySelector('.denik-sheet .icon-btn').click()")
p.prikaz('Page.reload')
time.sleep(9)
behem = [b for x in denik().get('poznamky', {}).values() for b in x.get('behem', [])]
over(any(b['text'] == 'SL na break-even' for b in behem), 'poznámka během obchodu přežila přenačtení')
over('Retest' in radek_pozice(), 'souhrn na kartě i po přenačtení')

print('3) Plan a Review v Journalu')
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(4)
karty = json.loads(ev("""JSON.stringify([...document.querySelectorAll('.trade')].map((k) => ({ otevreny: k.classList.contains('otevreny'),
  plan: k.querySelector('.denik-btn-plan')?.textContent || '', review: k.querySelector('.denik-btn-review')?.className || '' })))""") or '[]')
print('   karty:', karty)
zavrene = [k for k in karty if not k['otevreny']]
otevrene = [k for k in karty if k['otevreny']]
over(zavrene and all('ceka' in k['review'] for k in zavrene), 'uzavřené obchody: Review čeká na vyplnění')
over(not otevrene or ('zasedle' in otevrene[0]['review'] and '✓' in otevrene[0]['plan']), 'otevřený obchod: Review zašedlé, Plan ✓ z pozice')
zavreny = "[...document.querySelectorAll('.trade')].find((k) => !k.classList.contains('otevreny'))"
klepni(f"{zavreny}.querySelector('.denik-btn-review')")
time.sleep(0.6)
over(okno() and ev("document.querySelector('.denik-zalozka.on').dataset.c") == 'review', 'Review otevře okno na části Review')
over('How' not in (ev("document.querySelector('.denik-sheet').textContent") or '') and ev("!!document.querySelector('.denik-vysledek')"), 'v Review je výsledek obchodu')
ev("[...document.querySelectorAll('.denik-sheet .chip')].find((b) => b.textContent.trim() === 'Take-profit').click()")
ev("[...document.querySelectorAll('.denik-sheet .chip')].find((b) => b.textContent.trim() === 'Yes').click()")
ev("[...document.querySelectorAll('.denik-cislo')][4].click()")
klepni("document.querySelector('.denik-zalozka[data-c=plan]')")
over(ev("!!document.querySelector('.denik-setupy')"), 'přepnutí na Plan')
klepni(tile('setupy', 'range'))
klepni(tile('signaly', 'sr'))
klepni("document.querySelector('.denik-zalozka[data-c=review]')")
over(ev("[...document.querySelectorAll('.denik-sheet .chip.on')].map((b) => b.textContent).join()") == 'Take-profit,Yes', 'po přepnutí zpět zůstalo rozepsané Review')
uloz()
time.sleep(0.8)
karta = ev(f"{zavreny}.querySelector('.denik-radek').textContent") or ''
print('   po uložení:', karta)
over('✓ Review' in karta and '✓ Plan' in karta and '★ 5' in karta and 'Plan ✓' in karta, 'na kartě ✓ Plan, ✓ Review, „Plan ✓", ★ 5')
over('edited after close' in karta, 'plán doplněný po zavření má štítek „edited after close"')
over(not ev(f"{zavreny}.querySelector('.denik-btn-review').classList.contains('ceka')"), 'Review už nečeká')
klepni(f"{zavreny}.querySelector('.denik-btn-plan')")
time.sleep(0.5)
over('⚠' in (ev("document.querySelector('.denik-pozdeji')?.textContent || ''") or ''), 'v okně je upozornění na plán po zavření')
over('✓' in (ev("document.querySelector('.denik-zalozka[data-c=review]').textContent") or ''), 'záložka Review má fajfku')
ev("document.querySelector('.denik-sheet .icon-btn').click()")

print('4) minimum signálů')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.6)
ev("(() => { const s = document.getElementById('journalMinSignals'); s.value = '3'; s.dispatchEvent(new Event('change')); })()")
over(denik().get('nastaveni', {}).get('minSignalu') == 3, 'minimum 3 se uložilo')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
ev("document.querySelector('[data-tab=positions]').click()")
time.sleep(1)
klepni("document.querySelector('.position .denik-btn-plan')")
time.sleep(0.6)
pr = ev("(() => { const x = document.querySelector('.denik-pravidlo'); return x && !x.hidden ? x.textContent : ''; })()")
over('Below your rule (3' in (pr or ''), f'se 2 signály „Below your rule" ({pr})')
klepni(tile('signaly', 'fib'))
over(ev("document.querySelector('.denik-pravidlo').hidden"), 's 3 signály poznámka zmizí')

print('5) vlastní signál, odebrání a vrácení výchozího')
klepni("document.querySelector('.denik-signaly .denik-vlastni')")
time.sleep(0.4)
over(ev("!!document.querySelector('.denik-vrstva-formular')"), 'otevřelo se okno vlastního signálu')
ev("document.querySelector('.denik-vrstva input').value = 'VWAP'")
klepni("document.querySelector('.denik-vrstva .denik-skupina-btn[data-s=trend]')")
ev("document.querySelector('.denik-vrstva textarea').value = 'Price reclaims the session VWAP.'")
klepni("document.querySelector('.denik-vrstva .primary-btn')")
vlastni = [x for x in denik().get('signaly', []) if x.get('nazev') == 'VWAP']
over(vlastni and vlastni[0].get('skupina') == 'trend' and 'VWAP' in vlastni[0].get('napoveda', ''), f'vlastní signál v úložišti ({vlastni})')
vid = vlastni[0]['id'] if vlastni else ''
over(ev(f"{tile('signaly', vid)}?.classList.contains('on')"), 'nový signál je rovnou vybraný')
klepni(f"{tile('signaly', vid)}.querySelector('.denik-tile-info')")
over('session VWAP' in (ev("document.querySelector('.denik-vrstva')?.textContent || ''") or ''), 'detail vlastního signálu ukáže jeho větu')
dotyk(200, 120)
klepni("document.querySelector('.denik-signaly').parentElement.querySelector('.denik-upravit')")
klepni(f"{tile('signaly', 'news')}.querySelector('.denik-tile-info')")
over(not any(x.get('id') == 'news' for x in denik().get('signaly', [])), 'výchozí signál News odebraný')
over('News' in (ev("document.querySelector('.denik-signaly .denik-odebrane')?.textContent || ''") or ''), 'nabízí se k vrácení')
klepni("[...document.querySelectorAll('.denik-signaly .denik-odebrane button')].find((b) => b.textContent.includes('News'))")
over(any(x.get('id') == 'news' for x in denik().get('signaly', [])), 'vrácený')
ev("document.querySelector('.denik-sheet .icon-btn').click()")

print('6) rozevřený Fold')
p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841, deviceScaleFactor=1, mobile=True)
time.sleep(0.6)
klepni("document.querySelector('.position .denik-btn-plan')")
time.sleep(0.6)
sloupce = ev("getComputedStyle(document.querySelector('.denik-signaly')).gridTemplateColumns.split(' ').length")
over(sloupce == 6, f'6 dlaždic v řadě ({sloupce})')
pretece = ev("document.querySelector('.denik-sheet').scrollWidth > document.querySelector('.denik-sheet').clientWidth + 1")
over(not pretece, 'okno nepřetéká do strany')
ev("document.querySelector('.denik-sheet .icon-btn').click()")
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
time.sleep(0.6)
klepni("document.querySelector('.position .denik-btn-plan')")
time.sleep(0.6)
over(not ev("document.querySelector('.denik-sheet').scrollWidth > document.querySelector('.denik-sheet').clientWidth + 1"), 'na 344 px okno nepřetéká')
ev("document.querySelector('.denik-sheet .icon-btn').click()")

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')

print('7) převod starého deníku')
stary = {'verze': 1, 'nastaveni': {'stitekReview': True},
         'setupy': ['Breakout', 'Retest', 'Divergence', 'Moje vlajka'],
         'confluence': ['Support / resistance', 'Fibonacci', 'VWAP stará'],
         'poznamky': {'bybit:XUSDT:1': {'vstup': {'setup': 'Divergence', 'confluence': ['Fibonacci'], 'cas': 1}},
                      'bybit:XUSDT:2': {'vstup': {'setup': 'Moje vlajka', 'confluence': ['VWAP stará', 'Support / resistance'], 'cas': 2}}}}
ev(f"localStorage.setItem('perpdesk.denik', {json.dumps(json.dumps(stary))})")
p.prikaz('Page.reload')
time.sleep(8)
d = denik()
pz = d.get('poznamky', {})
v1 = pz.get('bybit:XUSDT:1', {}).get('vstup', {})
v2 = pz.get('bybit:XUSDT:2', {}).get('vstup', {})
print('   převedeno:', v1, v2)
over(d.get('verze') == 2, 'deník má verzi 2')
over(v1.get('setup') is None and sorted(v1.get('signaly', [])) == ['fib', 'rsiDiv'], 'setup Divergence → signál RSI divergence, Fibonacci → fib')
vlastni_setup = next((x for x in d.get('setupy', []) if x.get('nazev') == 'Moje vlajka'), None)
over(vlastni_setup and v2.get('setup') == vlastni_setup['id'], 'vlastní setup převedený na položku s id')
over('sr' in v2.get('signaly', []) and len(v2.get('signaly', [])) == 2, 'vlastní signál i S/R v poznámce')
ids = [x['id'] for x in d.get('setupy', [])]
over('range' not in ids and 'sweep' in ids and 'breakout' in ids, f'dřív smazaný výchozí zůstal pryč, nový přibyl ({ids})')

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
