/** Orchestrace: propojuje modul Bybitu, UI a lifecycle service workeru. */

import { BybitClient } from './bybit.js';
import {
  createPriceChart, NASTROJE, INDIKATORY, popisIndikatoru, nazevIndikatoru,
  IKONY_INDIKATORU, BARVY_KRESEB, TLOUSTKY, PRUHLEDNOSTI,
} from './chart.js';
import {
  SCHEMATA, maNastaveni, nactiNastaveni, ulozNastaveni, resetNastaveni,
  popisekPole, popisekSekce, omez,
} from './indikatory.js';
import { t, setLanguage, applyStaticTexts, JAZYKY } from './i18n.js';
import { priceDecimals, formatPrice } from './format.js';
import * as store from './store.js';
import * as ui from './ui.js';

const el = (id) => document.getElementById(id);

let hideAmounts = store.loadHideAmounts();
let lastPositions = [];

/* ---------- stav grafu ---------- */

/*
 * Čáry pozice si drží barvy podle významu — u SL, TP a likvidace nese barva
 * informaci a vyplatí se. Bílá je naopak výchozí pro **kresby uživatele**,
 * aby nepřebíjely svíčky.
 */
const BARVA_CARY = {
  vstup: '#a78bfa',
  likvidace: '#ea3943',
  sl: '#f0b90b',
  tp: '#16c784',
  prikaz: '#8b9bb0',
};

const CARKOVANI = {
  vstup: [7, 3, 2, 3],   // čerchovaná — referenční úroveň, odliší se na první pohled
  likvidace: [12, 5],    // nejdelší mezery, nejvzdálenější a nejvážnější úroveň
  uroven: [6, 4],        // SL a TP celé pozice
  castecna: [3, 3],      // částečné TP a SL
  prikaz: [1, 4],        // limitky, nejjemnější
};

let chart = null;          // instance se drží i po zavření, ať se otevírá svižně
let chartSymbol = null;    // null = graf je zavřený
let chartPosition = null;  // null = pár bez otevřené pozice
let chartTrh = null;       // poslední cena a změna, když pozice není
let chartInterval = '240';  // 4h je pro přehled nejpoužitelnější
let chartOrders = [];
let chartLineKey = '';     // otisk čar, aby se nepřekreslovaly při každém ticku
let ordersTimer = null;
let magnetZapnut = store.loadMagnet();
let poslednicCena = null;  // kvůli detekci protnutí kresby cenou

const client = new BybitClient({
  onPositions(list) {
    lastPositions = list;
    ui.renderPositions(list, hideAmounts, openChart);
    syncOpenChart(list);
  },
  onKline(bar) {
    if (!chart || !chartSymbol) return;
    chart.updateCandle(bar);
    zkontrolujAlarmy(bar.close, bar.time);
  },
  onDiag() {
    ukazDiagnostiku();
  },
  onStatus(status) {
    ui.renderStatus(status);
    ukazDiagnostiku();
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

/**
 * Diagnostika se ukazuje jen dokud se data nepodařilo načíst. Rozhoduje
 * stav REST, ne počet pozic — nula otevřených pozic je běžný stav a žádnou
 * diagnostiku si nezaslouží.
 */
function ukazDiagnostiku() {
  if (!client.hasCredentials() || client.status.rest === 'ok') {
    ui.showDiagnostics(null);
    return;
  }
  const d = client.diag;
  const s = client.status;
  const cas = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour12: false }) : '—');
  ui.showDiagnostics(
    `krok: ${d.krok}
`
    + `pokusů: ${d.pokusu}   REST: ${s.rest}   WS: ${s.ws}
`
    + `poslední data: ${cas(s.lastUpdate)}
`
    + `chyba: ${d.posledniChyba || '—'}${d.casChyby ? ' (' + cas(d.casChyby) + ')' : ''}`,
  );
}

/* ---------- start ---------- */

function boot() {
  hlidejTicheChyby();
  setLanguage(store.loadLanguage());
  applyStaticTexts();
  postavVyberJazyka();
  ui.renderVersion(self.APP_VERSION, self.APP_BUILD);
  el('hideBtn').classList.toggle('active', hideAmounts);
  el('magnetBtn').classList.toggle('active', magnetZapnut);
  el('onlyFavBtn').classList.toggle('active', jenOblibene);
  wireEvents();
  zapojPrejeti();
  registerServiceWorker();
  connectIfPossible();
}

/**
 * Nic nesmí selhat potichu. Dřív zůstala aplikace viset na „Načítám pozice…"
 * a uživatel neměl šanci zjistit proč — proto se každá neodchycená chyba
 * ukáže v liště.
 */
function hlidejTicheChyby() {
  const ukaz = (popis) => ui.showError(`⚠ ${popis}`);
  window.addEventListener('error', (e) => ukaz(e.message || 'chyba'));
  window.addEventListener('unhandledrejection', (e) => {
    const duvod = e.reason;
    ukaz((duvod && (duvod.message || duvod)) || 'chyba');
  });
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
  ukazDiagnostiku();
  try {
    await client.start();
  } catch (err) {
    ui.showError(err?.message || String(err));
    ui.showPlaceholder(t('positions.failed'), t('action.openSettings'));
  }
}

/* ---------- ovládání ---------- */

function wireEvents() {
  el('settingsBtn').addEventListener('click', openSettings);
  el('backBtn').addEventListener('click', () => ui.showView('positions'));
  el('placeholderBtn').addEventListener('click', openSettings);
  el('retryBtn').addEventListener('click', () => {
    if (client.hasCredentials()) client.refresh();
  });

  el('refreshBtn').addEventListener('click', () => {
    if (client.hasCredentials()) client.refresh();
    else openSettings();
  });

  el('hideBtn').addEventListener('click', () => {
    hideAmounts = !hideAmounts;
    store.saveHideAmounts(hideAmounts);
    el('hideBtn').classList.toggle('active', hideAmounts);
    ui.renderPositions(lastPositions, hideAmounts, openChart);
    if (obchody.length) ui.renderHistory(obchody, hideAmounts, otevriProhlidku);
    if (chartSymbol) {
      ui.renderChartHeader(chartSymbol, chartPosition, hideAmounts, chartTrh);
      ui.renderChartInfo(chartPosition, hideAmounts);
    }
  });

  // Zpět z grafu vede přes historii, ať funguje i hardwarové tlačítko zpět.
  el('chartBackBtn').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => {
    if (chartSymbol) closeChart();
  });

  // Jen tlačítka, která interval opravdu nesou. Střed má stejný vzhled,
  // ale žádný data-interval — bez tohoto filtru ho aplikace brala jako
  // přepnutí na interval „undefined" a vyprázdnila graf.
  document.querySelectorAll('.interval-btn[data-interval]').forEach((btn) => {
    btn.addEventListener('click', () => zmenInterval(btn.dataset.interval));
  });

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => prepniZalozku(btn.dataset.tab));
  });

  el('watchSearch').addEventListener('input', (e) => {
    hledani = e.target.value;
    el('watchClearBtn').hidden = !hledani;
    vykresliTrhy();
  });

  el('watchClearBtn').addEventListener('click', () => {
    hledani = '';
    el('watchSearch').value = '';
    el('watchClearBtn').hidden = true;
    vykresliTrhy();
  });

  el('onlyFavBtn').addEventListener('click', prepniJenOblibene);

  el('indicatorBtn').addEventListener('click', () => otevriNabidku('sheetIndicators'));
  el('settingsResetBtn').addEventListener('click', vratVychoziNastaveni);
  el('fullscreenBtn').addEventListener('click', prepniCelouObrazovku);
  el('centerBtn').addEventListener('click', () => chart?.resetPohledu());
  document.addEventListener('fullscreenchange', osetriCelouObrazovku);

  el('styleDeleteBtn').addEventListener('click', () => chart?.deleteSelected());
  el('styleAlarmBtn').addEventListener('click', () => {
    const id = chart?.selectedId();
    if (id) chart.setAlarm(id, !chart.selectedStyle().alarm);
  });

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => vyberNastroj(btn.dataset.tool));
  });

  el('magnetBtn').addEventListener('click', () => {
    magnetZapnut = !magnetZapnut;
    store.saveMagnet(magnetZapnut);
    el('magnetBtn').classList.toggle('active', magnetZapnut);
  el('onlyFavBtn').classList.toggle('active', jenOblibene);
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
  el('sheetBackdrop').addEventListener('click', zavriNabidky);

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
    if (trhy.length) vykresliTrhy();
    if (chart) {
      postavNabidky();
      if (chartSymbol) {
        ui.renderChartHeader(chartSymbol, chartPosition, hideAmounts, chartTrh);
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

/** Z karty pozice. */
const openChart = (position) => {
  prohlizenyObchod = null;
  return otevriGraf(position.symbol, position, null);
};

/** Ze seznamu trhů — pár, na kterém pozici mít nemusím. */
const openChartSymbol = (trh) => {
  prohlizenyObchod = null;
  return otevriGraf(trh.symbol, null, trh);
};

async function otevriGraf(symbol, position, trh) {
  chartSymbol = symbol;
  chartPosition = position;
  chartTrh = trh;
  chartOrders = [];
  chartLineKey = '';

  ui.renderChartHeader(symbol, position, hideAmounts, trh);
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
    chart.setLoader(nactiSvice);
    chart.setMagnet(magnetZapnut);
    chart.restoreIndicators(store.loadIndicators(), maVlastniPanel);
    oznacAktivniIndikatory();
    postavNabidky();
    postavPaletu();
  }

  chart.setSymbol(symbol, priceDecimals(position?.entry ?? trh?.last ?? 0));
  chart.setInterval(chartInterval); // knihovna si data vyžádá sama
  client.setKlineSubscription(symbol, chartInterval);
  chart.restoreDrawings(store.loadDrawings(symbol));
  if (!prohlizenyObchod) chart.clearTradeMarks();
  chart.setTicking(true);

  await refreshChartOrders();

  clearInterval(ordersTimer);
  // Příkazy nechodí po WebSocketu, takže se dotahují opakovaně.
  ordersTimer = setInterval(refreshChartOrders, 20000);
}

function closeChart() {
  chart?.clearTradeMarks();
  prohlizenyObchod = null;
  chartSymbol = null;
  chartTrh = null;
  // Nástroj se vrací na kurzor, ať graf příště nezačne v režimu kreslení.
  vyberNastroj('');
  zobrazPaletu(null);
  chart?.setTicking(false);
  poslednicCena = null;
  chartPosition = null;
  chartOrders = [];
  clearInterval(ordersTimer);
  client.setKlineSubscription(null, null);
  zavriNabidky();
  ui.showChart(false);
}

/** Loader knihovny — ta si data vyžádá sama, jakmile dostane symbol a období. */
async function nactiSvice() {
  if (!chartSymbol) return [];
  const bars = await client.getKlines(chartSymbol, chartInterval);
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
  if (!interval) return; // pojistka: bez intervalu není co načítat
  chartInterval = interval;
  ui.setActiveInterval(interval);
  if (!chartSymbol || !chart) return;
  chart.setInterval(interval);
  client.setKlineSubscription(chartSymbol, interval);
}

async function refreshChartOrders() {
  const symbol = chartSymbol;
  // Bez klíčů příkazy nenačteme; graf samotný je veřejný a běží dál.
  if (!symbol || !client.hasCredentials()) return;
  try {
    const orders = await client.getOpenOrders(symbol);
    if (chartSymbol !== symbol) return;
    chartOrders = orders;
    applyChartLines(true);
    ui.showChartError('');
  } catch (err) {
    ui.showChartError(err.message || String(err));
  }
}

/* ---------- kresby a indikátory ---------- */

function ulozKresby() {
  if (!chart || !chartSymbol) return;
  store.saveDrawings(chartSymbol, chart.getDrawings());
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
/** Nástroj „cenový alarm" je vodorovná čára, která se rovnou ohlídá. */
const NASTROJ_ALARMU = 'alarmLine';

function vyberNastroj(nastroj) {
  if (!chart) return;
  chart.cancelDrawing();

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === nastroj);
  });

  if (nastroj === NASTROJ_ALARMU) {
    chart.startDrawing('horizontalStraightLine', { alarm: true });
  } else if (nastroj) {
    chart.startDrawing(nastroj);
  }
}

function postavNabidky() {
  el('indicatorList').replaceChildren(
    ...INDIKATORY.map((i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sheet-item';
      btn.dataset.indicator = i.id;

      const ikona = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ikona.setAttribute('viewBox', '0 0 24 24');
      ikona.innerHTML = IKONY_INDIKATORU[i.id] || '';

      const zkratka = document.createElement('span');
      zkratka.className = 'sheet-zkratka';
      zkratka.textContent = i.id;

      const popis = document.createElement('span');
      popis.className = 'sheet-popis';
      popis.textContent = popisIndikatoru(i.id);

      btn.append(ikona, zkratka, popis);
      btn.addEventListener('click', () => {
        chart.toggleIndicator(i.id, i.vlastniPanel);
        zavriNabidky(); // po výběru se roletka zavře, ať nepřekáží grafu
      });

      if (!maNastaveni(i.id)) return btn;

      // Ozubené kolo vedle indikátoru, ne uvnitř — jinak by ťuknutí vedle
      // něj indikátor omylem vyplo.
      const radek = document.createElement('div');
      radek.className = 'sheet-radek';
      const ozubene = document.createElement('button');
      ozubene.type = 'button';
      ozubene.className = 'sheet-ozubene';
      ozubene.setAttribute('aria-label', t('chart.indicatorSettings'));
      ozubene.innerHTML =
        '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/>'
        + '<path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3'
        + 'M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/></svg>';
      ozubene.addEventListener('click', () => otevriNastaveniIndikatoru(i.id));
      radek.append(btn, ozubene);
      return radek;
    }),
  );

  oznacAktivniIndikatory();
}

/* ---------- nastavení indikátorů ---------- */

let nastavovanyIndikator = null;

/**
 * Obrazovka nastavení se skládá ze schématu v js/indikatory.js. Přidat volbu
 * znamená doplnit ji tam — tady se nic nemění.
 */
function otevriNastaveniIndikatoru(id) {
  nastavovanyIndikator = id;
  const hodnoty = { ...nactiNastaveni(id) };
  el('settingsTitle').textContent = nazevIndikatoru(id);

  // Řádky podřízené nějakému přepínači, ať jde jejich dostupnost přepnout
  // hned po jeho přepnutí, bez skládání celé obrazovky znovu.
  const podrizene = [];

  const prekresliDostupnost = () => {
    podrizene.forEach(({ radek, na }) => {
      const dostupne = Boolean(hodnoty[na]);
      radek.classList.toggle('nastaveni-radek--vypnuto', !dostupne);
      radek.querySelectorAll('button, input').forEach((prvek) => {
        prvek.disabled = !dostupne;
      });
    });
  };

  const zmen = (klic, hodnota) => {
    hodnoty[klic] = hodnota;
    ulozNastaveni(id, hodnoty);
    chart?.applyIndicatorSettings(id);
    prekresliDostupnost();
  };

  const prvky = [];
  (SCHEMATA[id] || []).forEach((p) => {
    if (p.sekce) {
      const nadpis = document.createElement('div');
      nadpis.className = 'nastaveni-sekce';
      nadpis.textContent = popisekSekce(p.sekce);
      prvky.push(nadpis);
      return;
    }

    // Schválně ne <label>: globální styl formulářů z něj dělá verzálky
    // a žádné pole k popisku stejně nepatří — přepínač je tlačítko.
    const radek = document.createElement('div');
    radek.className = 'nastaveni-radek';
    const popisek = document.createElement('span');
    popisek.className = 'nastaveni-popisek';
    popisek.textContent = popisekPole(id, p.klic);
    radek.append(popisek);
    radek.append(ovladacPole(p, hodnoty[p.klic], (v) => zmen(p.klic, v)));
    if (p.zavisi) podrizene.push({ radek, na: p.zavisi });
    prvky.push(radek);
  });

  el('settingsBody').replaceChildren(...prvky);
  prekresliDostupnost();
  otevriNabidku('sheetSettings');
}

/** Ovládací prvek podle typu pole. Sem přibývají další typy. */
function ovladacPole(p, hodnota, zmenen) {
  if (p.typ === 'prepinac') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nastaveni-prepinac';
    const vykresli = (v) => {
      btn.classList.toggle('on', Boolean(v));
      btn.setAttribute('aria-pressed', String(Boolean(v)));
    };
    vykresli(hodnota);
    btn.addEventListener('click', () => {
      hodnota = !hodnota;
      vykresli(hodnota);
      zmenen(hodnota);
    });
    return btn;
  }

  if (p.typ === 'barva') {
    const box = document.createElement('div');
    box.className = 'nastaveni-barvy';
    p.paleta.forEach((barva) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nastaveni-barva';
      b.style.background = barva;
      b.classList.toggle('on', barva === hodnota);
      b.addEventListener('click', () => {
        box.querySelectorAll('.nastaveni-barva').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        zmenen(barva);
      });
      box.append(b);
    });
    return box;
  }

  if (p.typ === 'vyber') {
    const box = document.createElement('div');
    box.className = 'nastaveni-volby';
    p.moznosti.forEach((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nastaveni-volba';
      b.textContent = m.klicPopisku ? t(m.klicPopisku) : m.popisek;
      b.classList.toggle('on', m.hodnota === hodnota);
      b.addEventListener('click', () => {
        box.querySelectorAll('.nastaveni-volba').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        zmenen(m.hodnota);
      });
      box.append(b);
    });
    return box;
  }

  // číslo: tlačítka −/+ vedle hodnoty. Na telefonu se trefí líp než klávesnice.
  const box = document.createElement('div');
  box.className = 'nastaveni-cislo';
  const ubrat = document.createElement('button');
  ubrat.type = 'button';
  ubrat.textContent = '−';
  const pridat = document.createElement('button');
  pridat.type = 'button';
  pridat.textContent = '+';
  const pole = document.createElement('input');
  pole.type = 'number';
  pole.inputMode = 'numeric';
  pole.min = String(p.min);
  pole.max = String(p.max);
  pole.value = String(hodnota);

  const nastav = (v) => {
    const platna = omez(p, v);
    pole.value = String(platna);
    zmenen(platna);
  };
  ubrat.addEventListener('click', () => nastav(Number(pole.value) - 1));
  pridat.addEventListener('click', () => nastav(Number(pole.value) + 1));
  pole.addEventListener('change', () => nastav(pole.value));

  box.append(ubrat, pole, pridat);
  return box;
}

function vratVychoziNastaveni() {
  if (!nastavovanyIndikator) return;
  resetNastaveni(nastavovanyIndikator);
  chart?.applyIndicatorSettings(nastavovanyIndikator);
  otevriNastaveniIndikatoru(nastavovanyIndikator); // překreslit s výchozími
}

/* ---------- seznam trhů ---------- */

/** Bybit má přes 700 USDT párů. Bez ořezu by se seznam na telefonu vlekl. */
const LIMIT_SEZNAMU = 150;

/*
 * Mini-grafy se dotahují po jednom páru, takže se načítají až pro řádky,
 * které jsou opravdu vidět. Jinak by se při otevření záložky vystřelilo
 * 150 volání naráz. Jednou stažený pár se drží do konce běhu aplikace.
 */
const SOUBEZNYCH_GRAFU = 4;
const grafyCache = new Map();
const grafyFronta = [];
let grafyBezi = 0;
let sledovac = null;

function odbavGrafy() {
  while (grafyBezi < SOUBEZNYCH_GRAFU && grafyFronta.length) {
    const { symbol, radek } = grafyFronta.shift();
    grafyBezi += 1;
    client
      .getSparkline(symbol)
      .then((data) => {
        grafyCache.set(symbol, data);
        if (radek.isConnected) ui.drawSparkline(radek, data);
      })
      .catch(() => {})
      .finally(() => {
        grafyBezi -= 1;
        odbavGrafy();
      });
  }
}

function sledujGrafy(radky) {
  sledovac?.disconnect();
  sledovac = new IntersectionObserver((zaznamy) => {
    for (const z of zaznamy) {
      if (!z.isIntersecting) continue;
      sledovac.unobserve(z.target);
      const { symbol } = z.target.dataset;
      if (grafyCache.has(symbol)) {
        ui.drawSparkline(z.target, grafyCache.get(symbol));
      } else {
        grafyFronta.push({ symbol, radek: z.target });
      }
    }
    odbavGrafy();
  }, { rootMargin: '150px' });

  radky.forEach((r) => sledovac.observe(r));
}

let obchody = [];
let prohlizenyObchod = null;  // když se graf otevřel z historie

let trhy = [];
let oblibene = new Set(store.loadFavourites());
let jenOblibene = store.loadOnlyFavourites();
let hledani = '';

async function nactiTrhy() {
  if (trhy.length) {
    vykresliTrhy();
    return;
  }
  ui.showWatchNote(t('watchlist.loading'));
  try {
    trhy = await client.getTickers();
  } catch {
    ui.showWatchNote(t('watchlist.failed'));
    return;
  }
  vykresliTrhy();
}

function vykresliTrhy() {
  const dotaz = hledani.trim().toUpperCase();
  let seznam = trhy;
  if (dotaz) seznam = seznam.filter((r) => r.symbol.includes(dotaz));
  if (jenOblibene) seznam = seznam.filter((r) => oblibene.has(r.symbol));

  // Oblíbené vždy nahoře, zbytek zůstává seřazený podle obratu.
  const nahore = seznam.filter((r) => oblibene.has(r.symbol));
  const zbytek = seznam.filter((r) => !oblibene.has(r.symbol));
  // Při hledání se neořezává, jinak by se hledaný pár nemusel objevit.
  const vysledek = [...nahore, ...(dotaz ? zbytek : zbytek.slice(0, LIMIT_SEZNAMU))];

  // Dělič dává smysl jen když nějaké oblíbené jsou a neprobíhá hledání —
  // ve výsledcích hledání by jen mátl.
  const delic = nahore.length && !dotaz
    ? { poIndexu: nahore.length - 1, sbaleno: jenOblibene, onClick: prepniJenOblibene }
    : null;

  const radky = ui.renderWatchlist(vysledek, oblibene, openChartSymbol, prepniOblibeny, delic);
  sledujGrafy(radky);

  if (!vysledek.length) {
    ui.showWatchNote(t(jenOblibene && !dotaz ? 'watchlist.noFavourites' : 'watchlist.empty'));
  } else {
    ui.showWatchNote(t('watchlist.shown', { shown: vysledek.length, total: trhy.length }));
  }
}

/** Stejná funkce jako hvězdička filtru nahoře, jen dostupná i u seznamu. */
function prepniJenOblibene() {
  jenOblibene = !jenOblibene;
  store.saveOnlyFavourites(jenOblibene);
  el('onlyFavBtn').classList.toggle('active', jenOblibene);
  vykresliTrhy();
}

function prepniOblibeny(symbol) {
  if (oblibene.has(symbol)) oblibene.delete(symbol);
  else oblibene.add(symbol);
  store.saveFavourites([...oblibene]);
  vykresliTrhy();
}

const ZALOZKY = ['positions', 'watchlist', 'history'];
let aktivniZalozka = 'positions';

function prepniZalozku(nazev) {
  aktivniZalozka = nazev;
  ui.showView(nazev);
  if (nazev === 'watchlist') nactiTrhy();
  if (nazev === 'history') nactiHistorii();
}

/**
 * Přejetí prstem mezi záložkami. Nespouští se nad otevřeným grafem ani
 * v nastavení a poznat se musí od svislého scrollování — proto se vyžaduje
 * výrazně delší pohyb vodorovně než svisle.
 */
/**
 * Přejíždění mezi záložkami.
 *
 * ⚠ Staví na **dotykových** událostech, ne na ukazovátkových. Prohlížeč si
 * gesto po pár pixelech vezme na scrollování a ukazovátkový proud ukončí
 * (`pointercancel`), takže `pointerup` už nikdy nepřijde. Dotykové události
 * přitom běží dál — ověřeno skutečným gestem, ne syntetickou událostí.
 *
 * `preventDefault()` na `touchmove` scrollování zastaví; na `pointermove`
 * nedělá nic. Volá se až ve chvíli, kdy je jasné, že jde o vodorovný tah,
 * aby svislé scrollování zůstalo normální.
 */
function zapojPrejeti() {
  const POTREBA = 55;      // kolik pixelů musí prst ujet, aby se záložka přepnula
  const ROZHODNUTI = 12;   // od kolika pixelů poznáme, že jde o vodorovný tah
  const hlavni = document.querySelector('main');
  let start = null;
  let vodorovne = false;
  let prejeto = false;

  const zapomen = () => {
    start = null;
    vodorovne = false;
  };

  hlavni.addEventListener('touchstart', (e) => {
    if (chartSymbol || !el('viewSettings').hidden || e.touches.length !== 1) {
      zapomen();
      return;
    }
    start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    vodorovne = false;
  }, { passive: true });

  hlavni.addEventListener('touchmove', (e) => {
    if (!start || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;

    if (!vodorovne && Math.abs(dx) > ROZHODNUTI && Math.abs(dx) > Math.abs(dy)) {
      vodorovne = true;
    }
    if (vodorovne && e.cancelable) e.preventDefault();
  }, { passive: false });

  hlavni.addEventListener('touchend', (e) => {
    if (!start || !vodorovne) {
      zapomen();
      return;
    }
    const dotyk = e.changedTouches[0];
    const dx = dotyk.clientX - start.x;
    const dy = dotyk.clientY - start.y;
    zapomen();
    if (Math.abs(dx) < POTREBA || Math.abs(dx) < Math.abs(dy) * 2) return;

    const kam = ZALOZKY.indexOf(aktivniZalozka) + (dx < 0 ? 1 : -1);
    if (kam < 0 || kam >= ZALOZKY.length) return;

    prejeto = true;
    prepniZalozku(ZALOZKY[kam]);
  }, { passive: true });

  hlavni.addEventListener('touchcancel', zapomen, { passive: true });

  // Po přejetí nesmí doběhnout klepnutí, jinak by se otevřel pár pod prstem.
  hlavni.addEventListener('click', (e) => {
    if (!prejeto) return;
    prejeto = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}

/* ---------- historie obchodů ---------- */

/** Interval podle délky obchodu, ať je v grafu vidět, co se dělo kolem. */
function intervalProObchod(trvaniMs) {
  const hodiny = trvaniMs / 3600e3;
  if (hodiny <= 2) return '1';
  if (hodiny <= 8) return '5';
  if (hodiny <= 36) return '15';
  if (hodiny <= 144) return '60';
  if (hodiny <= 720) return '240';
  return 'D';
}

async function nactiHistorii() {
  if (!client.hasCredentials()) {
    ui.renderHistory([], hideAmounts, () => {});
    ui.showHistoryNote(t('history.needKeys'));
    return;
  }
  if (obchody.length) {
    ui.renderHistory(obchody, hideAmounts, otevriProhlidku);
    ui.showHistoryNote('');
    return;
  }

  ui.showHistoryNote(t('history.loading'));
  try {
    obchody = await client.getClosedTrades(50);
  } catch (err) {
    ui.showHistoryNote(err.message || t('history.failed'));
    return;
  }
  ui.renderHistory(obchody, hideAmounts, otevriProhlidku);
  ui.showHistoryNote(obchody.length ? '' : t('history.none'));
}

/**
 * Otevře graf z doby obchodu a vyznačí do něj jednotlivá plnění.
 * Značky staví na `execution/list`, ne na průměrech z uzavřeného obchodu —
 * průměr by dal jednu značku uprostřed ničeho, kdežto plnění mají přesné
 * časy, takže sednou na správné svíčky.
 */
async function otevriProhlidku(obchod) {
  prohlizenyObchod = obchod;
  chartInterval = intervalProObchod(obchod.closedAt - obchod.openedAt);
  await otevriGraf(obchod.symbol, null, null);

  try {
    // Okno se rozšíří na obě strany, ať jsou vidět i okolní svíčky.
    const rezerva = Math.max(3600e3, (obchod.closedAt - obchod.openedAt) * 0.5);
    const plneni = await client.getExecutions(
      obchod.symbol,
      obchod.openedAt - rezerva,
      obchod.closedAt + rezerva,
    );
    if (prohlizenyObchod !== obchod) return;

    chart.setTradeMarks(
      plneni.map((p) => {
        const vstup = p.buy === obchod.long;
        return {
          time: p.time,
          price: p.price,
          vstup,
          color: vstup ? BARVA_CARY.vstup : (obchod.pnl >= 0 ? BARVA_CARY.tp : BARVA_CARY.likvidace),
          title: t(vstup ? 'trade.entry' : 'trade.exit'),
        };
      }),
    );
    chart.scrollToTime(obchod.closedAt);
    if (plneni.length) ui.showChartError('');
  } catch (err) {
    ui.showChartError(err.message || String(err));
  }
}

/* ---------- alarmy ---------- */

/**
 * Hodnota kresby v daném čase. Vodorovná čára má jednu úroveň, u dvoubodových
 * se hodnota dopočítá (a za koncem extrapoluje) z přímky mezi body.
 */
function hodnotaKresbyVCase(kresba, cas) {
  const body = kresba.points || [];
  if (!body.length) return null;
  if (body.length === 1 || !Number.isFinite(body[1]?.timestamp)) {
    return Number.isFinite(body[0].value) ? body[0].value : null;
  }
  const [a, b] = body;
  if (!Number.isFinite(a.timestamp) || a.timestamp === b.timestamp) return a.value;
  const podil = (cas - a.timestamp) / (b.timestamp - a.timestamp);
  return a.value + (b.value - a.value) * podil;
}

/** Alarm je jednorázový — po zaznění se vypne, ať nezvoní při každém ticku. */
function zkontrolujAlarmy(cena, cas) {
  if (!Number.isFinite(cena)) return;
  const kresby = chart.getDrawings().filter((k) => k.style?.alarm);

  for (const kresba of kresby) {
    const uroven = hodnotaKresbyVCase(kresba, cas);
    if (uroven === null || poslednicCena === null) continue;

    const pred = poslednicCena - uroven;
    const ted = cena - uroven;
    if (pred !== 0 && (pred < 0) === (ted < 0)) continue; // neprotnuto

    navigator.vibrate?.([120, 70, 120]);
    ui.showNotice(t('alarm.triggered', { price: formatPrice(uroven) }));
    chart.setAlarm(kresba.id, false);
  }
  poslednicCena = cena;
}

/* ---------- celá obrazovka ---------- */


/** V celé obrazovce má být vidět co nejvíc grafu, údaje o pozici ustoupí. */
function osetriCelouObrazovku() {
  const vCele = Boolean(document.fullscreenElement);
  el('viewChart').classList.toggle('cela-obrazovka', vCele);
}

async function prepniCelouObrazovku() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el('viewChart').requestFullscreen();
  } catch {
    // Některá zařízení celou obrazovku odmítnou; graf běží dál i bez ní.
  }
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
  el('styleAlarmBtn').classList.toggle('on', Boolean(styl.alarm));
}

function otevriNabidku(id) {
  zavriNabidky();
  el('sheetBackdrop').hidden = false;
  el(id).hidden = false;
}

function zavriNabidky() {
  el('sheetIndicators').hidden = true;
  el('sheetSettings').hidden = true;
  el('sheetBackdrop').hidden = true;
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

  // Bez pozice nejde příkazy zařadit na stranu zisku či ztráty — chybí vstup.
  if (!position) {
    return orders
      .map((o) => o.trigger ?? o.price)
      .filter(Boolean)
      .map((price) => ({ price, color: BARVA_CARY.prikaz,
                         title: t('line.limit'), dash: CARKOVANI.prikaz }));
  }

  lines.push({ price: position.entry, color: BARVA_CARY.vstup,
               title: t('line.entry'), dash: CARKOVANI.vstup });

  if (position.liq) {
    lines.push({ price: position.liq, color: BARVA_CARY.likvidace,
                 title: t('line.liquidation'), dash: CARKOVANI.likvidace });
  }
  // Úrovně platné pro celou pozici mají holý popisek, bez čísla.
  if (position.stopLoss) {
    lines.push({ price: position.stopLoss, color: BARVA_CARY.sl,
                 title: t('line.stopLoss'), dash: CARKOVANI.uroven });
  }
  if (position.takeProfit) {
    lines.push({ price: position.takeProfit, color: BARVA_CARY.tp,
                 title: t('line.takeProfit'), dash: CARKOVANI.uroven });
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
      dash: CARKOVANI.castecna,
    });
  });

  sl.sort(podleVzdalenosti).forEach((o, i) => {
    lines.push({
      price: o.price,
      color: BARVA_CARY.sl,
      title: popisek(t('line.stopLossN', { n: i + 1 }), o),
      dash: CARKOVANI.castecna,
    });
  });

  limitky.forEach((o) => {
    lines.push({ price: o.price, color: BARVA_CARY.prikaz,
                 title: t('line.limit'), dash: CARKOVANI.prikaz });
  });

  return lines;
}

/**
 * Čáry se překreslují jen při skutečné změně. Bez toho by se rušily a znovu
 * vytvářely při každém ticku ceny, protože pozice chodí i z ticker streamu.
 */
function applyChartLines(force = false) {
  if (!chart || !chartSymbol) return;

  const lines = buildChartLines(chartPosition, chartOrders);
  const key = lines.map((l) => `${l.title}@${l.price}`).join('|');
  if (!force && key === chartLineKey) return;

  chartLineKey = key;
  chart.setPositionLines(lines);
}

/** Pozice se mění za běhu — graf musí držet krok s PnL, SL/TP i likvidací. */
function syncOpenChart(list) {
  if (!chartPosition || !chartSymbol) return;

  const fresh = list.find(
    (p) => p.symbol === chartPosition.symbol && p.positionIdx === chartPosition.positionIdx,
  );
  if (!fresh) {
    // Pozice byla zavřená — graf nechat otevřený, jen bez čar pozice.
    chartOrders = [];
    return;
  }

  chartPosition = fresh;
  ui.renderChartHeader(chartSymbol, fresh, hideAmounts);
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
