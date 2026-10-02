// Doporučení pro přihlášeného uživatele (web/lib/ref.js).
//
//   GET  — přezdívka, odkaz, počty ve třech stupních a seznam pozvaných
//          (zamaskované e-maily), jestli jde ještě zadat zvoucího ručně.
//   PUT  { nick }  — zabrat si přezdívku (dokud ji nikdo nepoužil, jde změnit).
//   POST { code }  — ručně zadat přezdívku toho, kdo mě pozval
//                    (jen prvních pár dní po založení účtu, jednou).

import { json, ucetZPozadavku, neprihlasen, ted } from '../../../lib/ucet.js';
import { WEB } from '../../../lib/spolecne.js';
import {
  normalizuj, chybaPrezdivky, zamaskuj, zvouciPodlePrezdivky, zkontrolujAktivitu, RUCNE_DNU, AKTIVNI_DNU,
} from '../../../lib/ref.js';

const DEN = 86400e3;

async function stav(env, ucet) {
  const ja = await env.DB.prepare('SELECT ref_nick, created_at FROM accounts WHERE id = ?').bind(ucet.id).first();
  const nick = ja?.ref_nick || null;

  const aplikace = await env.DB.prepare(
    `SELECT a.email, r.joined_at, r.active_at FROM referrals r JOIN accounts a ON a.id = r.referred_id
       WHERE r.referrer_id = ? ORDER BY r.joined_at DESC`,
  ).bind(ucet.id).all();
  const vAplikaci = new Set((aplikace.results || []).map((r) => r.email));

  // Stupeň 1: zapsali se přes odkaz, ale v aplikaci ještě nejsou.
  const web = nick ? await env.DB.prepare(
    `SELECT email, created_at FROM subscribers WHERE ref = ? AND status != 'unsubscribed'
       ORDER BY created_at DESC LIMIT 200`,
  ).bind(nick).all() : { results: [] };

  const lide = [
    ...(aplikace.results || []).map((r) => ({
      email: zamaskuj(r.email), stage: r.active_at ? 'active' : 'joined', since: r.active_at || r.joined_at,
    })),
    ...(web.results || []).filter((s) => !vAplikaci.has(s.email)).map((s) => ({
      email: zamaskuj(s.email), stage: 'invited', since: s.created_at,
    })),
  ];
  const pocty = { invited: 0, joined: 0, active: 0 };
  lide.forEach((l) => { pocty[l.stage] += 1; });

  const pozvan = await env.DB.prepare(
    `SELECT a.ref_nick FROM referrals r JOIN accounts a ON a.id = r.referrer_id WHERE r.referred_id = ?`,
  ).bind(ucet.id).first();
  const mladyUcet = Date.now() - new Date(ja?.created_at || 0) < RUCNE_DNU * DEN;

  return {
    ok: true,
    nick,
    link: nick ? `${WEB}/ref/${nick}` : null,
    counts: pocty,
    people: lide,
    invitedBy: pozvan?.ref_nick || null,
    canEnterCode: !pozvan && mladyUcet,
    activeDays: AKTIVNI_DNU,
  };
}

export async function onRequestGet({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  return json(request, await stav(env, ucet));
}

export async function onRequestPut({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  let nick;
  try {
    nick = normalizuj((await request.json()).nick);
  } catch {
    return json(request, { ok: false, error: 'invalid' }, 400);
  }
  const chyba = chybaPrezdivky(nick);
  if (chyba) return json(request, { ok: false, error: chyba }, 400);

  const ja = await env.DB.prepare('SELECT ref_nick FROM accounts WHERE id = ?').bind(ucet.id).first();
  if (ja?.ref_nick === nick) return json(request, await stav(env, ucet));
  // Změna jen dokud starý odkaz nikdo nepoužil — jinak by se ztratilo,
  // koho kdo pozval přes web.
  if (ja?.ref_nick) {
    const pouzity = await env.DB.prepare('SELECT 1 FROM subscribers WHERE ref = ? LIMIT 1').bind(ja.ref_nick).first();
    if (pouzity) return json(request, { ok: false, error: 'locked' }, 409);
  }
  const obsazena = await env.DB.prepare('SELECT 1 FROM accounts WHERE ref_nick = ? AND id != ?').bind(nick, ucet.id).first();
  if (obsazena) return json(request, { ok: false, error: 'taken' }, 409);
  try {
    await env.DB.prepare('UPDATE accounts SET ref_nick = ? WHERE id = ?').bind(nick, ucet.id).run();
  } catch {
    return json(request, { ok: false, error: 'taken' }, 409); // souběh: unikátní index
  }
  return json(request, await stav(env, ucet));
}

export async function onRequestPost({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  let nick;
  try {
    nick = normalizuj((await request.json()).code);
  } catch {
    return json(request, { ok: false, error: 'not-found' }, 400);
  }
  const s = await stav(env, ucet);
  if (s.invitedBy) return json(request, { ok: false, error: 'already' }, 409);
  if (!s.canEnterCode) return json(request, { ok: false, error: 'too-late' }, 409);
  const zvouci = await zvouciPodlePrezdivky(env, nick);
  if (!zvouci) return json(request, { ok: false, error: 'not-found' }, 404);
  if (zvouci.id === ucet.id) return json(request, { ok: false, error: 'self' }, 400);
  await env.DB.prepare(`INSERT OR IGNORE INTO referrals (referred_id, referrer_id, source, joined_at)
      VALUES (?, ?, 'manual', ?)`).bind(ucet.id, zvouci.id, ted()).run();
  // Dny používání před zadáním kódu se nepočítají (joined_at = teď);
  // kontrola jen pro jistotu, kdyby se pravidlo změnilo.
  await zkontrolujAktivitu(env, ucet.id);
  return json(request, await stav(env, ucet));
}
