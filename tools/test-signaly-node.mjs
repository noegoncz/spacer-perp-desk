// Výpočet RSI divergence a hlídání na serveru (v0.89.0) — spouští
// tools/test-signaly.py přenosným Node: node tools/test-signaly-node.mjs <kořen repa>
const koren = process.argv[2].replace(/\\/g, '/');
const { divergence, novaDivergence, rozpracovane, novaRozpracovana, rsi, VYCHOZI } = await import(`file:///${koren}/js/divergence.js`);
const { svicky, spustSignaly, posledniUzavrena } = await import(`file:///${koren}/server/signaly.mjs`);

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
// Rozpracovaná (v0.89.2): před potvrzením se tatáž divergence ukáže s počtem svíček za pivotem.
for (const k of [0, 1, 2]) {
  const pref = rada.slice(0, rada.length - VYCHOZI.vpravo + k);
  const r = rozpracovane(pref).filter((x) => x.typ === 'byci');
  over(r.length === 1 && r[0].svicekPo === k && d && r[0].do.i === d.do.i, `rozpracovaná ${k}/${VYCHOZI.vpravo}: týž pivot jako potvrzená`);
}
over(novaRozpracovana(rada.slice(0, rada.length - 1), 2).length === 1, 'novaRozpracovana(2) = signál 2/3');
over(!rozpracovane(rada).some((x) => x.typ === 'byci'), 'po potvrzení už není rozpracovaná');
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
    { id: 'sig-1', account: 'a1', jazyk: 'cs', typ: 'divergence', symboly: ['BTCUSDT', 'binance:BTCUSDT'], intervaly: ['60'], faze: 3 },
    { id: 'sig-2', account: 'a1', jazyk: 'cs', typ: 'divergence', symboly: ['BTCUSDT'], intervaly: ['60'], faze: 3 },
    { id: 'sig-3', account: 'a2', jazyk: 'en', typ: 'divergence', symboly: ['BTCUSDT'], intervaly: ['240'], faze: 3 },
    { id: 'sig-4', account: 'a3', jazyk: 'en', typ: 'divergence', symboly: ['BTCUSDT'], intervaly: ['60'], faze: 2 },
    // v0.90.3: víc fází v jednom pravidle → každá fáze vlastní zpráva.
    { id: 'sig-5', account: 'a4', jazyk: 'en', typ: 'divergence', symboly: ['BTCUSDT'], intervaly: ['60'], faze: [2, 3] },
  ],
  posli: async (ucet, z, pravidlo) => { poslane.push({ ucet, ...z, pravidlo: pravidlo?.id }); },
  log: () => {},
});
const puvodniFetch = globalThis.fetch;
const otevreni = Math.floor(Date.now() / 3600e3) * 3600e3 - 3600e3;
let vstup = rada;    // svíčky, které podstrčená burza vrátí
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.bybit.com')) {
    const posun = otevreni - vstup.at(-1).timestamp;
    const list = vstup.map((s) => [String(s.timestamp + posun), s.open, s.high, s.low, s.close, '1', '1']).reverse();
    return new Response(JSON.stringify({ retCode: 0, result: { list } }));
  }
  return new Response(JSON.stringify([]));   // Binance bez svíček → přeskočí se
};
await new Promise((r) => setTimeout(r, 300));    // první kontrola po startu doběhne
poslane.length = 0;
// Fáze 2/3 (výchozí): o svíčku dřív, než se divergence potvrdí.
vstup = rada.slice(0, -1);
await hlidac.zpracuj('60', otevreni);
const pred = poslane.filter((x) => x.ucet === 'a3');
over(pred.length === 1 && /Rýsuje|forming/.test(pred[0].text) && pred[0].text.includes('(2/3)') && pred[0].data.faze === '2',
  `fáze 2/3: „${pred[0]?.text}"`);
over(!poslane.some((x) => x.ucet === 'a1'), 'účet s potvrzenou fází o svíčku dřív nic');
over(poslane.filter((x) => x.ucet === 'a4').length === 1, 'pravidlo 2/3 + potvrzená: o svíčku dřív zpráva 2/3');
poslane.length = 0;
vstup = rada;
await hlidac.zpracuj(60, otevreni);
await hlidac.zpracuj(60, otevreni);              // podruhé už nic (odesláno)
globalThis.fetch = puvodniFetch;
const a4 = poslane.filter((x) => x.ucet === 'a4');
over(a4.length === 1 && a4[0].data.faze === '3' && !a4[0].text.includes('/3'), `pravidlo 2/3 + potvrzená: pak i potvrzená (${a4.map((x) => x.text)})`);
poslane.splice(0, poslane.length, ...poslane.filter((x) => x.ucet !== 'a4'));
over(poslane.length === 1 && poslane[0].ucet === 'a1', `potvrzená: jedna zpráva účtu a1, ne a2 (4h) ani a3 (už měl 2/3) (${poslane.length})`);
over(poslane[0]?.pravidlo === 'sig-1', 'hlídač ví, které pravidlo signál poslalo (poslední signál v přehledu)');
const z = poslane[0] || {};
over(z.text === 'Býčí RSI divergence · 1h' && z.titulek === 'PerpyX · BTCUSDT', `text: ${z.titulek} / ${z.text}`);
over(z.data?.symbol === 'BTCUSDT' && z.data?.interval === '60' && z.data?.typ === 'divergence'
  && Object.values(z.data).every((v) => typeof v === 'string'), 'data pushe: symbol, interval, jen řetězce (FCM)');
over(z.smer === 'nahoru', 'býčí = ikonka nahoru');

// Týdenní svíčka začíná v pondělí 00:00 UTC.
const tyden = posledniUzavrena('W', Date.UTC(2026, 10, 4, 12));   // středa 4. 11. 2026
over(new Date(tyden).toISOString() === '2026-10-26T00:00:00.000Z', `poslední uzavřený týden od pondělí (${new Date(tyden).toISOString()})`);
const r1d = await svicky('binance:BTCUSDT', 'W');
over(r1d.at(-1)?.timestamp === posledniUzavrena('W'), 'Binance 1W: poslední uzavřená svíčka sedí');
const r5 = await svicky('BTCUSDT', '5');
over(r5.at(-1)?.timestamp === posledniUzavrena('5'), 'Bybit 5m: poslední uzavřená svíčka sedí');

console.log(chyby.length ? `VÝSLEDEK: !!! ${chyby.length} chyb` : 'VÝSLEDEK: VŠE V POŘÁDKU');
process.exit(chyby.length ? 1 : 0);
