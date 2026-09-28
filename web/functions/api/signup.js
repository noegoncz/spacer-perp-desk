// Přihláška do bety: uloží e-mail do databáze D1 (vazba DB).
//
// Záměrně skoupé: jen e-mail a čas souhlasu, žádná IP adresa ani země.
// Duplicitní přihlášku tiše přijme a nic neprozradí — z odpovědi nesmí
// jít poznat, jestli už nějaký e-mail na seznamu je.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hlavicky = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const odpoved = (telo, status = 200) => new Response(JSON.stringify(telo), { status, headers: hlavicky });

export async function onRequestPost({ request, env }) {
  // Jen z naší stránky — cizí formulář by sem jinak mohl posílat za návštěvníka.
  const puvod = request.headers.get('Origin');
  if (puvod && new URL(puvod).host !== new URL(request.url).host) {
    return odpoved({ ok: false, error: 'Forbidden.' }, 403);
  }

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

  try {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO subscribers (email, created_at, consent_version) VALUES (?, ?, ?)',
    ).bind(email, new Date().toISOString(), '2026-09-28').run();
  } catch (e) {
    console.error('signup', e);
    return odpoved({ ok: false, error: 'Something went wrong. Please try again later.' }, 500);
  }
  return odpoved({ ok: true });
}

export function onRequest() {
  return odpoved({ ok: false, error: 'Method not allowed.' }, 405);
}
