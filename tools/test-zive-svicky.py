# -*- coding: utf-8 -*-
"""
Živá svíčka z WebSocketu musí hýbat grafem.

Jde celou cestou: podstrčená zpráva z burzy → bybit.js → app.js → chart.js →
knihovna. Právě na konci té cesty byla chyba — knihovna chce pole `timestamp`,
dostávala `time` a aktualizaci **tiše zahodila**. Nic nespadlo, jen se svíčka
nehýbala a vypadalo to, že živé svíčky neumíme.

Vlastní WebSocket si test definuje sám (přepisuje ten ze sdíleného mocku),
aby mohl určit, kdy se spojí a co přijde.
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

# Řízený WebSocket: sám se po chvíli „spojí", zapamatuje si odeslané odběry
# a umí do stránky poslat zprávu, jako by přišla z burzy.
mock += """
window.__ws = [];
window.WebSocket = function (url) {
  this.url = url;
  this.readyState = 0;
  this.odeslano = [];
  this.send = (d) => { this.odeslano.push(d); };
  this.close = () => { this.readyState = 3; };
  window.__ws.push(this);
  setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 60);
};
window.WebSocket.OPEN = 1;
window.__odbery = () => window.__ws.flatMap((s) => s.odeslano);
window.__zprava = (topic, data) => {
  let doruceno = 0;
  window.__ws.forEach((s) => {
    if (!s.onmessage) return;
    s.onmessage({ data: JSON.stringify({ topic, data }) });
    doruceno += 1;
  });
  return doruceno;
};
"""

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(4)


def ev(v):
    return p.prikaz('Runtime.evaluate', expression=v, returnByValue=True).get('result', {}).get('value')


odbery = ev('JSON.stringify(window.__odbery())')
print('odběry odeslané na burzu:')
for radek in json.loads(odbery or '[]'):
    print('   ', radek)
odebiraSvicky = 'kline.240.JUPUSDT' in (odbery or '')
print('odebírá svíčky pro otevřený graf:', odebiraSvicky)
print()

posledni = json.loads(ev("""(() => { const d = window.__graf.getDataList().slice(-1)[0];
  return JSON.stringify({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close }); })()"""))
print('poslední svíčka před zprávou: close =', posledni['c'])

novy_close = round(posledni['c'] + 0.05, 6)
doruceno = ev("""window.__zprava('kline.240.JUPUSDT', [{
  start: %d, open: %r, high: %r, low: %r, close: %r, volume: '1234', confirm: false }])"""
              % (posledni['t'], str(posledni['o']), str(round(posledni['h'] + 0.05, 6)),
                 str(posledni['l']), str(novy_close)))
print('zpráva doručena do', doruceno, 'spojení')
time.sleep(1.2)

po = ev("window.__graf.getDataList().slice(-1)[0].close")
pocet = ev("window.__graf.getDataList().length")
print('poslední svíčka po zprávě:  close =', po, '(očekáváno %s)' % novy_close)
print('počet svíček beze změny:    ', pocet, '(má být 300)')
print()

# nová svíčka na dalším čase musí seznam prodloužit
dalsi = posledni['t'] + 4 * 3600 * 1000
ev("""window.__zprava('kline.240.JUPUSDT', [{
  start: %d, open: %r, high: %r, low: %r, close: %r, volume: '10', confirm: false }])"""
   % (dalsi, str(novy_close), str(novy_close), str(novy_close), str(novy_close)))
time.sleep(1.2)
pocet2 = ev("window.__graf.getDataList().length")
print('po svíčce na novém čase:     ', pocet2, 'svíček (má být 301)')

chyby = ev('(window.__chyby||[]).join(" | ")') or ''
print('chyby v konzoli:', chyby or '(žádné)')
print()
ok = odebiraSvicky and abs((po or 0) - novy_close) < 1e-9 and pocet == 300 and pocet2 == 301 and not chyby
print('VÝSLEDEK:', 'ŽIVÉ SVÍČKY FUNGUJÍ' if ok else '!!! ŽIVÁ SVÍČKA SE NEPROJEVILA')
