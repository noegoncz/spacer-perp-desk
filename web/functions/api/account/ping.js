// Denní aktivita: jeden řádek na účet a den (+ verze aplikace).
// Z toho se počítají aktivní uživatelé a retence — nic dalšího se neukládá.
import { json, ucetZPozadavku, neprihlasen, ted } from '../../../lib/ucet.js';
import { zkontrolujAktivitu } from '../../../lib/ref.js';

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  let verze = '';
  let telo = {};
  try {
    telo = await request.json();
    verze = String(telo.version || '').slice(0, 20);
  } catch { /* bez těla */ }
  let den = ted().slice(0, 10);
  // Testovací účty (s tajným klíčem) smí zapsat i jiný den — test doporučení
  // potřebuje několik různých dní používání.
  const test = ucet.email.endsWith('@test.perpyx.invalid') && Boolean(env.AUTH_TEST_KEY)
    && request.headers.get('X-Test-Key') === env.AUTH_TEST_KEY;
  if (test && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(telo.day || ''))) den = telo.day;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO activity (account_id, day, app_version) VALUES (?, ?, ?)
        ON CONFLICT(account_id, day) DO UPDATE SET app_version = excluded.app_version`)
      .bind(ucet.id, den, verze),
    env.DB.prepare('UPDATE accounts SET last_seen_at = ? WHERE id = ?').bind(ted(), ucet.id),
  ]);
  try {
    await zkontrolujAktivitu(env, ucet.id);
  } catch (e) {
    console.error('referral', e);
  }
  return json(request, { ok: true });
}
