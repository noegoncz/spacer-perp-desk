/** Orchestrace: propojuje modul Bybitu, UI a lifecycle service workeru. */

import { BybitClient } from './bybit.js';
import {
  createPriceChart, NASTROJE, INDIKATORY, nazevNastroje, nazevIndikatoru,
  BARVY_KRESEB, TLOUSTKY, PRUHLEDNOSTI,
} from './chart.js';
import { t, setLanguage, applyStaticTexts, JAZYKY } from './i18n.js';
import { priceDecimals } from './format.js';
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
let magnetZapnut = store.loadMagnet();

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
      ui.showPlaceholder(t('positions.failed'), t('action.openSettings'));
    }
  },
});

/* ---------- start ---------- */

function boot() {
  setLanguage(store.loadLanguage());
  applyStaticTexts();
  postavVyberJazyka();
  ui.renderVersion(self.APP_VERSION, self.APP_BUILD);
  el('hideBtn').classList.toggle('active', hideAmounts);
  el('magnetBtn').classList.toggle('active', magnetZapnut);
  wireEvents();
  registerServiceWorker();
  connectIfPossible();
}

async function connectIfPossible() {
  const { apiKey, apiSecret } = store.loadCredentials();

  if (!apiKey || !apiSecret) {
    ui.showPlaceholder(t('positions.noKeys'), t('action.openSettings'));
    ui.showView('positions');
    return;
  }

  client.setCredentials(apiKey, apiSecret);
  ui.showPlaceholder(t('positions.loading'));
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
    btn.addEventListener('click', () => zmenInterval(btn.dataset.interval));
  });

  el('indicatorBtn').addEventListener('click', () => otevriNabidku('sheetIndicators'));
  el('moreToolsBtn').addEventListener('click', () => otevriNabidku('sheetDraw'));

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => vyberNastroj(btn.dataset.tool));
  });

  el('magnetBtn').addEventListener('click', () => {
    magnetZapnut = !magnetZapnut;
    store.saveMagnet(magnetZapnut);
    el('magnetBtn').classList.toggle('active', magnetZapnut);
    chart?.setMagnet(magnetZapnut);
  });

  el('eraseBtn').addEventListener('click', () => {
    // Když má uživatel kresbu v úpravách, koš maže jen ji — jinak všechny.
    if (chart?.hasSelection()) {
      chart.deleteSelected();
      return;
    }
    if (!confirm(t('chart.confirmEraseAll'))) return;
    chart?.clearDrawings();
    vyberNastroj('');
  });
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', zavriNabidky);
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

/** Přepnutí jazyka překreslí vše — texty jsou i v už vykreslených prvcích. */
function postavVyberJazyka() {
  const select = el('language');
  select.replaceChildren(
    ...JAZYKY.map((j) => {
      const opt = document.createElement('option');
      opt.value = j.id;
      opt.textContent = j.nazev;
      return opt;
    }),
  );
  select.value = store.loadLanguage();
  select.addEventListener('change', () => {
    store.saveLanguage(select.value);
    setLanguage(select.value);
    applyStaticTexts();
    ui.renderPositions(lastPositions, hideAmounts, openChart);
    ui.renderStatus(client.status);
    if (chart) {
      postavNabidky();
      if (chartPosition) {
        ui.renderChartHeader(chartPosition, hideAmounts);
        ui.renderChartInfo(chartPosition, hideAmounts);
        applyChartLines(true);
      }
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
    ui.showSettingsMessage(t('settings.fillBoth'), false);
    return;
  }

  const btn = el('testBtn');
  btn.disabled = true;
  btn.textContent = t('settings.testing');
  ui.clearSettingsMessage();

  const result = await client.testCredentials(apiKey, apiSecret);

  btn.disabled = false;
  btn.textContent = t('settings.test');
  ui.showSettingsMessage(
    result.ok ? t('settings.ok') : result.message,
    result.ok,
  );
}

async function saveAndConnect() {
  const { apiKey, apiSecret } = readForm();
  if (!apiKey || !apiSecret) {
    ui.showSettingsMessage(t('settings.fillBoth'), false);
    return;
  }

  const btn = el('saveBtn');
  btn.disabled = true;
  btn.textContent = t('settings.saving');

  const result = await client.testCredentials(apiKey, apiSecret);

  btn.disabled = false;
  btn.textContent = t('settings.save');

  if (!result.ok) {
    ui.showSettingsMessage(result.message, false);
    return;
  }

  // Ukládá se až po ověření, ať se do telefonu nedostane nefunkční klíč.
  store.saveCredentials(apiKey, apiSecret);
  client.stop();
  client.setCredentials(apiKey, apiSecret);
  ui.clearError();
  ui.showPlaceholder(t('positions.loading'));
  ui.showView('positions');
  await client.start();
}

function clearCredentials() {
  if (!confirm(t('settings.confirmClear'))) return;
  client.stop();
  store.clearCredentials();
  lastPositions = [];
  el('apiKey').value = '';
  el('apiSecret').value = '';
  ui.showSettingsMessage(t('settings.cleared'), true);
  ui.showPlaceholder(t('positions.keysCleared'), t('action.openSettings'));
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
  if (!chart) {
    chart = createPriceChart(el('chartBox'), el('drawLayer'), {
      onDrawingsChanged: ulozKresby,
      onDrawEnd: () => vyberNastroj(''), // po dokreslení zpět na kurzor
      onIndicatorsChanged: ulozIndikatory,
      onSelectionChanged: zobrazPaletu,
    });
    postavPaletu();
    chart.setLoader(nactiSvice);
    chart.setMagnet(magnetZapnut);
    chart.restoreIndicators(store.loadIndicators(), maVlastniPanel);
    oznacAktivniIndikatory();
    postavNabidky();
  }

  chart.setSymbol(position.symbol, priceDecimals(position.entry));
  chart.setInterval(chartInterval); // knihovna si data vyžádá sama
  client.setKlineSubscription(position.symbol, chartInterval);
  chart.restoreDrawings(store.loadDrawings(position.symbol));

  await refreshChartOrders();

  clearInterval(ordersTimer);
  // Příkazy nechodí po WebSocketu, takže se dotahují opakovaně.
  ordersTimer = setInterval(refreshChartOrders, 20000);
}

function closeChart() {
  // Nástroj se vrací na kurzor, ať graf příště nezačne v režimu kreslení.
  vyberNastroj('');
  zobrazPaletu(null);
  chartPosition = null;
  chartOrders = [];
  clearInterval(ordersTimer);
  client.setKlineSubscription(null, null);
  zavriNabidky();
  ui.showChart(false);
}

/** Loader knihovny — ta si data vyžádá sama, jakmile dostane symbol a období. */
async function nactiSvice() {
  if (!chartPosition) return [];
  const bars = await client.getKlines(chartPosition.symbol, chartInterval);
  return bars.map((b) => ({
    timestamp: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

function zmenInterval(interval) {
  chartInterval = interval;
  ui.setActiveInterval(interval);
  if (!chartPosition || !chart) return;
  chart.setInterval(interval);
  client.setKlineSubscription(chartPosition.symbol, interval);
}

async function refreshChartOrders() {
  const position = chartPosition;
  if (!position) return;
  try {
    const orders = await client.getOpenOrders(position.symbol);
    if (chartPosition?.symbol !== position.symbol) return;
    chartOrders = orders;
    applyChartLines(true);
    ui.showChartError('');
  } catch (err) {
    ui.showChartError(err.message || String(err));
  }
}

/* ---------- kresby a indikátory ---------- */

function ulozKresby() {
  if (!chart || !chartPosition) return;
  store.saveDrawings(chartPosition.symbol, chart.getDrawings());
}

function ulozIndikatory() {
  if (!chart) return;
  store.saveIndicators(chart.activeIndicators());
  oznacAktivniIndikatory();
}

const maVlastniPanel = (nazev) =>
  INDIKATORY.find((i) => i.id === nazev)?.vlastniPanel ?? true;

function oznacAktivniIndikatory() {
  if (!chart) return;
  const aktivni = new Set(chart.activeIndicators());
  document.querySelectorAll('#indicatorList .sheet-item').forEach((btn) => {
    btn.classList.toggle('active', aktivni.has(btn.dataset.indicator));
  });
}

/**
 * Vybere kreslicí nástroj. Prázdný řetězec znamená kurzor, tedy jen posun
 * a zoom. Rozdělané kreslení se přepnutím zruší, ať nezůstane viset.
 */
function vyberNastroj(nastroj) {
  if (!chart) return;
  chart.cancelDrawing();

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === nastroj);
  });

  if (nastroj) chart.startDrawing(nastroj);
}

function postavNabidky() {
  el('drawList').replaceChildren(
    ...NASTROJE.map((n) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-item';
      btn.textContent = nazevNastroje(n.id);
      btn.addEventListener('click', () => {
        zavriNabidky();
        vyberNastroj(n.id);
      });
      return btn;
    }),
  );

  el('indicatorList').replaceChildren(
    ...INDIKATORY.map((i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-item';
      btn.dataset.indicator = i.id;
      btn.textContent = nazevIndikatoru(i.id);
      btn.addEventListener('click', () => chart.toggleIndicator(i.id, i.vlastniPanel));
      return btn;
    }),
  );

  oznacAktivniIndikatory();
}

/* ---------- paleta vzhledu kresby ---------- */

function tlacitkoStylu(obsah, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'style-btn';
  btn.append(obsah);
  btn.addEventListener('click', onClick);
  return btn;
}

function postavPaletu() {
  el('styleColors').replaceChildren(
    ...BARVY_KRESEB.map((barva) => {
      const vzorek = document.createElement('span');
      vzorek.className = 'style-swatch';
      vzorek.style.background = barva;
      const btn = tlacitkoStylu(vzorek, () => chart.setSelectedStyle({ color: barva }));
      btn.dataset.color = barva;
      return btn;
    }),
  );

  el('styleWidths').replaceChildren(
    ...TLOUSTKY.map((tloustka) => {
      const cara = document.createElement('span');
      cara.className = 'style-line';
      cara.style.height = `${tloustka + 1}px`;
      const btn = tlacitkoStylu(cara, () => chart.setSelectedStyle({ width: tloustka }));
      btn.dataset.width = String(tloustka);
      return btn;
    }),
  );

  el('styleOpacity').replaceChildren(
    ...PRUHLEDNOSTI.map((kryti) => {
      const kolecko = document.createElement('span');
      kolecko.className = 'style-opacity';
      kolecko.style.opacity = String(kryti);
      const btn = tlacitkoStylu(kolecko, () => chart.setSelectedStyle({ opacity: kryti }));
      btn.dataset.opacity = String(kryti);
      return btn;
    }),
  );
}

/** Paleta se ukazuje jen když je vybraná kresba; jinak by jen překážela. */
function zobrazPaletu(styl) {
  el('stylePanel').hidden = !styl;
  if (!styl) return;

  const oznac = (kontejner, atribut, hodnota) => {
    el(kontejner).querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset[atribut] === String(hodnota));
    });
  };
  oznac('styleColors', 'color', styl.color);
  oznac('styleWidths', 'width', styl.width);
  oznac('styleOpacity', 'opacity', styl.opacity);
}

function otevriNabidku(id) {
  zavriNabidky();
  el(id).hidden = false;
}

function zavriNabidky() {
  el('sheetDraw').hidden = true;
  el('sheetIndicators').hidden = true;
}

/* ---------- čáry pozice ---------- */

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
  const lines = [];

  lines.push({
    price: position.entry,
    color: BARVA_CARY.vstup,
    title: t('line.entry'),
    solid: true,
    width: 2,
  });

  if (position.liq) {
    lines.push({ price: position.liq, color: BARVA_CARY.likvidace, title: t('line.liquidation') });
  }
  // Úrovně platné pro celou pozici mají holý popisek, bez čísla.
  if (position.stopLoss) {
    lines.push({ price: position.stopLoss, color: BARVA_CARY.sl, title: t('line.stopLoss') });
  }
  if (position.takeProfit) {
    lines.push({ price: position.takeProfit, color: BARVA_CARY.tp, title: t('line.takeProfit') });
  }

  const tp = [];
  const sl = [];
  const limitky = [];

  for (const order of orders) {
    const price = order.trigger ?? order.price;
    if (!price) continue;

    // Bybit vrací SL a TP pozice i jako podmíněné příkazy. Bez tohohle by se
    // každá úroveň nakreslila dvakrát, jednou jako TP a jednou jako podmíněná.
    if (samePrice(price, position.stopLoss) || samePrice(price, position.takeProfit)) {
      continue;
    }

    const strana = orderSide(order, position);
    const cil = strana === 'tp' ? tp : strana === 'sl' ? sl : limitky;
    cil.push({ price, qty: order.qty, side: order.side });
  }

  // Číslují se v pořadí, v jakém je cena zasáhne — nejblíž vstupu je první.
  const podleVzdalenosti = (a, b) =>
    Math.abs(a.price - position.entry) - Math.abs(b.price - position.entry);

  // Částečná úroveň nese v popisku podíl z pozice, celá jen holé TP/SL.
  const popisek = (zaklad, o) => {
    const castecny = position.size > 0 && o.qty > 0 && o.qty < position.size;
    if (!castecny) return zaklad;
    return t('line.withShare', {
      label: zaklad,
      percent: Math.round((o.qty / position.size) * 100),
    });
  };

  tp.sort(podleVzdalenosti).forEach((o, i) => {
    lines.push({
      price: o.price,
      color: BARVA_CARY.tp,
      title: popisek(t('line.takeProfitN', { n: i + 1 }), o),
      dotted: true,
    });
  });

  sl.sort(podleVzdalenosti).forEach((o, i) => {
    lines.push({
      price: o.price,
      color: BARVA_CARY.sl,
      title: popisek(t('line.stopLossN', { n: i + 1 }), o),
      dotted: true,
    });
  });

  limitky.forEach((o) => {
    lines.push({ price: o.price, color: BARVA_CARY.prikaz, title: t('line.limit'), dotted: true });
  });

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
  chart.setPositionLines(lines);
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
