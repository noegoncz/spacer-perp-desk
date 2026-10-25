// Skutečné likvidace z CEX: server (server/likvidovano.mjs) sem každou
// minutu pošle stav. Jen s WATCHER_TOKEN (_middleware.js).
//
// POST { t, ted, historie: [{ c, den, d }], info, uklid }
//   ted       — JSON záznamů od poslední hodinové dávky (přepíše)
//   historie  — hotová hodina, připojí se k řádku coin × den
//   uklid     — smazat historii starší 365 dní
// GET — stav sběru a velikost dat.

const DEN = 86400000;
const platna = (h) => h && typeof h.c === 'string' && /^[A-Z0-9]{1,30}$/.test(h.c) && Number.isInteger(h.den)
  && h.den % DEN === 0 && typeof h.d === 'string' && h.d.length <= 1e6;

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (typeof d.ted !== 'string' || d.ted.length > 1.8e6 || !Number.isFinite(d.t)) return Response.json({ ok: false }, { status: 400 });
  const prikazy = [env.LIQ.prepare('INSERT OR REPLACE INTO likvidovano_stav (id, t, data, info) VALUES (1, ?, ?, ?)')
    .bind(d.t, d.ted, JSON.stringify(d.info || {}).slice(0, 4000))];
  for (const h of Array.isArray(d.historie) ? d.historie : []) {
    if (!platna(h)) continue;
    prikazy.push(env.LIQ.prepare(`INSERT INTO likvidovano_dny (coin, den, data) VALUES (?, ?, ?)
        ON CONFLICT (coin, den) DO UPDATE SET data = data || excluded.data`).bind(h.c, h.den, h.d));
  }
  if (d.uklid) prikazy.push(env.LIQ.prepare('DELETE FROM likvidovano_dny WHERE den < ?').bind(Date.now() - 365 * DEN));
  await env.LIQ.batch(prikazy);
  return Response.json({ ok: true, zapsano: prikazy.length });
}

export async function onRequestGet({ env }) {
  const s = await env.LIQ.prepare('SELECT t, info, LENGTH(data) AS bajtu FROM likvidovano_stav WHERE id = 1').first();
  const v = await env.LIQ.prepare('SELECT COUNT(*) AS radku, SUM(LENGTH(data)) AS bajtu, COUNT(DISTINCT coin) AS coinu, MIN(den) AS od FROM likvidovano_dny').first();
  return Response.json({ ok: true, t: s?.t || null, info: s ? JSON.parse(s.info) : null, stavBajtu: s?.bajtu || 0, historie: v });
}
