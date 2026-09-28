// Společné pro účty: CORS, otisky, relace a e-mail s přihlašovacím kódem.
//
// Aplikace běží na jiném původu než perpyx.com (GitHub Pages, v APK
// později https://localhost), proto se API volá s CORS a tokenem
// v hlavičce Authorization — žádné cookies.

import { WEB } from './spolecne.js';

const POVOLENE_PUVODY = new Set([
  'https://noegoncz.github.io',   // aplikace (i APK, které ji načítá)
  'https://perpyx.com',
  'https://localhost',            // APK se zabaleným kódem (Capacitor)
  'http://localhost:8075',        // testy
  'http://localhost:8080',        // lokální vývoj
]);

export function corsHlavicky(request) {
  const puvod = request.headers.get('Origin');
  if (!puvod || !POVOLENE_PUVODY.has(puvod)) return {};
  return {
    'Access-Control-Allow-Origin': puvod,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Test-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function json(request, telo, status = 200) {
  return new Response(JSON.stringify(telo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHlavicky(request),
    },
  });
}

export async function otisk(text) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nahodneHex(bajtu = 32) {
  const b = new Uint8Array(bajtu);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Šest číslic bez zkreslení (odmítnutí hodnot nad násobkem milionu). */
export function kod6() {
  const b = new Uint32Array(1);
  do crypto.getRandomValues(b); while (b[0] >= 4294000000);
  return String(b[0] % 1000000).padStart(6, '0');
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ted = () => new Date().toISOString();

/**
 * Účet podle tokenu z hlavičky Authorization. Relace se posouvá
 * (last_used_at) — kdo aplikaci používá, zůstává přihlášený; relace
 * nepoužitá rok propadne (úklid v web/uklid.sql).
 */
export async function ucetZPozadavku(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const tokenHash = await otisk(token);
  const radek = await env.DB.prepare(
    `SELECT a.id, a.email, a.created_at, s.last_used_at FROM sessions s
       JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?`,
  ).bind(tokenHash).first();
  if (!radek) return null;
  // Zápis jen jednou za hodinu — ať každý dotaz nepíše do databáze.
  if (!radek.last_used_at || Date.now() - new Date(radek.last_used_at) > 3600e3) {
    await env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?')
      .bind(ted(), tokenHash).run();
  }
  return { id: radek.id, email: radek.email, vytvoren: radek.created_at, tokenHash };
}

export const neprihlasen = (request) => json(request, { ok: false, error: 'not-signed-in' }, 401);

/** E-mail s přihlašovacím kódem. Krátký, text i HTML, bez obrázků. */
export function mailSKodem(kod) {
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d1420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px 28px">
<tr><td style="padding-bottom:20px;font-size:22px;font-weight:800">Perpy<span style="color:#7c5cff">X</span></td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:18px">Your sign-in code for PerpyX:</td></tr>
<tr><td style="font-size:34px;font-weight:800;letter-spacing:8px;padding-bottom:18px;font-family:ui-monospace,Menlo,Consolas,monospace">${kod}</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3b4656">The code is valid for 10 minutes. You only need to sign in once on each phone — PerpyX keeps you signed in after that.</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3b4656;padding-top:14px">Didn't try to sign in? Ignore this email — nobody can sign in without the code.</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px"><tr><td style="font-size:12px;line-height:1.6;color:#8a95a5;padding:18px 8px;text-align:center">
PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `Your sign-in code for PerpyX: ${kod}

The code is valid for 10 minutes. You only need to sign in once on each
phone — PerpyX keeps you signed in after that.

Didn't try to sign in? Ignore this email — nobody can sign in without the code.

PerpyX · Roman Spacek, Czech Republic · ${WEB}/privacy`;
  return { predmet: `${kod} is your PerpyX sign-in code`, html, text };
}
