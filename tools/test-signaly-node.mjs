// Výpočet RSI divergence a hlídání na serveru (v0.89.0) — spouští
// tools/test-signaly.py přenosným Node: node tools/test-signaly-node.mjs <kořen repa>
const koren = process.argv[2].replace(/\\/g, '/');
const { divergence, novaDivergence, rsi, VYCHOZI } = await import(`file:///${koren}/js/divergence.js`);
const { svicky, spustSignaly } = await import(`file:///${koren}/server/signaly.mjs`);

const chyby = [];
const over = (podminka, popis) => {
  console.log(`${podminka ? '  ok   ' : '  CHYBA '}${popis}`);
  if (!podminka) chyby.push(popis);
};

// 1) Uměle postavená býčí divergence: dvě dna, druhé níž cenou, ale RSI výš
//    (první propad prudký, druhý pozvolný).
const rada = [];
let c = 100;
const krok = 3600e3;
const pridej = (zmena) => { c += zmena; rada.push({ timestamp: rada.length * krok, open: c, high: c + 0.2, low: c - 0.2, close: c }); };
for (let i = 0; i < 30; i += 1) pridej(i % 2 ? 0.3 : -0.3);     // klid
for (let i = 0; i < 8; i += 1) pridej(-2);                       // prudký propad → nízké RSI
for (let i = 0; i < 10; i += 1) pridej(1.2);                     // odraz
for (let i = 0; i < 14; i += 1) pridej(-0.95);                  // pozvolný propad pod první dno
for (let i = 0; i < VYCHOZI.vpravo; i += 1) pridej(1.5);         // potvrzení
const byci = divergence(rada, rsi(rada)).filter((d) => d.typ === 'byci');
over(byci.length >= 1, `býčí divergence nalezena (${byci.length})`);
const d = byci.at(-1);
if (d) {
  over(d.do.cena < d.od.cena && d.do.rsi > d.od.rsi, 'cena nižší dno, RSI vyšší dno');
  over(d.potvrzeno === d.do.i + VYCHOZI.vpravo, 'potvrzená až vpravo svíček po pivotu');
}
over(novaDivergence(rada).some((x) => x.typ === 'byci'), 'poslední svíčka divergenci potvrzuje (push)');
over(novaDivergence(rada.slice(0, -1)).every((x) => x.typ !== 'byci'), 'o svíčku dřív ještě ne');
// Medvědí: zrcadlo ceny.
const zrcadlo = rada.map((s) => ({ ...s, open: 300 - s.open, high: 300 - s.low, low: 300 - s.high, close: 300 - s.close }));
over(divergence(zrcadlo, rsi(zrcadlo)).some((x) => x.typ === 'medvedi'), 'medvědí divergence na zrcadlené ceně');

// 2) Svíčky ze skutečných burz: jen uzavřené, poslední = předchozí hranice.
for (const s of ['BTCUSDT', 'binance:BTCUSDT']) {
  for (const iv of [60, 240]) {
    const r = await svicky(s, iv);
    const ms = iv * 60e3;
    const ocekavana = Math.floor(Date.now() / ms) * ms - ms;
    over(r.length > 150 && r.at(-1).timestamp === ocekavana, `${s} ${iv}: ${r.length} uzavřených svíček, poslední na hranici`);
    over(r.every((x, i) => !i || x.timestamp - r[i - 1].timestamp === ms), `${s} ${iv}: svíčky po sobě bez mezer`);
  }
}

// 3) Hlídání: zpracování svíčky pošle každému účtu nejvýš jednu zprávu na
//    divergenci a správný tvar dat (podstrčené svíčky se známou divergencí).
const poslane = [];
const hlidac = spustSignaly({
  alarmy: () => [
    { account: 'a1', jazyk: 'cs', typ: 'divergence', symboly: ['BTCUSDT', 'binance:BTCUSDT'], intervaly: ['60'] },
    { account: 'a1', jazyk: 'cs', typ: 'divergence', symboly: ['BTCUSDT'], intervaly: ['60'] },
    { account: 'a2', jazyk: 'en', typ: 'divergence', symboly: ['BTCUSDT'], intervaly: ['240'] },
  ],
  posli: async (ucet, z) => { poslane.push({ ucet, ...z }); },
  log: () => {},
});
const puvodniFetch = globalThis.fetch;
const otevreni = Math.floor(Date.now() / 3600e3) * 3600e3 - 3600e3;
const posun = otevreni - rada.at(-1).timestamp;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.bybit.com')) {
    const list = rada.map((s) => [String(s.timestamp + posun), s.open, s.high, s.low, s.close, '1', '1']).reverse();
    return new Response(JSON.stringify({ retCode: 0, result: { list } }));
  }
  return new Response(JSON.stringify([]));   // Binance bez svíček → přeskočí se
};
await new Promise((r) => setTimeout(r, 300));    // první kontrola po startu doběhne
poslane.length = 0;
await hlidac.zpracuj(60, otevreni);
await hlidac.zpracuj(60, otevreni);              // podruhé už nic (odesláno)
globalThis.fetch = puvodniFetch;
over(poslane.length === 1 && poslane[0].ucet === 'a1', `jedna zpráva účtu a1, ne a2 (4h) (${poslane.length})`);
const z = poslane[0] || {};
over(z.text === 'Býčí RSI divergence · 1h' && z.titulek === 'PerpyX · BTCUSDT', `text: ${z.titulek} / ${z.text}`);
over(z.data?.symbol === 'BTCUSDT' && z.data?.interval === '60' && z.data?.typ === 'divergence'
  && Object.values(z.data).every((v) => typeof v === 'string'), 'data pushe: symbol, interval, jen řetězce (FCM)');
over(z.smer === 'nahoru', 'býčí = ikonka nahoru');

console.log(chyby.length ? `VÝSLEDEK: !!! ${chyby.length} chyb` : 'VÝSLEDEK: VŠE V POŘÁDKU');
process.exit(chyby.length ? 1 : 0);
