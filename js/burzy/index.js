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
import { BinanceClient } from './binance.js';
import { OkxClient, BitgetClient, GateClient, MexcClient } from './dalsi.js';
import { HyperliquidClient } from './hyperliquid.js';

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
  /*
   * Binance USDⓈ-M přes CCXT (v0.53.0, v aplikaci od v0.54.0). Živá data
   * dotazováním, funding od v0.59.8. Testovací prostředí: volby { demo }
   * (Binance Demo Trading); starý testnet 2026-10-12 neodpovídal.
   */
  binance: {
    id: 'binance',
    nazev: 'Binance',
    vytvor: (handlers, volby) => new BinanceClient(handlers, volby),
    schopnosti: {
      zivePozice: false,
      zivaCena: false,
      zivaSvicka: false,
      prehledUctu: true,
      plneni: true,
      historieObchodu: true,
      funding: true,             // sazba, interval a příští stržení (v0.59.8)
      fundingHistorie: true,     // zaplacený funding z deníku příjmů (FUNDING_FEE)
      kontrolaJenCteni: true,
    },
    regiony: {
      global: { nazev: 'Global', api: 'https://fapi.binance.com' },
    },
  },
  /*
   * Další sada (v0.57.0, js/burzy/dalsi.js): zatím jen veřejná data —
   * páry ve Watchlists a graf bez klíče. `pripojeni: false` = klíč zatím
   * nejde připojit (ověří se na skutečném účtu). `jenVApk` = API bez CORS,
   * v prohlížeči nejde vůbec (nativní HTTP jen v APK).
   */
  okx: verejna('okx', 'OKX', (h, v) => new OkxClient(h, v), 'https://www.okx.com'),
  bitget: verejna('bitget', 'Bitget', (h, v) => new BitgetClient(h, v), 'https://api.bitget.com'),
  gate: verejna('gate', 'Gate', (h, v) => new GateClient(h, v), 'https://api.gateio.ws'),
  mexc: { ...verejna('mexc', 'MEXC', (h, v) => new MexcClient(h, v), 'https://contract.mexc.com'), jenVApk: true },
  /*
   * Hyperliquid (v0.60.0, js/burzy/hyperliquid.js): připojuje se **adresou
   * peněženky** (`adresa: true`) — účet je veřejný, nic se nepodepisuje,
   * takže jen pro čtení z principu. Ceny a svíčka živě proudem.
   */
  hyperliquid: {
    id: 'hyperliquid',
    nazev: 'Hyperliquid',
    vytvor: (handlers, volby) => new HyperliquidClient(handlers, volby),
    adresa: true,
    schopnosti: {
      zivePozice: false,       // pozice dotazem po 3 s (cena pozice živě proudem)
      zivaCena: true,
      zivaSvicka: true,
      prehledUctu: true,
      plneni: true,
      historieObchodu: true,
      funding: true,           // každou hodinu
      fundingHistorie: true,   // zaplacené od otevření dává burza sama
      kontrolaJenCteni: true,  // adresa nic nepodepisuje
    },
    regiony: {
      global: { nazev: 'Global', api: 'https://api.hyperliquid.xyz' },
    },
  },
};

/** Popis burzy, která zatím dává jen veřejná data (bez připojení klíče). */
function verejna(id, nazev, vytvor, api) {
  return {
    id,
    nazev,
    vytvor,
    pripojeni: false,
    schopnosti: {
      zivePozice: false, zivaCena: false, zivaSvicka: false, prehledUctu: false, plneni: false,
      historieObchodu: false, funding: false, fundingHistorie: false, kontrolaJenCteni: false,
    },
    regiony: { global: { nazev: 'Global', api } },
  };
}

/** Burzy, jejichž veřejná data jdou v tomhle prostředí stáhnout. */
export function verejneDostupne() {
  const apk = Boolean(globalThis.Capacitor?.isNativePlatform?.());
  return Object.values(BURZY).filter((b) => !b.jenVApk || apk).map((b) => b.id);
}

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
  if (!adapter.volby) adapter.volby = volby;
  return adapter;
}
