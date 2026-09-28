// Potvrzení přihlášky tokenem z e-mailu.
//
// ⚠ Jen POST ze stránky /confirm (tlačítkem), ne rovnou GET z odkazu.
// Poštovní filtry a náhledy odkazy v e-mailech samy otevírají — potvrzení
// přes GET by tak proběhlo bez člověka a double opt-in by nic neznamenal.

import { odpoved, ciziPuvod, platnyToken } from '../../lib/spolecne.js';

export async function onRequestPost({ request, env }) {
  if (ciziPuvod(request)) return odpoved({ ok: false, error: 'Forbidden.' }, 403);
  let t;
  try {
    t = (await request.json()).t;
  } catch {
    return odpoved({ ok: false, error: 'Invalid request.' }, 400);
  }
  if (!platnyToken(t)) return odpoved({ ok: false, error: 'This link is not valid.' }, 400);

  const radek = await env.DB.prepare('SELECT status FROM subscribers WHERE token = ?').bind(t).first();
  if (!radek) {
    return odpoved({ ok: false, error: 'This link has expired or is not valid. Please sign up again.' }, 404);
  }
  if (radek.status !== 'confirmed') {
    await env.DB.prepare(`UPDATE subscribers SET status = 'confirmed', confirmed_at = ?,
        unsubscribed_at = NULL WHERE token = ?`).bind(new Date().toISOString(), t).run();
  }
  return odpoved({ ok: true });
}

export function onRequest() {
  return odpoved({ ok: false, error: 'Method not allowed.' }, 405);
}
