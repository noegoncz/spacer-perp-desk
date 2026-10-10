/**
 * Záloha a obnova dat aplikace do souboru.
 *
 * Záloha obsahuje všechno, co si uživatel v aplikaci vytvořil: seznamy
 * (watchlisty), kresby, alarmy, vybrané indikátory, vzhled kreseb,
 * opravy kategorií a nastavení.
 *
 * ⚠ **API klíč ani secret se do zálohy nikdy nedostanou.** Soubor
 * záloh putuje na Disk Google, do e-mailu, k jiným lidem — klíč patří
 * jen do telefonu (viz „Bezpečnost klíčů" v CLAUDE.md). Po obnově na
 * novém telefonu se klíč zadává znovu.
 *
 * Kategorie z CoinGecko se také nezálohují — jde je kdykoli stáhnout znovu.
 *
 * Modul nesahá na DOM kromě stažení souboru v prohlížeči.
 */

import { vymaz as vymazMezipamet } from './mezipamet.js';

const PREDPONA = 'perpdesk.';
const NEZALOHOVAT = new Set([
  'perpdesk.apiKey',
  'perpdesk.apiSecret',
  'perpdesk.coinCategories',
  // Přihlášení k účtu patří jen tomuto zařízení.
  'perpdesk.session',
  'perpdesk.lastPing',
  // Zámek (PIN, otisk) patří k tomuhle telefonu.
  'perpdesk.lock',
  'perpdesk.pushToken',
  // Poslední známé pozice pro okamžitý start — patří jen tomuto telefonu.
  'perpdesk.startSnimek',
]);

function klice() {
  const vse = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREDPONA) && !NEZALOHOVAT.has(k)) vse.push(k);
    }
  } catch { /* úložiště zakázané */ }
  return vse.sort();
}

/**
 * Co po odhlášení v telefonu zůstává: jen věci zařízení, ne účtu —
 * jazyk (ať úvodní obrazovka mluví stejně), stažené kategorie coinů
 * (veřejná data) a přečtené upozornění.
 */
const PO_ODHLASENI_ZUSTAVA = new Set([
  'perpdesk.language',
  'perpdesk.coinCategories',
  'perpdesk.disclaimerSeen',
]);

/**
 * Smaže z telefonu všechna data PerpyX kromě věcí zařízení: API klíč,
 * kresby, seznamy, alarmy, nastavení, zámek, přihlášení. Volá se po
 * odhlášení a smazání účtu (rozhodnutí uživatele 2026-10-03): data patří
 * účtu, ne telefonu — po přihlášení se vrátí z cloudové zálohy, API klíč
 * se zadá znovu (do cloudu schválně nejde).
 */
export function vymazMistniData() {
  // Uložené obchody a plnění (IndexedDB) taky — patří odhlášenému účtu.
  vymazMezipamet();
  try {
    const smazat = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREDPONA) && !PO_ODHLASENI_ZUSTAVA.has(k)) smazat.push(k);
    }
    smazat.forEach((k) => localStorage.removeItem(k));
  } catch { /* úložiště zakázané */ }
}

export function sestavZalohu() {
  const data = {};
  for (const k of klice()) data[k] = localStorage.getItem(k);
  return {
    aplikace: 'PerpyX',
    typ: 'zaloha',
    verze: 1,
    vytvoreno: new Date().toISOString(),
    verzeAplikace: self.APP_VERSION || '',
    data,
  };
}

const json = (text, vychozi) => {
  try {
    return JSON.parse(text);
  } catch {
    return vychozi;
  }
};

/** Co záloha obsahuje — ukáže se před obnovou, ať uživatel ví, co přepíše. */
export function souhrn(zaloha) {
  const d = zaloha.data || {};
  const seznamy = json(d['perpdesk.lists'], null)?.seznamy || [];
  const kresbyKlice = Object.keys(d).filter((k) => k.startsWith('perpdesk.drawings.'));
  const kresby = kresbyKlice.reduce((n, k) => n + (json(d[k], []).length || 0), 0);
  return {
    vytvoreno: zaloha.vytvoreno,
    seznamy: seznamy.length,
    paryVSeznamech: seznamy.reduce((n, x) => n + (x.polozky?.length || 0), 0),
    kresby,
    parySKresbami: kresbyKlice.length,
    alarmy: (json(d['perpdesk.alarms'], []) || []).length,
  };
}

/** Přečte soubor zálohy; vyhodí chybu, když to záloha PerpyX není. */
export function prectiZalohu(text) {
  const z = json(text, null);
  if (!z || z.aplikace !== 'PerpyX' || z.typ !== 'zaloha' || typeof z.data !== 'object') {
    throw new Error('not-a-backup');
  }
  if (z.verze > 1) throw new Error('newer-version');
  return z;
}

/**
 * Obnoví data ze zálohy. Stávající data (kromě klíčů a stažených
 * kategorií) se nahradí — záloha je celý stav, ne doplněk. Po obnově je
 * nutné stránku přenačíst: moduly (alarmy, seznamy) drží data v paměti.
 */
export function obnov(zaloha) {
  for (const k of klice()) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(zaloha.data)) {
    if (!k.startsWith(PREDPONA) || NEZALOHOVAT.has(k) || typeof v !== 'string') continue;
    localStorage.setItem(k, v);
  }
}

export function nazevSouboru() {
  return `perpyx-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

/**
 * Uloží zálohu ven z aplikace.
 *  - V APK přes nativní pluginy Filesystem + Share: soubor se nabídne
 *    ke sdílení (Disk Google, Gmail, Soubory…). WebView obyčejné
 *    stažení souboru neumí — odkaz s `download` tam nic neudělá.
 *  - V prohlížeči klasickým stažením.
 *  - Starší APK bez pluginů: zkopíruje text do schránky.
 * Vrací, jakou cestou se to povedlo: 'sdileni' | 'stazeni' | 'schranka'.
 */
export async function ulozVen(zaloha) {
  const text = JSON.stringify(zaloha, null, 1);
  const nazev = nazevSouboru();
  const pluginy = self.Capacitor?.Plugins;
  const vAplikaci = Boolean(self.Capacitor?.isNativePlatform?.());

  if (vAplikaci && pluginy?.Filesystem && pluginy?.Share) {
    const { uri } = await pluginy.Filesystem.writeFile({
      path: nazev, data: text, directory: 'CACHE', encoding: 'utf8',
    });
    await pluginy.Share.share({ title: nazev, files: [uri] });
    return 'sdileni';
  }
  if (vAplikaci) {
    await navigator.clipboard.writeText(text);
    return 'schranka';
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nazev;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'stazeni';
}
