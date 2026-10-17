// Doporučení (referraly): přezdívky, párování pozvaných a stupně.
// Schéma: web/migrations/0007_referraly.sql.

import { ted } from './ucet.js';

/**
 * Kolik různých dní musí pozvaný aplikaci použít, aby se počítal jako bod
 * (rozhodnutí uživatele 2026-10-02: 14 dní, dny nemusí jít po sobě —
 * jeden vynechaný den nemá smazat dosavadní používání).
 */
export const AKTIVNI_DNU = 14;
/** Jak dlouho po založení účtu jde ručně zadat přezdívku toho, kdo pozval. */
export const RUCNE_DNU = 7;

// 3–20 znaků: písmena, čísla, pomlčka uvnitř. Ukládá se malými písmeny.
const TVAR = /^[a-z0-9](?:[a-z0-9-]{1,18})[a-z0-9]$/;
const REZERVOVANE = new Set([
  'admin', 'administrator', 'perpyx', 'support', 'help', 'hello', 'privacy', 'root', 'team',
  'official', 'staff', 'moderator', 'mod', 'system', 'api', 'www', 'mail', 'ref', 'beta',
  'bybit', 'binance', 'okx', 'hyperliquid', 'google', 'null', 'undefined', 'test',
]);
// Hrubý filtr zjevných nadávek (podřetězce); zbytek se řeší ručně.
const SPROSTE = ['fuck', 'shit', 'cunt', 'nigg', 'fagg', 'porn', 'sex', 'kurv', 'pica', 'kokot', 'prdel', 'curak', 'hovno'];

export const normalizuj = (nick) => String(nick || '').trim().toLowerCase();

/** null = v pořádku, jinak kód chyby: 'invalid' | 'reserved'. */
export function chybaPrezdivky(nick) {
  if (!TVAR.test(nick) || nick.includes('--')) return 'invalid';
  if (REZERVOVANE.has(nick) || SPROSTE.some((s) => nick.includes(s))) return 'reserved';
  return null;
}

/**
 * ro*******.*** — první dva znaky, zbytek hvězdičky (tečky zůstanou).
 * Zvoucí podle začátku pozná svého známého; doména ani jméno vidět nejsou.
 */
export function zamaskuj(email) {
  const s = String(email || '');
  return s.slice(0, 2) + s.slice(2).replace(/[^.]/g, '*');
}

/**
 * Účet zvoucího podle přezdívky (nebo null). Přezdívka může patřit
 * i zájemci z webu (subscribers.ref_nick, 2026-10-18) — pak se hledá účet
 * se stejným e-mailem (zájemce se mezitím přihlásil v aplikaci).
 */
export async function zvouciPodlePrezdivky(env, nick) {
  if (!nick || chybaPrezdivky(nick) === 'invalid') return null;
  const ucet = await env.DB.prepare('SELECT id, ref_nick FROM accounts WHERE ref_nick = ?').bind(nick).first();
  if (ucet) return ucet;
  const z = await env.DB.prepare("SELECT email FROM subscribers WHERE ref_nick = ? AND status = 'confirmed'")
    .bind(nick).first();
  if (!z) return null;
  return env.DB.prepare('SELECT id, ref_nick FROM accounts WHERE email = ?').bind(z.email).first();
}

/**
 * Komu patří odkaz: účtu, nebo potvrzenému zájemci z webu. Vrací
 * { email, ref_nick } nebo null. Pro zápis na webu a proužek „Invited by".
 */
export async function vlastnikOdkazu(env, nick) {
  if (!nick || chybaPrezdivky(nick) === 'invalid') return null;
  const ucet = await env.DB.prepare('SELECT email, ref_nick FROM accounts WHERE ref_nick = ?').bind(nick).first();
  if (ucet) return ucet;
  return env.DB.prepare("SELECT email, ref_nick FROM subscribers WHERE ref_nick = ? AND status = 'confirmed'")
    .bind(nick).first();
}

/** Všechny přezdívky jednoho člověka (účet i přihláška na webu mají každý svou). */
export async function prezdivkyEmailu(env, email) {
  const [u, z] = await Promise.all([
    env.DB.prepare('SELECT ref_nick FROM accounts WHERE email = ?').bind(email).first(),
    env.DB.prepare('SELECT ref_nick FROM subscribers WHERE email = ?').bind(email).first(),
  ]);
  return [...new Set([u?.ref_nick, z?.ref_nick].filter(Boolean))];
}

const ZNAKY = 'abcdefghjkmnpqrstuvwxyz23456789';
const nahodne = (n) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => ZNAKY[x % ZNAKY.length]).join('');
};

/**
 * Přezdívka pro zájemce z webu: první čtyři znaky e-mailu (aby odkaz
 * poznal jako svůj) a tři náhodné — celá adresa se z odkazu poznat nedá.
 * Unikátní napříč účty i zájemci.
 */
export async function novaPrezdivkaZajemce(env, email) {
  let zaklad = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4);
  if (zaklad.length < 2) zaklad = 'px';
  for (let i = 0; i < 12; i += 1) {
    const nick = `${i < 8 ? zaklad : 'px'}-${nahodne(3)}`;
    if (chybaPrezdivky(nick)) continue;
    const obsazena = await env.DB.prepare(
      'SELECT 1 FROM accounts WHERE ref_nick = ? UNION SELECT 1 FROM subscribers WHERE ref_nick = ? LIMIT 1',
    ).bind(nick, nick).first();
    if (!obsazena) return nick;
  }
  return null;
}

/**
 * Nový účet: zapsal se na webu přes odkaz se stejným e-mailem? Pak se
 * spáruje se zvoucím (stupeň 2). Vlastní pozvánka se nepočítá.
 */
export async function sparujPriZalozeni(env, ucetId, email) {
  const prihlaska = await env.DB.prepare(
    "SELECT ref FROM subscribers WHERE email = ? AND ref IS NOT NULL AND status != 'unsubscribed'",
  ).bind(email).first();
  if (!prihlaska?.ref) return;
  const zvouci = await zvouciPodlePrezdivky(env, prihlaska.ref);
  if (zvouci && zvouci.id !== ucetId) {
    await env.DB.prepare(`INSERT OR IGNORE INTO referrals (referred_id, referrer_id, source, joined_at)
        VALUES (?, ?, 'web', ?)`).bind(ucetId, zvouci.id, ted()).run();
  }
}

/**
 * Nový účet zájemce, který už měl odkaz z webu (2026-10-18): účet převezme
 * jeho přezdívku (odkaz platí dál) a spárují se ti, kdo se přes ten odkaz
 * zapsali a v aplikaci se přihlásili dřív než on.
 */
export async function prevezmiOdkazZajemce(env, ucetId, email) {
  const z = await env.DB.prepare('SELECT ref_nick FROM subscribers WHERE email = ? AND ref_nick IS NOT NULL')
    .bind(email).first();
  if (!z?.ref_nick) return;
  await env.DB.prepare('UPDATE accounts SET ref_nick = ? WHERE id = ? AND ref_nick IS NULL')
    .bind(z.ref_nick, ucetId).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO referrals (referred_id, referrer_id, source, joined_at)
      SELECT a.id, ?, 'web', ? FROM subscribers s JOIN accounts a ON a.email = s.email
      WHERE s.ref = ? AND a.id != ?`).bind(ucetId, ted(), z.ref_nick, ucetId).run();
}

/** Po každé denní aktivitě: má pozvaný už dost různých dní? → stupeň 3. */
export async function zkontrolujAktivitu(env, ucetId) {
  const r = await env.DB.prepare('SELECT joined_at, active_at FROM referrals WHERE referred_id = ?')
    .bind(ucetId).first();
  if (!r || r.active_at) return;
  const dni = await env.DB.prepare('SELECT COUNT(*) AS n FROM activity WHERE account_id = ? AND day >= ?')
    .bind(ucetId, r.joined_at.slice(0, 10)).first();
  if ((dni?.n || 0) >= AKTIVNI_DNU) {
    await env.DB.prepare('UPDATE referrals SET active_at = ? WHERE referred_id = ? AND active_at IS NULL')
      .bind(ted(), ucetId).run();
  }
}
