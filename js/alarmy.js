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

/**
 * Typ alarmu podle toho, co hlídá:
 *   cena — pevná hladina (vodorovná čára),
 *   cara — šikmá čára ze dvou bodů; hlídaná úroveň se mění s časem
 *          a za koncem se extrapoluje, jako by čára pokračovala,
 *   cas  — okamžik v budoucnosti (svislá čára), cena do toho nemluví.
 */
export const TYPY = ['cena', 'cara', 'cas'];

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
    typ: 'cena',
    price: Number(cena) || 0,
    body: null,   // typ 'cara': dva body {timestamp, value}
    cas: null,    // typ 'cas': okamžik v ms
    smer: 'any',
    opakovat: false,
    platnostDnu: 0,
    vyprsi: null,
    zprava: '',
    barva: null,  // z kresby, ze které alarm vznikl; jinak výchozí tyrkysová
    zvuk: true,
    vibrace: true,
    notifikace: true,
    aktivni: true,
    spusteno: null,
  };
}

/**
 * Alarm z hotové kresby. Uživatel nakreslí čáru tam, kam se dívá, a zvonkem
 * z ní udělá alarm — nemusí pak hledat cenu na klávesnici.
 *
 * Svislá čára hlídá čas, dvoubodové čáry hlídají svou úroveň v čase,
 * jednobodové (vodorovná, cenová) hlídají pevnou hladinu.
 */
export function zKresby(symbol, kresba) {
  // Barva kresby jde s alarmem dál — uživatel má čáru poznat podle toho,
  // jak si ji nakreslil, ne podle toho, že z ní udělal alarm.
  const zaklad = { ...novy(symbol, 0), barva: kresba?.style?.color || null };
  const body = (kresba?.points || []).filter(Boolean);
  const prvni = body[0] || {};

  if (kresba?.name === 'verticalStraightLine') {
    return { ...zaklad, typ: 'cas', cas: Number(prvni.timestamp) || Date.now() };
  }
  if (body.length >= 2 && Number.isFinite(body[1]?.value)) {
    return {
      ...zaklad,
      typ: 'cara',
      body: body.slice(0, 2).map((b) => ({ timestamp: b.timestamp, value: b.value })),
    };
  }
  return { ...zaklad, typ: 'cena', price: Number(prvni.value) || 0 };
}

// Výpočty (úroveň, protnutí, doběhnutí) sdílí aplikace se serverovým
// hlídačem — jsou v alarmy-logika.js, tady se jen znovu vystavují.
import { rozsahCary, uroven, dobehla, protnuto } from './alarmy-logika.js';

export { rozsahCary, uroven, dobehla, protnuto };

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
    // Čas úpravy: podle něj server pozná, jestli úprava v telefonu je
    // novější než zaznění na serveru (a alarm se má znovu zapnout).
    zmeneno: Date.now(),
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
  let zmena = false;
  for (const a of seznam()) {
    if (a.symbol !== symbol || !a.aktivni || a.typ === 'cas') continue;
    // Doběhlá čára se vypne sama; visela by jinak jako aktivní alarm,
    // který už z principu nemá co hlídat.
    if (dobehla(a, ted)) {
      a.aktivni = false;
      zmena = true;
      continue;
    }
    if (!protnuto(a, predchozi, cena, ted)) continue;
    a.spusteno = ted;
    if (!a.opakovat) a.aktivni = false;
    spustene.push(a);
    zmena = true;
  }
  if (zmena) zapis();
  return spustene;
}

/**
 * Časové alarmy, kterým právě nastal čas. Jdou napříč páry — čas plyne
 * i tomu páru, který zrovna není otevřený, a cena do toho nemluví.
 * Opakování u nich nedává smysl, takže se vždy vypnou.
 */
export function zkontrolujCas(ted = Date.now()) {
  const spustene = [];
  for (const a of seznam()) {
    if (a.typ !== 'cas' || !a.aktivni) continue;
    if (!Number.isFinite(a.cas) || a.cas > ted) continue;
    a.spusteno = ted;
    a.aktivni = false;
    spustene.push(a);
  }
  if (spustene.length) zapis();
  return spustene;
}

/**
 * Alarm zazněl na serveru (hlídač, když telefon spal). Jednorázový se tu
 * vypne stejně jako po zaznění v telefonu — ale jen když zazněl **po
 * poslední úpravě**; uživatel ho mezitím mohl znovu zapnout.
 * Vrací true, když se něco změnilo.
 */
export function oznacZaznelo(id, cas) {
  const a = najdi(id);
  if (!a || !Number.isFinite(cas) || cas <= (a.spusteno || 0)) return false;
  if (cas <= (a.zmeneno || 0)) return false;
  a.spusteno = cas;
  if (!a.opakovat) a.aktivni = false;
  zapis();
  return true;
}

/** Po zavření grafu se reference zahodí, ať staré ceny nespouštějí alarmy. */
export function zapomenCenu(symbol) {
  if (symbol) posledniCeny.delete(symbol);
  else posledniCeny.clear();
}
