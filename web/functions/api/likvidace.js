// Likvidační mapa Hyperliquidu pro aplikaci (veřejná data, bez přihlášení).
//
// GET /api/likvidace?c=BTC&od=<ms>&do=<ms>&r=1|15[&krok=<ms>]
//   r=1   minutové snímky (nejvýš 48 h najednou)
//   r=15  snímky po 15 min (nejvýš 90 dní); s krok ≥ 1 h jen první snímek
//         každé krok-té hodiny — dlouhé timeframy potřebují snímek na svíčku
// Odpověď: { ok, r, hodiny: [[hodina, data], …] }, data = řádky formátu
// js/likvidace-format.js. Hotové hodiny se už nemění → dlouhá cache.

import { corsHlavicky } from '../../lib/ucet.js';
import { klicDnu, spojOdpoved, prvkyTextem } from '../../lib/historie.js';

const HOD = 3600000;
const DEN = 24 * HOD;
// D1 drží snímky po 15 min 21 dní (watcher/liq.js); celé dny starší než
// 20 dní jdou z archivu v R2 (web/lib/historie.js, 2026-11-18). Archiv
// má jen první snímek hodiny (k1) a každé 6. hodiny (k6).
const D1_DNY = 20;
const COIN_R2 = /^[A-Za-z0-9]{1,40}$/;

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
  let odHodiny = Math.floor(od / HOD) * HOD;
  // Starší celé dny z archivu R2, zbytek z D1.
  let klice = [];
  const hraniceD1 = Math.floor(ted / DEN) * DEN - D1_DNY * DEN;
  if (r === 15 && env.HIST && odHodiny < hraniceD1 && COIN_R2.test(coin)) {
    const varianta = krok >= 6 * HOD && krok % (6 * HOD) === 0 ? 'k6' : 'k1';
    klice = klicDnu(`graf/mapa/${varianta}/${coin}`, odHodiny, Math.min(hraniceD1, doCasu + 1));
    odHodiny = hraniceD1;
  }
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
  const results = odHodiny <= doCasu ? (await dotaz.all()).results : [];
  const hotove = doCasu < Math.floor(ted / HOD) * HOD;
  const radky = results.map((x) => [x.hodina, x.data]);
  if (!klice.length) {
    return new Response(JSON.stringify({ ok: true, r, hodiny: radky }), { headers: hlavicky(hotove) });
  }
  return new Response(spojOdpoved(env, {
    zacatek: `{"ok":true,"r":${r},"hodiny":[`, klice, zbytek: prvkyTextem(radky), konec: ']}',
  }), { headers: hlavicky(hotove) });
}
