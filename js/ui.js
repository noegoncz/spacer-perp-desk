/** Vykreslování. Žádná logika kolem Bybitu, jen DOM. */

import { t } from './i18n.js';
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
  versionLabel: el('versionLabel'),
  lastUpdate: el('lastUpdate'),
  viewPositions: el('viewPositions'),
  viewSettings: el('viewSettings'),
  viewChart: el('viewChart'),
  viewWatchlist: el('viewWatchlist'),
  viewHistory: el('viewHistory'),
  tabs: document.querySelector('.tabs'),
  watchList: el('watchList'),
  watchNote: el('watchNote'),
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

function positionCard(p, hide, onSelect) {
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
  const liqClass = distance !== null && Math.abs(distance) < 10 ? 'liq near' : 'liq';
  grid.append(cell(t('position.liquidation'), liqText, p.liq ? liqClass : ''));

  if (distance !== null) {
    grid.append(cell(t('position.toLiquidation'), formatPercent(distance), liqClass));
  }

  card.append(head, grid);
  return card;
}

export function renderPositions(list, hide, onSelect) {
  dom.list.replaceChildren(...list.map((p) => positionCard(p, hide, onSelect)));

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
  dom.placeholder.hidden = false;
  dom.placeholderText.textContent = text;
  dom.placeholderBtn.hidden = !buttonLabel;
  if (buttonLabel) dom.placeholderBtn.textContent = buttonLabel;
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

/* ---------- seznam trhů ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const HVEZDA = 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z';

function zkratkaObratu(hodnota) {
  if (!Number.isFinite(hodnota) || hodnota <= 0) return '';
  if (hodnota >= 1e9) return `${(hodnota / 1e9).toFixed(1)} B`;
  if (hodnota >= 1e6) return `${(hodnota / 1e6).toFixed(0)} M`;
  return `${Math.round(hodnota / 1e3)} k`;
}

export function renderWatchlist(radky, oblibene, onSelect, onToggleFav) {
  dom.watchList.replaceChildren(
    ...radky.map((trh) => {
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
    }),
  );
  return [...dom.watchList.children];
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
  document.querySelectorAll('.interval-btn').forEach((btn) => {
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
