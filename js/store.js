/**
 * Ukládání nastavení. Výhradně localStorage v telefonu — klíče nikam neodcházejí
 * a nikdy se nesmí dostat do repozitáře.
 */

const KEY_API = 'perpdesk.apiKey';
const KEY_SECRET = 'perpdesk.apiSecret';
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
}

export function loadCredentials() {
  return { apiKey: read(KEY_API), apiSecret: read(KEY_SECRET) };
}

export function saveCredentials(apiKey, apiSecret) {
  write(KEY_API, apiKey.trim());
  write(KEY_SECRET, apiSecret.trim());
}

export function clearCredentials() {
  try {
    localStorage.removeItem(KEY_API);
    localStorage.removeItem(KEY_SECRET);
  } catch {
    /* nic */
  }
}

export function hasCredentials() {
  const { apiKey, apiSecret } = loadCredentials();
  return Boolean(apiKey && apiSecret);
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
