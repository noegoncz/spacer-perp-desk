// Likvidační mapa Hyperliquidu pro aplikaci (veřejná data, bez přihlášení).
//
// GET /api/likvidace?c=BTC&od=<ms>&do=<ms>&r=1|15[&krok=<ms>]
//   r=1   minutové snímky (nejvýš 48 h najednou)
//   r=15  snímky po 15 min (nejvýš 90 dní); s krok ≥ 1 h jen první snímek
//         každé krok-té hodiny — dlouhé timeframy potřebují snímek na svíčku
// Odpověď: { ok, r, hodiny: [[hodina, data], …] }, data = řádky formátu
// js/likvidace-format.js. Hotové hodiny se už nemění → dlouhá cache.

import { corsHlavicky } from '../../lib/ucet.js';

const HOD = 3600000;

export const onRequestOptions = ({ request }) => new Response(null, { status: 204, headers: corsHlavicky(request) });

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const coin = (u.searchParams.get('c') || '').slice(0, 40);
  const r = u.searchParams.get('r') === '15' ? 15 : 1;
  const ted = Date.now();
  const doCasu = Math.min(Number(u.searchParams.get('do')) || ted, ted);
  const maxRozsah = (r === 1 ? 48 : 90 * 24) * HOD;
  const od = Math.max(Number(u.searchParams.get('od')) || doCasu - 6 * HOD, doCasu - maxRozsah);
  const krok = Math.floor((Number(u.searchParams.get('krok')) || 0) / HOD) * HOD;
  const hlavicky = (hotove) => ({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': hotove ? 'public, max-age=86400' : 'public, max-age=30',
    ...corsHlavicky(request),
  });
  if (!coin) return new Response('{"ok":false}', { status: 400, headers: hlavicky(false) });
  const odHodiny = Math.floor(od / HOD) * HOD;
  let dotaz;
  if (r === 15 && krok >= HOD) {
    // Jen první řádek hodiny (substr do prvního \n) a jen každá krok-tá hodina.
    dotaz = env.LIQ.prepare(`SELECT hodina, substr(data, 1, instr(data, char(10))) AS data FROM liq_hodiny
        WHERE coin = ? AND rozliseni = 15 AND hodina BETWEEN ? AND ? AND hodina % ? = 0 ORDER BY hodina`)
      .bind(coin, odHodiny, doCasu, krok);
  } else {
    dotaz = env.LIQ.prepare(`SELECT hodina, data FROM liq_hodiny
        WHERE coin = ? AND rozliseni = ? AND hodina BETWEEN ? AND ? ORDER BY hodina`)
      .bind(coin, r, odHodiny, doCasu);
  }
  const { results } = await dotaz.all();
  const hotove = doCasu < Math.floor(ted / HOD) * HOD;
  return new Response(JSON.stringify({ ok: true, r, hodiny: results.map((x) => [x.hodina, x.data]) }),
    { headers: hlavicky(hotove) });
}
