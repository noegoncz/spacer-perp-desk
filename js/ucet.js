/**
 * Účet PerpyX: přihlášení kódem z e-mailu, automatická cloudová záloha
 * a denní hlášení aktivity. Server je na perpyx.com (web/functions/api/account).
 *
 * Přihlašuje se **jednou na zařízení** — pak drží dlouhodobá relace
 * (token v úložišti telefonu), kterou server prodlužuje, dokud se
 * aplikace používá. Heslo neexistuje.
 *
 * ⚠ **API klíče se na server nikdy neposílají** — záloha je stejná jako
 * soubor zálohy (js/zaloha.js), který klíče vynechává, a server je pro
 * jistotu ještě jednou vyhodí.
 *
 * Účet je zatím volitelný: bez přihlášení aplikace funguje jako dřív.
 * Modul nesahá na DOM.
 */
import { loadJson, saveJson, naZmenuDat } from './store.js';
import * as zaloha from './zaloha.js';

export const API = 'https://perpyx.com/api/account';
const KLIC_RELACE = 'perpdesk.session';
const KLIC_PING = 'perpdesk.lastPing';
// Po změně dat se chvíli počká — kreslení nebo úprava seznamu jsou
// série změn, a každá nemá být samostatná záloha.
const ODKLAD_ZALOHY = 15000;

let relace = loadJson(KLIC_RELACE, null);   // { token, email }
let casovac = null;
let ceka = false;
const posluchaci = new Set();

/** Změny stavu (přihlášení, záloha) — pro vykreslení v nastavení. */
export function naZmenu(fn) {
  posluchaci.add(fn);
}
let stavZalohy = { kdy: null, chyba: null, probiha: false };
const ohlas = () => posluchaci.forEach((fn) => fn());

export const prihlasen = () => Boolean(relace?.token);
export const email = () => relace?.email || '';
export const posledniZaloha = () => stavZalohy;

async function dotaz(metoda, cesta, telo, { keepalive = false } = {}) {
  const hlavicky = { 'Content-Type': 'application/json' };
  if (relace?.token) hlavicky.Authorization = `Bearer ${relace.token}`;
  const ctrl = new AbortController();
  const limit = setTimeout(() => ctrl.abort(), 20000);
  const body = telo === undefined ? undefined : JSON.stringify(telo);
  let res;
  try {
    res = await fetch(API + cesta, {
      method: metoda,
      headers: hlavicky,
      body,
      signal: ctrl.signal,
      // keepalive přežije zavření stránky, ale prohlížeč ho pustí jen
      // s tělem do 64 kB — větší záloha jde obyčejně.
      keepalive: keepalive && (!body || body.length < 60000),
    });
  } finally {
    clearTimeout(limit);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && relace) {
    // Relace na serveru skončila (odhlášení jinde, smazaný účet, rok bez
    // používání) — tady se to jen srovná.
    zapomenRelaci();
  }
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.kod = data.error;
    e.data = data;
    throw e;
  }
  return data;
}

function zapomenRelaci() {
  relace = null;
  try {
    localStorage.removeItem(KLIC_RELACE);
  } catch { /* nic */ }
  stavZalohy = { kdy: null, chyba: null, probiha: false };
  ohlas();
}

/* ---------- přihlášení ---------- */

export async function posliKod(adresa) {
  return dotaz('POST', '/start', { email: adresa.trim() });
}

function nazevZarizeni() {
  const aplikace = self.Capacitor?.isNativePlatform?.() ? 'app' : 'web';
  const android = /Android [\d.]+/.exec(navigator.userAgent)?.[0] || '';
  return `PerpyX ${aplikace} ${android}`.trim();
}

/** Ověří kód; vrátí informaci o záloze na serveru (pro nabídku obnovy). */
export async function overKod(adresa, kod) {
  const d = await dotaz('POST', '/verify', { email: adresa.trim(), code: kod, device: nazevZarizeni() });
  relace = { token: d.token, email: d.email };
  saveJson(KLIC_RELACE, relace);
  ohlas();
  const me = await dotaz('GET', '/me');
  if (me.backup) stavZalohy = { ...stavZalohy, kdy: me.backup.created_at };
  ohlas();
  pingniDnes();
  return me;
}

export async function odhlas() {
  try {
    await dotaz('POST', '/logout');
  } catch { /* odhlášení na serveru se nepovedlo — tady se odhlásí stejně */ }
  zapomenRelaci();
}

export async function smazUcet() {
  await dotaz('POST', '/delete');
  zapomenRelaci();
}

export async function stav() {
  const me = await dotaz('GET', '/me');
  if (me.backup) stavZalohy = { ...stavZalohy, kdy: me.backup.created_at };
  ohlas();
  return me;
}

/* ---------- záloha ---------- */

export async function zalohujTed({ keepalive = false } = {}) {
  if (!prihlasen()) return null;
  clearTimeout(casovac);
  ceka = false;
  stavZalohy = { ...stavZalohy, probiha: true };
  ohlas();
  try {
    const d = await dotaz('PUT', '/backup', zaloha.sestavZalohu(), { keepalive });
    stavZalohy = { kdy: d.created, chyba: null, probiha: false };
    ohlas();
    return d;
  } catch (e) {
    stavZalohy = { ...stavZalohy, chyba: e.kod || 'offline', probiha: false };
    ohlas();
    throw e;
  }
}

/** Automatická záloha po změně dat (s odkladem, ať série změn = jedna záloha). */
function naplanuj() {
  if (!prihlasen()) return;
  ceka = true;
  clearTimeout(casovac);
  casovac = setTimeout(() => zalohujTed().catch(() => {}), ODKLAD_ZALOHY);
}

export const verzeZaloh = async () => (await dotaz('GET', '/backups')).versions || [];

export async function stahniZalohu(verze = null) {
  const d = await dotaz('GET', verze ? `/backup?version=${verze}` : '/backup');
  return zaloha.prectiZalohu(JSON.stringify(d.backup));
}

/** Má tenhle telefon nějaká vlastní data? (rozhoduje o nabídce obnovy po přihlášení) */
export function maMistniData() {
  const s = zaloha.souhrn(zaloha.sestavZalohu());
  return s.paryVSeznamech > 0 || s.kresby > 0 || s.alarmy > 0;
}

/* ---------- aktivita ---------- */

/** Jednou denně „účet byl dnes aktivní" + verze aplikace. */
export function pingniDnes() {
  if (!prihlasen()) return;
  const dnes = new Date().toISOString().slice(0, 10);
  let posledni = '';
  try {
    posledni = localStorage.getItem(KLIC_PING) || '';
  } catch { /* nic */ }
  if (posledni === dnes) return;
  dotaz('POST', '/ping', { version: self.APP_VERSION || '' })
    .then(() => {
      try {
        localStorage.setItem(KLIC_PING, dnes);
      } catch { /* nic */ }
    })
    .catch(() => { /* zkusí se příště */ });
}

/**
 * Zapojení: zálohovat po změnách dat, při odchodu z aplikace dozálohovat
 * rozdělanou změnu, pingnout při startu a návratu do popředí.
 */
export function spust() {
  naZmenuDat(naplanuj);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && ceka) zalohujTed({ keepalive: true }).catch(() => {});
    if (document.visibilityState === 'visible') pingniDnes();
  });
  if (prihlasen()) {
    pingniDnes();
    // Záloha při startu — server stejná data znovu neuloží, takže je to levné.
    setTimeout(() => zalohujTed().catch(() => {}), 5000);
  }
}
