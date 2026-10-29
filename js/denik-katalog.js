/*
 * Katalog výchozích setupů a signálů deníku (v0.67.0, náhled schválený
 * uživatelem: https://claude.ai/artifact/NNshdXrvA59diaWEU45cFa).
 *
 * Setup = jaký obchod to je (jeden, nepovinný). Signál = jednotlivý
 * nezávislý důvod pro vstup; confluence = počet zaškrtnutých signálů.
 * Ke každé položce kresba (SVG, viewBox 160 × 90) a texty v i18n:
 * `journal.setup.<id>` / `journal.sig.<id>` (název), `…Desc.<id>` (popis),
 * `…When.<id>` (kdy platí). Bez DOM — kresby jsou řetězce.
 */

/** Skupiny signálů a jejich barvy (tlumené, naplno až vybraný signál). */
export const SKUPINY = {
  setup: '#22d3ee',
  uroven: '#f0b90b',
  trend: '#9b84ff',
  moment: '#38bdf8',
  trh: '#3ee6a4',
  udalost: '#ff7ab6',
};
export const SKUPINY_SIGNALU = ['uroven', 'trend', 'moment', 'trh', 'udalost'];

const C = '#c9d4e5';
const U = '#f0b90b';
const F = '#9b84ff';
const Z = '#3ee6a4';
const R = '#f6465d';
const T = '#22d3ee';
const cara = (body, sirka = 2) => `<polyline fill="none" stroke="${C}" stroke-width="${sirka}" points="${body}"/>`;
const uroven = (y) => `<line x1="0" y1="${y}" x2="160" y2="${y}" stroke="${U}" stroke-dasharray="5 4"/>`;
const bod = (x, y, barva = Z) => `<circle cx="${x}" cy="${y}" r="4" fill="${barva}"/>`;

export const SETUPY = [
  { id: 'breakout', kresba: uroven(34) + cara('5,60 20,38 35,58 50,37 65,56 80,36 95,50 108,30 125,18 150,8') + bod(108, 30) },
  { id: 'retest', kresba: uroven(40) + cara('5,70 30,62 50,50 70,22 90,16 110,36 120,41 135,26 155,10') + bod(120, 41) },
  { id: 'range', kresba: uroven(18) + uroven(72) + cara('5,40 25,20 50,68 75,22 100,70 125,45 150,24') + bod(100, 70) },
  { id: 'pullback', kresba: `<polyline fill="none" stroke="${F}" stroke-width="1.5" opacity=".8" points="5,80 155,20"/>` + cara('5,78 30,52 45,66 70,38 88,56 110,26 128,40 150,10') + bod(88, 56) },
  { id: 'reversal', kresba: cara('5,12 25,30 40,24 60,50 75,44 90,76 105,58 118,66 135,40 155,22') + '<line x1="70" y1="58" x2="150" y2="58" stroke="' + U + '" stroke-dasharray="5 4"/>' + bod(125, 56) },
  { id: 'sweep', kresba: uroven(62) + cara('5,30 25,60 45,36 70,61 90,40 105,58 112,80 120,56 140,34 155,22') + bod(120, 56) + `<text x="112" y="89" fill="${R}" font-size="8" text-anchor="middle">stops</text>` },
];

export const SIGNALY = [
  { id: 'sr', skupina: 'uroven', kresba: `<rect x="0" y="52" width="160" height="10" fill="${U}" opacity=".18"/>` + cara('5,20 30,55 50,30 80,56 100,28 125,54 150,22') },
  { id: 'htf', skupina: 'trend', kresba: `<polyline fill="none" stroke="${F}" stroke-width="3" opacity=".55" points="5,80 155,15"/>` + cara('5,78 15,70 22,76 35,62 45,68 58,52 68,58 80,46 90,50 104,36 114,42 128,28 140,32 155,16', 1.5) },
  { id: 'trendline', skupina: 'uroven', kresba: `<line x1="5" y1="82" x2="155" y2="30" stroke="${U}" stroke-dasharray="5 4"/>` + cara('5,80 30,50 45,72 75,36 95,60 120,24 135,42 155,14') + bod(45, 72, U) + bod(95, 60, U) + bod(135, 42) },
  { id: 'candle', skupina: 'moment', kresba: `<g stroke="#e05858" fill="#e05858"><line x1="40" y1="20" x2="40" y2="62"/><rect x="34" y="26" width="12" height="28"/><line x1="64" y1="34" x2="64" y2="70"/><rect x="58" y="40" width="12" height="22"/></g><g stroke="#60a868" fill="#60a868"><line x1="90" y1="36" x2="90" y2="84"/><rect x="84" y="38" width="12" height="10"/><line x1="116" y1="22" x2="116" y2="66"/><rect x="110" y="26" width="12" height="36"/></g>` },
  { id: 'ma', skupina: 'trend', kresba: `<path d="M5 72 C 50 66, 90 50, 155 30" fill="none" stroke="${F}" stroke-width="2"/>` + cara('5,60 25,48 45,62 70,40 92,52 110,30 130,44 155,18', 1.5) + bod(92, 52) },
  { id: 'fib', skupina: 'uroven', kresba: `<g stroke="${U}" stroke-dasharray="3 4" opacity=".7"><line x1="0" y1="10" x2="160" y2="10"/><line x1="0" y1="37" x2="160" y2="37"/><line x1="0" y1="50" x2="160" y2="50"/><line x1="0" y1="80" x2="160" y2="80"/></g><text x="156" y="47" fill="${U}" font-size="9" text-anchor="end">0.618</text>` + cara('5,80 60,10 85,30 100,50 120,30 150,8') + bod(100, 50) },
  { id: 'volume', skupina: 'moment', kresba: cara('5,40 30,44 55,38 80,42 100,22 125,18 150,12') + `<g fill="${F}" opacity=".7"><rect x="10" y="78" width="8" height="10"/><rect x="30" y="80" width="8" height="8"/><rect x="50" y="77" width="8" height="11"/><rect x="70" y="79" width="8" height="9"/><rect x="95" y="54" width="8" height="34" fill="${T}"/><rect x="115" y="72" width="8" height="16"/><rect x="135" y="75" width="8" height="13"/></g>` },
  { id: 'rsiDiv', skupina: 'moment', kresba: cara('5,10 30,30 50,24 80,46 100,38 125,52 150,30') + `<line x1="80" y1="46" x2="125" y2="52" stroke="${R}"/><polyline fill="none" stroke="${F}" stroke-width="1.5" points="5,62 30,80 50,70 80,84 100,72 125,78 150,64"/><line x1="80" y1="84" x2="125" y2="78" stroke="${Z}"/>` },
  { id: 'funding', skupina: 'trh', kresba: `<line x1="0" y1="45" x2="160" y2="45" stroke="#223047"/><g fill="${Z}"><rect x="10" y="40" width="10" height="5"/><rect x="30" y="38" width="10" height="7"/><rect x="50" y="34" width="10" height="11"/><rect x="70" y="26" width="10" height="19"/><rect x="90" y="14" width="10" height="31" fill="${U}"/></g><g fill="${R}"><rect x="115" y="45" width="10" height="9"/><rect x="135" y="45" width="10" height="5"/></g>` },
  { id: 'orderBlock', skupina: 'trh', kresba: `<rect x="28" y="56" width="132" height="14" fill="${T}" opacity=".16"/><rect x="30" y="56" width="8" height="14" fill="#e05858"/><line x1="34" y1="52" x2="34" y2="74" stroke="#e05858"/>` + cara('5,40 34,66 50,30 70,12 95,30 112,58 130,32 155,16') + bod(112, 58) },
  { id: 'liq', skupina: 'trh', kresba: `<g stroke="#22c55e" stroke-width="2"><line x1="40" y1="16" x2="160" y2="16" opacity=".55"/><line x1="25" y1="74" x2="160" y2="74" opacity=".55"/></g><line x1="55" y1="22" x2="160" y2="22" stroke="#facc15" stroke-width="4"/>` + cara('5,62 25,54 45,60 65,46 85,50 100,38 112,20 120,44 140,58 155,66') + bod(112, 20, R) },
  { id: 'news', skupina: 'udalost', kresba: `<line x1="110" y1="0" x2="110" y2="90" stroke="${T}" stroke-dasharray="3 3"/>` + cara('5,60 30,52 55,56 80,44 100,40 108,38') + `<polyline fill="none" stroke="${C}" stroke-width="2" stroke-dasharray="3 3" opacity=".5" points="108,38 155,14"/>` },
];

/**
 * Výchozí signály přidané po verzi 2 deníku: uloženému seznamu se doplní
 * jednou (`doplneneVychozi`), jinak by vypadaly jako odebrané uživatelem.
 */
export const NOVE_SIGNALY = ['liq'];

/** Kresba jako celé SVG (bez obalu se nedá vložit). */
export const svg = (kresba) => `<svg viewBox="0 0 160 90" aria-hidden="true">${kresba}</svg>`;

/**
 * Staré verze deníku (v0.61–0.66) ukládaly přeložené názvy. Převod názvu
 * na id v obou jazycích; Divergence a News ze setupů jsou teď signály.
 */
export const STARE_NAZVY = {
  setup: {
    breakout: ['Breakout'], retest: ['Retest'], range: ['Range bounce', 'Odraz v range'],
    pullback: ['Trend pullback', 'Pullback v trendu'], reversal: ['Reversal', 'Obrat'],
  },
  setupNaSignal: { rsiDiv: ['Divergence'], news: ['News', 'Zprávy'] },
  signal: {
    sr: ['Support / resistance', 'Support / rezistence'], htf: ['HTF trend', 'Trend na vyšším TF'],
    trendline: ['Trendline', 'Trendová čára'], rsiDiv: ['RSI divergence'], volume: ['Volume spike', 'Skok objemu'],
    funding: ['Funding extreme', 'Extrémní funding'], fib: ['Fib level', 'Fibonacci'],
    orderBlock: ['Order block'], news: ['News / catalyst', 'Zprávy / katalyzátor'],
  },
};
