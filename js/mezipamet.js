/**
 * Mezipaměť dat z burzy, která se už nemůžou změnit (v0.39.0, přání
 * uživatele — rychlost): uzavřené obchody a plnění. Co se jednou stáhlo,
 * zůstane v telefonu a příště se z burzy dotahuje jen to, co přibylo.
 *
 * ⚠ Jen v telefonu (IndexedDB — localStorage má ~5 MB a plnění za měsíce
 * ho přerostou). Nikdy na server ani do cloudové zálohy (IndexedDB se do
 * zálohy nedostane — ta bere jen `perpdesk.*` z localStorage).
 *
 * Data patří **jednomu účtu Bybitu**: ukládá se otisk API klíče
 * (`nastavVlastnika`) a jiný klíč mezipaměť smaže, ať se historie dvou
 * účtů nesmíchá. Odpojení burzy, zapomenutý PIN i odhlášení mažou
 * všechno (`vymaz`, volá store.clearCredentials a zaloha.vymazMistniData).
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

/** Mezipaměť pro účet s tímto klíčem; jiný klíč než minule ji vymaže. */
export function nastavVlastnika(apiKey) {
  pripraveno = (async () => {
    if (!apiKey) {
      vlastnik = null;
      return;
    }
    const novy = await otisk(apiKey);
    const ulozeny = await operace('readonly', (s) => s.get(KLIC_VLASTNIKA));
    if (ulozeny && ulozeny !== novy) await operace('readwrite', (s) => s.clear());
    await operace('readwrite', (s) => s.put(novy, KLIC_VLASTNIKA));
    vlastnik = novy;
  })().catch(() => { vlastnik = null; });
  return pripraveno;
}

export async function nacti(klic) {
  await pripraveno;
  if (!vlastnik) return null;
  return operace('readonly', (s) => s.get(klic));
}

export async function uloz(klic, hodnota) {
  await pripraveno;
  if (!vlastnik) return;
  await operace('readwrite', (s) => s.put(hodnota, klic));
}

export async function smaz(klic) {
  await pripraveno;
  await operace('readwrite', (s) => s.delete(klic));
}

/** Smaže všechno (odpojení burzy, zapomenutý PIN, odhlášení). */
export function vymaz() {
  vlastnik = null;
  pripraveno = operace('readwrite', (s) => s.clear()).then(() => {});
  return pripraveno;
}
