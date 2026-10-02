// Přihláška do bety s potvrzením e-mailem (double opt-in).
//
// Uloží zájemce jako „pending" a pošle mu odkaz; na seznam patří až po
// kliknutí (api/confirm). Ukládá se jen e-mail, časy a token — žádná IP
// adresa ani země. Odpověď je pro nového, čekajícího i už potvrzeného
// zájemce stejná, aby z ní nešlo poznat, kdo na seznamu je.

import {
  odpoved, ciziPuvod, novyToken, posliPostu, potvrzovaciMail, VERZE_SOUHLASU,
} from '../../lib/spolecne.js';
import { normalizuj, zvouciPodlePrezdivky } from '../../lib/ref.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEN = 86400e3;
// Potvrzovací e-mail znovu nejdřív po deseti minutách — opakované
// odesílání formuláře nesmí nikoho zasypat poštou.
const ZNOVU_ZA = 10 * 60e3;

export async function onRequestPost({ request, env }) {
  if (ciziPuvod(request)) return odpoved({ ok: false, error: 'Forbidden.' }, 403);

  let data;
  try {
    data = await request.json();
  } catch {
    return odpoved({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Past na roboty: skryté pole, které člověk nevyplní. Robotovi se
  // tváříme, že prošel, ať nezkouší jinak.
  if (data.website) return odpoved({ ok: true });

  const email = String(data.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return odpoved({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (data.consent !== true) {
    return odpoved({ ok: false, error: 'Please tick the consent box so we can email you.' }, 400);
  }

  const ted = new Date();
  try {
    // Přezdívka z odkazu perpyx.com/ref/… — jen existující; neznámá se tiše zahodí.
    const zvouci = await zvouciPodlePrezdivky(env, normalizuj(data.ref));
    const ref = zvouci ? zvouci.ref_nick : null;

    // Nepotvrzené přihlášky starší 30 dní pryč (slibuje to i e-mail).
    await env.DB.prepare("DELETE FROM subscribers WHERE status = 'pending' AND created_at < ?")
      .bind(new Date(ted - 30 * DEN).toISOString()).run();

    const radek = await env.DB.prepare('SELECT status, token, sent_at FROM subscribers WHERE email = ?')
      .bind(email).first();
    // Kdo pozval, se zapíše jen poprvé — pozdější odkaz od někoho jiného
    // ho nepřepíše.
    if (radek && ref) {
      await env.DB.prepare('UPDATE subscribers SET ref = ? WHERE email = ? AND ref IS NULL').bind(ref, email).run();
    }
    if (radek?.status === 'confirmed') return odpoved({ ok: true });
    if (radek?.status === 'pending' && radek.sent_at && ted - new Date(radek.sent_at) < ZNOVU_ZA) {
      return odpoved({ ok: true });
    }

    const token = radek?.status === 'pending' && radek.token ? radek.token : novyToken();
    if (radek) {
      // Čekající (poslat znovu) nebo odhlášený, který se přihlašuje znovu
      // — nový souhlas, nový čas.
      await env.DB.prepare(`UPDATE subscribers SET status = 'pending', token = ?, created_at = ?,
          consent_version = ?, unsubscribed_at = NULL WHERE email = ?`)
        .bind(token, ted.toISOString(), VERZE_SOUHLASU, email).run();
    } else {
      await env.DB.prepare(`INSERT INTO subscribers (email, created_at, consent_version, status, token, ref)
          VALUES (?, ?, ?, 'pending', ?, ?)`)
        .bind(email, ted.toISOString(), VERZE_SOUHLASU, token, ref).run();
    }

    const mail = potvrzovaciMail(token);
    if (await posliPostu(env, { komu: email, ...mail })) {
      await env.DB.prepare('UPDATE subscribers SET sent_at = ? WHERE email = ?')
        .bind(ted.toISOString(), email).run();
    }
  } catch (e) {
    console.error('signup', e);
    return odpoved({ ok: false, error: 'Something went wrong. Please try again later.' }, 500);
  }
  return odpoved({ ok: true });
}

export function onRequest() {
  return odpoved({ ok: false, error: 'Method not allowed.' }, 405);
}
