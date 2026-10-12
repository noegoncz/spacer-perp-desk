# -*- coding: utf-8 -*-
"""
Nativní HTTP pro burzy bez CORS (v0.57.0).

V APK jdou dotazy CCXT u burz s `nativniHttp` (Gate, Bitget, MEXC) přes
plugin CapacitorHttp. Tady se plugin podstrčí (požadavek pošle obyčejným
fetch a zaznamená ho) a ověří se:
  * Gate (nativniHttp) jde přes plugin a data projdou celá (trhy, tickery,
    svíčky) — tedy převod odpovědi pluginu na `Response` funguje,
  * OKX (CORS má) přes plugin nejde,
  * mimo APK (isNativePlatform false) se plugin nepoužije vůbec,
  * MEXC se v prohlížeči nenabízí (`verejneDostupne`), v APK ano.
Skutečné MEXC bez CORS jde ověřit jen na telefonu.

Spuštění: python tools/test-nativni-http.py http://localhost:8075/index.html
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
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)

chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def ev_async(v):
    r = p.prikaz('Runtime.evaluate', expression=v, awaitPromise=True, returnByValue=True, timeout=120000)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:300])
        return None
    return r.get('result', {}).get('value')


vysledek = json.loads(ev_async(r"""(async () => {
  const out = {};
  const { vytvorBurzu, verejneDostupne } = await import('./js/burzy/index.js');
  out.prohlizec = verejneDostupne();
  // Podstrčený Capacitor: plugin pošle dotaz obyčejným fetch a zapíše ho.
  window.__nativni = [];
  window.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorHttp: { request: async (o) => {
    window.__nativni.push(o.url);
    const r = await fetch(o.url, { method: o.method, headers: o.headers, body: o.data });
    const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
    return { status: r.status, headers: h, data: await r.text(), url: o.url };
  } } } };
  out.apk = verejneDostupne();
  const gate = vytvorBurzu('gate', {});
  const tk = await gate.getTickers();
  const sv = await gate.getKlines('BTCUSDT', '240', 20);
  out.gate = { tickeru: tk.length, svicek: sv.length, posledni: sv.at(-1)?.close };
  out.gateNativne = window.__nativni.filter((u) => u.includes('gateio')).length;
  window.__nativni.length = 0;
  const okx = vytvorBurzu('okx', {});
  out.okxTickeru = (await okx.getTickers()).length;
  out.okxNativne = window.__nativni.length;
  // Mimo APK: plugin existuje, ale isNativePlatform je false.
  window.Capacitor.isNativePlatform = () => false;
  window.__nativni.length = 0;
  const gate2 = vytvorBurzu('gate', {});
  out.gate2 = (await gate2.getTickers()).length;
  out.gate2Nativne = window.__nativni.length;
  delete window.Capacitor;
  return JSON.stringify(out);
})()""") or '{}')
print(json.dumps(vysledek, ensure_ascii=False))
over('mexc' not in vysledek.get('prohlizec', []) and 'mexc' in vysledek.get('apk', []), 'MEXC jen v APK')
g = vysledek.get('gate') or {}
over(g.get('tickeru', 0) > 500 and g.get('svicek', 0) >= 19 and (g.get('posledni') or 0) > 1000, 'Gate přes nativní HTTP: tickery i svíčky BTC')
over(vysledek.get('gateNativne', 0) >= 2, 'dotazy Gate šly přes plugin')
over(vysledek.get('okxTickeru', 0) > 300 and vysledek.get('okxNativne') == 0, 'OKX (má CORS) přes plugin nejde')
over(vysledek.get('gate2', 0) > 500 and vysledek.get('gate2Nativne') == 0, 'mimo APK se plugin nepoužije')

konzole = p.prikaz('Runtime.evaluate', expression='(window.__chyby||[]).join(" | ")', returnByValue=True).get('result', {}).get('value') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
sys.exit(1 if chyby else 0)
