/**
 * Jediný modul, který komunikuje s Bybitem.
 *
 * Zbytek aplikace nesmí volat fetch ani WebSocket přímo — v checkpointu 4
 * (Capacitor / APK) se transport vymění za nativní plugin a musí to jít
 * udělat na jednom místě. Proto tenhle modul nesahá na DOM a výsledky hlásí
 * výhradně callbacky.
 */

import { t } from './i18n.js';

const REST_BASE = 'https://api.bybit.com';
const WS_PRIVATE = 'wss://stream.bybit.com/v5/private';
const WS_PUBLIC_LINEAR = 'wss://stream.bybit.com/v5/linear';

const RECV_WINDOW = '10000';

/**
 * Chyby autentizace nechodí jako JSON s retCode, ale jako HTTP 401
 * s prázdným tělem (ověřeno proti produkci). Důvod je v hlavičce stavového
 * řádku, kterou prohlížeč přes HTTP/2 nezpřístupní, takže se text odvozuje
 * ze stavového kódu.
 */
function httpErrorMessage(status, statusText) {
  const detail = statusText ? ` (${statusText})` : '';
  switch (status) {
    case 401:
    case 403:
      return t('error.rejected', { detail });
    case 429:
      return t('error.rateLimit');
    default:
      if (status >= 500) return t('error.outage', { status });
      return t('error.unexpected', { status, detail });
  }
}

/**
 * Kolik sekund čekat na odpověď.
 *
 * ⚠ `fetch` sám o sobě **žádný časový limit nemá**. Na telefonu se požadavek
 * umí zaseknout natrvalo (přepnutí sítě, mrtvá Wi-Fi) a bez limitu by na něm
 * aplikace uvázla bez jediné hlášky.
 */
const LIMIT_ODPOVEDI = 15000;

/** Výchozí transport. Capacitor ho nahradí nativním HTTP pluginem. */
async function defaultHttpGet(url, headers) {
  const stopky = new AbortController();
  const casovac = setTimeout(() => stopky.abort(), LIMIT_ODPOVEDI);

  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: stopky.signal,
    });
  } catch (err) {
    throw new Error(err?.name === 'AbortError' ? t('error.timeout') : t('error.offline'));
  } finally {
    clearTimeout(casovac);
  }

  const text = (await res.text()).trim();
  if (!text) throw new Error(httpErrorMessage(res.status, res.statusText));

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(httpErrorMessage(res.status, res.statusText));
  }
}

/* ---------- podpis ---------- */

const encoder = new TextEncoder();
const keyCache = new Map();

async function importKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

async function hmacHex(secret, message) {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- převod odpovědí na jednotný tvar ---------- */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function optionalNum(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

/**
 * REST a WebSocket vrací tutéž pozici pod jinými jmény polí
 * (REST `avgPrice` vs. WS `entryPrice`), proto sjednocení na jednom místě.
 */
function normalizePosition(raw) {
  return {
    symbol: raw.symbol,
    side: raw.side,
    size: num(raw.size),
    entry: num(raw.entryPrice ?? raw.avgPrice),
    mark: num(raw.markPrice),
    pnl: num(raw.unrealisedPnl),
    liq: optionalNum(raw.liqPrice),
    leverage: raw.leverage ? num(raw.leverage) : null,
    value: num(raw.positionValue),
    stopLoss: optionalNum(raw.stopLoss),
    takeProfit: optionalNum(raw.takeProfit),
    positionIdx: raw.positionIdx ?? 0,
    updatedAt: Date.now(),
  };
}

function positionKey(p) {
  return `${p.symbol}#${p.positionIdx ?? 0}`;
}

/** PnL přepočítaný lokálně, když přijde nová mark cena z ticker streamu. */
function recalcPnl(p) {
  if (!p.entry || !p.size || !p.mark) return p.pnl;
  const direction = p.side === 'Sell' ? -1 : 1;
  return (p.mark - p.entry) * p.size * direction;
}

/** Srozumitelný český text pro známé chybové kódy Bybitu. */
export function describeError(retCode, retMsg) {
  switch (Number(retCode)) {
    case 10003:
    case 10004:
      return t('error.badKey');
    case 10002:
      return t('error.clock');
    case 10005:
      return t('error.noPermission');
    case 10010:
      return t('error.ipLocked');
    case 33004:
      return t('error.expired');
    default:
      return retMsg
        ? t('error.bybit', { message: retMsg, code: retCode })
        : t('error.bybitCode', { code: retCode });
  }
}

/* ---------- klient ---------- */

export class BybitClient {
  /**
   * @param {object} handlers
   * @param {(positions: object[]) => void} handlers.onPositions
   * @param {(status: object) => void}      handlers.onStatus
   * @param {(message: string) => void}     handlers.onError
   * @param {object} [options]
   * @param {Function} [options.httpGet] náhrada transportu pro Capacitor
   */
  constructor(handlers = {}, options = {}) {
    this.handlers = handlers;
    this.httpGet = options.httpGet || defaultHttpGet;

    this.apiKey = '';
    this.apiSecret = '';

    /** rozdíl mezi časem serveru a telefonu; bez něj padají podpisy na 10002 */
    this.timeOffset = 0;

    this.positions = new Map();
    this.running = false;
    this.foreground = true;

    this.privateWs = null;
    this.publicWs = null;
    this.privateAttempt = 0;
    this.publicAttempt = 0;
    this.privateTimer = null;
    this.publicTimer = null;
    this.pingTimer = null;
    this.watchdogTimer = null;
    this.pollTimer = null;
    this.subscribedSymbols = new Set();
    this.klineTopic = null;

    this.status = { ws: 'idle', rest: 'idle', lastUpdate: null };

    /**
     * Stopa toho, co klient právě dělá. Bez ní se chyba na cizím telefonu
     * hledá jen hádáním — což už jednou stálo dvě zbytečná kola.
     */
    this.diag = { krok: 'start', pokusu: 0, posledniChyba: null, casChyby: null };
  }

  zapisDiag(krok, chyba = null) {
    this.diag.krok = krok;
    if (chyba) {
      this.diag.posledniChyba = chyba;
      this.diag.casChyby = Date.now();
    }
    this.handlers.onDiag?.(this.diag);
  }

  setCredentials(apiKey, apiSecret) {
    this.apiKey = (apiKey || '').trim();
    this.apiSecret = (apiSecret || '').trim();
  }

  hasCredentials() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  now() {
    return Date.now() + this.timeOffset;
  }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.handlers.onStatus?.(this.status);
  }

  emitPositions() {
    const list = [...this.positions.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    this.handlers.onPositions?.(list);
  }

  emitError(message) {
    this.handlers.onError?.(message);
  }

  /* ---------- REST ---------- */

  async syncTime() {
    try {
      const json = await this.httpGet(`${REST_BASE}/v5/market/time`, {});
      const serverMs = Number(json?.result?.timeNano ?? 0) / 1e6 || Number(json?.time ?? 0);
      if (serverMs > 0) this.timeOffset = Math.round(serverMs - Date.now());
    } catch (err) {
      // Běží se dál s offsetem 0, ale chyba se musí zaznamenat — dřív mizela
      // beze stopy a schovávala tím, že je čas serveru nedostupný.
      this.zapisDiag('čas serveru selhal', err.message || String(err));
    }
  }

  async signedGet(path, params) {
    if (!this.hasCredentials()) throw new Error(t('error.noKeys'));

    // Podepisuje se přesně ten query string, který se odešle, ve stejném pořadí.
    const query = new URLSearchParams(params).toString();
    const timestamp = String(this.now());
    const sign = await hmacHex(
      this.apiSecret,
      timestamp + this.apiKey + RECV_WINDOW + query,
    );

    const json = await this.httpGet(`${REST_BASE}${path}?${query}`, {
      'X-BAPI-API-KEY': this.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': sign,
    });

    if (Number(json.retCode) !== 0) {
      throw new Error(describeError(json.retCode, json.retMsg));
    }
    return json.result;
  }

  /** Načte otevřené linear USDT pozice a nahradí jimi celý stav. */
  async refresh() {
    this.setStatus({ rest: 'loading' });
    this.diag.pokusu += 1;
    this.zapisDiag('čas serveru');
    try {
      await this.syncTime();
      this.zapisDiag('pozice');
      const result = await this.signedGet('/v5/position/list', {
        category: 'linear',
        settleCoin: 'USDT',
        limit: '200',
      });

      this.positions.clear();
      for (const raw of result?.list ?? []) {
        const p = normalizePosition(raw);
        if (p.size > 0) this.positions.set(positionKey(p), p);
      }

      this.zapisDiag(`hotovo, pozic: ${this.positions.size}`);
      this.setStatus({ rest: 'ok', lastUpdate: Date.now() });
      this.emitPositions();
      this.syncTickerSubscriptions();
      return true;
    } catch (err) {
      this.zapisDiag('chyba', err.message || String(err));
      this.setStatus({ rest: 'error' });
      this.emitError(err.message || String(err));
      return false;
    }
  }

  /* ---------- svíčky a příkazy (checkpoint 2) ---------- */

  /** Tržní data jsou veřejná, nepodepisují se. */
  async publicGet(path, params) {
    const query = new URLSearchParams(params).toString();
    const json = await this.httpGet(`${REST_BASE}${path}?${query}`, {});
    if (Number(json.retCode) !== 0) {
      throw new Error(describeError(json.retCode, json.retMsg));
    }
    return json.result;
  }

  /**
   * Svíčky vzestupně podle času. Bybit je vrací od nejnovější, graf je
   * potřebuje obráceně.
   */
  async getKlines(symbol, interval, limit = 500, endTime = null) {
    const result = await this.publicGet('/v5/market/kline', {
      category: 'linear',
      symbol,
      interval,
      limit: String(limit),
      // Bez `end` vrací Bybit nejnovější svíčky; při prohlížení starého
      // obchodu potřebujeme okno kolem jeho času.
      ...(endTime ? { end: String(Math.ceil(endTime)) } : {}),
    });
    // Čas zůstává v milisekundách, jak ho Bybit posílá. Objem je potřeba
    // pro indikátor objemu v grafu.
    return (result?.list ?? [])
      .map((row) => ({
        time: Number(row[0]),
        open: num(row[1]),
        high: num(row[2]),
        low: num(row[3]),
        close: num(row[4]),
        volume: num(row[5]),
      }))
      .reverse();
  }

  /**
   * Všechny linear USDT páry se základními čísly, seřazené podle obratu.
   * Veřejné, nepotřebuje klíče — seznam jde ukázat i před přihlášením.
   */
  async getTickers() {
    const result = await this.publicGet('/v5/market/tickers', { category: 'linear' });
    return (result?.list ?? [])
      // Předlistingové páry se ještě neobchodují a jen by kazily seznam.
      .filter((t) => t.symbol?.endsWith('USDT') && !t.curPreListingPhase)
      .map((t) => ({
        symbol: t.symbol,
        last: num(t.lastPrice),
        changePct: num(t.price24hPcnt) * 100,
        turnover: num(t.turnover24h),
      }))
      .sort((a, b) => b.turnover - a.turnover);
  }

  /**
   * Uzavřené obchody, nejnovější první.
   *
   * ⚠ `side` v téhle odpovědi je strana **zavírací** objednávky, ne směr
   * pozice — dlouhá pozice se zavírá prodejem. Směr se proto odvozuje
   * z cen a zisku, což je samo o sobě konzistentní: když se vydělalo
   * a výstup byl výš než vstup, šlo o long.
   */
  async getClosedTrades(limit = 50) {
    const result = await this.signedGet('/v5/position/closed-pnl', {
      category: 'linear',
      limit: String(limit),
    });
    return (result?.list ?? []).map((r) => {
      const entry = num(r.avgEntryPrice);
      const exit = num(r.avgExitPrice);
      const pnl = num(r.closedPnl);
      const long = entry === exit ? r.side === 'Sell' : (exit > entry) === (pnl >= 0);
      return {
        id: r.orderId,
        symbol: r.symbol,
        long,
        qty: num(r.qty),
        entry,
        exit,
        pnl,
        value: num(r.cumEntryValue),
        leverage: r.leverage ? num(r.leverage) : null,
        openedAt: Number(r.createdTime),
        closedAt: Number(r.updatedTime),
      };
    });
  }

  /**
   * Jednotlivá plnění na páru v daném okně. Právě díky nim jdou vstupy
   * a výstupy položit na správné svíčky — průměry z uzavřených obchodů
   * by daly jednu značku uprostřed ničeho.
   */
  async getExecutions(symbol, startTime, endTime) {
    const result = await this.signedGet('/v5/execution/list', {
      category: 'linear',
      symbol,
      startTime: String(Math.floor(startTime)),
      endTime: String(Math.ceil(endTime)),
      limit: '100',
    });
    return (result?.list ?? [])
      .filter((e) => e.execType === 'Trade')
      .map((e) => ({
        buy: e.side === 'Buy',
        price: num(e.execPrice),
        qty: num(e.execQty),
        time: Number(e.execTime),
      }))
      .sort((a, b) => a.time - b.time);
  }

  /** Zavírací ceny za posledních 24 hodin — podklad pro mini-graf trendu. */
  async getSparkline(symbol) {
    const result = await this.publicGet('/v5/market/kline', {
      category: 'linear',
      symbol,
      interval: '60',
      limit: '24',
    });
    return (result?.list ?? []).map((row) => num(row[4])).reverse();
  }

  /** Otevřené příkazy k páru — limitky a podmíněné příkazy pro čáry v grafu. */
  async getOpenOrders(symbol) {
    const result = await this.signedGet('/v5/order/realtime', {
      category: 'linear',
      symbol,
      limit: '50',
    });
    return (result?.list ?? []).map((o) => ({
      id: o.orderId,
      side: o.side,
      type: o.orderType,
      stopType: o.stopOrderType || '',
      price: optionalNum(o.price),
      trigger: optionalNum(o.triggerPrice),
      qty: num(o.qty),
      reduceOnly: Boolean(o.reduceOnly),
    }));
  }

  /**
   * Přepne odběr svíček na veřejném streamu. Drží se jen jeden — graf ukazuje
   * vždy jeden pár a interval. `null` odběr zruší.
   */
  setKlineSubscription(symbol, interval) {
    const topic = symbol && interval ? `kline.${interval}.${symbol}` : null;
    if (topic === this.klineTopic) return;

    const ws = this.publicWs;
    const open = ws && ws.readyState === WebSocket.OPEN;

    if (this.klineTopic && open) {
      ws.send(JSON.stringify({ op: 'unsubscribe', args: [this.klineTopic] }));
    }
    this.klineTopic = topic;
    if (topic && open) {
      ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    }
  }

  /* ---------- životní cyklus ---------- */

  async start() {
    if (!this.hasCredentials()) return false;
    this.running = true;

    // Opakované dotahování se rozjede jako první. Kdyby se první načtení
    // zaseklo, běželo by se dál zkoušet — dřív na něm aplikace uvázla.
    this.startPolling();
    this.connectPrivate();
    this.connectPublic();
    return this.refresh();
  }

  stop() {
    this.running = false;
    clearTimeout(this.privateTimer);
    clearTimeout(this.publicTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.pollTimer);
    clearTimeout(this.watchdogTimer);
    this.closeSocket(this.privateWs);
    this.closeSocket(this.publicWs);
    this.privateWs = null;
    this.publicWs = null;
    this.subscribedSymbols.clear();
    this.positions.clear();
    this.setStatus({ ws: 'idle', rest: 'idle' });
  }

  closeSocket(ws) {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* už je zavřený */
    }
  }

  /**
   * Volat při návratu aplikace do popředí. Android uspaná WS spojení tiše
   * zabíjí, takže se po odemčení telefonu musí stav ověřit a spojení oživit.
   */
  ensureConnected() {
    if (!this.running) return;
    this.refresh();
    if (!this.privateWs || this.privateWs.readyState > WebSocket.OPEN) {
      this.privateAttempt = 0;
      this.connectPrivate();
    }
    if (!this.publicWs || this.publicWs.readyState > WebSocket.OPEN) {
      this.publicAttempt = 0;
      this.connectPublic();
    }
  }

  /** Aplikace hlásí, jestli je v popředí — modul sám na DOM nesahá. */
  setForeground(value) {
    this.foreground = value;
  }

  /** REST poll jako záchranná síť, kdyby WS tiše umřel. */
  startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.running && this.foreground) this.refresh();
    }, 30000);
  }

  backoffDelay(attempt) {
    // 1s, 2s, 4s… strop 30s, plus jitter ať se obě spojení netrefují naráz.
    return Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 500;
  }

  /* ---------- privátní WebSocket ---------- */

  connectPrivate() {
    if (!this.running || !this.hasCredentials()) return;
    clearTimeout(this.privateTimer);
    this.closeSocket(this.privateWs);
    this.setStatus({ ws: this.privateAttempt === 0 ? 'connecting' : 'reconnecting' });

    let ws;
    try {
      ws = new WebSocket(WS_PRIVATE);
    } catch {
      this.schedulePrivateReconnect();
      return;
    }
    this.privateWs = ws;

    ws.onopen = async () => {
      const expires = this.now() + 10000;
      const sign = await hmacHex(this.apiSecret, `GET/realtime${expires}`);
      ws.send(JSON.stringify({ op: 'auth', args: [this.apiKey, expires, sign] }));
    };

    ws.onmessage = (event) => {
      this.kickWatchdog();
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.op === 'auth') {
        if (msg.success === false) {
          // WebSocket V5 odpovídá hned v obou konvencích názvů, podle případu.
          const code = msg.retCode ?? msg.ret_code ?? 10004;
          this.emitError(describeError(code, msg.retMsg ?? msg.ret_msg));
          this.setStatus({ ws: 'error' });
          return;
        }
        ws.send(JSON.stringify({ op: 'subscribe', args: ['position'] }));
        return;
      }

      if (msg.op === 'subscribe') {
        if (msg.success !== false) {
          this.privateAttempt = 0;
          this.setStatus({ ws: 'live' });
          this.startPing(ws);
        }
        return;
      }

      if (msg.topic === 'position' && Array.isArray(msg.data)) {
        this.applyPositionPush(msg.data);
      }
    };

    ws.onerror = () => this.setStatus({ ws: 'error' });
    ws.onclose = () => {
      if (this.privateWs === ws) this.schedulePrivateReconnect();
    };
  }

  schedulePrivateReconnect() {
    clearInterval(this.pingTimer);
    clearTimeout(this.watchdogTimer);
    if (!this.running) return;
    this.setStatus({ ws: 'reconnecting' });
    const delay = this.backoffDelay(this.privateAttempt++);
    clearTimeout(this.privateTimer);
    this.privateTimer = setTimeout(() => this.connectPrivate(), delay);
  }

  startPing(ws) {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
    }, 20000);
    this.kickWatchdog();
  }

  /** Když 45 s nepřijde vůbec nic (ani pong), spojení je mrtvé. */
  kickWatchdog() {
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      if (this.running) this.connectPrivate();
    }, 45000);
  }

  applyPositionPush(rows) {
    let changed = false;
    for (const raw of rows) {
      if (raw.category && raw.category !== 'linear') continue;
      if (!String(raw.symbol || '').endsWith('USDT')) continue;

      const p = normalizePosition(raw);
      const key = positionKey(p);
      if (p.size > 0) {
        this.positions.set(key, p);
      } else {
        this.positions.delete(key);
      }
      changed = true;
    }
    if (changed) {
      this.setStatus({ lastUpdate: Date.now() });
      this.emitPositions();
      this.syncTickerSubscriptions();
    }
  }

  /* ---------- veřejný ticker stream (živá mark cena) ---------- */

  connectPublic() {
    if (!this.running) return;
    clearTimeout(this.publicTimer);
    this.closeSocket(this.publicWs);

    let ws;
    try {
      ws = new WebSocket(WS_PUBLIC_LINEAR);
    } catch {
      this.schedulePublicReconnect();
      return;
    }
    this.publicWs = ws;

    ws.onopen = () => {
      this.publicAttempt = 0;
      this.subscribedSymbols.clear();
      this.syncTickerSubscriptions();
      // Po znovupřipojení obnovit i odběr svíček, jinak by otevřený graf zamrzl.
      if (this.klineTopic) {
        ws.send(JSON.stringify({ op: 'subscribe', args: [this.klineTopic] }));
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (typeof msg.topic !== 'string' || !msg.data) return;

      if (msg.topic.startsWith('tickers.')) {
        this.applyTicker(msg.data);
      } else if (msg.topic === this.klineTopic) {
        this.applyKline(msg.data);
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.publicWs === ws) this.schedulePublicReconnect();
    };
  }

  schedulePublicReconnect() {
    if (!this.running) return;
    const delay = this.backoffDelay(this.publicAttempt++);
    clearTimeout(this.publicTimer);
    this.publicTimer = setTimeout(() => this.connectPublic(), delay);
  }

  /** Odebírá tickery přesně těch párů, na kterých je otevřená pozice. */
  syncTickerSubscriptions() {
    const ws = this.publicWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const wanted = new Set([...this.positions.values()].map((p) => p.symbol));

    const toAdd = [...wanted].filter((s) => !this.subscribedSymbols.has(s));
    const toRemove = [...this.subscribedSymbols].filter((s) => !wanted.has(s));

    if (toAdd.length) {
      ws.send(JSON.stringify({ op: 'subscribe', args: toAdd.map((s) => `tickers.${s}`) }));
      toAdd.forEach((s) => this.subscribedSymbols.add(s));
    }
    if (toRemove.length) {
      ws.send(JSON.stringify({ op: 'unsubscribe', args: toRemove.map((s) => `tickers.${s}`) }));
      toRemove.forEach((s) => this.subscribedSymbols.delete(s));
    }
  }

  /**
   * Ticker chodí i jako delta, takže markPrice v konkrétní zprávě být nemusí.
   * PnL se dopočítává lokálně — position topic pushuje jen při změně pozice,
   * bez tohohle by čísla mezi obchody stála.
   */
  applyTicker(data) {
    const mark = optionalNum(data.markPrice);
    if (!mark || !data.symbol) return;

    let changed = false;
    for (const p of this.positions.values()) {
      if (p.symbol !== data.symbol || p.mark === mark) continue;
      p.mark = mark;
      p.pnl = recalcPnl(p);
      changed = true;
    }
    if (changed) {
      this.setStatus({ lastUpdate: Date.now() });
      this.emitPositions();
    }
  }

  /**
   * Živá svíčka. Bybit posílá i nepotvrzenou (`confirm: false`), tedy tu
   * rozestavěnou — graf ji překresluje na místě, dokud se neuzavře.
   */
  applyKline(rows) {
    for (const row of rows) {
      this.handlers.onKline?.({
        time: Number(row.start),
        open: num(row.open),
        high: num(row.high),
        low: num(row.low),
        close: num(row.close),
        volume: num(row.volume),
        closed: Boolean(row.confirm),
      });
    }
  }

  /** Ověření klíčů na obrazovce nastavení. */
  async testCredentials(apiKey, apiSecret) {
    const prevKey = this.apiKey;
    const prevSecret = this.apiSecret;
    this.setCredentials(apiKey, apiSecret);
    try {
      await this.syncTime();
      await this.signedGet('/v5/position/list', {
        category: 'linear',
        settleCoin: 'USDT',
        limit: '1',
      });
      return { ok: true };
    } catch (err) {
      this.setCredentials(prevKey, prevSecret);
      return { ok: false, message: err.message || String(err) };
    }
  }
}
