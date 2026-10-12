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

vysledek = p.prikaz('Runtime.evaluate', awaitPromise=True, returnByValue=True, expression=r"""
(async () => {
  const model = await import('./js/burzy/model.js');
  const { BURZY, vytvorBurzu } = await import('./js/burzy/index.js');
  const out = {};
  for (const id of Object.keys(BURZY)) {
    const r = { chyby: [], pocty: {} };
    const kontrola = (tvar, seznam) => {
      r.pocty[tvar] = (seznam || []).length;
      if (!Array.isArray(seznam) || !seznam.length) { r.chyby.push(`${tvar}: žádná data`); return; }
      for (const x of seznam.slice(0, 20)) r.chyby.push(...model.zkontroluj(tvar, x));
    };
    let pozice = [];
    const a = vytvorBurzu(id, { onPositions: (l) => { pozice = l; } });
    for (const m of model.METODY) if (typeof a[m] !== 'function') r.chyby.push(`chybí metoda ${m}`);
    if (!a.burza || !a.burza.nazev || !a.burza.schopnosti || !a.burza.regiony) r.chyby.push('chybí popis burzy (nazev, schopnosti, regiony)');
    a.setCredentials('KONTRAKT', 'KONTRAKT');
    try {
      await a.refresh();
      kontrola('pozice', pozice);
      kontrola('prikaz', await a.getOpenOrders('JUPUSDT'));
      const ted = Date.now();
      const obchody = await a.getClosedTrades(ted - 7 * 864e5, ted);
      kontrola('obchod', obchody);
      kontrola('plneni', await a.getExecutions('JUPUSDT', ted - 7 * 864e5, ted));
      kontrola('svicka', await a.getKlines('JUPUSDT', '240', 50));
      kontrola('ticker', await a.getTickers());
      const t1 = await a.getTicker('JUPUSDT');
      if (!t1) r.chyby.push('getTicker: žádná data');
      r.ucet = a.popisUctu();
    } catch (e) {
      r.chyby.push('výjimka: ' + (e && e.message || e));
    }
    a.stop();
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
    print(f'== {burza}: počty {r["pocty"]}  účet „{r.get("ucet")}"')
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
