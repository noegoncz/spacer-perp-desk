// Alarmy účtu pro hlídání na serveru.
//
// PUT  — telefon pošle celý seznam svých alarmů (nahradí ten na serveru).
// GET  — telefon si stáhne stav: které alarmy mezitím zazněly na serveru.
//
// ⚠ Zaznění na serveru nesmí přepsat starší stav z telefonu: když
// jednorázový alarm zazní (server ho vypne) a telefon pak pošle seznam
// ještě s alarmem zapnutým, alarm zůstane vypnutý — pokud ho uživatel po
// zaznění sám neupravil (changed_at > fired_at). Jinak by se zapínal znovu.

import { json, ucetZPozadavku, neprihlasen } from '../../../lib/ucet.js';

const MAX_ALARMU = 300;

export async function onRequestPut({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  let telo;
  try {
    telo = await request.json();
  } catch {
    return json(request, { ok: false, error: 'invalid-request' }, 400);
  }
  const alarmy = Array.isArray(telo.alarms) ? telo.alarms.slice(0, MAX_ALARMU) : null;
  if (!alarmy) return json(request, { ok: false, error: 'invalid-request' }, 400);
  const jazyk = telo.lang === 'cs' ? 'cs' : 'en';

  const { results: stare } = await env.DB.prepare(
    'SELECT id, active, changed_at, fired_at FROM alarms WHERE account_id = ?',
  ).bind(ucet.id).all();
  const podleId = new Map(stare.map((r) => [r.id, r]));

  const prikazy = [env.DB.prepare('DELETE FROM alarms WHERE account_id = ?').bind(ucet.id)];
  for (const a of alarmy) {
    if (!a || typeof a.id !== 'string' || !a.id || typeof a.symbol !== 'string') continue;
    const zmeneno = Number(a.zmeneno) || 0;
    const puvodni = podleId.get(a.id);
    let aktivni = a.aktivni ? 1 : 0;
    let zaznelo = puvodni?.fired_at || null;
    // Na serveru zaznělo po poslední úpravě v telefonu → stav serveru platí.
    if (zaznelo && zaznelo > zmeneno && !a.opakovat) aktivni = 0;
    const data = JSON.stringify({ ...a, jazyk });
    if (data.length > 4000) continue;
    prikazy.push(env.DB.prepare(`INSERT INTO alarms (account_id, id, symbol, data, active, changed_at, fired_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(ucet.id, a.id, a.symbol.slice(0, 40), data, aktivni, zmeneno, zaznelo));
  }
  await env.DB.batch(prikazy);
  return json(request, { ok: true, count: prikazy.length - 1 });
}

export async function onRequestGet({ request, env }) {
  const ucet = await ucetZPozadavku(request, env);
  if (!ucet) return neprihlasen(request);
  const { results } = await env.DB.prepare(
    'SELECT id, active, fired_at FROM alarms WHERE account_id = ?',
  ).bind(ucet.id).all();
  const status = await env.DB.prepare('SELECT seen_at FROM watcher_status WHERE id = 1').first();
  return json(request, {
    ok: true,
    alarms: results.map((r) => ({ id: r.id, active: Boolean(r.active), firedAt: r.fired_at })),
    // Běží hlídač? (poslední ozvání) — aplikace podle toho ukáže, jestli
    // alarmy se zhasnutým displejem opravdu fungují.
    watcherSeen: status?.seen_at || null,
  });
}
