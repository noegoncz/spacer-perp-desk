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

/** Skrytí částek — ať se dá koukat do telefonu na veřejnosti. */
export function loadHideAmounts() {
  return read(KEY_HIDE) === '1';
}

export function saveHideAmounts(value) {
  write(KEY_HIDE, value ? '1' : '0');
}
