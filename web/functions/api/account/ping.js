// Denní aktivita: jeden řádek na účet a den (+ verze aplikace).
// Z toho se počítají aktivní uživatelé a retence — nic dalšího se neukládá.
import { json, ucetZPozadavku, neprihlasen, ted } from '../../../lib/ucet.js';

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  let verze = '';
  try {
    verze = String((await request.json()).version || '').slice(0, 20);
  } catch { /* bez těla */ }
  const den = ted().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO activity (account_id, day, app_version) VALUES (?, ?, ?)
        ON CONFLICT(account_id, day) DO UPDATE SET app_version = excluded.app_version`)
      .bind(ucet.id, den, verze),
    env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(ted(), ucet.id),
  ]);
  return json(request, { ok: true });
}
