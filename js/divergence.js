/**
 * RSI divergence — výpočet bez úložiště a bez DOM (v0.89.0, přání
 * uživatele: hlídat signály na grafech, push ze serveru na 1h a 4h).
 *
 * ⚠ **Sdílí ho graf (js/chart.js, indikátor RSI) i hlídač na serveru
 * (server/signaly.mjs)** — ten si ho bere přímo z repozitáře. Divergence
 * z notifikace je tak v grafu na stejném místě. Modul nesmí importovat nic,
 * co v Node.js neexistuje.
 *
 * Postup jako vestavěný „RSI Divergence Indicator" v TradingView:
 * - vrchol / dno RSI (pivot) = hodnota větší / menší než `vlevo` svíček
 *   před a `vpravo` svíček po ní,
 * - porovná se s **předchozím** pivotem téhož druhu, mezi nimi
 *   `odstupMin`–`odstupMax` svíček,
 * - **býčí**: RSI vyšší dno, cena (low) nižší dno;
 *   **medvědí**: RSI nižší vrchol, cena (high) vyšší vrchol.
 * Pivot je jistý až `vpravo` svíček po něm — tehdy je divergence potvrzená
 * a hlídač pošle push. TradingView má výchozí 5; 3 je kompromis, ať na 4h
 * signál nepřijde až za 20 hodin.
 *
 * Přísnější pravidla (v0.89.1, uživatel: „v grafu často divergence vůbec
 * není"). Holé pravidlo TradingView pouštělo i šum (RSI 41,3 → 41,8 při
 * ceně o 0,05 % níž, pivot RSI na svíčce, která cenově dnem nebyla):
 *  1. odstup pivotů 5–40 svíček (1h ≈ 1,7 dne, 4h ≈ 7 dní),
 *  2. RSI se liší aspoň o `minRsi` bodů,
 *  3. první pivot z pásma: býčí dno RSI ≤ `pasmoByci`, medvědí vrchol
 *     ≥ `pasmoMedvedi` — divergence uprostřed pásma nic neznamená,
 *  4. cena v obou bodech skutečný swing: extrém svíček ±`okoliCeny`
 *     kolem pivotu RSI je zároveň extrémem okna pivotu,
 *  5. druhý bod je nejnižší low (býčí) / nejvyšší high (medvědí) od prvního
 *     — cena mezi nimi níž / výš nebyla,
 *  6. RSI mezi pivoty spojnici neprotne (jinak čára vede „přes" křivku).
 */

export const VYCHOZI = {
  delka: 14, vlevo: 5, vpravo: 3, odstupMin: 5, odstupMax: 40,
  minRsi: 3, pasmoByci: 40, pasmoMedvedi: 60, okoliCeny: 2,
};

/** RSI Wilderovým vyhlazením, stejně jako indikátor v grafu. Před `delka` svíčkami undefined. */
export function rsi(svice, delka = VYCHOZI.delka, zdroj = 'close') {
  const rada = new Array(svice.length).fill(undefined);
  let rust = 0;
  let pokles = 0;
  for (let i = 1; i < svice.length; i += 1) {
    const zmena = Number(svice[i][zdroj]) - Number(svice[i - 1][zdroj]);
    const r = Math.max(0, zmena);
    const p = Math.max(0, -zmena);
    if (i <= delka) {
      rust += r / delka;
      pokles += p / delka;
    } else {
      rust = (rust * (delka - 1) + r) / delka;
      pokles = (pokles * (delka - 1) + p) / delka;
    }
    if (i < delka) continue;
    rada[i] = pokles === 0 ? 100 : 100 - 100 / (1 + rust / pokles);
  }
  return rada;
}

function jePivot(rada, p, vlevo, vpravo, dno) {
  const v = rada[p];
  if (!Number.isFinite(v) || p - vlevo < 0 || p + vpravo >= rada.length) return false;
  for (let j = p - vlevo; j <= p + vpravo; j += 1) {
    if (j === p) continue;
    const x = rada[j];
    if (!Number.isFinite(x)) return false;
    if (dno ? x <= v : x >= v) return false;
  }
  return true;
}

/**
 * Všechny divergence v řadě svíček (`{ timestamp, high, low, close }`).
 * Vrací `[{ typ: 'byci'|'medvedi', od, do, potvrzeno }]`, kde `od` / `do`
 * jsou body `{ i, cas, cena, rsi }` a `potvrzeno` index svíčky, kdy je
 * druhý pivot jistý.
 */
export function divergence(svice, rsiRada = rsi(svice), volby = {}) {
  const v = { ...VYCHOZI, ...volby };
  const { vlevo, vpravo, odstupMin, odstupMax } = v;
  const vysledek = [];
  let predDno = -1;
  let predVrchol = -1;
  const low = (i) => Number(svice[i].low);
  const high = (i) => Number(svice[i].high);
  const bod = (i, cena, iCeny) => ({ i, cas: svice[i].timestamp, cena, rsi: rsiRada[i], iCeny });

  /** Cenový extrém kolem pivotu RSI, když je to skutečný swing (pravidlo 4). */
  function swing(p, dno) {
    const cena = dno ? low : high;
    const lepsi = (x, y) => (dno ? x < y : x > y);
    let k = -1;
    for (let j = Math.max(0, p - v.okoliCeny); j <= Math.min(svice.length - 1, p + v.okoliCeny); j += 1) {
      if (k < 0 || lepsi(cena(j), cena(k))) k = j;
    }
    for (let j = Math.max(0, p - vlevo); j <= Math.min(svice.length - 1, p + vpravo); j += 1) {
      if (lepsi(cena(j), cena(k))) return null;
    }
    return k;
  }

  function platna(a, p, dno) {
    if (a < 0 || p - a < odstupMin || p - a > odstupMax) return null;
    const ra = rsiRada[a];
    const rp = rsiRada[p];
    // 2 + 3: RSI výš / níž o dost a první bod z pásma.
    if (dno ? rp - ra < v.minRsi || ra > v.pasmoByci : ra - rp < v.minRsi || ra < v.pasmoMedvedi) return null;
    const ka = swing(a, dno);
    const kp = swing(p, dno);
    if (ka === null || kp === null) return null;
    const cena = dno ? low : high;
    // Cena: nižší dno / vyšší vrchol.
    if (dno ? cena(kp) >= cena(ka) : cena(kp) <= cena(ka)) return null;
    // 5: mezi body cena druhý bod nepřekonala.
    for (let j = ka + 1; j < kp; j += 1) if (dno ? cena(j) < cena(kp) : cena(j) > cena(kp)) return null;
    // 6: RSI mezi pivoty zůstává na své straně spojnice.
    for (let j = a + 1; j < p; j += 1) {
      const cara = ra + ((rp - ra) * (j - a)) / (p - a);
      if (dno ? rsiRada[j] < cara : rsiRada[j] > cara) return null;
    }
    return { od: bod(a, cena(ka), ka), do: bod(p, cena(kp), kp), potvrzeno: p + vpravo };
  }

  for (let p = vlevo; p + vpravo < svice.length; p += 1) {
    if (jePivot(rsiRada, p, vlevo, vpravo, true)) {
      const d = platna(predDno, p, true);
      predDno = p;
      if (d) vysledek.push({ typ: 'byci', ...d });
    }
    if (jePivot(rsiRada, p, vlevo, vpravo, false)) {
      const d = platna(predVrchol, p, false);
      predVrchol = p;
      if (d) vysledek.push({ typ: 'medvedi', ...d });
    }
  }
  return vysledek;
}

/** Divergence potvrzené právě poslední svíčkou řady (ta musí být uzavřená). */
export function novaDivergence(svice, volby = {}) {
  const posledni = svice.length - 1;
  return divergence(svice, rsi(svice, volby.delka ?? VYCHOZI.delka), volby)
    .filter((d) => d.potvrzeno === posledni);
}
