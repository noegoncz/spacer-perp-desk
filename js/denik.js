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
 * nikdy na burzu. Setupy a signály mají výchozí katalog (denik-katalog.js,
 * texty v i18n), uživatel přidává vlastní a odebírá.
 */
import * as store from './store.js';
import { t } from './i18n.js';
import { SETUPY, SIGNALY, STARE_NAZVY, NOVE_SIGNALY } from './denik-katalog.js';

const KLIC = 'perpdesk.denik';
/** Kolik ms smí být rozdíl mezi časem otevření z různých zdrojů. */
const TOLERANCE = 120000;
/** Řazení podle použití: počítají se poznámky za posledních 90 dní. */
const OKNO_POUZITI = 90 * 86400000;

let stav = null;
let surove = null;

const najdiStary = (mapa, nazev) => Object.keys(mapa).find((id) => mapa[id].some((x) => x.toLowerCase() === String(nazev).toLowerCase()));

/**
 * Verze 1 (v0.61–0.66): seznamy i poznámky nesly přeložené názvy, setup
 * Divergence / News a „confluence". Verze 2: položky s id, poznámky nesou
 * id; vlastní položky mají id `u…` a název. Smazaná vlastní položka zůstává
 * se `smazano`, ať staré poznámky mají název.
 */
function prevedVerzi1(s) {
  const vlastni = (seznam, nazev, navic = {}) => {
    const uz = seznam.find((x) => x.nazev?.toLowerCase() === nazev.toLowerCase());
    if (uz) return uz.id;
    const id = `u${Date.now().toString(36)}${seznam.length}`;
    seznam.push({ id, nazev, ...navic });
    return id;
  };
  const setupy = [];
  const signaly = [];
  const staraSetupy = Array.isArray(s.setupy) ? s.setupy : null;
  const staraConf = Array.isArray(s.confluence) ? s.confluence : null;
  const ma = (stara, id, mapa) => stara.some((n) => mapa[id].some((x) => x.toLowerCase() === String(n).toLowerCase()));
  // Výchozí, které uživatel dřív smazal, zůstanou smazané; nové (sweep,
  // candle, ma) přibudou vždy.
  SETUPY.forEach(({ id }) => {
    if (!staraSetupy || !STARE_NAZVY.setup[id] || ma(staraSetupy, id, STARE_NAZVY.setup)) setupy.push({ id });
  });
  SIGNALY.forEach(({ id }) => {
    if (!staraConf || !STARE_NAZVY.signal[id] || ma(staraConf, id, STARE_NAZVY.signal)) signaly.push({ id });
  });
  staraSetupy?.forEach((n) => {
    if (!najdiStary(STARE_NAZVY.setup, n) && !najdiStary(STARE_NAZVY.setupNaSignal, n)) vlastni(setupy, n);
  });
  staraConf?.forEach((n) => { if (!najdiStary(STARE_NAZVY.signal, n)) vlastni(signaly, n, { skupina: 'uroven' }); });
  const idSignalu = (n) => najdiStary(STARE_NAZVY.signal, n) || vlastni(signaly, n, { skupina: 'uroven' });
  Object.values(s.poznamky || {}).forEach((z) => {
    const v = z.vstup;
    if (!v) return;
    const sig = (v.confluence || []).map(idSignalu);
    let setup = null;
    if (v.setup) {
      const jakoSignal = najdiStary(STARE_NAZVY.setupNaSignal, v.setup);
      if (jakoSignal) {
        if (!signaly.some((x) => x.id === jakoSignal)) signaly.push({ id: jakoSignal });
        sig.push(jakoSignal);
      } else setup = najdiStary(STARE_NAZVY.setup, v.setup) || vlastni(setupy, v.setup);
    }
    v.setup = setup;
    v.signaly = [...new Set(sig)];
    delete v.confluence;
  });
  s.setupy = setupy;
  s.signaly = signaly;
  delete s.confluence;
}

function nacti() {
  // Čte se znovu, jen když se uložený text změnil (obnova zálohy,
  // odhlášení) — karty se kreslí několikrát za vteřinu.
  let text = null;
  try { text = localStorage.getItem(KLIC); } catch { /* bez úložiště */ }
  if (stav && text === surove) return stav;
  surove = text;
  const s = store.loadJson(KLIC, null);
  stav = s && typeof s === 'object' ? s : {};
  stav.poznamky ??= {};
  stav.nastaveni ??= { stitekReview: true };
  if (stav.verze !== 2) {
    prevedVerzi1(stav);
    stav.verze = 2;
    if (s) uloz();
  }
  const doplnit = NOVE_SIGNALY.filter((id) => !(stav.doplneneVychozi || []).includes(id));
  if (doplnit.length) {
    doplnit.forEach((id) => { if (!stav.signaly.some((x) => x.id === id)) stav.signaly.push({ id }); });
    stav.doplneneVychozi = [...(stav.doplneneVychozi || []), ...doplnit];
    if (s) uloz();
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

export const nastaveni = () => ({ ...nacti().nastaveni });

export function nastav(zmena) {
  Object.assign(nacti().nastaveni, zmena);
  uloz();
}

/* ---------- setupy a signály ---------- */

const katalog = (typ) => (typ === 'setupy' ? SETUPY : SIGNALY);

/** Položka s názvem, skupinou a kresbou (výchozí) nebo nápovědou (vlastní). */
function doplnPolozku(typ, p) {
  const k = katalog(typ).find((x) => x.id === p.id);
  if (k) {
    const pred = typ === 'setupy' ? 'setup' : 'sig';
    return {
      ...p, vychozi: true, skupina: typ === 'setupy' ? 'setup' : k.skupina, kresba: k.kresba,
      nazev: t(`journal.${pred}.${p.id}`), kratky: t(`journal.${pred}Short.${p.id}`),
      popis: t(`journal.${pred}Desc.${p.id}`), kdy: t(`journal.${pred}When.${p.id}`),
    };
  }
  return { ...p, vychozi: false, skupina: typ === 'setupy' ? 'setup' : (p.skupina || 'uroven'), kratky: p.nazev, popis: p.napoveda || '', kdy: '' };
}

/** Kolikrát byla položka použitá za posledních 90 dní. */
export function pouziti(typ) {
  const od = Date.now() - OKNO_POUZITI;
  const pocty = new Map();
  Object.values(nacti().poznamky).forEach((z) => {
    const v = z.vstup;
    if (!v || (v.cas || 0) < od) return;
    const ids = typ === 'setupy' ? (v.setup ? [v.setup] : []) : (v.signaly || []);
    ids.forEach((id) => pocty.set(id, (pocty.get(id) || 0) + 1));
  });
  return pocty;
}

/**
 * Položky k výběru ('setupy' | 'signaly'): nejpoužívanější napřed (90 dní),
 * při shodě v pořadí seznamu. Řadí se při otevření okna, ne během výběru.
 */
export function polozky(typ) {
  const pocty = pouziti(typ);
  return nacti()[typ].map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.smazano)
    .sort((a, b) => (pocty.get(b.p.id) || 0) - (pocty.get(a.p.id) || 0) || a.i - b.i)
    .map(({ p }) => ({ ...doplnPolozku(typ, p), pocet: pocty.get(p.id) || 0 }));
}

/** Položka podle id (i smazaná — kvůli starým poznámkám). */
export function polozka(typ, id) {
  const p = nacti()[typ].find((x) => x.id === id);
  if (p) return doplnPolozku(typ, p);
  return katalog(typ).some((x) => x.id === id) ? doplnPolozku(typ, { id }) : null;
}

export const nazev = (typ, id) => polozka(typ, id)?.nazev || '';

/** Vlastní setup / signál. Vrací id (u stejného názvu id existujícího). */
export function pridejPolozku(typ, { nazev: n, skupina = 'uroven', napoveda = '' }) {
  const s = nacti();
  const text = String(n || '').trim().slice(0, 40);
  if (!text) return null;
  const uz = polozky(typ).find((x) => x.nazev.toLowerCase() === text.toLowerCase());
  if (uz) return uz.id;
  const navic = { napoveda: String(napoveda || '').trim().slice(0, 200), ...(typ === 'signaly' ? { skupina } : {}) };
  const smazana = s[typ].find((x) => x.smazano && x.nazev?.toLowerCase() === text.toLowerCase());
  if (smazana) {
    delete smazana.smazano;
    Object.assign(smazana, navic);
    uloz();
    return smazana.id;
  }
  const id = `u${Date.now().toString(36)}${s[typ].length}`;
  s[typ].push({ id, nazev: text, ...navic });
  uloz();
  return id;
}

/** Úprava vlastní položky (název, skupina, nápověda). */
export function upravPolozku(typ, id, zmena) {
  const p = nacti()[typ].find((x) => x.id === id);
  if (!p || katalog(typ).some((x) => x.id === id)) return;
  if (zmena.nazev !== undefined) p.nazev = String(zmena.nazev).trim().slice(0, 40) || p.nazev;
  if (zmena.napoveda !== undefined) p.napoveda = String(zmena.napoveda).trim().slice(0, 200);
  if (zmena.skupina && typ === 'signaly') p.skupina = zmena.skupina;
  uloz();
}

/** Odebere položku z výběru. Výchozí jde vrátit, vlastní zůstane skrytá. */
export function smazPolozku(typ, id) {
  const s = nacti();
  if (katalog(typ).some((x) => x.id === id)) s[typ] = s[typ].filter((x) => x.id !== id);
  else {
    const p = s[typ].find((x) => x.id === id);
    if (p) p.smazano = true;
  }
  uloz();
}

/** Výchozí položky, které uživatel odebral (nabídnou se v úpravě zpátky). */
export const odebraneVychozi = (typ) => katalog(typ).filter(({ id }) => !nacti()[typ].some((x) => x.id === id)).map(({ id }) => doplnPolozku(typ, { id }));

export function vratVychozi(typ, id) {
  const s = nacti();
  if (katalog(typ).some((x) => x.id === id) && !s[typ].some((x) => x.id === id)) s[typ].push({ id });
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

/**
 * Obchod mimo statistiky (v0.85.0, přání uživatele): testovací obchody
 * a starší obchody z doby, kdy ještě nepsal plány. V Historii zůstává,
 * Edge a souhrny ho vynechají a nečeká na zhodnocení.
 */
export function nastavVynechani(k, ano) {
  const p = nacti().poznamky;
  if (ano) {
    p[k] = { ...(p[k] || { vytvoreno: Date.now(), behem: [] }), vynechano: Date.now() };
  } else if (p[k]) {
    delete p[k].vynechano;
    // Prázdná poznámka (jen kvůli vynechání) zmizí celá.
    if (!p[k].vstup && !p[k].zhodnoceni && !p[k].behem?.length && !p[k].metriky) delete p[k];
  }
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
