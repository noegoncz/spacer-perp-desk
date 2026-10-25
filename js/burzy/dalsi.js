/*
 * Další sada burz přes CCXT (v0.57.0): OKX, Bitget, Gate, MEXC.
 * (Hyperliquid má od v0.60.0 vlastní soubor js/burzy/hyperliquid.js.)
 *
 * Zatím jen **veřejná data** — Watchlists, ceny, mini-grafy a graf páru,
 * bez klíče. Připojení klíče (soukromá data) se zapne, až se u každé
 * burzy ověří na skutečném účtu (`pripojeni: false` v js/burzy/index.js).
 *
 * Sonda 2026-10-12 z prohlížeče (origin localhost, CCXT 4.5.x):
 *  - OKX: 485 USDT perpetuálů; veřejná i soukromá API s CORS → přímo.
 *    Klíč chce i heslo (passphrase).
 *  - Bitget: 827 USDT perpetuálů; veřejná data s CORS, soukromá **bez**
 *    → v APK nativní HTTP. Klíč chce heslo.
 *  - Gate: 1038 USDT perpetuálů; futures API s CORS, spot (seznam měn)
 *    a soukromá data **bez** → jen perpetuály, soukromá v APK nativně.
 *  - MEXC: futures API **bez CORS** vůbec → jen v APK (nativní HTTP).
 *  - Hyperliquid: ~180 perpetuálů v **USDC** (páry „BTCUSDC"), CORS ano;
 *    účet se nečte klíčem, ale adresou peněženky (jen čtení z principu).
 *  - KuCoin Futures a BingX bez CORS, WOO X bez CORS u svíček — přijdou
 *    s nativním HTTP v další vlně.
 *
 * Kontrola „klíč jen pro čtení" je zatím jen u OKX (perm v nastavení
 * účtu); ostatní vrací null („nevím") a doplní se při zapnutí připojení.
 */
import { CcxtAdapter } from './ccxt-adapter.js';
import { nativniFetch } from './ccxt.js';

export class OkxClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('okx', handlers, volby);
    this.typyTrhu = ['swap'];
    // OKX vrátí nejvýš 300 svíček od začátku okna — s oknem na 500 chybělo
    // v grafu posledních 200 svíček (v0.59.2, měřeno).
    this.maxSvicek = 300;
  }

  popisUctu() {
    return 'Swap';
  }

  /*
   * Historie OI pro kalkulovanou likvidační mapu (v0.76.0). Endpoint rubik
   * nemá CORS → v APK nativní HTTP, v prohlížeči zkusí běžný fetch (spadne
   * a mapa OKX vynechá). OKX vrací nejvýš 100 řádků, po stránkách přes `end`.
   * Řádek: [čas, kontrakty, OI v coinu, OI v USD].
   */
  async getOpenInterest(symbol, interval) {
    const obdobi = { 60: '1H', 240: '4H', D: '1D' }[interval] || (Number(interval) < 60 ? '5m' : '1D');
    const inst = `${symbol.replace(/(USDT|USDC)$/, '')}-${symbol.endsWith('USDC') ? 'USDC' : 'USDT'}-SWAP`;
    const ziskej = nativniFetch() || fetch.bind(globalThis);
    const body = new Map();
    let end = '';
    for (let i = 0; i < 6; i += 1) {
      const url = `https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=${inst}&period=${obdobi}&limit=100${end ? `&end=${end}` : ''}`;
      const r = await ziskej(url);
      const j = await r.json();
      const radky = j?.data || [];
      radky.forEach(([t, , coin]) => { if (Number(coin) > 0) body.set(Number(t), Number(coin)); });
      if (radky.length < 100) break;
      end = radky[radky.length - 1][0];
    }
    return [...body].map(([time, oi]) => ({ time, oi })).sort((a, b) => a.time - b.time);
  }

  /** `perm` v nastavení účtu: „read_only", „trade", „withdraw" (čárkou). */
  async opravneniKlice() {
    try {
      const ex = await this.burzaCcxt();
      const r = await ex.privateGetAccountConfig();
      const perm = String(r?.data?.[0]?.perm || '');
      if (!perm) return null;
      return { jenCteni: !/trade/.test(perm), vyber: /withdraw/.test(perm) };
    } catch {
      return null;
    }
  }
}

export class BitgetClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('bitget', handlers, volby);
    this.typyTrhu = ['swap'];
    this.nativniHttp = true; // soukromá API bez CORS
  }

  popisUctu() {
    return 'USDT-M';
  }
}

export class GateClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('gate', handlers, volby);
    this.typyTrhu = ['swap'];
    this.nativniHttp = true; // soukromá API bez CORS
  }

  popisUctu() {
    return 'USDT';
  }

  /**
   * CCXT posílá Gate hlavičku `X-Gate-Channel-Id` (svůj partnerský kanál)
   * a tu Gate v CORS nepovoluje — prohlížeč pak dotaz vůbec nepustí.
   * Bez ní veřejná futures API z aplikace fungují (ověřeno 2026-10-12).
   */
  upravCcxt(ex) {
    ex.headers = { ...(ex.headers || {}) };
    delete ex.headers['X-Gate-Channel-Id'];
  }
}

export class MexcClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('mexc', handlers, volby);
    // MEXC má vlastní tvar volby (spot zvlášť, swap lineární / inverzní).
    this.typyTrhu = { spot: false, swap: { linear: true, inverse: false } };
    this.nativniHttp = true; // futures API bez CORS
  }

  popisUctu() {
    return 'Futures';
  }
}
