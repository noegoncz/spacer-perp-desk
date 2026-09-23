/** Vykreslování. Žádná logika kolem Bybitu, jen DOM. */

import { t, getLocale } from './i18n.js';
import {
  formatPrice,
  formatSize,
  formatUsd,
  formatSignedUsd,
  formatPercent,
  formatTime,
  liquidationDistance,
} from './format.js';

const MASK = '••••';

const el = (id) => document.getElementById(id);

const dom = {
  statusDot: el('statusDot'),
  statusText: el('statusText'),
  errorBar: el('errorBar'),
  summary: el('summary'),
  totalPnl: el('totalPnl'),
  totalCount: el('totalCount'),
  list: el('positionList'),
  placeholder: el('placeholder'),
  placeholderText: el('placeholderText'),
  placeholderBtn: el('placeholderBtn'),
  retryBtn: el('retryBtn'),
  diagLine: el('diagLine'),
  versionLabel: el('versionLabel'),
  lastUpdate: el('lastUpdate'),
  viewPositions: el('viewPositions'),
  viewSettings: el('viewSettings'),
  viewChart: el('viewChart'),
  viewWatchlist: el('viewWatchlist'),
  viewHistory: el('viewHistory'),
  accountSummary: el('accountSummary'),
  accEquity: el('accEquity'),
  accAvailable: el('accAvailable'),
  accMargin: el('accMargin'),
  accountNote: el('accountNote'),
  positionTools: el('positionTools'),
  sortGroup: el('sortGroup'),
  filterGroup: el('filterGroup'),
  ordersBlock: el('ordersBlock'),
  ordersList: el('ordersList'),
  ordersNote: el('ordersNote'),
  tabs: document.querySelector('.tabs'),
  watchList: el('watchList'),
  watchNote: el('watchNote'),
  historyList: el('historyList'),
  historyNote: el('historyNote'),
  settingsMsg: el('settingsMsg'),
  updateBar: el('updateBar'),
  chartSymbol: el('chartSymbol'),
  chartBadge: el('chartBadge'),
  chartPnl: el('chartPnl'),
  chartInfo: el('chartInfo'),
  chartError: el('chartError'),
};

function pnlClass(value) {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

/**
 * Skrytí prvku, který v HTML být nemusí.
 *
 * ⚠ Při aktualizaci umí prohlížeč krátce servírovat novou `js/ui.js` se
 * starou `index.html` (viz `naUdalost` v app.js). Prvky přidané v novější
 * verzi tam pak nejsou a `prvek.hidden` by spadlo na null.
 */
function skryj(prvek, skryty) {
  if (prvek) prvek.hidden = skryty;
}

function nastavText(prvek, text) {
  if (prvek) prvek.textContent = text;
}

function cell(label, value, extraClass = '') {
  const wrap = document.createElement('div');
  wrap.className = 'pos-cell';

  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;

  const v = document.createElement('span');
  v.className = `value ${extraClass}`.trim();
  v.textContent = value;

  wrap.append(l, v);
  return wrap;
}

/**
 * ROE = PnL vůči vloženému marginu. Margin se odvozuje z hodnoty pozice
 * a páky; když páku neznáme, ukáže se místo toho změna ceny.
 */
function returnPercent(p) {
  if (p.leverage && p.value) {
    const margin = p.value / p.leverage;
    if (margin > 0) return { value: (p.pnl / margin) * 100, label: t('position.roe') };
  }
  if (p.entry && p.mark) {
    const dir = p.side === 'Sell' ? -1 : 1;
    return { value: ((p.mark - p.entry) / p.entry) * 100 * dir, label: t('position.priceChange') };
  }
  return null;
}

/**
 * Funding na kartě: sazba, čas do stržení a kolik to dělá za den.
 *
 * Znaménko se počítá podle směru pozice — kladná sazba znamená, že long
 * platí shortu. Proto se neukazuje jen číslo, ale i to, na kterou stranu
 * peníze tečou; ze samotného „0,01 %" to nikdo nepozná.
 */
function fundingRow(p) {
  const f = p.funding;
  if (!f || !Number.isFinite(f.rate)) return null;

  const isLong = p.side !== 'Sell';
  // Long platí při kladné sazbě, short při záporné.
  const platiUzivatel = isLong ? f.rate > 0 : f.rate < 0;
  const zaDen = Math.abs(p.value * f.rate) * (1440 / (f.minut || 480));

  const radek = document.createElement('div');
  radek.className = 'pos-funding';

  const popis = document.createElement('span');
  popis.textContent = `${t('funding.label')} ${formatPercent(f.rate * 100, 4)}`;

  const castka = document.createElement('span');
  castka.className = `hodnota ${platiUzivatel ? 'platis' : 'dostavas'}`;
  castka.textContent = `${t(platiUzivatel ? 'funding.youPay' : 'funding.youGet')} `
    + t('funding.perDay', { amount: formatUsd(zaDen) });

  radek.append(popis, castka);

  if (f.nextAt) {
    const zbyva = f.nextAt - Date.now();
    if (zbyva > 0) {
      const kdy = document.createElement('span');
      kdy.textContent = t('funding.next', { time: trvani(zbyva) });
      radek.append(kdy);
    }
  }
  return radek;
}

function positionCard(p, hide, onSelect, liqThreshold = 10) {
  const isLong = p.side !== 'Sell';

  const card = document.createElement('article');
  card.className = `position ${isLong ? 'long' : 'short'}`;
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.addEventListener('click', () => onSelect?.(p));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(p);
    }
  });

  /* hlavička: pár + směr + PnL */
  const head = document.createElement('div');
  head.className = 'pos-head';

  const left = document.createElement('div');
  const symbol = document.createElement('span');
  symbol.className = 'pos-symbol';
  symbol.textContent = p.symbol;

  const badge = document.createElement('span');
  badge.className = `badge ${isLong ? 'long' : 'short'}`;
  badge.textContent = t(isLong ? 'position.long' : 'position.short');
  if (p.leverage) badge.textContent += ` ${formatSize(p.leverage)}×`;

  left.append(symbol, badge);

  const pnl = document.createElement('div');
  pnl.className = `pos-pnl ${pnlClass(p.pnl)}`;
  pnl.textContent = hide ? MASK : `${formatSignedUsd(p.pnl)} USDT`;

  const ret = returnPercent(p);
  if (ret) {
    const small = document.createElement('small');
    small.textContent = `${formatPercent(ret.value)} ${ret.label}`;
    pnl.append(small);
  }

  head.append(left, pnl);

  /* detaily */
  const grid = document.createElement('div');
  grid.className = 'pos-grid';
  grid.append(
    cell(t('position.size'), hide ? MASK : formatSize(p.size)),
    cell(t('position.entry'), formatPrice(p.entry)),
    cell(t('position.mark'), formatPrice(p.mark)),
  );

  const distance = liquidationDistance(p);
  const liqText = p.liq ? formatPrice(p.liq) : t('position.notSet');
  const blizko = distance !== null && Math.abs(distance) < liqThreshold;
  const liqClass = blizko ? 'liq near' : 'liq';
  grid.append(cell(t('position.liquidation'), liqText, p.liq ? liqClass : ''));

  if (distance !== null) {
    grid.append(cell(t('position.toLiquidation'), formatPercent(distance), liqClass));
  }

  // Varování se propíše na celou kartu, ne jen na jedno číslo.
  card.classList.toggle('blizko-likvidace', blizko);

  card.append(head, grid);
  const funding = fundingRow(p);
  if (funding) card.append(funding);
  return card;
}

export function renderPositions(list, hide, onSelect, liqThreshold = 10) {
  dom.list.replaceChildren(
    ...list.map((p) => positionCard(p, hide, onSelect, liqThreshold)),
  );

  const total = list.reduce((sum, p) => sum + p.pnl, 0);
  dom.totalPnl.textContent = hide ? MASK : `${formatSignedUsd(total)} USDT`;
  dom.totalPnl.className = `summary-value ${pnlClass(total)}`;
  dom.totalCount.textContent = String(list.length);

  const hasPositions = list.length > 0;
  dom.summary.hidden = !hasPositions;
  dom.placeholder.hidden = hasPositions;
  if (!hasPositions) {
    dom.placeholderText.textContent = t('positions.none');
    dom.placeholderBtn.hidden = true;
  }
}

export function showPlaceholder(text, buttonLabel = null) {
  dom.list.replaceChildren();
  dom.summary.hidden = true;
  skryj(dom.accountSummary, true);
  skryj(dom.accountNote, true);
  skryj(dom.positionTools, true);
  skryj(dom.ordersBlock, true);
  dom.placeholder.hidden = false;
  dom.placeholderText.textContent = text;
  dom.placeholderBtn.hidden = !buttonLabel;
  if (buttonLabel) dom.placeholderBtn.textContent = buttonLabel;
}

/* ---------- přehled účtu (checkpoint 7) ---------- */

/**
 * Equity, volný margin a využití marginu.
 *
 * ⚠ Klíč jen s oprávněním na pozice tahle data nedostane. To **není chyba
 * spojení** — pozice fungují dál, proto se ukáže jen vysvětlující řádek
 * a přehled se schová, žádná červená lišta.
 */
export function renderAccount(ucet, chyba, hide) {
  const mame = Boolean(ucet);
  skryj(dom.accountSummary, !mame);
  skryj(dom.accountNote, mame || !chyba);

  if (!mame) {
    if (chyba) nastavText(dom.accountNote, t('account.needsWallet'));
    return;
  }

  nastavText(dom.accEquity, hide ? MASK : `${formatUsd(ucet.equity)} USDT`);
  nastavText(dom.accAvailable, hide ? MASK : `${formatUsd(ucet.volny)} USDT`);
  nastavText(dom.accMargin, Number.isFinite(ucet.vyuziti)
    ? `${ucet.vyuziti.toFixed(1)} %`
    : '—');
}

/* ---------- otevřené příkazy (checkpoint 7) ---------- */

/** Popis příkazu: co to je a za jakých podmínek se spustí. */
function orderKind(o) {
  const casti = [];
  if (o.stopType) {
    // Bybit vrací interní názvy typu `PartialTakeProfit`; do UI patří
    // to, co uživatel zná z grafu.
    casti.push(o.stopType.replace(/([a-z])([A-Z])/g, '$1 $2'));
  } else {
    casti.push(t(o.type === 'Market' ? 'orders.market' : 'orders.limit'));
  }
  if (o.trigger) casti.push(t('orders.trigger', { price: formatPrice(o.trigger) }));
  if (o.reduceOnly) casti.push(t('orders.reduceOnly'));
  if (o.filled > 0) {
    casti.push(t('orders.filled', { done: formatSize(o.filled), total: formatSize(o.qty) }));
  }
  return casti.join(' · ');
}

export function renderOrders(orders, hide, onSelect, chyba = null) {
  const mame = orders.length > 0;
  skryj(dom.ordersBlock, !mame && !chyba);
  nastavText(dom.ordersNote, chyba || (mame ? '' : t('orders.none')));
  if (!dom.ordersList) return;

  dom.ordersList.replaceChildren(...orders.map((o) => {
    const radek = document.createElement('div');
    radek.className = `order-row ${o.side === 'Buy' ? 'buy' : 'sell'}`;
    radek.setAttribute('role', 'button');
    radek.tabIndex = 0;

    const symbol = document.createElement('div');
    symbol.className = 'order-symbol';
    symbol.textContent = o.symbol;

    const cena = document.createElement('div');
    cena.className = 'order-price';
    cena.textContent = formatPrice(o.price ?? o.trigger);

    const mnozstvi = document.createElement('div');
    mnozstvi.className = 'order-qty';
    mnozstvi.textContent = hide ? MASK : formatSize(o.qty);

    const druh = document.createElement('div');
    druh.className = 'order-kind';
    druh.textContent = orderKind(o);

    radek.append(symbol, cena, mnozstvi, druh);
    radek.addEventListener('click', () => onSelect?.(o));
    radek.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.(o);
      }
    });
    return radek;
  }));
}

/* ---------- řazení a filtr (checkpoint 8) ---------- */

/**
 * Lišta nad seznamem. Staví se z JS, ne z HTML, aby šly popisky přeložit
 * při změně jazyka bez sahání do markupu.
 */
export function renderPositionTools(stav, onSort, onFilter) {
  skryj(dom.positionTools, !stav.viditelne);
  if (!stav.viditelne || !dom.sortGroup || !dom.filterGroup) return;

  const tlacitko = (popisek, aktivni, onClick, sufix = '') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `list-btn ${aktivni ? 'active' : ''}`.trim();
    btn.textContent = popisek;
    if (sufix) {
      const smer = document.createElement('span');
      smer.className = 'smer';
      smer.textContent = sufix;
      btn.append(smer);
    }
    btn.addEventListener('click', onClick);
    return btn;
  };

  dom.sortGroup.replaceChildren(
    ...[['value', 'sort.value'], ['pnl', 'sort.pnl'], ['liq', 'sort.liquidation']]
      .map(([klic, popisek]) => tlacitko(
        t(popisek),
        stav.sort === klic,
        () => onSort(klic),
        // Šipka jen u zvoleného klíče; u ostatních by jen mátla.
        stav.sort === klic ? (stav.sestupne ? '↓' : '↑') : '',
      )),
  );

  dom.filterGroup.replaceChildren(
    ...[['all', 'filter.all'], ['long', 'filter.long'], ['short', 'filter.short']]
      .map(([klic, popisek]) => tlacitko(
        t(popisek),
        stav.filter === klic,
        () => onFilter(klic),
      )),
  );
}

/**
 * Prázdný výsledek filtru. Nesmí vypadat jako „žádné pozice" — data jsou,
 * jen je schoval filtr, a uživatel musí poznat rozdíl.
 */
export function showFilterEmpty(text) {
  skryj(dom.placeholder, false);
  nastavText(dom.placeholderText, text);
  skryj(dom.placeholderBtn, true);
  skryj(dom.retryBtn, true);
}

/** Ukáže, co klient právě dělá. Bez dat se to jinak hádá naslepo. */
export function showDiagnostics(radky) {
  dom.diagLine.hidden = !radky;
  dom.diagLine.textContent = radky || '';
  dom.retryBtn.hidden = !radky;
}

const STATUS_TRIDA = {
  idle: '',
  connecting: 'connecting',
  reconnecting: 'connecting',
  live: 'live',
  error: 'error',
};

export function renderStatus(status) {
  const stav = STATUS_TRIDA[status.ws] === undefined ? 'idle' : status.ws;
  dom.statusDot.className = `dot ${STATUS_TRIDA[stav]}`;
  dom.statusText.textContent = t(`status.${stav}`);
  dom.lastUpdate.textContent = status.lastUpdate
    ? t('status.updated', { time: formatTime(status.lastUpdate) })
    : '';
}

export function showError(message) {
  dom.errorBar.className = 'error-bar';
  dom.errorBar.textContent = message;
  dom.errorBar.hidden = false;
}

/** Oznámení, ne chyba — používá stejný pruh, jen v jiném tónu. */
export function showNotice(message) {
  dom.errorBar.className = 'error-bar notice';
  dom.errorBar.textContent = message;
  dom.errorBar.hidden = false;
}

export function clearError() {
  dom.errorBar.hidden = true;
  dom.errorBar.textContent = '';
}

export function showView(name) {
  dom.viewPositions.hidden = name !== 'positions';
  dom.viewWatchlist.hidden = name !== 'watchlist';
  dom.viewHistory.hidden = name !== 'history';
  dom.viewSettings.hidden = name !== 'settings';
  // V nastavení záložky nedávají smysl, je to odbočka mimo hlavní obrazovku.
  dom.tabs.hidden = name === 'settings';
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  window.scrollTo(0, 0);
}

/* ---------- historie obchodů ---------- */

/** Doba držení v čitelné podobě: 2 d 5 h, 3 h 12 m, 45 m. */
function trvani(ms) {
  const minuty = Math.max(0, Math.round(ms / 60000));
  const dny = Math.floor(minuty / 1440);
  const hodiny = Math.floor((minuty % 1440) / 60);
  const zbytek = minuty % 60;
  if (dny) return `${dny} d ${hodiny} h`;
  if (hodiny) return `${hodiny} h ${zbytek} m`;
  return `${zbytek} m`;
}

function datumCas(timestamp) {
  return new Date(timestamp).toLocaleString(getLocale(), {
    day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function renderHistory(obchody, hide, onSelect) {
  dom.historyList.replaceChildren(
    ...obchody.map((o) => {
      const karta = document.createElement('article');
      karta.className = `trade ${o.long ? 'long' : 'short'}`;
      karta.setAttribute('role', 'button');
      karta.tabIndex = 0;

      const hlava = document.createElement('div');
      hlava.className = 'trade-head';

      const vlevo = document.createElement('div');
      const symbol = document.createElement('span');
      symbol.className = 'trade-symbol';
      symbol.textContent = o.symbol;
      const odznak = document.createElement('span');
      odznak.className = `badge ${o.long ? 'long' : 'short'}`;
      odznak.textContent = t(o.long ? 'position.long' : 'position.short');
      if (o.leverage) odznak.textContent += ` ${formatSize(o.leverage)}×`;
      vlevo.append(symbol, odznak);

      const pnl = document.createElement('div');
      pnl.className = `trade-pnl ${pnlClass(o.pnl)}`;
      pnl.textContent = hide ? MASK : `${formatSignedUsd(o.pnl)} USDT`;

      hlava.append(vlevo, pnl);

      const mrizka = document.createElement('div');
      mrizka.className = 'trade-grid';
      mrizka.append(
        cell(t('history.qty'), hide ? MASK : formatSize(o.qty)),
        cell(t('history.entryAvg'), formatPrice(o.entry)),
        cell(t('history.exitAvg'), formatPrice(o.exit)),
      );

      const kdy = document.createElement('div');
      kdy.className = 'trade-when';
      kdy.textContent = `${datumCas(o.openedAt)} → ${datumCas(o.closedAt)}`
        + `  ·  ${t('history.duration')} ${trvani(o.closedAt - o.openedAt)}`;

      karta.append(hlava, mrizka, kdy);
      karta.addEventListener('click', () => onSelect(o));
      return karta;
    }),
  );
}

export function showHistoryNote(text) {
  dom.historyNote.textContent = text || '';
}

/* ---------- seznam trhů ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HVEZDA = 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z';

function zkratkaObratu(hodnota) {
  if (!Number.isFinite(hodnota) || hodnota <= 0) return '';
  if (hodnota >= 1e9) return `${(hodnota / 1e9).toFixed(1)} B`;
  if (hodnota >= 1e6) return `${(hodnota / 1e6).toFixed(0)} M`;
  return `${Math.round(hodnota / 1e3)} k`;
}

/**
 * @param {object|null} delic dělicí tlačítko za oblíbenými:
 *        `{ poIndexu, sbaleno, onClick }`
 */
export function renderWatchlist(radky, oblibene, onSelect, onToggleFav, delic = null) {
  const prvky = [];
  const vytvorRadek = (trh) => {
    const radek = document.createElement('div');
    radek.className = 'watch-row';
    radek.dataset.symbol = trh.symbol;

    const hvezda = document.createElement('button');
    hvezda.type = 'button';
    hvezda.className = `watch-star ${oblibene.has(trh.symbol) ? 'on' : ''}`.trim();
    hvezda.setAttribute('aria-label', t('watchlist.favourite'));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', HVEZDA);
    svg.append(path);
    hvezda.append(svg);
    hvezda.addEventListener('click', (e) => {
      e.stopPropagation(); // klepnutí na hvězdičku neotevírá graf
      onToggleFav(trh.symbol);
    });

    const nazev = document.createElement('div');
    nazev.className = 'watch-symbol';
    nazev.textContent = trh.symbol;
    const obrat = document.createElement('span');
    obrat.className = 'watch-turnover';
    obrat.textContent = zkratkaObratu(trh.turnover);
    nazev.append(obrat);

    const cena = document.createElement('div');
    cena.className = 'watch-price';
    cena.textContent = formatPrice(trh.last);

    const zmena = document.createElement('div');
    zmena.className = `watch-change ${pnlClass(trh.changePct)}`;
    zmena.textContent = formatPercent(trh.changePct);

    // Plátno mini-grafu zůstane prázdné, dokud se nedotáhnou data.
    const spark = document.createElementNS(SVG_NS, 'svg');
    spark.setAttribute('class', 'watch-spark');
    spark.setAttribute('viewBox', '0 0 58 24');
    spark.setAttribute('preserveAspectRatio', 'none');

    radek.append(hvezda, nazev, cena, zmena, spark);
    radek.addEventListener('click', () => onSelect(trh));
    return radek;
  };

  radky.forEach((trh, i) => {
    prvky.push(vytvorRadek(trh));
    if (delic && i === delic.poIndexu) prvky.push(vytvorDelic(delic));
  });
  // Když jsou vidět jen oblíbené, dělič patří na konec seznamu.
  if (delic && delic.poIndexu >= radky.length - 1 && !prvky.some((p) => p.classList?.contains('watch-divider'))) {
    prvky.push(vytvorDelic(delic));
  }

  dom.watchList.replaceChildren(...prvky);
  return [...dom.watchList.querySelectorAll('.watch-row')];
}

const SIPKA_DOLU = 'M6 9l6 6 6-6';
const SIPKA_NAHORU = 'M6 15l6-6 6 6';

function vytvorDelic({ sbaleno, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'watch-divider';

  const sipka = (d) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  };

  const smer = sbaleno ? SIPKA_DOLU : SIPKA_NAHORU;
  const popis = document.createElement('span');
  popis.textContent = t(sbaleno ? 'watchlist.showAll' : 'watchlist.hideAll');

  btn.append(sipka(smer), popis, sipka(smer));
  btn.addEventListener('click', onClick);
  return btn;
}

/** Mini-graf trendu za 24 h. Zelený, když cena skončila výš než začala. */
export function drawSparkline(radek, hodnoty) {
  const svg = radek.querySelector('.watch-spark');
  if (!svg || !hodnoty?.length) return;

  const min = Math.min(...hodnoty);
  const max = Math.max(...hodnoty);
  const rozsah = max - min || 1;
  const krok = hodnoty.length > 1 ? 58 / (hodnoty.length - 1) : 58;

  const body = hodnoty
    .map((v, i) => `${(i * krok).toFixed(1)},${(22 - ((v - min) / rozsah) * 20).toFixed(1)}`)
    .join(' ');

  const cara = document.createElementNS(SVG_NS, 'polyline');
  cara.setAttribute('points', body);
  svg.replaceChildren(cara);
  svg.setAttribute('class',
    `watch-spark ${hodnoty[hodnoty.length - 1] >= hodnoty[0] ? 'up' : 'down'}`);
}

export function showWatchNote(text) {
  dom.watchNote.textContent = text || '';
}

/**
 * Graf je překryv přes celou obrazovku. Seznam pod ním zůstává namontovaný,
 * takže se po návratu zachová odscrollování.
 */
export function showChart(visible) {
  dom.viewChart.hidden = !visible;
}

/** Graf se otevírá i na páru bez pozice — pak místo PnL ukazuje cenu. */
export function renderChartHeader(symbol, position, hide, trh = null) {
  dom.chartSymbol.textContent = symbol;

  if (!position) {
    dom.chartBadge.className = 'badge';
    dom.chartBadge.textContent = '';
    dom.chartPnl.className = `chart-pnl ${pnlClass(trh?.changePct ?? 0)}`;
    dom.chartPnl.textContent = trh ? formatPercent(trh.changePct) : '';
    return;
  }

  const isLong = position.side !== 'Sell';
  dom.chartBadge.className = `badge ${isLong ? 'long' : 'short'}`;
  dom.chartBadge.textContent = t(isLong ? 'position.long' : 'position.short');
  if (position.leverage) {
    dom.chartBadge.textContent += ` ${formatSize(position.leverage)}×`;
  }
  dom.chartPnl.className = `chart-pnl ${pnlClass(position.pnl)}`;
  dom.chartPnl.textContent = hide ? MASK : `${formatSignedUsd(position.pnl)} USDT`;
}

/**
 * Panel pod grafem. Nahradil legendu — ta jen opakovala hodnoty, které graf
 * sám píše na cenovou osu.
 */
export function renderChartInfo(position, hide) {
  // Bez pozice není co ukazovat; panel ustoupí grafu.
  dom.chartInfo.hidden = !position;
  if (!position) return;

  const ret = returnPercent(position);
  const distance = liquidationDistance(position);
  const margin =
    position.leverage && position.value ? position.value / position.leverage : null;

  const liqText = position.liq
    ? formatPrice(position.liq) + (distance !== null ? ` (${formatPercent(distance)})` : '')
    : '—';

  const cells = [
    [t('position.size'), hide ? MASK : formatSize(position.size), ''],
    [t('position.value'), hide ? MASK : `${formatUsd(position.value)} USDT`, ''],
    [t('position.margin'), hide ? MASK : margin ? `${formatUsd(margin)} USDT` : '—', ''],
    [t('position.entry'), formatPrice(position.entry), ''],
    [t('position.mark'), formatPrice(position.mark), ''],
    [ret ? ret.label : t('position.change'), ret ? formatPercent(ret.value) : '—', pnlClass(position.pnl)],
    [t('position.stopLossFull'), position.stopLoss ? formatPrice(position.stopLoss) : t('position.notSet'), position.stopLoss ? 'sl' : 'dim'],
    [t('position.takeProfitFull'), position.takeProfit ? formatPrice(position.takeProfit) : t('position.notSet'), position.takeProfit ? 'tp' : 'dim'],
    [t('position.liquidation'), liqText, distance !== null && Math.abs(distance) < 10 ? 'liq near' : 'liq'],
  ];

  dom.chartInfo.replaceChildren(...cells.map(([label, value, cls]) => cell(label, value, cls)));
}

export function showChartError(message) {
  dom.chartError.hidden = !message;
  if (message) dom.chartError.textContent = message;
}

export function setActiveInterval(interval) {
  document.querySelectorAll('.interval-btn[data-interval]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.interval === interval);
  });
}

export function showSettingsMessage(message, ok) {
  dom.settingsMsg.textContent = message;
  dom.settingsMsg.className = `settings-msg ${ok ? 'ok' : 'fail'}`;
  dom.settingsMsg.hidden = false;
}

export function clearSettingsMessage() {
  dom.settingsMsg.hidden = true;
}

export function renderVersion(version, build) {
  // Nenahrazený placeholder znamená, že to neběží z Pages.
  const buildLabel = !build || build.includes('__') ? 'dev' : build;
  dom.versionLabel.textContent = `v${version} · ${buildLabel}`;
}

export function showUpdateBar(show) {
  dom.updateBar.hidden = !show;
}
