/**
 * Sestavy coinů (vlastní seznamy v Trzích) a kategorie z CoinGecko.
 *
 * Tři vrstvy: všechny páry na burze → **kategorie** (AI, L1, Meme…) jako
 * filtr → **vlastní sestavy**, mezi kterými se přejíždí prstem.
 *
 * ⚠ Datový model je připravený na další burzy:
 *  - sestava drží položky jako `burza:pár` (`bybit:JUPUSDT`) — stejný coin
 *    na jiné burze je jiný pár s jinou cenou a jiným fundingem,
 *  - kategorie se vážou na **coin** (`JUP`), ne na pár — JUP je AI/DeFi
 *    token bez ohledu na to, kde se obchoduje.
 *
 * Modul nesahá na DOM. Kategorie se stahují z perpyx.com (jeden
 * předpočítaný soubor, viz web/tools/kategorie.py); CoinGecka se telefon
 * nikdy neptá. Jde o veřejná data, ne o burzu, proto to není v bybit.js.
 */
import { loadJson, saveJson, loadFavourites } from './store.js';
import { t } from './i18n.js';

export const BURZA = 'bybit';
export const VSE = 'all';                 // pseudo-sestava „všechny páry"
export const ZDROJ_KATEGORII = 'https://perpyx.com/data/kategorie.json';

const KLIC_SESTAVY = 'perpdesk.lists';
const KLIC_KATEGORIE = 'perpdesk.coinCategories';
const KLIC_OPRAVY = 'perpdesk.categoryOverrides';

export const polozka = (symbol, burza = BURZA) => `${burza}:${symbol}`;

/**
 * Pár na burze → zkratka coinu, pod kterou ho zná CoinGecko.
 * `1000PEPEUSDT` → PEPE, `10000SATSUSDT` → SATS, `SHIB1000USDT` → SHIB.
 * Násobky jsou vždy mocnina desítky od 100 výš — `1INCH` zůstává `1INCH`.
 */
// Páry, které Bybit pojmenoval jinak, než je zkratka coinu na CoinGecku.
const PREJMENOVANE = { RAYDIUM: 'RAY', LUNA2: 'LUNA' };

export function zkratkaCoinu(symbol) {
  let z = String(symbol).replace(/(USDT|USDC|PERP)$/, '');
  if (PREJMENOVANE[z]) return PREJMENOVANE[z];
  const predpona = /^(10{2,})([A-Z].*)$/.exec(z);
  if (predpona) z = predpona[2];
  const pripona = /^(.*[A-Z])(10{2,})$/.exec(z);
  if (pripona) z = pripona[1];
  return z;
}

/* ---------- sestavy ---------- */

let stav = null;

function nactiSestavy() {
  if (stav) return stav;
  stav = loadJson(KLIC_SESTAVY, null);
  if (!stav || !Array.isArray(stav.seznamy)) {
    // První spuštění: dosavadní oblíbené (hvězdičky) se stanou první sestavou,
    // ať o ně uživatel nepřijde.
    const oblibene = loadFavourites();
    stav = {
      verze: 1,
      aktivni: 'fav',
      seznamy: [{ id: 'fav', nazev: t('lists.favourites'), polozky: oblibene.map((s) => polozka(s)) }],
    };
    saveJson(KLIC_SESTAVY, stav);
  }
  // „Favourites" ztratily zvláštní význam (každý seznam je vlastní výběr),
  // výchozí název se proto změnil. Přejmenuje se jen nezměněný výchozí.
  const prvni = stav.seznamy.find((x) => x.id === 'fav');
  if (prvni && ['Favourites', 'Oblíbené'].includes(prvni.nazev)) {
    prvni.nazev = t('lists.favourites');
    saveJson(KLIC_SESTAVY, stav);
  }
  zajistiSeznam();
  return stav;
}

/*
 * Záložka „All" je zrušená (v0.46.0, přání uživatele): ve Watchlists jsou
 * jen vlastní seznamy. Vždy aspoň jeden existuje a jeden je vybraný —
 * po smazání posledního vznikne prázdný „My watchlist".
 */
function zajistiSeznam() {
  let zmena = false;
  if (!stav.seznamy.length) {
    stav.seznamy.push({ id: 'fav', nazev: t('lists.favourites'), polozky: [] });
    zmena = true;
  }
  if (!stav.seznamy.some((x) => x.id === stav.aktivni)) {
    stav.aktivni = stav.seznamy[0].id;
    zmena = true;
  }
  if (zmena) saveJson(KLIC_SESTAVY, stav);
}

const uloz = () => saveJson(KLIC_SESTAVY, stav);

/** Sestavy v pořadí, v jakém se přejíždějí (bez „všech párů"). */
export function seznamy() {
  return nactiSestavy().seznamy;
}

export function aktivni() {
  const s = nactiSestavy();
  return s.seznamy.some((x) => x.id === s.aktivni) ? s.aktivni : s.seznamy[0].id;
}

export function nastavAktivni(id) {
  const s = nactiSestavy();
  if (!s.seznamy.some((x) => x.id === id)) return;
  s.aktivni = id;
  uloz();
}

/** Pořadí pro přejíždění i v liště — jen vlastní seznamy (v0.46.0). */
export function poradi() {
  return seznamy().map((x) => x.id);
}

export function najdi(id) {
  return seznamy().find((x) => x.id === id) || null;
}

export function vytvor(nazev) {
  const s = nactiSestavy();
  const id = `l${Date.now().toString(36)}`;
  s.seznamy.push({ id, nazev: nazev.trim().slice(0, 30) || t('lists.untitled'), polozky: [] });
  uloz();
  return id;
}

export function prejmenuj(id, nazev) {
  const x = najdi(id);
  if (!x || !nazev.trim()) return;
  x.nazev = nazev.trim().slice(0, 30);
  uloz();
}

export function smaz(id) {
  const s = nactiSestavy();
  const i = s.seznamy.findIndex((x) => x.id === id);
  if (i < 0) return;
  s.seznamy.splice(i, 1);
  // Vybraný se stane soused (předchozí, u prvního následující).
  if (s.aktivni === id) s.aktivni = s.seznamy[Math.max(0, i - 1)]?.id ?? null;
  zajistiSeznam();
  uloz();
}

export function obsahuje(id, symbol) {
  return Boolean(najdi(id)?.polozky.includes(polozka(symbol)));
}

/** Je pár aspoň v jedné sestavě? (plná hvězdička v řádku) */
export function jeVNejake(symbol) {
  const p = polozka(symbol);
  return seznamy().some((x) => x.polozky.includes(p));
}

export function prepni(id, symbol) {
  const x = najdi(id);
  if (!x) return;
  const p = polozka(symbol);
  if (x.polozky.includes(p)) x.polozky = x.polozky.filter((q) => q !== p);
  else x.polozky.push(p);
  uloz();
}

/*
 * Limity seznamů (rozhodnutí uživatele 2026-10-08): bezplatná úroveň
 * jednou 10 párů na seznam a nejvýš 5 seznamů; vyšší úrovně předplatného
 * víc. Zatím **vypnuté** (beta je zdarma) — zapne se `zapnuto: true`.
 */
export const LIMITY = { zapnuto: false, paru: 10, seznamu: 5 };

export function jePlny(id) {
  return LIMITY.zapnuto && (najdi(id)?.polozky.length ?? 0) >= LIMITY.paru;
}

export function lzeZalozit() {
  return !LIMITY.zapnuto || seznamy().length < LIMITY.seznamu;
}

/** Přidá pár na konec seznamu (Trhy, tlačítko +). Vrací false, když už tam je nebo je plný. */
export function pridej(id, symbol) {
  const x = najdi(id);
  const p = polozka(symbol);
  if (!x || x.polozky.includes(p) || jePlny(id)) return false;
  x.polozky.push(p);
  uloz();
  return true;
}

export function odeber(id, symbol) {
  const x = najdi(id);
  if (!x) return;
  x.polozky = x.polozky.filter((q) => q !== polozka(symbol));
  uloz();
}

/**
 * Prohodí dva páry v seznamu (tažení dlaždice na jinou, v0.36.1 — přání
 * uživatele: dlaždice, na kterou se pustí, se objeví na místě přesouvané).
 */
export function prohod(id, symbolA, symbolB) {
  const x = najdi(id);
  if (!x) return;
  const a = x.polozky.indexOf(polozka(symbolA));
  const b = x.polozky.indexOf(polozka(symbolB));
  if (a < 0 || b < 0 || a === b) return;
  [x.polozky[a], x.polozky[b]] = [x.polozky[b], x.polozky[a]];
  uloz();
}

/** Přesune pár na dané místo v seznamu. */
export function presun(id, symbol, naIndex) {
  const x = najdi(id);
  const p = polozka(symbol);
  if (!x || !x.polozky.includes(p)) return;
  const bez = x.polozky.filter((q) => q !== p);
  bez.splice(Math.max(0, Math.min(naIndex, bez.length)), 0, p);
  x.polozky = bez;
  uloz();
}

/** Páry seznamu v pořadí, které si uživatel nastavil (jen naše burza). */
export function paryVPoradi(id) {
  const x = najdi(id);
  if (!x) return [];
  return x.polozky
    .filter((p) => p.startsWith(`${BURZA}:`))
    .map((p) => p.slice(BURZA.length + 1));
}

/*
 * Rozložení dlaždic v Trzích: `mrizka` (dvě a víc vedle sebe, jako
 * TabTrader) nebo `siroke` (přes celou šířku). Vlastní seznamy a „All"
 * si ho pamatují zvlášť; All začíná na širokých (přání uživatele).
 */
const KLIC_ROZLOZENI = 'perpdesk.marketsLayout';

export function rozlozeni(proVse) {
  const r = loadJson(KLIC_ROZLOZENI, {});
  return (proVse ? r.vse : r.seznam) || (proVse ? 'siroke' : 'mrizka');
}

export function nastavRozlozeni(proVse, hodnota) {
  const r = loadJson(KLIC_ROZLOZENI, {});
  r[proVse ? 'vse' : 'seznam'] = hodnota;
  saveJson(KLIC_ROZLOZENI, r);
}

/** Páry sestavy na naší burze (položky jiných burz se zatím přeskočí). */
export function paryVSestave(id) {
  const x = najdi(id);
  if (!x) return null;
  return new Set(x.polozky
    .filter((p) => p.startsWith(`${BURZA}:`))
    .map((p) => p.slice(BURZA.length + 1)));
}

/* ---------- kategorie ---------- */

let kategorie = null;   // { vytvoreno, stazeno, kategorie:[{id,nazev}], coiny:{ZKRATKA:[jméno,[i…]]} }
let opravy = null;      // { ZKRATKA: [id kategorie…] } — ruční úpravy uživatele

function nactiKategorie() {
  if (!kategorie) kategorie = loadJson(KLIC_KATEGORIE, null);
  if (!opravy) opravy = loadJson(KLIC_OPRAVY, {});
  return kategorie;
}

/** Jsou coiny identifikované? Poprvé je to povinný krok. */
export function maKategorie() {
  return Boolean(nactiKategorie()?.coiny);
}

export function kdyStazeno() {
  return nactiKategorie()?.stazeno || null;
}

/** Seznam kategorií v pořadí ze souboru: [{ id, nazev }]. */
export function vsechnyKategorie() {
  return nactiKategorie()?.kategorie || [];
}

/**
 * Stáhne kategorie. `httpGet` jde podstrčit (testy, později nativní
 * transport v APK); výchozí je fetch s časovým limitem.
 */
export async function stahniKategorie(httpGet = vychoziGet) {
  const data = await httpGet(ZDROJ_KATEGORII);
  if (!data || !Array.isArray(data.kategorie) || !data.coiny) {
    throw new Error('Unexpected categories file');
  }
  kategorie = { ...data, stazeno: Date.now() };
  saveJson(KLIC_KATEGORIE, kategorie);
  return kategorie;
}

async function vychoziGet(url) {
  const ctrl = new AbortController();
  const limit = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(limit);
  }
}

/** Id kategorií coinu — ruční oprava má přednost před CoinGeckem. */
export function kategorieCoinu(symbol) {
  const k = nactiKategorie();
  const zkratka = zkratkaCoinu(symbol);
  if (opravy[zkratka]) return opravy[zkratka];
  const zaznam = k?.coiny?.[zkratka];
  if (!zaznam) return [];
  return zaznam[1].map((i) => k.kategorie[i]?.id).filter(Boolean);
}

export function nazevKategorie(id) {
  return vsechnyKategorie().find((k) => k.id === id)?.nazev || id;
}

export function jeOpraveno(symbol) {
  nactiKategorie();
  return Boolean(opravy[zkratkaCoinu(symbol)]);
}

/** Přepne kategorii u coinu (ruční oprava). */
export function prepniKategorii(symbol, id) {
  const zkratka = zkratkaCoinu(symbol);
  const ted = new Set(kategorieCoinu(symbol));
  if (ted.has(id)) ted.delete(id);
  else ted.add(id);
  opravy[zkratka] = [...ted];
  saveJson(KLIC_OPRAVY, opravy);
}

/** Zruší ruční opravu, vrátí se kategorie z CoinGecka. */
export function zrusOpravu(symbol) {
  nactiKategorie();
  delete opravy[zkratkaCoinu(symbol)];
  saveJson(KLIC_OPRAVY, opravy);
}

/* ---------- řazení ---------- */

const KLIC_RAZENI = 'perpdesk.marketSort';
/** Klíč řazení → pole trhu z bybit.getTickers(). */
export const RAZENI = {
  volume: 'turnover',
  change: 'changePct',
  funding: 'funding',
  oi: 'openInterest',
};

export function razeni() {
  const r = loadJson(KLIC_RAZENI, null);
  return r && RAZENI[r.klic] ? r : { klic: 'volume', sestupne: true };
}

/** Vybrat řazení; opětovná volba téhož otočí směr. */
export function nastavRazeni(klic) {
  const ted = razeni();
  const nove = ted.klic === klic ? { klic, sestupne: !ted.sestupne } : { klic, sestupne: true };
  saveJson(KLIC_RAZENI, nove);
  return nove;
}

export function serad(trhy, { klic, sestupne }) {
  const pole = RAZENI[klic];
  const smer = sestupne ? -1 : 1;
  return [...trhy].sort((a, b) => ((a[pole] ?? 0) - (b[pole] ?? 0)) * smer);
}
