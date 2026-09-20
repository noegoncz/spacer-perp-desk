/** Vykreslování. Žádná logika kolem Bybitu, jen DOM. */

import {
  formatPrice,
  formatSize,
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
  settingsMsg: el('settingsMsg'),
  updateBar: el('updateBar'),
  chartSymbol: el('chartSymbol'),
  chartBadge: el('chartBadge'),
  chartPnl: el('chartPnl'),
  chartLegend: el('chartLegend'),
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
    if (margin > 0) return { value: (p.pnl / margin) * 100, label: 'ROE' };
  }
  if (p.entry && p.mark) {
    const dir = p.side === 'Sell' ? -1 : 1;
    return { value: ((p.mark - p.entry) / p.entry) * 100 * dir, label: 'cena' };
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
  badge.textContent = isLong ? 'LONG' : 'SHORT';
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
    cell('Velikost', hide ? MASK : formatSize(p.size)),
    cell('Vstup', formatPrice(p.entry)),
    cell('Mark', formatPrice(p.mark)),
  );

  const distance = liquidationDistance(p);
  const liqText = p.liq ? formatPrice(p.liq) : 'bez likvidace';
  const liqClass = distance !== null && Math.abs(distance) < 10 ? 'liq near' : 'liq';
  grid.append(cell('Likvidace', liqText, p.liq ? liqClass : ''));

  if (distance !== null) {
    grid.append(cell('Do likvidace', formatPercent(distance), liqClass));
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
    dom.placeholderText.textContent = 'Žádné otevřené pozice.';
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

const STATUS_TEXT = {
  idle: ['', 'Nepřipojeno'],
  connecting: ['connecting', 'Připojuji…'],
  reconnecting: ['connecting', 'Obnovuji spojení…'],
  live: ['live', 'Živě'],
  error: ['error', 'Chyba spojení'],
};

export function renderStatus(status) {
  const [cls, text] = STATUS_TEXT[status.ws] || STATUS_TEXT.idle;
  dom.statusDot.className = `dot ${cls}`;
  dom.statusText.textContent = text;
  dom.lastUpdate.textContent = status.lastUpdate
    ? `aktualizace ${formatTime(status.lastUpdate)}`
    : '';
}

export function showError(message) {
  dom.errorBar.textContent = message;
  dom.errorBar.hidden = false;
}

export function clearError() {
  dom.errorBar.hidden = true;
  dom.errorBar.textContent = '';
}

export function showView(name) {
  dom.viewPositions.hidden = name !== 'positions';
  dom.viewSettings.hidden = name !== 'settings';
  window.scrollTo(0, 0);
}

/**
 * Graf je překryv přes celou obrazovku. Seznam pod ním zůstává namontovaný,
 * takže se po návratu zachová odscrollování.
 */
export function showChart(visible) {
  dom.viewChart.hidden = !visible;
}

export function renderChartHeader(position, hide) {
  const isLong = position.side !== 'Sell';
  dom.chartSymbol.textContent = position.symbol;
  dom.chartBadge.className = `badge ${isLong ? 'long' : 'short'}`;
  dom.chartBadge.textContent = isLong ? 'LONG' : 'SHORT';
  if (position.leverage) {
    dom.chartBadge.textContent += ` ${formatSize(position.leverage)}×`;
  }
  dom.chartPnl.className = `chart-pnl ${pnlClass(position.pnl)}`;
  dom.chartPnl.textContent = hide ? MASK : `${formatSignedUsd(position.pnl)} USDT`;
}

export function renderChartLegend(lines) {
  dom.chartLegend.replaceChildren(
    ...lines.map((l) => {
      const item = document.createElement('span');
      item.className = 'legend-item';

      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.borderTopColor = l.color;
      swatch.style.borderTopStyle = l.dashed === false ? 'solid' : 'dashed';

      const label = document.createElement('span');
      label.textContent = `${l.title} ${formatPrice(l.price)}`;

      item.append(swatch, label);
      return item;
    }),
  );
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
