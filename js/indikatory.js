/**
 * Nastavení indikátorů.
 *
 * Každý indikátor má **schéma** — seznam polí, která si uživatel může
 * přenastavit. Obrazovka nastavení se z něj vygeneruje sama, takže přidat
 * další volbu (nebo celý další indikátor) znamená doplnit jen tenhle soubor.
 * Nic jiného se nemění.
 *
 * Typy polí:
 *   cislo    — číselník s mezemi
 *   prepinac — ano/ne
 *   barva    — výběr z palety
 *   vyber    — výběr z několika hodnot
 *
 * Pole s `param: n` se posílá knihovně jako `calcParams[n]`, tedy vstup
 * výpočtu. Ostatní pole jsou jen vzhled a stačí překreslit.
 */

import { t } from './i18n.js';

const PALETA = ['#16c784', '#ea3943', '#f0b90b', '#4c9aff', '#a78bfa', '#e6edf5', '#8b9bb0'];

/** Zdroj ceny pro výpočet. Čísly, ať jdou poslat jako calcParams. */
export const ZDROJE = ['close', 'open', 'high', 'low'];

/** Druhy klouzavého průměru. Pořadí je zároveň hodnota v calcParams. */
export const TYPY_MA = ['sma', 'ema', 'smma', 'wma'];

/**
 * Vyhladí řadu průměrem zvoleného typu. Vstup smí začínat prázdnými
 * hodnotami (rozběh indikátoru); průměr začne až po `delka` platných.
 *
 * Postup i rozběh jako v TradingView (ta.sma, ta.ema, ta.rma, ta.wma):
 *   sma  — prostý průměr posledních `delka` hodnot
 *   ema  — exponenciální, alfa = 2 / (delka + 1), začíná průměrem
 *   smma — Wilderův (RMA), alfa = 1 / delka, začíná průměrem
 *   wma  — lineárně vážený, nejnovější hodnota má největší váhu
 * EMA a SMMA se první hodnotou seedují prostým průměrem, ne první cenou.
 */
export function vyhladit(hodnoty, delka, typ = 'sma') {
  const n = Math.max(1, Math.round(delka) || 1);
  const out = new Array(hodnoty.length).fill(undefined);
  const platne = [];       // indexy v `hodnoty`, kde hodnota existuje
  hodnoty.forEach((v, i) => { if (Number.isFinite(v)) platne.push(i); });
  if (platne.length < n) return out;

  const x = platne.map((i) => hodnoty[i]);
  const vysl = new Array(x.length).fill(undefined);
  const prumer = (od, doKonce) => {
    let soucet = 0;
    for (let i = od; i < doKonce; i += 1) soucet += x[i];
    return soucet / (doKonce - od);
  };

  if (typ === 'ema' || typ === 'smma') {
    const alfa = typ === 'ema' ? 2 / (n + 1) : 1 / n;
    vysl[n - 1] = prumer(0, n);
    for (let i = n; i < x.length; i += 1) {
      vysl[i] = alfa * x[i] + (1 - alfa) * vysl[i - 1];
    }
  } else if (typ === 'wma') {
    const jmenovatel = (n * (n + 1)) / 2;
    for (let i = n - 1; i < x.length; i += 1) {
      let soucet = 0;
      for (let j = 0; j < n; j += 1) soucet += x[i - n + 1 + j] * (j + 1);
      vysl[i] = soucet / jmenovatel;
    }
  } else {
    for (let i = n - 1; i < x.length; i += 1) vysl[i] = prumer(i - n + 1, i + 1);
  }

  platne.forEach((idx, k) => { out[idx] = vysl[k]; });
  return out;
}

const cislo = (klic, vychozi, min, max, param) =>
  ({ klic, typ: 'cislo', vychozi, min, max, param });
const prepinac = (klic, vychozi) => ({ klic, typ: 'prepinac', vychozi });
const barva = (klic, vychozi) => ({ klic, typ: 'barva', vychozi, paleta: PALETA });
const vyber = (klic, vychozi, moznosti, param) =>
  ({ klic, typ: 'vyber', vychozi, moznosti, param });

/**
 * Označí pole jako podřízené jinému přepínači. Dokud je přepínač vypnutý,
 * obrazovka pole zešedne a nejde na něj sáhnout — jinak by uživatel ladil
 * barvu něčeho, co není vidět.
 */
const podle = (pole, prepinacKlic) => ({ ...pole, zavisi: prepinacKlic });

/** Výška vlastního panelu v procentech plochy grafu. */
const vyskaPanelu = () =>
  vyber('vyskaPanelu', 25,
    [20, 25, 30, 40].map((v) => ({ hodnota: v, popisek: `${v} %` })));

/**
 * Schémata. Skupiny (`sekce`) jen dělí dlouhý seznam nadpisem, jako to dělá
 * TradingView záložkami Inputs / Style.
 */
export const SCHEMATA = {
  VOL: [
    { sekce: 'inputs' },
    prepinac('zobrazitMa', true),
    podle(cislo('delkaMa', 20, 1, 200, 0), 'zobrazitMa'),
    prepinac('podlePredchozi', false),
    { sekce: 'style' },
    vyber('vyska', 22, [15, 22, 30, 40].map((v) => ({ hodnota: v, popisek: `${v} %` }))),
    vyber('pruhlednost', 0.45,
      [0.25, 0.45, 0.65, 0.85].map((v) => ({ hodnota: v, popisek: `${Math.round(v * 100)} %` }))),
    barva('barvaRust', '#16c784'),
    barva('barvaPokles', '#ea3943'),
    podle(barva('barvaMa', '#f0b90b'), 'zobrazitMa'),
  ],

  RSI: [
    { sekce: 'inputs' },
    cislo('delka', 14, 2, 100, 0),
    vyber('zdroj', 0, ZDROJE.map((z, i) => ({ hodnota: i, popisek: z, klicPopisku: `source.${z}` })), 2),
    prepinac('zobrazitMa', false),
    podle(vyber('typMa', 0, TYPY_MA.map((z, i) => ({ hodnota: i, popisek: z.toUpperCase() })), 3),
          'zobrazitMa'),
    podle(cislo('delkaMa', 14, 1, 100, 1), 'zobrazitMa'),
    { sekce: 'bands' },
    // Přepínač stojí před tím, co ovládá — zešedlá pole pak dávají smysl
    // na první pohled.
    prepinac('zobrazitPasma', true),
    podle(cislo('horniPasmo', 70, 1, 99), 'zobrazitPasma'),
    podle(cislo('dolniPasmo', 30, 1, 99), 'zobrazitPasma'),
    podle(prepinac('vypln', true), 'zobrazitPasma'),
    prepinac('pevnaStupnice', true),
    { sekce: 'style' },
    vyskaPanelu(),
    barva('barvaRsi', '#a78bfa'),
    podle(barva('barvaMa', '#f0b90b'), 'zobrazitMa'),
    podle(barva('barvaPasem', '#8b9bb0'), 'zobrazitPasma'),
  ],

  MACD: [
    { sekce: 'inputs' },
    cislo('kratka', 12, 1, 200, 0),
    cislo('dlouha', 26, 1, 200, 1),
    cislo('signal', 9, 1, 200, 2),
    { sekce: 'style' },
    vyskaPanelu(),
  ],

  KDJ: [
    { sekce: 'inputs' },
    cislo('delka', 9, 1, 200, 0),
    cislo('delkaK', 3, 1, 100, 1),
    cislo('delkaD', 3, 1, 100, 2),
    { sekce: 'style' },
    vyskaPanelu(),
  ],

  MA: [
    { sekce: 'inputs' },
    cislo('perioda1', 5, 1, 400, 0),
    cislo('perioda2', 10, 1, 400, 1),
    cislo('perioda3', 30, 1, 400, 2),
  ],

  EMA: [
    { sekce: 'inputs' },
    cislo('perioda1', 6, 1, 400, 0),
    cislo('perioda2', 12, 1, 400, 1),
    cislo('perioda3', 20, 1, 400, 2),
  ],

  BOLL: [
    { sekce: 'inputs' },
    cislo('perioda', 20, 1, 400, 0),
    cislo('odchylka', 2, 1, 10, 1),
  ],

  SAR: [
    { sekce: 'inputs' },
    cislo('krok', 2, 1, 50, 0),
    cislo('prirustek', 2, 1, 50, 1),
    cislo('strop', 20, 1, 100, 2),
  ],
};

/** Jen skutečná pole, bez oddělovačů sekcí. */
export const pole = (id) => (SCHEMATA[id] || []).filter((p) => p.klic);

export function vychoziNastaveni(id) {
  const out = {};
  pole(id).forEach((p) => { out[p.klic] = p.vychozi; });
  return out;
}

export const maNastaveni = (id) => pole(id).length > 0;

/* ---------- uložení ---------- */

const KLIC = (id) => `perpdesk.ind.${id}`;

/** Načtené hodnoty se drží v paměti — kreslení se na ně ptá každý snímek. */
const cache = new Map();

export function nactiNastaveni(id) {
  if (cache.has(id)) return cache.get(id);
  let ulozene = {};
  try {
    ulozene = JSON.parse(localStorage.getItem(KLIC(id)) || '{}');
  } catch {
    ulozene = {};
  }
  // Výchozí hodnoty vespod: po přidání nového pole nechybí starým uživatelům.
  const hodnoty = { ...vychoziNastaveni(id), ...ulozene };
  cache.set(id, hodnoty);
  return hodnoty;
}

export function ulozNastaveni(id, hodnoty) {
  const plne = { ...vychoziNastaveni(id), ...hodnoty };
  cache.set(id, plne);
  try {
    localStorage.setItem(KLIC(id), JSON.stringify(plne));
  } catch {
    /* plný storage — nastavení pak platí jen do zavření */
  }
  return plne;
}

export function resetNastaveni(id) {
  cache.delete(id);
  try {
    localStorage.removeItem(KLIC(id));
  } catch {
    /* nic */
  }
  return nactiNastaveni(id);
}

/* ---------- převod pro knihovnu ---------- */

/**
 * Pole označená `param` tvoří `calcParams`. Vrací null, když indikátor
 * žádný vstup výpočtu nemá — pak se jen překresluje.
 */
export function parametryVypoctu(id, hodnoty = nactiNastaveni(id)) {
  const vstupy = pole(id).filter((p) => p.param !== undefined);
  if (!vstupy.length) return null;
  const out = [];
  vstupy.forEach((p) => {
    const v = Number(hodnoty[p.klic]);
    out[p.param] = Number.isFinite(v) ? v : p.vychozi;
  });
  return out;
}

/** Popisky polí. Chybějící klíč spadne na samotný název, takže nic nezmizí. */
export const popisekPole = (id, klic) => t(`indSet.${klic}`);
export const popisekSekce = (sekce) => t(`indSet.section.${sekce}`);

/** Hodnota omezená mezemi schématu — zabrání nesmyslům jako perioda 0. */
export function omez(p, hodnota) {
  if (p.typ !== 'cislo') return hodnota;
  const v = Math.round(Number(hodnota));
  if (!Number.isFinite(v)) return p.vychozi;
  return Math.min(p.max, Math.max(p.min, v));
}
