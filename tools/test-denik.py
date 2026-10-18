# -*- coding: utf-8 -*-
"""
Deník obchodů (v0.61.0): poznámka při vstupu, poznámky během obchodu,
zhodnocení po zavření, souhrn na kartách, štítek „Review" a jeho vypnutí.

  1) Karta pozice má „Why?"; klepnutí otevře okno (graf se neotevře).
     Setup, confluence, jistota, text → uložit → na kartě souhrn.
     Automaticky uložený vstup a SL (riziko 1R).
  2) Poznámka během obchodu se přidá a zůstane po přenačtení.
  3) Historie: uzavřený obchod má štítek „Review"; zhodnocení (důvod,
     plán, hodnocení, lekce) → souhrn s „Plan ✓" a ★, štítek zmizí;
     výsledek v okně v R (z rizika poznámky obchodu, když ji má).
  4) Nastavení: vypnutí štítku „Review" ho skryje.
  5) Vlastní setup přidaný v okně se uloží do seznamu.

Spuštění: python tools/test-denik.py http://localhost:8080/index.html
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


okno = lambda: ev("(() => { const s = document.querySelector('.denik-sheet'); return !!s && !s.hidden; })()")
denik = lambda: json.loads(ev("localStorage.getItem('perpdesk.denik') || '{}'") or '{}')
klik_chip = lambda text: ev(f"[...document.querySelectorAll('.denik-sheet .chip')].find((b) => b.textContent.trim().startsWith({json.dumps(text)}))?.click()")

print('1) poznámka při vstupu')
time.sleep(4)  # čas otevření pozice z plnění
souhrn = ev("document.querySelector('.position .denik-souhrn')?.textContent || ''")
over('Why?' in (souhrn or ''), f'karta pozice nabízí „Why?" ({souhrn})')
ev("document.querySelector('.position .denik-souhrn').click()")
time.sleep(1)
over(okno(), 'okno poznámky se otevřelo')
over(not ev("!document.getElementById('viewChart').hidden"), 'klepnutí na souhrn neotevřelo graf')
klik_chip('Retest')
klik_chip('Support / resistance')
klik_chip('HTF trend')
ev("[...document.querySelectorAll('.denik-cislo')][3].click()")
ev("document.querySelector('.denik-sheet textarea').value = 'Retest 4h range high'")
auto_text = ev("document.querySelector('.denik-auto')?.textContent || ''")
print('   automaticky:', auto_text)
over('Entry' in auto_text, 'okno ukazuje automaticky uložený vstup')
ev("document.querySelector('.denik-sheet .denik-ulozit').click()")
time.sleep(1)
over(not okno(), 'po uložení se okno zavřelo')
time.sleep(0.6)
souhrn = ev("document.querySelector('.position .denik-souhrn')?.textContent || ''")
print('   souhrn:', souhrn)
over('Retest' in souhrn and '2 confluence' in souhrn and '4/5' in souhrn, 'na kartě souhrn: setup, 2 confluence, jistota 4/5')
d = denik()
pozn = list(d.get('poznamky', {}).items())
over(len(pozn) == 1 and pozn[0][1].get('vstup', {}).get('setup') == 'Retest', 'poznámka je v úložišti')
klic = pozn[0][0] if pozn else ''
print('   klíč:', klic)
over(':?:' not in klic, 'klíč obsahuje čas otevření pozice (ne náhradní)')

print('2) poznámka během obchodu')
ev("document.querySelector('.position .denik-souhrn').click()")
time.sleep(1)
ev("(() => { const i = document.querySelector('.denik-sheet .denik-novy:not([hidden]) .denik-pole[maxlength=\"300\"]'); i.value = 'SL na break-even'; i.nextElementSibling.click(); })()")
time.sleep(0.5)
over('SL na break-even' in (ev("document.querySelector('.denik-behem')?.textContent || ''") or ''), 'poznámka během obchodu se ukázala v okně')
ev("document.querySelector('.denik-sheet .icon-btn').click()")
p.prikaz('Page.reload')
time.sleep(9)
d = denik()
behem = [b for v in d.get('poznamky', {}).values() for b in v.get('behem', [])]
over(any(b['text'] == 'SL na break-even' for b in behem), 'poznámka během obchodu přežila přenačtení')
over('Retest' in (ev("document.querySelector('.position .denik-souhrn')?.textContent || ''") or ''), 'souhrn na kartě i po přenačtení')

print('3) zhodnocení v Historii')
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(4)
karty = json.loads(ev("JSON.stringify([...document.querySelectorAll('.trade')].map((k) => ({ otevreny: k.classList.contains('otevreny'), d: k.querySelector('.denik-souhrn')?.textContent || '' })))") or '[]')
print('   karty:', karty)
zavrene = [k for k in karty if not k['otevreny']]
over(zavrene and all('Review' in k['d'] for k in zavrene), 'uzavřené obchody mají štítek „Review"')
otevrene = [k for k in karty if k['otevreny']]
over(not otevrene or 'Retest' in otevrene[0]['d'], 'otevřený obchod v Historii nese poznámku pozice')
ev("[...document.querySelectorAll('.trade')].find((k) => !k.classList.contains('otevreny')).querySelector('.denik-souhrn').click()")
time.sleep(1)
over(okno() and 'How did it go' in (ev("document.querySelector('.denik-sheet').textContent") or ''), 'otevřelo se zhodnocení')
klik_chip('Take-profit')
ev("[...document.querySelectorAll('.denik-sheet .chip')].find((b) => b.textContent.trim() === 'Yes').click()")
ev("[...document.querySelectorAll('.denik-cislo')][4].click()")
ev("document.querySelector('.denik-sheet textarea').value = 'Trpělivost se vyplatila'")
ev("document.querySelector('.denik-sheet .denik-ulozit').click()")
time.sleep(1)
karta = ev("[...document.querySelectorAll('.trade')].find((k) => !k.classList.contains('otevreny')).querySelector('.denik-souhrn').textContent")
print('   po zhodnocení:', karta)
over('Plan ✓' in (karta or '') and '★ 5' in (karta or '') and 'Review' not in (karta or ''), 'souhrn „Plan ✓ ★ 5", štítek Review zmizel')

print('4) vypnutí štítku Review')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.6)
ev("document.getElementById('journalReviewBtn').click()")
over(ev("localStorage.getItem('perpdesk.denik')").find('"stitekReview":false') >= 0, 'volba se uložila')
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.8)
ev("document.querySelector('[data-tab=history]').click()")
time.sleep(1.5)
over(not any('Review' in (k or '') for k in json.loads(ev("JSON.stringify([...document.querySelectorAll('.trade .denik-souhrn')].map((x) => x.textContent))") or '[]')), 'štítek Review není vidět')

print('5) vlastní setup')
ev("document.querySelector('[data-tab=positions]').click()")
time.sleep(1)
ev("document.querySelector('.position .denik-souhrn').click()")
time.sleep(0.8)
ev("[...document.querySelectorAll('.denik-sheet .chip.pridat')][0].click()")
ev("(() => { const i = document.querySelector('.denik-sheet .denik-novy:not([hidden]) .denik-pole'); i.value = 'Liquidity sweep'; i.nextElementSibling.click(); })()")
time.sleep(0.6)
over('Liquidity sweep' in denik().get('setupy', []), 'vlastní setup je v seznamu')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole[:200]})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
