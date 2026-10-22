// Zdi v knize příkazů: server (server/zdi.mjs) sem každou minutu pošle
// stav. Jen s WATCHER_TOKEN (_middleware.js).
//
// POST { t, ted, historie: [{ k, den, d }], info, uklid }
//   ted       — JSON živých a nedávno hotových zdí všech trhů (přepíše)
//   historie  — hotové zdi za poslední hodinu, připojí se k řádku trh × den
//   uklid     — smazat historii starší 30 dní a žádosti starší 7 dní
// GET — trhy, o které si řekla aplikace (posledních 7 dní), a stav sběru.

const DEN = 86400000;
const platna = (h) => h && typeof h.k === 'string' && h.k.length <= 60 && Number.isInteger(h.den)
  && h.den % DEN === 0 && typeof h.d === 'string' && h.d.length <= 5e5;

export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (typeof d.ted !== 'string' || d.ted.length > 1.8e6 || !Number.isFinite(d.t)) return Response.json({ ok: false }, { status: 400 });
  const prikazy = [env.LIQ.prepare('INSERT OR REPLACE INTO zdi_stav (id, t, data, info) VALUES (1, ?, ?, ?)')
    .bind(d.t, d.ted, JSON.stringify(d.info || {}).slice(0, 4000))];
  for (const h of Array.isArray(d.historie) ? d.historie : []) {
    if (!platna(h)) continue;
    prikazy.push(env.LIQ.prepare(`INSERT INTO zdi_dny (klic, den, data) VALUES (?, ?, ?)
        ON CONFLICT (klic, den) DO UPDATE SET data = data || excluded.data`).bind(h.k, h.den, h.d));
  }
  if (d.uklid) {
    const ted = Date.now();
    prikazy.push(env.LIQ.prepare('DELETE FROM zdi_dny WHERE den < ?').bind(ted - 30 * DEN));
    prikazy.push(env.LIQ.prepare('DELETE FROM zdi_zadosti WHERE cas < ?').bind(ted - 7 * DEN));
  }
  await env.LIQ.batch(prikazy);
  return Response.json({ ok: true, zapsano: prikazy.length });
}

export async function onRequestGet({ env }) {
  const z = await env.LIQ.prepare('SELECT klic FROM zdi_zadosti WHERE cas > ? ORDER BY cas DESC LIMIT 200')
    .bind(Date.now() - 7 * DEN).all();
  const s = await env.LIQ.prepare('SELECT t, info, LENGTH(data) AS bajtu FROM zdi_stav WHERE id = 1').first();
  const v = await env.LIQ.prepare('SELECT COUNT(*) AS radku, SUM(LENGTH(data)) AS bajtu, COUNT(DISTINCT klic) AS trhu, MIN(den) AS od FROM zdi_dny').first();
  return Response.json({
    ok: true, zadosti: z.results.map((x) => x.klic),
    t: s?.t || null, info: s ? JSON.parse(s.info) : null, stavBajtu: s?.bajtu || 0, historie: v,
  });
}
