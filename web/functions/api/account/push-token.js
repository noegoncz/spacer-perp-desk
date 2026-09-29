// Registrace zařízení pro push (token Firebase Cloud Messaging).
// POST { token } — přiřadí token účtu; DELETE { token } — odhlásí zařízení.
import { json, ucetZPozadavku, neprihlasen, ted } from '../../../lib/ucet.js';

async function token(request) {
  try {
    const t = String((await request.json()).token || '');
    return /^[\w:.-]{20,4096}$/.test(t) ? t : '';
  } catch {
    return '';
  }
}

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const t = await token(request);
  if (!t) return json(request, { ok: false, error: 'invalid-request' }, 400);
  // Token patří zařízení — když se na něm přihlásí jiný účet, přejde k němu.
  await env.DB.prepare(`INSERT INTO push_tokens (token, account_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at`)
    .bind(t, ucet.id, ted()).run();
  return json(request, { ok: true });
}

export async function onRequestDelete({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const t = await token(request);
  if (t) await env.DB.prepare('DELETE FROM push_tokens WHERE token = ? AND account_id = ?').bind(t, ucet.id).run();
  return json(request, { ok: true });
}
