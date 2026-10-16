/**
 * Mezipaměť dat z burzy, která se už nemůžou změnit (v0.39.0, přání
 * uživatele — rychlost): uzavřené obchody a plnění. Co se jednou stáhlo,
 * zůstane v telefonu a příště se z burzy dotahuje jen to, co přibylo.
 *
 * ⚠ Jen v telefonu (IndexedDB — localStorage má ~5 MB a plnění za měsíce
 * ho přerostou). Nikdy na server ani do cloudové zálohy (IndexedDB se do
 * zálohy nedostane — ta bere jen `perpdesk.*` z localStorage).
 *
 * Data patří **účtu**: klíče se ukládají pod otiskem API klíče
 * (`nastavVlastnika`), každý účet má svůj oddíl, ať se historie dvou
 * účtů nesmíchá. ⚠ Dřív jiný klíč mezipaměť **smazal** — s víc účty
 * (v0.59) to znamenalo, že každé přepnutí účtu v Historii zahodilo
 * historii a plnění toho druhého a stahovaly se znovu od nuly (v0.59.4).
 * Odpojení burzy, zapomenutý PIN i odhlášení mažou všechno (`vymaz`,
 * volá store.clearCredentials a zaloha.vymazMistniData).
 *
 * Modul nesahá na DOM a o burze nic neví — ukládá, co mu kdo dá.
 */
const DB = 'perpyx-mezipamet';
const UZEL = 'data';
const KLIC_VLASTNIKA = '__vlastnik';

let dbSlib = null;
let vlastnik = null;          // otisk klíče, dokud není nastavený, nic se neukládá
let pripraveno = Promise.resolve();

function otevri() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbSlib ??= new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(UZEL);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
      r.onblocked = () => ok(null);
    } catch {
      ok(null);
    }
  });
  return dbSlib;
}

/** Jedna operace nad úložištěm; při jakékoli chybě `null` — mezipaměť je jen zrychlení. */
async function operace(rezim, fn) {
  const db = await otevri();
  if (!db) return null;
  return new Promise((ok) => {
    try {
      const tx = db.transaction(UZEL, rezim);
      const pozadavek = fn(tx.objectStore(UZEL));
      tx.oncomplete = () => ok(pozadavek?.result ?? null);
      tx.onerror = () => ok(null);
      tx.onabort = () => ok(null);
    } catch {
      ok(null);
    }
  });
}

async function otisk(text) {
  const data = new TextEncoder().encode(`perpyx|${text}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Klíč v úložišti: oddíl účtu + klíč dat. */
const vOddilu = (ucet, klic) => `u:${ucet}|${klic}`;

/**
 * Data z doby jednoho účtu (bez oddílu, s `__vlastnik`) se jednou převedou
 * do oddílu toho účtu — nic se neztratí.
 */
async function prevedStareKlice() {
  const stary = await operace('readonly', (s) => s.get(KLIC_VLASTNIKA));
  if (!stary) return;
  const klice = (await operace('readonly', (s) => s.getAllKeys())) || [];
  for (const k of klice) {
    if (k === KLIC_VLASTNIKA || String(k).startsWith('u:')) continue;
    const hodnota = await operace('readonly', (s) => s.get(k));
    await operace('readwrite', (s) => {
      s.put(hodnota, vOddilu(stary, k));
      return s.delete(k);
    });
  }
  await operace('readwrite', (s) => s.delete(KLIC_VLASTNIKA));
}

/** Mezipaměť pro účet s tímto klíčem (data ostatních účtů zůstávají). */
export function nastavVlastnika(apiKey) {
  pripraveno = (async () => {
    if (!apiKey) {
      vlastnik = null;
      return;
    }
    await prevedStareKlice();
    vlastnik = await otisk(apiKey);
  })().catch(() => { vlastnik = null; });
  return pripraveno;
}

export async function nacti(klic) {
  await pripraveno;
  if (!vlastnik) return null;
  return operace('readonly', (s) => s.get(vOddilu(vlastnik, klic)));
}

export async function uloz(klic, hodnota) {
  await pripraveno;
  if (!vlastnik) return;
  await operace('readwrite', (s) => s.put(hodnota, vOddilu(vlastnik, klic)));
}

export async function smaz(klic) {
  await pripraveno;
  if (!vlastnik) return;
  await operace('readwrite', (s) => s.delete(vOddilu(vlastnik, klic)));
}

/** Smaže oddíl jednoho účtu (odebrání připojení; ostatní účty zůstávají). */
export async function smazUcet(apiKey) {
  if (!apiKey) return;
  await pripraveno;
  const predpona = vOddilu(await otisk(apiKey), '');
  const klice = (await operace('readonly', (s) => s.getAllKeys())) || [];
  const jeho = klice.filter((k) => String(k).startsWith(predpona));
  if (jeho.length) await operace('readwrite', (s) => { jeho.forEach((k) => s.delete(k)); });
}

/** Smaže všechno (odpojení burzy, zapomenutý PIN, odhlášení). */
export function vymaz() {
  vlastnik = null;
  pripraveno = operace('readwrite', (s) => s.clear()).then(() => {});
  return pripraveno;
}
