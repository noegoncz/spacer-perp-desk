/*
 * Deník obchodů (v0.61.0, přání uživatele 2026-10-18): proč jsem obchod
 * otevřel a jak dopadl. Model a úložiště, bez DOM (okna jsou v denik-ui.js).
 *
 * Poznámka patří k obchodu, ne k pozici: klíč = burza + pár + čas
 * otevírajícího plnění (`klic()`). Tentýž čas počítá Historie
 * (`seskupObchody` → `otevreno`) i adaptér burzy (`otevreniPozice`), takže
 * poznámka napsaná u běžící pozice se po zavření najde u obchodu v Historii.
 * Když čas otevření ještě není znám, uloží se pod náhradní klíč
 * (`…:?:Buy`) a při prvním dohledání se k obchodu přiřadí (`najdi`).
 *
 * Ukládá se do `perpdesk.denik` → jde do cloudové zálohy účtu (store.write),
 * nikdy na burzu. Setupy a confluence mají výchozí seznam v jazyce
 * aplikace, uživatel ho upravuje (přejmenovat se nedá, jen přidat / smazat).
 */
import * as store from './store.js';
import { t } from './i18n.js';

const KLIC = 'perpdesk.denik';
/** Kolik ms smí být rozdíl mezi časem otevření z různých zdrojů. */
const TOLERANCE = 120000;

let stav = null;
let surove = null;

function nacti() {
  // Čte se znovu, jen když se uložený text změnil (obnova zálohy,
  // odhlášení) — karty se kreslí několikrát za vteřinu.
  let text = null;
  try { text = localStorage.getItem(KLIC); } catch { /* bez úložiště */ }
  if (stav && text === surove) return stav;
  surove = text;
  const s = store.loadJson(KLIC, null);
  stav = s && typeof s === 'object' ? s : {};
  stav.verze = 1;
  stav.poznamky ??= {};
  stav.nastaveni ??= { stitekReview: true };
  if (!Array.isArray(stav.setupy)) {
    stav.setupy = ['breakout', 'retest', 'range', 'pullback', 'divergence', 'reversal', 'news']
      .map((k) => t(`journal.setup.${k}`));
  }
  if (!Array.isArray(stav.confluence)) {
    stav.confluence = ['sr', 'htf', 'trendline', 'rsiDiv', 'volume', 'funding', 'fib', 'orderBlock', 'news']
      .map((k) => t(`journal.conf.${k}`));
  }
  return stav;
}

function uloz() {
  store.saveJson(KLIC, stav);
  try { surove = localStorage.getItem(KLIC); } catch { /* bez úložiště */ }
}

/** Po obnově zálohy / odhlášení: příště číst znovu z úložiště. */
export function zapomen() {
  stav = null;
}

export const setupy = () => [...nacti().setupy];
export const confluence = () => [...nacti().confluence];
export const nastaveni = () => ({ ...nacti().nastaveni });

export function nastav(zmena) {
  Object.assign(nacti().nastaveni, zmena);
  uloz();
}

/** Přidá / odebere položku seznamu ('setupy' | 'confluence'). */
export function upravSeznam(seznam, polozka, pridat) {
  const s = nacti();
  const text = String(polozka || '').trim().slice(0, 40);
  if (!text || !Array.isArray(s[seznam])) return;
  s[seznam] = s[seznam].filter((x) => x.toLowerCase() !== text.toLowerCase());
  if (pridat) s[seznam].push(text);
  uloz();
}

/** Klíč obchodu. `otevreno` = čas otevírajícího plnění (ms), nebo null. */
export function klic(burza, symbol, otevreno, side = 'Buy') {
  return otevreno ? `${burza}:${symbol}:${Math.round(otevreno)}` : `${burza}:${symbol}:?:${side}`;
}

/**
 * Poznámka obchodu. Hledá přesný klíč, pak poznámku téhož páru s časem
 * otevření do 2 minut (jiný zdroj času), pak náhradní klíč bez času
 * napsaný během obchodu — ten se pod přesný klíč přesune.
 */
export function najdi(burza, symbol, otevreno, side = 'Buy', zavreno = null) {
  const p = nacti().poznamky;
  const presny = klic(burza, symbol, otevreno, side);
  if (p[presny]) return { klic: presny, ...p[presny] };
  if (!otevreno) return null;
  const predpona = `${burza}:${symbol}:`;
  for (const [k, v] of Object.entries(p)) {
    if (!k.startsWith(predpona)) continue;
    const cas = Number(k.slice(predpona.length));
    if (Number.isFinite(cas) && Math.abs(cas - otevreno) <= TOLERANCE) return { klic: k, ...v };
  }
  const nahradni = klic(burza, symbol, null, side);
  const v = p[nahradni];
  const vznik = v?.vstup?.cas || v?.vytvoreno;
  if (v && vznik >= otevreno - TOLERANCE && (!zavreno || vznik <= zavreno + TOLERANCE)) {
    p[presny] = v;
    delete p[nahradni];
    uloz();
    return { klic: presny, ...v };
  }
  return null;
}

/** Zapíše část poznámky ('vstup' | 'zhodnoceni') nebo přidá poznámku během obchodu. */
export function zapis(k, cast, data) {
  const p = nacti().poznamky;
  const z = p[k] || { vytvoreno: Date.now(), behem: [] };
  if (cast === 'behem') {
    const text = String(data?.text || '').trim();
    if (!text) return;
    z.behem = [...(z.behem || []), { cas: Date.now(), text }];
  } else {
    z[cast] = { ...data, cas: Date.now() };
  }
  p[k] = z;
  uloz();
}

export function smazPoznamkuBehem(k, cas) {
  const z = nacti().poznamky[k];
  if (!z) return;
  z.behem = (z.behem || []).filter((x) => x.cas !== cas);
  uloz();
}

/** Výsledek v R: PnL / riziko při vstupu (z SL). null, když SL nebyl. */
export function vysledekR(poznamka, pnl) {
  const riziko = poznamka?.vstup?.riziko;
  return riziko > 0 && Number.isFinite(pnl) ? pnl / riziko : null;
}

/**
 * Co aplikace uloží sama při vstupu: vstup, SL, TP, velikost, páka,
 * riziko 1R (vzdálenost SL × velikost) a plánovaný poměr R:R.
 */
export function automatickyVstup(p, interval = null) {
  const sl = Number(p?.stopLoss) || null;
  const tp = Number(p?.takeProfit) || null;
  const riziko = sl && p?.entry ? Math.abs(p.entry - sl) * p.size : null;
  const rr = sl && tp && p?.entry && Math.abs(p.entry - sl) > 0 ? Math.abs(tp - p.entry) / Math.abs(p.entry - sl) : null;
  return {
    entry: p?.entry ?? null, sl, tp, size: p?.size ?? null, value: p?.value ?? null,
    leverage: p?.leverage ?? null, riziko, rr, interval,
  };
}
