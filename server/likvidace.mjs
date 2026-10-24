/**
 * Likvidační mapa Hyperliquidu — sběr na serveru (Hetzner), běží nonstop
 * jako **samostatná služba**, oddělená od hlídače alarmů (vlastní proces,
 * uživatel i strop paměti; pád jedné nesmí shodit druhou).
 *
 * Hyperliquid je blockchain: pozice každého účtu jsou veřejné, i s
 * likvidační cenou. Služba:
 *   1. sbírá adresy účtů — veřejný žebříček (~48 000 účtů) a adresy
 *      z živých obchodů (stream `trades` nese adresy obou stran),
 *   2. ptá se na jejich pozice (`clearinghouseState`), velké a blízko
 *      likvidace často, malé a vzdálené zřídka; účet, který obchoduje,
 *      přeskočí frontu (pozice se mu nejspíš změnila),
 *   3. každou minutu sečte likvidace do cenových pásem po coinech
 *      (js/likvidace-format.js) a pošle je na perpyx.com
 *      (/api/watcher/liq, WATCHER_TOKEN). Telefon si je bere odtud.
 *
 * Ven jdou jen součty po pásmech — **žádné adresy**. Žádné API klíče
 * uživatelů, jen veřejná data. Server nemá otevřený žádný port.
 *
 * Proměnné prostředí (/etc/perpyx/likvidace.env):
 *   WATCHER_TOKEN, API       jako hlídač
 *   STATE_DIRECTORY          systemd (StateDirectory) — seznam adres
 *   ZKOUSKA=1                nic neposílat, řádky vypisovat do souboru (test)
 *   LIMIT_UCTU=n             jen n největších účtů žebříčku (test)
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { krokCeny, snimek, rozdil, radek } from '../js/likvidace-format.js';
import { spustZdi } from './zdi.mjs';

// Zdi v knize příkazů běží v této službě (server/zdi.mjs). Aktualizace
// restartuje službu jen při změně tohoto souboru → při změně zdi.mjs nebo
// js/zdi-format.js zvedni tuto verzi.
const VERZE_ZDI = 3;

const API = (process.env.API || 'https://perpyx.com').replace(/\/$/, '');
const TOKEN = process.env.WATCHER_TOKEN || '';
const ZKOUSKA = process.env.ZKOUSKA === '1';
const STAV = process.env.STATE_DIRECTORY || process.env.STAV || './stav-likvidace';
const LIMIT_UCTU = +process.env.LIMIT_UCTU || Infinity;
const HL = process.env.HL || 'https://api.hyperliquid.xyz/info';
const HL_WS = 'wss://api.hyperliquid.xyz/ws';
const ZEBRICEK = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

// Hyperliquid: 1200 vah za minutu na IP, clearinghouseState váží 2.
// Necháváme rezervu; na 429 se tempo na 10 min sníží.
const VAHA_ZA_MINUTU = +process.env.VAHA || 1000;
const SOUBEH = 6;
// HODINA_MS jen pro test (kratší „hodiny“, ať je vidět jejich střídání).
const MIN = 60000, HOD = +process.env.HODINA_MS || 3600000;
// Jak často posílat řádek coinu podle pořadí (součet likvidací):
// prvních 25 každou minutu, do 60 po 5 min, ostatní po 15 min.
const INTERVAL_PODLE_PORADI = [[25, MIN], [60, 5 * MIN], [Infinity, 15 * MIN]];

const log = (...a) => console.log(new Date().toISOString(), ...a);
const spi = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- dotazy na Hyperliquid s omezením tempa ---------- */

let vahy = VAHA_ZA_MINUTU / 6;   // zásobník vah (plní se plynule)
let doplneno = Date.now();
let tempo = VAHA_ZA_MINUTU;      // aktuální tempo (po 429 nižší)
let tempoDo = 0;
const stat = { dotazu: 0, chyb: 0, limit429: 0 };

async function vaha(v) {
  for (;;) {
    const ted = Date.now();
    if (tempoDo && ted > tempoDo) { tempo = VAHA_ZA_MINUTU; tempoDo = 0; }
    vahy = Math.min(tempo / 6, vahy + (ted - doplneno) * tempo / MIN);
    doplneno = ted;
    if (vahy >= v) { vahy -= v; return; }
    await spi(Math.ceil((v - vahy) * MIN / tempo));
  }
}

async function hl(telo, v) {
  await vaha(v);
  stat.dotazu += 1;
  const r = await fetch(HL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(telo), signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429) {
    stat.limit429 += 1;
    tempo = VAHA_ZA_MINUTU * 0.6;
    tempoDo = Date.now() + 10 * MIN;
    vahy = -tempo / 6;   // chvíli nic
  }
  if (!r.ok) throw new Error(`HL ${r.status}`);
  return r.json();
}

/* ---------- trhy: coiny a mark ceny ---------- */

const marky = new Map();     // coin → mark
let coiny = [];

async function obnovTrhy() {
  try {
    const [meta, ctx] = await hl({ type: 'metaAndAssetCtxs' }, 20);
    const nove = [];
    meta.universe.forEach((u, i) => {
      if (u.isDelisted) return;
      const m = +ctx[i]?.markPx;
      if (m > 0) { marky.set(u.name, m); nove.push(u.name); }
    });
    const pridane = nove.filter((c) => !coiny.includes(c));
    coiny = nove;
    if (pridane.length) prihlasObchody(pridane);
  } catch (e) {
    log('trhy:', e.message);
  }
}

/* ---------- účty a fronta ---------- */

// adresa → { due, zdroj: 'z' žebříček | 'o' obchod, pozice: [], cas, ntl }
const ucty = new Map();

function pridej(adresa, zdroj, due) {
  if (ucty.has(adresa)) return ucty.get(adresa);
  const u = { due, zdroj, pozice: [], cas: 0, ntl: 0 };
  ucty.set(adresa, u);
  return u;
}

// Kdy se zeptat znovu: podle velikosti a vzdálenosti od likvidace.
function dalsiDotaz(u, ted) {
  if (!u.pozice.length) return ted + 24 * HOD;   // obchod ho probudí dřív
  let vzd = Infinity;
  for (const p of u.pozice) {
    const m = marky.get(p.c);
    if (p.liq && m) vzd = Math.min(vzd, Math.abs(p.liq / m - 1));
  }
  if ((vzd < 0.02 && u.ntl >= 50e3) || u.ntl >= 5e6) return ted + MIN;
  if (vzd < 0.05 || u.ntl >= 500e3) return ted + 3 * MIN;
  if (vzd < 0.15 || u.ntl >= 50e3) return ted + 10 * MIN;
  return ted + 30 * MIN;
}

async function nactiUcet(adresa, u) {
  try {
    const s = await hl({ type: 'clearinghouseState', user: adresa }, 2);
    const pozice = [];
    let ntl = 0;
    for (const { position: p } of s.assetPositions || []) {
      const szi = +p.szi;
      if (!szi) continue;
      const liq = p.liquidationPx == null ? null : +p.liquidationPx;
      const n = Math.abs(+p.positionValue) || 0;
      ntl += n;
      pozice.push({ c: p.coin, liq, v: liq ? Math.abs(szi) * liq : 0, l: szi > 0, ntl: n });
    }
    u.pozice = pozice;
    u.ntl = ntl;
    u.cas = Date.now();
    u.due = dalsiDotaz(u, u.cas);
  } catch (e) {
    stat.chyb += 1;
    u.due = Date.now() + 2 * MIN;
  }
}

let fronta = [];
let zpozdeni = 0;            // medián zpoždění splatných účtů (s) — do stavu
let nenactenych = 0;         // účty, které se ještě ani jednou nenačetly

function naplnFrontu() {
  const ted = Date.now();
  const splatne = [];
  for (const [a, u] of ucty) if (u.due <= ted && !u.beh) splatne.push([u.due, a]);
  splatne.sort((x, y) => x[0] - y[0]);
  // Zpoždění jen u účtů se skutečným časem (pořadí žebříčku / velikost
  // při startu jsou malá nebo záporná čísla, ne čas).
  const casove = splatne.filter((x) => x[0] > 1e12);
  zpozdeni = casove.length ? Math.round((ted - casove[Math.floor(casove.length / 2)][0]) / 1000) : 0;
  nenactenych = splatne.length - casove.length;
  fronta = splatne.slice(0, 200).map((x) => x[1]);
}

async function pracovnik() {
  for (;;) {
    const a = fronta.shift();
    if (!a) { await spi(500); continue; }
    const u = ucty.get(a);
    if (!u || u.beh) continue;
    u.beh = true;
    await nactiUcet(a, u);
    u.beh = false;
  }
}

/* ---------- adresy: žebříček a živé obchody ---------- */

async function nactiZebricek() {
  try {
    const r = await fetch(ZEBRICEK, { signal: AbortSignal.timeout(120000) });
    const d = await r.json();
    const radky = (d.leaderboardRows || [])
      .filter((x) => +x.accountValue >= 1000)
      .sort((a, b) => b.accountValue - a.accountValue)
      .slice(0, LIMIT_UCTU);
    let nove = 0;
    radky.forEach((x, i) => {
      if (!ucty.has(x.ethAddress)) nove += 1;
      // Pořadí podle hodnoty účtu: největší se načtou první.
      pridej(x.ethAddress, 'z', i);
    });
    log(`žebříček: ${radky.length} účtů, nových ${nove}`);
  } catch (e) {
    log('žebříček:', e.message);
  }
}

let ws = null;
let posledniObchod = 0;
const stavWs = { spojeni: 0 };

function prihlasObchody(seznam) {
  if (ws?.readyState !== 1) return;
  for (const c of seznam) ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: c } }));
}

function obchod(t) {
  const ted = Date.now();
  posledniObchod = ted;
  for (const a of t.users || []) {
    const u = ucty.get(a);
    if (!u) {
      if (LIMIT_UCTU === Infinity) pridej(a, 'o', ted + 5000);
      continue;
    }
    // Obchodoval → pozice se změnila. Nejvýš jednou za 2 min na účet.
    const brzy = Math.max(u.cas + 2 * MIN, ted + 5000);
    if (brzy < u.due) u.due = brzy;
  }
}

function pripojObchody() {
  stavWs.spojeni += 1;
  const s = new WebSocket(HL_WS);
  ws = s;
  let ping = null;
  s.onopen = () => {
    log('obchody: spojeno');
    posledniObchod = Date.now();
    prihlasObchody(coiny);
    ping = setInterval(() => s.readyState === 1 && s.send('{"method":"ping"}'), 50000);
  };
  s.onmessage = (e) => {
    let m;
    try { m = JSON.parse(String(e.data)); } catch { return; }
    if (m.channel === 'trades') for (const t of m.data || []) obchod(t);
  };
  s.onclose = (e) => {
    clearInterval(ping);
    if (ws === s) ws = null;
    log(`obchody: zavřeno ${e.code} — znovu za 5 s`);
    setTimeout(pripojObchody, 5000);
  };
  s.onerror = () => {};
}

// Hyperliquid umí spojení nechat otevřené, ale přestat posílat (sonda
// 2026-10-21). Minuta bez jediného obchodu na stovkách coinů = mrtvé.
setInterval(() => {
  if (ws && Date.now() - posledniObchod > 60000) {
    log('obchody: minuta ticha — znovu');
    try { ws.close(); } catch { /* zavírá se */ }
  }
}, 15000);

/* ---------- snímky a odesílání ---------- */

// coin → { krok, hodina, posledni: Map, odeslano, ctvrt: [řádky K po 15 min] }
const stavCoinu = new Map();
let radky = [];      // čekající řádky { c, h, d }
let kompakt = [];    // hotové hodiny po 15 min { c, h, d }
let posledniUklid = 0;
let infoSnimku = {};
let kontrola = [];   // ZKOUSKA: celé snímky největších coinů pro porovnání

function udelejSnimek() {
  const t = Math.floor(Date.now() / MIN) * MIN;
  const hodina = Math.floor(t / HOD) * HOD;
  const ted = Date.now();
  // Pozice po coinech (jen čerstvé — účet nenačtený přes 2 h vypadne).
  const poCoinech = new Map();
  const sledovano = new Map();
  let sPozici = 0;
  for (const u of ucty.values()) {
    if (!u.pozice.length || ted - u.cas > 2 * HOD) continue;
    sPozici += 1;
    for (const p of u.pozice) {
      sledovano.set(p.c, (sledovano.get(p.c) || 0) + p.ntl);
      if (!p.liq) continue;
      if (!poCoinech.has(p.c)) poCoinech.set(p.c, []);
      poCoinech.get(p.c).push(p);
    }
  }
  const snimky = [];
  for (const c of new Set([...poCoinech.keys(), ...stavCoinu.keys()])) {
    const mark = marky.get(c);
    if (!mark) continue;
    let st = stavCoinu.get(c);
    const novaHodina = !st || st.hodina !== hodina;
    const krok = novaHodina ? krokCeny(mark) : st.krok;
    const pasma = snimek(poCoinech.get(c) || [], mark, krok);
    let soucet = 0;
    for (const [l, s] of pasma.values()) soucet += l + s;
    snimky.push({ c, mark, krok, pasma, soucet, novaHodina });
  }
  snimky.sort((a, b) => b.soucet - a.soucet);
  snimky.forEach((s, i) => {
    let st = stavCoinu.get(s.c);
    const interval = INTERVAL_PODLE_PORADI.find(([n]) => i < n)[1];
    const sled = sledovano.get(s.c) || 0;
    if (ZKOUSKA && i < 3) kontrola.push({ t, c: s.c, pasma: [...s.pasma] });
    if (s.novaHodina) {
      // Hotová hodina → kompaktní řádek (snímky po 15 min) do historie.
      if (st?.ctvrt.length && st.hodina >= 0) kompakt.push({ c: s.c, h: st.hodina, d: st.ctvrt.join('\n') + '\n' });
      if (!s.pasma.size && !st?.posledni.size) { stavCoinu.delete(s.c); return; }
      st = { krok: s.krok, hodina, posledni: s.pasma, odeslano: t, ctvrt: [] };
      stavCoinu.set(s.c, st);
      radky.push({ c: s.c, h: hodina, d: radek(t, s.mark, s.krok, 'K', sled, s.pasma) });
    } else if (t - st.odeslano >= interval) {
      const zmeny = rozdil(st.posledni, s.pasma);
      if (zmeny.length) {
        radky.push({ c: s.c, h: hodina, d: radek(t, s.mark, s.krok, 'D', sled, zmeny) });
        st.posledni = s.pasma;
      }
      st.odeslano = t;
    }
    if (t % (HOD / 4) === 0) st.ctvrt.push(radek(t, s.mark, s.krok, 'K', sled, s.pasma));
  });
  infoSnimku = {
    t, coinu: stavCoinu.size, uctu: ucty.size, sPozici,
    sledovano: Math.round([...sledovano.values()].reduce((x, y) => x + y, 0)),
    top: snimky.slice(0, 5).map((s) => `${s.c} ${(s.soucet / 1e6).toFixed(1)}M`).join(', '),
  };
}

async function odesli() {
  const ted = Date.now();
  const uklid = ted - posledniUklid > HOD;
  const info = {
    ...infoSnimku, zpozdeni, nenactenych,
    ws: ws?.readyState === 1, wsSpojeni: stavWs.spojeni,
    obchodPred: Math.round((ted - posledniObchod) / 1000),
    ...stat, tempo, pamet: Math.round(process.memoryUsage().rss / 1e6),
  };
  const davka = { radky: radky.map((r) => ({ ...r, d: r.d + '\n' })), kompakt, info, uklid };
  if (ZKOUSKA) {
    mkdirSync(STAV, { recursive: true });
    for (const r of davka.radky) appendFileSync(join(STAV, 'radky.txt'), `${r.c}\t${r.h}\t${r.d}`);
    for (const r of kompakt) appendFileSync(join(STAV, 'kompakt.txt'), `${r.c}\t${r.h}\t${JSON.stringify(r.d)}\n`);
    writeFileSync(join(STAV, 'info.json'), JSON.stringify(info));
    for (const k of kontrola) appendFileSync(join(STAV, 'kontrola.jsonl'), `${JSON.stringify(k)}\n`);
    radky = []; kompakt = []; kontrola = [];
    return;
  }
  try {
    const r = await fetch(`${API}/api/watcher/liq`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Watcher-Token': TOKEN },
      body: JSON.stringify(davka), signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`perpyx ${r.status}`);
    radky = []; kompakt = [];
    if (uklid) posledniUklid = ted;
  } catch (e) {
    log('odeslání:', e.message);
    // Dlouhý výpadek: zahodit a začít čistě (každý coin dostane nový
    // řádek K) — rozdílové řádky bez základu by se rozbalily špatně.
    if (radky.length > 20000) {
      radky = []; kompakt = [];
      for (const st of stavCoinu.values()) st.hodina = -1;
    }
  }
}

/* ---------- seznam adres na disku (přežije restart) ---------- */

function ulozAdresy() {
  try {
    mkdirSync(STAV, { recursive: true });
    const d = [];
    for (const [a, u] of ucty) if (u.zdroj === 'z' || u.ntl > 0) d.push([a, u.zdroj, Math.round(u.ntl)]);
    writeFileSync(join(STAV, 'adresy.tmp'), JSON.stringify(d));
    renameSync(join(STAV, 'adresy.tmp'), join(STAV, 'adresy.json'));
  } catch (e) {
    log('uložení adres:', e.message);
  }
}

function nactiAdresy() {
  try {
    const d = JSON.parse(readFileSync(join(STAV, 'adresy.json'), 'utf8'));
    // Účty s pozicí nejdřív (podle velikosti), ostatní rozložit do hodiny.
    const ted = Date.now();
    for (const [a, zdroj, ntl] of d) pridej(a, zdroj, ntl > 0 ? -ntl : ted + Math.random() * HOD);
    log(`adresy z disku: ${d.length}`);
  } catch { /* první start */ }
}

/* ---------- start ---------- */

if (!ZKOUSKA && !TOKEN) { log('Chybí WATCHER_TOKEN.'); process.exit(1); }
log(`likvidace: start${ZKOUSKA ? ' (zkouška)' : ''}, stav v ${STAV}`);
nactiAdresy();
await obnovTrhy();
pripojObchody();
nactiZebricek();
setInterval(nactiZebricek, 6 * HOD);
setInterval(obnovTrhy, 30000);
setInterval(naplnFrontu, 2000);
setInterval(ulozAdresy, 10 * MIN);
for (let i = 0; i < SOUBEH; i += 1) pracovnik();
if (process.env.ZDI !== '0') {
  log(`zdi: start (verze ${VERZE_ZDI})`);
  spustZdi({ log, API, TOKEN, ZKOUSKA, STAV, limitTrhu: +process.env.ZDI_LIMIT || Infinity });
}

// Snímek 5 s po celé minutě (mark ceny jsou nejvýš 30 s staré).
(function planuj() {
  const za = MIN - (Date.now() % MIN) + 5000;
  setTimeout(async () => {
    try { udelejSnimek(); await odesli(); } catch (e) { log('snímek:', e.message); }
    planuj();
  }, za);
})();
