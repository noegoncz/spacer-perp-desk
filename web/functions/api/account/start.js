// Přihlášení, krok 1: pošle na e-mail šestimístný kód.
//
// Odpověď je stejná, ať účet existuje, nebo ne — nesmí se z ní dát
// zjistit, kdo PerpyX používá. Nový kód nejdřív po minutě a celkový
// strop za hodinu, ať nejde přes nás zasypat cizí schránky poštou.

import {
  json, otisk, kod6, EMAIL, ted, mailSKodem, KODU_ZA_DEN, CHYB_ZA_DEN,
} from '../../../lib/ucet.js';
import { posliPostu } from '../../../lib/spolecne.js';

const ZNOVU_ZA = 60e3;
const PLATNOST = 10 * 60e3;
const STROP_ZA_HODINU = 300;
// Testovací adresy (neexistující doména): kód se místo e-mailu vrátí
// v odpovědi — ale jen s tajným klíčem AUTH_TEST_KEY, který má jen test.
const TESTOVACI = '@test.perpyx.invalid';

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json(request, { ok: false, error: 'invalid-request' }, 400);
  }
  const email = String(data.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return json(request, { ok: false, error: 'invalid-email' }, 400);
  }

  const test = email.endsWith(TESTOVACI) && Boolean(env.AUTH_TEST_KEY)
    && request.headers.get('X-Test-Key') === env.AUTH_TEST_KEY;
  if (email.endsWith(TESTOVACI) && !test) return json(request, { ok: false, error: 'invalid-email' }, 400);

  const predchozi = await env.DB.prepare('SELECT created_at FROM login_codes WHERE email = ?').bind(email).first();
  if (predchozi && Date.now() - new Date(predchozi.created_at) < ZNOVU_ZA && !test) {
    return json(request, { ok: true, wait: true });
  }
  const zaHodinu = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE created_at > ?')
    .bind(new Date(Date.now() - 3600e3).toISOString()).first();
  if (zaHodinu.n > STROP_ZA_HODINU) return json(request, { ok: false, error: 'busy' }, 429);

  // Denní strop kódů na e-mail (web/migrations/0005_login_limity.sql).
  const den = ted().slice(0, 10);
  const limit = await env.DB.prepare('SELECT codes, failures FROM login_limits WHERE email = ? AND day = ?')
    .bind(email, den).first();
  if (limit && (limit.codes >= KODU_ZA_DEN || limit.failures >= CHYB_ZA_DEN)) {
    return json(request, { ok: false, error: 'limit-today' }, 429);
  }
  await env.DB.prepare(`INSERT INTO login_limits (email, day, codes) VALUES (?, ?, 1)
      ON CONFLICT(email, day) DO UPDATE SET codes = codes + 1`).bind(email, den).run();

  const kod = kod6();
  await env.DB.prepare(`INSERT INTO login_codes (email, code_hash, created_at, expires_at, attempts)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
        expires_at = excluded.expires_at, attempts = 0`)
    .bind(email, await otisk(`${email}:${kod}`), ted(), new Date(Date.now() + PLATNOST).toISOString()).run();

  if (test) return json(request, { ok: true, testCode: kod });
  try {
    await posliPostu(env, { komu: email, ...mailSKodem(kod) });
  } catch (e) {
    console.error('login mail', e);
    return json(request, { ok: false, error: 'mail-failed' }, 502);
  }
  return json(request, { ok: true });
}
