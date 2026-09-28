// Seznam verzí cloudové zálohy (posledních 30 dní), nejnovější první.
import { json, ucetZPozadavku, neprihlasen } from '../../../lib/ucet.js';

export async function onRequestGet({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const { results } = await env.DB.prepare(
    'SELECT version, created_at, size FROM backups WHERE account_id = ? ORDER BY version DESC LIMIT 200',
  ).bind(ucet.id).all();
  return json(request, { ok: true, versions: results });
}
