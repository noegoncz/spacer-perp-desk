# -*- coding: utf-8 -*-
"""
Graf se dá otevřít opakovaně a svíčky pokaždé zůstanou (v0.17.7).

Uživatel otevřel graf, vrátil se na přehled, otevřel ho znovu — a v grafu
zbylo jen RSI a prázdná plocha, svíčky zmizely a už se nevrátily.

Příčina: okraj osy RSI byl zadaný v pixelech (v0.17.5). Knihovna pixely
přepočítává dělením výškou panelu, a když se graf při zavření schová, je
výška 0 — dělení nulou dalo nekonečno, rozpadlo se rozvržení a panel se
svíčkami zůstal natrvalo s nulovou výškou. Stávalo se to jen s RSI a pevnou
stupnicí 0–100 (výchozí), proto to ostatní testy nechytily: otevíraly graf
jednou.

Test otevře a zavře graf pětkrát při různých výškách panelu RSI, zkontroluje
výšku panelu se svíčkami a že RSI má pořád malé okraje nad 100 a pod 0.

Spuštění: python tools/test-znovuotevreni-grafu.py http://localhost:8080/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
zaklad = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

chyby = []
for vyska in (10, 25):
    mock = zaklad + """
localStorage.setItem('perpdesk.indicators', JSON.stringify(['VOL', 'RSI']));
localStorage.setItem('perpdesk.ind.RSI', JSON.stringify({ vyskaPanelu: %d }));
""" % vyska
    p = Prohlizec()
    for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
        p.prikaz(c)
    p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
    p.prikaz('Emulation.setDeviceMetricsOverride', width=673, height=841,
             deviceScaleFactor=1, mobile=True)
    p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(7)

    def ev(v):
        r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
        if 'exceptionDetails' in r:
            return None
        return r.get('result', {}).get('value')

    STAV = """(() => { const g = window.__graf;
      const rsi = g.getIndicators({ name: 'RSI' })[0];
      const y = (v) => { const b = g.convertToPixel({ value: v }, { paneId: rsi.paneId });
        return (Array.isArray(b) ? b[0] : b).y; };
      const hr = g.getSize(rsi.paneId, 'main')?.height || 0;
      return JSON.stringify({ svicky: Math.round(g.getSize('candle_pane', 'main')?.height || 0),
        rsi: Math.round(hr), nad100: Math.round(y(100)), pod0: Math.round(hr - y(0)) }); })()"""

    vysky = []
    for i in range(1, 6):
        ev("document.querySelector('.position').click()")
        time.sleep(2.5)
        s = json.loads(ev(STAV) or '{}')
        vysky.append(s.get('svicky', 0))
        print(f'RSI {vyska} %, {i}. otevření:', s)
        if s.get('svicky', 0) < 100:
            chyby.append(f'RSI {vyska} %: při {i}. otevření má panel se svíčkami výšku {s.get("svicky")} px')
        # Rozbitá osa vrací místo pixelů NaN (v JSON null) — i to je chyba.
        nad, pod = s.get('nad100'), s.get('pod0')
        if nad is None or pod is None or not (2 <= nad <= 12 and 2 <= pod <= 12):
            chyby.append(f'RSI {vyska} %: okraje nad 100 / pod 0 nesedí ({s.get("nad100")} / {s.get("pod0")} px)')
        ev("history.back()")
        time.sleep(1.2)
    if len(set(vysky)) != 1:
        chyby.append(f'RSI {vyska} %: výška svíček se mezi otevřeními mění: {vysky}')
    konzole = ev('(window.__chyby||[]).join(" | ")') or ''
    if konzole:
        chyby.append(f'chyby v konzoli: {konzole}')
    # Skripty `addScriptToEvaluateOnNewDocument` se ve stejné kartě střádají;
    # druhý běh přidá svůj později, takže jeho výška panelu přebije první.
    p.prikaz('Page.navigate', url='about:blank')

print()
if chyby:
    print('VÝSLEDEK: !!! NĚCO NESEDÍ')
    for c in chyby:
        print('  -', c)
else:
    print('VÝSLEDEK: GRAF SE OTEVÍRÁ OPAKOVANĚ I SE SVÍČKAMI')
