/**
 * Ukládání nastavení. Výhradně localStorage v telefonu — klíče nikam neodcházejí
 * a nikdy se nesmí dostat do repozitáře.
 */

import { vymaz as vymazMezipamet } from './mezipamet.js';

const KEY_API = 'perpdesk.apiKey';
const KEY_SECRET = 'perpdesk.apiSecret';
// Burza, ke které klíč patří (v0.54.0), a její volby (Binance Demo Trading).
// Patří ke klíči: nezálohuje se a s klíčem se maže.
const KEY_BURZA = 'perpdesk.burza';
const KEY_BURZA_VOLBY = 'perpdesk.burzaVolby';
/*
 * Všechna připojení k burzám (v0.55.0, přání uživatele: víc burz najednou,
 * bez odebírání klíčů). [{ id, burza, volby, apiKey, apiSecret }]. Aktivní
 * připojení je zrcadlené v KEY_API / KEY_SECRET / KEY_BURZA — zbytek
 * aplikace se dál ptá jen na ně. ⚠ Obsahuje klíče: jen v telefonu, nikdy
 * do zálohy ani na server.
 */
const KEY_PRIPOJENI = 'perpdesk.pripojeni';
const KEY_HIDE = 'perpdesk.hideAmounts';

function read(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* plný/zakázaný storage — aplikace pak funguje jen do zavření */
  }
  oznacZmenu(key);
}

/*
 * Hlášení změn uložených dat — podle něj se spouští automatická cloudová
 * záloha (js/ucet.js). Klíče, relace a technické značky zálohu nespouští.
 */
const BEZ_ZALOHY = new Set([KEY_API, KEY_SECRET, KEY_BURZA, KEY_BURZA_VOLBY, KEY_PRIPOJENI, 'perpdesk.session', 'perpdesk.lastPing', 'perpdesk.lock',
  'perpdesk.coinCategories',
  // Poslední známé pozice pro okamžitý start: zapisují se každých 20 s
  // a do zálohy nepatří (js/app.js, ulozSnimek).
  'perpdesk.startSnimek', 'perpdesk.denikOtevreni',
  // Poslední známé ceny a mini-grafy párů ve Watchlists (js/app.js).
  'perpdesk.trhySnimek',
  // Uzavřené obchody za 30 dní pro statistiku na Pozicích (js/app.js).
  'perpdesk.stat30']);
const posluchaci = new Set();

export function naZmenuDat(fn) {
  posluchaci.add(fn);
}

export function oznacZmenu(key) {
  if (BEZ_ZALOHY.has(key)) return;
  posluchaci.forEach((fn) => {
    try {
      fn(key);
    } catch { /* posluchač nesmí shodit zápis */ }
  });
}

export function loadCredentials() {
  return { apiKey: read(KEY_API), apiSecret: read(KEY_SECRET) };
}

export function saveCredentials(apiKey, apiSecret) {
  write(KEY_API, apiKey.trim());
  write(KEY_SECRET, apiSecret.trim());
}

/** Zvolená burza; bez záznamu Bybit (všechny starší instalace). */
export function loadBurza() {
  let volby = {};
  try {
    volby = JSON.parse(localStorage.getItem(KEY_BURZA_VOLBY) || '{}') || {};
  } catch { /* poškozené — výchozí */ }
  return { id: read(KEY_BURZA) || 'bybit', volby };
}

export function saveBurza(id, volby = {}) {
  write(KEY_BURZA, id);
  write(KEY_BURZA_VOLBY, JSON.stringify(volby || {}));
}

/**
 * Seznam připojení. Starší instalace mají jen jeden klíč (KEY_API…) —
 * ten se při prvním čtení převede na první připojení.
 */
export function loadPripojeni() {
  let seznam = [];
  let surove = null;
  try {
    surove = localStorage.getItem(KEY_PRIPOJENI);
    seznam = JSON.parse(surove || '[]');
  } catch { /* poškozené — prázdné */ }
  if (!Array.isArray(seznam)) seznam = [];
  const { apiKey, apiSecret } = loadCredentials();
  // ⚠ Převod jen jednou — když seznam ještě nikdy neexistoval. Prázdný
  // seznam po odebrání posledního připojení se znovu nezakládá.
  if (surove === null && apiKey && apiSecret) {
    const { id, volby } = loadBurza();
    seznam = [{ id: `p${Date.now().toString(36)}`, burza: id, volby, apiKey, apiSecret }];
    write(KEY_PRIPOJENI, JSON.stringify(seznam));
  }
  return seznam;
}

function ulozPripojeni(seznam) {
  write(KEY_PRIPOJENI, JSON.stringify(seznam));
}

/** Přidá připojení (stejná burza + stejný klíč = aktualizace). Vrací id. */
export function pridejPripojeni({ burza, volby = {}, apiKey, apiSecret }) {
  const seznam = loadPripojeni();
  const stare = seznam.find((p) => p.burza === burza && p.apiKey === apiKey.trim());
  if (stare) {
    Object.assign(stare, { volby, apiSecret: (apiSecret || '').trim() });
    ulozPripojeni(seznam);
    return stare.id;
  }
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  seznam.push({ id, burza, volby, apiKey: apiKey.trim(), apiSecret: (apiSecret || '').trim() });
  ulozPripojeni(seznam);
  return id;
}

export function odeberPripojeni(id) {
  ulozPripojeni(loadPripojeni().filter((p) => p.id !== id));
}

/** Id aktivního připojení (to, jehož klíč je v KEY_API). */
export function aktivniPripojeni() {
  const { apiKey } = loadCredentials();
  const { id: burza } = loadBurza();
  return loadPripojeni().find((p) => p.apiKey === apiKey && p.burza === burza)?.id || null;
}

/** Udělá připojení aktivním — přepíše zrcadlo v KEY_API / KEY_BURZA. */
export function aktivujPripojeni(id) {
  const p = loadPripojeni().find((x) => x.id === id);
  if (!p) return false;
  saveCredentials(p.apiKey, p.apiSecret);
  saveBurza(p.burza, p.volby);
  return true;
}

/** Jen aktivní klíč pryč (odebrání posledního připojení). */
export function odeberAktivniKlic() {
  try {
    localStorage.removeItem(KEY_API);
    localStorage.removeItem(KEY_SECRET);
    localStorage.removeItem(KEY_BURZA);
    localStorage.removeItem(KEY_BURZA_VOLBY);
  } catch { /* nic */ }
}

export function clearCredentials() {
  try {
    localStorage.removeItem(KEY_API);
    localStorage.removeItem(KEY_SECRET);
    localStorage.removeItem(KEY_BURZA);
    localStorage.removeItem(KEY_BURZA_VOLBY);
    localStorage.removeItem(KEY_PRIPOJENI);
  } catch {
    /* nic */
  }
  // S klíčem odchází i uložená historie účtu (js/mezipamet.js).
  vymazMezipamet();
}

/** Adresa peněženky (Hyperliquid) — připojení bez secretu (v0.60.0). */
export const jeAdresa = (text) => /^0x[0-9a-fA-F]{40}$/.test(String(text || '').trim());

export function hasCredentials() {
  const { apiKey, apiSecret } = loadCredentials();
  return Boolean(apiKey && (apiSecret || jeAdresa(apiKey)));
}

/**
 * Kresby v grafu. Ukládají se podle páru, takže každý má vlastní a přežijí
 * zavření aplikace i restart telefonu.
 */
export function loadDrawings(symbol) {
  try {
    return JSON.parse(read(`perpdesk.drawings.${symbol}`) || '[]');
  } catch {
    return [];
  }
}

export function saveDrawings(symbol, drawings) {
  write(`perpdesk.drawings.${symbol}`, JSON.stringify(drawings || []));
}

/**
 * Naposledy použitý vzhled kresby (barva, tloušťka, průhlednost). Nová kresba
 * ho převezme i po restartu aplikace — „poslední barva" má platit, dokud ji
 * uživatel sám nezmění.
 */
export function loadDrawStyle() {
  try {
    return JSON.parse(read('perpdesk.drawStyle') || 'null');
  } catch {
    return null;
  }
}

export function saveDrawStyle(styl) {
  write('perpdesk.drawStyle', JSON.stringify(styl || null));
}

/*
 * Vzhled grafu po párech (v0.59.13, přání uživatele, jako TabTrader):
 * timeframe a šířka svíček. Klíč = klíč grafu (`JUPUSDT`, `binance:BTCUSDT`).
 */
export function loadChartView() {
  try {
    const v = JSON.parse(read('perpdesk.chartView') || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveChartView(klic, zmena) {
  if (!klic) return;
  const v = loadChartView();
  v[klic] = { ...v[klic], ...zmena };
  write('perpdesk.chartView', JSON.stringify(v));
}

/**
 * Cenové alarmy. Schválně **jeden společný seznam** se symbolem u každého
 * alarmu, ne rozdělený po párech: hlídat se musí i pár, který zrovna není
 * otevřený, a přehled všech alarmů pak bude stačit načíst z jednoho místa.
 */
export function loadAlarms() {
  try {
    const list = JSON.parse(read('perpdesk.alarms') || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveAlarms(alarmy) {
  write('perpdesk.alarms', JSON.stringify(alarmy || []));
}

/**
 * Zapnuté indikátory. Schválně společné pro všechny páry — kdo chce RSI,
 * chce ho všude, ne si ho zapínat u každého páru znovu.
 */
export function loadIndicators() {
  try {
    return JSON.parse(read('perpdesk.indicators') || '[]');
  } catch {
    return [];
  }
}

export function saveIndicators(nazvy) {
  write('perpdesk.indicators', JSON.stringify(nazvy || []));
}

/** Vrstvy grafu — co je vidět. Společné pro všechny páry. */
export function loadLayers() {
  try {
    return JSON.parse(read('perpdesk.layers') || '{}') || {};
  } catch {
    return {};
  }
}

export function saveLayers(vrstvy) {
  write('perpdesk.layers', JSON.stringify(vrstvy || {}));
}

export function loadMagnet() {
  return read('perpdesk.magnet') === '1';
}

export function saveMagnet(value) {
  write('perpdesk.magnet', value ? '1' : '0');
}

/** Oblíbené páry — řadí se v seznamu nahoru. */
export function loadFavourites() {
  try {
    return JSON.parse(read('perpdesk.favourites') || '[]');
  } catch {
    return [];
  }
}

export function saveFavourites(symboly) {
  write('perpdesk.favourites', JSON.stringify(symboly || []));
}

/** Skrytí všech ostatních párů, když uživateli stačí oblíbené. */
export function loadOnlyFavourites() {
  return read('perpdesk.onlyFavourites') === '1';
}

export function saveOnlyFavourites(value) {
  write('perpdesk.onlyFavourites', value ? '1' : '0');
}

/**
 * Řazení a filtr seznamu pozic (checkpoint 8). Drží se v telefonu, ať si to
 * uživatel nemusí přenastavovat při každém otevření.
 */
export function loadPositionSort() {
  const ulozene = read('perpdesk.posSort');
  return ulozene || 'value';
}

export function savePositionSort(klic) {
  write('perpdesk.posSort', klic);
}

export function loadPositionFilter() {
  return read('perpdesk.posFilter') || 'all';
}

export function savePositionFilter(klic) {
  write('perpdesk.posFilter', klic);
}

/**
 * Od kolika procent do likvidace se karta zbarví do červena. Výchozích 10 %
 * odpovídá tomu, co měla karta napevno předtím.
 */
export function loadLiqThreshold() {
  const n = Number(read('perpdesk.liqThreshold'));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function saveLiqThreshold(procenta) {
  write('perpdesk.liqThreshold', String(procenta));
}

/** Upozornění při zásahu SL nebo TP — zvuk, vibrace a pruh v UI. */
export function loadSltpAlerts() {
  return read('perpdesk.sltpAlerts') !== '0';
}

export function saveSltpAlerts(value) {
  write('perpdesk.sltpAlerts', value ? '1' : '0');
}

/** Jazyk aplikace. Výchozí je angličtina, ne nastavení prohlížeče. */
export function loadLanguage() {
  return read('perpdesk.language') || 'en';
}

export function saveLanguage(id) {
  write('perpdesk.language', id);
}

/** Skrytí částek — ať se dá koukat do telefonu na veřejnosti. */
export function loadHideAmounts() {
  return read(KEY_HIDE) === '1';
}

export function saveHideAmounts(value) {
  write(KEY_HIDE, value ? '1' : '0');
}

/**
 * Sestavy coinů v Trzích a kategorie. Ukládají se jako celek (JSON);
 * tvar dat hlídá js/sestavy.js, tady se jen čte a zapisuje.
 */
export function loadJson(klic, vychozi) {
  try {
    const text = read(klic);
    return text ? JSON.parse(text) : vychozi;
  } catch {
    return vychozi;
  }
}

export function saveJson(klic, hodnota) {
  write(klic, JSON.stringify(hodnota));
}
