// Hlídač hlásí zaznění alarmu (a neplatné push tokeny, které Firebase odmítl).
// POST { account, id, at, repeat, invalidTokens: [...] }
export async function onRequestPost({ request, env }) {
  let d;
  try {
    d = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const prikazy = [];
  if (d.account && d.id) {
    prikazy.push(env.DB.prepare(`UPDATE alarms SET fired_at = ?, active = CASE WHEN ? THEN active ELSE 0 END
        WHERE account_id = ? AND id = ?`).bind(Number(d.at) || Date.now(), d.repeat ? 1 : 0, d.account, d.id));
  }
  for (const t of (d.invalidTokens || []).slice(0, 50)) {
    prikazy.push(env.DB.prepare('DELETE FROM push_tokens WHERE token = ?').bind(String(t)));
  }
  if (prikazy.length) await env.DB.batch(prikazy);
  return Response.json({ ok: true });
}
