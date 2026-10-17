// Potvrzení přihlášky tokenem z e-mailu.
//
// ⚠ Jen POST ze stránky /confirm (tlačítkem), ne rovnou GET z odkazu.
// Poštovní filtry a náhledy odkazy v e-mailech samy otevírají — potvrzení
// přes GET by tak proběhlo bez člověka a double opt-in by nic neznamenal.

import {
  odpoved, ciziPuvod, platnyToken, posliPostu, uvitaciMail, upozorneniSpravci, pratelMail, SPRAVCE,
} from '../../lib/spolecne.js';
import { novaPrezdivkaZajemce, vlastnikOdkazu, prezdivkyEmailu } from '../../lib/ref.js';

const DEN = 86400e3;

/**
 * Zvoucímu: „přítel se zapsal" — za každého potvrzeného, ale nejvýš jeden
 * e-mail denně (přátelé z téhož dne jsou v počtu příštího e-mailu).
 */
async function oznamZvoucimu(env, ref) {
  const vlastnik = await vlastnikOdkazu(env, ref);
  if (!vlastnik) return;
  const zajemce = await env.DB.prepare('SELECT status, token FROM subscribers WHERE email = ?').bind(vlastnik.email).first();
  if (zajemce?.status === 'unsubscribed') return;
  const posledni = await env.DB.prepare('SELECT sent_at FROM ref_notices WHERE email = ?').bind(vlastnik.email).first();
  if (posledni && Date.now() - new Date(posledni.sent_at) < DEN) return;
  const nicky = await prezdivkyEmailu(env, vlastnik.email);
  if (!nicky.length) return;
  const { pocet } = await env.DB.prepare(
    `SELECT COUNT(*) AS pocet FROM subscribers WHERE status = 'confirmed' AND ref IN (${nicky.map(() => '?').join(',')})`,
  ).bind(...nicky).first();
  if (await posliPostu(env, { komu: vlastnik.email, ...pratelMail(pocet, zajemce?.token || null) })) {
    await env.DB.prepare(`INSERT INTO ref_notices (email, sent_at) VALUES (?, ?)
        ON CONFLICT(email) DO UPDATE SET sent_at = excluded.sent_at`).bind(vlastnik.email, new Date().toISOString()).run();
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (ciziPuvod(request)) return odpoved({ ok: false, error: 'Forbidden.' }, 403);
  let t;
  try {
    t = (await request.json()).t;
  } catch {
    return odpoved({ ok: false, error: 'Invalid request.' }, 400);
  }
  if (!platnyToken(t)) return odpoved({ ok: false, error: 'This link is not valid.' }, 400);

  const radek = await env.DB.prepare('SELECT email, status, ref, ref_nick FROM subscribers WHERE token = ?').bind(t).first();
  if (!radek) {
    return odpoved({ ok: false, error: 'This link has expired or is not valid. Please sign up again.' }, 404);
  }
  // Vlastní odkaz pro přátele (2026-10-18) — i pro dřív potvrzené, kteří
  // klepnou na potvrzení znovu. Když se přezdívku nepovede vyrobit,
  // potvrzení projde i tak, jen bez odkazu.
  let nick = radek.ref_nick;
  if (!nick) {
    try {
      nick = await novaPrezdivkaZajemce(env, radek.email);
      if (nick) await env.DB.prepare('UPDATE subscribers SET ref_nick = ? WHERE token = ? AND ref_nick IS NULL').bind(nick, t).run();
    } catch (e) {
      console.error('ref nick', e);
      nick = null;
    }
  }
  if (radek.status !== 'confirmed') {
    await env.DB.prepare(`UPDATE subscribers SET status = 'confirmed', confirmed_at = ?,
        unsubscribed_at = NULL WHERE token = ?`).bind(new Date().toISOString(), t).run();
    // Uvítání zájemci a upozornění provozovateli — jen při prvním potvrzení
    // (opakované klepnutí na odkaz nic dalšího neposílá). Na pozadí:
    // potvrzení nesmí čekat na poštu ani spadnout, když se odeslání nepovede.
    waitUntil((async () => {
      try {
        await posliPostu(env, { komu: radek.email, ...uvitaciMail(t, nick) });
        if (radek.ref) await oznamZvoucimu(env, radek.ref);
        const { pocet } = await env.DB.prepare(
          "SELECT COUNT(*) AS pocet FROM subscribers WHERE status = 'confirmed'").first();
        await posliPostu(env, { komu: SPRAVCE, ...upozorneniSpravci(radek.email, pocet) });
      } catch (e) {
        console.error('confirm mail', e);
      }
    })());
  }
  return odpoved({ ok: true, ref: nick || null });
}

export function onRequest() {
  return odpoved({ ok: false, error: 'Method not allowed.' }, 405);
}
