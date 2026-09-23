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
import { t, setLanguage, applyStaticTexts, JAZYKY, getLocale } from './i18n.js';
import { priceDecimals, formatPrice, formatPercent, liquidationDistance } from './format.js';
import * as alarmy from './alarmy.js';
import * as store from './store.js';
import * as ui from './ui.js';

const el = (id) => document.getElementById(id);

/*
 * ⚠ Prvek nemusí existovat. Při aktualizaci umí prohlížeč krátce servírovat
 * **novou index.html se starým app.js** (nebo naopak) — starý kód pak hledá
 * prvek, který v nové stránce už není, `addEventListener` spadne na null
 * a s ním celý start aplikace.
 *
 * Stalo se 2026-09-21 ve verzi 0.10.1 po odstranění tlačítka středu:
 * „Cannot read properties of null (reading 'addEventListener')" a aplikace
 * zůstala viset na „Loading…". Horší než ta chyba byl důsledek — start se
 * nedostal k registraci service workeru, takže se aplikace nemohla sama
 * opravit ani stažením nové verze.
 */
function naUdalost(id, udalost, obsluha) {
  const prvek = el(id);
  if (!prvek) return;
  prvek.addEventListener(udalost, obsluha);
}

function prepniTridu(id, trida, zapnuto) {
  el(id)?.classList.toggle(trida, zapnuto);
}

let hideAmounts = store.loadHideAmounts();
let lastPositions = [];

/* ---------- data o účtu a příkazech (checkpoint 7) ---------- */

let ucetStav = { ucet: null, chyba: null };
let otevrenePrikazy = [];

/* ---------- řazení, filtr a varování (checkpoint 8) ---------- */

let razeni = store.loadPositionSort();
let razeniSestupne = true;
let filtrPozic = store.loadPositionFilter();
let prahLikvidace = store.loadLiqThreshold();
let sltpUpozorneni = store.loadSltpAlerts();
/** Poslední mark cena pozice — z ní se pozná protnutí SL/TP. */
const sltpPosledni = new Map();

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
let poslednicCena = null;  // poslední cena z grafu — předvyplní hladinu alarmu

const client = new BybitClient({
  onPositions(list) {
    lastPositions = list;
    vykresliPozice();
    syncOpenChart(list);
    /*
     * Alarmy na párech s otevřenou pozicí se hlídají i se zavřeným grafem —
     * mark cena chodí z ticker streamu pořád. Otevřený pár se přeskakuje:
     * ten hlídá živá svíčka a míchání dvou různých cen (mark vs. close) by
     * kolem hladiny vyrobilo protnutí, které se nestalo.
     */
    for (const p of list) {
      if (p.symbol !== chartSymbol) zkontrolujHladiny(p.symbol, p.mark);
    }
    zkontrolujSltp(list);
  },
  onAccount(ucet, chyba) {
    ucetStav = { ucet, chyba };
    ui.renderAccount(ucet, chyba, hideAmounts);
    // Equity se ukazuje i v kartách (velikost pozice vůči účtu), takže
    // karty musí dostat šanci se překreslit, až dorazí.
    if (ucet) vykresliPozice();
  },
  onOrders(orders, chyba) {
    otevrenePrikazy = orders;
    // Proužek v kartě i seznam „bez pozice" se staví tady — obojí závisí
    // na tom, které páry mají otevřenou pozici.
    vykresliPozice();
    if (chyba) ui.renderOrders([], hideAmounts, otevriPrikaz, t('orders.failed'));
  },
  onKline(bar) {
    if (!chart || !chartSymbol) return;
    chart.updateCandle(bar);
    poslednicCena = bar.close;
    zkontrolujHladiny(chartSymbol, bar.close);
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

/* ---------- seznam pozic: řazení a filtr ---------- */

/**
 * Klíče řazení. `liq` řadí podle **vzdálenosti** k likvidaci, ne podle
 * ceny — zajímá, jak blízko to má, ne jaké číslo to je. Pozice bez
 * likvidační ceny jde vždy na konec, ať nezabírá místo nahoře.
 */
const KLICE_RAZENI = {
  value: (p) => Math.abs(p.value),
  pnl: (p) => p.pnl,
  liq: (p) => {
    const d = liquidationDistance(p);
    return d === null ? -Infinity : -Math.abs(d);
  },
};

function serazenePozice() {
  const filtrovane = lastPositions.filter((p) => {
    if (filtrPozic === 'long') return p.side !== 'Sell';
    if (filtrPozic === 'short') return p.side === 'Sell';
    return true;
  });

  const klic = KLICE_RAZENI[razeni] || KLICE_RAZENI.value;
  return [...filtrovane].sort((a, b) => {
    const rozdil = klic(a) - klic(b);
    return razeniSestupne ? -rozdil : rozdil;
  });
}

/** Příkazy rozdělené podle páru — karta pozice si bere ty svoje. */
function prikazyPodleParu() {
  const mapa = new Map();
  for (const o of otevrenePrikazy) {
    if (!mapa.has(o.symbol)) mapa.set(o.symbol, []);
    mapa.get(o.symbol).push(o);
  }
  return mapa;
}

/** Překreslí seznam pozic i lištu nad ním podle aktuálního řazení a filtru. */
function vykresliPozice() {
  const seznam = serazenePozice();
  const prikazy = prikazyPodleParu();
  ui.renderPositions(seznam, hideAmounts, openChart, prahLikvidace, {
    zebrik: (p) => zebrikPozice(p, prikazy.get(p.symbol) || []),
    equity: ucetStav.ucet?.equity ?? null,
  });

  /*
   * Samostatný seznam zůstává jen pro příkazy na párech **bez otevřené
   * pozice** — ty by se jinak neměly kde ukázat, proužek v kartě je bez
   * pozice nemá kam nakreslit. Zbytek je vidět rovnou v kartě.
   */
  const sPozici = new Set(lastPositions.map((p) => p.symbol));
  ui.renderOrders(
    otevrenePrikazy.filter((o) => !sPozici.has(o.symbol)),
    hideAmounts,
    otevriPrikaz,
  );
  ui.renderPositionTools(
    {
      viditelne: lastPositions.length > 0,
      sort: razeni,
      sestupne: razeniSestupne,
      filter: filtrPozic,
    },
    prepniRazeni,
    prepniFiltr,
  );
  // Prázdný výsledek filtru není totéž co „žádné pozice" — musí být poznat,
  // že data jsou, jen je schoval filtr.
  if (lastPositions.length > 0 && seznam.length === 0) {
    ui.showFilterEmpty(t('positions.noneMatch'));
  }
}

/** Druhé klepnutí na stejný klíč otočí směr, jako v každé tabulce. */
function prepniRazeni(klic) {
  if (klic === razeni) razeniSestupne = !razeniSestupne;
  else {
    razeni = klic;
    razeniSestupne = true;
    store.savePositionSort(klic);
  }
  vykresliPozice();
}

function prepniFiltr(klic) {
  filtrPozic = klic;
  store.savePositionFilter(klic);
  vykresliPozice();
}

/* ---------- upozornění při zásahu SL/TP (checkpoint 8) ---------- */

/**
 * Zásah stop lossu nebo take profitu.
 *
 * Pozná se z protnutí mark ceny, ne ze zmizení pozice — pozice zmizí i při
 * ručním zavření a to zvonit nemá. Stejná logika jako u cenových alarmů:
 * porovnává se s minulou cenou, takže první tick po startu nic nespustí.
 */
function zkontrolujSltp(list) {
  if (!sltpUpozorneni) return;

  const zive = new Set();
  for (const p of list) {
    const klic = `${p.symbol}#${p.positionIdx ?? 0}`;
    zive.add(klic);
    const predchozi = sltpPosledni.get(klic);
    sltpPosledni.set(klic, p.mark);
    if (!Number.isFinite(predchozi) || !Number.isFinite(p.mark)) continue;

    const protnuto = (uroven) => Number.isFinite(uroven) && uroven > 0
      && (predchozi < uroven) !== (p.mark < uroven);

    if (protnuto(p.stopLoss)) {
      ohlasZasah('sltp.stopLossHit', p.symbol, p.stopLoss);
    } else if (protnuto(p.takeProfit)) {
      ohlasZasah('sltp.takeProfitHit', p.symbol, p.takeProfit);
    }
  }
  // Zavřené pozice ať v paměti nezůstávají viset.
  for (const klic of [...sltpPosledni.keys()]) {
    if (!zive.has(klic)) sltpPosledni.delete(klic);
  }
}

function ohlasZasah(klic, symbol, cena) {
  const text = t(klic, { symbol, price: formatPrice(cena) });
  ozviSe({ zvuk: true, vibrace: true, notifikace: true, symbol, id: `sltp-${symbol}` }, text);
  ui.showNotice(text);
}

/**
 * Podklad pro proužek úrovní v kartě pozice.
 *
 * Smysl: bez otevření grafu má být vidět, jestli a kolik mám nastavených
 * příkazů na obě strany a jak blízko k nim cena je. Vstup je uprostřed,
 * vlevo strana ztráty (SL), vpravo strana zisku (TP) — u shortu se to
 * zrcadlí, aby „vlevo = ztráta" platilo pořád.
 *
 * Vrací jen ceny a druhy; přepočet na pixely dělá ui.js, sem obchodní
 * logika patří a kreslení ne.
 */
function zebrikPozice(p, orders) {
  if (!p.entry || !p.mark) return null;

  const znacky = [];
  const pridej = (cena, druh, qty = 0) => {
    if (!Number.isFinite(cena) || cena <= 0) return;
    znacky.push({
      cena,
      druh,
      // Podíl z pozice dává smysl jen u částečných příkazů; SL/TP celé
      // pozice je prostě celá pozice.
      podil: p.size > 0 && qty > 0 && qty < p.size ? qty / p.size : null,
    });
  };

  pridej(p.stopLoss, 'sl');
  pridej(p.takeProfit, 'tp');

  for (const o of orders) {
    const cena = o.trigger ?? o.price;
    if (!cena) continue;
    // Bybit vrací SL a TP pozice i jako podmíněné příkazy — bez tohohle by
    // na proužku stála každá úroveň dvakrát (stejně jako u čar v grafu).
    if (samePrice(cena, p.stopLoss) || samePrice(cena, p.takeProfit)) continue;
    pridej(cena, orderSide(o, p) || 'limit', o.qty);
  }

  return {
    vstup: p.entry,
    mark: p.mark,
    long: p.side !== 'Sell',
    znacky,
  };
}

/** Klepnutí na příkaz v seznamu otevře graf toho páru. */
function otevriPrikaz(order) {
  const pozice = lastPositions.find((p) => p.symbol === order.symbol) || null;
  prohlizenyObchod = null;
  return otevriGraf(order.symbol, pozice, null);
}

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
  /*
   * ⚠ Registrace service workeru musí stát **před** vším, co může spadnout.
   * Je to jediná cesta, jak se aplikace dostane k opravné verzi; kdyby
   * visela až za sestavením obrazovky, jedna chyba v něm by telefon nechala
   * natrvalo na rozbité verzi.
   */
  registerServiceWorker();
  setLanguage(store.loadLanguage());
  applyStaticTexts();
  postavVyberJazyka();
  ui.renderVersion(self.APP_VERSION, self.APP_BUILD);
  prepniTridu('hideBtn', 'active', hideAmounts);
  prepniTridu('magnetBtn', 'active', magnetZapnut);
  prepniTridu('onlyFavBtn', 'active', jenOblibene);
  wireEvents();
  zapojPrejeti();
  odemkniZvuk();
  hlidejCasoveAlarmy();
  connectIfPossible();
}

/**
 * Prohlížeč nepustí zvuk, dokud uživatel na stránku nesáhne. Kontext se
 * proto probudí při prvním dotyku — ve chvíli, kdy má alarm zaznít, už
 * uživatel telefon v ruce mít nemusí.
 */
function odemkniZvuk() {
  const probud = () => pripravZvuk();
  document.addEventListener('pointerdown', probud, { once: true, passive: true });
  document.addEventListener('touchstart', probud, { once: true, passive: true });
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
  naUdalost('settingsBtn', 'click', openSettings);
  naUdalost('backBtn', 'click', () => ui.showView('positions'));
  naUdalost('placeholderBtn', 'click', openSettings);
  naUdalost('retryBtn', 'click', () => {
    if (client.hasCredentials()) client.refresh();
  });

  naUdalost('refreshBtn', 'click', () => {
    if (client.hasCredentials()) client.refresh();
    else openSettings();
  });

  naUdalost('hideBtn', 'click', () => {
    hideAmounts = !hideAmounts;
    store.saveHideAmounts(hideAmounts);
    el('hideBtn').classList.toggle('active', hideAmounts);
    vykresliPozice();
    // Skrývání částek platí i pro přehled účtu, ne jen pro karty.
    ui.renderAccount(ucetStav.ucet, ucetStav.chyba, hideAmounts);
    if (obchody.length) ui.renderHistory(obchody, hideAmounts, otevriProhlidku);
    if (chartSymbol) {
      ui.renderChartHeader(chartSymbol, chartPosition, hideAmounts, chartTrh);
      ui.renderChartInfo(chartPosition, hideAmounts);
    }
  });

  // Zpět z grafu vede přes historii, ať funguje i hardwarové tlačítko zpět.
  naUdalost('chartBackBtn', 'click', () => history.back());
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

  naUdalost('watchSearch', 'input', (e) => {
    hledani = e.target.value;
    el('watchClearBtn').hidden = !hledani;
    vykresliTrhy();
  });

  naUdalost('watchClearBtn', 'click', () => {
    hledani = '';
    el('watchSearch').value = '';
    el('watchClearBtn').hidden = true;
    vykresliTrhy();
  });

  naUdalost('onlyFavBtn', 'click', prepniJenOblibene);

  naUdalost('indicatorBtn', 'click', () => otevriNabidku('sheetIndicators'));
  naUdalost('alarmBtn', 'click', novyAlarmKrizem);
  naUdalost('alarmSaveBtn', 'click', ulozAlarm);
  naUdalost('alarmDeleteBtn', 'click', smazAlarm);
  naUdalost('settingsResetBtn', 'click', vratVychoziNastaveni);
  naUdalost('fullscreenBtn', 'click', prepniCelouObrazovku);
  document.addEventListener('fullscreenchange', osetriCelouObrazovku);

  naUdalost('styleDeleteBtn', 'click', () => chart?.deleteSelected());
  naUdalost('styleAlarmBtn', 'click', alarmZKresby);

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => vyberNastroj(btn.dataset.tool));
  });

  naUdalost('magnetBtn', 'click', () => {
    magnetZapnut = !magnetZapnut;
    store.saveMagnet(magnetZapnut);
    el('magnetBtn').classList.toggle('active', magnetZapnut);
  el('onlyFavBtn').classList.toggle('active', jenOblibene);
    chart?.setMagnet(magnetZapnut);
  });

  naUdalost('eraseBtn', 'click', () => {
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
  naUdalost('sheetBackdrop', 'click', zavriNabidky);

  naUdalost('revealBtn', 'click', () => {
    const input = el('apiSecret');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  naUdalost('saveBtn', 'click', saveAndConnect);
  naUdalost('testBtn', 'click', testCredentials);
  naUdalost('clearBtn', 'click', clearCredentials);

  // Práh varování před likvidací (checkpoint 8). Ukládá se hned při změně,
  // ať se na to nemusí mačkat zvlášť uložit.
  naUdalost('liqThreshold', 'change', (e) => {
    const hodnota = Math.min(90, Math.max(1, Math.round(Number(e.target.value) || 10)));
    e.target.value = String(hodnota);
    prahLikvidace = hodnota;
    store.saveLiqThreshold(hodnota);
    vykresliPozice();
  });

  naUdalost('sltpAlertsBtn', 'click', () => {
    sltpUpozorneni = !sltpUpozorneni;
    store.saveSltpAlerts(sltpUpozorneni);
    vykresliPrepinacSltp();
  });

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
    vykresliPozice();
    // Přehled účtu má vlastní popisky, překreslit ho taky.
    ui.renderAccount(ucetStav.ucet, ucetStav.chyba, hideAmounts);
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

/** Přepínač upozornění na SL/TP vypadá stejně jako přepínače u indikátorů. */
function vykresliPrepinacSltp() {
  const btn = el('sltpAlertsBtn');
  if (!btn) return;
  btn.classList.toggle('on', sltpUpozorneni);
  btn.setAttribute('aria-pressed', String(sltpUpozorneni));
}

function openSettings() {
  const { apiKey, apiSecret } = store.loadCredentials();
  el('apiKey').value = apiKey;
  el('apiSecret').value = apiSecret;
  el('apiSecret').type = 'password';
  const prah = el('liqThreshold');
  if (prah) prah.value = String(prahLikvidace);
  vykresliPrepinacSltp();
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
      onAlarmTapped: (id) => otevriAlarm(alarmy.najdi(id)),
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
  vykresliAlarmy();
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
  /*
   * Po zavření grafu hlídá pár zase mark cena z tickeru. Referenční cena se
   * proto zahazuje — jinak by skok mezi poslední cenou svíčky a mark cenou
   * vypadal jako protnutí hladiny, které se nestalo.
   */
  alarmy.zapomenCenu(chartSymbol);
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

async function nactiSviceProInterval(interval) {
  const bars = await client.getKlines(chartSymbol, interval);
  return bars.map((b) => ({
    timestamp: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/*
 * Svíčky stažené dopředu pro interval, na který se právě přepíná. Platí na
 * jedno použití — loader si je vyzvedne a zahodí.
 */
let pripraveneSvice = null;
let posledniZadostOInterval = 0;

/** Loader knihovny — ta si data vyžádá sama, jakmile dostane symbol a období. */
async function nactiSvice() {
  if (!chartSymbol) return [];
  if (pripraveneSvice && pripraveneSvice.interval === chartInterval) {
    const { bars } = pripraveneSvice;
    pripraveneSvice = null;
    return bars;
  }
  return nactiSviceProInterval(chartInterval);
}

/**
 * Přepnutí timeframu.
 *
 * ⚠ Svíčky se stahují **dopředu** a graf se přepne, až jsou po ruce. Při
 * přepnutí se totiž kresby z grafu sundají a vracejí se až s novými daty —
 * bez předstihu by po celou dobu čekání na síť blikaly pryč. Na telefonu to
 * byla klidně půlvteřina.
 */
async function zmenInterval(interval) {
  if (!interval) return; // pojistka: bez intervalu není co načítat
  // Klepnutí na už aktivní timeframe nedělá nic, jako v TradingView. Dřív
  // shodilo kresby: knihovna na stejné období znovu nesáhne pro data, takže
  // se nezavolal `getBars`, ve kterém se kresby vracejí zpátky.
  if (interval === chartInterval && chartSymbol && chart) return;

  ui.setActiveInterval(interval); // odezva na klepnutí hned, ne až po síti
  if (!chartSymbol || !chart) {
    chartInterval = interval;
    return;
  }

  // Když uživatel mezitím klepne jinam, tahle žádost se zahodí.
  const zadost = ++posledniZadostOInterval;
  let bars = null;
  try {
    bars = await nactiSviceProInterval(interval);
  } catch {
    /* nevadí — loader si data vyžádá sám, jen to blikne jako dřív */
  }
  // Mezitím mohl uživatel klepnout jinam nebo graf úplně zavřít.
  if (zadost !== posledniZadostOInterval || !chartSymbol || !chart) return;

  pripraveneSvice = bars ? { interval, bars } : null;
  chartInterval = interval;
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
function vyberNastroj(nastroj) {
  if (!chart) return;
  chart.cancelDrawing();

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === nastroj);
  });

  if (nastroj) chart.startDrawing(nastroj);
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

/* ---------- cenové alarmy ---------- */

/** Rozpracovaný alarm v nastavení; do úložiště jde až po klepnutí na Uložit. */
let upravovanyAlarm = null;

/** Datum a čas v jazyce aplikace, ne podle nastavení telefonu. */
const datumCas = (ms) => new Date(ms).toLocaleString(getLocale(), {
  day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Zvuk alarmu přes WebAudio — v repozitáři žádný soubor není, tón si
 * prohlížeč spočítá sám.
 *
 * ⚠ Sinus na 880 Hz byl v telefonu v kapse skoro neslyšet. Alarm musí být
 * pronikavý, ne hezký: obdélníková vlna je plná vyšších harmonických, na
 * které je sluch (a reproduktor telefonu) citlivější, a tón skáče mezi dvěma
 * výškami — kolísání si ucho všimne spíš než stálého pípnutí.
 */
let zvukovyKontext = null;

/** (posun v sekundách, frekvence) — houkačka, ne cinknutí. */
const TONY_ALARMU = [
  [0, 988], [0.18, 1319], [0.36, 988], [0.54, 1319], [0.72, 988], [0.9, 1319],
];
const DELKA_TONU = 0.16;
const HLASITOST = 0.9;

/**
 * Prohlížeč nespustí zvuk, dokud uživatel na stránku nesáhl. Kontext se
 * proto vyrábí a probouzí při prvním dotyku, ne až ve chvíli, kdy alarm
 * zazvoní — tehdy už uživatel telefon v ruce mít nemusí.
 */
function pripravZvuk() {
  try {
    const Kontext = window.AudioContext || window.webkitAudioContext;
    if (!Kontext) return null;
    zvukovyKontext = zvukovyKontext || new Kontext();
    if (zvukovyKontext.state === 'suspended') zvukovyKontext.resume?.();
    return zvukovyKontext;
  } catch {
    return null;
  }
}

function zapipej() {
  const kontext = pripravZvuk();
  if (!kontext) return;
  try {
    const start = kontext.currentTime;
    TONY_ALARMU.forEach(([odstup, frekvence]) => {
      const ton = kontext.createOscillator();
      const hlasitost = kontext.createGain();
      ton.type = 'square';
      ton.frequency.value = frekvence;
      // Náběh a doznění, ať to necvakne. Nula v exponenciále nejde, proto 0.0001.
      hlasitost.gain.setValueAtTime(0.0001, start + odstup);
      hlasitost.gain.exponentialRampToValueAtTime(HLASITOST, start + odstup + 0.01);
      hlasitost.gain.exponentialRampToValueAtTime(0.0001, start + odstup + DELKA_TONU);
      ton.connect(hlasitost).connect(kontext.destination);
      ton.start(start + odstup);
      ton.stop(start + odstup + DELKA_TONU + 0.01);
    });
  } catch {
    // Zvuk je bonus; vibrace, notifikace a pruh v UI fungují i bez něj.
  }
}

/**
 * Systémová notifikace.
 *
 * ⚠ Musí jít přes **service worker**, ne přes `new Notification()` — mobilní
 * Chrome konstruktor nepodporuje a vyhodí výjimku. Doručí se, jen dokud
 * stránka žije (i na pozadí); notifikace se zavřenou aplikací potřebuje APK.
 */
async function ukazNotifikaci(alarm, text) {
  if (alarm.notifikace === false) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const registrace = await navigator.serviceWorker?.getRegistration();
    if (!registrace?.showNotification) return;
    await registrace.showNotification(t('alarm.notifTitle', { symbol: alarm.symbol }), {
      body: text,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: `alarm-${alarm.id}`,
      vibrate: [120, 70, 120],
      requireInteraction: true, // ať nezmizí dřív, než se na telefon podíváš
    });
  } catch {
    // Notifikace je bonus, ostatní odezva běží dál.
  }
}

/** Povolení se ptá až ve chvíli, kdy si uživatel notifikace vysloveně zapne. */
async function zajistiPovoleniNotifikaci() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function ozviSe(alarm, text) {
  if (alarm.vibrace !== false) navigator.vibrate?.([120, 70, 120, 70, 200]);
  if (alarm.zvuk !== false) zapipej();
  ukazNotifikaci(alarm, text);
}

/** Text, který uživatel uvidí: jeho vlastní zpráva, jinak co se stalo. */
function textAlarmu(a) {
  if (a.zprava) return a.zprava;
  if (a.typ === 'cas') return t('alarm.timeHit', { symbol: a.symbol });
  return t('alarm.hit', { symbol: a.symbol, price: formatPrice(alarmy.uroven(a)) });
}

function ohlasAlarmy(spustene) {
  for (const a of spustene) {
    const text = textAlarmu(a);
    ozviSe(a, text);
    ui.showNotice(text);
  }
}

/** Nová cena páru — zkontroluje alarmy a ohlásí, co zaznělo. */
function zkontrolujHladiny(symbol, cena) {
  const spustene = alarmy.zkontroluj(symbol, cena);
  if (!spustene.length) return;
  ohlasAlarmy(spustene);
  // Jednorázový alarm po zaznění zešedne, takže se čáry musí překreslit.
  if (symbol === chartSymbol) vykresliAlarmy();
}

/**
 * Časové alarmy tikají i bez cen a bez otevřeného grafu, takže se hlídají
 * vlastním odpočtem. Deset sekund je dost jemné — přesnost na vteřinu u
 * upozornění na čas nikdo nepotřebuje.
 */
const KROK_CASOVYCH_ALARMU = 10000;

function hlidejCasoveAlarmy() {
  setInterval(() => {
    const spustene = alarmy.zkontrolujCas();
    if (!spustene.length) return;
    ohlasAlarmy(spustene);
    vykresliAlarmy();
  }, KROK_CASOVYCH_ALARMU);
}

/** Cena, na které alarm nabídne hladinu: živá svíčka, jinak mark nebo trh. */
function aktualniCena() {
  return poslednicCena ?? chartPosition?.mark ?? chartTrh?.last ?? 0;
}

/** Popisek u čáry: vlastní zpráva, jinak jen značka se směrem podmínky. */
function popisAlarmu(a) {
  if (a.typ === 'cas') return a.zprava || t('alarm.label');
  const smer = a.smer === 'up' ? '↑ ' : a.smer === 'down' ? '↓ ' : '';
  return smer + (a.zprava || t('alarm.label'));
}

function vykresliAlarmy() {
  if (!chart) return;
  const seznam = chartSymbol ? alarmy.proPar(chartSymbol) : [];
  chart.setAlarmLines(
    seznam.map((a) => ({
      id: a.id,
      typ: a.typ,
      price: a.price,
      body: a.body,
      cas: a.cas,
      barva: a.barva,
      aktivni: a.aktivni,
      title: popisAlarmu(a),
    })),
  );
  prepniTridu('alarmBtn', 'ma-alarm', seznam.some((a) => a.aktivni));
}

/**
 * Nový alarm se zadává **křížem v grafu**, ne číslem: hladinu si uživatel
 * ukáže prstem tam, kam se dívá. Číselník v nastavení zůstává na doladění.
 */
function novyAlarmKrizem() {
  if (!chart || !chartSymbol) return;
  vyberNastroj(''); // rozdělané kreslení by se s křížem pralo
  chart.pickPrice(t('alarm.pickHint'), (bod) => {
    if (!Number.isFinite(bod?.value)) return;
    // Kříž vrací cenu s plnou přesností pixelu; do alarmu patří zaokrouhlená
    // na platná místa páru, jinak by v nastavení stálo 0,3021886009304391.
    otevriAlarm(alarmy.novy(chartSymbol, zaokrouhliCenu(bod.value)));
  });
}

/**
 * Zvonek u vybrané kresby. Z kresby se stane alarm se stejnou geometrií:
 * vodorovná a cenová čára hlídá hladinu, trendová svou úroveň v čase,
 * svislá okamžik. Kresba tím zaniká — jinak by na stejném místě ležely
 * dvě čáry a nebylo by poznat, která z nich zvoní.
 */
function alarmZKresby() {
  if (!chart || !chartSymbol) return;
  const kresba = chart.selectedDrawing();
  if (!kresba) return;
  const alarm = alarmy.zKresby(chartSymbol, kresba);
  if (alarm.typ === 'cena') alarm.price = zaokrouhliCenu(alarm.price);
  chart.deleteSelected();
  otevriAlarm(alarm);
}

/**
 * Krok tlačítek −/+ u ceny. Pevný krok by u BTC (desetitisíce) znamenal
 * stovky klepnutí, proto se odvozuje od ceny — promile, ale nikdy míň
 * než jedno platné desetinné místo páru.
 */
function krokCeny(cena, mista) {
  const nejmensi = 10 ** -mista;
  return Math.max(nejmensi, Number((cena * 0.001).toFixed(mista)));
}

/** Na tolik desetinných míst, kolik jich má cena páru. */
const zaokrouhliCenu = (cena) => Number(Number(cena).toFixed(priceDecimals(cena)));

function otevriAlarm(alarm) {
  if (!chartSymbol) return;
  upravovanyAlarm = { ...(alarm || alarmy.novy(chartSymbol, Number(aktualniCena()) || 0)) };

  // O nadpisu i koši rozhoduje `id`: rozpracovaný alarm, který se vrátil
  // z výběru hladiny v grafu, je pořád ještě nový.
  const ulozeny = Boolean(upravovanyAlarm.id);
  el('alarmTitle').textContent = t(ulozeny ? 'alarm.edit' : 'alarm.new');
  el('alarmDeleteBtn').hidden = !ulozeny;
  postavFormularAlarmu();
  otevriNabidku('sheetAlarm');
}

/**
 * Doladění hladiny ukázáním v grafu. Nastavení se na chvíli zavře, aby bylo
 * na graf vidět, a po potvrzení se otevře zpátky i s ostatními volbami.
 */
function vyberHladinuVGrafu() {
  if (!chart || !chartSymbol || !upravovanyAlarm) return;
  const rozpracovany = upravovanyAlarm;
  zavriNabidky();
  chart.pickPrice(t('alarm.pickHint'), (bod) => {
    if (Number.isFinite(bod?.value)) rozpracovany.price = zaokrouhliCenu(bod.value);
    otevriAlarm(rozpracovany);
  });
}

/** Řádek nastavení: popisek vlevo, ovládání vpravo. */
function radekAlarmu(klic, ovladac) {
  const radek = document.createElement('div');
  radek.className = 'nastaveni-radek';
  const popisek = document.createElement('span');
  popisek.className = 'nastaveni-popisek';
  popisek.textContent = t(klic);
  radek.append(popisek, ovladac);
  return radek;
}

const IKONA_ZAMERENI =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/>'
  + '<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>';

/**
 * Zaměřovač je hlavní cesta k hladině, proto stojí přes celou šířku pod
 * číselníkem a ne jako ikonka vedle něj — musí být na první pohled jasné,
 * že cenu netřeba ťukat.
 */
function tlacitkoZamereni() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'alarm-pick';
  btn.innerHTML = `${IKONA_ZAMERENI}<span>${t('alarm.pickInChart')}</span>`;
  btn.addEventListener('click', vyberHladinuVGrafu);
  return btn;
}

/**
 * Vzdálenost hladiny od vstupu do pozice a od aktuální ceny, v procentech.
 * Tohle je to, v čem uživatel o hladinách přemýšlí — ne v absolutní ceně.
 */
function ukazVzdalenosti() {
  const prvek = el('alarmDistances');
  const a = upravovanyAlarm;
  if (!prvek || !a) return;

  const uroven = a.typ === 'cara' ? alarmy.uroven(a) : Number(a.price);
  const cena = Number(aktualniCena());
  const vstup = Number(chartPosition?.entry) || 0;

  const casti = [];
  if (vstup > 0 && Number.isFinite(uroven)) {
    casti.push(`${t('alarm.fromEntry')} ${formatPercent(((uroven - vstup) / vstup) * 100)}`);
  }
  if (cena > 0 && Number.isFinite(uroven)) {
    casti.push(`${t('alarm.fromPrice')} ${formatPercent(((uroven - cena) / cena) * 100)}`);
  }
  prvek.textContent = casti.join('   ·   ');
  prvek.hidden = !casti.length;
}

function radekVzdalenosti() {
  const prvek = document.createElement('div');
  prvek.id = 'alarmDistances';
  prvek.className = 'alarm-distances';
  return prvek;
}

function poleCeny() {
  const mista = priceDecimals(upravovanyAlarm.price || aktualniCena());
  const krok = krokCeny(Number(upravovanyAlarm.price) || 0, mista);

  const box = document.createElement('div');
  box.className = 'nastaveni-cislo cena';

  const pole = document.createElement('input');
  pole.type = 'number';
  pole.inputMode = 'decimal';
  pole.step = String(krok);
  pole.min = '0';
  pole.value = String(upravovanyAlarm.price ?? '');

  const nastav = (hodnota) => {
    const cislo = Math.max(0, Number(hodnota) || 0);
    upravovanyAlarm.price = Number(cislo.toFixed(mista));
    pole.value = String(upravovanyAlarm.price);
    ukazVzdalenosti();
  };

  const tlacitko = (popis, zmena) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = popis;
    btn.addEventListener('click', () => nastav(Number(pole.value) + zmena));
    return btn;
  };

  pole.addEventListener('change', () => nastav(pole.value));
  box.append(tlacitko('−', -krok), pole, tlacitko('+', krok));
  return box;
}

/** Odezva alarmu: zvuk, vibrace, notifikace — vedle sebe místo tří řádků. */
const ODEZVY = [
  {
    klic: 'zvuk',
    popisek: 'alarm.sound',
    ikona: '<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 4V5L9 9z"/>'
      + '<path d="M17 8a5 5 0 010 8"/></svg>',
  },
  {
    klic: 'vibrace',
    popisek: 'alarm.vibrate',
    ikona: '<svg viewBox="0 0 24 24"><rect x="8" y="4" width="8" height="16" rx="2"/>'
      + '<path d="M4 9v6M20 9v6"/></svg>',
  },
  {
    klic: 'notifikace',
    popisek: 'alarm.notification',
    ikona: '<svg viewBox="0 0 24 24"><path d="M18 15V10a6 6 0 10-12 0v5l-2 3h16z"/>'
      + '<path d="M10 21h4"/></svg>',
  },
];

function prepinaceOdezvy() {
  const box = document.createElement('div');
  box.className = 'alarm-odezva';

  ODEZVY.forEach(({ klic, popisek, ikona }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'alarm-odezva-btn';
    btn.innerHTML = ikona;
    btn.dataset.klic = klic;
    btn.setAttribute('aria-label', t(popisek));
    btn.title = t(popisek);
    btn.classList.toggle('on', upravovanyAlarm[klic] !== false);

    btn.addEventListener('click', async () => {
      const zapnout = !btn.classList.contains('on');
      // Notifikace se musí nejdřív povolit; bez povolení přepínač nenaskočí.
      if (klic === 'notifikace' && zapnout && !(await zajistiPovoleniNotifikaci())) {
        el('alarmNote').textContent = t('alarm.notifDenied');
        return;
      }
      upravovanyAlarm[klic] = zapnout;
      btn.classList.toggle('on', zapnout);
    });
    box.append(btn);
  });
  return box;
}

/** Vstup `datetime-local` — na Androidu otevře nativní výběr data a času. */
function poleCasu() {
  const pad = (n) => String(n).padStart(2, '0');
  const doVstupu = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const pole = document.createElement('input');
  pole.type = 'datetime-local';
  pole.className = 'nastaveni-text';
  pole.value = doVstupu(Number(upravovanyAlarm.cas) || Date.now());
  pole.addEventListener('change', () => {
    const ms = new Date(pole.value).getTime();
    if (Number.isFinite(ms)) upravovanyAlarm.cas = ms;
    ukazPoznamkuAlarmu();
  });
  return pole;
}

/** U šikmé čáry se hladina nezadává — mění se s časem, tak se jen ukáže. */
function textUrovne() {
  const span = document.createElement('span');
  span.className = 'nastaveni-hodnota';
  const uroven = alarmy.uroven(upravovanyAlarm);
  // Doběhlá čára už žádnou úroveň nemá; pomlčka je poctivější než číslo.
  span.textContent = Number.isFinite(uroven) ? formatPrice(uroven) : '—';
  return span;
}

function poleZpravy() {
  const pole = document.createElement('input');
  pole.type = 'text';
  pole.className = 'nastaveni-text';
  pole.maxLength = 40;
  pole.placeholder = t('alarm.messagePlaceholder');
  pole.value = upravovanyAlarm.zprava || '';
  pole.addEventListener('input', () => {
    upravovanyAlarm.zprava = pole.value;
  });
  return pole;
}

/**
 * Formulář se skládá ze stejných ovládacích prvků jako nastavení indikátorů
 * (`ovladacPole`), takže se chová i vypadá stejně.
 */
function postavFormularAlarmu() {
  const a = upravovanyAlarm;
  const volba = (klic, moznosti, hodnota, nastav) =>
    radekAlarmu(
      klic,
      ovladacPole(
        { typ: 'vyber', moznosti },
        hodnota,
        (v) => {
          nastav(v);
          ukazPoznamkuAlarmu();
        },
      ),
    );

  const prvky = [];

  // Co alarm hlídá, se řídí typem: hladinu, šikmou čáru, nebo čas.
  if (a.typ === 'cas') {
    prvky.push(radekAlarmu('alarm.time', poleCasu()));
  } else if (a.typ === 'cara') {
    prvky.push(radekAlarmu('alarm.trendLevel', textUrovne()), radekVzdalenosti());
  } else {
    prvky.push(radekAlarmu('alarm.price', poleCeny()), tlacitkoZamereni(), radekVzdalenosti());
  }

  // Podmínka ani opakování nedávají u času smysl — ten nastane jednou.
  if (a.typ !== 'cas') {
    prvky.push(
      volba('alarm.condition', [
        { hodnota: 'any', klicPopisku: 'alarm.crossAny' },
        { hodnota: 'up', klicPopisku: 'alarm.crossUp' },
        { hodnota: 'down', klicPopisku: 'alarm.crossDown' },
      ], a.smer, (v) => { a.smer = v; }),
      volba('alarm.trigger', [
        { hodnota: false, klicPopisku: 'alarm.onlyOnce' },
        { hodnota: true, klicPopisku: 'alarm.everyTime' },
      ], Boolean(a.opakovat), (v) => { a.opakovat = v; }),
      volba('alarm.expiration', [
        { hodnota: 0, klicPopisku: 'alarm.noExpiry' },
        { hodnota: 1, klicPopisku: 'alarm.day1' },
        { hodnota: 7, klicPopisku: 'alarm.day7' },
        { hodnota: 30, klicPopisku: 'alarm.day30' },
      ], Number(a.platnostDnu) || 0, (v) => { a.platnostDnu = v; }),
    );
  }

  prvky.push(
    radekAlarmu('alarm.message', poleZpravy()),
    // Zvuk, vibrace a notifikace jsou tři ikony v jednom řádku, ne tři
    // řádky s přepínači — formulář se jinak nevejde na displej a tlačítko
    // Uložit zůstane pod okrajem.
    radekAlarmu('alarm.alerting', prepinaceOdezvy()),
  );

  // Zapnutí se nabízí jen u uloženého alarmu; nový je zapnutý z podstaty.
  if (a.id) {
    prvky.push(radekAlarmu('alarm.active',
      ovladacPole({ typ: 'prepinac' }, a.aktivni, (v) => { a.aktivni = v; })));
  }

  el('alarmBody').replaceChildren(...prvky);
  ukazVzdalenosti();
  ukazPoznamkuAlarmu();
}

/** Pod formulářem stojí, kdy alarm vyprší, kdy naposled zazněl a co neumí. */
function ukazPoznamkuAlarmu() {
  const a = upravovanyAlarm;
  if (!a) return;
  const radky = [t('alarm.hint')];
  if (a.typ === 'cara') {
    const rozsah = alarmy.rozsahCary(a);
    radky.unshift(alarmy.dobehla(a)
      ? t('alarm.trendEnded')
      : t('alarm.trendHint', { date: rozsah ? datumCas(rozsah.do) : '—' }));
  }
  // Svislá čára se kreslí většinou do historie; ať uživatel hned vidí, že
  // takový alarm nedává smysl, a nedozví se to až po klepnutí na Uložit.
  if (a.typ === 'cas' && !(Number(a.cas) > Date.now())) radky.unshift(t('alarm.needFuture'));
  if (a.platnostDnu && a.typ !== 'cas') {
    radky.unshift(t('alarm.expiresOn', { date: datumCas(Date.now() + a.platnostDnu * 86400e3) }));
  }
  if (a.spusteno) {
    radky.unshift(t('alarm.lastFired', { time: datumCas(a.spusteno) }));
  }
  el('alarmNote').textContent = radky.join('\n');
}

function ulozAlarm() {
  const a = upravovanyAlarm;
  if (!a) return;
  if (a.typ === 'cena' && !(Number(a.price) > 0)) {
    el('alarmNote').textContent = t('alarm.needPrice');
    return;
  }
  if (a.typ === 'cas' && !(Number(a.cas) > Date.now())) {
    el('alarmNote').textContent = t('alarm.needFuture');
    return;
  }
  // Úprava vypnutého alarmu ho zase zapne — kdo mění hladinu, chce ho hlídat.
  alarmy.uloz({ ...a, aktivni: a.id ? a.aktivni : true });
  upravovanyAlarm = null;
  zavriNabidky();
  vykresliAlarmy();
}

function smazAlarm() {
  if (!upravovanyAlarm?.id) return;
  alarmy.smaz(upravovanyAlarm.id);
  upravovanyAlarm = null;
  zavriNabidky();
  vykresliAlarmy();
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
}

const NABIDKY = ['sheetIndicators', 'sheetSettings', 'sheetAlarm'];

/** Chybějící prvek se přeskočí, ať rozpadlá aktualizace nesestřelí graf. */
function ukazPrvek(id, viditelny) {
  const prvek = el(id);
  if (prvek) prvek.hidden = !viditelny;
}

function otevriNabidku(id) {
  zavriNabidky();
  ukazPrvek('sheetBackdrop', true);
  ukazPrvek(id, true);
}

function zavriNabidky() {
  NABIDKY.forEach((id) => ukazPrvek(id, false));
  ukazPrvek('sheetBackdrop', false);
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

  naUdalost('updateBtn', 'click', () => {
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
