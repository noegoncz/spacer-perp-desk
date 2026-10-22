/**
 * Zdi v knize příkazů — sběr na serveru (v0.72.0, přání uživatele:
 * „velká nákupní zeď, jak dlouho stojí, teď / min / max“).
 *
 * Běží uvnitř služby likvidační mapy (server/likvidace.mjs ho spouští) —
 * nová služba systemd by znamenala založit server znovu. ⚠ Aktualizace
 * serveru restartuje službu jen při změně likvidace.mjs nebo
 * js/likvidace-format.js: **při změně tohoto souboru nebo js/zdi-format.js
 * změň i řádek VERZE_ZDI v likvidace.mjs**.
 *
 * Co sleduje: perpetuály s obratem ≥ MIN_OBRAT za 24 h na Binance, Bybitu
 * a Hyperliquidu (nejvýš MAX_TRHU, přepočet po 6 h) + trhy, jejichž graf
 * někdo v aplikaci otevřel za posledních 7 dní (/api/zdi to zapíše).
 * Knihy:
 *   Binance  — snímek /fapi/v1/depth (1000 úrovní) + proud změn @depth@500ms;
 *              mimo snímek se kniha doučí ze změn (vzdálené zdi)
 *   Bybit    — orderbook.1000 (snímek + změny), jen 1000 nejbližších úrovní
 *   Hyperliquid — l2Book s nSigFigs 3 (20 agregovaných úrovní na stranu)
 * Každou minutu: zdi každé knihy (js/zdi-format.js), sledování v čase,
 * POST /api/watcher/zdi { ted, historie, info }. Ven jdou jen součty po
 * pásmech, žádné identity. Jen veřejná data.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { najdiZdi, Sledovani, NASOBEK, NASOBEK_HL } from '../js/zdi-format.js';

const MIN = 60000, HOD = 3600000;
const MIN_OBRAT = +process.env.ZDI_MIN_OBRAT || 20e6;
// Začínáme na 150 (server ARM, služba má strop CPU 60 % a dělí se s mapou
// likvidací); lokálně 233 trhů = ~24 % jádra, 185 MB. Zvednout podle `cpu`.
const MAX_TRHU = +process.env.ZDI_MAX || 150;
const MAX_ZADOSTI = 100;
const NEDAVNE = 90 * MIN;          // hotové zdi v řádku „teď“ (do dávky historie)
const OREZ = 0.15;                 // úrovně dál než ±15 % od středu se zahodí
// ⚠ Binance dělí futures proudy podle druhu (2025/26): kniha (depth) je
// mezi „public“ (vysokofrekvenční), ceny mezi „market“. Ověřeno testem.
const BINANCE_WS = process.env.ZDI_BINANCE_WS || 'wss://fstream.binance.com/public/ws';
const spi = (ms) => new Promise((r) => setTimeout(r, ms));
const dnes = (t) => Math.floor(t / 86400000) * 86400000;

export function spustZdi({ log, API, TOKEN, ZKOUSKA, STAV, limitTrhu = Infinity }) {
  const trhy = new Map();      // klíč → { burza, sym, kniha, sled, synchro, ... }
  const stat = { binanceSnimku: 0, binanceResync: 0, chyb: 0 };
  let nedavne = [];            // [klic, …hotová zeď] za posledních 90 min
  let davka = new Map();       // klic → řádky historie (odejdou jednou za hodinu)
  let posledniDavka = Date.now();
  let posledniUklid = 0;
  let zadosti = [];

  const json = async (url, telo) => {
    const r = await fetch(url, {
      method: telo ? 'POST' : 'GET',
      headers: telo ? { 'Content-Type': 'application/json' } : {},
      body: telo ? JSON.stringify(telo) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return r.json();
  };

  /* ---------- výběr trhů ---------- */

  async function obratyBurz() {
    const vysledek = [];
    try {
      for (const x of await json('https://fapi.binance.com/fapi/v1/ticker/24hr')) {
        if (/^[A-Z0-9]+(USDT|USDC)$/.test(x.symbol)) vysledek.push({ klic: `binance:${x.symbol}`, burza: 'binance', sym: x.symbol, obrat: +x.quoteVolume });
      }
    } catch (e) { log('zdi: obraty Binance', e.message); }
    try {
      const d = await json('https://api.bybit.com/v5/market/tickers?category=linear');
      for (const x of d.result?.list || []) {
        if (x.symbol.endsWith('USDT')) vysledek.push({ klic: `bybit:${x.symbol}`, burza: 'bybit', sym: x.symbol, obrat: +x.turnover24h });
      }
    } catch (e) { log('zdi: obraty Bybit', e.message); }
    try {
      const [meta, ctx] = await json('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs' });
      meta.universe.forEach((u, i) => {
        if (u.isDelisted) return;
        vysledek.push({ klic: `hyperliquid:${u.name.toUpperCase()}USDC`, burza: 'hyperliquid', sym: u.name, obrat: +ctx[i]?.dayNtlVlm || 0 });
      });
    } catch (e) { log('zdi: obraty Hyperliquid', e.message); }
    return vysledek;
  }

  async function vyberTrhy() {
    const vse = await obratyBurz();
    if (!vse.length) return;
    const podleKlice = new Map(vse.map((x) => [x.klic, x]));
    const chci = vse.filter((x) => x.obrat >= MIN_OBRAT).sort((a, b) => b.obrat - a.obrat).slice(0, Math.min(MAX_TRHU, limitTrhu));
    for (const k of zadosti.slice(0, MAX_ZADOSTI)) {
      const x = podleKlice.get(k);
      if (x && !chci.includes(x)) chci.push(x);
    }
    const nove = new Set(chci.map((x) => x.klic));
    for (const [k, t] of trhy) if (!nove.has(k)) { odhlas(t); trhy.delete(k); }
    for (const x of chci) {
      if (trhy.has(x.klic)) continue;
      trhy.set(x.klic, { ...x, bids: new Map(), asks: new Map(), sled: new Sledovani(), synchro: false, buffer: [] });
    }
    log(`zdi: sleduji ${trhy.size} trhů (binance ${[...trhy.values()].filter((t) => t.burza === 'binance').length},`
      + ` bybit ${[...trhy.values()].filter((t) => t.burza === 'bybit').length},`
      + ` hyperliquid ${[...trhy.values()].filter((t) => t.burza === 'hyperliquid').length}; žádostí ${zadosti.length})`);
    prihlasVse();
  }

  /* ---------- Binance: snímek + proud změn ---------- */

  let wsBinance = null;
  let frontaSnimku = [];

  function prihlasBinance() {
    if (wsBinance?.readyState !== 1) return;
    const chci = [...trhy.values()].filter((t) => t.burza === 'binance' && !t.prihlaseno);
    for (let i = 0; i < chci.length; i += 50) {
      const cast = chci.slice(i, i + 50);
      // Binance povolí 10 zpráv za vteřinu — dávky po 50 proudech.
      setTimeout(() => {
        if (wsBinance?.readyState !== 1) return;
        wsBinance.send(JSON.stringify({ method: 'SUBSCRIBE', params: cast.map((t) => `${t.sym.toLowerCase()}@depth@500ms`), id: Date.now() % 1e9 }));
        cast.forEach((t) => { t.prihlaseno = true; zarad(t); });
      }, (i / 50) * 300);
    }
  }

  function zarad(t) {
    t.synchro = false;
    t.buffer = [];
    if (!frontaSnimku.includes(t)) frontaSnimku.push(t);
  }

  // Snímek váží 20; limit 2400 / min → jeden za 1,5 s (800 / min).
  async function snimkyBinance() {
    for (;;) {
      const t = frontaSnimku.shift();
      if (!t) { await spi(1000); continue; }
      if (!trhy.has(t.klic)) continue;
      try {
        const d = await json(`https://fapi.binance.com/fapi/v1/depth?symbol=${t.sym}&limit=1000`);
        stat.binanceSnimku += 1;
        t.bids = new Map(d.bids.map(([p, q]) => [+p, +q]));
        t.asks = new Map(d.asks.map(([p, q]) => [+p, +q]));
        t.posledniU = d.lastUpdateId;
        t.cekaPrvni = true;
        t.synchro = true;
        const buf = t.buffer;
        t.buffer = [];
        for (const e of buf) zmenaBinance(t, e);
      } catch (e) {
        stat.chyb += 1;
        frontaSnimku.push(t);
        if (/429|418/.test(e.message)) await spi(60000);
      }
      await spi(1500);
    }
  }

  function zmenaBinance(t, e) {
    if (!t.synchro) { t.buffer.push(e); if (t.buffer.length > 200) t.buffer.shift(); return; }
    if (e.u < t.posledniU) return;
    if (t.cekaPrvni) {
      if (e.U > t.posledniU + 1 && e.pu > t.posledniU) { stat.binanceResync += 1; zarad(t); return; }
      t.cekaPrvni = false;
    } else if (e.pu !== t.posledniU) {
      stat.binanceResync += 1;
      zarad(t);
      return;
    }
    t.posledniU = e.u;
    for (const [p, q] of e.b) { const c = +p, m = +q; if (m) t.bids.set(c, m); else t.bids.delete(c); }
    for (const [p, q] of e.a) { const c = +p, m = +q; if (m) t.asks.set(c, m); else t.asks.delete(c); }
  }

  function pripojBinance() {
    const s = new WebSocket(BINANCE_WS);
    wsBinance = s;
    s.onopen = () => {
      log('zdi: Binance spojeno');
      for (const t of trhy.values()) if (t.burza === 'binance') t.prihlaseno = false;
      prihlasBinance();
    };
    s.onmessage = (m) => {
      let e;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (e.e !== 'depthUpdate') return;
      const t = trhy.get(`binance:${e.s}`);
      if (t) zmenaBinance(t, e);
    };
    s.onclose = () => {
      if (wsBinance === s) wsBinance = null;
      for (const t of trhy.values()) if (t.burza === 'binance') { t.synchro = false; t.prihlaseno = false; }
      frontaSnimku = [];
      setTimeout(pripojBinance, 5000);
    };
    s.onerror = () => {};
  }

  /* ---------- Bybit: orderbook.1000 ---------- */

  let wsBybit = null;
  let pingBybit = null;

  function prihlasBybit() {
    if (wsBybit?.readyState !== 1) return;
    const chci = [...trhy.values()].filter((t) => t.burza === 'bybit' && !t.prihlaseno);
    for (let i = 0; i < chci.length; i += 10) {
      const cast = chci.slice(i, i + 10);
      wsBybit.send(JSON.stringify({ op: 'subscribe', args: cast.map((t) => `orderbook.1000.${t.sym}`) }));
      cast.forEach((t) => { t.prihlaseno = true; });
    }
  }

  function pripojBybit() {
    const s = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    wsBybit = s;
    s.onopen = () => {
      log('zdi: Bybit spojeno');
      for (const t of trhy.values()) if (t.burza === 'bybit') t.prihlaseno = false;
      prihlasBybit();
      clearInterval(pingBybit);
      pingBybit = setInterval(() => s.readyState === 1 && s.send('{"op":"ping"}'), 20000);
    };
    s.onmessage = (m) => {
      let e;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (!e.topic?.startsWith('orderbook.')) return;
      const t = trhy.get(`bybit:${e.data?.s}`);
      if (!t) return;
      if (e.type === 'snapshot') {
        t.bids = new Map(e.data.b.map(([p, q]) => [+p, +q]));
        t.asks = new Map(e.data.a.map(([p, q]) => [+p, +q]));
        t.synchro = true;
        return;
      }
      if (!t.synchro) return;
      for (const [p, q] of e.data.b) { const c = +p, v = +q; if (v) t.bids.set(c, v); else t.bids.delete(c); }
      for (const [p, q] of e.data.a) { const c = +p, v = +q; if (v) t.asks.set(c, v); else t.asks.delete(c); }
    };
    s.onclose = () => {
      clearInterval(pingBybit);
      if (wsBybit === s) wsBybit = null;
      for (const t of trhy.values()) if (t.burza === 'bybit') { t.synchro = false; t.prihlaseno = false; }
      setTimeout(pripojBybit, 5000);
    };
    s.onerror = () => {};
  }

  /* ---------- Hyperliquid: l2Book ---------- */

  let wsHl = null;
  let pingHl = null;

  function prihlasHl() {
    if (wsHl?.readyState !== 1) return;
    for (const t of trhy.values()) {
      if (t.burza !== 'hyperliquid' || t.prihlaseno) continue;
      wsHl.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: t.sym, nSigFigs: 3 } }));
      t.prihlaseno = true;
    }
  }

  function pripojHl() {
    const s = new WebSocket('wss://api.hyperliquid.xyz/ws');
    wsHl = s;
    s.onopen = () => {
      log('zdi: Hyperliquid spojeno');
      for (const t of trhy.values()) if (t.burza === 'hyperliquid') t.prihlaseno = false;
      prihlasHl();
      clearInterval(pingHl);
      pingHl = setInterval(() => s.readyState === 1 && s.send('{"method":"ping"}'), 50000);
    };
    s.onmessage = (m) => {
      let e;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      if (e.channel !== 'l2Book') return;
      const t = [...trhy.values()].find((x) => x.burza === 'hyperliquid' && x.sym === e.data?.coin);
      if (!t) return;
      const [b, a] = e.data.levels || [[], []];
      t.bids = new Map(b.map((x) => [+x.px, +x.sz]));
      t.asks = new Map(a.map((x) => [+x.px, +x.sz]));
      t.synchro = true;
      t.cas = Date.now();
    };
    s.onclose = () => {
      clearInterval(pingHl);
      if (wsHl === s) wsHl = null;
      for (const t of trhy.values()) if (t.burza === 'hyperliquid') { t.synchro = false; t.prihlaseno = false; }
      setTimeout(pripojHl, 5000);
    };
    s.onerror = () => {};
  }

  function prihlasVse() { prihlasBinance(); prihlasBybit(); prihlasHl(); }

  function odhlas(t) {
    try {
      if (t.burza === 'binance' && wsBinance?.readyState === 1) wsBinance.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [`${t.sym.toLowerCase()}@depth@500ms`], id: 1 }));
      if (t.burza === 'bybit' && wsBybit?.readyState === 1) wsBybit.send(JSON.stringify({ op: 'unsubscribe', args: [`orderbook.1000.${t.sym}`] }));
      if (t.burza === 'hyperliquid' && wsHl?.readyState === 1) wsHl.send(JSON.stringify({ method: 'unsubscribe', subscription: { type: 'l2Book', coin: t.sym, nSigFigs: 3 } }));
    } catch { /* spojení padá */ }
  }

  /* ---------- minuta: zdi, sledování, odeslání ---------- */

  const cena = (c) => +c.toPrecision(6);

  function orez(t, mid) {
    for (const m of [t.bids, t.asks]) for (const p of m.keys()) if (Math.abs(p / mid - 1) > OREZ) m.delete(p);
  }

  let cpu0 = process.cpuUsage();
  let cpuCas = Date.now();

  function minuta() {
    const t0 = Math.floor(Date.now() / MIN) * MIN;
    // Zatížení procesu (celá služba i s likvidacemi) za poslední minutu.
    const c = process.cpuUsage(cpu0);
    const cpu = Math.round((100 * (c.user + c.system)) / ((Date.now() - cpuCas) * 1000));
    cpu0 = process.cpuUsage();
    cpuCas = Date.now();
    const ted = {};
    let synchro = 0;
    let zdiCelkem = 0;
    for (const [k, t] of trhy) {
      if (!t.synchro || (t.burza === 'hyperliquid' && Date.now() - (t.cas || 0) > 3 * MIN)) continue;
      synchro += 1;
      // Krok pásma drží hodinu (indexy zdí se nemění při malém pohybu ceny).
      if (!t.krokDo || t0 >= t.krokDo) { t.krok = 0; t.krokDo = t0 + HOD; }
      const v = najdiZdi(t.bids, t.asks, t.krok, t.burza === 'hyperliquid' ? NASOBEK_HL : NASOBEK);
      if (!v) continue;
      t.krok = v.krok;
      orez(t, v.mid);
      for (const h of t.sled.krok(t0, v)) {
        const radek = [h[0], cena(h[1]), h[2], h[3], h[4], h[5]];
        nedavne.push([k, ...radek]);
        if (!davka.has(k)) davka.set(k, []);
        davka.get(k).push(JSON.stringify(radek));
      }
      const zive = t.sled.ted().map((z) => [z[0], cena(z[1]), z[2], z[3], z[4], z[5]]);
      zdiCelkem += zive.length;
      ted[k] = [cena(v.mid), v.krok, zive];
    }
    nedavne = nedavne.filter((z) => z[4] >= t0 - NEDAVNE);
    // Hotové zdi do historie jednou za hodinu (jeden zápis na trh a den).
    let historie = [];
    if (Date.now() - posledniDavka >= HOD) {
      historie = [...davka].map(([k, r]) => ({ k, den: dnes(t0), d: `${r.join('\n')}\n` }));
      davka = new Map();
      posledniDavka = Date.now();
    }
    return {
      t: t0, ted, nedavne, historie,
      info: { trhu: trhy.size, cpu, pamet: Math.round(process.memoryUsage().rss / 1e6), synchro, zdi: zdiCelkem, nedavnych: nedavne.length, zadosti: zadosti.length,
        binance: wsBinance?.readyState === 1, bybit: wsBybit?.readyState === 1, hl: wsHl?.readyState === 1,
        ...stat, frontaSnimku: frontaSnimku.length },
    };
  }

  async function odesli(d) {
    const uklid = Date.now() - posledniUklid > 6 * HOD;
    const telo = { t: d.t, ted: JSON.stringify({ t: d.t, k: d.ted, n: d.nedavne }), historie: d.historie, info: d.info, uklid };
    if (ZKOUSKA) {
      mkdirSync(STAV, { recursive: true });
      writeFileSync(join(STAV, 'zdi-ted.json'), telo.ted);
      writeFileSync(join(STAV, 'zdi-info.json'), JSON.stringify(d.info));
      for (const h of d.historie) appendFileSync(join(STAV, 'zdi-historie.txt'), `${h.k}\t${h.den}\t${JSON.stringify(h.d)}\n`);
      return;
    }
    try {
      const r = await fetch(`${API}/api/watcher/zdi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Watcher-Token': TOKEN },
        body: JSON.stringify(telo), signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`perpyx ${r.status}`);
      if (uklid) posledniUklid = Date.now();
    } catch (e) {
      log('zdi: odeslání', e.message);
      // Neodeslaná historie se vrátí do dávky (příště znovu).
      for (const h of d.historie) {
        if (!davka.has(h.k)) davka.set(h.k, []);
        davka.get(h.k).unshift(...h.d.trim().split('\n'));
      }
    }
  }

  async function nactiZadosti() {
    if (ZKOUSKA) { zadosti = (process.env.ZDI_ZADOSTI || '').split(',').filter(Boolean); return; }
    try {
      const r = await fetch(`${API}/api/watcher/zdi`, { headers: { 'X-Watcher-Token': TOKEN }, signal: AbortSignal.timeout(20000) });
      const d = await r.json();
      zadosti = Array.isArray(d.zadosti) ? d.zadosti : [];
    } catch (e) { log('zdi: žádosti', e.message); }
  }

  /* ---------- start ---------- */

  (async () => {
    await nactiZadosti();
    await vyberTrhy();
    pripojBinance();
    pripojBybit();
    pripojHl();
    snimkyBinance();
    setInterval(async () => { await nactiZadosti(); await vyberTrhy(); }, 6 * HOD);
    // Nové žádosti (graf otevřený v aplikaci) se přidají do 5 min.
    setInterval(async () => {
      const pred = zadosti.join();
      await nactiZadosti();
      if (zadosti.join() !== pred) await vyberTrhy();
    }, 5 * MIN);
    (function planuj() {
      // 35 s po celé minutě (likvidace odesílají v 5. vteřině).
      setTimeout(async () => {
        try { await odesli(minuta()); } catch (e) { log('zdi:', e.message); }
        planuj();
      }, MIN - (Date.now() % MIN) + 35000);
    })();
  })();

  return { stat: () => ({ trhu: trhy.size, ...stat }) };
}
