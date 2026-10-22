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
  viewAlerts: el('viewAlerts'),
  accountSummary: el('accountSummary'),
  accEquity: el('accEquity'),
  accAvailable: el('accAvailable'),
  accMargin: el('accMargin'),
  accountNote: el('accountNote'),
  positionTools: el('positionTools'),
  stat30: el('stat30'),
  stat30Pnl: el('stat30Pnl'),
  stat30Detail: el('stat30Detail'),
  stat30Graf: el('stat30Graf'),
  positionToolsBtn: el('positionToolsBtn'),
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

/** „480" → „8 h", „60" → „1 h", „30" → „30 min". */
function intervalPopis(minut) {
  const m = Number(minut) || 480;
  return m % 60 === 0 ? `${m / 60} h` : `${m} min`;
}

/**
 * Patička karty drobným písmem, v tomhle pořadí:
 * sazba → nejbližší stržení a jeho částka (a kolik to dělá za den) →
 * součet za dobu držení. Je v ní jen funding, nic jiného.
 *
 * ⚠ Za jedno stržení a za den nejsou totéž: Bybit u většiny párů strhává
 * po osmi hodinách, tedy třikrát denně. Dřív tu stála jen denní částka
 * a působilo to, jako by se platilo jednou za den.
 *
 * Znaménko se počítá podle směru pozice — kladná sazba znamená, že long
 * platí shortu. Proto se neukazuje jen číslo, ale i to, na kterou stranu
 * peníze tečou; ze samotného „0,01 %" to nikdo nepozná.
 */
function patickaRow(p, hide) {
  /*
   * Krátce, čísly (v0.40.0, přání uživatele — dlouhá věta byla nečitelná):
   *   Funding +0.0050 %/4h   Next −0.09 (48 m)   Day −0.53   Total −1.41 (5 d)
   * Směr peněz říká **znaménko a barva** (− červeně = platíš, + zeleně =
   * dostáváš), ne slova. Interval stržení stojí u sazby („/4h") — každý
   * pár ho má vlastní. Součet za dobu držení s dobou v závorce; chybí, když
   * klíč nemá oprávnění Wallet.
   */
  const radek = document.createElement('div');
  radek.className = 'pos-funding';

  const f = p.funding;
  if (!f || !Number.isFinite(f.rate)) return radek;
  const isLong = p.side !== 'Sell';
  // Long platí při kladné sazbě, short při záporné.
  const platiUzivatel = isLong ? f.rate > 0 : f.rate < 0;
  const zaInterval = Math.abs(p.value * f.rate);
  const zaDen = zaInterval * (1440 / (f.minut || 480));
  const znak = platiUzivatel ? '−' : '+';
  const trida = `hodnota ${platiUzivatel ? 'platis' : 'dostavas'}`;

  const polozka = (popisek, hodnota, tridaHodnoty = '') => {
    const s = document.createElement('span');
    s.className = 'fp';
    const l = document.createElement('span');
    l.className = 'fp-popis';
    l.textContent = popisek;
    const h = document.createElement('span');
    if (tridaHodnoty) h.className = tridaHodnoty;
    h.textContent = hodnota;
    s.append(l, h);
    return s;
  };

  const sazba = polozka(t('funding.label'),
    `${formatPercent(f.rate * 100, 4)}/${intervalPopis(f.minut)}`);
  // Kdo platí (v0.66.0, uživatel: „plus = longy platí“ se špatně pamatuje).
  if (f.rate) {
    const kdo = document.createElement('span');
    kdo.className = 'fp-kdo';
    kdo.textContent = t(f.rate > 0 ? 'funding.longsPay' : 'funding.shortsPay');
    sazba.append(kdo);
  }
  radek.append(sazba);

  const zbyva = f.nextAt ? f.nextAt - Date.now() : 0;
  radek.append(polozka(t('funding.nextShort'),
    hide ? MASK : `${znak}${formatUsd(zaInterval)}${zbyva > 0 ? ` (${trvani(zbyva)})` : ''}`, trida));
  radek.append(polozka(t('funding.dayShort'), hide ? MASK : `${znak}${formatUsd(zaDen)}`, trida));

  if (f.zaplaceno && Number.isFinite(f.zaplaceno.celkem) && f.zaplaceno.pocet > 0) {
    const celkem = f.zaplaceno.celkem;
    // Doba od nejstaršího započítaného stržení — nesmí slibovat víc, než se stáhlo.
    const doba = f.zaplaceno.odKdy ? Date.now() - f.zaplaceno.odKdy : 0;
    const kratce = trvani(doba).split(' ').slice(0, 2).join(' ');
    radek.append(polozka(t('funding.totalShort'),
      // Bez známého otevření (Hyperliquid dá součet, ale ne čas) jen částka.
      hide ? MASK : `${celkem < 0 ? '−' : '+'}${formatUsd(Math.abs(celkem))}${doba > 0 ? ` (${kratce})` : ''}`,
      `hodnota ${celkem < 0 ? 'platis' : 'dostavas'}`));
  }
  return radek;
}

/**
 * Proužek s úrovněmi pozice — jako stupnice na starém rádiu.
 *
 * Uprostřed vstup, vlevo strana ztráty (SL), vpravo strana zisku (TP),
 * po celé délce jezdí ukazatel aktuální ceny. Smysl: bez otevírání grafu
 * je hned vidět, kolik mám kde nastavených příkazů a jak blízko k nim cena
 * je. U shortu se osa zrcadlí, aby „vlevo = ztráta" platilo vždycky.
 */
function ladderRow(zebrik, p, hide) {
  const { vstup, mark, long, znacky } = zebrik;

  const smer = long ? 1 : -1;
  /** Kladné = směrem k zisku, záporné = směrem ke ztrátě. */
  const odstup = (cena) => smer * (cena - vstup);

  /*
   * ⚠ Každá strana má **vlastní měřítko**. Společné měřítko vypadalo
   * logicky, ale v praxi nefungovalo: TP bývá dvacet procent daleko,
   * SL dvě, takže vzdálený TP stlačil oba stop-lossy na jednu čáru u středu
   * a nebylo poznat, jak blízko k nim cena je — přitom právě to má proužek
   * ukázat. Teď levá půlka pokrývá vstup → nejzazší SL, pravá vstup →
   * nejzazší TP, takže obě strany využijí celou šířku.
   *
   * Cena mezi stranami neporovnává vzdálenost, ale „jak daleko k nejbližší
   * hranici na téhle straně" — a to je přesně otázka, na kterou se kouká.
   */
  const nejdal = (filtr) => {
    const hodnoty = znacky.filter(filtr).map((z) => Math.abs(odstup(z.cena)));
    return hodnoty.length ? Math.max(...hodnoty) : 0;
  };
  const zaloha = Math.max(Math.abs(odstup(mark)), Math.abs(vstup) * 0.002);
  const doZisku = (nejdal((z) => odstup(z.cena) > 0) || zaloha) * 1.08;
  const doZtraty = (nejdal((z) => odstup(z.cena) < 0) || zaloha) * 1.08;

  const naProcenta = (cena) => {
    const d = odstup(cena);
    // Půlka proužku má 47 %, zbytek je rezerva na okraje, ať je čára vidět celá.
    const podil = d >= 0
      ? 50 + Math.min(1, d / doZisku) * 47
      : 50 - Math.min(1, -d / doZtraty) * 47;
    return Math.min(97, Math.max(3, podil));
  };

  const blok = document.createElement('div');
  blok.className = 'pos-ladder';

  /*
   * Nad proužkem se hýbe **jediná** věc: aktuální cena nad svým ukazatelem.
   * Vstup je napevno uprostřed, takže jeho cenu netřeba vozit s sebou —
   * stojí dole v legendě vedle SL a TP. Dvě čísla nahoře se navíc u čerstvě
   * otevřené pozice psala přes sebe.
   */
  const markProcenta = naProcenta(mark);

  const ceny = document.createElement('div');
  ceny.className = 'ladder-ceny';

  const cenovka = document.createElement('span');
  cenovka.className = `cena-mark ${odstup(mark) >= 0 ? 'plus' : 'minus'}`;
  cenovka.textContent = formatPrice(mark);
  cenovka.style.left = `${markProcenta}%`;
  // U kraje by popisek vytekl mimo kartu, tak se přisaje k okraji.
  if (markProcenta < 12) cenovka.style.transform = 'translateX(0)';
  else if (markProcenta > 88) cenovka.style.transform = 'translateX(-100%)';
  ceny.append(cenovka);
  blok.append(ceny);

  const drah = document.createElement('div');
  drah.className = 'ladder-track';

  const znacka = (cena, tridy) => {
    const s = document.createElement('span');
    s.className = tridy;
    s.style.left = `${naProcenta(cena)}%`;
    return s;
  };

  // Nejdřív příkazy, pak vstup a cena — ty musí zůstat navrchu.
  znacky.forEach((z) => {
    // Celá pozice (bez podílu) je silnější čára než dílčí příkaz.
    drah.append(znacka(z.cena, `tick ${z.druh}${z.podil === null ? ' cela' : ''}`));
  });
  drah.append(znacka(vstup, 'tick entry'));

  // Ukazatel má stejnou barvu jako číslo nad ním: zelená nad vstupem,
  // červená pod ním. Bílá čára o zisku neřekla nic.
  const ukazatel = document.createElement('span');
  ukazatel.className = `ladder-now ${odstup(mark) >= 0 ? 'plus' : 'minus'}`;
  ukazatel.style.left = `${markProcenta}%`;
  drah.append(ukazatel);

  blok.append(drah);

  /* pod proužkem: jak daleko je nejbližší SL a TP, a jak velká pozice je */
  const nejblizsi = (druh) => {
    const ceny = znacky.filter((z) => z.druh === druh).map((z) => z.cena);
    if (!ceny.length) return null;
    return ceny.reduce((a, b) => (Math.abs(a - mark) < Math.abs(b - mark) ? a : b));
  };

  const popisek = (druh, cena) => {
    const s = document.createElement('span');
    s.className = druh;
    if (cena === null) {
      s.textContent = `${t(`ladder.${druh}`)} —`;
      s.classList.add('chybi');
    } else {
      const vzdalenost = Math.abs((cena - mark) / mark) * 100;
      s.textContent = `${t(`ladder.${druh}`)} ${vzdalenost.toFixed(1)} %`;
    }
    return s;
  };

  const legenda = document.createElement('div');
  legenda.className = 'ladder-legend';

  // Vstup patří mezi SL a TP: všechno tři jsou pevné úrovně na proužku,
  // na rozdíl od ceny, která jezdí.
  const cenaVstupu = document.createElement('span');
  cenaVstupu.className = 'cena-vstup';
  cenaVstupu.textContent = `${t('position.entry')} ${formatPrice(vstup)}`;

  legenda.append(popisek('sl', nejblizsi('sl')), cenaVstupu, popisek('tp', nejblizsi('tp')));
  blok.append(legenda);

  /*
   * Druhý řádek: co ta úroveň znamená v penězích. Procenta říkají, jak je
   * daleko, ale o kolik přijdu nebo kolik vydělám, si z nich uživatel musí
   * počítat v hlavě — a právě podle téhle částky se rozhoduje.
   */
  const castky = document.createElement('div');
  castky.className = 'ladder-castky';

  const castka = (druh, cena) => {
    const s = document.createElement('span');
    s.className = druh;
    if (cena === null) {
      s.textContent = '';
      return s;
    }
    // Zisk či ztráta, kdyby pozice v téhle ceně skončila celá.
    const vysledek = (cena - vstup) * p.size * smer;
    s.textContent = hide ? MASK : `${formatSignedUsd(vysledek)} USDT`;
    return s;
  };

  castky.append(castka('sl', nejblizsi('sl')), castka('tp', nejblizsi('tp')));
  blok.append(castky);
  return blok;
}

function positionCard(p, hide, onSelect, liqThreshold = 10, volby = {}) {
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

  // Blízkost likvidace se počítá dřív — barví se podle ní hodnota
  // v hlavičce i celá karta.
  const distance = liquidationDistance(p);
  const blizko = distance !== null && Math.abs(distance) < liqThreshold;

  /* hlavička: pár + směr + hodnota + likvidace, vpravo PnL */
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

  /*
   * Velikost stojí drobným písmem v závorce hned za pákou. Vlastní řádek
   * pod názvem páru nesla jen chvíli (v0.16.2) — pro tři pozice na displeji
   * je každý ušetřený řádek znát víc než zarovnání.
   */
  const velikost = document.createElement('span');
  velikost.className = 'pos-size';
  if (hide) {
    velikost.textContent = `(${MASK})`;
  } else {
    const coin = /USD[TC]$/.test(p.symbol) ? p.symbol.slice(0, -4) : '';
    velikost.textContent = `(${formatSize(p.size)}${coin ? ` ${coin}` : ''}`
      + ` · ${formatUsd(p.value)} ${menaParu(p.symbol)})`;
  }

  /*
   * Likvidace patří k hodnotě pozice, ne do patičky k fundingu: obojí říká,
   * co se s penězi děje, a oko je pak najde na jednom místě. V patičce
   * navíc při čtyřech údajích za sebou zapadla.
   */
  const likvidace = document.createElement('span');
  likvidace.className = `pos-liq${blizko ? ' near' : ''}`;
  // ⚠ Krátký popisek: vedle ceny je jasné, o co jde, a plné „Liquidation"
  // na zavřeném displeji Foldu shodilo hlavičku na tři řádky.
  likvidace.textContent = `${t('position.liqShort')} `
    + (p.liq ? formatPrice(p.liq) : t('position.notSet'));

  // Víc připojených účtů (v0.59.0): u karty i burza.
  const burza = volby.burza?.(p);
  if (burza) {
    const stitek = document.createElement('span');
    stitek.className = 'pos-burza';
    stitek.textContent = burza;
    left.append(stitek);
  }
  left.append(symbol, badge, velikost, likvidace);

  /*
   * PnL bez ROE. Procento vedle částky bylo jen jinak vyjádřené totéž
   * a stálo celý řádek na každé kartě.
   */
  const pnl = document.createElement('div');
  pnl.className = `pos-pnl ${pnlClass(p.pnl)}`;
  pnl.textContent = hide ? MASK : `${formatSignedUsd(p.pnl)} ${menaParu(p.symbol)}`;

  head.append(left, pnl);

  /*
   * Mřížka s hodnotami je pryč. Vstup, mark cena i úrovně se čtou z proužku,
   * velikost a likvidace jsou v hlavičce — mřížka je jen opakovala o dva
   * řádky výš.
   */
  // Varování se propíše na celou kartu, ne jen na jedno číslo.
  card.classList.toggle('blizko-likvidace', blizko);

  card.append(head);

  const zebrik = volby.zebrik?.(p);
  if (zebrik) card.append(ladderRow(zebrik, p, hide));

  card.append(patickaRow(p, hide));
  // Deník obchodů (v0.61.0): souhrn poznámky nebo tlačítko „Why?".
  const denik = volby.denik?.(p);
  if (denik) card.append(denik);
  return card;
}

const PREHLED_UCTU_SKRYTY = true;

/*
 * Karta „Last 30 days" na Pozicích (v0.62.0, varianta C uživatele):
 * součet uzavřených obchodů všech účtů, počet uzavření, úspěšnost,
 * nejlepší, a křivka — schody průběžného součtu, tečka v místě každého
 * zavření. Ukazuje se, když je co ukázat: statistika, nebo pozice (kvůli
 * tlačítku řazení a filtru).
 */
let stat30Data = null;

function viditelnostStat30() {
  // Řádek 30 dní, jakmile je statistika (i prázdná: „žádný obchod").
  skryj(dom.stat30, !stat30Data);
}

export function renderStat30(data, hide) {
  stat30Data = data;
  viditelnostStat30();
  if (!dom.stat30) return;
  const body = data?.body || [];
  if (!body.length) {
    nastavText(dom.stat30Pnl, data ? '—' : '');
    dom.stat30Pnl.className = 'stat30-pnl';
    nastavText(dom.stat30Detail, data ? t('stats.none') : '');
    dom.stat30Graf.replaceChildren();
    return;
  }
  const soucet = body.reduce((s, b) => s + b.pnl, 0);
  // Celé obchody, ne jednotlivá zavření (v0.62.1, přání uživatele):
  // částečná zavření téže pozice se sečtou (`obchod` z app.js).
  const obchody = new Map();
  body.forEach((b) => obchody.set(b.obchod, (obchody.get(b.obchod) || 0) + b.pnl));
  const vysledky = [...obchody.values()];
  const vyhry = vysledky.filter((v) => v > 0).length;
  const nejlepsi = Math.max(...vysledky);
  dom.stat30Pnl.textContent = hide ? MASK : formatSignedUsd(soucet);
  dom.stat30Pnl.className = `stat30-pnl ${pnlClass(soucet)}`;
  const nejlepsiTxt = document.createElement('span');
  nejlepsiTxt.className = 'stat30-best';
  nejlepsiTxt.textContent = ` · ${t('stats.best', { best: hide ? MASK : formatSignedUsd(nejlepsi) })}`;
  dom.stat30Detail.replaceChildren(t('stats.detail', {
    n: vysledky.length,
    win: Math.round((vyhry / vysledky.length) * 100),
  }), nejlepsiTxt);
  kresliKrivku30(body, data.od, data.do);
}

/** Při změně šířky (přeložení Foldu) křivku překreslit. */
export function prekresliStat30() {
  if (stat30Data?.body?.length) kresliKrivku30(stat30Data.body, stat30Data.od, stat30Data.do);
}

function kresliKrivku30(body, od, doKdy) {
  const svg = dom.stat30Graf;
  const w = Math.max(30, Math.round(svg.getBoundingClientRect().width) || 56);
  const h = 22;
  /*
   * Plynulá křivka jako v dlaždici Watchlists (v0.62.1, přání uživatele —
   * schody s tečkou za každé zavření vypadaly špatně). Průběžný součet se
   * vede přímo mezi zavřeními, vzorkuje rovnoměrně a vyhladí stejnou monotónní interpolací jako mini-graf;
   * barva podle součtu za 30 dní, pod křivkou výplň do ztracena.
   */
  // Body: začátek okna (0), každé zavření (průběžný součet), konec okna.
  // Mezi nimi přímo, vzorkované rovnoměrně — schody působily neklidně.
  const serazene = [...body].sort((p, q) => p.t - q.t);
  let kum = 0;
  const uzly = [{ t: od, v: 0 }];
  serazene.forEach((b) => uzly.push({ t: Math.max(od, Math.min(doKdy, b.t)), v: (kum += b.pnl) }));
  uzly.push({ t: doKdy, v: kum });
  const POCET = 48;
  const vzorky = [];
  let j = 0;
  for (let k = 0; k <= POCET; k += 1) {
    const cas = od + ((doKdy - od) * k) / POCET;
    while (j < uzly.length - 2 && uzly[j + 1].t <= cas) j += 1;
    const [a, b] = [uzly[j], uzly[j + 1]];
    const podil = b.t > a.t ? Math.min(1, Math.max(0, (cas - a.t) / (b.t - a.t))) : 1;
    vzorky.push(a.v + (b.v - a.v) * podil);
  }
  const min = Math.min(...vzorky);
  const max = Math.max(...vzorky);
  const rozpeti = max - min || 1;
  const nahore = 2;
  const dole = h - 3;
  const ys = vzorky.map((v) => dole - ((v - min) / rozpeti) * (dole - nahore));
  const dx = w / (vzorky.length - 1);
  const krivka = hladkaKrivka(ys, dx);
  const prvek = (tag, atributy) => {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(atributy).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  };
  const prechod = prvek('linearGradient', { id: 'stat30-prechod', x1: 0, y1: 0, x2: 0, y2: 1 });
  prechod.append(
    prvek('stop', { offset: 0, class: 'spark-stop-horni' }),
    prvek('stop', { offset: 1, class: 'spark-stop-dolni' }),
  );
  const defs = prvek('defs', {});
  defs.append(prechod);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.classList.toggle('up', kum >= 0);
  svg.classList.toggle('down', kum < 0);
  svg.replaceChildren(
    defs,
    prvek('path', { d: `${krivka} L${w},${h} L0,${h} Z`, class: 'spark-plocha', fill: 'url(#stat30-prechod)' }),
    prvek('path', { d: krivka, class: 'spark-cara stat30-cara' }),
  );
}

/** Měna páru pro popisky: „BTCUSDC" → USDC, jinak USDT (v0.59.1). */
const menaParu = (symbol) => (String(symbol || '').endsWith('USDC') ? 'USDC' : 'USDT');

export function renderPositions(list, hide, onSelect, liqThreshold = 10, volby = {}) {
  dom.list.replaceChildren(
    ...list.map((p) => positionCard(p, hide, onSelect, liqThreshold, volby)),
  );

  const total = list.reduce((sum, p) => sum + p.pnl, 0);
  dom.totalPnl.textContent = hide ? MASK : `${formatSignedUsd(total)} USDT`;
  dom.totalPnl.className = `summary-value ${pnlClass(total)}`;
  dom.totalCount.textContent = t('positions.countShort', { n: list.length });

  const hasPositions = list.length > 0;
  dom.summary.hidden = !hasPositions;
  dom.placeholder.hidden = hasPositions;
  if (!hasPositions) {
    dom.placeholderText.textContent = t('positions.none');
    dom.placeholderBtn.hidden = true;
  }
}

/**
 * Načítání pozic: tiché obrysy karet místo textu „Loading…", tlačítka
 * a diagnostiky. Při startu to trvá zlomek vteřiny a text s tlačítkem
 * jen probleskl a vypadal jako chyba (hlášeno z telefonu, v0.24.1).
 */
export function showLoading() {
  showPlaceholder('');
  dom.placeholder.classList.add('nacitani');
}

export function showPlaceholder(text, buttonLabel = null) {
  dom.placeholder.classList.remove('nacitani');
  dom.list.replaceChildren();
  dom.summary.hidden = true;
  skryj(dom.accountSummary, true);
  skryj(dom.accountNote, true);
  skryj(dom.positionTools, true);
  skryj(dom.stat30, true);
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
  // Dáno bokem (v0.62.0, rozhodnutí uživatele): součet Equity / Free /
  // Margin přes víc účtů nedával smysl a bral místo. Kód zůstává, možná
  // se přehled hodí jinde (Nastavení → Burzy, u každého účtu).
  if (PREHLED_UCTU_SKRYTY) {
    skryj(dom.accountSummary, true);
    skryj(dom.accountNote, true);
    return;
  }
  const mame = Boolean(ucet);
  skryj(dom.accountSummary, !mame);
  skryj(dom.accountNote, mame || !chyba);

  if (!mame) {
    if (chyba) nastavText(dom.accountNote, t('account.needsWallet'));
    return;
  }

  /*
   * Bez „USDT" u každého čísla — účet je v USDT celý, opakovat to třikrát
   * na jednom řádku znamená, že se ten řádek zalomí na dva a celý smysl
   * úspory místa je pryč. U PnL nahoře jednotka zůstává, tam je řádek sám.
   */
  nastavText(dom.accEquity, hide ? MASK : formatUsd(ucet.equity));
  nastavText(dom.accAvailable, hide ? MASK : formatUsd(ucet.volny));
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
  // Od v0.62.0 pod tlačítkem v kartě statistiky (`stav.otevreno`).
  // Tlačítko je prostě filtr (v0.62.1, uživatel): svítí jen rozbalené,
  // tečka za nevýchozí volbu zmizela (svítila pořád).
  skryj(dom.positionToolsBtn, !stav.viditelne);
  if (dom.positionToolsBtn) {
    dom.positionToolsBtn.classList.toggle('aktivni', Boolean(stav.otevreno && stav.viditelne));
    dom.positionToolsBtn.setAttribute('aria-expanded', String(Boolean(stav.otevreno && stav.viditelne)));
  }
  skryj(dom.positionTools, !(stav.viditelne && stav.otevreno));
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

/** Stav spojení: idle / connecting / live / error (i pro dotazování). */
export function stavSpojeni(status) {
  // Burzy přes CCXT nemají WebSocket, data chodí dotazováním (`poll`):
  // spojení je živé, když poslední dotaz prošel (dřív „Not connected").
  const ws = status?.ws === 'poll'
    ? (status.rest === 'error' ? 'error' : status.lastUpdate || status.rest === 'ok' ? 'live' : 'connecting')
    : status?.ws;
  return STATUS_TRIDA[ws] === undefined ? 'idle' : (ws === 'reconnecting' ? 'connecting' : ws);
}

export function renderStatus(status) {
  const stav = stavSpojeni(status);
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
  if (dom.viewAlerts) dom.viewAlerts.hidden = name !== 'alerts';
  dom.viewSettings.hidden = name !== 'settings';
  // V nastavení záložky nedávají smysl, je to odbočka mimo hlavní obrazovku.
  dom.tabs.hidden = name === 'settings';
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  window.scrollTo(0, 0);
}

/* ---------- přehled alarmů (v0.63.0) ---------- */

/** „5 m", „3 h", „2 d" — jak dávno alarm zazněl. */
function predChvili(ms) {
  const minuty = Math.max(1, Math.round(ms / 60000));
  if (minuty < 60) return `${minuty} m`;
  if (minuty < 2880) return `${Math.round(minuty / 60)} h`;
  return `${Math.round(minuty / 1440)} d`;
}

const IKONA_KOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

/**
 * Smazání na dvě klepnutí: první ukáže „Smazat?", druhé (do 3 s) smaže.
 * confirm() ve WebView nechceme a přejetí řádku by se bilo s přejížděním
 * mezi záložkami.
 */
function dvojKlepnuti(tlacitko, popisPotvrzeni, akce, obnovit) {
  let casovac = null;
  tlacitko.addEventListener('click', (e) => {
    e.stopPropagation();
    if (tlacitko.classList.contains('potvrdit')) {
      clearTimeout(casovac);
      akce();
      return;
    }
    tlacitko.classList.add('potvrdit');
    tlacitko.textContent = popisPotvrzeni;
    casovac = setTimeout(() => {
      tlacitko.classList.remove('potvrdit');
      obnovit();
    }, 3000);
  });
}

/**
 * Seznam alarmů. `polozky` připravuje app.js (pár, burza, hladina,
 * vzdálenost od ceny…), tady se jen kreslí.
 */
export function renderAlerts({ rezim, polozky, onOpen, onToggle, onDelete, onClearAll }) {
  const seznam = document.getElementById('alertsList');
  const prazdno = document.getElementById('alertsEmpty');
  const smazatVse = document.getElementById('alertsClear');
  if (!seznam) return;
  const ted = Date.now();
  seznam.replaceChildren(...polozky.map((a) => {
    const radek = document.createElement('div');
    radek.className = `alert-row${a.aktivni ? '' : ' vypnuty'}`;
    radek.dataset.id = a.id;
    radek.setAttribute('role', 'button');

    const hlava = document.createElement('div');
    hlava.className = 'alert-hlava';
    const par = document.createElement('span');
    par.className = 'alert-par';
    par.textContent = a.par;
    const burza = document.createElement('span');
    burza.className = 'alert-burza';
    burza.textContent = a.burza;
    const hladina = document.createElement('span');
    hladina.className = 'alert-hladina';
    hladina.textContent = a.hladina;
    hlava.append(par, burza, hladina);

    const akce = document.createElement('div');
    akce.className = 'alert-akce';
    const prepinac = document.createElement('button');
    prepinac.type = 'button';
    prepinac.className = `nastaveni-prepinac${a.aktivni ? ' on' : ''}`;
    prepinac.setAttribute('aria-pressed', String(a.aktivni));
    prepinac.setAttribute('aria-label', t('alerts.toggle'));
    prepinac.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggle(a.id);
    });
    const kos = document.createElement('button');
    kos.type = 'button';
    kos.className = 'alert-smazat';
    kos.setAttribute('aria-label', t('alerts.delete'));
    const ikona = () => { kos.innerHTML = IKONA_KOSE; };
    ikona();
    dvojKlepnuti(kos, t('alerts.deleteConfirm'), () => onDelete(a.id), ikona);
    akce.append(prepinac, kos);

    const detail = document.createElement('div');
    detail.className = 'alert-detail';
    const kus = (text, trida = '') => {
      const s = document.createElement('span');
      if (trida) s.className = trida;
      s.textContent = text;
      detail.append(s);
    };
    if (a.podminka) kus(a.podminka);
    if (a.typ !== 'cas') kus(a.opakovat ? t('alerts.repeat') : t('alerts.once'));
    if (a.aktivni && Number.isFinite(a.vzdalenost)) {
      kus(t('alerts.fromPrice', { pct: formatPercent(a.vzdalenost) }), a.vzdalenost >= 0 ? 'nahoru' : 'dolu');
    }
    if (!a.aktivni) {
      kus(a.spusteno ? t('alerts.fired', { ago: t('alerts.ago', { kdy: predChvili(ted - a.spusteno) }) }) : t('alerts.off'));
    }
    radek.append(hlava, akce, detail);
    if (a.zprava) {
      const zprava = document.createElement('div');
      zprava.className = 'alert-zprava';
      zprava.textContent = `„${a.zprava}“`;
      radek.append(zprava);
    }
    radek.addEventListener('click', () => onOpen(a.id));
    return radek;
  }));

  if (prazdno) {
    prazdno.hidden = polozky.length > 0;
    prazdno.textContent = t(rezim === 'active' ? 'alerts.emptyActive' : 'alerts.emptyInactive');
  }
  if (smazatVse) {
    smazatVse.hidden = rezim !== 'inactive' || !polozky.length;
    smazatVse.classList.remove('potvrdit');
    smazatVse.textContent = t('alerts.clearAll', { n: polozky.length });
    // Posluchač jen jednou; počet a akce se berou z posledního vykreslení.
    smazatVse.onAkce = onClearAll;
    smazatVse.pocet = polozky.length;
    if (!smazatVse.zapojeno) {
      smazatVse.zapojeno = true;
      let casovac = null;
      smazatVse.addEventListener('click', () => {
        if (smazatVse.classList.contains('potvrdit')) {
          clearTimeout(casovac);
          smazatVse.onAkce?.();
          return;
        }
        smazatVse.classList.add('potvrdit');
        smazatVse.textContent = t('alerts.clearConfirm', { n: smazatVse.pocet });
        casovac = setTimeout(() => {
          smazatVse.classList.remove('potvrdit');
          smazatVse.textContent = t('alerts.clearAll', { n: smazatVse.pocet });
        }, 4000);
      });
    }
  }
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

/*
 * Obchod v Historii (v0.38.0, zjednodušeno v0.38.1 — bylo moc textu):
 * hlavička (pár, směr, Open), pod ní jen data „24.12.2026 → 26.12.2026"
 * (nebo „→ Open"), pak **jeden řádek na výstup**:
 *   1,000 JUP (336 USD) → 0.335 (+3.1 %) ........ +20.40
 * a dole podtržený součet.
 */
const datum = (ts) => {
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
};

export function renderHistory(skupiny, hide, onSelect, volby = {}) {
  const el2 = (tag, trida, text = '') => {
    const e = document.createElement(tag);
    if (trida) e.className = trida;
    if (text) e.textContent = text;
    return e;
  };
  dom.historyList.replaceChildren(
    ...skupiny.map((g) => {
      const karta = el2('article', `trade ${g.long ? 'long' : 'short'}${g.otevrena ? ' otevreny' : ''}`);
      karta.setAttribute('role', 'button');
      karta.tabIndex = 0;

      const hlava = el2('div', 'trade-head');
      const vlevo = el2('div', 'trade-titul');
      const odznak = el2('span', `badge ${g.long ? 'long' : 'short'}`,
        t(g.long ? 'position.long' : 'position.short') + (g.leverage ? ` ${formatSize(g.leverage)}×` : ''));
      vlevo.append(el2('span', 'trade-symbol', g.symbol), odznak);
      if (g.otevrena) vlevo.append(el2('span', 'badge trade-otevreny', t('history.open')));
      // Víc účtů v deníku (v0.64.0): štítek účtu jako na kartě pozice.
      if (g.stitek) vlevo.append(el2('span', 'pos-burza', g.stitek));
      hlava.append(vlevo);

      const mena = g.symbol.replace(/USDT$|USDC$/, '');
      const kdy = el2('div', 'trade-when',
        [g.otevreno ? datum(g.otevreno) : '', g.zavreno ? datum(g.zavreno) : t('history.open')]
          .filter(Boolean).join('  →  '));

      /*
       * Výstupy O1, O2… v pořadí zavírání (jako popisky v prohlídce grafu),
       * každý **před poplatky** — (výstup − vstup) × množství. Rozdíl proti
       * součtu burzy je poslední ztlumený řádek „Fees" (u Bybitu „Fees &
       * funding", jeho closedPnl je po obojím). Rozhodnutí uživatele
       * 2026-10-18 (varianta C): Total zůstává číslo, které ukazuje burza.
       */
      const vystupy = el2('div', 'trade-vystupy');
      const smer = g.long ? 1 : -1;
      let hrubeCelkem = 0;
      let hrubeZnamo = true;
      g.vystupy.forEach((z, i) => {
        const radek = el2('div', 'trade-vystup');
        const pct = z.entry ? ((z.exit / z.entry - 1) * 100 * smer) : null;
        const hrube = z.entry > 0 && Number.isFinite(z.exit) ? (z.exit - z.entry) * z.qty * smer : null;
        if (hrube === null) hrubeZnamo = false;
        else hrubeCelkem += hrube;
        const castka = hrube ?? z.pnl;
        const velikost = hide ? MASK : `${formatSize(z.qty)} ${mena} (${formatSize(Math.round(z.qty * z.exit))} USD)`;
        radek.append(
          el2('span', 'tv-o', `O${i + 1}`),
          el2('span', 'tv-text', `${velikost} → ${formatPrice(z.exit)}`
            + (pct !== null ? ` (${formatPercent(pct, 1)})` : '')),
          el2('span', `tv-pnl ${pnlClass(castka)}`, hide ? MASK : formatSignedUsd(castka)),
        );
        vystupy.append(radek);
      });
      const poplatky = g.pnl - hrubeCelkem;
      if (hrubeZnamo && Math.abs(poplatky) >= 0.005) {
        const radek = el2('div', 'trade-vystup trade-poplatky');
        radek.append(
          el2('span', 'tv-text', t(g.sFundingem ? 'history.feesFunding' : 'history.fees')),
          el2('span', 'tv-pnl', hide ? MASK : formatSignedUsd(poplatky)),
        );
        vystupy.append(radek);
      }

      const soucet = el2('div', 'trade-soucet');
      soucet.append(el2('span', '', t('history.total')),
        el2('span', `trade-pnl ${pnlClass(g.pnl)}`, hide ? MASK : `${formatSignedUsd(g.pnl)} ${menaParu(g.symbol)}`));

      karta.append(hlava, kdy, vystupy, soucet);
      // Deník obchodů (v0.61.0): poznámky a zhodnocení obchodu.
      const denik = volby.denik?.(g);
      if (denik) karta.append(denik);
      karta.addEventListener('click', () => onSelect(g));
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
// Záložka (bookmark) místo hvězdičky: „přidat do seznamu", ne „oblíbené".
const ZALOZKA = 'M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z';
const ZALOZKA_PLUS = 'M12 7.5v6M9 10.5h6';

/** Hodnota pod názvem páru podle řazení (změna 24h má vlastní sloupec). */
function textMetriky(trh, metrika) {
  if (metrika === 'funding') return `${t('sort.fundingShort')} ${formatPercent(trh.funding, 4)}`;
  if (metrika === 'oi') return `${t('sort.oiShort')} ${zkratkaObratu(trh.openInterest)}`;
  return zkratkaObratu(trh.turnover);
}

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
/**
 * Seznam trhů. `veSestave(symbol)` rozhoduje o plné záložce, `popisek(symbol)`
 * je krátký text za metrikou (kategorie coinu). `metrika` je klíč řazení —
 * pod názvem páru stojí hodnota, podle které se řadí.
 */
export function renderWatchlist(radky, veSestave, onSelect, onToggleFav, delic = null, popisek = null, metrika = 'volume') {
  dom.watchList.classList.remove('tiles', 'siroke', 'mrizka');
  const prvky = [];
  const vytvorRadek = (trh) => {
    const radek = document.createElement('div');
    radek.className = 'watch-row';
    radek.dataset.symbol = trh.symbol;

    const hvezda = document.createElement('button');
    hvezda.type = 'button';
    hvezda.className = `watch-star ${veSestave(trh.symbol) ? 'on' : ''}`.trim();
    hvezda.setAttribute('aria-label', t('lists.addTo'));
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const vSeznamu = veSestave(trh.symbol);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ZALOZKA);
    svg.append(path);
    if (!vSeznamu) {
      const plus = document.createElementNS(SVG_NS, 'path');
      plus.setAttribute('d', ZALOZKA_PLUS);
      plus.setAttribute('class', 'plus');
      svg.append(plus);
    }
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
    const znacka = popisek ? popisek(trh.symbol) : '';
    const hodnota = textMetriky(trh, metrika);
    obrat.textContent = [hodnota, znacka].filter(Boolean).join(' · ');
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

/*
 * Trhy jako dlaždice (v0.36.0, podle TabTraderu). Dvě rozložení:
 * `mrizka` — dvě a víc dlaždic vedle sebe, `siroke` — přes celou šířku.
 * Na dlaždici: burza, pár, metrika řazení / kategorie, mini-graf, cena,
 * změna 24 h a vlevo dole hodnota otevřené pozice (když na páru je).
 * `veSestave` + `onToggleFav` jen v „All" (záložka pro přidání do seznamu);
 * ve vlastním seznamu se odebírá podržením dlaždice.
 */
/** Název aktivní burzy pro dlaždice a hledání (v0.54.0). */
let nazevBurzy = 'BYBIT';
export function nastavNazevBurzy(nazev) {
  nazevBurzy = String(nazev || 'Bybit').toUpperCase();
}

export function renderTiles(trhy, volby) {
  const { siroke, veSestave, onSelect, onToggleFav, popisek, metrika = 'volume', pozice, hide, nazevBurzy: nazevPodle } = volby;
  // Jen třídy rozložení — `lze-presouvat` nastavuje app.js a nesmí zmizet.
  dom.watchList.classList.add('tiles');
  dom.watchList.classList.toggle('siroke', Boolean(siroke));
  dom.watchList.classList.toggle('mrizka', !siroke);
  const div = (trida, text = '') => {
    const e = document.createElement('div');
    e.className = trida;
    if (text) e.textContent = text;
    return e;
  };
  const prvky = trhy.map((trh) => {
    const d = div('tile');
    d.dataset.symbol = trh.symbol;
    if (trh.klic) d.dataset.klic = trh.klic;
    const poz = pozice?.get(trh.klic || trh.symbol);
    if (poz) d.classList.add(poz.side === 'Sell' ? 'tile-short' : 'tile-long');

    /*
     * Rozvržení (v0.59.14, návrh uživatele): nahoře jemně podbarvená
     * hlavička — vlevo pár a pod ním burza, vpravo kategorie coinu
     * a hodnota pozice; zbytek dlaždice je graf s výplní a vpravo dole
     * cena se změnou. Objem se ve vlastním seznamu neukazuje (jen metrika
     * řazení v „All").
     */
    const sub = [onToggleFav ? textMetriky(trh, metrika) : '', popisek ? popisek(trh.symbol) : ''].filter(Boolean).join(' · ');
    const spark = document.createElementNS(SVG_NS, 'svg');
    spark.setAttribute('class', 'watch-spark tile-spark');
    spark.setAttribute('viewBox', '0 0 58 24');
    spark.setAttribute('preserveAspectRatio', 'none');
    const zmena = div(`tile-zmena ${pnlClass(trh.changePct)}`, formatPercent(trh.changePct));
    const hodnota = div(`tile-poz ${poz ? pnlClass(poz.pnl) : ''}`.trim(),
      poz ? (hide ? MASK : `${formatUsd(poz.value)} ${menaParu(poz.symbol)}`) : '');

    const vlevo = div('tile-vlevo');
    vlevo.append(div('tile-par', trh.symbol), div('tile-burza', String(nazevPodle?.(trh.burza) || nazevBurzy).toUpperCase()));
    const vpravo = div('tile-vpravo');
    vpravo.append(div('tile-sub', sub), hodnota);
    const hlava = div('tile-hlava');
    hlava.append(vlevo, vpravo);
    const cena = div('tile-cenovka');
    cena.append(div('tile-cena', formatPrice(trh.last)), zmena);
    const telo = div('tile-telo');
    telo.append(spark, cena);
    d.append(hlava, telo);

    if (onToggleFav) {
      const hvezda = document.createElement('button');
      hvezda.type = 'button';
      hvezda.className = `watch-star tile-star ${veSestave?.(trh.symbol) ? 'on' : ''}`.trim();
      hvezda.setAttribute('aria-label', t('lists.addTo'));
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', ZALOZKA);
      svg.append(path);
      if (!veSestave?.(trh.symbol)) {
        const plus = document.createElementNS(SVG_NS, 'path');
        plus.setAttribute('d', ZALOZKA_PLUS);
        plus.setAttribute('class', 'plus');
        svg.append(plus);
      }
      hvezda.append(svg);
      hvezda.addEventListener('click', (e) => {
        e.stopPropagation();
        onToggleFav(trh.symbol);
      });
      d.append(hvezda);
    }
    d.addEventListener('click', () => {
      if (d.dataset.potlacKlik) { delete d.dataset.potlacKlik; return; }
      onSelect(trh);
    });
    return d;
  });
  dom.watchList.replaceChildren(...prvky);
  return prvky;
}

/**
 * Živá změna ceny v dlaždici (v0.49.0): přepíše jen cenu, změnu za 24 h
 * a hodnotu pozice — dlaždice se nestaví znovu (držení a přesouvání,
 * mini-graf ani posun stránky se tím neruší).
 */
export function updateTile(dlazdice, trh, poz, hide) {
  const cena = dlazdice.querySelector('.tile-cena');
  if (cena) cena.textContent = formatPrice(trh.last);
  const zmena = dlazdice.querySelector('.tile-zmena');
  if (zmena) {
    zmena.textContent = formatPercent(trh.changePct);
    zmena.className = `tile-zmena ${pnlClass(trh.changePct)}`;
  }
  const hodnota = dlazdice.querySelector('.tile-poz');
  if (hodnota) {
    hodnota.textContent = poz ? (hide ? MASK : `${formatUsd(poz.value)} ${menaParu(poz.symbol)}`) : '';
    hodnota.className = `tile-poz ${poz ? pnlClass(poz.pnl) : ''}`.trim();
  }
}

/**
 * Výsledky hledání v nabídce „+" (přidání páru do seznamu): široké řádky
 * s burzou, objemem, cenou a změnou; přidané páry mají fajfku.
 */
export function renderPairSearch(kontejner, trhy, { jeVSeznamu, onPick, nazevBurzy: nazevPodle }) {
  kontejner.replaceChildren(...trhy.map((trh) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `pair-hit ${jeVSeznamu(trh.klic || trh.symbol) ? 'pridano' : ''}`.trim();
    if (trh.klic) b.dataset.klic = trh.klic;
    b.dataset.symbol = trh.symbol;
    const vlevo = document.createElement('div');
    vlevo.className = 'pair-hit-vlevo';
    const par = document.createElement('div');
    par.className = 'pair-hit-par';
    par.textContent = trh.symbol;
    const sub = document.createElement('div');
    sub.className = 'pair-hit-sub';
    sub.textContent = `${String(nazevPodle?.(trh.burza) || nazevBurzy).toUpperCase()} · Perp · ${t('chart.vol24h')} ${zkratkaObratu(trh.turnover) || '—'}`;
    vlevo.append(par, sub);
    const vpravo = document.createElement('div');
    vpravo.className = 'pair-hit-vpravo';
    const cena = document.createElement('div');
    cena.textContent = formatPrice(trh.last);
    const zmena = document.createElement('div');
    zmena.className = pnlClass(trh.changePct);
    zmena.textContent = formatPercent(trh.changePct);
    vpravo.append(cena, zmena);
    const znak = document.createElement('span');
    znak.className = 'pair-hit-znak';
    znak.textContent = jeVSeznamu(trh.symbol) ? '✓' : '+';
    b.append(vlevo, vpravo, znak);
    b.addEventListener('click', () => onPick(trh, b));
    return b;
  }));
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

let citacSparku = 0;

/*
 * Vyhlazená křivka (v0.59.15, přání uživatele — bez ostrých vrcholů):
 * monotónní kubická interpolace (Fritsch–Carlson). Na rozdíl od obyčejné
 * spline nepřestřelí — vrchol křivky je pořád skutečné maximum, nevznikne
 * hrb nad nejvyšší cenou. `ys` v souřadnicích SVG, body po `dx`.
 */
function hladkaKrivka(ys, dx) {
  const n = ys.length;
  const f = (v) => v.toFixed(2);
  if (n < 2) return `M0,${f(ys[0] ?? 0)}`;
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / dx);
  const m = ys.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    return d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  });
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let cesta = `M0,${f(ys[0])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const x0 = i * dx;
    const x1 = x0 + dx;
    cesta += ` C${f(x0 + dx / 3)},${f(ys[i] + (m[i] * dx) / 3)} ${f(x1 - dx / 3)},${f(ys[i + 1] - (m[i + 1] * dx) / 3)} ${f(x1)},${f(ys[i + 1])}`;
  }
  return cesta;
}

/** Mini-graf trendu za 24 h. Zelený, když cena skončila výš než začala. */
export function drawSparkline(radek, hodnoty) {
  const svg = radek.querySelector('.watch-spark');
  if (!svg || !hodnoty?.length) return;

  const min = Math.min(...hodnoty);
  const max = Math.max(...hodnoty);
  const rozsah = max - min || 1;
  const krok = hodnoty.length > 1 ? 58 / (hodnoty.length - 1) : 58;
  // V dlaždici vede křivka jen horní částí grafu a pod ní je výplň —
  // cena vpravo dole pak leží na výplni, ne přes křivku (jako Coinbase).
  const dole = svg.classList.contains('tile-spark') ? 12 : 22;

  const ys = hodnoty.map((v) => dole - ((v - min) / rozsah) * (dole - 1));
  const krivka = hladkaKrivka(ys, krok);
  const konecX = ((hodnoty.length - 1) * krok).toFixed(2);

  const cara = document.createElementNS(SVG_NS, 'path');
  cara.setAttribute('d', krivka);
  cara.setAttribute('class', 'spark-cara');
  /*
   * Výplň pod křivkou s přechodem do ztracena (v0.59.14, podle snímku
   * uživatele). Přechod má vlastní id v každém grafu — sdílené id by
   * při překreslení jednoho grafu sebralo barvu ostatním.
   */
  const id = `spark-${++citacSparku}`;
  const defs = document.createElementNS(SVG_NS, 'defs');
  const prechod = document.createElementNS(SVG_NS, 'linearGradient');
  prechod.setAttribute('id', id);
  prechod.setAttribute('x1', '0');
  prechod.setAttribute('y1', '0');
  prechod.setAttribute('x2', '0');
  prechod.setAttribute('y2', '1');
  for (const [offset, tridaZastavky] of [['0', 'spark-stop-horni'], ['1', 'spark-stop-dolni']]) {
    const z = document.createElementNS(SVG_NS, 'stop');
    z.setAttribute('offset', offset);
    z.setAttribute('class', tridaZastavky);
    prechod.append(z);
  }
  defs.append(prechod);
  const plocha = document.createElementNS(SVG_NS, 'path');
  plocha.setAttribute('d', `${krivka} L${konecX},24 L0,24 Z`);
  plocha.setAttribute('class', 'spark-plocha');
  plocha.setAttribute('fill', `url(#${id})`);
  svg.replaceChildren(defs, plocha, cara);
  // ⚠ classList, ne přepsání `class` — dlaždice nese i `tile-spark`
  // a s ním svou velikost (dřív se přepisem ztratila a graf byl malý).
  const roste = hodnoty[hodnoty.length - 1] >= hodnoty[0];
  svg.classList.toggle('up', roste);
  svg.classList.toggle('down', !roste);
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
  // Pruh pod systémovými tlačítky má v grafu barvu spodní lišty (CSS).
  document.documentElement.classList.toggle('graf-otevreny', Boolean(visible));
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
  // PnL a vedle ROE (2026-10-03: mřížka údajů nad grafem zmizela).
  const ret = returnPercent(position);
  // Dvě části, aby se na úzkém displeji mohly dát pod sebe (CSS).
  const castka = document.createElement('span');
  castka.textContent = hide ? MASK : `${formatSignedUsd(position.pnl)} ${menaParu(position.symbol)}`;
  const procenta = document.createElement('span');
  procenta.textContent = ret ? formatPercent(ret.value) : '';
  dom.chartPnl.replaceChildren(castka, procenta);
}

/**
 * Panel pod grafem. Nahradil legendu — ta jen opakovala hodnoty, které graf
 * sám píše na cenovou osu.
 */
export function renderChartInfo(position, hide, burza = '', obrat24h = null) {
  /*
   * Jeden tenký řádek místo mřížky 3 × 3 (2026-10-03, přání uživatele —
   * zabírala čtvrtinu výšky a vstup, mark, SL a TP stejně stojí v grafu):
   * burza a typ účtu, velikost v coinu a v USDT, margin, objem za 24 h.
   * Likvidace odsud zmizela (2026-10-05) — má čáru a cenovku v grafu.
   * Objem je **za 24 h v USDT**, ne za svíčku: nemění se s timeframem
   * a jde porovnat mezi páry (stejné číslo jako v Trzích). Bez pozice
   * zůstane řádek s burzou a objemem.
   */
  const vol = Number.isFinite(obrat24h) && obrat24h > 0 ? obrat24h : null;
  // S burzou vždy vidět (v0.62.0): řádek dřív naskočil až s objemem
  // a celý graf poskočil dolů (video uživatele z prohlídky obchodu).
  dom.chartInfo.hidden = !position && !vol && !burza;
  if (dom.chartInfo.hidden) return;

  const mena = String(position?.symbol || '').replace(/USDT$|USDC$/, '');
  const margin = position?.leverage && position?.value ? position.value / position.leverage : null;
  const kus = (text, trida = '') => {
    const s = document.createElement('span');
    s.className = `ci ${trida}`.trim();
    s.textContent = text;
    return s;
  };
  const casti = [];
  if (burza) {
    const b = kus(burza, 'ci-burza');
    const tecka = document.createElement('i');
    tecka.className = 'ci-tecka';
    b.prepend(tecka);
    casti.push(b);
  }
  if (position) {
    casti.push(kus(hide ? MASK : `${formatSize(position.size)} ${mena} · ${formatUsd(position.value)} ${menaParu(position.symbol)}`));
    if (margin) casti.push(kus(`${t('position.margin')} ${hide ? MASK : formatUsd(margin)}`));
  }
  if (vol) casti.push(kus(`${t('chart.vol24h')} ${zkratkaObratu(vol)}`, 'ci-vol'));
  dom.chartInfo.replaceChildren(...casti);
}

export function showChartError(message) {
  dom.chartError.hidden = !message;
  if (message) dom.chartError.textContent = message;
}

/*
 * Timeframy (v0.37.0, přání uživatele): lišta se volně posouvá prstem
 * v pevném pořadí 1m → 1M a vybraný timeframe se vystředí v ploše mezi
 * levým okrajem a tlačítkem zpět. Mezery na koncích lišty (CSS) dovolí
 * vystředit i první a poslední. (Kolotoč s přeskládáváním z v0.32.0
 * zrušen — za 1M následovalo 1m a lišta se nedala rozumně posouvat.)
 */
export function setActiveInterval(interval) {
  document.querySelectorAll('.interval-btn[data-interval]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.interval === interval);
  });
  vycentrujInterval(true);
}

/** Posune lištu timeframů tak, aby aktivní byl uprostřed viditelné části. */
export function vycentrujInterval(plynule = false) {
  /*
   * Od v0.50.1 (přání uživatele) se vybraný timeframe **nestředí** a na
   * koncích lišty nejsou prázdné mezery — lišta se posune jen tolik, aby
   * byl vybraný celý vidět. (Název funkce zůstal kvůli volajícím.)
   */
  const box = document.getElementById('intervals');
  const aktivni = box?.querySelector('.interval-btn.active');
  if (!aktivni) return;
  requestAnimationFrame(() => {
    const r = box.getBoundingClientRect();
    const a = aktivni.getBoundingClientRect();
    if (!r.width) return;
    const okraj = 8;
    let posun = 0;
    if (a.left < r.left + okraj) posun = a.left - r.left - okraj;
    else if (a.right > r.right - okraj) posun = a.right - r.right + okraj;
    if (posun) box.scrollTo({ left: box.scrollLeft + posun, behavior: plynule ? 'smooth' : 'auto' });
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

/**
 * Obsah lišty nové verze: číslo verze v titulku a seznam „Co je nového"
 * (novinky nahoře, opravy pod nimi tlumeně). `poznamky` = novinky.json
 * nové verze, `jazyk` = 'en' / 'cs'. Bez poznámek se rozbalení schová.
 */
export function renderUpdateNotes(poznamky, jazyk) {
  const titulek = el('updateTitle');
  const info = el('updateInfo');
  const box = el('updateNotes');
  if (!titulek || !info || !box) return;
  const text = (p) => (p && (p[jazyk] || p.en)) || '';
  const novinky = (poznamky?.novinky || []).map(text).filter(Boolean);
  const opravy = (poznamky?.opravy || []).map(text).filter(Boolean);

  titulek.textContent = poznamky?.verze
    ? t('update.availableVersion', { version: poznamky.verze })
    : t('update.available');
  const neco = novinky.length || opravy.length;
  info.querySelector('.update-vice').hidden = !neco;
  info.disabled = !neco;

  const blok = (nadpis, polozky, trida) => {
    if (!polozky.length) return null;
    const sekce = document.createElement('div');
    sekce.className = trida;
    const h = document.createElement('h4');
    h.textContent = t(nadpis);
    const ul = document.createElement('ul');
    ul.append(...polozky.map((p) => {
      const li = document.createElement('li');
      li.textContent = p;
      return li;
    }));
    sekce.append(h, ul);
    return sekce;
  };
  box.replaceChildren(...[
    blok('update.new', novinky, 'novinky'),
    blok('update.fixes', opravy, 'opravy'),
  ].filter(Boolean));
}

export function toggleUpdateNotes(otevrit) {
  const info = el('updateInfo');
  const box = el('updateNotes');
  if (!info || !box) return;
  const ted = otevrit ?? box.hidden;
  box.hidden = !ted;
  info.setAttribute('aria-expanded', String(ted));
}


/* ---------- sestavy a kategorie v Trzích ---------- */

function cip(text, aktivni, onClick, trida = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip ${trida} ${aktivni ? 'active' : ''}`.replace(/\s+/g, ' ').trim();
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Lišta sestav: Vše, vlastní sestavy, „+". Klepnutí na aktivní sestavu
 * otevře její správu (přejmenovat, smazat) — „Vše" správu nemá.
 */
export function renderListBar({ polozky, aktivni, onSelect, onManage, onNew, misto = 'watchLists' }) {
  // Stejná lišta slouží i účtům v Historii (v0.59.7, přání uživatele) —
  // tam bez „+ New" a správy; skupina zůstává uprostřed díky vyvažovačům.
  const lista = document.getElementById(misto);
  if (!lista) return;
  /*
   * v0.47.0 (přání uživatele — v0.46.0 lišta při každém přepnutí ujížděla):
   * seznamy stojí **pevně, jako skupina uprostřed** pod záložkou
   * Watchlists; při přepnutí se jen přesune zvýraznění a pod vybraným
   * plynule dojede ukazatel. Vlevo vyvažovací mezera stejně široká jako
   * pravý sloupec s „+ New", ať je skupina uprostřed obrazovky. Posouvá
   * se jen při přetečení (víc seznamů, než se vejde), a to jen tolik, aby
   * byl vybraný vidět.
   */
  let pas = lista.querySelector('.watch-lists-pas');
  let ukazatel = lista.querySelector('.list-ukazatel');
  const novy = !pas;
  if (novy) {
    pas = document.createElement('div');
    pas.className = 'watch-lists-pas';
    ukazatel = document.createElement('span');
    ukazatel.className = 'list-ukazatel';
    ukazatel.setAttribute('aria-hidden', 'true');
  }
  const prvky = polozky.map(({ id, nazev, pocet }) => {
    const b = cip(nazev, id === aktivni, () => (id === aktivni ? onManage?.(id) : onSelect(id)), 'list-tab');
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(id === aktivni));
    b.dataset.id = id;
    if (pocet != null) {
      const n = document.createElement('span');
      n.className = 'chip-count';
      n.textContent = String(pocet);
      b.append(n);
    }
    return b;
  });
  // „+ Nový" s textem — samotné plus nenapovídalo, že si seznamy jde zakládat.
  pas.replaceChildren(...prvky, ukazatel);
  const vlevo = lista.querySelector('.list-vyvazeni') || Object.assign(document.createElement('span'), { className: 'list-vyvazeni' });
  const vpravo = lista.querySelector('.list-vpravo') || Object.assign(document.createElement('span'), { className: 'list-vpravo' });
  if (onNew) {
    const plus = cip(`+ ${t('lists.newShort')}`, false, onNew, 'list-tab list-new');
    plus.setAttribute('aria-label', t('lists.new'));
    plus.title = t('lists.new');
    vpravo.replaceChildren(plus);
  } else {
    vpravo.replaceChildren();
  }
  if (novy || lista.firstElementChild !== vlevo) lista.replaceChildren(vlevo, pas, vpravo);

  pas.classList.toggle('preteka', pas.scrollWidth > pas.clientWidth + 1);
  const vybrany = pas.querySelector('.active');
  if (!vybrany) {
    ukazatel.hidden = true;
    return;
  }
  ukazatel.hidden = false;
  // Při prvním vykreslení bez animace, jinak by ukazatel přijel z kraje.
  if (novy) ukazatel.style.transition = 'none';
  ukazatel.style.left = `${vybrany.offsetLeft + 8}px`;
  ukazatel.style.width = `${Math.max(12, vybrany.offsetWidth - 16)}px`;
  if (novy) requestAnimationFrame(() => { ukazatel.style.transition = ''; });
  // Přetečení: posunout jen tolik, aby byl vybraný celý vidět.
  const vlevoOd = vybrany.offsetLeft - 16;
  const vpravoDo = vybrany.offsetLeft + vybrany.offsetWidth + 16;
  if (vlevoOd < pas.scrollLeft) pas.scrollTo({ left: Math.max(0, vlevoOd), behavior: 'smooth' });
  else if (vpravoDo > pas.scrollLeft + pas.clientWidth) {
    pas.scrollTo({ left: vpravoDo - pas.clientWidth, behavior: 'smooth' });
  }
}

/**
 * Posune vodorovnou lištu tak, aby vybraná položka stála uprostřed.
 * ⚠ Ne `scrollIntoView` — to posouvá i celou stránku svisle.
 */
function vycentruj(lista, prvek) {
  if (!lista || !prvek) return;
  const cil = prvek.offsetLeft - (lista.clientWidth - prvek.offsetWidth) / 2;
  lista.scrollTo({ left: Math.max(0, cil), behavior: 'smooth' });
}

/**
 * Řádek kategorií. Bez identifikovaných coinů místo čipů tlačítko
 * „Identifikovat coiny" (poprvé povinné); jinak čipy + obnovení na konci.
 */
export function renderCategoryRow({ maData, kategorie, aktivni, zaneprazdneno, onSelect, onIdentify, chyba }) {
  const radek = document.getElementById('watchCats');
  if (!radek) return;
  if (!maData) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'identify-btn';
    btn.disabled = Boolean(zaneprazdneno);
    btn.textContent = zaneprazdneno ? t('lists.identifying') : t('lists.identify');
    btn.addEventListener('click', onIdentify);
    const popis = document.createElement('span');
    popis.className = `identify-hint ${chyba ? 'err' : ''}`.trim();
    popis.textContent = chyba ? t('lists.identifyFailed') : t('lists.identifyHint');
    radek.classList.remove('chip-row');
    radek.replaceChildren(btn, popis);
    return;
  }
  radek.classList.add('chip-row');
  const prvky = [cip(t('lists.allCategories'), !aktivni, () => onSelect(null))];
  kategorie.forEach(({ id, nazev, pocet }) => {
    const b = cip(nazev, id === aktivni, () => onSelect(id === aktivni ? null : id));
    if (pocet != null) {
      const n = document.createElement('span');
      n.className = 'chip-count';
      n.textContent = String(pocet);
      b.append(n);
    }
    prvky.push(b);
  });
  const obnov = cip('', false, onIdentify, 'chip-refresh');
  obnov.disabled = Boolean(zaneprazdneno);
  obnov.setAttribute('aria-label', t('lists.refresh'));
  obnov.title = t('lists.refresh');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6');
  svg.append(path);
  obnov.append(svg);
  prvky.push(obnov);
  radek.replaceChildren(...prvky);
  vycentruj(radek, radek.querySelector('.chip.active'));
}

/**
 * Nabídka u hvězdičky: sestavy (zaškrtnout / odškrtnout) a kategorie
 * coinu (ruční oprava).
 */
export function renderPairSheet({ symbol, sestavy, onToggleList, onNewList, kategorie, onToggleCat, opraveno, onReset }) {
  const titulek = document.getElementById('sheetPairTitle');
  if (titulek) titulek.textContent = symbol;
  const telo = document.getElementById('sheetPairLists');
  if (telo) {
    const prvky = sestavy.map(({ id, nazev, zapnuto }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `sheet-check ${zapnuto ? 'on' : ''}`.trim();
      b.setAttribute('role', 'checkbox');
      b.setAttribute('aria-checked', String(zapnuto));
      const znak = document.createElement('span');
      znak.className = 'check-box';
      znak.textContent = zapnuto ? '✓' : '';
      const text = document.createElement('span');
      text.textContent = nazev;
      b.append(znak, text);
      b.addEventListener('click', () => onToggleList(id));
      return b;
    });
    const nova = document.createElement('button');
    nova.type = 'button';
    nova.className = 'sheet-check new';
    nova.textContent = `+ ${t('lists.new')}`;
    nova.addEventListener('click', onNewList);
    telo.replaceChildren(...prvky, nova);
  }
  const cipy = document.getElementById('sheetPairCats');
  if (cipy) {
    cipy.replaceChildren(...kategorie.map(({ id, nazev, zapnuto }) =>
      cip(nazev, zapnuto, () => onToggleCat(id))));
  }
  const reset = document.getElementById('sheetPairReset');
  if (reset) {
    reset.hidden = !opraveno;
    reset.onclick = onReset;
  }
}

/** Tlačítko řazení vedle hledání a nabídka voleb. */
export function renderSort({ klic, sestupne, volby, onSelect }) {
  const btn = document.getElementById('sortBtn');
  if (btn) btn.textContent = `${t(`sort.${klic}Short`)} ${sestupne ? '↓' : '↑'}`;
  const telo = document.getElementById('sortOptions');
  if (!telo) return;
  telo.replaceChildren(...volby.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `sheet-check ${k === klic ? 'on' : ''}`.trim();
    const znak = document.createElement('span');
    znak.className = 'check-box';
    znak.textContent = k === klic ? (sestupne ? '↓' : '↑') : '';
    const text = document.createElement('span');
    text.textContent = t(`sort.${k}`);
    b.append(znak, text);
    b.addEventListener('click', () => onSelect(k));
    return b;
  }));
}

/* ---------- deník: Edge (v0.64.0) ---------- */

/*
 * Souhrn obchodů za období: Net PnL a průměrné R, křivka průběžného
 * součtu, úspěšnost / profit factor / dodržení plánu, věty „Your edge",
 * čekající zhodnocení a poslední obchody. Data počítá denik-statistiky.js.
 */
export function renderEdge({ souhrn: s, vety, nadpis, hide, poznamka, review, posledni, onReview, onAll }) {
  const misto = document.getElementById('journalEdge');
  if (!misto) return;
  const e = (tag, trida, text = '') => {
    const x = document.createElement(tag);
    if (trida) x.className = trida;
    if (text) x.textContent = text;
    return x;
  };
  const castka = (v) => (hide ? MASK : `${formatSignedUsd(v)} USD`);
  const casti = [];
  if (poznamka) casti.push(e('p', 'watch-note history-note', poznamka));

  if (!s.pocet) {
    casti.push(e('p', 'watch-note edge-prazdne', t('journal.edge.none')));
    misto.replaceChildren(...casti);
    return;
  }

  const karta = e('section', 'edge-karta');
  const hlava = e('div', 'edge-hlava');
  const vlevo = e('div', 'edge-sloupec');
  vlevo.append(e('span', 'edge-popis', nadpis),
    e('b', `edge-pnl ${pnlClass(s.pnl)}`, castka(s.pnl)));
  const vpravo = e('div', 'edge-sloupec vpravo');
  vpravo.append(e('span', 'edge-popis', t('journal.edge.avgR')),
    e('b', `edge-r ${s.prumerR === null ? '' : pnlClass(s.prumerR)}`,
      s.prumerR === null ? '—' : `${s.prumerR > 0 ? '+' : s.prumerR < 0 ? '−' : ''}${Math.abs(s.prumerR).toFixed(2)} R`));
  hlava.append(vlevo, vpravo);
  karta.append(hlava);
  if (s.krivka.length >= 2) karta.append(krivkaEdge(s.krivka, s.pnl));
  const mrizka = e('div', 'edge-mrizka');
  const bunka = (popis, hodnota) => {
    const b = e('div', 'edge-sloupec');
    b.append(e('span', 'edge-popis', popis), e('b', 'edge-cislo', hodnota));
    return b;
  };
  const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
  const pf = s.profitFactor === null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
  mrizka.append(bunka(t('journal.edge.winRate'), pct(s.uspesnost)),
    bunka(t('journal.edge.profitFactor'), pf),
    bunka(t('journal.edge.plan'), pct(s.planDodrzen)));
  karta.append(mrizka);
  casti.push(karta);

  if (vety.length) {
    const blok = e('section', 'edge-karta edge-vety');
    blok.append(e('h3', 'edge-nadpis', t('journal.edge.title')));
    vety.forEach((v) => {
      const p = e('p', 'edge-veta');
      v.casti.forEach((c) => p.append(c.b ? e('b', v.ton === 'dobre' ? 'up' : 'down', c.text) : c.text));
      blok.append(p);
    });
    casti.push(blok);
  }

  if (review > 0) {
    const b = e('button', 'edge-review');
    b.type = 'button';
    b.append(e('span', '', t('journal.edge.waiting', { n: review })), e('span', '', `${t('journal.review')} →`));
    b.addEventListener('click', onReview);
    casti.push(b);
  }

  if (posledni.length) {
    const radek = e('div', 'edge-posledni-hlava');
    const vse = e('button', 'edge-odkaz', `${t('journal.edge.allTrades')} →`);
    vse.type = 'button';
    vse.addEventListener('click', onAll);
    radek.append(e('span', '', t('journal.edge.recent')), vse);
    casti.push(radek);
    posledni.forEach((o) => {
      const b = e('button', 'edge-obchod');
      b.type = 'button';
      const nazev = e('span', 'edge-obchod-par', o.symbol);
      nazev.append(e('span', `edge-smer ${o.long ? 'long' : 'short'}`, t(o.long ? 'position.long' : 'position.short')));
      b.append(nazev, e('b', pnlClass(o.pnl), hide ? MASK : formatSignedUsd(o.pnl)),
        e('span', 'edge-obchod-info', o.info), e('span', 'edge-obchod-info vpravo', o.r));
      b.addEventListener('click', o.onOpen);
      casti.push(b);
    });
  }
  misto.replaceChildren(...casti);
}

/** Křivka průběžného součtu (stejný vzhled jako mini-graf dlaždice). */
function krivkaEdge(body, soucet) {
  const w = 360;
  const h = 64;
  const vzorky = [0, ...body.map((b) => b.v)];
  const min = Math.min(...vzorky);
  const max = Math.max(...vzorky);
  const rozpeti = max - min || 1;
  const ys = vzorky.map((v) => h - 4 - ((v - min) / rozpeti) * (h - 8));
  const krivka = hladkaKrivka(ys, w / (ys.length - 1));
  const svg = document.createElementNS(SVG_NS, 'svg');
  const prvek = (tag, atributy) => {
    const x = document.createElementNS(SVG_NS, tag);
    Object.entries(atributy).forEach(([k, v]) => x.setAttribute(k, v));
    return x;
  };
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `edge-krivka ${soucet >= 0 ? 'up' : 'down'}`);
  const prechod = prvek('linearGradient', { id: 'edge-prechod', x1: 0, y1: 0, x2: 0, y2: 1 });
  prechod.append(prvek('stop', { offset: 0, class: 'spark-stop-horni' }), prvek('stop', { offset: 1, class: 'spark-stop-dolni' }));
  const defs = prvek('defs', {});
  defs.append(prechod);
  svg.append(defs,
    prvek('path', { d: `${krivka} L${w},${h} L0,${h} Z`, class: 'spark-plocha', fill: 'url(#edge-prechod)' }),
    prvek('path', { d: krivka, class: 'spark-cara edge-cara' }));
  return svg;
}
