// Cloudová záloha: PUT uloží novou verzi, GET vrátí poslední (nebo ?version=).
//
// Záloha má stejný tvar jako soubor zálohy (js/zaloha.js) a nikdy v ní
// nejsou API klíče — pro jistotu se tu klíče z dat ještě odfiltrují.
// Stejná data jako poslední verze se znovu neukládají.

import { json, otisk, ucetZPozadavku, neprihlasen, ted } from '../../../lib/ucet.js';

const MAX = 900 * 1024;
const DRZET_DNI = 30;
const ZAKAZANE = ['perpdesk.apiKey', 'perpdesk.apiSecret', 'perpdesk.session'];

export async function onRequestPut({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const text = await request.text();
  if (text.length > MAX) return json(request, { ok: false, error: 'too-large' }, 413);
  let zaloha;
  try {
    zaloha = JSON.parse(text);
  } catch {
    return json(request, { ok: false, error: 'invalid-request' }, 400);
  }
  if (zaloha?.aplikace !== 'PerpyX' || !zaloha.data || typeof zaloha.data !== 'object') {
    return json(request, { ok: false, error: 'not-a-backup' }, 400);
  }
  for (const k of ZAKAZANE) delete zaloha.data[k];
  const data = JSON.stringify(zaloha);
  // Otisk jen z dat, ne z času vytvoření — jinak by se každá záloha lišila.
  const hash = await otisk(JSON.stringify(zaloha.data));

  const posledni = await env.DB.prepare(
    'SELECT version, hash, created_at FROM backups WHERE account_id = ? ORDER BY version DESC LIMIT 1',
  ).bind(ucet.id).first();
  if (posledni?.hash === hash) {
    return json(request, { ok: true, version: posledni.version, created: posledni.created_at, unchanged: true });
  }
  const verze = (posledni?.version || 0) + 1;
  const kdy = ted();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO backups (account_id, version, created_at, size, hash, data)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(ucet.id, verze, kdy, data.length, hash, data),
    // Starší než 30 dní pryč — poslední verze zůstává vždycky.
    env.DB.prepare('DELETE FROM backups WHERE account_id = ? AND created_at < ? AND version < ?')
      .bind(ucet.id, new Date(Date.now() - DRZET_DNI * 86400e3).toISOString(), verze),
  ]);
  return json(request, { ok: true, version: verze, created: kdy });
}

export async function onRequestGet({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const verze = Number(new URL(request.url).searchParams.get('version')) || null;
  const radek = verze
    ? await env.DB.prepare('SELECT version, created_at, data FROM backups WHERE account_id = ? AND version = ?')
      .bind(ucet.id, verze).first()
    : await env.DB.prepare('SELECT version, created_at, data FROM backups WHERE account_id = ? ORDER BY version DESC LIMIT 1')
      .bind(ucet.id).first();
  if (!radek) return json(request, { ok: false, error: 'no-backup' }, 404);
  return json(request, { ok: true, version: radek.version, created: radek.created_at, backup: JSON.parse(radek.data) });
}
