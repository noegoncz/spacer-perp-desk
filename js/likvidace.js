/*
 * Likvidační mapa Hyperliquidu v grafu (v0.65.0, přání uživatele 2026-10-21):
 * stažení snímků z perpyx.com (sbírá je server/likvidace.mjs) a jejich
 * převod na pruhy v čase — pruh = cenové pásmo s likvidacemi od chvíle,
 * kdy se objevily, do chvíle, kdy zmizely (cena je vybrala, pozice se
 * zavřela) nebo do teď. Bez DOM; kreslí chart.js (vrstva `likvidace`).
 *
 * ⚠ Nesmí zpomalit graf (uživatel): stahuje se až po svíčkách, jen okno
 * načtených svíček, hotové hodiny se drží v paměti a znovu se nestahují.
 * Historie se plní od spuštění sběru (2026-10-21) — co server nenasbíral,
 * to v grafu není; pruhy se tak „doplňují“ postupně.
 */
import { rozbal, krokCeny } from './likvidace-format.js';
import { zkratkaCoinu } from './sestavy.js';

const API = 'https://perpyx.com/api/likvidace';
const HOD = 3600000;
const MAX_POKRYTI_R1 = 48 * HOD;   // minutové snímky nejvýš 2 dny zpátky (server je drží 3 dny)

// coin|r|krok → Map(hodina → text řádků); hotové hodiny se znovu nestahují
const pamet = new Map();
// coin → skutečný název na Hyperliquidu (null = nemá data)
const nazvy = new Map();

/** Kandidáti na název coinu na Hyperliquidu (kPEPE = 1000 PEPE). */
function kandidati(symbol, burza) {
  const zaklad = burza === 'hyperliquid'
    ? String(symbol).replace(/USDC$|USDT$/, '')
    : zkratkaCoinu(symbol);
  const z = zaklad.toUpperCase();
  const vysledek = [z];
  if (z.startsWith('K') && z.length > 2) vysledek.push(`k${z.slice(1)}`);
  vysledek.push(`k${z}`);
  return [...new Set(vysledek)];
}

async function stahni(coin, r, od, doKdy, krok = 0) {
  const u = `${API}?c=${encodeURIComponent(coin)}&r=${r}&od=${Math.floor(od)}&do=${Math.floor(doKdy)}${krok ? `&krok=${krok}` : ''}`;
  const odpoved = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!odpoved.ok) throw new Error(`liq ${odpoved.status}`);
  const d = await odpoved.json();
  return Array.isArray(d.hodiny) ? d.hodiny : [];
}

/** Hodiny z paměti + jen to, co ještě není hotové nebo chybí. */
async function hodiny(coin, r, od, doKdy, krok = 0) {
  const klic = `${coin}|${r}|${krok}`;
  let m = pamet.get(klic);
  if (!m) { m = new Map(); pamet.set(klic, m); }
  const ted = Date.now();
  const hotovaDo = Math.floor((ted - 2 * 60000) / HOD) * HOD;   // starší hodiny se už nemění
  // Stáhnout od nejstarší chybějící hodiny (hotové v paměti přeskočit).
  const skok = krok || HOD;
  let zacatek = Math.floor(od / skok) * skok;
  while (zacatek < hotovaDo && m.has(zacatek)) zacatek += skok;
  if (zacatek <= doKdy) {
    const nove = await stahni(coin, r, zacatek, doKdy, krok);
    // Prázdné hotové hodiny si pamatovat taky (ať se neptá pořád znovu).
    for (let h = zacatek; h < hotovaDo; h += skok) if (!m.has(h)) m.set(h, '');
    nove.forEach(([h, data]) => m.set(h, data));
    // Rozdělaná hodina se příště stáhne znovu.
    for (const h of m.keys()) if (h >= hotovaDo && !nove.some(([x]) => x === h)) m.delete(h);
  }
  return [...m.entries()].filter(([h]) => h >= Math.floor(od / skok) * skok && h <= doKdy).sort((a, b) => a[0] - b[0]);
}

/**
 * Snímky pro okno grafu. Krátké timeframy minutové (≤ 2 dny zpátky),
 * delší po 15 min (u timeframu ≥ 1 h jen jeden snímek na svíčku) +
 * minutové za poslední dvě hodiny (rozdělaná hodina ještě není sbalená).
 */
async function snimky(coin, od, doKdy, delkaSvicky) {
  const ted = Date.now();
  let radky = [];
  if (ted - od <= MAX_POKRYTI_R1) {
    radky = await hodiny(coin, 1, od, doKdy);
  } else {
    // Snímek aspoň 4× za svíčku, nejvýš po hodině (v0.74.4 — jeden snímek na
    // svíčku dělal na 4h mozaiku: pásma u ceny mezi snímky naskakovala a mizela).
    const krok = delkaSvicky >= 4 * HOD ? Math.floor(delkaSvicky / 4 / HOD) * HOD : 0;
    radky = await hodiny(coin, 15, Math.max(od, ted - 90 * 24 * HOD), doKdy, krok);
    const nedavno = await hodiny(coin, 1, ted - 2 * HOD, doKdy);
    const posledniKompakt = radky.length ? radky[radky.length - 1][0] : 0;
    radky = radky.concat(nedavno.filter(([h]) => h > posledniKompakt));
  }
  const vysledek = [];
  radky.forEach(([, data]) => rozbal(data, vysledek));
  return vysledek.sort((a, b) => a.t - b.t);
}

/**
 * Pruhy pro graf: [{ od, do, cena, vyska, usd, long }] + poslední mark
 * a čas posledního snímku. `null`, když coin na Hyperliquidu data nemá.
 */
/** Kolikrát širší pásmo než základních ~0,1 % ceny pro danou délku svíčky. */
export const nasobekPasma = (delkaSvicky) => Math.max(1, ((delkaSvicky || 0) / (30 * 60000)) ** 0.25);

export async function pasy({ symbol, burza, od, doKdy, delkaSvicky }) {
  let coin = nazvy.get(`${burza}:${symbol}`);
  if (coin === null) return null;
  let s = [];
  if (coin) {
    s = await snimky(coin, od, doKdy, delkaSvicky);
  } else {
    for (const c of kandidati(symbol, burza)) {
      s = await snimky(c, od, doKdy, delkaSvicky);
      if (s.length) { coin = c; break; }
    }
    // Bez dat ani za poslední hodiny = coin na Hyperliquidu není (nebo nemá
    // likvidace). Zapamatuje se jen do konce běhu.
    if (!coin) {
      if (Date.now() - od < 6 * HOD) nazvy.set(`${burza}:${symbol}`, null);
      return null;
    }
    nazvy.set(`${burza}:${symbol}`, coin);
  }
  if (!s.length) return { pasy: [], mark: null, cas: null, sledovano: 0, coin };

  /*
   * Jedna šířka pásma pro celé okno (v0.74.2, video uživatele: mapa
   * rozdělená na svislé bloky). Server volí krok podle ceny (≈ 0,1 %,
   * 1/2/5 × 10^n) — když cena přejde hranici, krok se změní, všechny pruhy
   * skončí a začnou znovu s jinou hodnotou. Snímky se proto přeskládají na
   * nejhrubší krok v okně (součet jemnějších pásem).
   */
  /*
   * v0.74.4 (video uživatele: na 4h a 1D se mapa u ceny rozpadala na
   * kostičky): pásmo ≈ 0,1 % ceny má na delším timeframu 1–2 px. Šířka
   * pásma roste s délkou svíčky (4. odmocnina, od 30m výš) — `nasobekPasma`.
   */
  const krok = Math.max(...s.map((x) => x.krok), krokCeny(s[s.length - 1].mark * nasobekPasma(delkaSvicky)));
  s = s.map((x) => {
    if (x.krok === krok) return x;
    const pasma = new Map();
    for (const [idx, [l, sh]] of x.pasma) {
      const i = Math.round((idx * x.krok) / krok);
      const p = pasma.get(i) || [0, 0];
      pasma.set(i, [p[0] + l, p[1] + sh]);
    }
    return { ...x, krok, pasma };
  });

  /*
   * Pruh trvá od snímku, kde se pásmo objevilo, do snímku, kde zmizelo.
   * v0.74.3 (snímek uživatele: reálná mapa ve svislých blocích s jinou
   * sytostí): výpadek sběru (restart serveru) a neúplný první snímek po něm
   * dřív ukončily všechny pruhy naráz. Teď pásmo, které chybí nejvýš
   * CHYBI_SNIMKU snímků po sobě, pokračuje; mezera ve sběru do 3 h se
   * přemostí. Delší mezera pruhy ukončí (o době mezi nevíme nic).
   */
  const CHYBI_SNIMKU = 2;
  const otevrene = new Map();   // `${long}|${cena}` → pruh
  const hotove = [];
  const ted = Date.now();
  s.forEach((snimek, i) => {
    const dalsi = s[i + 1]?.t ?? ted;
    const dlouhaMezera = i < s.length - 1 && dalsi - snimek.t > 3 * 3600e3;
    for (const [idx, [l, sh]] of snimek.pasma) {
      const cena = idx * snimek.krok;
      for (const [usd, long] of [[l, true], [sh, false]]) {
        if (!usd) continue;
        const k = `${long}|${cena}`;
        const p = otevrene.get(k);
        if (p) {
          p.do = dalsi;
          p.chybi = -1;
          p.usd = Math.max(p.usd, usd);
          p.min = Math.min(p.min, usd);
          p.posledni = usd;
        } else {
          otevrene.set(k, { od: snimek.t, do: dalsi, cena, vyska: snimek.krok, usd, min: usd, posledni: usd, long, chybi: -1 });
        }
      }
    }
    for (const [k, p] of otevrene) {
      p.chybi += 1;
      // Chybějící pásmo končí tam, kde bylo naposledy vidět (p.do se neposouvá).
      if (p.chybi > CHYBI_SNIMKU || dlouhaMezera) {
        hotove.push(p);
        otevrene.delete(k);
      }
    }
  });
  hotove.push(...otevrene.values());
  const posledni = s[s.length - 1];
  return { pasy: hotove, mark: posledni.mark, cas: posledni.t, sledovano: posledni.sledovano, coin };
}
