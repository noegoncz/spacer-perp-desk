// Zdi v knize příkazů — výpočet sdílený serverem (server/zdi.mjs)
// a aplikací (první pohled na coin, který server ještě nesleduje).
// Nesmí importovat nic, co v Node neexistuje (jako js/likvidace-format.js).
//
// Zeď = cenové pásmo (~0,1 % ceny, stejný krok jako likvidační mapa),
// ve kterém leží výrazně víc než obvykle na té straně knihy: aspoň
// NASOBEK × medián neprázdných pásem a aspoň MIN_ZED_USD. Jen do ±ROZSAH
// od středu knihy, nejvýš MAX_NA_STRANU zdí na stranu (největší).
//
// Sledování v čase (`Sledovani`): zeď = strana + index pásma. Každou
// minutu se porovná s předchozí; drží si od kdy stojí, nejmenší
// a největší velikost. Zeď, která chybí víc než TOLERANCE minut, je
// hotová; ukládají se jen ty, které stály aspoň MIN_TRVANI.

import { krokCeny } from './likvidace-format.js';

export const ROZSAH_ZDI = 0.15;
// Pásma vzdálenosti od středu a kolik zdí z každého (v0.73.3, uživatel: po oddálení
// nebyly vidět vzdálené zdi — největší bývají u ceny a vytlačily je).
export const PASMA_VZDALENOSTI = [[0.02, 4], [0.06, 4], [Infinity, 4]];
export const NASOBEK = 5;
export const NASOBEK_HL = 2.5;
export const MIN_ZED_USD = 25000;
export const MAX_NA_STRANU = 12;
export const TOLERANCE = 2;           // minut bez zdi, než se uzavře
export const MIN_TRVANI = 2 * 60000;  // kratší zdi se neukládají (šum)

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// Tři platné číslice — drobné kolísání nevyrábí změnu.
export function zaokrouhli(v) {
  if (!v) return 0;
  const rad = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 2);
  return Math.round(v / rad) * rad;
}

/**
 * Zdi jedné knihy. bids / asks = iterovatelné [cena, množství] (čísla).
 * krok = pevný krok pásma (server ho drží hodinu, ať se indexy nemění);
 * bez něj se spočítá ze středu. nasobek: Hyperliquid dává jen 20 hrubých
 * úrovní na stranu — medián je tam vysoko, stačí NASOBEK_HL. Vrací { mid, krok, zdi: [[strana, i, usd]] }
 * (strana 0 = nákup / bid, 1 = prodej / ask), nebo null u prázdné knihy.
 */
export function najdiZdi(bids, asks, krok = 0, nasobek = NASOBEK) {
  let bestBid = 0;
  let bestAsk = Infinity;
  for (const [p] of bids) if (p > bestBid) bestBid = p;
  for (const [p] of asks) if (p < bestAsk) bestAsk = p;
  if (!(bestBid > 0) || !Number.isFinite(bestAsk)) return null;
  const mid = (bestBid + bestAsk) / 2;
  const k = krok || krokCeny(mid);
  const zdi = [];
  [bids, asks].forEach((strana, s) => {
    const pasma = new Map();
    for (const [p, q] of strana) {
      if (!(q > 0) || Math.abs(p / mid - 1) > ROZSAH_ZDI) continue;
      const i = Math.round(p / k);
      pasma.set(i, (pasma.get(i) || 0) + p * q);
    }
    const prah = Math.max(MIN_ZED_USD, nasobek * median([...pasma.values()]));
    const nad = [...pasma].filter(([, usd]) => usd >= prah).sort((a, b) => b[1] - a[1]);
    let dolni = 0;
    for (const [horni, kolik] of PASMA_VZDALENOSTI) {
      nad.filter(([i]) => { const v = Math.abs((i * k) / mid - 1); return v >= dolni && v < horni; })
        .slice(0, kolik)
        .forEach(([i, usd]) => zdi.push([s, i, zaokrouhli(usd)]));
      dolni = horni;
    }
  });
  return { mid, krok: k, zdi };
}

/**
 * Sledování zdí jednoho trhu v čase. `krok(t, vysledek)` jednou za minutu:
 * vrátí zdi, které právě skončily (stály aspoň MIN_TRVANI):
 * [strana, cena, od, do, min, max]. `ted()` = živé zdi
 * [strana, cena, usd, od, min, max]. Změna kroku pásma (cena se hodně
 * pohnula) všechny zdi uzavře — indexy by nesouhlasily.
 */
export class Sledovani {
  constructor() {
    this.krokPasma = 0;
    this.zdi = new Map();   // `${strana}:${i}` → { s, i, usd, od, min, max, posledni }
  }

  krok(t, v) {
    const hotove = [];
    const uzavri = (z, konec) => {
      if (konec - z.od >= MIN_TRVANI) hotove.push([z.s, z.i * this.krokPasma, z.od, konec, z.min, z.max]);
    };
    if (!v) return hotove;
    if (this.krokPasma && v.krok !== this.krokPasma) {
      for (const z of this.zdi.values()) uzavri(z, z.posledni);
      this.zdi.clear();
    }
    this.krokPasma = v.krok;
    const videne = new Set();
    for (const [s, i, usd] of v.zdi) {
      const k = `${s}:${i}`;
      videne.add(k);
      const z = this.zdi.get(k);
      if (z) {
        z.usd = usd;
        z.min = Math.min(z.min, usd);
        z.max = Math.max(z.max, usd);
        z.posledni = t;
      } else {
        this.zdi.set(k, { s, i, usd, od: t, min: usd, max: usd, posledni: t });
      }
    }
    for (const [k, z] of this.zdi) {
      if (videne.has(k)) continue;
      if (t - z.posledni > TOLERANCE * 60000) {
        uzavri(z, z.posledni);
        this.zdi.delete(k);
      }
    }
    return hotove;
  }

  /** Živé zdi (viděné v posledním kroku). */
  ted() {
    let posledni = 0;
    for (const z of this.zdi.values()) posledni = Math.max(posledni, z.posledni);
    return [...this.zdi.values()].filter((z) => z.posledni === posledni)
      .map((z) => [z.s, z.i * this.krokPasma, z.usd, z.od, z.min, z.max]);
  }
}
