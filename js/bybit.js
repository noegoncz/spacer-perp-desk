/**
 * Jediný modul, který komunikuje s Bybitem.
 *
 * Zbytek aplikace nesmí volat fetch ani WebSocket přímo — v checkpointu 4
 * (Capacitor / APK) se transport vymění za nativní plugin a musí to jít
 * udělat na jednom místě. Proto tenhle modul nesahá na DOM a výsledky hlásí
 * výhradně callbacky.
 */

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
      return `Bybit odmítl klíč${detail}. Zkontroluj, že je klíč platný, aktivní, `
           + 'má oprávnění číst pozice a nemá omezení na IP adresu.';
    case 429:
      return 'Příliš mnoho požadavků na Bybit. Zkus to za chvíli.';
    default:
      if (status >= 500) return `Bybit má výpadek (HTTP ${status}). Zkus to za chvíli.`;
      return `Bybit vrátil neočekávanou odpověď (HTTP ${status})${detail}.`;
  }
}

/** Výchozí transport. Capacitor ho nahradí nativním HTTP pluginem. */
async function defaultHttpGet(url, headers) {
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers, cache: 'no-store' });
  } catch {
    throw new Error('Nepodařilo se spojit s Bybitem. Zkontroluj připojení k internetu.');
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
      return 'Neplatný API klíč nebo podpis. Zkontroluj, že jsi zkopíroval klíč i secret celé a bez mezer.';
    case 10002:
      return 'Nesedí čas. Zkontroluj v telefonu automatické nastavení data a času.';
    case 10005:
      return 'Klíč nemá oprávnění číst pozice. Vytvoř na Bybitu read-only klíč s právem na Pozice.';
    case 10010:
      return 'API klíč je omezený na jinou IP adresu. Zruš IP omezení, mobilní síť mění IP.';
    case 33004:
      return 'API klíč vypršel. Vytvoř na Bybitu nový.';
    default:
      return retMsg ? `Bybit: ${retMsg} (kód ${retCode})` : `Bybit vrátil chybu ${retCode}.`;
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
    } catch {
      // Offline start — offset zůstane 0 a zkusí se znovu při dalším refreshi.
    }
  }

  async signedGet(path, params) {
    if (!this.hasCredentials()) throw new Error('Nejsou uložené API klíče.');

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
    try {
      await this.syncTime();
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

      this.setStatus({ rest: 'ok', lastUpdate: Date.now() });
      this.emitPositions();
      this.syncTickerSubscriptions();
      return true;
    } catch (err) {
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
  async getKlines(symbol, interval, limit = 500) {
    const result = await this.publicGet('/v5/market/kline', {
      category: 'linear',
      symbol,
      interval,
      limit: String(limit),
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
    const ok = await this.refresh();
    this.connectPrivate();
    this.connectPublic();
    this.startPolling();
    return ok;
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
