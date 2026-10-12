/*
 * Seznam burz (krok 1 napojení více burz, v0.52.0).
 *
 * Aplikace si burzu vyžádá jménem (`vytvorBurzu('bybit', …)`) a dál mluví
 * jen se společným modelem (js/burzy/model.js). Každá burza tu má:
 *  - `nazev` pro UI,
 *  - `vytvor(handlers, volby)` — adaptér,
 *  - `schopnosti` — co umí; aplikace podle nich skryje, co burza nedá,
 *  - `regiony` — „rodina + region": stejný adaptér, jiná adresa API.
 *    Nabízí se jen region, který perpetuály opravdu má (ověřeno dotazem
 *    na trhy, viz poznámka u regionu). Bybit EU např. 2026-10-12 vracel
 *    0 perpetuálů (jen spot), proto tu zatím není.
 *
 * Další burzy (Binance, Gate, MEXC… přes CCXT) se přidají sem, aplikace
 * se jich nedotkne.
 */
import { BybitClient } from '../bybit.js';

export const BURZY = {
  bybit: {
    id: 'bybit',
    nazev: 'Bybit',
    vytvor: (handlers, volby) => new BybitClient(handlers, volby),
    schopnosti: {
      zivePozice: true,        // pozice přes WebSocket
      zivaCena: true,          // ticker přes WebSocket
      zivaSvicka: true,        // svíčka grafu přes WebSocket
      prehledUctu: true,       // equity, volný margin
      plneni: true,            // jednotlivá plnění (trojúhelníky, Historie)
      historieObchodu: true,   // uzavřené obchody
      funding: true,           // sazba a příští stržení
      fundingHistorie: true,   // zaplacený funding za dobu držení
      kontrolaJenCteni: true,  // umí ověřit, že klíč je jen pro čtení
    },
    regiony: {
      global: { nazev: 'Global', api: 'https://api.bybit.com' },
    },
  },
};

/** Výchozí burza, dokud aplikace neumí víc burz najednou. */
export const VYCHOZI = 'bybit';

/**
 * Vytvoří adaptér burzy. Adaptér dostane `burza` (popis výše), aby se
 * aplikace mohla ptát na název a schopnosti, aniž by znala jeho třídu.
 */
export function vytvorBurzu(id, handlers = {}, volby = {}) {
  const popis = BURZY[id];
  if (!popis) throw new Error(`Neznámá burza: ${id}`);
  const adapter = popis.vytvor(handlers, volby);
  adapter.burza = popis;
  return adapter;
}
