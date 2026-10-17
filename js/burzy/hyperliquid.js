/*
 * Hyperliquid (v0.60.0) — první burza, která se připojuje **adresou
 * peněženky**, ne klíčem. Účet na Hyperliquidu je veřejný (blockchain):
 * pozice, příkazy, plnění i funding kohokoli jde přečíst z adresy, nic
 * se nepodepisuje. Aplikace tak z principu nemůže obchodovat ani vybírat
 * — „jen pro čtení" je tu vlastnost, ne kontrola.
 *
 * Ověřeno naostro 2026-10-17 (adresy z veřejného žebříčku, žádný účet):
 *  - ~230 perpetuálů v USDC, CORS ano (veřejná i „soukromá" data jsou
 *    stejný endpoint `/info`). Symboly CCXT `BTC/USDC:USDC` → `BTCUSDC`;
 *    coin v API je `info.name` (`kPEPE`, CCXT z něj dělá `KPEPE`).
 *  - Pozice, zůstatek i zaplacený funding v **jednom dotazu**
 *    `clearinghouseState` (váha 2). Funding od otevření dává burza sama
 *    (`cumFunding.sinceOpen`, kladné = zaplaceno), každou hodinu.
 *  - Příkazy včetně TP/SL a trailingu: `frontendOpenOrders` (váha 20);
 *    TP/SL na celou pozici má `isPositionTpsl` a množství 0.
 *  - Plnění: `userFillsByTime` (nejvýš 2000 na dotaz, burza drží 10 000
 *    posledních); zavírací plnění nesou `closedPnl` a `dir`
 *    („Close Long", „Long > Short"…) — z nich se skládají uzavřené obchody.
 *  - Živý proud `wss://api.hyperliquid.xyz/ws`, bez přihlášení:
 *    `activeAssetCtx` (cena, změna 24 h, obrat) a `candle`.
 *  - ⚠ Limit 1200 vah za minutu na IP. Ceny všech párů
 *    (`metaAndAssetCtxs`) stojí 20 — dotazovat po 2 s by spotřebovalo
 *    polovinu limitu. Ceny proto jdou proudem, záloha dotazem jen přes
 *    `allMids` (váha 2) a nejvýš po 10 s.
 */
import { CcxtAdapter } from './ccxt-adapter.js';
import { t } from '../i18n.js';

const cislo = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cisloNebo = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) === 0
  ? null : Number(v));

/** Adresa peněženky (EVM): 0x + 40 hex znaků. */
export const ADRESA = /^0x[0-9a-fA-F]{40}$/;

const PROUD = 'wss://api.hyperliquid.xyz/ws';
const TF = { 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', D: '1d', W: '1w', M: '1M' };
// Burza zavře spojení, které minutu mlčí — ping po 50 s.
const PING_KAZDYCH = 50000;
// Záloha cen dotazem (když proud mlčí) nejvýš po 10 s — viz hlavička.
const CENY_DOTAZEM_PO = 10000;
// Plnění na jeden dotaz (strop burzy).
const PLNENI_NA_DOTAZ = 2000;

/** Typ podmíněného příkazu Hyperliquidu („Take Profit Market"…) → `stopType`. */
function typStopHl(orderType) {
  const typ = String(orderType || '').toLowerCase();
  if (typ.startsWith('take profit')) return 'TakeProfit';
  if (typ.startsWith('trailing')) return 'TrailingStop';
  if (typ.startsWith('stop')) return 'StopLoss';
  return '';
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

  /* ---------- adresa místo klíče ---------- */

  /** „Klíč" je adresa peněženky; secret žádný. */
  setCredentials(adresa) {
    this.apiKey = String(adresa || '').trim();
    this.apiSecret = '';
  }

  hasCredentials() {
    return ADRESA.test(this.apiKey);
  }

  /**
   * Instance CCXT vždy bez přihlašovacích údajů — data účtu se ptají
   * veřejným `/info` s adresou v dotazu (`info()`), nic se nepodepisuje.
   */
  novaInstance() {
    // ⚠ `this.apiKey` se tu nesmí ani na chvíli mazat: instance se zakládají
    // souběžně a dotaz, který by mezitím četl adresu, poslal `user: ''`
    // (burza odpoví 422).
    return super.novaInstance(false);
  }

  /** Dotaz na `/info` s adresou účtu; přeložená chyba, tiché opakování. */
  info(typ, extra = {}, hromadne = false) {
    return this.soukrome((ex) => ex.publicPostInfo({ type: typ, user: this.apiKey, ...extra }), hromadne);
  }

  /** Coin Hyperliquidu (`kPEPE`) → trh CCXT; jen perpetuály v USDC. */
  trhPodleCoinu(coin) {
    if (!this.trhyPodleCoinu || this.trhyPodleCoinuZ !== this.trhyCcxt()) {
      this.trhyPodleCoinuZ = this.trhyCcxt();
      this.trhyPodleCoinu = new Map(Object.values(this.trhyPodleCoinuZ)
        .filter((m) => m.swap && m.linear && m.quote === this.mena)
        .map((m) => [m.info?.name || m.base, m]));
    }
    return this.trhyPodleCoinu.get(coin) || null;
  }

  coin(symbol) {
    const m = this.trh(symbol);
    return m ? (m.info?.name || m.base) : null;
  }

  /* ---------- pozice a účet: jeden dotaz ---------- */

  async stahniPozice() {
    const s = await this.info('clearinghouseState');
    this.stavUctu = { cas: Date.now(), data: s };
    this.fundingOdOtevreni = new Map();
    const vysledek = [];
    for (const ap of s?.assetPositions || []) {
      const p = ap.position || {};
      const m = this.trhPodleCoinu(p.coin);
      const szi = cislo(p.szi);
      if (!m || !szi) continue;
      const symbol = this.kanonicky(m);
      const size = Math.abs(szi);
      const value = Math.abs(cislo(p.positionValue));
      // Kladné `cumFunding` = zaplaceno; model chce zaplaceno záporně.
      const sinceOpen = Number(p.cumFunding?.sinceOpen);
      if (Number.isFinite(sinceOpen)) this.fundingOdOtevreni.set(symbol, -sinceOpen);
      const cele = this.celePozice?.get(symbol) || {};
      vysledek.push({
        symbol,
        side: szi > 0 ? 'Buy' : 'Sell',
        size,
        entry: cislo(p.entryPx),
        // Mark cenu pozice burza nepíše — hodnota pozice je počítaná z ní.
        mark: size ? value / size : 0,
        pnl: cislo(p.unrealizedPnl),
        liq: cisloNebo(p.liquidationPx),
        leverage: cisloNebo(p.leverage?.value),
        value,
        margin: cisloNebo(p.marginUsed),
        stopLoss: cele.stopLoss ?? null,
        takeProfit: cele.takeProfit ?? null,
        positionIdx: 0,
        openedAt: null,
        updatedAt: Date.now(),
        funding: this.fundingCache?.get(symbol)?.funding || undefined,
      });
    }
    return vysledek;
  }

  async getWalletBalance() {
    const cerstvy = this.stavUctu && Date.now() - this.stavUctu.cas < 10000;
    const s = cerstvy ? this.stavUctu.data : await this.info('clearinghouseState');
    const souhrn = s?.marginSummary || {};
    const equity = cislo(souhrn.accountValue);
    const pouzity = cislo(souhrn.totalMarginUsed);
    return {
      ucet: {
        equity,
        volny: cislo(s?.withdrawable),
        pouzity,
        vyuziti: equity > 0 ? (pouzity / equity) * 100 : null,
        typ: '',
      },
      chyba: null,
    };
  }

  /* ---------- příkazy (i TP/SL a trailing) ---------- */

  prikazHl(o) {
    const m = this.trhPodleCoinu(o.coin);
    if (!m) return null;
    const symbol = this.kanonicky(m);
    const typ = String(o.orderType || 'Limit');
    const celaPozice = Boolean(o.isPositionTpsl) || (o.isTrigger && cislo(o.origSz) === 0);
    let qty = cislo(o.sz);
    if (celaPozice) qty = [...this.positions.values()].find((p) => p.symbol === symbol)?.size || qty;
    return {
      id: String(o.oid),
      symbol,
      side: o.side === 'B' ? 'Buy' : 'Sell',
      type: /market/i.test(typ) ? 'Market' : 'Limit',
      stopType: o.isTrigger ? typStopHl(typ) : '',
      // U tržních podmíněných příkazů je `limitPx` jen mez skluzu, ne cena.
      price: /market/i.test(typ) ? null : cisloNebo(o.limitPx),
      trigger: o.isTrigger ? cisloNebo(o.triggerPx) : null,
      qty,
      filled: Math.max(0, cislo(o.origSz) - cislo(o.sz)),
      reduceOnly: Boolean(o.reduceOnly) || celaPozice,
      createdAt: cislo(o.timestamp),
      ...(celaPozice ? { celaPozice: true } : {}),
    };
  }

  async vsechnyPrikazy() {
    const surove = await this.info('frontendOpenOrders');
    const prikazy = (surove || []).map((o) => this.prikazHl(o)).filter(Boolean);
    this.zapamatujCelePozice(prikazy);
    return prikazy;
  }

  async getAllOpenOrders() {
    return this.vsechnyPrikazy();
  }

  async getOpenOrders(symbol) {
    return (await this.vsechnyPrikazy()).filter((o) => o.symbol === symbol);
  }

  /*
   * TP/SL na celou pozici patří k pozici (`stopLoss`, `takeProfit`) jako
   * u Bybitu a Binance — karta pak ukáže „SL x %" a duplicitní čára se
   * v grafu nekreslí.
   */
  zapamatujCelePozice(prikazy) {
    const nove = new Map();
    for (const o of prikazy) {
      if (!o.celaPozice || !o.trigger) continue;
      const z = nove.get(o.symbol) || {};
      if (o.stopType === 'TakeProfit') z.takeProfit = o.trigger;
      else if (o.stopType === 'StopLoss') z.stopLoss = o.trigger;
      nove.set(o.symbol, z);
    }
    this.celePozice = nove;
    let zmena = false;
    for (const poz of this.positions.values()) {
      const z = nove.get(poz.symbol) || {};
      const sl = z.stopLoss ?? null;
      const tp = z.takeProfit ?? null;
      if (poz.stopLoss !== sl || poz.takeProfit !== tp) {
        poz.stopLoss = sl;
        poz.takeProfit = tp;
        zmena = true;
      }
    }
    if (zmena) this.emitPositions();
  }

  /* ---------- funding: sazba po hodinách, zaplacené od burzy ---------- */

  /**
   * Vlastní fronta CCXT pro práci na pozadí: předčtení svíček, mini-grafy,
   * sazby fundingu. ⚠ Omezovač CCXT řadí dotazy instance za sebe podle
   * váhy a svíčky stojí u Hyperliquidu 20+ — u účtu s 20 pozicemi čekal
   * graf otevřený prstem za předčítáním a fundingem přes 20 s.
   */
  burzaPredem() {
    if (this.exPozadi) return Promise.resolve(this.exPozadi);
    if (!this.zakladaniPozadi) {
      this.zakladaniPozadi = (async () => {
        const ex = await this.novaInstance();
        await this.nactiTrhy(ex, this.ex || this.exVerejna);
        this.exPozadi = ex;
        return ex;
      })();
      this.zakladaniPozadi.catch(() => { this.zakladaniPozadi = null; });
    }
    return this.zakladaniPozadi;
  }

  /**
   * Stav všech trhů (`metaAndAssetCtxs`: sazba fundingu, ceny, obrat) —
   * jeden dotaz pro všechny pozice, v paměti minutu. Dřív dotaz za každou
   * pozici zvlášť (20 pozic = 400 vah z limitu 1200 za minutu).
   */
  kontextyTrhu() {
    if (this.kontexty && Date.now() - this.kontexty.cas < 60000) return Promise.resolve(this.kontexty.mapa);
    if (!this.kontextySlib) {
      this.kontextySlib = (async () => {
        const ex = await this.burzaPredem();
        const [meta, ctx] = await ex.publicPostInfo({ type: 'metaAndAssetCtxs' });
        const mapa = new Map((meta?.universe || []).map((u, i) => [u.name, ctx?.[i]]));
        this.kontexty = { cas: Date.now(), mapa };
        return mapa;
      })().finally(() => { this.kontextySlib = null; });
    }
    return this.kontextySlib;
  }

  async getFunding(symbol) {
    await this.burzaVerejna();
    const ctx = (await this.kontextyTrhu()).get(this.coin(symbol));
    const rate = Number(ctx?.funding);
    if (!ctx || !Number.isFinite(rate)) return null;
    const hodina = 3600e3;
    return { rate, nextAt: Math.ceil((Date.now() + 1) / hodina) * hodina, minut: 60 };
  }

  /**
   * Funding všech pozic najednou (v0.60.0): sazba z jednoho dotazu na stav
   * trhů, zaplacené od otevření z posledního `clearinghouseState` — karta
   * ho ukáže hned. Čas otevření pozice (jen pro „za jak dlouho") se
   * dopočítá z plnění na pozadí a doplní se, až bude. Obecný adaptér čekal
   * u každé pozice na plnění a u účtu s 20 pozicemi funding dlouho chyběl.
   */
  async refreshFunding() {
    if (!this.positions.size) return;
    this.fundingCache ??= new Map();
    let mapa;
    try {
      mapa = await this.kontextyTrhu();
    } catch {
      return; // příště znovu
    }
    const hodina = 3600e3;
    const nextAt = Math.ceil((Date.now() + 1) / hodina) * hodina;
    this.otevreniZnamo ??= new Map();
    const poz = [...this.positions.values()];
    for (const p of poz) {
      const rate = Number(mapa.get(this.coin(p.symbol))?.funding);
      if (!Number.isFinite(rate)) continue;
      const celkem = this.fundingOdOtevreni?.get(p.symbol);
      const odKdy = this.otevreniZnamo.get(`${p.symbol}|${p.side}|${p.size}`) ?? null;
      const funding = {
        rate,
        nextAt,
        minut: 60,
        zaplaceno: Number.isFinite(celkem) ? { celkem, pocet: celkem ? 1 : 0, odKdy } : null,
      };
      this.fundingCache.set(p.symbol, { kdy: Date.now(), funding });
      p.funding = funding;
    }
    for (const s of [...this.fundingCache.keys()]) {
      if (!poz.some((p) => p.symbol === s)) this.fundingCache.delete(s);
    }
    this.emitPositions();
    for (const p of poz) {
      const klic = `${p.symbol}|${p.side}|${p.size}`;
      if (this.otevreniZnamo.has(klic)) continue;
      this.otevreniPozice(p).then((cas) => {
        if (!cas) return;
        this.otevreniZnamo.set(klic, cas);
        const f = this.fundingCache.get(p.symbol)?.funding;
        if (f?.zaplaceno) {
          f.zaplaceno.odKdy = cas;
          this.emitPositions();
        }
      }).catch(() => { /* bez času otevření jen částka */ });
    }
  }

  /* ---------- plnění a uzavřené obchody ---------- */

  /*
   * Plnění účtu v okně (všechny páry). Hyperliquid je vydá jen pro celý
   * účet, ne po párech — proto se drží v paměti (celé stažené období)
   * a dotazy se řadí za sebe: funding 20 pozic, graf i Historie pak berou
   * z paměti a dotahuje se jen začátek nebo konec, který chybí. Bez toho
   * účet s 20 pozicemi poslal 40 dotazů za 20 s (2000 plnění na dotaz)
   * a Historie se nenačetla vůbec.
   */
  plneniVOkne(startTime, endTime) {
    const uloha = (this.plneniFronta || Promise.resolve()).then(() => this.plneniZPameti(startTime, endTime));
    this.plneniFronta = uloha.catch(() => {});
    return uloha;
  }

  async plneniZPameti(startTime, endTime) {
    const od = Math.floor(startTime);
    const doKdy = Math.min(Math.ceil(endTime), Date.now());
    let p = this.plneniPamet;
    if (!p || p.adresa !== this.apiKey) {
      p = { adresa: this.apiKey, od: null, do: null, mapa: new Map() };
      this.plneniPamet = p;
    }
    if (p.od === null) {
      await this.stahniPlneni(p, od, doKdy);
      p.od = od;
      p.do = doKdy;
    } else {
      if (od < p.od) {
        await this.stahniPlneni(p, od, p.od);
        p.od = od;
      }
      // Konec se dotahuje s minutovým překryvem (pozdě zapsaná plnění),
      // a ne častěji než po 20 s — dotazy ve frontě (čas otevření 20 pozic)
      // by jinak každý stahoval „posledních pár vteřin" znovu.
      if (doKdy > p.do + 20000) {
        await this.stahniPlneni(p, p.do - 60000, doKdy);
        p.do = doKdy;
      }
    }
    return [...p.mapa.values()].filter((f) => f.time >= od && f.time <= doKdy);
  }

  /** Stáhne plnění v okně do paměti, po 2000 na dotaz (strop burzy). */
  async stahniPlneni(p, startTime, endTime) {
    let od = Math.floor(startTime);
    for (let i = 0; i < 10 && od < endTime; i += 1) {
      const davka = await this.info('userFillsByTime', { startTime: od, endTime: Math.ceil(endTime) }, true);
      if (!davka?.length) break;
      for (const f of davka) {
        const id = String(f.tid ?? `${f.hash}|${f.time}|${f.sz}`);
        p.mapa.set(id, { ...f, time: cislo(f.time) });
      }
      if (davka.length < PLNENI_NA_DOTAZ) break;
      od = Math.max(...davka.map((f) => cislo(f.time))) + 1;
    }
  }

  async getExecutions(symbol, startTime, endTime) {
    const coin = this.coin(symbol) ?? (await this.burzaVerejna(), this.coin(symbol));
    if (!coin) return [];
    return (await this.plneniVOkne(startTime, endTime))
      .filter((f) => f.coin === coin)
      .map((f) => ({
        buy: f.side === 'B',
        price: cislo(f.px),
        qty: cislo(f.sz),
        time: cislo(f.time),
        orderId: String(f.oid),
        execId: String(f.tid ?? f.hash),
      }))
      .sort((a, b) => b.time - a.time);
  }

  /**
   * Uzavřené obchody z plnění: zavírací plnění („Close Long/Short",
   * otočení „Long > Short", likvidace) nesou realizovaný zisk `closedPnl`
   * (bez poplatků, jako u Binance). Jeden záznam = jeden zavírací příkaz,
   * Historie je pak seskupí do obchodů sama.
   */
  async getClosedTrades(startTime, endTime) {
    await this.burzaVerejna();
    const podlePrikazu = new Map();
    for (const f of await this.plneniVOkne(startTime, endTime)) {
      const dir = String(f.dir || '');
      const otoceni = dir.includes('>');
      if (!/close|liquidat/i.test(dir) && !otoceni) continue;
      const m = this.trhPodleCoinu(f.coin);
      if (!m) continue;
      // Otočení pozice zavírá jen tolik, kolik v ní bylo.
      const qty = otoceni ? Math.min(cislo(f.sz), Math.abs(cislo(f.startPosition))) : cislo(f.sz);
      if (!qty) continue;
      const long = otoceni ? dir.startsWith('Long') : /long/i.test(dir);
      const id = String(f.oid);
      const z = podlePrikazu.get(id) || { m, long, qty: 0, hodnota: 0, pnl: 0, cas: 0 };
      z.qty += qty;
      z.hodnota += qty * cislo(f.px);
      z.pnl += cislo(f.closedPnl);
      z.cas = Math.max(z.cas, cislo(f.time));
      podlePrikazu.set(id, z);
    }
    const vysledek = [];
    for (const [id, z] of podlePrikazu) {
      const exit = z.hodnota / z.qty;
      const entry = exit - z.pnl / (z.qty * (z.long ? 1 : -1));
      vysledek.push({
        id,
        symbol: this.kanonicky(z.m),
        long: z.long,
        qty: z.qty,
        entry,
        exit,
        pnl: z.pnl,
        value: entry * z.qty,
        leverage: null,
        openedAt: z.cas,
        closedAt: z.cas,
      });
    }
    return vysledek.sort((a, b) => b.closedAt - a.closedAt);
  }

  /* ---------- tickery ---------- */

  ticker(tk) {
    const z = super.ticker(tk);
    const info = tk.info || {};
    const vcera = cislo(info.prevDayPx) || this.vcera?.get(z.symbol) || 0;
    if (vcera) {
      (this.vcera ??= new Map()).set(z.symbol, vcera);
      z.changePct = z.last ? ((z.last - vcera) / vcera) * 100 : 0;
    }
    if (cislo(info.dayNtlVlm)) z.turnover = cislo(info.dayNtlVlm);
    return z;
  }

  /**
   * Záloha cen dotazem (proud mlčí): `allMids` (váha 2) místo tickerů
   * (20), a nejvýš po 10 s. Změna za 24 h se dopočte z včerejší ceny,
   * kterou si adaptér pamatuje z posledních tickerů / proudu.
   */
  async tickeryParu(ex, symboly) {
    if (Date.now() - (this.cenyDotazemCas || 0) < CENY_DOTAZEM_PO) return {};
    this.cenyDotazemCas = Date.now();
    const stredy = await ex.publicPostInfo({ type: 'allMids' });
    const vse = {};
    for (const s of symboly) {
      const m = ex.markets[s];
      const cena = cislo(stredy?.[m?.info?.name || m?.base]);
      if (!m || !cena) continue;
      vse[s] = { symbol: s, last: cena, markPrice: cena, info: {} };
    }
    return vse;
  }

  /* ---------- živý proud: cena (activeAssetCtx) a svíčka (candle) ---------- */

  chceneTemata() {
    const temata = new Map(); // klíč tématu → { subscription, cerstvost }
    if (!this.foreground || this.zastaveno) return temata;
    for (const s of this.paryCen()) {
      const coin = this.coin(s);
      if (coin) temata.set(`a|${coin}`, { sub: { type: 'activeAssetCtx', coin }, klic: `c:${s}` });
    }
    if (this.svicka && TF[this.svicka.interval]) {
      const coin = this.coin(this.svicka.symbol);
      if (coin) {
        temata.set(`k|${coin}|${TF[this.svicka.interval]}`, {
          sub: { type: 'candle', coin, interval: TF[this.svicka.interval] },
          klic: `k:${this.svicka.symbol}:${this.svicka.interval}`,
        });
      }
    }
    return temata;
  }

  synchronizujOdbery() {
    if (typeof WebSocket === 'undefined' || !Object.keys(this.trhyCcxt()).length) return;
    const chci = this.chceneTemata();
    if (!this.ws) {
      if (chci.size && !this.wsZnovu) this.otevriProud();
      return;
    }
    if (this.ws.readyState !== 1) return; // po otevření se zavolá znovu
    if (!chci.size) {
      this.ws.close();
      return;
    }
    for (const [k, { sub }] of chci) {
      if (this.wsOdbery.has(k)) continue;
      this.ws.send(JSON.stringify({ method: 'subscribe', subscription: sub }));
      this.wsOdbery.set(k, sub);
    }
    this.odebiraneKlice = new Set([...chci.values()].map((v) => v.klic));
    for (const [k, sub] of [...this.wsOdbery]) {
      if (chci.has(k)) continue;
      this.ws.send(JSON.stringify({ method: 'unsubscribe', subscription: sub }));
      this.wsOdbery.delete(k);
    }
  }

  otevriProud() {
    this.cerstve ??= new Map();
    this.wsOdbery = new Map();
    let ws;
    try {
      ws = new WebSocket(PROUD);
    } catch {
      this.wsZnovu = setTimeout(() => { this.wsZnovu = null; }, 30000);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.wsPokus = 0;
      clearInterval(this.wsPing);
      this.wsPing = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' }));
      }, PING_KAZDYCH);
      this.synchronizujOdbery();
    };
    ws.onmessage = (e) => {
      this.wsPosledni = Date.now();
      this.zpravaProudu(e.data);
    };
    ws.onclose = () => {
      clearInterval(this.wsPing);
      if (this.ws === ws) this.ws = null;
      this.wsOdbery = new Map();
      if (!this.chceneTemata().size) return; // zavřeno schválně
      const cekat = Math.min(30000, 1000 * 2 ** (this.wsPokus || 0));
      this.wsPokus = (this.wsPokus || 0) + 1;
      clearTimeout(this.wsZnovu);
      this.wsZnovu = setTimeout(() => {
        this.wsZnovu = null;
        this.synchronizujOdbery();
      }, cekat);
    };
    ws.onerror = () => { /* zavření řeší onclose */ };
  }

  /*
   * Pár s odběrem na živém spojení se dotazem neptá, i když chvíli nepřišla
   * zpráva: svíčka bez obchodů mlčí klidně desítky vteřin a záloha dotazem
   * by u Hyperliquidu stála 20 vah po 2 s (u Binance stačí čerstvost 6 s).
   */
  zProudu(klic) {
    if (this.ws?.readyState === 1 && this.odebiraneKlice?.has(klic) && Date.now() - (this.wsPosledni || 0) < 30000) {
      return true;
    }
    return super.zProudu(klic);
  }

  zpravaProudu(text) {
    let z;
    try {
      z = JSON.parse(text);
    } catch {
      return;
    }
    if (z?.channel === 'activeAssetCtx') {
      const m = this.trhPodleCoinu(z.data?.coin);
      const ctx = z.data?.ctx;
      if (!m || !ctx) return;
      const par = this.kanonicky(m);
      const posledni = cislo(ctx.midPx) || cislo(ctx.markPx);
      if (!posledni) return;
      this.cerstve.set(`c:${par}`, Date.now());
      const vcera = cislo(ctx.prevDayPx);
      if (vcera) (this.vcera ??= new Map()).set(par, vcera);
      const zmena = {
        symbol: par,
        last: posledni,
        changePct: vcera ? ((posledni - vcera) / vcera) * 100 : 0,
        turnover: cislo(ctx.dayNtlVlm),
      };
      if (this.pouzijCenu(zmena, cislo(ctx.markPx) || posledni)) this.emitPositions();
    } else if (z?.channel === 'candle') {
      const k = z.data || {};
      const sv = this.svicka;
      if (!sv || this.coin(sv.symbol) !== k.s || TF[sv.interval] !== k.i) return;
      this.cerstve.set(`k:${sv.symbol}:${sv.interval}`, Date.now());
      this.handlers.onKline?.({
        time: cislo(k.t), open: cislo(k.o), high: cislo(k.h), low: cislo(k.l), close: cislo(k.c),
        volume: cislo(k.v), closed: false,
      });
    }
  }

  setForeground(value) {
    super.setForeground(value);
    this.synchronizujOdbery();
  }

  async start() {
    this.zastaveno = false;
    return super.start();
  }

  stop() {
    this.zastaveno = true;
    super.stop();
    clearTimeout(this.wsZnovu);
    clearInterval(this.wsPing);
    this.wsZnovu = null;
    this.ws?.close();
  }

  /* ---------- „klíč" = adresa ---------- */

  /** Adresa nic nepodepisuje — obchodovat ani vybírat z principu nejde. */
  async opravneniKlice() {
    return this.hasCredentials() ? { jenCteni: true, vyber: false } : null;
  }

  async testCredentials(adresa) {
    const predtim = this.apiKey;
    this.setCredentials(adresa);
    if (!this.hasCredentials()) {
      this.setCredentials(predtim);
      return { ok: false, message: t('settings.badAddress') };
    }
    try {
      const s = await this.info('clearinghouseState');
      if (!s || typeof s !== 'object') throw new Error(t('error.network'));
      return { ok: true, overeno: true };
    } catch (err) {
      this.setCredentials(predtim);
      return { ok: false, message: err.message || this.prelozChybu(err) };
    }
  }
}
