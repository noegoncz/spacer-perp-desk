// Skutečné likvidace z CEX pro aplikaci (veřejná data, bez přihlášení).
//
// GET /api/likvidovano?c=BTC&od=<ms>&do=<ms>   (?stav=1 = souhrn provozu)
// Odpověď: { ok, t, u: [[minuta, cena, usd, strana, burza]] }
//   strana 0 = zlikvidovaný long, 1 = short; burza 0 Binance, 1 Bybit, 2 OKX
//   cena je za 1 coin (1000PEPE → PEPE). Okno nejvýš 30 dní.
// ⚠ Binance posílá jen největší likvidaci páru za vteřinu (objem nižší).
// Cache 60 s: všichni s otevřeným grafem sdílejí jednu odpověď.

import { corsHlavicky } from '../../lib/ucet.js';

const DEN = 86400000;

export const onRequestOptions = ({ request }) => new Response(null, { status: 204, headers: corsHlavicky(request) });

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const hlavicky = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    ...corsHlavicky(request),
  };
  if (u.searchParams.get('stav')) {
    const r = await env.LIQ.prepare('SELECT t, info FROM likvidovano_stav WHERE id = 1').first();
    return new Response(JSON.stringify({ ok: true, t: r?.t || null, info: r ? JSON.parse(r.info) : null }), { headers: hlavicky });
  }
  const c = (u.searchParams.get('c') || '').toUpperCase();
  if (!/^[A-Z0-9]{1,30}$/.test(c)) return new Response('{"ok":false}', { status: 400, headers: hlavicky });
  const ted = Date.now();
  const doCasu = Math.min(Number(u.searchParams.get('do')) || ted, ted);
  const od = Math.max(Number(u.searchParams.get('od')) || doCasu - DEN, doCasu - 30 * DEN);

  const vysledek = [];
  const videne = new Set();
  const pridej = (z) => {
    if (!Array.isArray(z) || z[0] < od || z[0] > doCasu) return;
    const id = `${z[0]}|${z[4]}|${z[3]}|${z[1]}`;
    if (videne.has(id)) return;
    videne.add(id);
    vysledek.push(z);
  };
  const { results } = await env.LIQ.prepare('SELECT data FROM likvidovano_dny WHERE coin = ? AND den BETWEEN ? AND ? ORDER BY den')
    .bind(c, Math.floor(od / DEN) * DEN, doCasu).all();
  for (const r of results) {
    for (const radek of r.data.split('\n')) {
      if (!radek) continue;
      try { pridej(JSON.parse(radek)); } catch { /* poškozený řádek */ }
    }
  }
  const stav = await env.LIQ.prepare('SELECT t, data FROM likvidovano_stav WHERE id = 1').first();
  try {
    for (const z of (stav ? JSON.parse(stav.data)[c] : null) || []) pridej(z);
  } catch { /* poškozený stav */ }
  vysledek.sort((a, b) => a[0] - b[0]);
  return new Response(JSON.stringify({ ok: true, t: stav?.t || null, u: vysledek }), { headers: hlavicky });
}
