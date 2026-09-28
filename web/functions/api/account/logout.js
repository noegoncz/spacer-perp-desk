// Odhlášení: zruší jen relaci tohoto zařízení.
import { json, ucetZPozadavku, neprihlasen } from '../../../lib/ucet.js';

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(ucet.tokenHash).run();
  return json(request, { ok: true });
}
