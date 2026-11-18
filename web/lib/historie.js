// Starší historie grafu z R2 `perpyx-historie` (vazba HIST, 2026-11-18).
//
// Noční workflow Archiv R2 (web/tools/archiv.py) ukládá pro každý den
// hotové kousky odpovědí: prvky JSON pole oddělené čárkou, bez závorek.
// Web je jen přepošle do odpovědi — nerozbaluje je ani neparsuje, protože
// bezplatný Workers má na jedno volání jen 10 ms CPU (čekání na R2 se
// nepočítá). Živá D1 drží jen krátkou historii (watcher/*.js), starší
// celé dny jdou odsud.

const DEN = 86400000;
const enc = new TextEncoder();
const SOUBEZNE = 6;

/** Den v klíči archivu: RRRR-MM-DD (UTC). */
export const textDne = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Klíče celých dnů od dne `od` do `doKdy` (bez dne, který začíná v `doKdy`). */
export function klicDnu(predpona, od, doKdy) {
  const klice = [];
  for (let d = Math.floor(od / DEN) * DEN; d < doKdy; d += DEN) klice.push(`${predpona}/${textDne(d)}`);
  return klice;
}

/**
 * Odpověď složená z `zacatek` + kousků z R2 (podle `klice`, chybějící se
 * přeskočí) + `zbytek` (prvky z D1, už jako text bez závorek) + `konec`.
 * Kousky se stahují po SOUBEZNE najednou, zapisují se v pořadí.
 */
export function spojOdpoved(env, { zacatek, klice, zbytek, konec }) {
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  (async () => {
    let prvni = true;
    const carka = async () => {
      if (!prvni) await w.write(enc.encode(','));
      prvni = false;
    };
    try {
      await w.write(enc.encode(zacatek));
      const cekajici = [];
      let i = 0;
      const dalsi = () => {
        if (i < klice.length && env.HIST) cekajici.push(env.HIST.get(klice[i++]).catch(() => null));
      };
      for (let k = 0; k < SOUBEZNE; k += 1) dalsi();
      while (cekajici.length) {
        const o = await cekajici.shift();
        dalsi();
        if (!o || !o.size) continue;
        await carka();
        const r = o.body.getReader();
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          await w.write(value);
        }
      }
      if (zbytek) {
        await carka();
        await w.write(enc.encode(zbytek));
      }
      await w.write(enc.encode(konec));
      await w.close();
    } catch (e) {
      await w.abort(e).catch(() => {});
    }
  })();
  return readable;
}

/** Prvky pole jako text bez závorek („[1,2],[3,4]“), prázdné pole = ''. */
export const prvkyTextem = (pole) => (pole.length ? JSON.stringify(pole).slice(1, -1) : '');
