/**
 * Pravidla signálů v grafech — zatím RSI divergence (v0.90.0, přání
 * uživatele): notifikace jen u párů, které si uživatel zapne zvonkem
 * v panelu RSI, s timeframy a fází podle sebe. Přehled, vypnutí a mazání
 * v záložce Notifikace → RSI divergence (jako alarmy).
 *
 * Bez DOM. Hlídá server (server/signaly.mjs); pravidla tam jdou spolu
 * s alarmy (js/alarmy-server.js).
 *
 * Do budoucna (předplatné): počet pravidel může mít strop podle tarifu —
 * počítá se jen tady (`pocet`). Zatím neomezeně.
 */
import { loadJson, saveJson } from './store.js';

const KLIC = 'perpdesk.signals';

/** Timeframy, které hlídač umí (Bybit / Binance). */
export const INTERVALY = ['1', '5', '15', '30', '60', '240', 'D', 'W'];

/**
 * Kdy upozornit: 1 / 2 = rozpracovaná (svíček za pivotem), 3 = potvrzená.
 * v0.90.3 (uživatel): libovolná kombinace — pravidlo nese pole `faze`.
 */
export const FAZE = [1, 2, 3];
export const VYCHOZI_FAZE = [2];

/** Fáze pravidla jako seřazené pole (pravidla z v0.90.0–0.90.2 mají číslo). */
export function fazePravidla(p) {
  const f = Array.isArray(p?.faze) ? p.faze : [p?.faze];
  const platne = FAZE.filter((x) => f.map(Number).includes(x));
  return platne.length ? platne : [...VYCHOZI_FAZE];
}

/** Burzy, jejichž svíčky hlídač stahuje. */
const BURZY = ['bybit', 'binance'];
export function burzaPodporovana(klic) {
  const s = String(klic || '');
  const i = s.indexOf(':');
  return i < 0 || BURZY.includes(s.slice(0, i));
}

let pamet = null;

function nacti() {
  if (pamet) return pamet;
  const d = loadJson(KLIC, null);
  // Verze 1 (v0.89.x) hlídala plošně páry seznamů — pravidla po párech
  // ji nahrazují, nic se nepřevádí (uživatel: „nechci všude").
  pamet = Array.isArray(d?.pravidla) ? d.pravidla.filter((p) => p && p.id && p.klic) : [];
  for (const p of pamet) p.faze = fazePravidla(p);
  return pamet;
}

function zapis() {
  saveJson(KLIC, { verze: 2, pravidla: pamet });
}

export const vsechna = () => [...nacti()];
export const pocet = () => nacti().length;
export const najdi = (id) => nacti().find((p) => p.id === id) || null;
/** Pravidlo RSI divergence pro graf (klíč grafu „JUPUSDT" / „binance:JUPUSDT"). */
export const proGraf = (klic) => nacti().find((p) => p.klic === klic && p.typ === 'rsiDiv') || null;

export function uloz(pravidlo) {
  const seznam = nacti();
  const i = seznam.findIndex((p) => p.id === pravidlo.id);
  const novy = {
    typ: 'rsiDiv',
    faze: VYCHOZI_FAZE,
    aktivni: true,
    vytvoreno: Date.now(),
    ...(i >= 0 ? seznam[i] : {}),
    ...pravidlo,
    faze: fazePravidla(pravidlo.faze ? pravidlo : (i >= 0 ? seznam[i] : null)),
    intervaly: INTERVALY.filter((x) => (pravidlo.intervaly || []).includes(x)),
    zmeneno: Date.now(),
  };
  if (i >= 0) seznam[i] = novy;
  else seznam.push(novy);
  zapis();
  return novy;
}

export function smaz(id) {
  pamet = nacti().filter((p) => p.id !== id);
  zapis();
}

/** Server hlásí poslední signál (fired_at). Vrací true, když se něco změnilo. */
export function oznacSignal(id, cas) {
  const p = nacti().find((x) => x.id === id);
  if (!p || !cas || p.posledni === cas) return false;
  p.posledni = cas;
  zapis();
  return true;
}

export const noveId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Záznamy pro server (PUT /api/account/alarms), jeden na pravidlo. */
export function proServer() {
  return nacti().filter((p) => burzaPodporovana(p.klic) && p.intervaly?.length).map((p) => ({
    id: `sig-${p.id}`,
    typ: 'divergence',
    symbol: p.klic,
    symboly: [p.klic],
    intervaly: p.intervaly,
    faze: fazePravidla(p),
    aktivni: Boolean(p.aktivni),
    opakovat: true,
    zmeneno: p.zmeneno || 0,
  }));
}
