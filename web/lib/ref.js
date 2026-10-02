// Doporučení (referraly): přezdívky, párování pozvaných a stupně.
// Schéma: web/migrations/0007_referraly.sql.

import { ted } from './ucet.js';

/** Kolik různých dní musí pozvaný aplikaci použít, aby se počítal jako bod. */
export const AKTIVNI_DNU = 3;
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

/** p***@gmail.com — zvoucí pozná svého známého, nikdo jiný z toho nic nevyčte. */
export function zamaskuj(email) {
  const [jmeno, domena] = String(email).split('@');
  return `${(jmeno || '?')[0]}***@${domena || ''}`;
}

/** Účet zvoucího podle přezdívky (nebo null). */
export async function zvouciPodlePrezdivky(env, nick) {
  if (!nick || chybaPrezdivky(nick) === 'invalid') return null;
  return env.DB.prepare('SELECT id, ref_nick FROM accounts WHERE ref_nick = ?').bind(nick).first();
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
  if (!zvouci || zvouci.id === ucetId) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO referrals (referred_id, referrer_id, source, joined_at)
      VALUES (?, ?, 'web', ?)`).bind(ucetId, zvouci.id, ted()).run();
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
