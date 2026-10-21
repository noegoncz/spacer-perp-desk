// Likvidační mapa Hyperliquidu — formát dat sdílený serverem
// (server/likvidace.mjs) a aplikací. Nesmí importovat nic, co v Node
// neexistuje (stejně jako js/alarmy-logika.js).
//
// Snímek = likvidace jednoho coinu v jednu minutu, sečtené do cenových
// pásem: index pásma = round(likvidační cena / krok), krok ~0,1 % ceny.
// Hodnota = velikost pozice × likvidační cena (USD, které se při
// likvidaci prodají / koupí), longy a shorty zvlášť.
//
// Ukládá se po řádcích (jeden řádek = jeden snímek, JSON pole):
//   [čas ms, mark, krok, 'K' | 'D', sledováno USD, [[index, long, short], …]]
// 'K' = celý snímek, 'D' = jen pásma změněná proti předchozímu řádku
// (0, 0 = pásmo zmizelo). Řádky jedné hodiny jednoho coinu jsou v databázi
// za sebou; každá hodina (i po restartu serveru) začíná řádkem 'K'.

export const ROZSAH = 0.25;   // pásma jen do ±25 % od ceny
export const MIN_USD = 500;   // menší součet v pásmu je šum

// Krok pásma: „hezké“ číslo 1 / 2 / 5 × 10^n, nejvýš 0,1 % ceny.
export function krokCeny(cena) {
  const syrove = cena * 0.001;
  const rad = 10 ** Math.floor(Math.log10(syrove));
  const m = syrove / rad;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * rad;
}

// Tři platné číslice — drobné kolísání nevyrábí změnu pásma.
export function zaokrouhli(v) {
  if (!v) return 0;
  const rad = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 2);
  return Math.round(v / rad) * rad;
}

// Pozice → pásma. pozice: [{ liq, v, l }] (likvidační cena, USD, long?).
// Přeskočí pozice mimo rozsah a ty, které cena už „vybrala“ (long s mark
// pod likvidací — burza ji právě likviduje, nebo už zlikvidovala).
export function snimek(pozice, mark, krok) {
  const pasma = new Map();
  for (const p of pozice) {
    if (!p.liq || Math.abs(p.liq / mark - 1) > ROZSAH) continue;
    if (p.l ? mark <= p.liq : mark >= p.liq) continue;
    const i = Math.round(p.liq / krok);
    const b = pasma.get(i) || [0, 0];
    b[p.l ? 0 : 1] += p.v;
    pasma.set(i, b);
  }
  for (const [i, b] of pasma) {
    b[0] = b[0] >= MIN_USD ? zaokrouhli(b[0]) : 0;
    b[1] = b[1] >= MIN_USD ? zaokrouhli(b[1]) : 0;
    if (!b[0] && !b[1]) pasma.delete(i);
  }
  return pasma;
}

// Pásma, která se změnila (pro řádek 'D').
export function rozdil(stare, nove) {
  const zmeny = [];
  for (const [i, b] of nove) {
    const s = stare.get(i);
    if (!s || s[0] !== b[0] || s[1] !== b[1]) zmeny.push([i, b[0], b[1]]);
  }
  for (const i of stare.keys()) if (!nove.has(i)) zmeny.push([i, 0, 0]);
  return zmeny;
}

export function radek(t, mark, krok, typ, sledovano, pasma) {
  const b = Array.isArray(pasma) ? pasma : [...pasma].map(([i, [l, s]]) => [i, l, s]);
  b.sort((x, y) => x[0] - y[0]);
  return JSON.stringify([t, +mark.toPrecision(6), krok, typ, Math.round(sledovano), b]);
}

// Řádky (text oddělený \n) → snímky v čase: [{ t, mark, krok, sledovano,
// pasma: Map }]. Řádek 'D' bez předchozího 'K' se zahodí (chybí základ).
export function rozbal(text, vysledek = []) {
  let pasma = null;
  for (const r of String(text).split('\n')) {
    if (!r) continue;
    let d;
    try { d = JSON.parse(r); } catch { continue; }
    const [t, mark, krok, typ, sledovano, zmeny] = d;
    if (typ === 'K') pasma = new Map();
    else if (!pasma || pasma.krok !== krok) continue;
    else pasma = new Map(pasma);
    pasma.krok = krok;
    for (const [i, l, s] of zmeny) {
      if (l || s) pasma.set(i, [l, s]);
      else pasma.delete(i);
    }
    vysledek.push({ t, mark, krok, sledovano, pasma });
  }
  return vysledek;
}
