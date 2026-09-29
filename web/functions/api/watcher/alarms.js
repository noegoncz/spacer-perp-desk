// Hlídač si stahuje všechny zapnuté alarmy i s push tokeny jejich účtů.
// Zároveň se tím hlásí jako živý (watcher_status).
import { ted } from '../../../lib/ucet.js';

export async function onRequestGet({ request, env }) {
  const info = new URL(request.url).searchParams.get('info') || '';
  const [alarmy, tokeny] = await Promise.all([
    env.DB.prepare(`SELECT a.account_id, a.id, a.data, a.fired_at FROM alarms a
        WHERE a.active = 1 AND EXISTS (SELECT 1 FROM push_tokens p WHERE p.account_id = a.account_id)`).all(),
    env.DB.prepare(`SELECT account_id, token FROM push_tokens
        WHERE account_id IN (SELECT DISTINCT account_id FROM alarms WHERE active = 1)`).all(),
  ]);
  // Ozvání se zapisuje jen s parametrem info — posílá ho hlídač; test,
  // který se jen dívá, stav hlídače přepisovat nesmí.
  if (info) {
    await env.DB.prepare(`INSERT INTO watcher_status (id, seen_at, info) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET seen_at = excluded.seen_at, info = excluded.info`)
      .bind(ted(), info.slice(0, 300)).run();
  }

  const podleUctu = {};
  for (const t of tokeny.results) (podleUctu[t.account_id] ||= []).push(t.token);
  return Response.json({
    ok: true,
    alarms: alarmy.results.map((r) => ({
      account: r.account_id, firedAt: r.fired_at, ...JSON.parse(r.data), id: r.id,
    })),
    tokens: podleUctu,
  });
}
