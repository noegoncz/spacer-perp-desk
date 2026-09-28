// Odhlášení tokenem. Dvě cesty:
//  * stránka /unsubscribe pošle JSON { t },
//  * poštovní klient pošle „List-Unsubscribe=One-Click" s tokenem v adrese
//    (RFC 8058) — bez hlavičky Origin, proto se tady původ nekontroluje;
//    token sám je dostatečné oprávnění.

import { odpoved, platnyToken } from '../../lib/spolecne.js';

export async function onRequestPost({ request, env }) {
  let t = new URL(request.url).searchParams.get('t');
  if (!t && (request.headers.get('Content-Type') || '').includes('application/json')) {
    try {
      t = (await request.json()).t;
    } catch { /* prázdné tělo */ }
  }
  if (!platnyToken(t)) return odpoved({ ok: false, error: 'This link is not valid.' }, 400);

  await env.DB.prepare(`UPDATE subscribers SET status = 'unsubscribed',
      unsubscribed_at = ? WHERE token = ? AND status != 'unsubscribed'`)
    .bind(new Date().toISOString(), t).run();
  // I neznámý nebo už odhlášený token dopadne „ok" — výsledek je stejný:
  // tahle adresa od nás nic nedostane.
  return odpoved({ ok: true });
}

export function onRequest() {
  return odpoved({ ok: false, error: 'Method not allowed.' }, 405);
}
