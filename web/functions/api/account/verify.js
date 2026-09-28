// Přihlášení, krok 2: ověří kód a založí dlouhodobou relaci.
// Účet vznikne při prvním přihlášení — registrace zvlášť není.

import { json, otisk, nahodneHex, ted } from '../../../lib/ucet.js';

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

  const radek = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?')
    .bind(email).first();
  if (!radek || new Date(radek.expires_at) < new Date()) {
    return json(request, { ok: false, error: 'code-expired' }, 400);
  }
  if (radek.attempts >= POKUSU) return json(request, { ok: false, error: 'too-many-attempts' }, 429);
  if (kod.length !== 6 || await otisk(`${email}:${kod}`) !== radek.code_hash) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
    return json(request, { ok: false, error: 'wrong-code', left: POKUSU - radek.attempts - 1 }, 400);
  }
  await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();

  let ucet = await env.DB.prepare('SELECT id, created_at FROM accounts WHERE email = ?').bind(email).first();
  if (!ucet) {
    ucet = { id: nahodneHex(16), created_at: ted() };
    await env.DB.prepare('INSERT INTO accounts (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)')
      .bind(ucet.id, email, ucet.created_at, ucet.created_at).run();
  }
  const token = nahodneHex(32);
  await env.DB.prepare(`INSERT INTO sessions (token_hash, account_id, created_at, last_used_at, device)
      VALUES (?, ?, ?, ?, ?)`).bind(await otisk(token), ucet.id, ted(), ted(), zarizeni).run();
  return json(request, { ok: true, token, email, created: ucet.created_at });
}
