# -*- coding: utf-8 -*-
"""
Kontraktní test burz (krok 1 napojení více burz, v0.52.0).

Pro každou burzu ze seznamu (js/burzy/index.js) vytvoří adaptér, nechá ho
stáhnout data z podstrčené burzy (tools/mock-bybit.js — pro další burzy
přibudou jejich mocky) a zkontroluje, že VŠECHNO odpovídá společnému modelu
(js/burzy/model.js): pozice, příkazy, uzavřené obchody, plnění, svíčky,
tickery, povinné metody a popis schopností. Co projde pro Bybit, musí
projít i pro každou další burzu — aplikace pak nemusí nic vědět o tom,
se kterou mluví.

Bybit jde celý přes podstrčenou burzu (mock). Burzy přes CCXT (Binance…)
jdou na **skutečnou burzu**: veřejná data (svíčky, ceny, trhy) vždy,
soukromá (pozice, příkazy, obchody, plnění) jen s klíčem z testnetu
v proměnných prostředí — klíč se nikam neukládá ani nevypisuje:
    BINANCE_DEMO_KEY, BINANCE_DEMO_SECRET  (Binance Demo Trading,
    demo-fapi.binance.com; starý testnet.binancefuture.com 2026-10-12
    neodpovídal). Veřejná data jdou vždy z ostré burzy.

Spuštění: python tools/test-kontrakt-burzy.py http://localhost:8075/index.html
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
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)

KONFIG = {
    'bybit': {'klic': ['KONTRAKT', 'KONTRAKT'], 'volby': {}, 'par': 'JUPUSDT'},
    'binance': {'klic': [os.environ.get('BINANCE_DEMO_KEY', ''), os.environ.get('BINANCE_DEMO_SECRET', '')],
                'volby': {'demo': True}, 'par': 'BTCUSDT', 'verejne': True},
    # v0.57.0: zatím jen veřejná data (připojení klíče se zapne později).
    'okx': {'par': 'BTCUSDT', 'verejne': True},
    'bitget': {'par': 'BTCUSDT', 'verejne': True},
    'gate': {'par': 'BTCUSDT', 'verejne': True},
    'mexc': {'par': 'BTCUSDT', 'verejne': True},
    'hyperliquid': {'par': 'BTCUSDC', 'verejne': True},
}

vysledek = p.prikaz('Runtime.evaluate', awaitPromise=True, returnByValue=True, expression=r"""
(async () => {
  const KONFIG = """ + json.dumps(KONFIG) + r""";
  const model = await import('./js/burzy/model.js');
  const { BURZY, vytvorBurzu, verejneDostupne } = await import('./js/burzy/index.js');
  const out = {};
  // MEXC (bez CORS) jde jen v APK — v prohlížeči se přeskočí.
  for (const id of Object.keys(BURZY).filter((b) => verejneDostupne().includes(b))) {
    const k = KONFIG[id] || {};
    const r = { chyby: [], pocty: {} };
    const kontrola = (tvar, seznam) => {
      r.pocty[tvar] = (seznam || []).length;
      if (!Array.isArray(seznam) || !seznam.length) { r.chyby.push(`${tvar}: žádná data`); return; }
      for (const x of seznam.slice(0, 20)) r.chyby.push(...model.zkontroluj(tvar, x));
    };
    let pozice = [];
    let chybaPozic = '';
    const a = vytvorBurzu(id, { onPositions: (l) => { pozice = l; }, onError: (m) => { chybaPozic = m; } }, k.volby || {});
    for (const m of model.METODY) if (typeof a[m] !== 'function') r.chyby.push(`chybí metoda ${m}`);
    if (!a.burza || !a.burza.nazev || !a.burza.schopnosti || !a.burza.regiony) r.chyby.push('chybí popis burzy (nazev, schopnosti, regiony)');
    const par = k.par || 'JUPUSDT';
    const maKlic = Boolean(k.klic && k.klic[0] && k.klic[1]);
    // Veřejná data vždy z ostré burzy (demo / testnet je nemusí mít úplná).
    const v = k.verejne ? vytvorBurzu(id, {}, {}) : a;
    try {
      kontrola('svicka', await v.getKlines(par, '240', 50));
      kontrola('ticker', await v.getTickers());
      const t1 = await v.getTicker(par);
      if (!t1) r.chyby.push('getTicker: žádná data');
      else r.chyby.push(...model.zkontroluj('ticker', t1));
      if (k.verejne) {
        // Svíčky z minulosti (prohlídka obchodu) — mock konec okna nezná.
        const sv = await v.getKlines(par, '60', 30, Date.now() - 30 * 864e5);
        if (!sv.length || sv[sv.length - 1].time > Date.now() - 29 * 864e5) r.chyby.push('getKlines s endTime nevrací svíčky z doby konce');
      }
      // Soukromá data — jen s klíčem.
      if (maKlic) {
        a.setCredentials(k.klic[0], k.klic[1]);
        await a.refresh();
        if (chybaPozic) r.chyby.push('refresh: ' + chybaPozic);
        r.pocty.pozice = pozice.length;
        for (const x of pozice) r.chyby.push(...model.zkontroluj('pozice', x));
        const pr = await a.getOpenOrders(par);
        r.pocty.prikaz = pr.length;
        for (const x of pr) r.chyby.push(...model.zkontroluj('prikaz', x));
        const ted = Date.now();
        const ob = await a.getClosedTrades(ted - 7 * 864e5, ted);
        r.pocty.obchod = ob.length;
        for (const x of ob) r.chyby.push(...model.zkontroluj('obchod', x));
        const pl = await a.getExecutions(par, ted - 7 * 864e5, ted);
        r.pocty.plneni = pl.length;
        for (const x of pl) r.chyby.push(...model.zkontroluj('plneni', x));
        if (!k.verejne) {
          // Podstrčená burza má data vždy — prázdno je chyba.
          for (const [n, v] of [['pozice', pozice], ['prikaz', pr], ['obchod', ob], ['plneni', pl]]) if (!v.length) r.chyby.push(`${n}: žádná data`);
        }
        r.ucet = a.popisUctu();
      } else {
        r.bezKlice = true;
      }
    } catch (e) {
      r.chyby.push('výjimka: ' + (e && e.message || e));
    }
    a.stop();
    if (v !== a) v.stop();
    out[id] = r;
  }
  return JSON.stringify(out);
})()
""").get('result', {}).get('value')

chyby = []
data = json.loads(vysledek or '{}')
if not data:
    chyby.append('žádná burza v seznamu nebo test nedoběhl')
for burza, r in data.items():
    print(f'== {burza}: počty {r["pocty"]}  účet „{r.get("ucet")}"' + ('  (bez klíče: jen veřejná data)' if r.get('bezKlice') else ''))
    for c in r['chyby'][:30]:
        print('  CHYBA', c)
    if r['chyby']:
        chyby.append(f'{burza}: {len(r["chyby"])} odchylek od společného modelu')
    else:
        print('  ok   všechna data odpovídají společnému modelu')

konzole = p.prikaz('Runtime.evaluate', expression='(window.__chyby||[]).join(" | ")', returnByValue=True).get('result', {}).get('value') or ''
if konzole:
    chyby.append(f'chyby v konzoli: {konzole}')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else '!!! ' + '; '.join(chyby))
sys.exit(1 if chyby else 0)
