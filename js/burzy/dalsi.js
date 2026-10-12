/*
 * Další sada burz přes CCXT (v0.57.0): OKX, Bitget, Gate, MEXC, Hyperliquid.
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

export class OkxClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('okx', handlers, volby);
    this.typyTrhu = ['swap'];
  }

  popisUctu() {
    return 'Swap';
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

export class HyperliquidClient extends CcxtAdapter {
  constructor(handlers = {}, volby = {}) {
    super('hyperliquid', handlers, volby);
    this.typyTrhu = ['swap'];
    this.mena = 'USDC';
  }

  popisUctu() {
    return 'Perps';
  }
}
