/**
 * Skutečné likvidace z CEX — sběr na serveru (přání uživatele 2026-10-25:
 * porovnat kalkulovanou mapu se skutečností a ukázat je v grafu).
 *
 * Běží uvnitř služby likvidační mapy (server/likvidace.mjs ho spouští).
 * ⚠ Aktualizace serveru restartuje službu jen při změně souborů v seznamu
 * cloud-init → **při změně tohoto souboru změň VERZE_ZDI v likvidace.mjs**.
 *
 * Proudy (ověřeno sondou 2026-10-25):
 *   Binance — `!forceOrder@arr` na wss://fstream.binance.com/market/ws
 *             (stará /ws nic neposílá). ⚠ Burza posílá jen NEJVĚTŠÍ
 *             likvidaci páru za vteřinu → objem je podhodnocený.
 *             S = strana příkazu: SELL = zlikvidovaný long.
 *   Bybit   — `allLiquidation.<pár>` pro každý perpetuál (876 párů,
 *             po 10 v jedné zprávě). S = strana pozice: Buy = long.
 *   OKX     — `liquidation-orders` instType SWAP; sz v kontraktech
 *             (× ctVal z /public/instruments), posSide long / side sell
 *             = long. Po přihlášení přehraje staré události → jen čerstvé.
 * (Hyperliquid zatím ne — veřejný proud likvidace neoznačuje.)
 *
 * Coin = základ páru bez násobku (1000PEPE → PEPE, cena na 1 coin), všechny
 * burzy v jednom řádku coinu. Události se slučují po minutách: stejná
 * minuta + burza + strana + cena na 4 platné číslice = jeden záznam
 * [minuta (ms), cena (vážená), usd, strana 0 long | 1 short, burza 0|1|2].
 * Každou minutu POST /api/watcher/likvidovano { t, ted, historie?, info }:
 * `ted` = záznamy od poslední hodinové dávky (přepisuje se), jednou za hodinu
 * `historie` připojí řádky coin × den. Jen veřejná data, žádné identity.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 60000, HOD = 3600000, DEN = 86400000;
const BURZY = ['binance', 'bybit', 'okx'];
const BINANCE_WS = 'wss://fstream.binance.com/market/ws/!forceOrder@arr';
const MAX_TED = 1.5e6;            // strop řádku „teď“ v bajtech (krach trhu)

/** Základ páru → { coin, nasobek } (1000PEPE → PEPE ×1000, SHIB1000 → SHIB). */
export function coinParu(zaklad) {
  let m = /^(1\d{3,})([A-Z].*)$/.exec(zaklad);
  if (m) return { coin: m[2], nasobek: +m[1] };
  m = /^([A-Z].*?)(1000+)$/.exec(zaklad);
  if (m) return { coin: m[1], nasobek: +m[2] };
  return { coin: zaklad, nasobek: 1 };
}

const ctyriCislice = (c) => +c.toPrecision(4);

export function spustLikvidovano({ log, API, TOKEN, ZKOUSKA, STAV }) {
  const davka = new Map();        // coin → Map(klíč → záznam), od poslední hodinové dávky
  const stat = { binance: 0, bybit: 0, okx: 0, usd: [0, 0, 0], posledni: [0, 0, 0], spojeni: [0, 0, 0] };
  let posledniDavka = Date.now();
  let posledniUklid = 0;
  const okxKontrakty = new Map(); // instId → { ctVal, inverse }

  function zapis(b, zaklad, cas, cena, mnozstvi, long) {
    if (!(cena > 0) || !(mnozstvi > 0) || !Number.isFinite(cas)) return;
    const { coin, nasobek } = coinParu(zaklad);
    const usd = cena * mnozstvi;
    const cenaCoinu = cena / nasobek;
    const minuta = Math.floor(cas / MIN) * MIN;
    const strana = long ? 0 : 1;
    const klic = `${minuta}|${b}|${strana}|${ctyriCislice(cenaCoinu)}`;
    let c = davka.get(coin);
    if (!c) davka.set(coin, (c = new Map()));
    const z = c.get(klic);
    if (z) {
      z[1] = (z[1] * z[2] + cenaCoinu * usd) / (z[2] + usd);
      z[2] += usd;
    } else {
      c.set(klic, [minuta, cenaCoinu, usd, strana, b]);
    }
    stat[BURZY[b]] += 1;
    stat.usd[b] += usd;
    stat.posledni[b] = Date.now();
  }

  /* ---------- Binance ---------- */

  function pripojBinance() {
    const s = new WebSocket(BINANCE_WS);
    let ticho;
    const hlidej = () => { clearTimeout(ticho); ticho = setTimeout(() => s.close(), 10 * MIN); };
    s.onopen = () => { stat.spojeni[0] += 1; hlidej(); };
    s.onmessage = (e) => {
      hlidej();
      try {
        const o = JSON.parse(e.data).o;
        const m = /^([A-Z0-9]+?)(USDT|USDC)$/.exec(o.s);
        if (m) zapis(0, m[1], o.T, +o.ap || +o.p, +o.z || +o.q, o.S === 'SELL');
      } catch { /* poškozená zpráva */ }
    };
    s.onclose = () => { clearTimeout(ticho); setTimeout(pripojBinance, 5000); };
    s.onerror = () => {};
  }

  /* ---------- Bybit ---------- */

  let bybitPary = [];
  async function paryBybit() {
    try {
      const r = await fetch('https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000', { signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      const p = (d.result?.list || []).filter((x) => x.status === 'Trading' && x.contractType === 'LinearPerpetual').map((x) => x.symbol);
      if (p.length) bybitPary = p;
    } catch (e) { log('likvidovano: páry Bybit', e.message); }
  }

  let bybitSpojeni = null;
  function pripojBybit() {
    const s = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    bybitSpojeni = s;
    let ping;
    s.onopen = () => {
      stat.spojeni[1] += 1;
      for (let i = 0; i < bybitPary.length; i += 10) {
        s.send(JSON.stringify({ op: 'subscribe', args: bybitPary.slice(i, i + 10).map((p) => `allLiquidation.${p}`) }));
      }
      ping = setInterval(() => s.readyState === 1 && s.send('{"op":"ping"}'), 20000);
    };
    s.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!Array.isArray(d.data)) return;
        for (const x of d.data) {
          const m = /^([A-Z0-9]+?)(USDT|USDC|PERP)$/.exec(x.s);
          if (m) zapis(1, m[1], +x.T, +x.p, +x.v, x.S === 'Buy');
        }
      } catch { /* poškozená zpráva */ }
    };
    s.onclose = () => { clearInterval(ping); setTimeout(pripojBybit, 5000); };
    s.onerror = () => {};
  }

  /* ---------- OKX ---------- */

  async function kontraktyOkx() {
    try {
      const r = await fetch('https://www.okx.com/api/v5/public/instruments?instType=SWAP', { signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      for (const x of d.data || []) okxKontrakty.set(x.instId, { ctVal: +x.ctVal, inverse: x.ctType === 'inverse' });
    } catch (e) { log('likvidovano: kontrakty OKX', e.message); }
  }

  function pripojOkx() {
    const s = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
    let ping;
    const od = Date.now() - 2 * MIN;   // přehrané staré události pryč
    s.onopen = () => {
      stat.spojeni[2] += 1;
      s.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'liquidation-orders', instType: 'SWAP' }] }));
      ping = setInterval(() => s.readyState === 1 && s.send('ping'), 25000);
    };
    s.onmessage = (e) => {
      if (e.data === 'pong') return;
      try {
        const d = JSON.parse(e.data);
        for (const x of d.data || []) {
          const k = okxKontrakty.get(x.instId);
          const m = /^([A-Z0-9]+)-(USDT|USDC|USD)-SWAP$/.exec(x.instId);
          if (!k || !m) continue;
          for (const v of x.details || []) {
            const t = +v.ts;
            if (t < od) continue;
            const cena = +v.bkPx;
            // Inverzní kontrakt má ctVal v USD → množství coinu = USD / cena.
            const mnozstvi = k.inverse ? (+v.sz * k.ctVal) / cena : +v.sz * k.ctVal;
            const long = v.posSide === 'long' || (v.posSide !== 'short' && v.side === 'sell');
            zapis(2, m[1], t, cena, mnozstvi, long);
          }
        }
      } catch { /* poškozená zpráva */ }
    };
    s.onclose = () => { clearInterval(ping); setTimeout(pripojOkx, 5000); };
    s.onerror = () => {};
  }

  /* ---------- odesílání ---------- */

  const zaokrouhli = (z) => [z[0], +z[1].toPrecision(6), Math.round(z[2]), z[3], z[4]];

  function radekTed() {
    const k = {};
    for (const [coin, c] of davka) k[coin] = [...c.values()].map(zaokrouhli);
    let s = JSON.stringify(k);
    if (s.length > MAX_TED) {
      // Krach trhu: v řádku „teď“ jen větší záznamy (historie má vše).
      for (const coin of Object.keys(k)) k[coin] = k[coin].filter((z) => z[2] >= 5000);
      s = JSON.stringify(k);
    }
    return s;
  }

  function historie() {
    const h = [];
    for (const [coin, c] of davka) {
      const dny = new Map();
      for (const z of c.values()) {
        const den = Math.floor(z[0] / DEN) * DEN;
        if (!dny.has(den)) dny.set(den, []);
        dny.get(den).push(JSON.stringify(zaokrouhli(z)));
      }
      for (const [den, r] of dny) h.push({ c: coin, den, d: `${r.join('\n')}\n` });
    }
    return h;
  }

  async function minuta() {
    const ted = Date.now();
    const info = {
      udalosti: { binance: stat.binance, bybit: stat.bybit, okx: stat.okx },
      usd: Object.fromEntries(BURZY.map((b, i) => [b, Math.round(stat.usd[i])])),
      ticho: Object.fromEntries(BURZY.map((b, i) => [b, stat.posledni[i] ? Math.round((ted - stat.posledni[i]) / 1000) : null])),
      spojeni: Object.fromEntries(BURZY.map((b, i) => [b, stat.spojeni[i]])),
      coinu: davka.size, bybitPary: bybitPary.length, okxKontraktu: okxKontrakty.size,
    };
    const hodinova = ted - posledniDavka >= HOD;
    const d = { t: ted, ted: radekTed(), info };
    if (hodinova) {
      d.historie = historie();
      if (ted - posledniUklid > 6 * HOD) d.uklid = true;
    }
    if (ZKOUSKA) {
      mkdirSync(STAV, { recursive: true });
      appendFileSync(join(STAV, 'likvidovano.jsonl'), `${JSON.stringify({ t: ted, info, coinu: davka.size, historie: d.historie?.length })}\n`);
      if (hodinova) { davka.clear(); posledniDavka = ted; }
      return;
    }
    try {
      const r = await fetch(`${API}/api/watcher/likvidovano`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Watcher-Token': TOKEN },
        body: JSON.stringify(d), signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`perpyx ${r.status}`);
      if (hodinova) {
        davka.clear();
        posledniDavka = ted;
        if (d.uklid) posledniUklid = ted;
      }
    } catch (e) {
      log('likvidovano: odeslání', e.message);
    }
  }

  (async () => {
    await Promise.all([paryBybit(), kontraktyOkx()]);
    pripojBinance();
    pripojBybit();
    pripojOkx();
    // Nové páry / kontrakty po 6 h; Bybit se kvůli novým párům připojí znovu.
    setInterval(async () => {
      const pred = bybitPary.length;
      await Promise.all([paryBybit(), kontraktyOkx()]);
      if (bybitPary.length !== pred) bybitSpojeni?.close();
    }, 6 * HOD);
    (function planuj() {
      setTimeout(async () => {
        try { await minuta(); } catch (e) { log('likvidovano:', e.message); }
        planuj();
      }, MIN - (Date.now() % MIN) + 15000);
    })();
    log(`likvidovano: start (Bybit ${bybitPary.length} párů, OKX ${okxKontrakty.size} kontraktů)`);
  })();
}
