// Zdi v knize příkazů pro aplikaci (veřejná data, bez přihlášení), v0.72.0.
//
// GET /api/zdi?k=binance:BTCUSDT&od=<ms>&do=<ms>   (?stav=1 = souhrn provozu)
// Odpověď: { ok, sleduje, t, mid, krok, zdi, hist }
//   zdi  — živé: [strana, cena, usd, od, min, max] (strana 0 = nákup)
//   hist — hotové v okně [od, do]: [strana, cena, od, do, min, max]
// Trh, který server nesleduje: { ok, sleduje: false } a zápis žádosti —
// server ho do 5 min začne sledovat (7 dní od posledního otevření grafu).
// Cache 30 s: všichni, kdo mají graf otevřený, sdílejí jednu odpověď.

import { corsHlavicky } from '../../lib/ucet.js';

const DEN = 86400000;
const KLIC = /^(binance|bybit|hyperliquid):[A-Z0-9]{2,30}$/;

export const onRequestOptions = ({ request }) => new Response(null, { status: 204, headers: corsHlavicky(request) });

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  // Souhrn provozu bez tajností (kontrola zátěže serveru): ?stav=1
  if (u.searchParams.get('stav')) {
    const r = await env.LIQ.prepare('SELECT t, info FROM zdi_stav WHERE id = 1').first();
    const i = r ? JSON.parse(r.info) : {};
    return Response.json({ ok: true, t: r?.t || null, trhu: i.trhu, synchro: i.synchro, zdi: i.zdi, cpu: i.cpu, pamet: i.pamet, resync: i.binanceResync },
      { headers: { 'Cache-Control': 'public, max-age=30', ...corsHlavicky(request) } });
  }
  const k = (u.searchParams.get('k') || '').slice(0, 60);
  const hlavicky = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30',
    ...corsHlavicky(request),
  };
  if (!KLIC.test(k)) return new Response('{"ok":false}', { status: 400, headers: hlavicky });
  const ted = Date.now();
  const doCasu = Math.min(Number(u.searchParams.get('do')) || ted, ted);
  const od = Math.max(Number(u.searchParams.get('od')) || doCasu - DEN, doCasu - 30 * DEN);

  const stav = await env.LIQ.prepare('SELECT data FROM zdi_stav WHERE id = 1').first();
  let s = null;
  try { s = stav ? JSON.parse(stav.data) : null; } catch { s = null; }
  const zive = s?.k?.[k];
  if (!zive) {
    // Nesledovaný trh → žádost (nejvýš jeden zápis za 12 h na trh).
    const z = await env.LIQ.prepare('SELECT cas FROM zdi_zadosti WHERE klic = ?').bind(k).first();
    if (!z || ted - z.cas > DEN / 2) {
      const zapis = env.LIQ.prepare('INSERT OR REPLACE INTO zdi_zadosti (klic, cas) VALUES (?, ?)').bind(k, ted).run();
      if (waitUntil) waitUntil(zapis); else await zapis;
    }
  }
  const { results } = await env.LIQ.prepare('SELECT data FROM zdi_dny WHERE klic = ? AND den BETWEEN ? AND ? ORDER BY den')
    .bind(k, Math.floor(od / DEN) * DEN, doCasu).all();
  const hist = [];
  for (const r of results) {
    for (const radek of r.data.split('\n')) {
      if (!radek) continue;
      try {
        const z = JSON.parse(radek);
        if (z[3] >= od && z[2] <= doCasu) hist.push(z);
      } catch { /* poškozený řádek */ }
    }
  }
  for (const z of s?.n || []) {
    if (z[0] === k && z[4] >= od && z[3] <= doCasu) hist.push(z.slice(1));
  }
  // Hotová zeď z poslední hodiny je v řádku „teď“ i v historii — jednou.
  const videne = new Set();
  const unikatni = hist.filter((z) => { const id = `${z[0]}|${z[1]}|${z[2]}`; if (videne.has(id)) return false; videne.add(id); return true; });
  return new Response(JSON.stringify({
    ok: true, sleduje: Boolean(zive), t: s?.t || null,
    mid: zive?.[0] ?? null, krok: zive?.[1] ?? null, zdi: zive?.[2] || [], hist: unikatni,
  }), { headers: hlavicky });
}
