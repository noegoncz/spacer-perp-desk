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
import { t, setLanguage, applyStaticTexts, JAZYKY, getLocale, getLanguage } from './i18n.js';
import { priceDecimals, formatPrice, formatPercent, formatSize, formatUsd, liquidationDistance } from './format.js';

/** Skryté částky (oko) i v popiscích čar v grafu. */
const MASK_CARY = '••••';
import * as alarmy from './alarmy.js';
import * as sestavy from './sestavy.js';
import * as zaloha from './zaloha.js';
import * as ucet from './ucet.js';
import * as zamek from './zamek.js';
import * as pozvanky from './pozvanky.js';
import * as alarmyServer from './alarmy-server.js';
import * as hlaseni from './hlaseni.js';
import { zapojDlazdice } from './dlazdice.js';
import * as mezipamet from './mezipamet.js';
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
  // Vstup tlumeně (2026-10-03, přání uživatele: „ať není moc vidět").
  vstup: 'rgba(167, 139, 250, 0.5)',
  vstupOsa: '#a78bfa',
  likvidace: '#ea3943',
  sl: '#f0b90b',
  // TP prodává → červená (2026-10-03); nákupní limitka → zelená.
  tp: '#f6465d',
  nakup: '#2ebd85',
  prodej: '#f6465d',
  prikaz: '#8b9bb0',
};

/*
 * Barvy trojúhelníků plnění. ⚠ Schválně **jiné než barvy svíček**
 * (`#16c784` / `#ea3943`): značka v barvě svíčky, na které leží, prostě
 * není vidět — a leží na ní skoro vždycky, protože se obchodovalo právě
 * tam. Nákup je proto světlejší zelená, prodej jde do oranžova.
 */
const BARVA_PLNENI = {
  // Barvy z TabTraderu (v0.38.0): jasně zelený nákup a červený prodej nad
  // tlumenými svíčkami — značky ve svíčce nezmizí.
  nakup: '#00e020',
  prodej: '#f84840',
};

/*
 * Typ příkazu, jak ho píše burza (Bybit, `stopOrderType`). Schválně anglicky
 * i v české mutaci — mají souhlasit s tím, co uživatel vidí v aplikaci burzy.
 */
const TYP_PRIKAZU = {
  TakeProfit: 'Take Profit',
  PartialTakeProfit: 'Partial TP',
  StopLoss: 'Stop Loss',
  PartialStopLoss: 'Partial SL',
  TrailingStop: 'Trailing Stop',
  Stop: 'Stop',
  likvidace: 'Liquidation',
  limitBuy: 'Limit Buy',
  limitSell: 'Limit Sell',
};

/*
 * Jedno čárkování pro všechny čekající úrovně (v0.43.0, přání uživatele —
 * různé délky čárek působily neuspořádaně). Rozlišuje je barva a štítek.
 */
const CARKA = [6, 4];
const CARKOVANI = {
  likvidace: CARKA,
  uroven: CARKA,
  castecna: CARKA,
  tp: CARKA,
  limitka: CARKA,
  prikaz: CARKA,
};

let chart = null;          // instance se drží i po zavření, ať se otevírá svižně
let chartSymbol = null;    // null = graf je zavřený
let chartPosition = null;  // null = pár bez otevřené pozice
let chartTrh = null;       // poslední cena a změna, když pozice není
let chartObrat = null;     // objem za 24 h v USDT (řádek nad grafem)
let chartInterval = '240';  // 4h je pro přehled nejpoužitelnější
/*
 * Timeframe, který si **uživatel zvolil sám**. ⚠ Prohlídka obchodu
 * z Historie si interval volí podle délky obchodu (třeba 1m) a dřív ho
 * nechávala nastavený i pro další grafy. Na minutovém grafu jsou načtené
 * jen poslední hodiny, takže kresby nakreslené o dny dřív na 4h zmizely
 * z obrazu — vypadalo to, že se kresby k páru nepamatují. Historie si teď
 * interval jen půjčí a běžný graf se otevře zase na tomhle.
 */
let intervalUzivatele = chartInterval;
let chartOrders = [];
let chartLineKey = '';     // otisk čar, aby se nepřekreslovaly při každém ticku
let ordersTimer = null;
let magnetZapnut = store.loadMagnet();
let poslednicCena = null;  // poslední cena z grafu — předvyplní hladinu alarmu

const client = new BybitClient({
  onPositions(list) {
    lastPositions = list;
    skonciSnimek();
    naplanujVykresleniPozic();
    ulozSnimek();
    if (grafZNotifikace) dokonciGrafZNotifikace();
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
  // Stav fundingu pozice do telefonu (v0.40.0) — příští start ho ukáže hned.
  onFundingUlozit(symbol, stav) {
    if (stav) fundingyUlozene[symbol] = stav;
    else delete fundingyUlozene[symbol];
    clearTimeout(ulozFundingy.odklad);
    ulozFundingy.odklad = setTimeout(ulozFundingy, 1000);
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
    if (status.rest === 'ok') {
      ui.clearError();
      // Varování o nebezpečném klíči ale zůstává, dokud se klíč nevymění.
      if (varovaniKlice) ui.showError(varovaniKlice);
    }
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

/*
 * ⚠ Seznam pozic se při živých cenách **nepřekresluje při každém ticku**.
 * Bybit posílá ticker každých ~100 ms na každý pár, takže se při čtyřech
 * pozicích celý seznam stavěl znovu desetkrát za vteřinu — a to i s otevřeným
 * grafem, kdy seznam vůbec není vidět. Měření (tools/mereni-vykonu.py)
 * ukázalo hlavní vlákno vytížené na 80 %, proto aplikace reagovala líně.
 *
 * Teď se překresluje nejvýš jednou za PRODLEVA_SEZNAMU ms, a když seznam
 * není vidět, jen se poznamená, že je potřeba — překreslí se při návratu.
 * Čtyřikrát za vteřinu na čísla, která se mění o desetiny procenta, stačí.
 * Akce uživatele (řazení, filtr, skrytí částek) kreslí hned, tady ne.
 */
const PRODLEVA_SEZNAMU = 250;
let casPoslednihoSeznamu = 0;
let odlozenySeznam = null;
let seznamZastaraly = false;

function seznamJeVidet() {
  return !el('viewPositions')?.hidden && el('viewChart')?.hidden !== false;
}

function naplanujVykresleniPozic() {
  if (!seznamJeVidet()) {
    seznamZastaraly = true;
    return;
  }
  if (odlozenySeznam) return; // překreslení už čeká, vezme si čerstvá data
  const zbyva = PRODLEVA_SEZNAMU - (Date.now() - casPoslednihoSeznamu);
  if (zbyva <= 0) {
    vykresliPozice();
    return;
  }
  odlozenySeznam = setTimeout(() => {
    odlozenySeznam = null;
    if (seznamJeVidet()) vykresliPozice();
    else seznamZastaraly = true;
  }, zbyva);
}

/** Po návratu na přehled dokreslit, co se mezitím změnilo. */
function dokresliSeznamJeLiZastaraly() {
  if (seznamZastaraly && seznamJeVidet()) vykresliPozice();
}

/** Překreslí seznam pozic i lištu nad ním podle aktuálního řazení a filtru. */
function vykresliPozice() {
  casPoslednihoSeznamu = Date.now();
  seznamZastaraly = false;
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
  ozviSe({ symbol, id: `sltp-${symbol}` }, text, { zvuk: true });
  ui.showNotice(text);
}

/**
 * Trojúhelníky v místech, kde se do pozice doopravdy vstupovalo (a kde se
 * z ní vystupovalo). Nahradily čáru průměrného vstupu — z jedné čáry není
 * poznat, jestli se nakupovalo jednou, nebo pětkrát na různých cenách.
 *
 * ⚠ Bybit dovolí zeptat se na plnění jen za krátké okno, proto se u dlouho
 * držené pozice ukážou jen plnění z posledních dnů. Průměrný vstup zůstává
 * jako číslo v panelu i v proužku karty, takže se nic neztrácí.
 */
const OKNO_PLNENI = 7 * 86400e3;

/*
 * Plnění na páru, dotažená zpětně po 7denních oknech (víc Bybit v jednom
 * dotazu nedá) až k začátku načtených svíček — uživatel chce vidět celou
 * svou historickou aktivitu, ne jen poslední týden (2026-10-03). Drží se
 * v paměti po dobu běhu, ať se při přepnutí timeframu nestahuje znovu.
 */
const plneniPary = new Map();   // symbol → { od, plneni: Map(klíč → plnění) }
const MAX_OKEN_PLNENI = 60;     // pojistka ~ 14 měsíců na jedno dotažení

/*
 * ⚠ Plnění se už nezmění — od v0.39.0 se ukládají do telefonu
 * (`mezipamet`) a z burzy se dotahuje jen to, co přibylo od posledního
 * stažení (s hodinovým překryvem na zpožděné záznamy), a starší úseky,
 * které ještě nikdy staženy nebyly. `jenUlozene` vrátí okamžitě to, co
 * je v telefonu, bez sítě (první vykreslení Historie).
 */
const PREKRYV = 3600e3;
const klicPlneni = (f) => f.execId || `${f.time}|${f.price}|${f.qty}|${f.buy}`;

async function nactiPlneniZTelefonu(symbol) {
  let z = plneniPary.get(symbol);
  if (z) return z;
  const ulozene = await mezipamet.nacti(`plneni:${symbol}`);
  z = plneniPary.get(symbol);   // mezitím mohl přijít jiný požadavek
  if (z) return z;
  z = ulozene?.plneni
    ? { od: ulozene.od, aktualizovano: ulozene.aktualizovano || 0,
        plneni: new Map(ulozene.plneni.map((f) => [klicPlneni(f), f])) }
    : { od: Date.now(), aktualizovano: 0, plneni: new Map() };
  plneniPary.set(symbol, z);
  return z;
}

async function dotahniPlneni(symbol, od, jenUlozene = false) {
  const z = await nactiPlneniZTelefonu(symbol);
  const serazene = () => [...z.plneni.values()].sort((a, b) => a.time - b.time);
  if (jenUlozene) return serazene();

  const ted = Date.now();
  // Nové: od posledního stažení (s překryvem) do teď; poprvé posledních 7 dní.
  const noveOd = z.aktualizovano ? Math.max(z.aktualizovano - PREKRYV, ted - 52 * OKNO_PLNENI) : ted - OKNO_PLNENI;
  const okna = [];
  for (let konec = ted; konec > noveOd; konec -= OKNO_PLNENI) {
    okna.push([Math.max(noveOd, konec - OKNO_PLNENI), konec]);
  }
  // Starší úseky, které ještě nikdy staženy nebyly.
  let hranice = Math.min(z.od, noveOd);
  while (hranice > od && okna.length <= MAX_OKEN_PLNENI) {
    const zacatek = Math.max(od, hranice - OKNO_PLNENI);
    okna.push([zacatek, hranice]);
    hranice = zacatek;
  }
  // Souběžně (v0.38.0), ne okno po okně.
  (await Promise.all(okna.map(([a, b]) => client.getExecutions(symbol, a, b))))
    .forEach((seznam) => seznam.forEach((f) => z.plneni.set(klicPlneni(f), f)));
  z.od = Math.min(z.od, hranice);
  z.aktualizovano = ted;
  mezipamet.uloz(`plneni:${symbol}`, { od: z.od, aktualizovano: z.aktualizovano, plneni: [...z.plneni.values()] });
  return serazene();
}

/*
 * Jeden trojúhelník = jeden **příkaz**, ne jedno plnění (2026-10-04).
 * Burza tržní příkaz často vyplní po kouscích — jeden nákup pak dělal na
 * svíčce sloupec dvaceti trojúhelníků. Plnění téhož příkazu se slijí do
 * jednoho: čas prvního plnění, průměrná cena vážená množstvím.
 */
function sloucitPodlePrikazu(plneni) {
  const prikazy = new Map();
  plneni.forEach((f) => {
    const klic = f.orderId || `${f.time}|${f.buy}`;
    const p = prikazy.get(klic);
    if (!p) {
      prikazy.set(klic, { ...f });
      return;
    }
    const qty = p.qty + f.qty;
    if (qty > 0) p.price = (p.price * p.qty + f.price * f.qty) / qty;
    p.qty = qty;
    p.time = Math.min(p.time, f.time);
  });
  return [...prikazy.values()].sort((a, b) => a.time - b.time);
}

let pozadavekPlneni = 0;

/**
 * Čas otevření pozice z plnění, která už máme (bez sítě): od současné
 * velikosti dozadu, kde je nula, tam pozice začala. `null`, když plnění
 * k otevření nesahají.
 */
function otevreniZPlneni(plneni, position) {
  if (!position || !(position.size > 0)) return null;
  const long = position.side !== 'Sell';
  const epsilon = position.size * 1e-6;
  let zbyva = position.size;
  for (let i = plneni.length - 1; i >= 0; i -= 1) {
    zbyva -= (plneni[i].buy === long ? 1 : -1) * plneni[i].qty;
    if (zbyva <= epsilon) return plneni[i].time;
  }
  return null;
}

async function znackyPlneni(position, od = Date.now() - OKNO_PLNENI) {
  if (!client.hasCredentials() || !chartSymbol) return;
  const symbol = chartSymbol;
  const cislo = ++pozadavekPlneni;
  /*
   * Plnění **otevřené pozice** (od jejího otevření) jsou velká a sytá,
   * starší — už zavřené obchody na páru — malá a tlumená.
   *
   * Rychle (v0.40.0, přání uživatele): nejdřív se značky nakreslí z plnění
   * uložených v telefonu a čas otevření se spočítá z nich (žádné čekání na
   * burzu); pak se doplní, co přibylo. Dopočet otevření z burzy
   * (`client.otevreniPozice`, víc dotazů za sebou) jen když uložená plnění
   * k otevření nesahají.
   */
  const kresli = (plneni, otevreno) => {
    if (chartSymbol !== symbol || prohlizenyObchod || cislo !== pozadavekPlneni) return;
    // Bez známého otevření se za současná berou plnění posledního týdne.
    const hranice = otevreno ?? (Date.now() - OKNO_PLNENI);
    const soucasne = (f) => Boolean(position) && f.time >= hranice;
    chart.setTradeMarks(sloucitPodlePrikazu(plneni).map((f) => ({
      time: f.time,
      price: f.price,
      vstup: f.buy,             // nákup ▲, prodej ▼
      maly: true,
      stary: !soucasne(f),
      color: f.buy ? BARVA_PLNENI.nakup : BARVA_PLNENI.prodej,
    })));
  };
  try {
    const ulozena = await dotahniPlneni(symbol, od, true);
    if (ulozena.length) kresli(ulozena, otevreniZPlneni(ulozena, position));
    const plneni = await dotahniPlneni(symbol, od);
    let otevreno = otevreniZPlneni(plneni, position);
    if (otevreno === null && position) otevreno = await client.otevreniPozice(position).catch(() => null);
    kresli(plneni, otevreno);
  } catch {
    /* značky jsou doplněk — bez nich graf funguje dál */
  }
}

/** „Bybit · Unified" — burza a typ účtu nad grafem (víc burz přijde). */
function popisBurzy() {
  return `Bybit · ${client.typUctu === 'CONTRACT' ? 'Classic' : 'Unified'}`;
}

/** Linka aktuální ceny se ziskem; bez pozice se nekreslí. */
function nastavLinkuPnl() {
  if (!chart) return;
  chart.setPnlInfo(chartPosition && chartPosition.entry
    ? {
      vstup: chartPosition.entry,
      size: chartPosition.size,
      long: chartPosition.side !== 'Sell',
      mena: String(chartPosition.symbol || '').replace(/USDT$|USDC$/, ''),
      skryt: hideAmounts,
    }
    : null);
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
  chartInterval = intervalUzivatele;
  return otevriGraf(order.symbol, pozice, null);
}

/**
 * Diagnostika se ukazuje jen dokud se data nepodařilo načíst. Rozhoduje
 * stav REST, ne počet pozic — nula otevřených pozic je běžný stav a žádnou
 * diagnostiku si nezaslouží.
 */
/** Kdy začalo načítání — diagnostika se ukáže až po chvíli bez dat. */
let zacatekNacitani = 0;
const DIAGNOSTIKA_PO = 6000;

function ukazDiagnostiku() {
  if (!client.hasCredentials() || client.status.rest === 'ok') {
    ui.showDiagnostics(null);
    return;
  }
  // Běžné načtení trvá zlomek vteřiny — diagnostika (a „Zkusit znovu") by
  // jen probleskla. Ukáže se, až když data nejdou déle.
  const ceka = zacatekNacitani ? DIAGNOSTIKA_PO - (Date.now() - zacatekNacitani) : 0;
  if (ceka > 0) {
    ui.showDiagnostics(null);
    clearTimeout(ukazDiagnostiku.odklad);
    ukazDiagnostiku.odklad = setTimeout(ukazDiagnostiku, ceka + 50);
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
  // Zámek hned po textech — obsah nesmí problesknout dřív, než se zamkne.
  zamek.spust({
    onOdemceno: () => dokonciGrafZNotifikace(),
    onZapomenuto: () => {
      if (!confirm(t('lock.forgotConfirm'))) return;
      zamek.zapomenutyPin();
      location.reload();
    },
  });
  postavVyberJazyka();
  ui.renderVersion(self.APP_VERSION, self.APP_BUILD);
  prepniTridu('hideBtn', 'active', hideAmounts);
  prepniTridu('magnetBtn', 'active', magnetZapnut);
  wireEvents();
  vykresliUcet();
  if (ucet.prihlasen() && !store.hasCredentials() && !store.loadJson('perpdesk.exchangeSkipped', false)) {
    ukazUvod('burza');
  }
  // Zakrytí z <head> už převzalo úvodní okno, nebo není potřeba.
  document.documentElement.classList.remove('uvod-start');
  ucet.spust();
  alarmyServer.spust({
    onPush: pushDoAplikace,
    onKlepnuti: (data) => otevriGrafZNotifikace(data?.symbol),
    onZmena: () => vykresliAlarmy(),
  });
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

/*
 * Okamžitý start (v0.34.0): poslední známé pozice, přehled účtu a příkazy
 * se uloží do telefonu a při dalším startu se ukážou **hned**, ztlumené,
 * dokud nedorazí čerstvá data z burzy (obvykle do vteřiny). Dřív se start
 * díval na obrysy karet a pak vše naskočilo naráz a přehled účtu ještě
 * později — stránka poskakovala. Neukládá se nic, co v telefonu už není
 * (klíč tam je taky); do zálohy ani do cloudu to nejde a odhlášení to smaže.
 */
const KLIC_SNIMEK = 'perpdesk.startSnimek';
const SNIMEK_PLATI = 7 * 86400e3;
let snimekUlozen = 0;
let zobrazenSnimek = false;

function ulozSnimek() {
  if (zobrazenSnimek || Date.now() - snimekUlozen < 20e3) return;
  snimekUlozen = Date.now();
  store.saveJson(KLIC_SNIMEK, {
    cas: Date.now(),
    pozice: lastPositions,
    ucet: ucetStav.ucet,
    prikazy: otevrenePrikazy,
  });
}

function ukazSnimek() {
  const s = store.loadJson(KLIC_SNIMEK, null);
  if (!s || !Array.isArray(s.pozice) || Date.now() - s.cas > SNIMEK_PLATI) return false;
  zobrazenSnimek = true;
  lastPositions = s.pozice;
  otevrenePrikazy = Array.isArray(s.prikazy) ? s.prikazy : [];
  if (s.ucet) {
    ucetStav = { ucet: s.ucet, chyba: null };
    ui.renderAccount(s.ucet, null, hideAmounts);
  }
  el('positionList')?.classList.add('zastarale');
  vykresliPozice();
  return true;
}

function skonciSnimek() {
  if (!zobrazenSnimek) return;
  zobrazenSnimek = false;
  el('positionList')?.classList.remove('zastarale');
}

/* Funding pozic z minulého spuštění (js/mezipamet.js, klíč `funding`). */
let fundingyUlozene = {};
function ulozFundingy() {
  mezipamet.uloz('funding', fundingyUlozene);
}

async function connectIfPossible() {
  const { apiKey, apiSecret } = store.loadCredentials();

  if (!apiKey || !apiSecret) {
    ui.showPlaceholder(t('positions.noKeys'), t('exchanges.connect'));
    ui.showView('positions');
    dokresliSeznamJeLiZastaraly();
    return;
  }

  client.setCredentials(apiKey, apiSecret);
  mezipamet.nastavVlastnika(apiKey);
  if (!ukazSnimek()) ui.showLoading();
  // Uložený funding hned do klienta — karty ho ukážou s prvními pozicemi,
  // obnoví se na pozadí. Čtení z telefonu trvá milisekundy.
  try {
    fundingyUlozene = (await mezipamet.nacti('funding')) || {};
    client.obnovUlozeneFundingy(fundingyUlozene);
  } catch { /* bez uloženého fundingu se jen počítá od začátku */ }
  zacatekNacitani = Date.now();
  ukazDiagnostiku();
  try {
    await client.start();
    zkontrolujUlozenyKlic();
  } catch (err) {
    ui.showError(err?.message || String(err));
    ui.showPlaceholder(t('positions.failed'), t('action.openSettings'));
  }
}

/* ---------- ovládání ---------- */

function wireEvents() {
  naUdalost('settingsBtn', 'click', openSettings);
  naUdalost('backBtn', 'click', () => {
    ui.showView('positions');
    dokresliSeznamJeLiZastaraly();
  });
  naUdalost('placeholderBtn', 'click', () => {
    if (store.hasCredentials()) openSettings();
    else ukazUvod('burza', true);
  });
  naUdalost('retryBtn', 'click', () => {
    if (client.hasCredentials()) client.refresh();
  });

  /*
   * ⟳ obnoví to, na co se uživatel dívá (v0.39.0): Pozice → pozice a účet,
   * Watchlists → ceny a objemy, Historie → plná kontrola celého načteného
   * období (znovu stáhne i uložené). Jen stahuje, nic nemaže ani neposílá.
   */
  naUdalost('refreshBtn', 'click', async () => {
    const tl = el('refreshBtn');
    tl?.classList.add('toci');
    try {
      if (aktivniZalozka === 'watchlist') await obnovTrhy();
      else if (!client.hasCredentials()) openSettings();
      else if (aktivniZalozka === 'history') await obnovHistorii(true);
      else await client.refresh();
    } finally {
      tl?.classList.remove('toci');
    }
  });

  naUdalost('hideBtn', 'click', () => {
    hideAmounts = !hideAmounts;
    store.saveHideAmounts(hideAmounts);
    el('hideBtn').classList.toggle('active', hideAmounts);
    vykresliPozice();
    // Skrývání částek platí i pro přehled účtu, ne jen pro karty.
    ui.renderAccount(ucetStav.ucet, ucetStav.chyba, hideAmounts);
    if (skupinyObchodu.length) ui.renderHistory(skupinyObchodu, hideAmounts, otevriSkupinu);
    if (chartSymbol) {
      ui.renderChartHeader(chartSymbol, chartPosition, hideAmounts, chartTrh);
      ui.renderChartInfo(chartPosition, hideAmounts, popisBurzy(), chartObrat);
    }
  });

  // Zpět z grafu vede přes historii, ať funguje i hardwarové tlačítko zpět.
  naUdalost('chartBackBtn', 'click', () => history.back());
  // Totéž velké dole vpravo, na palec pravé ruky. Šipka nahoře vlevo je
  // při držení telefonu v pravé ruce z dosahu.
  naUdalost('chartBackBtnDole', 'click', () => history.back());
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

  // Trhy: nabídka u hvězdičky a správa sestavy.
  // Klepnutí, které po zvednutí prstu z podržené dlaždice dorazí, trefí
  // právě ukázané pozadí — chvíli po otevření nabídky se ignoruje (stejně
  // jako u okna alarmu, `otevrenaNabidkaV`).
  naUdalost('watchBackdrop', 'click', () => {
    if (Date.now() - menuOtevrenoV > 450) zavriNabidkyTrhu();
  });
  naUdalost('addPairBtn', 'click', otevriPridani);
  naUdalost('historyMore', 'click', nactiStarsiHistorii);
  naUdalost('addPairClose', 'click', zavriNabidkyTrhu);
  naUdalost('addPairSearch', 'input', vykresliPridani);
  naUdalost('layoutBtn', 'click', () => {
    const proVse = sestavy.aktivni() === sestavy.VSE;
    sestavy.nastavRozlozeni(proVse, sestavy.rozlozeni(proVse) === 'siroke' ? 'mrizka' : 'siroke');
    vykresliTrhy();
  });
  naUdalost('tileMenuRemove', 'click', () => {
    const id = sestavy.aktivni();
    if (menuPar && id !== sestavy.VSE) sestavy.odeber(id, menuPar);
    zavriNabidkyTrhu();
    vykresliTrhy();
  });
  naUdalost('tileMenuLists', 'click', () => {
    const s = menuPar;
    zavriNabidkyTrhu();
    if (s) otevriPar(s);
  });
  if (el('watchList')) {
    zapojDlazdice(el('watchList'), {
      onPresun: (symbol, cil) => {
        const id = sestavy.aktivni();
        if (id === sestavy.VSE) return;
        sestavy.prohod(id, symbol, cil);
        vykresliTrhy();
      },
      onNabidka: otevriMenuDlazdice,
    });
  }
  naUdalost('sheetPairClose', 'click', zavriNabidkyTrhu);
  naUdalost('sheetListClose', 'click', zavriNabidkyTrhu);
  naUdalost('listSaveBtn', 'click', ulozSestavu);
  naUdalost('sortBtn', 'click', () => {
    ukazPrvek('sheetPair', false);
    ukazPrvek('sheetList', false);
    ukazPrvek('watchBackdrop', true);
    ukazPrvek('sheetSort', true);
  });
  naUdalost('sheetSortClose', 'click', zavriNabidkyTrhu);
  naUdalost('listDeleteBtn', 'click', smazSestavu);
  naUdalost('listName', 'keydown', (e) => {
    if (e.key === 'Enter') ulozSestavu();
  });

  naUdalost('indicatorBtn', 'click', () => otevriNabidku('sheetIndicators'));
  naUdalost('layersBtn', 'click', otevriVrstvy);
  naUdalost('layersAllBtn', 'click', () => {
    const vse = Object.values(chart?.getLayers() || {}).every(Boolean);
    nastavVrstvy(Object.fromEntries(VRSTVY.map(({ klic }) => [klic, !vse])));
    otevriVrstvy();
  });
  naUdalost('alarmBtn', 'click', novyAlarmKrizem);
  naUdalost('quickAlarm', 'click', potvrdRychlyAlarm);
  naUdalost('quickLine', 'click', potvrdRychlouCaru);
  // Jakýkoli další dotyk v grafu nabídku rychlého alarmu zavře.
  el('chartBox')?.addEventListener('touchstart', () => {
    if (rychlyAlarm?.cena) skryjRychlyAlarm();
  }, { passive: true });
  naUdalost('alarmSaveBtn', 'click', ulozAlarm);
  naUdalost('alarmDeleteBtn', 'click', smazAlarm);
  naUdalost('settingsResetBtn', 'click', vratVychoziNastaveni);
  naUdalost('fullscreenBtn', 'click', prepniCelouObrazovku);
  document.addEventListener('fullscreenchange', osetriCelouObrazovku);

  naUdalost('styleDeleteBtn', 'click', () => chart?.deleteSelected());
  naUdalost('styleAlarmBtn', 'click', alarmZKresby);

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      vyberNastroj(btn.dataset.tool);
      // Výběr v nabídce nástrojů ji zavře — kreslí se hned.
      if (btn.classList.contains('tool-item')) zavriNabidky();
    });
  });
  naUdalost('toolsBtn', 'click', () => otevriNabidku('sheetTools'));
  // Hodnoty u čar v coinu, nebo v USDT (v0.42.0).
  naUdalost('unitBtn', 'click', () => {
    hodnotyVUsdt = !hodnotyVUsdt;
    store.saveJson('perpdesk.lineUnit', hodnotyVUsdt ? 'usdt' : 'coin');
    oznacJednotku();
    applyChartLines(true);
  });
  // Přeložení Foldu mění šířku lišty timeframů — aktivní zůstane uprostřed.
  window.addEventListener('resize', () => ui.vycentrujInterval());

  naUdalost('magnetBtn', 'click', () => {
    magnetZapnut = !magnetZapnut;
    store.saveMagnet(magnetZapnut);
    el('magnetBtn').classList.toggle('active', magnetZapnut);
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
  // Klepnutí, které nabídku otevřelo (potvrzení hladiny křížem v grafu),
  // dojde jako `click` až po jejím otevření — a když je nabídka nízká, trefí
  // ztmavené pozadí a hned ji zase zavře. Chvíli po otevření se proto ignoruje.
  naUdalost('sheetBackdrop', 'click', () => {
    if (Date.now() - otevrenaNabidkaV > 400) zavriNabidky();
  });

  naUdalost('revealBtn', 'click', () => {
    const input = el('apiSecret');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  naUdalost('saveBtn', 'click', saveAndConnect);
  naUdalost('testBtn', 'click', testCredentials);
  naUdalost('clearBtn', 'click', clearCredentials);
  naUdalost('backupExportBtn', 'click', ulozZalohu);
  naUdalost('backupImportBtn', 'click', () => el('backupFile')?.click());
  naUdalost('backupFile', 'change', obnovZalohu);

  // Upozornění při prvním spuštění — jednou, pak už jen v Nastavení.
  ukazPrvek('disclaimerNote', !store.loadJson('perpdesk.disclaimerSeen', false));
  naUdalost('disclaimerOkBtn', 'click', () => {
    store.saveJson('perpdesk.disclaimerSeen', true);
    ukazPrvek('disclaimerNote', false);
  });

  // Hlášení problému / nápadu (beta)
  naUdalost('feedbackBtn', 'click', otevriHlaseni);
  pozvanky.spust();
  naUdalost('feedbackSettingsBtn', 'click', otevriHlaseni);
  naUdalost('feedbackClose', 'click', zavriHlaseni);
  naUdalost('feedbackBackdrop', 'click', zavriHlaseni);
  naUdalost('feedbackAddShot', 'click', () => el('feedbackFile')?.click());
  naUdalost('feedbackFile', 'change', pridejSnimky);
  naUdalost('feedbackSend', 'click', odesliHlaseni);
  document.querySelectorAll('.feedback-kind [data-kind]').forEach((b) => {
    b.addEventListener('click', () => {
      hlaseniDruh = b.dataset.kind;
      document.querySelectorAll('.feedback-kind [data-kind]').forEach((x) => {
        x.classList.toggle('active', x === b);
        x.setAttribute('aria-checked', String(x === b));
      });
    });
  });

  // Úvodní obrazovka a burzy
  naUdalost('onbSkipBtn', 'click', () => {
    store.saveJson('perpdesk.exchangeSkipped', true);
    skryjUvod();
  });
  naUdalost('onbCloseBtn', 'click', skryjUvod);
  naUdalost('exchangeAddBtn', 'click', () => ukazUvod('burza', true));

  // Alarmy hlídané serverem (push, i se zhasnutým displejem)
  alarmyServer.naZmenu(vykresliPushStav);
  naUdalost('accountPushBtn', 'click', async () => {
    await alarmyServer.zapniPush();
    vykresliPushStav();
  });

  // Zámek aplikace (nastavení)
  naUdalost('lockPinToggle', 'click', () => {
    rezimZamku = zamek.zapnuto() ? 'vypnout' : 'novy';
    vykresliZamek(true);
  });
  naUdalost('lockChangeBtn', 'click', () => {
    rezimZamku = 'zmenaStary';
    vykresliZamek(true);
  });
  naUdalost('lockSetupOk', 'click', potvrdPinZamku);
  naUdalost('lockPinInput', 'keydown', (e) => { if (e.key === 'Enter') potvrdPinZamku(); });
  naUdalost('lockSetupCancel', 'click', () => {
    rezimZamku = null;
    vykresliZamek();
  });
  naUdalost('lockBioToggle', 'click', prepniOtiskZamku);
  naUdalost('lockAfter', 'change', (e) => zamek.nastavDobu(Number(e.target.value)));
  vykresliZamek();

  // Účet PerpyX
  naUdalost('accountSendBtn', 'click', posliKodUctu);
  naUdalost('accountEmail', 'keydown', (e) => { if (e.key === 'Enter') posliKodUctu(); });
  naUdalost('accountVerifyBtn', 'click', overKodUctu);
  naUdalost('accountCode', 'input', (e) => {
    // Šest číslic = rovnou přihlásit, ať se nemusí hledat tlačítko.
    if (/^\d{6}$/.test(e.target.value.trim())) overKodUctu();
  });
  naUdalost('accountBackBtn', 'click', () => ukazKrokUctu('email'));
  naUdalost('accountBackupBtn', 'click', zalohujUcetTed);
  naUdalost('accountRestoreBtn', 'click', otevriObnovuUctu);
  naUdalost('accountRestoreGo', 'click', obnovZUctu);
  naUdalost('accountLogoutBtn', 'click', odhlasUcet);
  naUdalost('accountDeleteBtn', 'click', smazUcet);
  ucet.naZmenu(vykresliUcet);

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
        ui.renderChartInfo(chartPosition, hideAmounts, popisBurzy(), chartObrat);
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
  vykresliBurzy();
  const prah = el('liqThreshold');
  if (prah) prah.value = String(prahLikvidace);
  vykresliPrepinacSltp();
  // Dostupnost otisku se zjišťuje asynchronně — při otevření nastavení
  // znovu, ať řádek s otiskem odpovídá tomu, co telefon umí teď.
  rezimZamku = null;
  vykresliZamek();
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
    result.ok ? t(result.overeno ? 'settings.ok' : 'settings.okUnverified') : result.message,
    result.ok,
  );
}

/**
 * Klíč uložený z dřívějška (před kontrolou oprávnění) může umět obchodovat
 * nebo vybírat. Aplikace kvůli tomu nepřestane fungovat — uživatel by se
 * ke svým datům nedostal — ale jednou za spuštění důrazně upozorní.
 */
let varovaniKlice = null;

async function zkontrolujUlozenyKlic() {
  if (!client.hasCredentials()) return;
  const o = await client.opravneniKlice();
  if (o?.vyber) varovaniKlice = `⚠ ${t('settings.storedKeyWithdraw')}`;
  else if (o && !o.jenCteni) varovaniKlice = `⚠ ${t('settings.storedKeyNotReadOnly')}`;
  else varovaniKlice = null;
  if (varovaniKlice) ui.showError(varovaniKlice);
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
  // Jiný účet = jiná historie: mezipaměť se při jiném klíči sama vymaže.
  zapomenHistorii();
  mezipamet.nastavVlastnika(apiKey);
  varovaniKlice = null;
  el('apiKey').value = '';
  el('apiSecret').value = '';
  ui.clearSettingsMessage();
  skryjUvod();
  vykresliBurzy();
  client.stop();
  client.setCredentials(apiKey, apiSecret);
  ui.clearError();
  ui.showLoading();
  zacatekNacitani = Date.now();
  ui.showView('positions');
  dokresliSeznamJeLiZastaraly();
  await client.start();
}

/** Data předchozího účtu z paměti pryč (odpojení / výměna klíče). */
function zapomenHistorii() {
  obchody = [];
  skupinyObchodu = [];
  historieOd = 0;
  historieAktualizovano = 0;
  historieZTelefonu = false;
  plneniPary.clear();
  fundingyUlozene = {};
  client.ulozeneOtevreni.clear();
  client.ulozeneSoucty.clear();
}

function clearCredentials() {
  if (!confirm(t('settings.confirmClear'))) return;
  client.stop();
  store.clearCredentials();
  zapomenHistorii();
  varovaniKlice = null;
  lastPositions = [];
  vykresliBurzy();
  ui.showPlaceholder(t('positions.keysCleared'), t('exchanges.connect'));
}

/* ---------- graf ---------- */

/** Z karty pozice. */
const openChart = (position) => {
  prohlizenyObchod = null;
  chartInterval = intervalUzivatele; // ne ten, který si půjčila Historie
  return otevriGraf(position.symbol, position, null);
};

/** Ze seznamu trhů — pár, na kterém pozici mít nemusím. */
const openChartSymbol = (trh) => {
  prohlizenyObchod = null;
  chartInterval = intervalUzivatele;
  return otevriGraf(trh.symbol, null, trh);
};

/**
 * Dopočte čas otevření pozice z plnění a překreslí čáru vstupu, aby
 * začínala u první nákupní svíčky. Běží na pozadí — graf se kvůli tomu
 * nezdrží, čára jen chvíli vede od levého okraje.
 */
function nactiOtevreni(position) {
  if (!position || !client.hasCredentials()) return;
  client.otevreniPozice(position)
    .then((kdy) => {
      if (chartPosition?.symbol !== position.symbol || !kdy) return;
      chartOtevreno = kdy;
      applyChartLines();
    })
    .catch(() => { /* čára zůstane od levého okraje, nic se nerozbije */ });
}

async function otevriGraf(symbol, position, trh) {
  /*
   * Jeden vzhled grafu, ať se otevře odkudkoli (v0.41.0, přání uživatele):
   * z Watchlists, ze seznamu příkazů nebo z notifikace se dřív otevřel bez
   * pozice, i když na páru běžela — pozice se dokreslila až s další dávkou
   * dat a do té doby vypadal graf jinak (limitky bez množství a barvy).
   * Prohlídka obchodu z Historie pozici záměrně nemá.
   */
  if (!position && !prohlizenyObchod) {
    position = lastPositions.find((p) => p.symbol === symbol) || null;
  }
  chartSymbol = symbol;
  chartPosition = position;
  chartOtevreno = null;
  chartTrh = trh;
  chartObrat = trh?.turnover ?? null;
  chartOrders = [];
  chartLineKey = '';
  // Graf otevřený z Pozic nebo z notifikace objem nemá — stáhne se zvlášť,
  // mimo hlavní cestu (graf na něj nečeká).
  if (!chartObrat) {
    client.getTicker(symbol).then((tk) => {
      if (chartSymbol !== symbol || !tk?.turnover) return;
      chartObrat = tk.turnover;
      ui.renderChartInfo(chartPosition, hideAmounts, popisBurzy(), chartObrat);
    }).catch(() => { /* bez objemu se graf obejde */ });
  }

  ui.renderChartHeader(symbol, position, hideAmounts, trh);
  ui.renderChartInfo(position, hideAmounts, popisBurzy(), chartObrat);
  ui.setActiveInterval(chartInterval);
  ui.showChartError('');
  ui.showChart(true);
  ui.vycentrujInterval();
  oznacJednotku();

  // Aby hardwarové tlačítko zpět zavřelo graf, a ne celou aplikaci.
  // (Graf nahrazující jiný otevřený graf záznam už má.)
  if (otevriGraf.bezHistorie) otevriGraf.bezHistorie = false;
  else history.pushState({ chart: true }, '');

  // Plátno se musí vytvářet až po zobrazení, jinak má nulové rozměry.
  if (!chart) {
    chart = createPriceChart(el('chartBox'), el('drawLayer'), {
      onDrawingsChanged: ulozKresby,
      onDrawEnd: () => vyberNastroj(''), // po dokreslení zpět na kurzor
      onIndicatorsChanged: ulozIndikatory,
      onSelectionChanged: zobrazPaletu,
      onAlarmTapped: (id) => otevriAlarm(alarmy.najdi(id)),
      onStyleChanged: (styl) => store.saveDrawStyle(styl),
    });
    chart.setLastStyle(store.loadDrawStyle());
    chart.onLongPress(ukazRychlyAlarm);
    chart.setLoader(nactiSvice);
    chart.setMagnet(magnetZapnut);
    // Vrstvy před indikátory — skryté indikátory se do grafu vůbec nevloží.
    chart.setLayers(store.loadLayers());
    oznacVrstvy();
    chart.restoreIndicators(store.loadIndicators(), maVlastniPanel);
    oznacAktivniIndikatory();
    postavNabidky();
    postavPaletu();
  }

  // Přesnost cen na ose: z pozice, z trhu, u prohlídky obchodu z jeho vstupu
  // (bez toho psala osa jen dvě desetinná místa — 0.30, 0.29, 0.29).
  chart.setSymbol(symbol, priceDecimals(position?.entry ?? trh?.last ?? prohlizenyObchod?.entry ?? 0));
  if (prohlizenyObchod?.okno) chart.showTradeWindow(prohlizenyObchod.okno.od, prohlizenyObchod.okno.do);
  chart.setInterval(chartInterval); // knihovna si data vyžádá sama
  odebiratZiveSvice(symbol, chartInterval);
  chart.restoreDrawings(store.loadDrawings(symbol));
  vykresliAlarmy();
  nastavLinkuPnl();
  if (!prohlizenyObchod) {
    chart.clearTradeMarks();
    // Trojúhelníky v místech, kde se nakupovalo a prodávalo.
    znackyPlneni(position);
  }
  nactiOtevreni(position);
  chart.setTicking(true);

  await refreshChartOrders();

  clearInterval(ordersTimer);
  // Příkazy nechodí po WebSocketu, takže se dotahují opakovaně.
  ordersTimer = setInterval(refreshChartOrders, 20000);
}

function closeChart() {
  skryjRychlyAlarm();
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
  // Pod grafem se seznam nepřekresloval — teď má zase ukázat čerstvá čísla.
  dokresliSeznamJeLiZastaraly();
}

/*
 * Živá svíčka jen tam, kde graf končí dneškem. U prohlídky starého obchodu
 * by se dnešní svíčka přilepila za svíčky z jeho doby.
 */
function odebiratZiveSvice(symbol, interval) {
  const konec = konecSvicProhlidky(interval);
  if (konec !== null && konec < Date.now()) client.setKlineSubscription(null, null);
  else client.setKlineSubscription(symbol, interval);
}

async function nactiSviceProInterval(interval) {
  // ⚠ Prohlídka starého obchodu potřebuje svíčky **z jeho doby** (`end`).
  // Bez něj přišlo nejnovějších 500 — na 1m pár hodin — a obchod ze
  // včerejška v datech vůbec nebyl: graf ukázal dnešek bez značek (v0.45.0).
  const bars = await client.getKlines(chartSymbol, interval, 500, konecSvicProhlidky(interval));
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
  let bars;
  if (pripraveneSvice && pripraveneSvice.interval === chartInterval) {
    bars = pripraveneSvice.bars;
    pripraveneSvice = null;
  } else {
    bars = await nactiSviceProInterval(chartInterval);
  }
  // Značky plnění až k začátku načtených svíček (celá historie na páru).
  if (!prohlizenyObchod && bars.length) {
    setTimeout(() => znackyPlneni(chartPosition, bars[0].timestamp), 0);
  }
  return bars;
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
  skryjRychlyAlarm();
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
  // Volba timeframu při prohlídce obchodu z Historie je jen pro tu prohlídku.
  if (!prohlizenyObchod) intervalUzivatele = interval;
  chart.setInterval(interval);
  odebiratZiveSvice(chartSymbol, interval);
}

async function refreshChartOrders() {
  const symbol = chartSymbol;
  // Bez klíčů příkazy nenačteme; graf samotný je veřejný a běží dál.
  if (!symbol || !client.hasCredentials()) return;
  // Prohlídka uzavřeného obchodu: dnešní příkazy s ním nesouvisí.
  if (prohlizenyObchod) {
    chartOrders = [];
    applyChartLines(true);
    return;
  }
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
  // Kreslit naslepo nejde — se zvoleným nástrojem se kresby zase ukážou.
  if (nastroj && nastroj !== 'mereni') ukazVrstvu('kresby');

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === nastroj);
  });
  // Tlačítko nabídky nástrojů nese ikonu zvoleného nástroje.
  const ikona = el('toolsBtnIcon');
  if (ikona) {
    if (!ikona.dataset.vychozi) ikona.dataset.vychozi = ikona.innerHTML;
    const zvoleny = nastroj && document.querySelector(`.tool-item[data-tool="${nastroj}"] svg`);
    ikona.innerHTML = zvoleny ? zvoleny.outerHTML : ikona.dataset.vychozi;
    el('toolsBtn').classList.toggle('active', Boolean(zvoleny));
  }

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
        ukazVrstvu('indikatory'); // zapnutý indikátor má být vidět
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

/* ---------- vrstvy grafu ---------- */

/** Čtyři vrstvy, rozhodnutí uživatele 2026-10-01 (osa, legenda, mřížka ne). */
const VRSTVY = [
  { klic: 'kresby', popisek: 'layers.drawings' },
  { klic: 'alarmy', popisek: 'layers.alarms', poznamka: 'layers.alarmsNote' },
  { klic: 'indikatory', popisek: 'layers.indicators' },
  { klic: 'obchod', popisek: 'layers.trade', poznamka: 'layers.tradeNote' },
];

function nastavVrstvy(zmena) {
  if (!chart) return;
  chart.setLayers(zmena);
  const vrstvy = chart.getLayers();
  store.saveLayers(vrstvy);
  // Skryté kresby nejde upravovat — rozdělaná úprava a paleta zmizí.
  if (!vrstvy.kresby) {
    vyberNastroj('');
    zobrazPaletu(null);
  }
  oznacVrstvy();
}

function ukazVrstvu(klic) {
  if (chart && !chart.getLayers()[klic]) nastavVrstvy({ [klic]: true });
}

/** Ikona vrstev svítí, když je něco skryté. */
function oznacVrstvy() {
  const skryto = chart && Object.values(chart.getLayers()).some((v) => !v);
  prepniTridu('layersBtn', 'active', Boolean(skryto));
}

function otevriVrstvy() {
  if (!chart) return;
  const vrstvy = chart.getLayers();
  el('layersBody').replaceChildren(...VRSTVY.map(({ klic, popisek, poznamka }) => {
    const radek = document.createElement('div');
    radek.className = 'nastaveni-radek';
    const text = document.createElement('span');
    text.className = 'nastaveni-popisek';
    text.textContent = t(popisek);
    if (poznamka) {
      const maly = document.createElement('small');
      maly.className = 'vrstva-poznamka';
      maly.textContent = t(poznamka);
      text.append(maly);
    }
    radek.dataset.vrstva = klic;
    radek.append(text, ovladacPole({ typ: 'prepinac' }, vrstvy[klic],
      (v) => { nastavVrstvy({ [klic]: v }); popisVsechVrstev(); }));
    return radek;
  }));
  popisVsechVrstev();
  otevriNabidku('sheetLayers');
}

function popisVsechVrstev() {
  const vse = Object.values(chart?.getLayers() || {}).every(Boolean);
  const btn = el('layersAllBtn');
  if (btn) btn.textContent = t(vse ? 'layers.hideAll' : 'layers.showAll');
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
/** Kdy se otevřela pozice v grafu — odsud začíná čára vstupu. */
let chartOtevreno = null;

let trhy = [];
let hledani = '';
let filtrKategorie = null;      // id kategorie, nebo null = všechny
// Čip pro páry, které CoinGecko nezná — hlavně akcie, komodity a indexy,
// které Bybit nabízí jako perpetuály (XAU, CL, SAMSUNG…).
const BEZ_KATEGORIE = '__none';
const maKategorii = (symbol, id) => (id === BEZ_KATEGORIE
  ? !sestavy.kategorieCoinu(symbol).length
  : sestavy.kategorieCoinu(symbol).includes(id));
let identifikuji = false;
let chybaIdentifikace = false;
let otevrenyPar = null;         // pár v nabídce u hvězdičky
let rezimSestavy = null;        // { id } při úpravě, { novy, pridat } při zakládání

/** ⟳ ve Watchlists: znovu ceny, objemy a změny všech párů. */
async function obnovTrhy() {
  try {
    trhy = await client.getTickers();
    vykresliTrhy();
  } catch {
    ui.showWatchNote(t('watchlist.failed'));
  }
}

async function nactiTrhy() {
  vykresliListu();
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

function vykresliListu() {
  ui.renderListBar({
    polozky: [
      ...sestavy.seznamy().map((x) => ({ id: x.id, nazev: x.nazev, pocet: x.polozky.length })),
      { id: sestavy.VSE, nazev: t('lists.all') },
    ],
    aktivni: sestavy.aktivni(),
    onSelect: vyberSestavu,
    onManage: spravujSestavu,
    onNew: () => novaSestava(null),
  });
}

/** Krátký popisek kategorií za obratem v řádku (nejvýš dvě). */
function popisekKategorie(symbol) {
  if (!sestavy.maKategorie()) return '';
  return sestavy.kategorieCoinu(symbol).slice(0, 2).map(sestavy.nazevKategorie).join(', ');
}

/* Ikony přepínače rozložení: dvě dlaždice vedle sebe / široké pruhy. */
const IKONA_MRIZKA = '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>';
const IKONA_SIROKE = '<rect x="4" y="5" width="16" height="5" rx="1.5"/><rect x="4" y="14" width="16" height="5" rx="1.5"/>';

function vykresliTrhy() {
  vykresliListu();
  const aktivni = sestavy.aktivni();
  const proVse = aktivni === sestavy.VSE;
  /*
   * Vlastní seznam (v0.36.0, podle TabTraderu): dlaždice v pořadí, které si
   * uživatel nastaví tažením; bez hledání, řazení a kategorií — páry se
   * přidávají tlačítkem + a odebírají podržením dlaždice. „All" má hledání,
   * kategorie i řazení jako dřív, jen jako dlaždice.
   */
  ukazPrvek('watchTools', proVse);
  ukazPrvek('watchCats', proVse);
  ukazPrvek('addPairBtn', !proVse);
  el('watchList')?.classList.toggle('lze-presouvat', !proVse);
  const siroke = sestavy.rozlozeni(proVse) === 'siroke';
  const ikona = el('layoutIcon');
  // Ikona ukazuje, na co se klepnutím přepne.
  if (ikona) ikona.innerHTML = siroke ? IKONA_MRIZKA : IKONA_SIROKE;
  if (!proVse) {
    const podleSymbolu = new Map(trhy.map((r) => [r.symbol, r]));
    const seznam = sestavy.paryVPoradi(aktivni).map((s) => podleSymbolu.get(s)).filter(Boolean);
    const dlazdice = ui.renderTiles(seznam, {
      siroke,
      onSelect: openChartSymbol,
      metrika: 'volume',
      popisek: popisekKategorie,
      pozice: new Map(lastPositions.map((p) => [p.symbol, p])),
      hide: hideAmounts,
    });
    sledujGrafy(dlazdice);
    el('watchHint').textContent = seznam.length ? t('lists.tilesHint', { n: seznam.length }) : '';
    ui.showWatchNote(trhy.length && !seznam.length ? t('lists.emptyTiles') : '');
    return;
  }
  el('watchHint').textContent = '';
  const vSestave = null;
  const razeni = sestavy.razeni();
  ui.renderSort({
    ...razeni,
    volby: Object.keys(sestavy.RAZENI),
    onSelect: (klic) => {
      sestavy.nastavRazeni(klic);
      zavriNabidkyTrhu();
      vykresliTrhy();
    },
  });
  let seznam = sestavy.serad(vSestave ? trhy.filter((r) => vSestave.has(r.symbol)) : trhy, razeni);

  // Čipy kategorií ukazují jen kategorie zastoupené v aktuální sestavě,
  // s počtem párů — prázdné čipy by jen zabíraly místo.
  let kategorie = [];
  if (sestavy.maKategorie()) {
    const pocty = new Map();
    for (const r of seznam) {
      const k = sestavy.kategorieCoinu(r.symbol);
      if (!k.length) pocty.set(BEZ_KATEGORIE, (pocty.get(BEZ_KATEGORIE) || 0) + 1);
      for (const id of k) pocty.set(id, (pocty.get(id) || 0) + 1);
    }
    kategorie = [...sestavy.vsechnyKategorie(), { id: BEZ_KATEGORIE, nazev: t('lists.noCategory') }]
      .filter((k) => pocty.has(k.id) || k.id === filtrKategorie)
      .map((k) => ({ id: k.id, nazev: k.nazev, pocet: pocty.get(k.id) || 0 }));
  }
  ui.renderCategoryRow({
    maData: sestavy.maKategorie(),
    kategorie,
    aktivni: filtrKategorie,
    zaneprazdneno: identifikuji,
    chyba: chybaIdentifikace,
    onSelect: (id) => {
      filtrKategorie = id;
      vykresliTrhy();
    },
    onIdentify: identifikujCoiny,
  });

  const dotaz = hledani.trim().toUpperCase();
  if (filtrKategorie) seznam = seznam.filter((r) => maKategorii(r.symbol, filtrKategorie));
  if (dotaz) seznam = seznam.filter((r) => r.symbol.includes(dotaz));
  // Ořezává se jen celý seznam všech párů. Sestava, kategorie i hledání
  // ukazují všechno, jinak by se hledaný pár nemusel objevit.
  const orez = !vSestave && !filtrKategorie && !dotaz;
  const vysledek = orez ? seznam.slice(0, LIMIT_SEZNAMU) : seznam;

  const radky = ui.renderTiles(vysledek, {
    siroke,
    veSestave: sestavy.jeVNejake,
    onSelect: openChartSymbol,
    onToggleFav: otevriPar,
    popisek: popisekKategorie,
    metrika: razeni.klic,
    pozice: new Map(lastPositions.map((p) => [p.symbol, p])),
    hide: hideAmounts,
  });
  sledujGrafy(radky);

  if (!trhy.length) return;
  if (!vysledek.length) {
    if (vSestave && !vSestave.size) ui.showWatchNote(t('lists.empty'));
    else if (filtrKategorie && !dotaz) {
      const nazev = filtrKategorie === BEZ_KATEGORIE ? t('lists.noCategory') : sestavy.nazevKategorie(filtrKategorie);
      ui.showWatchNote(t('lists.catEmpty', { cat: nazev }));
    } else ui.showWatchNote(t('watchlist.empty'));
  } else {
    ui.showWatchNote(t('watchlist.shown', { shown: vysledek.length, total: trhy.length }));
  }
}

/* ---------- přidání páru (+) a nabídka dlaždice ---------- */

let pridavaniDo = null;   // id seznamu, do kterého se přidává
let toastCasovac = null;

function otevriPridani() {
  const id = sestavy.aktivni();
  if (id === sestavy.VSE) return;
  pridavaniDo = id;
  el('addPairTitle').textContent = t('lists.addTitle', { list: sestavy.najdi(id)?.nazev || '' });
  el('addPairSearch').value = '';
  ukazPrvek('addPairToast', false);
  vykresliPridani();
  ukazPrvek('watchBackdrop', true);
  ukazPrvek('sheetAddPair', true);
  el('addPairSearch').focus();
}

function vykresliPridani() {
  if (!pridavaniDo) return;
  const dotaz = el('addPairSearch').value.trim().toUpperCase();
  // Bez dotazu nejobchodovanější páry, s dotazem shody (nejvýš 50).
  const shody = (dotaz ? trhy.filter((r) => r.symbol.includes(dotaz)) : trhy)
    .slice().sort((a, b) => b.turnover - a.turnover).slice(0, dotaz ? 50 : 30);
  ui.renderPairSearch(el('addPairResults'), shody, {
    jeVSeznamu: (s) => sestavy.obsahuje(pridavaniDo, s),
    onPick: vyberPridani,
  });
}

function ukazToast(text, neutralni = false) {
  const toast = el('addPairToast');
  if (!toast) return;
  toast.textContent = text;
  toast.classList.toggle('neutralni', neutralni);
  toast.hidden = false;
  clearTimeout(toastCasovac);
  toastCasovac = setTimeout(() => { toast.hidden = true; }, 1800);
}

function vyberPridani(trh) {
  if (!pridavaniDo) return;
  const nazev = sestavy.najdi(pridavaniDo)?.nazev || '';
  if (sestavy.obsahuje(pridavaniDo, trh.symbol)) {
    ukazToast(t('lists.already', { pair: trh.symbol, list: nazev }), true);
  } else if (!sestavy.pridej(pridavaniDo, trh.symbol)) {
    ukazToast(t('lists.full', { n: sestavy.LIMITY.paru }), true);
  } else {
    ukazToast(t('lists.added', { pair: trh.symbol, list: nazev }));
    navigator.vibrate?.(12);
    vykresliTrhy();
  }
  // Vyhledávání se vyprázdní, ať jde rovnou hledat další pár.
  el('addPairSearch').value = '';
  vykresliPridani();
  el('addPairSearch').focus();
}

let menuPar = null;
let menuOtevrenoV = 0;

function otevriMenuDlazdice(symbol, dlazdice) {
  const id = sestavy.aktivni();
  if (id === sestavy.VSE) return;
  menuPar = symbol;
  el('tileMenuTitle').textContent = symbol;
  el('tileMenuRemove').textContent = t('lists.removeFrom', { list: sestavy.najdi(id)?.nazev || '' });
  const menu = el('tileMenu');
  menu.hidden = false;
  const r = dlazdice.getBoundingClientRect();
  const sirka = menu.offsetWidth;
  const vyska = menu.offsetHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - sirka / 2), window.innerWidth - sirka - 8);
  const top = r.bottom + 8 + vyska < window.innerHeight ? r.bottom + 8 : Math.max(8, r.top - vyska - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menuOtevrenoV = Date.now();
  ukazPrvek('watchBackdrop', true);
}

function vyberSestavu(id) {
  if (id !== sestavy.aktivni()) {
    filtrKategorie = null;
    hledani = '';
    const pole = el('watchSearch');
    if (pole) pole.value = '';
    ukazPrvek('watchClearBtn', false);
  }
  sestavy.nastavAktivni(id);
  vykresliTrhy();
}

/** Stáhne kategorie coinů (poprvé povinné, pak jen tlačítkem obnovit). */
async function identifikujCoiny() {
  if (identifikuji) return;
  identifikuji = true;
  chybaIdentifikace = false;
  vykresliTrhy();
  try {
    await sestavy.stahniKategorie();
  } catch (e) {
    chybaIdentifikace = true;
    console.warn('kategorie', e);
  }
  identifikuji = false;
  vykresliTrhy();
}

/* ---- nabídka u hvězdičky ---- */

function otevriPar(symbol) {
  otevrenyPar = symbol;
  vykresliPar();
  ukazPrvek('sheetList', false);
  ukazPrvek('watchBackdrop', true);
  ukazPrvek('sheetPair', true);
}

function vykresliPar() {
  const s = otevrenyPar;
  if (!s) return;
  const moje = new Set(sestavy.kategorieCoinu(s));
  const sKategoriemi = sestavy.maKategorie();
  ukazPrvek('sheetPairCatsLabel', sKategoriemi);
  ukazPrvek('sheetPairCats', sKategoriemi);
  ui.renderPairSheet({
    symbol: s,
    sestavy: sestavy.seznamy().map((x) => ({ id: x.id, nazev: x.nazev, zapnuto: sestavy.obsahuje(x.id, s) })),
    onToggleList: (id) => {
      sestavy.prepni(id, s);
      vykresliPar();
      vykresliTrhy();
    },
    onNewList: () => novaSestava(s),
    kategorie: sKategoriemi
      ? sestavy.vsechnyKategorie().map((k) => ({ id: k.id, nazev: k.nazev, zapnuto: moje.has(k.id) }))
      : [],
    onToggleCat: (id) => {
      sestavy.prepniKategorii(s, id);
      vykresliPar();
      vykresliTrhy();
    },
    opraveno: sestavy.jeOpraveno(s),
    onReset: () => {
      sestavy.zrusOpravu(s);
      vykresliPar();
      vykresliTrhy();
    },
  });
}

/* ---- správa sestavy ---- */

function spravujSestavu(id) {
  const x = sestavy.najdi(id);
  if (!x) return;  // „Vše" správu nemá
  rezimSestavy = { id };
  el('listName').value = x.nazev;
  ukazPrvek('listDeleteBtn', true);
  ukazPrvek('sheetPair', false);
  ukazPrvek('watchBackdrop', true);
  ukazPrvek('sheetList', true);
}

/** Nová sestava; `pridat` = pár, který se do ní rovnou vloží (z nabídky u hvězdičky). */
function novaSestava(pridat) {
  rezimSestavy = { novy: true, pridat };
  el('listName').value = '';
  ukazPrvek('listDeleteBtn', false);
  ukazPrvek('sheetPair', false);
  ukazPrvek('watchBackdrop', true);
  ukazPrvek('sheetList', true);
  el('listName').focus();
}

function ulozSestavu() {
  if (!rezimSestavy) return;
  const nazev = el('listName').value.trim();
  if (rezimSestavy.novy) {
    const id = sestavy.vytvor(nazev);
    const par = rezimSestavy.pridat;
    if (par) {
      sestavy.prepni(id, par);
      rezimSestavy = null;
      vykresliTrhy();
      otevriPar(par);   // zpátky do nabídky páru, ať je vidět, kam se přidal
      return;
    }
    sestavy.nastavAktivni(id);
  } else if (nazev) {
    sestavy.prejmenuj(rezimSestavy.id, nazev);
  }
  zavriNabidkyTrhu();
  vykresliTrhy();
}

function smazSestavu() {
  const x = rezimSestavy?.id && sestavy.najdi(rezimSestavy.id);
  if (!x) return;
  if (!confirm(t('lists.confirmDelete', { name: x.nazev }))) return;
  sestavy.smaz(x.id);
  zavriNabidkyTrhu();
  vykresliTrhy();
}

function zavriNabidkyTrhu() {
  rezimSestavy = null;
  otevrenyPar = null;
  pridavaniDo = null;
  menuPar = null;
  ['sheetPair', 'sheetList', 'sheetSort', 'sheetAddPair', 'tileMenu', 'watchBackdrop'].forEach((id) => ukazPrvek(id, false));
}

const ZALOZKY = ['positions', 'watchlist', 'history'];
let aktivniZalozka = 'positions';

function prepniZalozku(nazev) {
  aktivniZalozka = nazev;
  document.querySelector('.tabs')?.classList.toggle('s-podzalozkami', nazev === 'watchlist');
  document.body.classList.toggle('na-trzich', nazev === 'watchlist');
  ui.showView(nazev);
  dokresliSeznamJeLiZastaraly();
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
    /*
     * ⚠ Nový dotyk = nové gesto. Příznak `prejeto` má potlačit jen klepnutí
     * z **téhož** gesta, které přejelo záložku. Jenže Android po přejetí
     * žádné klepnutí většinou nepošle, a příznak pak zůstal viset a snědl
     * až **první skutečné klepnutí** — karta pozice problikla, ale graf se
     * neotevřel, a teprve druhé klepnutí prošlo. Uživatel to popisoval jako
     * „někdy to reaguje, někdy ne". Test: tools/test-klepnuti-na-kartu.py.
     */
    prejeto = false;
    // Vodorovně posuvné lišty (sestavy, kategorie) a otevřené nabídky
    // si tah nechávají pro sebe.
    if (chartSymbol || !el('viewSettings').hidden || e.touches.length !== 1
        || e.target.closest?.('.watch-lists, .watch-cats, .chip-row, .sheet')) {
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

    // V Trzích přejetí nejdřív přepíná sestavy; až za první / poslední
    // sestavou pokračuje na sousední záložku (jako vnořené stránky v Androidu).
    if (aktivniZalozka === 'watchlist') {
      const poradi = sestavy.poradi();
      const dalsi = poradi.indexOf(sestavy.aktivni()) + (dx < 0 ? 1 : -1);
      if (dalsi >= 0 && dalsi < poradi.length) {
        prejeto = true;
        vyberSestavu(poradi[dalsi]);
        return;
      }
    }

    const kam = ZALOZKY.indexOf(aktivniZalozka) + (dx < 0 ? 1 : -1);
    if (kam < 0 || kam >= ZALOZKY.length) return;

    prejeto = true;
    /*
     * Do Trhů přejetím zleva (z Pozic) → první vlastní seznam, zprava
     * (z Historie) → poslední, tedy „All". Jako vnořené stránky: přijde se
     * na tu, která na té straně sousedí (2026-10-04, přání uživatele).
     */
    if (ZALOZKY[kam] === 'watchlist') {
      const poradi = sestavy.poradi();
      sestavy.nastavAktivni(dx < 0 ? poradi[0] : poradi[poradi.length - 1]);
      filtrKategorie = null;
      hledani = '';
      const pole = el('watchSearch');
      if (pole) pole.value = '';
      ukazPrvek('watchClearBtn', false);
    }
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

/** Délka svíčky intervalu v ms. */
const DELKA_INTERVALU = {
  1: 60e3, 5: 300e3, 15: 900e3, 30: 1800e3, 60: 3600e3, 240: 14400e3, D: 86400e3, W: 604800e3,
};

/*
 * Interval prohlídky obchodu (v0.45.0, jedno pravidlo): **nejkratší, na
 * kterém má obchod nejvýš 24 svíček**. Graf pak obchod roztáhne zhruba na
 * polovinu šířky (`showTradeWindow`) a okolí ztlumí. Dřív tabulka podle
 * hodin, která skákala mezi 1m, 5m, 15m… a obchod zabíral jednou proužek,
 * jindy půl grafu.
 */
function intervalProObchod(trvaniMs) {
  for (const [interval, ms] of Object.entries(DELKA_INTERVALU)) {
    if (trvaniMs / ms <= 24) return interval;
  }
  return 'W';
}

/** Konec svíček pro prohlídku: kus po zavření obchodu (okolí), nejvýš teď. */
function konecSvicProhlidky(interval) {
  const okno = prohlizenyObchod?.okno;
  if (!okno) return null;
  return Math.min(Date.now(), okno.do + 150 * (DELKA_INTERVALU[interval] || 3600e3));
}

/*
 * Historie (v0.38.0, přání uživatele — dřív trvalo načtení několik vteřin):
 * napoprvé jen **posledních 7 dní** (jeden dotaz), starší po 30 dnech
 * tlačítkem pod seznamem. Bybit drží uzavřené obchody 2 roky.
 *
 * ⚠ Bybit dělá záznam za každý **zavírací příkaz**, takže pozice zavíraná
 * po částech dávala víc „obchodů". Záznamy se proto seskupují do obchodů
 * podle plnění (`seskupObchody`): od současné velikosti pozice se jde
 * dozadu a kde je pozice nulová, tam obchod začal (stejně jako
 * `otevreniPozice`). Obchod, jehož pozice dál běží, je „otevřený".
 */
const HISTORIE_START = 7 * 86400e3;
const HISTORIE_BLOK = 30 * 86400e3;
const HISTORIE_MAX = 730 * 86400e3;
let historieOd = 0;          // nejstarší načtený okamžik (0 = nic načteno)
let historieAktualizovano = 0;  // kdy se naposledy stahovalo až do „teď"
let historieNacita = false;
let historieZTelefonu = false;  // zkusilo se už načíst z mezipaměti?
let skupinyObchodu = [];

/*
 * Uzavřené obchody v telefonu (v0.39.0): co se jednou stáhlo, příště se
 * ukáže hned a z burzy se dotáhne jen to, co přibylo (`obnovHistorii`).
 * Načtené období se rozšiřuje jen tlačítkem — nic se nestahuje dopředu.
 */
function ulozHistorii() {
  mezipamet.uloz('historie', { od: historieOd, aktualizovano: historieAktualizovano, zaznamy: obchody });
}

async function nactiHistoriiZTelefonu() {
  historieZTelefonu = true;
  const h = await mezipamet.nacti('historie');
  if (!h?.od || !Array.isArray(h.zaznamy)) return;
  obchody = h.zaznamy;
  historieOd = h.od;
  historieAktualizovano = h.aktualizovano || h.od;
}

/**
 * Dotáhne uzavřené obchody od posledního stažení (s překryvem). `plna`
 * (tlačítko ⟳ v Historii) stáhne znovu celé načtené období i plnění —
 * pojistka pro vzácnou zpětnou opravu na straně burzy.
 */
async function obnovHistorii(plna = false) {
  if (!client.hasCredentials() || !historieOd || historieNacita) return;
  historieNacita = plna;
  if (plna) vykresliHistorii();
  const ted = Date.now();
  const od = plna ? historieOd : Math.max(historieOd, historieAktualizovano - PREKRYV);
  try {
    const nove = await client.getClosedTrades(od, ted);
    if (plna) {
      obchody = [];
      const pary = new Set(nove.map((o) => o.symbol));
      pary.forEach((s) => {
        plneniPary.delete(s);
        mezipamet.smaz(`plneni:${s}`);
      });
    }
    slucObchody(nove);
    historieAktualizovano = ted;
    ulozHistorii();
    await prepocitejSkupiny();
  } catch {
    /* uložený seznam zůstává, nová data přijdou příště */
  }
  historieNacita = false;
  if (aktivniZalozka === 'history') vykresliHistorii();
}

function klicObchodu(o) {
  return `${o.id}|${o.closedAt}`;
}

function slucObchody(nove) {
  const mapa = new Map(obchody.map((o) => [klicObchodu(o), o]));
  nove.forEach((o) => mapa.set(klicObchodu(o), o));
  obchody = [...mapa.values()].sort((a, b) => b.closedAt - a.closedAt);
}

function historieNaKonci() {
  return historieOd && Date.now() - historieOd >= HISTORIE_MAX;
}

/** Záznamy zavíracích příkazů → obchody (skupiny výstupů). */
function seskupObchody(zaznamy, plneniPodleParu, pozice) {
  const skupiny = new Map();
  const podleParu = new Map();
  zaznamy.forEach((z) => {
    if (!podleParu.has(z.symbol)) podleParu.set(z.symbol, []);
    podleParu.get(z.symbol).push(z);
  });
  podleParu.forEach((zaz, symbol) => {
    const plneni = plneniPodleParu.get(symbol);
    const poz = pozice.find((p) => p.symbol === symbol);
    const epizoda = new Map();    // orderId → číslo obchodu (0 = nejnovější)
    const otevreni = new Map();   // číslo obchodu → čas otevírajícího plnění
    if (plneni) {
      let velikost = poz ? (poz.side === 'Sell' ? -poz.size : poz.size) : 0;
      let k = 0;
      [...plneni].sort((a, b) => b.time - a.time).forEach((f) => {
        if (!epizoda.has(f.orderId)) epizoda.set(f.orderId, k);
        velikost -= f.buy ? f.qty : -f.qty;
        if (Math.abs(velikost) < 1e-9 || Math.abs(Number(velikost.toFixed(8))) === 0) {
          otevreni.set(k, f.time);
          k += 1;
          velikost = 0;
        }
      });
    }
    zaz.forEach((z) => {
      const k = epizoda.get(z.id);
      const klic = k === undefined ? `${symbol}|r|${z.id}|${z.closedAt}` : `${symbol}|e|${k}`;
      if (!skupiny.has(klic)) {
        skupiny.set(klic, {
          symbol,
          long: z.long,
          leverage: z.leverage,
          otevrena: k === 0 && Boolean(poz),
          otevreno: k === undefined ? null : (otevreni.get(k) ?? null),
          vystupy: [],
        });
      }
      skupiny.get(klic).vystupy.push(z);
    });
  });
  return [...skupiny.values()].map((g) => {
    g.vystupy.sort((a, b) => a.closedAt - b.closedAt);
    g.pnl = g.vystupy.reduce((s, z) => s + z.pnl, 0);
    g.zavreno = g.otevrena ? null : g.vystupy[g.vystupy.length - 1].closedAt;
    g.posledni = g.vystupy[g.vystupy.length - 1].closedAt;
    return g;
  // Otevřené obchody vždy nahoře (v0.38.2), pak od nejnovějšího výstupu.
  }).sort((a, b) => (b.otevrena - a.otevrena) || (b.posledni - a.posledni));
}

async function prepocitejSkupiny(jenUlozene = false) {
  const pary = [...new Set(obchody.map((o) => o.symbol))];
  const od = historieOd || Date.now() - HISTORIE_START;
  // Plnění pro všechny páry souběžně; bez práva na plnění zůstane každý
  // záznam samostatně (jako dřív).
  const plneni = new Map();
  await Promise.all(pary.map(async (s) => {
    try {
      plneni.set(s, await dotahniPlneni(s, od, jenUlozene));
    } catch { /* bez plnění se nesekupuje */ }
  }));
  skupinyObchodu = seskupObchody(obchody, plneni, lastPositions);
}

function otevriSkupinu(skupina) {
  // Otevřený obchod → graf živé pozice; uzavřený → prohlídka od otevření
  // po poslední zavírací příkaz (zahrne i všechny částečné výstupy).
  if (skupina.otevrena) {
    const poz = lastPositions.find((p) => p.symbol === skupina.symbol);
    if (poz) openChart(poz);
    else openChartSymbol({ symbol: skupina.symbol });
  }
  else otevriProhlidku(skupina.vystupy[skupina.vystupy.length - 1]);
}

function vykresliHistorii() {
  ui.renderHistory(skupinyObchodu, hideAmounts, otevriSkupinu);
  const od = historieOd ? new Date(historieOd) : null;
  let text = '';
  if (historieNacita) text = t(obchody.length ? 'history.loadingMore' : 'history.loading');
  else if (od) text = t(skupinyObchodu.length ? 'history.since' : 'history.noneSince', {
    // Stejný formát jako na kartách obchodů: den.měsíc.rok.
    date: `${od.getDate()}.${od.getMonth() + 1}.${od.getFullYear()}`,
  });
  ui.showHistoryNote(text);
  ukazPrvek('historyMore', Boolean(historieOd) && !historieNacita && !historieNaKonci());
}

/** Načte další blok do minulosti (napoprvé 7 dní, pak po 30 dnech). */
async function nactiStarsiHistorii() {
  if (historieNacita || historieNaKonci() || !client.hasCredentials()) return;
  historieNacita = true;
  vykresliHistorii();
  const doKdy = historieOd || Date.now();
  const od = Math.max(doKdy - (historieOd ? HISTORIE_BLOK : HISTORIE_START), Date.now() - HISTORIE_MAX);
  try {
    const ted = Date.now();
    slucObchody(await client.getClosedTrades(od, doKdy));
    if (!historieOd) historieAktualizovano = ted;
    historieOd = od;
    ulozHistorii();
    await prepocitejSkupiny();
  } catch (err) {
    historieNacita = false;
    vykresliHistorii();
    ui.showHistoryNote(err.message || t('history.failed'));
    return;
  }
  historieNacita = false;
  vykresliHistorii();
}

async function nactiHistorii() {
  if (!client.hasCredentials()) {
    ui.renderHistory([], hideAmounts, () => {});
    ui.showHistoryNote(t('history.needKeys'));
    ukazPrvek('historyMore', false);
    return;
  }
  if (!historieOd && !historieZTelefonu) {
    // Uložené obchody hned, bez čekání na burzu.
    await nactiHistoriiZTelefonu();
    if (historieOd) {
      await prepocitejSkupiny(true);
      vykresliHistorii();
    }
  }
  if (!historieOd) {
    await nactiStarsiHistorii();
    return;
  }
  vykresliHistorii();
  // Na pozadí jen to, co přibylo od posledního stažení.
  obnovHistorii(false);
}

/**
 * Otevře graf z doby obchodu a vyznačí do něj jednotlivá plnění.
 * Značky staví na `execution/list`, ne na průměrech z uzavřeného obchodu —
 * průměr by dal jednu značku uprostřed ničeho, kdežto plnění mají přesné
 * časy, takže sednou na správné svíčky.
 */
/**
 * Plnění jednoho uzavřeného obchodu z plnění uložených v telefonu — stejný
 * postup jako `client.plneniObchodu` (od zavíracího příkazu dozadu, dokud
 * pozice není nulová). `null`, když uložená plnění na celý obchod nestačí.
 */
async function plneniObchoduZTelefonu(obchod) {
  const vse = await dotahniPlneni(obchod.symbol, 0, true);
  if (!vse.length) return null;
  const konec = obchod.closedAt + 60000;
  const podleId = Boolean(obchod.id) && vse.some((f) => f.orderId === obchod.id);
  const epsilon = Math.max(1e-9, Math.abs(obchod.qty || 0) * 1e-6);
  const obchodu = [];
  let zbyva = 0;
  let naselKonec = false;
  for (let i = vse.length - 1; i >= 0; i -= 1) {
    const f = vse[i];
    if (f.time > konec) continue;
    if (!naselKonec) {
      const jeZaviraci = podleId ? f.orderId === obchod.id : f.time <= obchod.closedAt;
      if (!jeZaviraci) continue;
      naselKonec = true;
    }
    obchodu.push(f);
    zbyva -= (f.buy ? 1 : -1) * f.qty;
    if (Math.abs(zbyva) <= epsilon) return { plneni: obchodu.reverse(), otevreno: f.time };
  }
  return null;
}

async function otevriProhlidku(obchod) {
  prohlizenyObchod = obchod;

  /*
   * Nejdřív plnění **jen tohoto obchodu** — od otevření pozice po zavírací
   * příkaz (`plneniObchodu`). Dřív se braly všechny plnění v okně kolem
   * obchodu, takže se do grafu připletly nákupy a prodeje sousedních
   * obchodů na stejném páru. A až z plnění je poznat, jak dlouho obchod
   * trval — `closed-pnl` čas otevření nedává — a podle toho se volí interval.
   */
  let plneni = [];
  let otevreno = null;
  let chyba = null;
  ui.showHistoryNote(t('history.loadingTrade'));
  try {
    // Nejdřív z plnění v telefonu (v0.43.0) — dřív se vždy stahovalo po
    // týdnech z burzy („Loading the trade…" i dvě vteřiny).
    const mistni = await plneniObchoduZTelefonu(obchod);
    ({ plneni, otevreno } = mistni || await client.plneniObchodu(obchod));
  } catch (err) {
    chyba = err;
  }
  ui.showHistoryNote('');
  if (prohlizenyObchod !== obchod) return;

  const od = otevreno ?? plneni[0]?.time ?? obchod.openedAt;
  chartInterval = intervalProObchod(obchod.closedAt - od);
  obchod.okno = { od: Math.min(od, obchod.closedAt), do: obchod.closedAt };
  await otevriGraf(obchod.symbol, null, null);
  if (prohlizenyObchod !== obchod) return;

  if (chyba) {
    ui.showChartError(chyba.message || String(chyba));
    return;
  }

  // Směr obchodu je nejjistější z plnění, které ho otevřelo: nákup = long.
  // Odvozování z cen a zisku (`getClosedTrades`) je jen náhrada, když
  // plnění nejsou.
  const long = otevreno !== null && plneni.length ? plneni[0].buy : obchod.long;

  try {
    // Vstupy I1, I2…, výstupy O1, O2… v pořadí času (v0.41.1).
    let vstupu = 0;
    let vystupu = 0;
    chart.setTradeMarks(
      sloucitPodlePrikazu(plneni).map((p) => {
        const vstup = p.buy === long;
        return {
          time: p.time,
          price: p.price,
          vstup: p.buy,             // nákup ▲, prodej ▼ — stejně jako v živém grafu
          // Malé jako v živém grafu (v0.43.0); popisek nese číslo.
          maly: true,
          // Barva podle směru: nákup zeleně, prodej červeně (jako v živém grafu).
          color: p.buy ? BARVA_PLNENI.nakup : BARVA_PLNENI.prodej,
          title: vstup ? `I${++vstupu}` : `O${++vystupu}`,
        };
      }),
    );
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

/**
 * Odezva v telefonu. Alarmy doručuje server pushem (i se zhasnutým
 * displejem), takže volby zvuk / vibrace / notifikace u alarmu zmizely
 * (v0.25.0, rozhodnutí uživatele). V otevřené aplikaci stačí pruh
 * a zavibrování; pípnutí z aplikace zůstává jen jako záloha, když server
 * alarmy zrovna nehlídá — a pro zásah SL/TP, ten server nehlídá vůbec.
 */
function ozviSe(alarm, text, { zvuk = !alarmyServer.hlidaServer() } = {}) {
  navigator.vibrate?.([120, 70, 120, 70, 200]);
  if (zvuk) zapipej();
  ukazNotifikaci(alarm, text);
}

/** Text, který uživatel uvidí: jeho vlastní zpráva, jinak co se stalo. */
function textAlarmu(a) {
  if (a.zprava) return a.zprava;
  if (a.typ === 'cas') return t('alarm.timeHit', { symbol: a.symbol });
  return t('alarm.hit', { symbol: a.symbol, price: formatPrice(alarmy.uroven(a)) });
}

/** Kdy se alarm naposledy ohlásil v telefonu — proti dvojímu zvonění s push. */
const ohlaseneAlarmy = new Map();
const OKNO_DVOJITEHO = 5 * 60 * 1000;

function ohlasAlarmy(spustene) {
  for (const a of spustene) {
    const text = textAlarmu(a);
    ohlaseneAlarmy.set(a.id, Date.now());
    // Aplikace na pozadí + alarmy hlídá server → ozve se push ze serveru
    // (doručí ho Android i do spícího telefonu). Telefon by zvonil podruhé.
    if (document.visibilityState !== 'visible' && alarmyServer.hlidaServer()) continue;
    ozviSe(a, text);
    ui.showNotice(text);
  }
}

/**
 * Push ze serveru dorazil do otevřené aplikace (Android ho sám nezobrazí).
 * Když už alarm zazněl v telefonu, jen se srovná stav; jinak se ozve tady.
 */
async function pushDoAplikace(data) {
  const id = data?.alarmId;
  const nedavno = id && Date.now() - (ohlaseneAlarmy.get(id) || 0) < OKNO_DVOJITEHO;
  const alarm = (id && alarmy.najdi(id)) || { id, symbol: data?.symbol || '', typ: 'cena', zprava: '' };
  if (!nedavno) {
    ohlaseneAlarmy.set(id, Date.now());
    const text = alarm.price || alarm.typ === 'cas' ? textAlarmu(alarm)
      : t('alarm.hit', { symbol: alarm.symbol, price: data?.price || '' });
    ozviSe(alarm, text);
    ui.showNotice(text);
  }
  if (await alarmyServer.stahniStav()) vykresliAlarmy();
}

/**
 * Klepnutí na notifikaci alarmu otevře graf páru — a když na něm je
 * otevřená pozice, tak **s ní** (čáry vstupu, SL, TP, PnL). Dřív se graf
 * otevíral jako z Trhů, bez pozice.
 *
 * Po probuzení telefonu (nebo studeném startu) ještě nemusí být pozice
 * načtené a aplikace může být zamčená — proto se jen poznamená, co otevřít,
 * a otevře se, až je to možné: po odemčení a po prvních pozicích (nejvýš
 * 8 s čekání, pak aspoň bez pozice).
 */
let grafZNotifikace = null;
const CEKANI_NA_POZICE = 8000;

function otevriGrafZNotifikace(symbol) {
  if (!symbol) return;
  grafZNotifikace = { symbol, od: Date.now() };
  dokonciGrafZNotifikace();
}

function dokonciGrafZNotifikace() {
  const c = grafZNotifikace;
  if (!c) return;
  clearTimeout(dokonciGrafZNotifikace.odklad);
  // Zamčeno: otevře se po odemčení (zamek.spust → onOdemceno).
  if (zamek.jeZamceno()) return;
  const pozice = lastPositions.find((p) => p.symbol === c.symbol) || null;
  const pozicePrisly = !client.hasCredentials() || client.status.rest === 'ok';
  if (!pozice && !pozicePrisly && Date.now() - c.od < CEKANI_NA_POZICE) {
    dokonciGrafZNotifikace.odklad = setTimeout(dokonciGrafZNotifikace, 250);
    return;
  }
  grafZNotifikace = null;
  if (chartSymbol === c.symbol && (chartPosition || !pozice)) return; // už je otevřený
  // Jiný otevřený graf se nahradí; záznam v historii zůstane jeden, ať
  // tlačítko zpět nevyžaduje dvě klepnutí.
  const uzOtevreny = Boolean(chartSymbol);
  if (uzOtevreny) closeChart();
  if (uzOtevreny) otevriGraf.bezHistorie = true;
  if (pozice) openChart(pozice);
  else openChartSymbol({ symbol: c.symbol });
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

/*
 * Rychlý alarm (2026-10-06, podle TabTraderu): podržet prst v grafu, kříž
 * s cenou posunout, pustit — u ceny se objeví tlačítko a jeho klepnutí
 * alarm rovnou uloží a zapne, bez okna s nastavením (výchozí: oba směry,
 * jednou, bez vypršení). Doladit ho jde klepnutím na čáru alarmu.
 */
let rychlyAlarm = null;   // { cena, casovac }

/*
 * Nabídka se ukáže v místě, kde prst skončil (2026-10-08): nad prstem,
 * a když nahoře není místo, pod ním; vodorovně se drží v ploše grafu.
 */
function ukazRychlyAlarm(bod) {
  const menu = el('quickMenu');
  if (!menu || !chartSymbol) return;
  // Vybraná kresba nebo otevřená nabídka mají přednost.
  if (chart?.hasSelection?.() || document.querySelector('.sheet:not([hidden])')) return;
  const cena = zaokrouhliCenu(bod.value);
  if (!(cena > 0)) return;
  clearTimeout(rychlyAlarm?.casovac);
  rychlyAlarm = { cena, casovac: setTimeout(skryjRychlyAlarm, 6000) };
  menu.classList.remove('hotovo');
  menu.querySelectorAll('.quick-btn').forEach((b) => b.classList.remove('potvrzeno'));
  el('quickAlarmText').textContent = t('alarm.quickSetShort');
  el('quickLineText').textContent = t('tool.horizontalStraightLine');
  const pct = Number.isFinite(bod.pct) ? `  ${bod.pct >= 0 ? '+' : '−'}${Math.abs(bod.pct).toFixed(2)} %` : '';
  el('quickMenuPrice').textContent = `${formatPrice(cena)}${pct}`;

  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.hidden = false;
  const oblast = menu.parentElement.getBoundingClientRect();
  const sirka = menu.offsetWidth;
  const vyska = menu.offsetHeight;
  const left = Math.min(Math.max(8, bod.x - sirka / 2), oblast.width - sirka - 8);
  const nad = bod.y - vyska - 24;
  const top = nad >= 8 ? nad : Math.min(bod.y + 24, oblast.height - vyska - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  navigator.vibrate?.(12);
}

function skryjRychlyAlarm() {
  clearTimeout(rychlyAlarm?.casovac);
  rychlyAlarm = null;
  ukazPrvek('quickMenu', false);
}

function potvrdRychle(tlacitko, text) {
  el('quickMenu').classList.add('hotovo');
  tlacitko.classList.add('potvrzeno');
  tlacitko.querySelector('span').textContent = text;
  clearTimeout(rychlyAlarm?.casovac);
  rychlyAlarm = { cena: null, casovac: setTimeout(skryjRychlyAlarm, 1400) };
}

function potvrdRychlyAlarm() {
  if (!rychlyAlarm?.cena || !chartSymbol) return;
  const cena = rychlyAlarm.cena;
  ukazVrstvu('alarmy');
  alarmy.uloz({ ...alarmy.novy(chartSymbol, cena), aktivni: true });
  vykresliAlarmy();
  potvrdRychle(el('quickAlarm'), t('alarm.quickDone', { price: formatPrice(cena) }));
}

function potvrdRychlouCaru() {
  if (!rychlyAlarm?.cena || !chart) return;
  ukazVrstvu('kresby');
  if (!chart.addHorizontalLine(rychlyAlarm.cena)) return;
  potvrdRychle(el('quickLine'), t('chart.lineAdded'));
}

/**
 * Nový alarm se zadává **křížem v grafu**, ne číslem: hladinu si uživatel
 * ukáže prstem tam, kam se dívá. Číselník v nastavení zůstává na doladění.
 */
function novyAlarmKrizem() {
  if (!chart || !chartSymbol) return;
  ukazVrstvu('alarmy');
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
  ukazVrstvu('alarmy');
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
    // Zaměřovač a číselník v jednom řádku — dřív dva řádky přes celou šířku.
    const cena = document.createElement('div');
    cena.className = 'alarm-cena';
    cena.append(tlacitkoZamereni(), poleCeny());
    prvky.push(cena, radekVzdalenosti());
  }
  const volby = [];

  // Podmínka ani opakování nedávají u času smysl — ten nastane jednou.
  if (a.typ !== 'cas') {
    volby.push(
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

  volby.push(radekAlarmu('alarm.message', poleZpravy()));
  // Na rozevřeném Foldu jdou volby do dvou sloupců (CSS), formulář je pak
  // skoro poloviční.
  const mrizka = document.createElement('div');
  mrizka.className = 'alarm-volby';
  mrizka.append(...volby);
  prvky.push(mrizka);

  // Zapnutí je v hlavičce vedle nadpisu — u použitého (zešedlého) alarmu je
  // to první, co se hledá. Nabízí se jen u uloženého; nový je zapnutý.
  const zapnuti = el('alarmActiveBox');
  if (zapnuti) {
    zapnuti.hidden = !a.id;
    const popisek = document.createElement('span');
    popisek.textContent = t('alarm.active');
    zapnuti.replaceChildren(popisek,
      ovladacPole({ typ: 'prepinac' }, a.aktivni, (v) => { a.aktivni = v; }));
  }

  el('alarmBody').replaceChildren(...prvky);
  ukazVzdalenosti();
  ukazPoznamkuAlarmu();
}

/** Pod formulářem stojí, kdy alarm vyprší, kdy naposled zazněl a co neumí. */
function ukazPoznamkuAlarmu() {
  const a = upravovanyAlarm;
  if (!a) return;
  const radky = [t(alarmyServer.hlidaServer() ? 'alarm.hintServer' : 'alarm.hint')];
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
  // U měření jen koš: barva, tloušťka ani alarm tam smysl nemají.
  el('stylePanel').classList.toggle('jen-smazat', Boolean(styl.mereni));

  const oznac = (kontejner, atribut, hodnota) => {
    el(kontejner).querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset[atribut] === String(hodnota));
    });
  };
  oznac('styleColors', 'color', styl.color);
  oznac('styleWidths', 'width', styl.width);
  oznac('styleOpacity', 'opacity', styl.opacity);
}

const NABIDKY = ['sheetIndicators', 'sheetSettings', 'sheetAlarm', 'sheetLayers', 'sheetTools'];

/** Chybějící prvek se přeskočí, ať rozpadlá aktualizace nesestřelí graf. */
function ukazPrvek(id, viditelny) {
  const prvek = el(id);
  if (prvek) prvek.hidden = !viditelny;
}

let otevrenaNabidkaV = 0;

function otevriNabidku(id) {
  zavriNabidky();
  otevrenaNabidkaV = Date.now();
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

/*
 * Text štítku čáry: typ příkazu a hodnota v coinu, nebo v USDT — podle
 * přepínače v liště nástrojů (v0.42.0, `hodnotyVUsdt`).
 */
let hodnotyVUsdt = store.loadJson('perpdesk.lineUnit', 'coin') === 'usdt';
function popisCary(typ, qty, price, mena) {
  if (!(qty > 0)) return typ;
  if (hideAmounts) return `${typ} ${MASK_CARY}`;
  return hodnotyVUsdt ? `${typ} ${formatUsd(qty * price)} USDT` : `${typ} ${formatSize(qty)} ${mena}`;
}

function oznacJednotku() {
  const mena = String(chartSymbol || '').replace(/USDT$|USDC$/, '') || 'COIN';
  const text = el('unitBtnText');
  if (text) text.textContent = hodnotyVUsdt ? 'USDT' : mena;
}

function buildChartLines(position, orders) {
  const lines = [];

  /*
   * Bez pozice nejde příkazy zařadit na stranu zisku či ztráty (chybí
   * vstup), ale vypadají stejně jako u pozice (v0.41.0): typ jako na burze,
   * množství, hodnota pod čarou, nákup zeleně, prodej červeně. Dřív jen
   * šedé „Limit" — graf z Watchlists pak vypadal jinak než z Pozic.
   */
  if (!position) {
    const menaPar = String(chartSymbol || '').replace(/USDT$|USDC$/, '');
    return orders.map((o) => {
      const price = o.trigger ?? o.price;
      if (!price) return null;
      const buy = o.side === 'Buy';
      const typ = TYP_PRIKAZU[o.stopOrderType] || (buy ? TYP_PRIKAZU.limitBuy : TYP_PRIKAZU.limitSell);
      return {
        price,
        color: buy ? BARVA_CARY.nakup : BARVA_CARY.prodej,
        bezCenovky: true,
        dash: CARKOVANI.limitka,
        title: popisCary(typ, o.qty, price, menaPar),
      };
    }).filter(Boolean);
  }

  /*
   * Průměrný vstup (od v0.30.2, volba uživatele): jen **krátký zub u cenové
   * osy** se štítkem ceny — čára přes celý graf vizuálně rušila (dřív plná
   * fialová od první nákupní svíčky, pak od levého okraje k poslednímu
   * nákupu). Průměr stojí navíc v textu linky zisku („… · avg 0.30135").
   */
  // 2026-10-04: ani zub nevyhovoval — vstup je už **jen štítek na ose**.
  if (position.entry) {
    lines.push({ price: position.entry, color: BARVA_CARY.vstupOsa, title: t('line.entry'),
                 plna: true, jenOsa: true });
  }

  /*
   * Popisky (2026-10-03, přání uživatele — dřív zabíraly moc místa na šířku):
   * nad čarou **typ příkazu jako na burze** a vedle množství v coinu, pod
   * čarou hodnota v USDT. Žádná čísla TP1/TP2 ani podíly v procentech.
   */
  const mena = String(position.symbol || '').replace(/USDT$|USDC$/, '');

  if (position.liq) {
    lines.push({ price: position.liq, color: BARVA_CARY.likvidace, dash: CARKOVANI.likvidace,
                 title: popisCary(TYP_PRIKAZU.likvidace, position.size, position.liq, mena) });
  }
  if (position.stopLoss) {
    lines.push({ price: position.stopLoss, color: BARVA_CARY.sl, dash: CARKOVANI.uroven,
                 title: popisCary(TYP_PRIKAZU.StopLoss, position.size, position.stopLoss, mena) });
  }
  // Barva podle směru příkazu: TP longu prodává (červeně), TP shortu
  // nakupuje (zeleně). Totéž limitky — prodej červeně, nákup zeleně.
  const barvaTp = position.side === 'Sell' ? BARVA_CARY.nakup : BARVA_CARY.prodej;
  if (position.takeProfit) {
    lines.push({ price: position.takeProfit, color: barvaTp, dash: CARKOVANI.tp,
                 title: popisCary(TYP_PRIKAZU.TakeProfit, position.size, position.takeProfit, mena) });
  }

  for (const order of orders) {
    const price = order.trigger ?? order.price;
    if (!price) continue;
    // Bybit vrací SL a TP pozice i jako podmíněné příkazy. Bez tohohle by se
    // každá úroveň nakreslila dvakrát, jednou jako TP a jednou jako podmíněná.
    if (samePrice(price, position.stopLoss) || samePrice(price, position.takeProfit)) continue;

    const strana = orderSide(order, position);
    const buy = order.side === 'Buy';
    const typ = TYP_PRIKAZU[order.stopOrderType] || (buy ? TYP_PRIKAZU.limitBuy : TYP_PRIKAZU.limitSell);
    if (strana === 'tp') {
      lines.push({ price, color: barvaTp, dash: CARKOVANI.tp, title: popisCary(typ, order.qty, price, mena) });
    } else if (strana === 'sl') {
      lines.push({ price, color: BARVA_CARY.sl, dash: CARKOVANI.castecna, title: popisCary(typ, order.qty, price, mena) });
    } else {
      // Limitky bez cenovky na ose — u přikupování jich bývá víc a osa by se
      // zaplnila štítky. Nákup zeleně, prodej červeně.
      lines.push({ price, color: buy ? BARVA_CARY.nakup : BARVA_CARY.prodej, bezCenovky: true,
                   dash: CARKOVANI.limitka, title: popisCary(typ, order.qty, price, mena) });
    }
  }

  return lines;
}

/**
 * Čáry se překreslují jen při skutečné změně. Bez toho by se rušily a znovu
 * vytvářely při každém ticku ceny, protože pozice chodí i z ticker streamu.
 */
function applyChartLines(force = false) {
  if (!chart || !chartSymbol) return;

  const lines = buildChartLines(chartPosition, chartOrders);
  // Čas začátku je v klíči taky: čára vstupu se po dopočtu otevření musí
  // překreslit, i když se cena nezměnila.
  const key = lines.map((l) => `${l.title}@${l.price}@${l.odCasu || ''}@${l.doCasu || ''}@${l.pod || ''}`).join('|');
  if (!force && key === chartLineKey) return;

  chartLineKey = key;
  chart.setPositionLines(lines);
}

/** Pozice se mění za běhu — graf musí držet krok s PnL, SL/TP i likvidací. */
function syncOpenChart(list) {
  if (!chartSymbol) return;

  /*
   * Pozice otevřená na páru, jehož graf je zrovna otevřený (2026-10-08,
   * jako v TabTraderu): uživatel kouká na graf, vstoupí přes burzu a po
   * návratu chce vidět pozici hned, ne až po zavření a otevření grafu.
   * Pozice chodí živě privátním streamem tak jako tak — tady se jen
   * jednou, při přechodu „bez pozice → s pozicí", dokreslí její čáry,
   * příkazy a značky. Běžné ticky nestojí nic navíc.
   */
  if (!chartPosition) {
    if (prohlizenyObchod) return;
    const nova = list.find((p) => p.symbol === chartSymbol);
    if (!nova) return;
    chartPosition = nova;
    chartOtevreno = null;
    ui.renderChartHeader(chartSymbol, nova, hideAmounts);
    ui.renderChartInfo(nova, hideAmounts, popisBurzy(), chartObrat);
    applyChartLines();
    nastavLinkuPnl();
    refreshChartOrders();
    znackyPlneni(nova);
    nactiOtevreni(nova);
    return;
  }

  const fresh = list.find(
    (p) => p.symbol === chartPosition.symbol && p.positionIdx === chartPosition.positionIdx,
  );
  if (!fresh) {
    // Pozice byla zavřená — graf nechat otevřený, jen bez čar pozice.
    chartOrders = [];
    chartPosition = null;
    // A bez linky zisku; nemá se z čeho počítat.
    nastavLinkuPnl();
    applyChartLines();
    ui.renderChartHeader(chartSymbol, null, hideAmounts, chartTrh);
    ui.renderChartInfo(null, hideAmounts, popisBurzy(), chartObrat);
    // Příkazy na páru (limitky) mohly pozici přežít — načíst znovu.
    refreshChartOrders();
    return;
  }

  chartPosition = fresh;
  ui.renderChartHeader(chartSymbol, fresh, hideAmounts);
  // Panel se překresluje pokaždé — mark, PnL i ROE se mění s každým tickem.
  ui.renderChartInfo(fresh, hideAmounts, popisBurzy(), chartObrat);
  applyChartLines();
  // Průměrný vstup se mění při přikoupení, linka ho musí sledovat.
  nastavLinkuPnl();
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
  if (isUpdate) nactiNovinky();
  // Až čekající worker přejde do jiného stavu, přehodnoť to znovu.
  waiting?.addEventListener('statechange', refreshUpdateBar);
}

/**
 * „Co je nového" nové verze. Starý kód o novém nic neví, proto se čte
 * novinky.json ze serveru — patří k právě nasazené (čekající) verzi.
 * Jedinečný parametr obejde HTTP cache Pages i cache service workeru.
 */
let novinkyNacteny = false;
async function nactiNovinky() {
  if (novinkyNacteny) return;
  novinkyNacteny = true;
  try {
    const res = await fetch(`novinky.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const poznamky = await res.json();
    ui.renderUpdateNotes(poznamky, getLanguage() || 'en');
  } catch {
    novinkyNacteny = false; // příště zkusit znovu; lišta funguje i bez poznámek
    ui.renderUpdateNotes(null, getLanguage() || 'en');
  }
}

async function registerServiceWorker() {
  // Rozbalení „Co je nového" nezávisí na tom, jestli registrace vyjde.
  naUdalost('updateInfo', 'click', () => ui.toggleUpdateNotes());
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

/* ---------- záloha a obnova (js/zaloha.js) ---------- */

function zpravaZalohy(text, ok = true) {
  const p = el('backupMsg');
  if (!p) return;
  p.textContent = text;
  p.className = `settings-msg ${ok ? 'ok' : 'fail'}`;
  p.hidden = false;
}

async function ulozZalohu() {
  try {
    const cesta = await zaloha.ulozVen(zaloha.sestavZalohu());
    if (cesta === 'sdileni') zpravaZalohy(t('backup.shared'));
    else if (cesta === 'schranka') zpravaZalohy(t('backup.copied'));
    else zpravaZalohy(t('backup.downloaded', { name: zaloha.nazevSouboru() }));
  } catch (e) {
    // Zavřené sdílení bez výběru cíle není chyba.
    if (/cancel/i.test(String(e?.message || e))) return;
    console.warn('zaloha', e);
    zpravaZalohy(t('backup.failed'), false);
  }
}

async function obnovZalohu(e) {
  const soubor = e.target.files?.[0];
  e.target.value = '';   // stejný soubor půjde vybrat znovu
  if (!soubor) return;
  let z;
  try {
    z = zaloha.prectiZalohu(await soubor.text());
  } catch (chyba) {
    zpravaZalohy(t(chyba.message === 'newer-version' ? 'backup.newer' : 'backup.notBackup'), false);
    return;
  }
  const s = zaloha.souhrn(z);
  const ok = confirm(t('backup.confirm', {
    date: s.vytvoreno ? new Date(s.vytvoreno).toLocaleDateString(getLocale()) : '?',
    lists: s.seznamy, pairs: s.paryVSeznamech, drawings: s.kresby,
    drawingPairs: s.parySKresbami, alarms: s.alarmy,
  }));
  if (!ok) return;
  zaloha.obnov(z);
  zpravaZalohy(t('backup.restored'));
  // Moduly drží data v paměti (alarmy, seznamy) — čistý start je nejjistější.
  setTimeout(() => location.reload(), 600);
}

/* ---------- účet PerpyX (js/ucet.js) ---------- */

let emailUctu = '';

function zpravaUctu(text, ok = true) {
  // Přihlašuje se na úvodní obrazovce, zálohy a odhlášení jsou v nastavení.
  const p = el(uvodViditelny() ? 'accountMsg' : 'accountSettingsMsg');
  if (!p) return;
  p.textContent = text || '';
  p.className = `settings-msg ${ok ? 'ok' : 'fail'}`;
  p.hidden = !text;
}

function ukazKrokUctu(krok) {
  ukazPrvek('accountStepEmail', krok === 'email');
  ukazPrvek('accountStepCode', krok === 'kod');
  zpravaUctu('');
  if (krok === 'kod') el('accountCode')?.focus();
}

function vykresliUcet() {
  const prihlasen = ucet.prihlasen();
  ukazPrvek('feedbackBtn', HLASENI_ZAPNUTO && prihlasen);
  pozvanky.ukazTlacitko(prihlasen);
  ukazPrvek('accountIn', prihlasen);
  if (!prihlasen) {
    ukazUvod('prihlaseni');
    return;
  }
  const kdo = el('accountWho');
  if (kdo) kdo.textContent = ucet.email();
  const z = ucet.posledniZaloha();
  const stav = el('accountBackupState');
  if (!stav) return;
  if (z.probiha) stav.textContent = t('account.backingUp');
  else if (z.chyba) stav.textContent = t('account.backupFailed', { why: z.chyba });
  else if (z.kdy) stav.textContent = t('account.lastBackup', { when: new Date(z.kdy).toLocaleString(getLocale()) });
  else stav.textContent = t('account.noBackup');
}

const duvod = (e) => e?.kod || e?.message || 'offline';

async function posliKodUctu() {
  const adresa = (el('accountEmail')?.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresa)) {
    zpravaUctu(t('account.invalidEmail'), false);
    return;
  }
  const btn = el('accountSendBtn');
  if (btn) btn.disabled = true;
  try {
    const d = await ucet.posliKod(adresa);
    emailUctu = adresa;
    ukazKrokUctu('kod');
    const hint = el('accountCodeHint');
    if (hint) hint.textContent = t(d.wait ? 'account.codeWait' : 'account.codeSent', { email: adresa });
  } catch (e) {
    const klic = { 'invalid-email': 'account.invalidEmail', 'limit-today': 'account.limitToday' }[e.kod] || 'account.failed';
    zpravaUctu(t(klic, { why: duvod(e) }), false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

let overuji = false;

async function overKodUctu() {
  const kod = (el('accountCode')?.value || '').trim();
  if (overuji || !/^\d{6}$/.test(kod)) return;
  overuji = true;
  try {
    const me = await ucet.overKod(emailUctu, kod);
    el('accountCode').value = '';
    ukazKrokUctu('email');
    store.saveJson('perpdesk.disclaimerSeen', true);   // přečetl na úvodní obrazovce
    ukazPrvek('disclaimerNote', false);
    await nabidniObnovuPoPrihlaseni(me);
    alarmyServer.zapniPush().then(vykresliPushStav);
    if (store.hasCredentials()) skryjUvod();
    else ukazUvod('burza');
  } catch (e) {
    const zprava = {
      'wrong-code': t('account.wrongCode', { left: e.data?.left ?? '?' }),
      'code-expired': t('account.codeExpired'),
      'too-many-attempts': t('account.tooMany'),
      'limit-today': t('account.limitToday'),
    }[e.kod] || t('account.failed', { why: duvod(e) });
    zpravaUctu(zprava, false);
  } finally {
    overuji = false;
  }
}

/**
 * Po přihlášení: když je na účtu záloha, nabídnout obnovu. Prázdný
 * telefon (nová instalace) dostane jen otázku „obnovit?"; telefon
 * s vlastními daty volí, která data platí.
 */
async function nabidniObnovuPoPrihlaseni(me) {
  if (!me.backup) {
    ucet.zalohujTed().catch(() => {});
    return;
  }
  let z;
  try {
    z = await ucet.stahniZalohu();
  } catch {
    return;
  }
  const s = zaloha.souhrn(z);
  const parametry = {
    date: new Date(s.vytvoreno || me.backup.created_at).toLocaleString(getLocale()),
    lists: s.seznamy, drawings: s.kresby, alarms: s.alarmy,
  };
  const mistni = ucet.maMistniData();
  // Prázdný telefon (po odhlášení se vše maže) dostane data účtu bez ptaní.
  const obnovit = !mistni || confirm(t('account.offerRestoreReplace', parametry));
  if (obnovit) {
    zaloha.obnov(z);
    zpravaUctu(t('backup.restored'));
    setTimeout(() => location.reload(), 600);
  } else if (mistni) {
    ucet.zalohujTed().catch(() => {});
  }
}

async function zalohujUcetTed() {
  try {
    await ucet.zalohujTed();
    zpravaUctu(t('account.backedUp'));
  } catch (e) {
    zpravaUctu(t('account.failed', { why: duvod(e) }), false);
  }
}

async function otevriObnovuUctu() {
  const box = el('accountRestoreBox');
  if (box && !box.hidden) {
    box.hidden = true;
    return;
  }
  try {
    const verze = await ucet.verzeZaloh();
    if (!verze.length) {
      zpravaUctu(t('account.noVersions'), false);
      return;
    }
    const vyber = el('accountVersions');
    vyber.replaceChildren(...verze.map((v) => {
      const o = document.createElement('option');
      o.value = String(v.version);
      o.textContent = new Date(v.created_at).toLocaleString(getLocale());
      return o;
    }));
    ukazPrvek('accountRestoreBox', true);
    zpravaUctu('');
  } catch (e) {
    zpravaUctu(t('account.failed', { why: duvod(e) }), false);
  }
}

async function obnovZUctu() {
  const verze = Number(el('accountVersions')?.value) || null;
  try {
    const z = await ucet.stahniZalohu(verze);
    const s = zaloha.souhrn(z);
    const ok = confirm(t('backup.confirm', {
      date: s.vytvoreno ? new Date(s.vytvoreno).toLocaleString(getLocale()) : '?',
      lists: s.seznamy, pairs: s.paryVSeznamech, drawings: s.kresby,
      drawingPairs: s.parySKresbami, alarms: s.alarmy,
    }));
    if (!ok) return;
    zaloha.obnov(z);
    zpravaUctu(t('backup.restored'));
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    zpravaUctu(t('account.failed', { why: duvod(e) }), false);
  }
}

/**
 * Odhlášení smaže z telefonu všechna data (rozhodnutí uživatele
 * 2026-10-03): jinak by je viděl a do svého cloudu zazálohoval další
 * přihlášený účet. Nejdřív se ale pošlou poslední změny do zálohy —
 * když to nejde, uživatel rozhodne, jestli se odhlásit i tak.
 */
async function odhlasUcet() {
  if (!confirm(t('account.confirmSignOut'))) return;
  zpravaUctu(t('account.signingOut'));
  try {
    await ucet.zalohujTed();
  } catch (e) {
    if (!confirm(t('account.signOutBackupFailed', { why: duvod(e) }))) {
      zpravaUctu('');
      return;
    }
  }
  await alarmyServer.odhlasZarizeni();
  await ucet.odhlas();
  client.stop();
  zaloha.vymazMistniData();
  location.reload();
}

async function smazUcet() {
  if (!confirm(t('account.confirmDelete'))) return;
  try {
    await alarmyServer.odhlasZarizeni();
    await ucet.smazUcet();
    // Účet i jeho zálohy jsou pryč — data v telefonu už nepatří nikomu.
    client.stop();
    zaloha.vymazMistniData();
    zpravaUctu(t('account.deleted'));
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    zpravaUctu(t('account.failed', { why: duvod(e) }), false);
  }
}

/* ---------- zámek aplikace v nastavení (js/zamek.js) ---------- */

let rezimZamku = null;   // 'novy' | 'znovu' | 'vypnout' | 'zmenaStary'
let prvniPinZamku = '';

function zpravaZamku(text, ok = true) {
  const p = el('lockSettingsMsg');
  if (!p) return;
  p.textContent = text || '';
  p.className = `settings-msg ${ok ? 'ok' : 'fail'}`;
  p.hidden = !text;
}

async function vykresliZamek(vycistit = false) {
  const zap = zamek.zapnuto();
  const prepinac = el('lockPinToggle');
  if (prepinac) {
    prepinac.classList.toggle('on', zap);
    prepinac.setAttribute('aria-pressed', String(zap));
  }
  ukazPrvek('lockSetup', Boolean(rezimZamku));
  ukazPrvek('lockOptions', zap && !rezimZamku);
  const popisek = el('lockPinLabel');
  if (popisek && rezimZamku) {
    popisek.textContent = t({
      novy: 'lock.newPin', znovu: 'lock.repeatPin', vypnout: 'lock.currentPin', zmenaStary: 'lock.currentPin',
    }[rezimZamku]);
  }
  if (vycistit) {
    const pole = el('lockPinInput');
    if (pole) {
      pole.value = '';
      pole.focus();
    }
    zpravaZamku('');
  }
  const doba = el('lockAfter');
  if (doba && !doba.options.length) {
    doba.replaceChildren(...zamek.DOBY.map((m) => {
      const o = document.createElement('option');
      o.value = String(m);
      o.textContent = m === 0 ? t('lock.immediately') : t('lock.minutes', { n: m });
      return o;
    }));
  }
  if (doba) doba.value = String(zamek.poMinutach());
  const otisk = el('lockBioToggle');
  if (otisk) {
    otisk.classList.toggle('on', zamek.sBiometrii());
    otisk.setAttribute('aria-pressed', String(zamek.sBiometrii()));
    otisk.disabled = !zap;
  }
  // Řádek s otiskem jen tam, kde telefon otisk umí (v APK se čtečkou).
  // Bez PINu je vidět, ale zašedlý s vysvětlením — jinak by uživatel
  // nevěděl, že otisk existuje ani proč nejde zapnout.
  const umi = await zamek.biometrieDostupna();
  ukazPrvek('lockBioRow', umi);
  el('lockBioRow')?.classList.toggle('zasedle', !zap);
  ukazPrvek('lockBioHint', umi && !zap);
}

async function potvrdPinZamku() {
  const pole = el('lockPinInput');
  const pin = (pole?.value || '').trim();
  if (pole) pole.value = '';
  if (rezimZamku === 'novy') {
    if (!/^\d{4,6}$/.test(pin)) {
      zpravaZamku(t('lock.pinInvalid'), false);
      return;
    }
    prvniPinZamku = pin;
    rezimZamku = 'znovu';
    await vykresliZamek();
    zpravaZamku('');
    pole?.focus();
    return;
  }
  if (rezimZamku === 'znovu') {
    if (pin !== prvniPinZamku) {
      prvniPinZamku = '';
      rezimZamku = 'novy';
      await vykresliZamek();
      zpravaZamku(t('lock.pinMismatch'), false);
      return;
    }
    const zmena = zamek.zapnuto();
    await zamek.nastavPin(pin);
    prvniPinZamku = '';
    rezimZamku = null;
    await vykresliZamek();
    zpravaZamku(t(zmena ? 'lock.changed' : 'lock.on'));
    return;
  }
  if (!(await zamek.overPin(pin))) {
    zpravaZamku(t('lock.pinWrong'), false);
    pole?.focus();
    return;
  }
  if (rezimZamku === 'vypnout') {
    zamek.vypni();
    rezimZamku = null;
    await vykresliZamek();
    zpravaZamku(t('lock.off'));
  } else if (rezimZamku === 'zmenaStary') {
    rezimZamku = 'novy';
    await vykresliZamek();
    zpravaZamku('');
    pole?.focus();
  }
}

async function prepniOtiskZamku() {
  if (!zamek.zapnuto()) return;
  if (zamek.sBiometrii()) {
    zamek.nastavBiometrii(false);
  } else if (await zamek.overOtiskem()) {
    // Zapnout jen po úspěšném přiložení prstu — ať je jisté, že čtečka jde.
    zamek.nastavBiometrii(true);
    zpravaZamku('');
  } else {
    zpravaZamku(t('lock.bioFailed'), false);
  }
  vykresliZamek();
}

/* ---------- alarmy se zhasnutým displejem (js/alarmy-server.js) ---------- */

function vykresliPushStav() {
  const p = el('accountPushState');
  const btn = el('accountPushBtn');
  if (!p) return;
  const s = alarmyServer.stavServeru();
  let text = '';
  let tlacitko = false;
  if (s.push === 'unsupported') text = t('account.pushWeb');
  else if (s.push === 'denied') text = t('account.pushDenied');
  else if (s.push === 'on') text = t(alarmyServer.hlidaServer() ? 'account.pushOn' : 'account.pushOnStale');
  else if (s.push === 'error') {
    text = t('account.pushError', { why: s.chyba || '?' });
    tlacitko = true;
  } else {
    text = t('account.pushOff');
    tlacitko = true;
  }
  p.textContent = text;
  p.classList.toggle('ok', s.push === 'on' && alarmyServer.hlidaServer());
  if (btn) btn.hidden = !tlacitko;
}

/* ---------- úvodní obrazovka a burzy ---------- */

/**
 * Úvodní obrazovka: `prihlaseni` (povinné — bez účtu se dál nejde)
 * nebo `burza` (připojení klíče; jde přeskočit). `zavritelna` = otevřená
 * z nastavení, má křížek.
 */
function ukazUvod(krok, zavritelna = false) {
  document.documentElement.classList.remove('uvod-start');
  ukazPrvek('onboarding', true);
  ukazPrvek('onbLogin', krok === 'prihlaseni');
  ukazPrvek('onbExchange', krok === 'burza');
  ukazPrvek('onbCloseBtn', zavritelna && krok === 'burza');
  ukazPrvek('onbSkipBtn', !zavritelna);
  document.documentElement.classList.add('uvod');
  if (krok === 'burza') ui.clearSettingsMessage();
}

function skryjUvod() {
  // Přihlášení se zavřít nedá — bez účtu aplikace nepokračuje.
  if (!ucet.prihlasen()) return;
  document.documentElement.classList.remove('uvod-start');
  ukazPrvek('onboarding', false);
  document.documentElement.classList.remove('uvod');
}

const uvodViditelny = () => el('onboarding')?.hidden === false;

/** Připojené burzy v nastavení — klíč se nikdy neukazuje, jen jeho konec. */
function vykresliBurzy() {
  const seznam = el('exchangeList');
  if (!seznam) return;
  const { apiKey } = store.loadCredentials();
  if (!apiKey) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = t('exchanges.none');
    seznam.replaceChildren(p);
    ukazPrvek('exchangeAddBtn', true);
    return;
  }
  const radek = document.createElement('div');
  radek.className = 'exchange-row';
  const nazev = document.createElement('div');
  nazev.className = 'exchange-name';
  nazev.textContent = 'Bybit';
  const klic = document.createElement('div');
  klic.className = 'exchange-key';
  klic.textContent = t('exchanges.keyEnding', { end: apiKey.slice(-4) });
  nazev.append(klic);
  const vymenit = document.createElement('button');
  vymenit.type = 'button';
  vymenit.className = 'secondary-btn';
  vymenit.textContent = t('exchanges.replace');
  vymenit.addEventListener('click', () => ukazUvod('burza', true));
  const odpojit = document.createElement('button');
  odpojit.type = 'button';
  odpojit.className = 'text-btn danger';
  odpojit.textContent = t('exchanges.disconnect');
  odpojit.addEventListener('click', clearCredentials);
  radek.append(nazev, vymenit, odpojit);
  seznam.replaceChildren(radek);
  // Víc burz zatím neumíme — „přidat" by nabídlo jen tu, co už je.
  ukazPrvek('exchangeAddBtn', false);
}

/* ---------- hlášení problému / nápadu (js/hlaseni.js) ---------- */

/**
 * Dočasně po dobu bety: tlačítko v rohu hlavních obrazovek. Po betě stačí
 * přepnout na false — zůstane jen řádek v nastavení (O aplikaci).
 */
const HLASENI_ZAPNUTO = true;
let hlaseniDruh = 'problem';
let hlaseniSnimky = [];

function hlaseniUdaje() {
  const lista = el('errorBar');
  return hlaseni.technickeUdaje({
    lang: getLanguage(),
    view: chartSymbol ? `chart ${chartSymbol} ${chartInterval}` : aktivniZalozka,
    exchange: store.hasCredentials() ? 'bybit' : 'none',
    push: alarmyServer.stavServeru().push,
    lock: zamek.zapnuto() ? 'on' : 'off',
    lastError: lista && !lista.hidden ? lista.textContent.slice(0, 200) : '',
  });
}

function zpravaHlaseni(text, ok = true) {
  const p = el('feedbackMsg');
  if (!p) return;
  p.textContent = text || '';
  p.className = `settings-msg ${ok ? 'ok' : 'fail'}`;
  p.hidden = !text;
}

function otevriHlaseni() {
  const info = el('feedbackInfo');
  if (info) {
    info.textContent = Object.entries(hlaseniUdaje())
      .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  zpravaHlaseni('');
  ukazPrvek('feedbackBackdrop', true);
  ukazPrvek('sheetFeedback', true);
}

function zavriHlaseni() {
  ukazPrvek('feedbackBackdrop', false);
  ukazPrvek('sheetFeedback', false);
}

function vykresliSnimky() {
  const box = el('feedbackShots');
  if (!box) return;
  box.replaceChildren(...hlaseniSnimky.map((s, i) => {
    const d = document.createElement('div');
    d.className = 'feedback-shot';
    const img = document.createElement('img');
    img.src = s.nahled;
    img.alt = '';
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', t('feedback.remove'));
    x.addEventListener('click', () => {
      hlaseniSnimky.splice(i, 1);
      vykresliSnimky();
    });
    d.append(img, x);
    return d;
  }));
  ukazPrvek('feedbackAddShot', hlaseniSnimky.length < hlaseni.MAX_SNIMKU);
}

async function pridejSnimky(e) {
  const soubory = [...(e.target.files || [])];
  e.target.value = '';
  if (hlaseniSnimky.length + soubory.length > hlaseni.MAX_SNIMKU) zpravaHlaseni(t('feedback.tooMany'), false);
  for (const f of soubory.slice(0, hlaseni.MAX_SNIMKU - hlaseniSnimky.length)) {
    try {
      hlaseniSnimky.push(await hlaseni.zmensiSnimek(f));
    } catch { /* ne obrázek — přeskočit */ }
  }
  vykresliSnimky();
}

async function odesliHlaseni() {
  const text = (el('feedbackText')?.value || '').trim();
  if (!text && !hlaseniSnimky.length) {
    zpravaHlaseni(t('feedback.empty'), false);
    return;
  }
  const btn = el('feedbackSend');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('feedback.sending');
  }
  try {
    await hlaseni.odesli({ druh: hlaseniDruh, text, snimky: hlaseniSnimky, info: hlaseniUdaje() });
    el('feedbackText').value = '';
    hlaseniSnimky = [];
    vykresliSnimky();
    zpravaHlaseni(t('feedback.sent'));
    setTimeout(zavriHlaseni, 1800);
  } catch (e) {
    zpravaHlaseni(e?.kod === 'limit-today' ? t('feedback.limit') : t('feedback.failed', { why: e?.kod || e?.message || 'offline' }), false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('feedback.send');
    }
  }
}

/*
 * ⚠ Spuštění musí být **úplně na konci souboru.** Funkce se „vytáhnou"
 * nahoru samy, ale proměnné deklarované `let` až pod voláním ještě
 * neexistují — boot() na ně sáhne a spadne na „Cannot access … before
 * initialization" (stalo se ve v0.21.0 s nastavením zámku). Nový kód
 * patří nad tenhle řádek.
 */
boot();
