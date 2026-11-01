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
 */

export const VYCHOZI = { delka: 14, vlevo: 5, vpravo: 3, odstupMin: 5, odstupMax: 60 };

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
  const { vlevo, vpravo, odstupMin, odstupMax } = { ...VYCHOZI, ...volby };
  const vysledek = [];
  let predDno = -1;
  let predVrchol = -1;
  const bod = (i, cena) => ({ i, cas: svice[i].timestamp, cena, rsi: rsiRada[i] });
  for (let p = vlevo; p + vpravo < svice.length; p += 1) {
    if (jePivot(rsiRada, p, vlevo, vpravo, true)) {
      const a = predDno;
      predDno = p;
      if (a >= 0 && p - a >= odstupMin && p - a <= odstupMax
          && rsiRada[p] > rsiRada[a] && Number(svice[p].low) < Number(svice[a].low)) {
        vysledek.push({ typ: 'byci', od: bod(a, Number(svice[a].low)), do: bod(p, Number(svice[p].low)), potvrzeno: p + vpravo });
      }
    }
    if (jePivot(rsiRada, p, vlevo, vpravo, false)) {
      const a = predVrchol;
      predVrchol = p;
      if (a >= 0 && p - a >= odstupMin && p - a <= odstupMax
          && rsiRada[p] < rsiRada[a] && Number(svice[p].high) > Number(svice[a].high)) {
        vysledek.push({ typ: 'medvedi', od: bod(a, Number(svice[a].high)), do: bod(p, Number(svice[p].high)), potvrzeno: p + vpravo });
      }
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
