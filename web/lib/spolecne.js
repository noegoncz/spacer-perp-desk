// Společné pro funkce webu: odpovědi, token a odesílání pošty přes Resend.

export const WEB = 'https://perpyx.com';
export const ODESILATEL = 'PerpyX <hello@perpyx.com>';
export const ODPOVED_NA = 'hello@perpyx.com';
export const VERZE_SOUHLASU = '2026-09-28';

/*
 * Burzy — všude stejná věta (web, e-maily; 2026-10-18). Další burzy
 * v pořadí podle objemu derivátů a oblíbenosti; při připojení další
 * burzy upravit tady i na webu (index.html, „Works with").
 */
export const BURZY_ZIVE = 'Bybit, Binance and Hyperliquid';
export const BURZY_DALSI = 'OKX, Bitget, Gate, MEXC and more are on the way.';
export const BURZY_POCET = 3; // kolik burz už běží (text „3 exchanges live today")

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
export async function posliPostu(env, { komu, predmet, html, text, hlavickyMailu, prilohy, odpovedNa }) {
  if (!env.RESEND_API_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: ODESILATEL, to: [komu], reply_to: odpovedNa || ODPOVED_NA,
      subject: predmet, html, text, headers: hlavickyMailu,
      // Přílohy: [{ filename, content (base64) }] — např. screenshoty z hlášení.
      attachments: prilohy,
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
<tr><td style="font-size:24px;font-weight:800;padding-bottom:12px">One click and you're in.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:22px">Someone (hopefully you) asked to join the PerpyX beta with this address. Confirm it and you're on the list for the next beta round.</td></tr>
<tr><td style="font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#7c5cff;padding-bottom:10px">Why it's worth it</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:10px"><strong style="color:#0d1420">Early access, more to play with.</strong> Beta members get extras in the app that future basic accounts won't have.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:10px"><strong style="color:#0d1420">Your voice shapes the app.</strong> Every piece of feedback you send from the app goes straight to the people building PerpyX, and the good ideas ship fast.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:26px"><strong style="color:#0d1420">Bring your crew.</strong> Once you confirm, you get your own invite link. Challenge your trading friends, near and far, to join you. The more of them who come along, the sooner you're in, and early supporters will be properly rewarded.</td></tr>
<tr><td style="padding-bottom:26px"><a href="${esc(odkaz)}" style="display:inline-block;background:#6d5cff;background-image:linear-gradient(135deg,#22d3ee,#7c5cff);color:#ffffff;text-decoration:none;font-weight:700;font-size:17px;padding:15px 30px;border-radius:12px">Confirm my spot</a></td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3b4656;padding-bottom:22px;background:#f6f4ff;border-radius:12px;padding:14px 16px"><strong style="color:#0d1420">${BURZY_POCET} exchanges live today</strong> — ${BURZY_ZIVE}. ${BURZY_DALSI} PerpyX keeps an eye on your perpetual positions: live PnL, stop-loss and take-profit levels, funding and price alerts that reach you even with the screen off.</td></tr>
<tr><td style="height:20px;line-height:20px">&nbsp;</td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#6b7788;padding-bottom:20px">Or open this link: <a href="${esc(odkaz)}" style="color:#5b4ee0;word-break:break-all">${esc(odkaz)}</a></td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#3b4656;border-top:1px solid #e6e9ef;padding-top:20px">Didn't sign up? Just ignore this email — you won't hear from us, and the address is deleted after 30 days.</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="font-size:12px;line-height:1.6;color:#8a95a5;padding:18px 8px;text-align:center">
PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a> · <a href="${esc(odhlasit)}" style="color:#8a95a5">Unsubscribe</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `One click and you're in.

Someone (hopefully you) asked to join the PerpyX beta with this address.
Confirm it and you're on the list for the next beta round:

${odkaz}

Why it's worth it
- Early access, more to play with. Beta members get extras in the app that
  future basic accounts won't have.
- Your voice shapes the app. Every piece of feedback you send from the app
  goes straight to the people building PerpyX, and the good ideas ship fast.
- Bring your crew. Once you confirm, you get your own invite link. Challenge
  your trading friends, near and far, to join you. The more of them who come
  along, the sooner you're in, and early supporters will be properly rewarded.

${BURZY_POCET} exchanges live today — ${BURZY_ZIVE}. ${BURZY_DALSI}
PerpyX keeps an eye on your perpetual positions: live PnL, stop-loss and
take-profit levels, funding and price alerts that reach you even with the
screen off.

Didn't sign up? Just ignore this email — you won't hear from us, and the
address is deleted after 30 days.

PerpyX · Roman Spacek, Czech Republic · ${WEB}/privacy
Unsubscribe: ${odhlasit}`;
  return {
    predmet: 'Confirm your spot in the PerpyX beta 🚀',
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

/**
 * Uvítání po potvrzení: potvrzuje, že je zájemce na seznamu, a co čekat.
 * `nick` = jeho odkaz pro přátele (perpyx.com/ref/<nick>) do P.S.
 */
export function uvitaciMail(token, nick = null) {
  const odhlasit = `${WEB}/unsubscribe?t=${token}`;
  const odkaz = nick ? `${WEB}/ref/${nick}` : null;
  const ps = odkaz
    ? `<tr><td style="font-size:14px;line-height:1.6;color:#3b4656;border-top:1px solid #e6e9ef;padding-top:18px">P.S. Know someone who trades perps? Your link: <a href="${esc(odkaz)}" style="color:#5b4ee0">${esc(odkaz.replace('https://', ''))}</a> — friends who join with it help you get in sooner. If PerpyX takes off, and we believe it will, early supporters will be properly rewarded.</td></tr>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d1420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px">
<tr><td style="padding-bottom:24px;font-size:22px;font-weight:800;letter-spacing:0.2px">Perpy<span style="color:#7c5cff">X</span></td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:12px">You're on the beta list</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:16px">Thanks for confirming your email. We'll write to you when the next beta round opens, with a download link and a short guide to getting started.</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:16px">What you'll need: an Android phone and an account on ${BURZY_ZIVE.replace(' and ', ' or ')}. PerpyX never asks for trading or withdrawal permissions, and your keys stay on your phone. ${BURZY_DALSI}</td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:16px">Questions or ideas? Just reply to this email — it goes straight to the people building PerpyX. Inside the app there's a feedback button on every screen, so you can send a note or a screenshot the moment something bugs you. That's how PerpyX keeps getting better for everyone.</td></tr>
${ps}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="font-size:12px;line-height:1.6;color:#8a95a5;padding:18px 8px;text-align:center">
PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a> · <a href="${esc(odhlasit)}" style="color:#8a95a5">Unsubscribe</a>
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `You're on the beta list

Thanks for confirming your email. We'll write to you when the next beta
round opens, with a download link and a short guide to getting started.

What you'll need: an Android phone and an account on ${BURZY_ZIVE.replace(' and ', ' or ')}.
PerpyX never asks for trading or withdrawal permissions, and your keys stay
on your phone. ${BURZY_DALSI}

Questions or ideas? Just reply to this email — it goes straight to the
people building PerpyX. Inside the app there's a feedback button on every
screen, so you can send a note or a screenshot the moment something bugs
you. That's how PerpyX keeps getting better for everyone.
${odkaz ? `
P.S. Know someone who trades perps? Your link: ${odkaz}
Friends who join with it help you get in sooner. If PerpyX takes off, and we
believe it will, early supporters will be properly rewarded.
` : ''}
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

/**
 * Zvoucímu: přítel se přes jeho odkaz zapsal a potvrdil e-mail (nejvýš
 * jednou denně, viz api/confirm). `token` = jeho přihláška na webu kvůli
 * odhlášení; účet bez přihlášky ho nemá.
 */
export function pratelMail(pocet, token = null) {
  const odhlasit = token ? `${WEB}/unsubscribe?t=${token}` : null;
  const pata = odhlasit
    ? `PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a> · <a href="${esc(odhlasit)}" style="color:#8a95a5">Unsubscribe</a>`
    : `PerpyX · Roman Spacek, Czech Republic · <a href="${WEB}/privacy" style="color:#8a95a5">Privacy</a> · You get this because you shared your PerpyX link.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0d1420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:36px 32px">
<tr><td style="padding-bottom:24px;font-size:22px;font-weight:800;letter-spacing:0.2px">Perpy<span style="color:#7c5cff">X</span></td></tr>
<tr><td style="font-size:16px;line-height:1.6;color:#3b4656;padding-bottom:14px">Someone joined the PerpyX beta waitlist with your link. Thanks for spreading the word — it means a lot for a small project like this.</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#6b7788">Friends who joined with your link so far: <strong style="color:#0d1420">${Number(pocet) || 1}</strong></td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="font-size:12px;line-height:1.6;color:#8a95a5;padding:18px 8px;text-align:center">
${pata}
</td></tr></table>
</td></tr></table></body></html>`;
  const text = `Someone joined the PerpyX beta waitlist with your link. Thanks for
spreading the word — it means a lot for a small project like this.

Friends who joined with your link so far: ${Number(pocet) || 1}

PerpyX · Roman Spacek, Czech Republic · ${WEB}/privacy${odhlasit ? `
Unsubscribe: ${odhlasit}` : ''}`;
  return {
    predmet: 'A friend joined the PerpyX waitlist',
    html,
    text,
    ...(token ? { hlavickyMailu: {
      'List-Unsubscribe': `<${WEB}/api/unsubscribe?t=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    } } : {}),
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
