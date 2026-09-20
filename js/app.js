/** Orchestrace: propojuje modul Bybitu, UI a lifecycle service workeru. */

import { BybitClient } from './bybit.js';
import { createPriceChart } from './chart.js';
import * as store from './store.js';
import * as ui from './ui.js';

const el = (id) => document.getElementById(id);

let hideAmounts = store.loadHideAmounts();
let lastPositions = [];

/* ---------- stav grafu ---------- */

const BARVA_CARY = {
  vstup: '#4c9aff',
  likvidace: '#ea3943',
  sl: '#f0b90b',
  tp: '#16c784',
  prikaz: '#8b9bb0',
};

let chart = null;          // instance se drží i po zavření, ať se otevírá svižně
let chartPosition = null;  // null = graf je zavřený
let chartInterval = '15';
let chartOrders = [];
let chartLineKey = '';     // otisk čar, aby se nepřekreslovaly při každém ticku
let ordersTimer = null;

const client = new BybitClient({
  onPositions(list) {
    lastPositions = list;
    ui.renderPositions(list, hideAmounts, openChart);
    syncOpenChart(list);
  },
  onKline(bar) {
    if (chart && chartPosition) chart.updateCandle(bar);
  },
  onStatus(status) {
    ui.renderStatus(status);
    // Chybu maže až úspěšné REST načtení. Kdyby se mazala při každé nové
    // pozici, schoval by ji i pouhý tick ceny, zatímco načítání dál padá.
    if (status.rest === 'ok') ui.clearError();
  },
  onError(message) {
    ui.showError(message);
    if (lastPositions.length === 0) {
      ui.showPlaceholder('Pozice se nepodařilo načíst.', 'Otevřít nastavení');
    }
  },
});

/* ---------- start ---------- */

function boot() {
  ui.renderVersion(self.APP_VERSION, self.APP_BUILD);
  el('hideBtn').classList.toggle('active', hideAmounts);
  wireEvents();
  registerServiceWorker();
  connectIfPossible();
}

async function connectIfPossible() {
  const { apiKey, apiSecret } = store.loadCredentials();

  if (!apiKey || !apiSecret) {
    ui.showPlaceholder(
      'Nejdřív zadej read-only API klíč z Bybitu. Uloží se jen do tohoto telefonu.',
      'Otevřít nastavení',
    );
    ui.showView('positions');
    return;
  }

  client.setCredentials(apiKey, apiSecret);
  ui.showPlaceholder('Načítám pozice…');
  await client.start();
}

/* ---------- ovládání ---------- */

function wireEvents() {
  el('settingsBtn').addEventListener('click', openSettings);
  el('backBtn').addEventListener('click', () => ui.showView('positions'));
  el('placeholderBtn').addEventListener('click', openSettings);

  el('refreshBtn').addEventListener('click', () => {
    if (client.hasCredentials()) client.refresh();
    else openSettings();
  });

  el('hideBtn').addEventListener('click', () => {
    hideAmounts = !hideAmounts;
    store.saveHideAmounts(hideAmounts);
    el('hideBtn').classList.toggle('active', hideAmounts);
    ui.renderPositions(lastPositions, hideAmounts, openChart);
    if (chartPosition) {
      ui.renderChartHeader(chartPosition, hideAmounts);
      ui.renderChartInfo(chartPosition, hideAmounts);
    }
  });

  // Zpět z grafu vede přes historii, ať funguje i hardwarové tlačítko zpět.
  el('chartBackBtn').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => {
    if (chartPosition) closeChart();
  });

  document.querySelectorAll('.interval-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      chartInterval = btn.dataset.interval;
      ui.setActiveInterval(chartInterval);
      loadChartData();
    });
  });

  el('revealBtn').addEventListener('click', () => {
    const input = el('apiSecret');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  el('saveBtn').addEventListener('click', saveAndConnect);
  el('testBtn').addEventListener('click', testCredentials);
  el('clearBtn').addEventListener('click', clearCredentials);

  // Android uspaná WS spojení tiše zabíjí — po návratu do popředí se ověří stav.
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    client.setForeground(visible);
    if (visible) {
      client.ensureConnected();
      checkForUpdate();
    }
  });
}

function openSettings() {
  const { apiKey, apiSecret } = store.loadCredentials();
  el('apiKey').value = apiKey;
  el('apiSecret').value = apiSecret;
  el('apiSecret').type = 'password';
  ui.clearSettingsMessage();
  ui.showView('settings');
}

function readForm() {
  return {
    apiKey: el('apiKey').value.trim(),
    apiSecret: el('apiSecret').value.trim(),
  };
}

async function testCredentials() {
  const { apiKey, apiSecret } = readForm();
  if (!apiKey || !apiSecret) {
    ui.showSettingsMessage('Vyplň API key i secret.', false);
    return;
  }

  const btn = el('testBtn');
  btn.disabled = true;
  btn.textContent = 'Zkouším…';
  ui.clearSettingsMessage();

  const result = await client.testCredentials(apiKey, apiSecret);

  btn.disabled = false;
  btn.textContent = 'Vyzkoušet';
  ui.showSettingsMessage(
    result.ok ? 'Spojení funguje, klíč je platný.' : result.message,
    result.ok,
  );
}

async function saveAndConnect() {
  const { apiKey, apiSecret } = readForm();
  if (!apiKey || !apiSecret) {
    ui.showSettingsMessage('Vyplň API key i secret.', false);
    return;
  }

  const btn = el('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Připojuji…';

  const result = await client.testCredentials(apiKey, apiSecret);

  btn.disabled = false;
  btn.textContent = 'Uložit a připojit';

  if (!result.ok) {
    ui.showSettingsMessage(result.message, false);
    return;
  }

  // Ukládá se až po ověření, ať se do telefonu nedostane nefunkční klíč.
  store.saveCredentials(apiKey, apiSecret);
  client.stop();
  client.setCredentials(apiKey, apiSecret);
  ui.clearError();
  ui.showPlaceholder('Načítám pozice…');
  ui.showView('positions');
  await client.start();
}

function clearCredentials() {
  if (!confirm('Opravdu smazat API klíče z tohoto telefonu?')) return;
  client.stop();
  store.clearCredentials();
  lastPositions = [];
  el('apiKey').value = '';
  el('apiSecret').value = '';
  ui.showSettingsMessage('Klíče smazány.', true);
  ui.showPlaceholder('Nejsou uložené žádné klíče.', 'Otevřít nastavení');
}

/* ---------- graf ---------- */

async function openChart(position) {
  chartPosition = position;
  chartOrders = [];
  chartLineKey = '';

  ui.renderChartHeader(position, hideAmounts);
  ui.renderChartInfo(position, hideAmounts);
  ui.setActiveInterval(chartInterval);
  ui.showChartError('');
  ui.showChart(true);

  // Aby hardwarové tlačítko zpět zavřelo graf, a ne celou aplikaci.
  history.pushState({ chart: true }, '');

  // Plátno se musí vytvářet až po zobrazení, jinak má nulové rozměry.
  if (!chart) chart = createPriceChart(el('chartBox'));
  chart.setPrecision(position.entry);

  await loadChartData();

  clearInterval(ordersTimer);
  // Příkazy nechodí po WebSocketu, takže se dotahují opakovaně.
  ordersTimer = setInterval(refreshChartOrders, 20000);
}

function closeChart() {
  chartPosition = null;
  chartOrders = [];
  clearInterval(ordersTimer);
  client.setKlineSubscription(null, null);
  ui.showChart(false);
}

async function loadChartData() {
  const position = chartPosition;
  if (!position || !chart) return;
  const { symbol } = position;
  const interval = chartInterval;

  try {
    const [bars, orders] = await Promise.all([
      client.getKlines(symbol, interval),
      // Příkazy jsou jen doplněk, jejich chyba nesmí shodit celý graf.
      client.getOpenOrders(symbol).catch(() => []),
    ]);

    // Uživatel mohl mezitím přepnout pár nebo interval.
    if (chartPosition?.symbol !== symbol || chartInterval !== interval) return;

    chartOrders = orders;
    chart.setCandles(bars);
    applyChartLines(true);
    client.setKlineSubscription(symbol, interval);
    ui.showChartError('');
  } catch (err) {
    ui.showChartError(err.message || String(err));
  }
}

async function refreshChartOrders() {
  const position = chartPosition;
  if (!position) return;
  try {
    const orders = await client.getOpenOrders(position.symbol);
    if (chartPosition?.symbol !== position.symbol) return;
    chartOrders = orders;
    applyChartLines();
  } catch {
    // Tiše — čáry zůstanou z minula, graf běží dál.
  }
}

/** Shoda cen s tolerancí — porovnávat čísla z různých endpointů na rovnost nelze. */
function samePrice(a, b) {
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) < 1e-6;
}

/**
 * Zařadí podmíněný příkaz na stranu zisku nebo ztráty.
 *
 * Primárně podle `stopOrderType` od Bybitu. Když ho nepošle (nebo pošle jen
 * obecné `Stop`), rozhodne poloha vůči vstupu: u longu je cena nad vstupem
 * výběr zisku, pod vstupem ochrana ztráty. U shortu obráceně.
 */
function orderSide(order, position) {
  const type = order.stopType || '';
  if (type.includes('TakeProfit')) return 'tp';
  if (type.includes('StopLoss') || type === 'TrailingStop') return 'sl';

  // Heuristika platí jen na příkazy, které pozici zavírají. Obyčejná limitka
  // bez reduceOnly je vstup nebo přikupování — ta pod vstupem není stop-loss.
  if (!type && !order.reduceOnly) return null;

  const price = order.trigger ?? order.price;
  if (!price || !position.entry) return null;
  const long = position.side !== 'Sell';
  const above = price > position.entry;
  return above === long ? 'tp' : 'sl';
}

function buildChartLines(position, orders) {
  const LS = window.LightweightCharts.LineStyle;
  const lines = [];

  lines.push({
    price: position.entry,
    color: BARVA_CARY.vstup,
    title: 'Vstup',
    style: LS.Solid,
    width: 2,
    dashed: false,
  });

  if (position.liq) {
    lines.push({
      price: position.liq,
      color: BARVA_CARY.likvidace,
      title: 'Likvidace',
      style: LS.LargeDashed,
    });
  }
  // Celkové úrovně pozice — plné čáry přes celou pozici.
  if (position.stopLoss) {
    lines.push({ price: position.stopLoss, color: BARVA_CARY.sl, title: 'SL celé pozice' });
  }
  if (position.takeProfit) {
    lines.push({ price: position.takeProfit, color: BARVA_CARY.tp, title: 'TP celé pozice' });
  }

  for (const order of orders) {
    const price = order.trigger ?? order.price;
    if (!price) continue;

    // Bybit vrací SL a TP pozice i jako podmíněné příkazy. Bez tohohle by se
    // každá úroveň nakreslila dvakrát, jednou jako TP a jednou jako "podmíněný".
    if (samePrice(price, position.stopLoss) || samePrice(price, position.takeProfit)) {
      continue;
    }

    const strana = orderSide(order, position);
    const castecny = position.size > 0 && order.qty > 0 && order.qty < position.size;
    const podil = castecny ? ` ${Math.round((order.qty / position.size) * 100)} %` : '';

    if (strana === 'tp') {
      lines.push({
        price,
        color: BARVA_CARY.tp,
        title: (castecny ? 'Částečný TP' : 'TP') + podil,
        style: LS.Dotted,
      });
    } else if (strana === 'sl') {
      lines.push({
        price,
        color: BARVA_CARY.sl,
        title: (castecny ? 'Částečný SL' : 'SL') + podil,
        style: LS.Dotted,
      });
    } else {
      lines.push({
        price,
        color: BARVA_CARY.prikaz,
        title: `Limit ${order.side === 'Buy' ? 'nákup' : 'prodej'}`,
        style: LS.Dotted,
      });
    }
  }
  return lines;
}

/**
 * Čáry se překreslují jen při skutečné změně. Bez toho by se rušily a znovu
 * vytvářely při každém ticku ceny, protože pozice chodí i z ticker streamu.
 */
function applyChartLines(force = false) {
  if (!chart || !chartPosition) return;

  const lines = buildChartLines(chartPosition, chartOrders);
  const key = lines.map((l) => `${l.title}@${l.price}`).join('|');
  if (!force && key === chartLineKey) return;

  chartLineKey = key;
  chart.setLines(lines);
}

/** Pozice se mění za běhu — graf musí držet krok s PnL, SL/TP i likvidací. */
function syncOpenChart(list) {
  if (!chartPosition) return;

  const fresh = list.find(
    (p) => p.symbol === chartPosition.symbol && p.positionIdx === chartPosition.positionIdx,
  );
  if (!fresh) {
    // Pozice byla zavřená — graf nechat otevřený, jen bez čar pozice.
    chartOrders = [];
    return;
  }

  chartPosition = fresh;
  ui.renderChartHeader(fresh, hideAmounts);
  // Panel se překresluje pokaždé — mark, PnL i ROE se mění s každým tickem.
  ui.renderChartInfo(fresh, hideAmounts);
  applyChartLines();
}

/* ---------- service worker a hláška o nové verzi ---------- */

let registration = null;
let updateRequested = false;

/**
 * Lišta se řídí stavem, ne událostí: ukazuje se, jen když opravdu čeká nový
 * service worker. Dřív se zapínala na událost a už se nikdy nepřehodnotila,
 * takže zůstala viset i po tom, co čekající worker převzal řízení.
 */
function refreshUpdateBar() {
  const waiting = registration?.waiting;
  const isUpdate = Boolean(waiting) && Boolean(navigator.serviceWorker.controller);
  ui.showUpdateBar(isUpdate);
  // Až čekající worker přejde do jiného stavu, přehodnoť to znovu.
  waiting?.addEventListener('statechange', refreshUpdateBar);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    // updateViaCache: 'none' je tu zásadní. Výchozí 'imports' bere skripty
    // z importScripts() z HTTP cache — a sw.js importuje js/version.js.
    // Zastaralá kopie version.js pak dá jiný obsah workeru než ten aktivní,
    // prohlížeč to vyhodnotí jako novou verzi a lišta se vrací donekonečna.
    registration = await navigator.serviceWorker.register('sw.js', {
      updateViaCache: 'none',
    });
  } catch {
    return; // bez SW aplikace funguje dál, jen bez offline cache
  }

  refreshUpdateBar();

  registration.addEventListener('updatefound', () => {
    // Bez controlleru jde o první instalaci, ne o update — to řeší refreshUpdateBar.
    registration.installing?.addEventListener('statechange', refreshUpdateBar);
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload jen když si ho uživatel vyžádal, jinak by první instalace
    // (clients.claim) způsobila reload hned po otevření.
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });

  el('updateBtn').addEventListener('click', () => {
    const waiting = registration.waiting;
    ui.showUpdateBar(false);

    if (!waiting) {
      // Nemá co aktivovat — lišta byla zastaralá, stačí přenačíst.
      location.reload();
      return;
    }
    updateRequested = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
}

function checkForUpdate() {
  registration?.update().catch(() => {});
}

boot();
