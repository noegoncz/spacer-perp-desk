// Přihlášení, krok 2: ověří kód a založí dlouhodobou relaci.
// Účet vznikne při prvním přihlášení — registrace zvlášť není.

import { json, otisk, nahodneHex, ted, CHYB_ZA_DEN } from '../../../lib/ucet.js';
import { sparujPriZalozeni } from '../../../lib/ref.js';

const POKUSU = 5;

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json(request, { ok: false, error: 'invalid-request' }, 400);
  }
  const email = String(data.email || '').trim().toLowerCase();
  const kod = String(data.code || '').replace(/\D/g, '');
  const zarizeni = String(data.device || '').slice(0, 80);

  // Denní strop špatných pokusů přes všechny kódy (0005_login_limity.sql).
  const den = ted().slice(0, 10);
  const limit = await env.DB.prepare('SELECT failures FROM login_limits WHERE email = ? AND day = ?')
    .bind(email, den).first();
  if (limit && limit.failures >= CHYB_ZA_DEN) return json(request, { ok: false, error: 'limit-today' }, 429);

  const radek = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?')
    .bind(email).first();
  if (!radek || new Date(radek.expires_at) < new Date()) {
    return json(request, { ok: false, error: 'code-expired' }, 400);
  }
  if (radek.attempts >= POKUSU) return json(request, { ok: false, error: 'too-many-attempts' }, 429);
  if (kod.length !== 6 || await otisk(`${email}:${kod}`) !== radek.code_hash) {
    await env.DB.batch([
      env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email),
      env.DB.prepare(`INSERT INTO login_limits (email, day, failures) VALUES (?, ?, 1)
          ON CONFLICT(email, day) DO UPDATE SET failures = failures + 1`).bind(email, den),
    ]);
    return json(request, { ok: false, error: 'wrong-code', left: POKUSU - radek.attempts - 1 }, 400);
  }
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();

  let ucet = await env.DB.prepare('SELECT id, created_at FROM accounts WHERE email = ?').bind(email).first();
  if (!ucet) {
    ucet = { id: nahodneHex(16), created_at: ted() };
    await env.DB.prepare('INSERT INTO accounts (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .bind(ucet.id, email, ucet.created_at, ucet.created_at).run();
    // Zapsal se na webu přes odkaz od někoho? Spárovat (stupeň 2).
    try {
      await sparujPriZalozeni(env, ucet.id, email);
    } catch (e) {
      console.error('referral', e); // přihlášení nesmí kvůli doporučení selhat
    }
  }
  const token = nahodneHex(32);
  await env.DB.prepare(`INSERT INTO sessions (token_hash, account_id, created_at, last_used_at, device)
      VALUES (?, ?, ?, ?, ?)`).bind(await otisk(token), ucet.id, ted(), ted(), zarizeni).run();
  return json(request, { ok: true, token, email, created: ucet.created_at });
}
