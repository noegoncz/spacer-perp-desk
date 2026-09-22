# -*- coding: utf-8 -*-
"""
Adresy Bybitu musí opravdu fungovat. Jde proti **skutečné burze**.

Podstrčená data takovou chybu z principu neodhalí: mock odpoví na cokoli,
takže se špatná adresa tváří v pořádku. Veřejný stream měl kvůli chybějícímu
`public` v cestě rozbitou adresu a nikdy se nepřipojil — živé svíčky se
nehýbaly a nikdo si toho dlouho nevšiml, protože ceny dotahoval REST.

Klíče nejsou potřeba, všechno tady je veřejné. Privátní stream se jen otevře,
přihlášení se nezkouší.

    python tools/test-spojeni-burza.py
"""
import os, re, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
zdroj = open(os.path.join(KOREN, 'js', 'bybit.js'), encoding='utf-8').read()


def konstanta(jmeno):
    m = re.search(r"const %s = '([^']+)'" % jmeno, zdroj)
    assert m, 'konstanta %s v js/bybit.js nenalezena' % jmeno
    return m.group(1)


REST = konstanta('REST_BASE')
VEREJNY = konstanta('WS_PUBLIC_LINEAR')
PRIVATNI = konstanta('WS_PRIVATE')
PAR = 'BTCUSDT'   # vždy se obchoduje, takže ticky chodí spolehlivě

print('adresy z js/bybit.js:')
print('  REST:     ', REST)
print('  veřejný:  ', VEREJNY)
print('  privátní: ', PRIVATNI)
print()

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
# Stránka musí mít stejný původ jako aplikace, ať platí i CORS.
p.prikaz('Page.navigate', url='https://noegoncz.github.io/spacer-perp-desk/index.html')
time.sleep(4)

vysledek = p.prikaz('Runtime.evaluate', awaitPromise=True, returnByValue=True, expression="""
(async () => {
  const out = {};

  const odpoved = await fetch(%(rest)s + '/v5/market/time', { cache: 'no-store' })
    .then((r) => r.json()).catch((e) => ({ chyba: String(e) }));
  out.rest = { ok: odpoved && odpoved.retCode === 0, retCode: odpoved && odpoved.retCode };

  const stream = (url, odbery, cekat) => new Promise((hotovo) => {
    const v = { otevreno: false, temata: {}, zavreno: null, chyba: null };
    let ws;
    try { ws = new WebSocket(url); } catch (e) { v.chyba = e.message; return hotovo(v); }
    const konec = setTimeout(() => { try { ws.close(); } catch (e) {} hotovo(v); }, cekat);
    ws.onopen = () => {
      v.otevreno = true;
      if (odbery.length) ws.send(JSON.stringify({ op: 'subscribe', args: odbery }));
      else { clearTimeout(konec); try { ws.close(); } catch (e) {} hotovo(v); }
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (typeof m.topic === 'string' && m.data) {
        v.temata[m.topic] = (v.temata[m.topic] || 0) + 1;
        if (!v.vzorek && m.topic.startsWith('kline.')) v.vzorek = m.data[0];
      }
    };
    ws.onerror = () => { v.chyba = 'onerror'; };
    ws.onclose = (e) => { v.zavreno = e.code; clearTimeout(konec); hotovo(v); };
  });

  out.verejny = await stream(%(verejny)s, ['kline.240.%(par)s', 'tickers.%(par)s'], 12000);
  out.privatni = await stream(%(privatni)s, [], 8000);
  return JSON.stringify(out);
})()""" % {'rest': json.dumps(REST), 'verejny': json.dumps(VEREJNY),
           'privatni': json.dumps(PRIVATNI), 'par': PAR})

data = vysledek.get('result', {}).get('value')
if not data:
    print('vyhodnocení selhalo:', vysledek.get('exceptionDetails'))
    sys.exit(1)
v = json.loads(data)

print('REST /v5/market/time:   ', 'OK' if v['rest']['ok'] else 'CHYBA retCode=%s' % v['rest']['retCode'])

ver = v['verejny']
svicek = ver['temata'].get('kline.240.%s' % PAR, 0)
tiku = ver['temata'].get('tickers.%s' % PAR, 0)
print('veřejný stream otevřen: ', ver['otevreno'],
      '' if ver['otevreno'] else '  (zavřeno kódem %s, %s)' % (ver['zavreno'], ver['chyba']))
print('  zpráv se svíčkami:    ', svicek)
print('  zpráv s tickerem:     ', tiku)
if ver.get('vzorek'):
    s = ver['vzorek']
    chybi = [k for k in ['start', 'open', 'high', 'low', 'close', 'volume', 'confirm'] if k not in s]
    print('  pole, která čteme:    ', 'všechna sedí' if not chybi else 'CHYBÍ ' + ', '.join(chybi))
    print('  ukázka:                start=%s close=%s confirm=%s' % (s['start'], s['close'], s['confirm']))

print('privátní stream otevřen:', v['privatni']['otevreno'],
      '' if v['privatni']['otevreno'] else '  (zavřeno kódem %s)' % v['privatni']['zavreno'])

print()
ok = (v['rest']['ok'] and ver['otevreno'] and svicek > 0 and tiku > 0
      and v['privatni']['otevreno'] and ver.get('vzorek'))
print('VÝSLEDEK:', 'BURZA ODPOVÍDÁ NA VŠECH ADRESÁCH' if ok else '!!! NĚKTERÁ ADRESA NEFUNGUJE')
