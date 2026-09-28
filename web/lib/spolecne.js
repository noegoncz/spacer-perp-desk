// Společné pro funkce webu: odpovědi, token a odesílání pošty přes Resend.

export const WEB = 'https://perpyx.com';
export const ODESILATEL = 'PerpyX <hello@perpyx.com>';
export const ODPOVED_NA = 'hello@perpyx.com';
export const VERZE_SOUHLASU = '2026-09-28';

const hlavicky = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
export const odpoved = (telo, status = 200) =>
  new Response(JSON.stringify(telo), { status, headers: hlavicky });

/** Jen z naší stránky — cizí formulář by sem jinak mohl posílat za návštěvníka. */
export function ciziPuvod(request) {
  const puvod = request.headers.get('Origin');
  return Boolean(puvod) && new URL(puvod).host !== new URL(request.url).host;
}

/** 32 náhodných bajtů jako hex — neuhodnutelné, jde do odkazu v e-mailu. */
export function novyToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const platnyToken = (t) => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t);

/**
 * Odešle e-mail přes Resend. Bez klíče (RESEND_API_KEY) vrátí false
 * a nic neodešle — přihláška se pak uloží, ale potvrzení nepřijde.
 */
export async function posliPostu(env, { komu, predmet, html, text, hlavickyMailu }) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ODESILATEL, to: [komu], reply_to: ODPOVED_NA,
      subject: predmet, html, text, headers: hlavickyMailu,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Potvrzovací e-mail. Světlý vzhled — tmavý v poštovních klientech často nedrží. */
export function potvrzovaciMail(token) {
  const odkaz = `${WEB}/confirm?t=${token}`;
  const odhlasit = `${WEB}/unsubscribe?t=${token}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d1420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px">
<tr><td style="padding-bottom:24px;font-size:22px;font-weight:800;letter-spacing:0.2px">Perpy<span style="color:#7c5cff">X</span></td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">Confirm your email</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:16px">Someone — hopefully you — asked to join the PerpyX beta with this address. Confirm it and we'll invite you when the next beta round opens.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:28px">PerpyX is a read-only Android app for monitoring Bybit perpetual positions: live PnL, stop-loss and take-profit levels, funding and price alarms. Beta testers get early access and a direct line to shape what comes next. We'll only email you about the beta and major updates.</td></tr>
<tr><td style="padding-bottom:28px"><a href="${esc(odkaz)}" style="display:inline-block;background:#6d5cff;background-image:linear-gradient(135deg,#22d3ee,#7c5cff);color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 26px;border-radius:12px">Confirm my email</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b7788;padding-bottom:20px">Or open this link: <a href="${esc(odkaz)}" style="color:#5b4ee0;word-break:break-all">${esc(odkaz)}</a></td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3b4656;border-top:1px solid #e6e9ef;padding-top:20px">Didn't sign up? Just ignore this email — you won't hear from us, and the address is deleted after 30 days.</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="font-size:12px;line-height:1.6;color:#8a95a5;padding:18px 8px;text-align:center">
PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a> · <a href="${esc(odhlasit)}" style="color:#8a95a5">Unsubscribe</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `Confirm your email

Someone — hopefully you — asked to join the PerpyX beta with this address.
Confirm it and we'll invite you when the next beta round opens:

${odkaz}

PerpyX is a read-only Android app for monitoring Bybit perpetual positions:
live PnL, stop-loss and take-profit levels, funding and price alarms. Beta
testers get early access and a direct line to shape what comes next. We'll
only email you about the beta and major updates.

Didn't sign up? Just ignore this email — you won't hear from us, and the
address is deleted after 30 days.

PerpyX · Roman Spacek, Czech Republic · ${WEB}/privacy
Unsubscribe: ${odhlasit}`;
  return {
    predmet: 'Confirm your PerpyX beta signup',
    html,
    text,
    // Odhlášení jedním klepnutím přímo z poštovního klienta (RFC 8058).
    hlavickyMailu: {
      'List-Unsubscribe': `<${WEB}/api/unsubscribe?t=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** Kam jdou upozornění pro provozovatele — přeposílá se na jeho Gmail
 *  (Email Routing), takže osobní adresa nemusí být ve veřejném repu. */
export const SPRAVCE = 'hello@perpyx.com';

/** Uvítání po potvrzení: potvrzuje, že je zájemce na seznamu, a co čekat. */
export function uvitaciMail(token) {
  const odhlasit = `${WEB}/unsubscribe?t=${token}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d1420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px">
<tr><td style="padding-bottom:24px;font-size:22px;font-weight:800;letter-spacing:0.2px">Perpy<span style="color:#7c5cff">X</span></td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">You're on the beta list</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:16px">Thanks for confirming your email. We'll write to you when the next beta round opens, with a download link and a short guide to getting started.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:16px">What you'll need: an Android phone and a <strong>read-only</strong> Bybit API key. PerpyX never asks for trading or withdrawal permissions, and your key stays on your phone.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:8px">Questions or ideas? Just reply to this email — it comes straight to the developer.</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="font-size:12px;line-height:1.6;color:#8a95a5;padding:18px 8px;text-align:center">
PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a> · <a href="${esc(odhlasit)}" style="color:#8a95a5">Unsubscribe</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `You're on the beta list

Thanks for confirming your email. We'll write to you when the next beta
round opens, with a download link and a short guide to getting started.

What you'll need: an Android phone and a read-only Bybit API key. PerpyX
never asks for trading or withdrawal permissions, and your key stays on
your phone.

Questions or ideas? Just reply to this email — it comes straight to the
developer.

PerpyX · Roman Spacek, Czech Republic · ${WEB}/privacy
Unsubscribe: ${odhlasit}`;
  return {
    predmet: "You're on the PerpyX beta list",
    html,
    text,
    hlavickyMailu: {
      'List-Unsubscribe': `<${WEB}/api/unsubscribe?t=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** Upozornění pro provozovatele (česky, jen pro něj). */
export function upozorneniSpravci(email, pocet) {
  const text = `Nový potvrzený zájemce o betu: ${email}
Potvrzených celkem: ${pocet}

Seznam: Cloudflare → Storage & databases → D1 → perpyx-web → subscribers`;
  return {
    predmet: `PerpyX beta: nový zájemce (${pocet})`,
    html: `<pre style="font-family:inherit;font-size:15px">${esc(text)}</pre>`,
    text,
  };
}
