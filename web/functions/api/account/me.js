// Stav účtu: e-mail a poslední záloha.
import { json, ucetZPozadavku, neprihlasen } from '../../../lib/ucet.js';

export async function onRequestGet({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const posledni = await env.DB.prepare(
    'SELECT version, created_at, size FROM backups WHERE account_id = ? ORDER BY version DESC LIMIT 1',
  ).bind(ucet.id).first();
  return json(request, { ok: true, email: ucet.email, created: ucet.vytvoren, backup: posledni || null });
}
