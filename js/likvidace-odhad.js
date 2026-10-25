/*
 * Odhad likvidační mapy z open interestu (v0.74.0, přání uživatele — jako
 * Coinglass). Bez sítě a bez DOM, ať jde ověřit v Node.
 *
 * Princip: kde OI za hodinu přibyl, tam se otevřely pozice za cenu té
 * hodiny. Nevíme páku ani směr, takže se přírůstek rozdělí podle typického
 * rozložení pák (PAKY) a napůl long / short (zelená svíčka trochu víc
 * longů). Každá část má likvidační cenu cena × (1 ∓ 1/páka + udržovací
 * marže). Úbytek OI zmenší všechny živé pozice poměrně (nevíme, kdo zavřel).
 * Pozice zanikne, když ji cena dojde (long: low ≤ likvidace, short: high ≥).
 *
 * Je to ODHAD — skutečné pozice jsou jen na Hyperliquidu (likvidace.js).
 */

export const PAKY = [[5, 0.1], [10, 0.25], [20, 0.25], [25, 0.15], [50, 0.15], [100, 0.1]];
const MARZE = 0.004;          // udržovací marže (likvidace kousek před 1/páka)
const PRAH = 0.002;           // pásma pod 0,2 % největšího se zahodí (šum)

/**
 * svicky: hodinové [{ time, open, high, low, close }] vzestupně.
 * rady: řady OI po burzách, každá [{ time, oi }] v coinech (hodinově).
 * krok: šířka cenového pásma. Vrací pruhy jako likvidace.pasy:
 * [{ od, do, cena, vyska, usd, min, posledni, long, prubeh }]; živé mají do = teď
 * a `ziva` (aplikace jim při každém kreslení posune konec na „teď“).
 */
export function odhadPasu(svicky, rady, krok, ted = Date.now()) {
  if (!svicky.length || !(krok > 0)) return [];
  // Přírůstek OI v USD za každou hodinu: součet rozdílů po burzách (burza,
  // které hodina chybí, nepřispěje — skok mezi burzami by vyrobil falešný objem).
  const pres = new Map();
  for (const rada of rady) {
    const podle = new Map(rada.map((b) => [Math.floor(b.time / 3600e3), b.oi]));
    for (const s of svicky) {
      const h = Math.floor(s.time / 3600e3);
      const a = podle.get(h - 1);
      const b = podle.get(h);
      if (a > 0 && b > 0) pres.set(s.time, (pres.get(s.time) || 0) + (b - a) * s.close);
    }
  }
  const zive = new Map();   // `${long}|${i}` → pruh
  // Průběh hodnoty pruhu (v0.76.0): [konec hodiny, usd, začátek hodiny] při
  // každé změně — graf jas mezi body plynule přechází jen v té hodině.
  const zapis = (p, s, konec) => {
    const b = p.prubeh[p.prubeh.length - 1];
    // Bod jen při změně o 3 % (drobné hodinové úbytky by nafoukly kreslení).
    if (b[0] === konec) b[1] = p.posledni;
    else if (Math.abs(p.posledni - b[1]) > b[1] * 0.03) p.prubeh.push([konec, p.posledni, s.time]);
  };
  const hotove = [];
  for (const s of svicky) {
    const konec = s.time + 3600e3;
    // Nejdřív likvidace cenou této svíčky (pozice otevřené dřív).
    for (const [k, p] of zive) {
      if (p.long ? s.low <= p.cena : s.high >= p.cena) {
        p.do = s.time;
        hotove.push(p);
        zive.delete(k);
      }
    }
    const d = pres.get(s.time) || 0;
    if (d < 0) {
      let celkem = 0;
      for (const p of zive.values()) celkem += p.posledni;
      const pomer = celkem > 0 ? Math.max(0, 1 + d / celkem) : 1;
      for (const p of zive.values()) {
        p.posledni *= pomer;
        p.min = Math.min(p.min, p.posledni);
        zapis(p, s, konec);
      }
    } else if (d > 0) {
      const podilLong = s.close >= s.open ? 0.55 : 0.45;
      const cena = (s.high + s.low + s.close) / 3;
      for (const [paka, vaha] of PAKY) {
        for (const long of [true, false]) {
          const likv = cena * (long ? 1 - 1 / paka + MARZE : 1 + 1 / paka - MARZE);
          // Už v této svíčce by byla likvidovaná — nezakládat.
          if (long ? s.low <= likv : s.high >= likv) continue;
          const i = Math.round(likv / krok);
          const usd = d * vaha * (long ? podilLong : 1 - podilLong);
          const k = `${long}|${i}`;
          const p = zive.get(k);
          if (p) {
            p.posledni += usd;
            p.usd = Math.max(p.usd, p.posledni);
            zapis(p, s, konec);
          } else {
            zive.set(k, { od: konec, do: ted, cena: i * krok, vyska: krok, usd, min: usd, posledni: usd, long, prubeh: [[konec, usd, s.time]] });
          }
        }
      }
    }
    for (const p of zive.values()) p.usd = Math.max(p.usd, p.posledni);
  }
  for (const p of zive.values()) { p.do = ted; p.ziva = true; hotove.push(p); }
  const max = Math.max(0, ...hotove.map((p) => p.usd));
  return hotove.filter((p) => p.usd >= max * PRAH && p.do > p.od);
}
