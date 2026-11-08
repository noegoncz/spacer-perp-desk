// Likvidační mapa Hyperliquidu: server (server/likvidace.mjs) sem každých
// 10 min pošle nové řádky, po částech (nejvýš 35 zápisů — limit 50 dotazů
// D1 na volání bezplatného tarifu). Jen s WATCHER_TOKEN (_middleware.js).
//
// POST { radky: [{ c, h, d }], kompakt: [{ c, h, d }], info, uklid }
//   radky   — minutové řádky, připojí se na konec hodiny coinu
//   kompakt — hotová hodina po 15 min (nahradí)
//   uklid   — smazat minutové starší 3 dní a čtvrthodinové starší 90 dní
// GET — stav sběru a velikost dat (kontrola provozu, testy).

import { setrit } from '../../../lib/d1.js';

const HOD = 3600000;
const platny = (r) => r && typeof r.c === 'string' && r.c.length <= 40
  && Number.isInteger(r.h) && r.h % HOD === 0 && typeof r.d === 'string' && r.d.length <= 1e6;

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const prikazy = [];
  // Úsporný režim: do půlnoci UTC se do mapy nezapisuje nic (ani hodinové
  // dávky — rezerva limitu zápisů byla moc těsná), stav ani úklid.
  const usporne = setrit();
  // Řádky téhož coinu a hodiny spojit — jeden zápis místo několika.
  const spojene = new Map();
  for (const r of Array.isArray(d.radky) ? d.radky : []) {
    if (!platny(r)) continue;
    const k = `${r.c}|${r.h}`;
    spojene.set(k, { c: r.c, h: r.h, d: (spojene.get(k)?.d || '') + r.d });
  }
  for (const r of usporne ? [] : spojene.values()) {
    prikazy.push(env.LIQ.prepare(`INSERT INTO liq_hodiny (coin, rozliseni, hodina, data) VALUES (?, 1, ?, ?)
        ON CONFLICT (coin, rozliseni, hodina) DO UPDATE SET data = data || excluded.data`).bind(r.c, r.h, r.d));
  }
  for (const r of !usporne && Array.isArray(d.kompakt) ? d.kompakt : []) {
    if (!platny(r)) continue;
    prikazy.push(env.LIQ.prepare('INSERT OR REPLACE INTO liq_hodiny (coin, rozliseni, hodina, data) VALUES (?, 15, ?, ?)')
      .bind(r.c, r.h, r.d));
  }
  const ted = Date.now();
  // Server posílá dávku po částech (2026-11-08); stav nese jen poslední.
  if (!usporne && d.info) prikazy.push(env.LIQ.prepare('INSERT OR REPLACE INTO liq_stav (id, seen_at, info) VALUES (1, ?, ?)')
    .bind(ted, JSON.stringify(d.info || {}).slice(0, 4000)));
  if (d.uklid && !usporne) {
    prikazy.push(env.LIQ.prepare('DELETE FROM liq_hodiny WHERE rozliseni = 1 AND hodina < ?').bind(ted - 3 * 24 * HOD));
    prikazy.push(env.LIQ.prepare('DELETE FROM liq_hodiny WHERE rozliseni = 15 AND hodina < ?').bind(ted - 90 * 24 * HOD));
  }
  if (prikazy.length) await env.LIQ.batch(prikazy);
  return Response.json({ ok: true, zapsano: prikazy.length });
}

export async function onRequestGet({ env }) {
  const s = await env.LIQ.prepare('SELECT seen_at, info FROM liq_stav WHERE id = 1').first();
  const v = await env.LIQ.prepare(`SELECT rozliseni, COUNT(*) AS radku, SUM(LENGTH(data)) AS bajtu,
      COUNT(DISTINCT coin) AS coinu, MIN(hodina) AS od FROM liq_hodiny GROUP BY rozliseni`).all();
  return Response.json({ ok: true, seenAt: s?.seen_at || null, info: s ? JSON.parse(s.info) : null, data: v.results });
}
