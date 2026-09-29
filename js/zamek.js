/**
 * Zámek aplikace: PIN (4–6 číslic) a volitelně otisk prstu.
 *
 * Obojí je **volitelné** (rozhodnutí uživatele) a chrání soukromí — kdo
 * vezme odemčený telefon, neuvidí pozice a zůstatek. Nic ukrást nejde,
 * klíč je jen pro čtení.
 *
 * - Zámek = PIN. Otisk prstu je pohodlná zkratka **nad** PINem: čtečka
 *   selhává (mokrý prst, po restartu telefonu chce Android PIN), takže
 *   bez záložní cesty by se uživatel do aplikace nedostal.
 * - PIN se ukládá jen jako otisk PBKDF2 (sůl, 150 000 iterací), ne čitelně.
 * - Po pěti špatných pokusech se čeká, s každou další chybou déle.
 * - Zapomenutý PIN: zámek jde zrušit, ale **smažou se API klíče** —
 *   kresby, seznamy a nastavení zůstanou. Kdo telefon vezme, se tak ke
 *   klíči nedostane; majitel zadá klíč znovu.
 * - Nastavení zámku patří k zařízení: nezálohuje se (zaloha.js, store.js).
 *
 * Otisk prstu jen v APK přes nativní plugin `@capgo/capacitor-native-biometric`
 * (`window.Capacitor.Plugins.NativeBiometric`). V prohlížeči jen PIN.
 */
import { t } from './i18n.js';
import { loadJson, saveJson, clearCredentials } from './store.js';

const KLIC = 'perpdesk.lock';
const ITERACI = 150000;
export const DOBY = [0, 1, 5, 15];      // minut na pozadí, než se zamkne

let nastaveni = loadJson(KLIC, null);   // { salt, hash, delka, biometrie, poMinutach, chyb, cekatDo }
let zamceno = false;
let skrytoOd = null;
let zadano = '';
let poOdemceni = null;
// Výzva k otisku je systémové okno nad aplikací a Android kvůli němu může
// hlásit změnu viditelnosti. Bez téhle pojistky by se výzva po zavření
// hned vyvolala znovu — donekonečna.
let vyzvaBezi = false;
let vyzvaSkoncila = 0;

const biometrie = () => self.Capacitor?.Plugins?.NativeBiometric;

export const zapnuto = () => Boolean(nastaveni?.hash);
export const sBiometrii = () => Boolean(nastaveni?.biometrie);
export const poMinutach = () => nastaveni?.poMinutach ?? 0;

/** Umí telefon otisk prstu (a je nějaký uložený)? */
export async function biometrieDostupna() {
  const b = biometrie();
  if (!b || !self.Capacitor?.isNativePlatform?.()) return false;
  try {
    const r = await b.isAvailable({ useFallback: false });
    return Boolean(r?.isAvailable);
  } catch {
    return false;
  }
}

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');

async function otiskPinu(pin, saltHex) {
  const sul = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const klic = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bity = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sul, iterations: ITERACI }, klic, 256);
  return hex(bity);
}

const platnyPin = (pin) => /^\d{4,6}$/.test(pin);

/* ---------- nastavení ---------- */

export async function nastavPin(pin) {
  if (!platnyPin(pin)) throw new Error('invalid-pin');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  nastaveni = {
    ...(nastaveni || { biometrie: false, poMinutach: 0 }),
    salt, hash: await otiskPinu(pin, salt), delka: pin.length, chyb: 0, cekatDo: 0,
  };
  saveJson(KLIC, nastaveni);
}

export async function overPin(pin) {
  if (!zapnuto()) return true;
  return (await otiskPinu(pin, nastaveni.salt)) === nastaveni.hash;
}

export function vypni() {
  nastaveni = null;
  try {
    localStorage.removeItem(KLIC);
  } catch { /* nic */ }
}

export function nastavBiometrii(zap) {
  if (!zapnuto()) return;
  nastaveni.biometrie = Boolean(zap);
  saveJson(KLIC, nastaveni);
}

export function nastavDobu(minut) {
  if (!zapnuto()) return;
  nastaveni.poMinutach = DOBY.includes(minut) ? minut : 0;
  saveJson(KLIC, nastaveni);
}

/** Ověření otiskem prstu (pro zapnutí volby i pro odemčení). */
export async function overOtiskem() {
  const b = biometrie();
  if (!b) return false;
  try {
    await b.verifyIdentity({
      reason: t('lock.biometricReason'),
      title: 'PerpyX',
      subtitle: t('lock.biometricReason'),
      negativeButtonText: t('lock.usePin'),
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------- obrazovka zámku ---------- */

function el(id) {
  return document.getElementById(id);
}

function vykresliTecky() {
  const tecky = el('lockDots');
  if (!tecky) return;
  const n = nastaveni?.delka || 4;
  tecky.replaceChildren(...Array.from({ length: n }, (_, i) => {
    const s = document.createElement('span');
    s.className = i < zadano.length ? 'on' : '';
    return s;
  }));
}

function zprava(text = '') {
  const p = el('lockMsg');
  if (p) p.textContent = text;
}

function cekani() {
  const zbyva = Math.ceil(((nastaveni?.cekatDo || 0) - Date.now()) / 1000);
  return zbyva > 0 ? zbyva : 0;
}

async function zkusPin() {
  if (cekani()) {
    zprava(t('lock.wait', { s: cekani() }));
    zadano = '';
    vykresliTecky();
    return;
  }
  const pin = zadano;
  zadano = '';
  if (await overPin(pin)) {
    nastaveni.chyb = 0;
    nastaveni.cekatDo = 0;
    saveJson(KLIC, nastaveni);
    odemkni();
    return;
  }
  nastaveni.chyb = (nastaveni.chyb || 0) + 1;
  // Pět pokusů volně, pak 30 s, 60 s, 120 s…
  if (nastaveni.chyb >= 5) nastaveni.cekatDo = Date.now() + 30000 * 2 ** (nastaveni.chyb - 5);
  saveJson(KLIC, nastaveni);
  vykresliTecky();
  const obrazovka = el('lockScreen');
  obrazovka?.classList.remove('chyba');
  void obrazovka?.offsetWidth;   // restart animace zatřesení
  obrazovka?.classList.add('chyba');
  zprava(cekani() ? t('lock.wait', { s: cekani() }) : t('lock.wrong'));
}

function stisk(klavesa) {
  if (klavesa === 'smazat') {
    zadano = zadano.slice(0, -1);
  } else if (zadano.length < (nastaveni?.delka || 6)) {
    zadano += klavesa;
  }
  zprava('');
  vykresliTecky();
  if (zadano.length === (nastaveni?.delka || 4)) zkusPin();
}

async function zkusOtisk() {
  if (!sBiometrii() || vyzvaBezi || !zamceno) return;
  vyzvaBezi = true;
  const ok = await overOtiskem();
  vyzvaBezi = false;
  vyzvaSkoncila = Date.now();
  if (ok) odemkni();
}

/** Sama od sebe se výzva nabídne jen po skutečném návratu, ne hned po zavření. */
function nabidniOtisk() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - vyzvaSkoncila < 3000) return;
  setTimeout(zkusOtisk, 250);
}

function odemkni() {
  zamceno = false;
  zadano = '';
  const obrazovka = el('lockScreen');
  if (obrazovka) obrazovka.hidden = true;
  document.documentElement.classList.remove('zamceno');
  poOdemceni?.();
}

export function zamkni() {
  if (!zapnuto() || zamceno) return;
  zamceno = true;
  zadano = '';
  const obrazovka = el('lockScreen');
  if (!obrazovka) return;
  obrazovka.hidden = false;
  document.documentElement.classList.add('zamceno');
  obrazovka.classList.remove('chyba');
  zprava(cekani() ? t('lock.wait', { s: cekani() }) : '');
  vykresliTecky();
  const otisk = el('lockBioBtn');
  if (otisk) otisk.hidden = !sBiometrii();
  // Otisk se nabídne sám — to je celý smysl pohodlného odemykání.
  nabidniOtisk();
}

export const jeZamceno = () => zamceno;

/**
 * Zapomenutý PIN: zrušit zámek a smazat API klíče (ne ostatní data).
 * Potvrzení řeší volající.
 */
export function zapomenutyPin() {
  clearCredentials();
  vypni();
  odemkni();
}

/**
 * Zapojení: klávesnice, zamčení při startu a po návratu z pozadí.
 * `onZapomenuto` se zeptá na potvrzení a zavolá zapomenutyPin().
 */
export function spust({ onOdemceno, onZapomenuto } = {}) {
  poOdemceni = onOdemceno;
  document.querySelectorAll('#lockPad [data-k]').forEach((b) => {
    b.addEventListener('click', () => stisk(b.dataset.k));
  });
  el('lockBioBtn')?.addEventListener('click', zkusOtisk);
  el('lockForgotBtn')?.addEventListener('click', () => onZapomenuto?.());
  document.addEventListener('visibilitychange', () => {
    if (vyzvaBezi) return;   // skrytí kvůli výzvě k otisku není odchod z aplikace
    if (document.visibilityState === 'hidden') {
      skrytoOd = Date.now();
      // „Hned" = zamknout už při odchodu, ať náhled v přehledu aplikací
      // Androidu neukazuje obsah.
      if (zapnuto() && poMinutach() === 0) zamkni();
    } else if (skrytoOd && zapnuto() && Date.now() - skrytoOd >= poMinutach() * 60000) {
      if (zamceno) nabidniOtisk();
      else zamkni();
    }
  });
  if (zapnuto()) zamkni();
}
