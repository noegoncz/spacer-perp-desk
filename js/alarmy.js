/**
 * Cenové alarmy.
 *
 * Alarm je **vlastní věc, ne vlastnost kresby**: má hladinu, podmínku,
 * opakování, platnost i vlastní zprávu, a musí přežít smazání kreseb
 * i zavření grafu. Kreslicí nástroj „cenový alarm" ho proto nahradil
 * zvonek v liště a obrazovka s nastavením (viz CLAUDE.md, checkpoint 3).
 *
 * Modul nesahá na DOM ani na Bybit — jen počítá, vyhodnocuje protnutí
 * a ukládá. Díky tomu jde vyhodnocení otestovat bez prohlížeče.
 */

import * as store from './store.js';

/** Podmínka: protnutí kterýmkoli směrem, jen zdola nahoru, jen shora dolů. */
export const SMERY = ['any', 'up', 'down'];

/** Volby platnosti ve dnech; 0 znamená bez omezení. */
export const PLATNOSTI = [0, 1, 7, 30];

const DEN = 86400e3;

/** Načítá se líně a pak se drží v paměti — kontrola běží při každém ticku. */
let alarmy = null;

/**
 * Poslední viděná cena páru. Protnutí se pozná jen ze dvou cen po sobě,
 * takže první cena po otevření alarm nikdy nespustí — jen založí referenci.
 */
const posledniCeny = new Map();

function seznam() {
  if (!alarmy) alarmy = store.loadAlarms();
  return alarmy;
}

function zapis() {
  store.saveAlarms(alarmy || []);
}

export function vsechny() {
  return [...seznam()];
}

export function proPar(symbol) {
  return seznam().filter((a) => a.symbol === symbol);
}

export function najdi(id) {
  return seznam().find((a) => a.id === id) || null;
}

/** Čerstvý alarm na dané hladině — ještě neuložený, jen předvyplněný. */
export function novy(symbol, cena) {
  return {
    id: '',
    symbol,
    price: Number(cena) || 0,
    smer: 'any',
    opakovat: false,
    platnostDnu: 0,
    vyprsi: null,
    zprava: '',
    zvuk: true,
    vibrace: true,
    aktivni: true,
    spusteno: null,
  };
}

/**
 * Uloží nový nebo upravený alarm a vrátí ho i s doplněným `id`.
 * Platnost se počítá od uložení — úprava alarmu ji tedy prodlouží,
 * což je pro uživatele srozumitelnější než dopočítávání ke starému datu.
 */
export function uloz(alarm) {
  const list = seznam();
  const ulozeny = {
    ...alarm,
    id: alarm.id || `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    price: Number(alarm.price) || 0,
    vyprsi: alarm.platnostDnu ? Date.now() + alarm.platnostDnu * DEN : null,
  };
  const index = list.findIndex((a) => a.id === ulozeny.id);
  if (index >= 0) list[index] = ulozeny;
  else list.push(ulozeny);
  zapis();
  return ulozeny;
}

export function smaz(id) {
  alarmy = seznam().filter((a) => a.id !== id);
  zapis();
}

/** Vypršelé alarmy zmizí samy — platnost je na to od toho. */
export function uklidVyprsele(ted = Date.now()) {
  const list = seznam();
  const zbyle = list.filter((a) => !a.vyprsi || a.vyprsi > ted);
  if (zbyle.length === list.length) return false;
  alarmy = zbyle;
  zapis();
  return true;
}

/** Protnula cena hladinu ve směru, na který si uživatel počkal? */
export function protnuto(alarm, predchozi, cena) {
  const u = Number(alarm.price);
  if (!Number.isFinite(u) || !Number.isFinite(predchozi) || !Number.isFinite(cena)) return false;
  const nahoru = predchozi < u && cena >= u;
  const dolu = predchozi > u && cena <= u;
  if (alarm.smer === 'up') return nahoru;
  if (alarm.smer === 'down') return dolu;
  return nahoru || dolu;
}

/**
 * Nová cena páru. Vrací alarmy, které právě zazněly.
 *
 * Jednorázový alarm se po zaznění **vypne, ale nesmaže** — hladina zůstane
 * v grafu vidět a jde ji jedním klepnutím zase zapnout. Smazat ho musí
 * uživatel sám, aplikace mu práci nemaže.
 */
export function zkontroluj(symbol, cena, ted = Date.now()) {
  if (!symbol || !Number.isFinite(cena)) return [];
  uklidVyprsele(ted);

  const predchozi = posledniCeny.get(symbol);
  posledniCeny.set(symbol, cena);
  if (!Number.isFinite(predchozi)) return [];

  const spustene = [];
  for (const a of seznam()) {
    if (a.symbol !== symbol || !a.aktivni) continue;
    if (!protnuto(a, predchozi, cena)) continue;
    a.spusteno = ted;
    if (!a.opakovat) a.aktivni = false;
    spustene.push(a);
  }
  if (spustene.length) zapis();
  return spustene;
}

/** Po zavření grafu se reference zahodí, ať staré ceny nespouštějí alarmy. */
export function zapomenCenu(symbol) {
  if (symbol) posledniCeny.delete(symbol);
  else posledniCeny.clear();
}
