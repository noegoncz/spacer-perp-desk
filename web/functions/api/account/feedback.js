// Hlášení z aplikace během bety: problém nebo nápad, text, až 3 screenshoty
// a technické údaje (verze, telefon, obrazovka, poslední chyba).
//
// Přijde e-mailem na hello@perpyx.com (Email Routing ho přepošle do Gmailu
// provozovatele) se screenshoty v příloze; „Odpovědět" jde rovnou uživateli.
// Screenshoty se neukládají, jen text a údaje (kvůli přehledu a limitu).

import { json, ucetZPozadavku, neprihlasen, ted } from '../../../lib/ucet.js';
import { posliPostu, SPRAVCE } from '../../../lib/spolecne.js';

const ZA_DEN = 10;
const MAX_OBRAZKU = 3;
const MAX_OBRAZEK = 1.5 * 1024 * 1024;     // base64 jednoho zmenšeného snímku
const MAX_TEXT = 5000;
const TESTOVACI = '@test.perpyx.invalid';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  let d;
  try {
    d = await request.json();
  } catch {
    return json(request, { ok: false, error: 'invalid-request' }, 400);
  }
  const druh = d.kind === 'idea' ? 'idea' : 'problem';
  const zprava = String(d.message || '').trim().slice(0, MAX_TEXT);
  const obrazky = (Array.isArray(d.images) ? d.images : []).slice(0, MAX_OBRAZKU)
    .filter((o) => typeof o === 'string' && /^[A-Za-z0-9+/=]+$/.test(o) && o.length <= MAX_OBRAZEK);
  if (!zprava && !obrazky.length) return json(request, { ok: false, error: 'empty' }, 400);
  // Technické údaje — jen známá pole, krátká; nic jiného se neukládá.
  const i = d.info && typeof d.info === 'object' ? d.info : {};
  const info = {};
  for (const k of ['version', 'build', 'device', 'screen', 'lang', 'view', 'exchange', 'lastError', 'push', 'lock']) {
    if (i[k] != null) info[k] = String(i[k]).slice(0, 300);
  }

  const den = ted().slice(0, 10);
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE account_id = ? AND created_at >= ?')
    .bind(ucet.id, den).first();
  if (n >= ZA_DEN) return json(request, { ok: false, error: 'limit-today' }, 429);

  await env.DB.prepare(`INSERT INTO feedback (account_id, created_at, kind, message, info, images)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(ucet.id, ted(), druh, zprava, JSON.stringify(info), obrazky.length).run();

  // Testovací účty (automatický test) e-mail neposílají.
  if (ucet.email.endsWith(TESTOVACI)) return json(request, { ok: true, test: true });

  const nazev = druh === 'idea' ? 'Nápad' : 'Problém';
  const radky = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n');
  const text = `${nazev} od ${ucet.email}\n\n${zprava || '(bez textu, jen screenshot)'}\n\n---\n${radky}`;
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;color:#0d1420">
<p style="margin:0 0 6px;color:#56657a">${nazev} z aplikace PerpyX od <b>${esc(ucet.email)}</b> · ${esc(info.version || '')}</p>
<div style="white-space:pre-wrap;font-size:16px;line-height:1.5;padding:14px 16px;background:#f3f5f9;border-radius:10px">${esc(zprava) || '<i>(bez textu, jen screenshot)</i>'}</div>
<p style="margin:14px 0 4px;color:#56657a;font-size:13px">Screenshotů: ${obrazky.length} (v příloze). Odpověď půjde přímo uživateli.</p>
<pre style="font-size:12px;color:#56657a;white-space:pre-wrap">${esc(radky)}</pre></div>`;
  try {
    await posliPostu(env, {
      komu: SPRAVCE,
      predmet: `PerpyX ${nazev.toLowerCase()}: ${(zprava || 'screenshot').slice(0, 60)}`,
      html,
      text,
      odpovedNa: ucet.email,
      prilohy: obrazky.map((content, k) => ({ filename: `screenshot-${k + 1}.jpg`, content })),
    });
  } catch (e) {
    console.error('feedback mail', e);
    return json(request, { ok: false, error: 'mail-failed' }, 502);
  }
  return json(request, { ok: true });
}
