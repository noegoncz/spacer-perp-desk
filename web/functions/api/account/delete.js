// Smazání účtu i se všemi daty (zálohy, aktivita, relace). Nevratné.
import { json, ucetZPozadavku, neprihlasen } from '../../../lib/ucet.js';

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM backups WHERE account_id = ?').bind(ucet.id),
    env.DB.prepare('DELETE FROM activity WHERE account_id = ?').bind(ucet.id),
    env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(ucet.id),
    env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(ucet.id),
  ]);
  return json(request, { ok: true });
}
