// Test čtení starší historie z R2 (web/lib/historie.js, /api/likvidace, /api/zdi).
// Bez sítě: D1 i R2 podstrčené, kousky archivu z místní složky (web/tools/archiv.py --graf).
// Použití: node tools/test-historie-r2.mjs <složka out s graf/…>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const KOREN = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const imp = (p) => import(pathToFileURL(path.join(KOREN, p)).href);
const { onRequestGet: liq } = await imp('web/functions/api/likvidace.js');
const { onRequestGet: zdi } = await imp('web/functions/api/zdi.js');

const OUT = process.argv[2];
let chyb = 0;
const over = (p, text) => { console.log(`${p ? 'OK   ' : 'CHYBA'} ${text}`); if (!p) chyb += 1; };

const getu = [];
const HIST = {
  async get(klic) {
    getu.push(klic);
    const soubor = path.join(OUT, ...klic.split('/'));
    if (!fs.existsSync(soubor)) return null;
    const data = fs.readFileSync(soubor);
    return { size: data.length, body: new Blob([data]).stream() };
  },
};
const dotazy = [];
const LIQ = {
  prepare(sql) {
    return {
      bind(...a) { dotazy.push([sql.replace(/\s+/g, ' ').slice(0, 60), a]); return this; },
      async all() {
        if (sql.includes('liq_hodiny')) return { results: [{ hodina: Date.now() - 3 * 3600000 - (Date.now() % 3600000), data: '[1,2,3,"K",4,[]]\n' }] };
        if (sql.includes('zdi_dny')) return { results: [{ data: '[0,100,1,2,5,6]\n[1,200,3,4,7,8]' }] };
        return { results: [] };
      },
      async first() {
        if (sql.includes('zdi_stav')) return { data: JSON.stringify({ t: 5, k: { 'binance:BTCUSDT': [100, 1, [[0, 99, 1e6, 1, 1, 2]]] }, n: {} }) };
        return null;
      },
      async run() { return {}; },
    };
  },
};
const env = { LIQ, HIST };
const DEN = 86400000;
const od = Date.UTC(2026, 9, 25);
const doKdy = Date.now();

// 1) mapa, 4h graf (krok 1 h) — od 25. 10.
getu.length = 0; dotazy.length = 0;
let res = await liq({ request: new Request(`https://x/api/likvidace?c=BTC&r=15&od=${od}&do=${doKdy}&krok=3600000`), env });
let txt = await res.text();
let j = JSON.parse(txt);
over(j.ok && Array.isArray(j.hodiny), 'mapa: platný JSON');
over(getu.length > 0 && getu.every((k) => k.startsWith('graf/mapa/k1/BTC/')), `mapa: archiv k1 (${getu.length} dnů)`);
const hodinyArchivu = j.hodiny.filter(([h]) => h < Date.UTC(2026, 10, 1));
over(hodinyArchivu.length >= 24, `mapa: hodiny z archivu (${hodinyArchivu.length})`);
over(j.hodiny.some(([, d]) => d === '[1,2,3,"K",4,[]]\n'), 'mapa: i řádky z D1');
const hraniceD1 = Math.floor(Date.now() / DEN) * DEN - 20 * DEN;
over(dotazy.some(([, a]) => a.includes(hraniceD1)), 'mapa: D1 se ptá až od hranice 20 dní');
over(typeof j.hodiny[0][1] === 'string' && j.hodiny[0][1].includes('"K"'), 'mapa: řádek ve formátu snímku');

// 2) mapa, 1D graf (krok 6 h) → k6
getu.length = 0;
res = await liq({ request: new Request(`https://x/api/likvidace?c=BTC&r=15&od=${od}&do=${doKdy}&krok=${6 * 3600000}`), env });
j = JSON.parse(await res.text());
over(getu.every((k) => k.startsWith('graf/mapa/k6/')), 'mapa 1D: archiv k6');
over(j.hodiny.filter(([h]) => h < Date.UTC(2026, 10, 1)).every(([h]) => h % (6 * 3600000) === 0), 'mapa 1D: jen každá 6. hodina');

// 3) mapa, nedávné okno → bez R2, obyčejná odpověď
getu.length = 0;
res = await liq({ request: new Request(`https://x/api/likvidace?c=BTC&r=15&od=${Date.now() - 2 * DEN}&do=${doKdy}`), env });
j = JSON.parse(await res.text());
over(getu.length === 0 && j.hodiny.length === 1, 'mapa nedávno: jen D1');

// 4) coin s divným názvem → do R2 nesahat
getu.length = 0;
res = await liq({ request: new Request(`https://x/api/likvidace?c=..%2Fx&r=15&od=${od}&do=${doKdy}`), env });
JSON.parse(await res.text());
over(getu.length === 0, 'mapa: podezřelý název coinu nečte R2');

// 5) zdi — okno 30 dní
getu.length = 0;
res = await zdi({ request: new Request(`https://x/api/zdi?k=binance:BTCUSDT&od=${doKdy - 30 * DEN}&do=${doKdy}`), env, waitUntil: () => {} });
j = JSON.parse(await res.text());
over(j.ok && j.sleduje && j.zdi.length === 1, 'zdi: živé zdi');
over(getu.length > 0 && getu.every((k) => k.startsWith('graf/zdi/binance~BTCUSDT/')), `zdi: archiv (${getu.length} dnů)`);
const stare = j.hist.filter((z) => z[2] > 1e12 && z[2] < Date.UTC(2026, 10, 1));
over(stare.length > 10, `zdi: hotové zdi z archivu (${stare.length})`);
over(stare.every((z) => z[3] - z[2] >= 20 * 60000), 'zdi: z archivu jen ≥ 20 min');

console.log(chyb ? `\n${chyb} chyb` : '\nvše prošlo');
process.exit(chyb ? 1 : 0);
