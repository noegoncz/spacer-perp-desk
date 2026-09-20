/**
 * Obal nad knihovnou KLineChart (vendor/klinecharts.js).
 *
 * O Bybitu nic neví — data si vyžádá přes loader, který mu podstrčí app.js.
 * Díky tomu jde knihovna vyměnit bez zásahu do zbytku aplikace. Tahle vrstva
 * se už jednou vyměňovala (dřív lightweight-charts) a stálo to jen tenhle
 * soubor, takže se to vyplácí držet.
 */

const K = () => window.klinecharts;

const BARVY = {
  pozadi: '#0b0f14',
  text: '#8b9bb0',
  mrizka: '#1a232e',
  okraj: '#253141',
  rust: '#16c784',
  pokles: '#ea3943',
};

/** Bybit používá vlastní kódy intervalů, knihovna potřebuje jiný tvar. */
const OBDOBI = {
  1: { type: 'minute', span: 1 },
  5: { type: 'minute', span: 5 },
  15: { type: 'minute', span: 15 },
  60: { type: 'hour', span: 1 },
  240: { type: 'hour', span: 4 },
  D: { type: 'day', span: 1 },
};

/** Kreslicí nástroje nabízené uživateli, z 16 vestavěných. */
export const NASTROJE = [
  { id: 'segment', nazev: 'Úsečka' },
  { id: 'rayLine', nazev: 'Polopřímka' },
  { id: 'straightLine', nazev: 'Přímka' },
  { id: 'horizontalStraightLine', nazev: 'Vodorovná úroveň' },
  { id: 'verticalStraightLine', nazev: 'Svislá čára' },
  { id: 'priceLine', nazev: 'Cenová čára' },
  { id: 'priceChannelLine', nazev: 'Cenový kanál' },
  { id: 'parallelStraightLine', nazev: 'Rovnoběžky' },
  { id: 'fibonacciLine', nazev: 'Fibonacci' },
  { id: 'simpleAnnotation', nazev: 'Poznámka' },
];

/** Indikátory nabízené uživateli, z 27 vestavěných. */
export const INDIKATORY = [
  { id: 'VOL', nazev: 'Objem', vlastniPanel: true },
  { id: 'RSI', nazev: 'RSI', vlastniPanel: true },
  { id: 'MACD', nazev: 'MACD', vlastniPanel: true },
  { id: 'KDJ', nazev: 'KDJ', vlastniPanel: true },
  { id: 'MA', nazev: 'Klouzavý průměr', vlastniPanel: false },
  { id: 'EMA', nazev: 'EMA', vlastniPanel: false },
  { id: 'BOLL', nazev: 'Bollinger', vlastniPanel: false },
  { id: 'SAR', nazev: 'Parabolic SAR', vlastniPanel: false },
];

/** Skupiny overlayů: čáry pozice se nesmí míchat s kresbami uživatele. */
const SKUPINA_POZICE = 'pozice';
const SKUPINA_KRESBY = 'kresby';

let zaregistrovano = false;

/**
 * Vlastní overlay pro čáry pozice — vodorovná čára přes celou šířku
 * s krátkým popiskem. Vestavěný `priceLine` popisek neumí.
 */
function registrovatCaruPozice() {
  if (zaregistrovano) return;
  zaregistrovano = true;

  K().registerOverlay({
    name: 'positionLine',
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const d = overlay.extendData || {};
      const y = coordinates[0].y;
      return [
        {
          type: 'line',
          attrs: { coordinates: [{ x: 0, y }, { x: bounding.width, y }] },
          styles: {
            color: d.color,
            size: d.width || 1,
            style: d.solid ? 'solid' : 'dashed',
            dashedValue: d.dotted ? [2, 3] : [5, 4],
          },
        },
        {
          type: 'text',
          attrs: { x: 6, y: y - 4, text: d.title || '', baseline: 'bottom' },
          styles: { color: d.color, size: 11, family: 'sans-serif' },
        },
      ];
    },
  });
}

function styly() {
  return {
    grid: {
      horizontal: { color: BARVY.mrizka },
      vertical: { color: BARVY.mrizka },
    },
    candle: {
      bar: {
        upColor: BARVY.rust,
        downColor: BARVY.pokles,
        noChangeColor: BARVY.text,
        upBorderColor: BARVY.rust,
        downBorderColor: BARVY.pokles,
        upWickColor: BARVY.rust,
        downWickColor: BARVY.pokles,
      },
      tooltip: { text: { color: BARVY.text, size: 11 } },
    },
    xAxis: {
      axisLine: { color: BARVY.okraj },
      tickLine: { color: BARVY.okraj },
      tickText: { color: BARVY.text, size: 10 },
    },
    yAxis: {
      axisLine: { color: BARVY.okraj },
      tickLine: { color: BARVY.okraj },
      tickText: { color: BARVY.text, size: 10 },
    },
    separator: { color: BARVY.okraj },
    crosshair: {
      horizontal: { line: { color: BARVY.text }, text: { backgroundColor: BARVY.okraj } },
      vertical: { line: { color: BARVY.text }, text: { backgroundColor: BARVY.okraj } },
    },
    indicator: {
      tooltip: { text: { color: BARVY.text, size: 11 } },
    },
  };
}

export function createPriceChart(container, handlers = {}) {
  registrovatCaruPozice();

  const chart = K().init(container, { styles: styly() });
  chart.setTimezone('Europe/Prague');
  chart.setLocale('en-US'); // knihovna češtinu nemá; ovlivňuje jen popisky v tooltipu

  let idCarPozice = [];
  let idIndikatoru = new Map(); // název -> id
  let zivyCallback = null;
  let aktualniLoader = null;

  /**
   * Obnova kreseb nejdřív maže staré overlaye a každé smazání hlásí změnu.
   * Bez umlčení by se při otevření grafu uložil prázdný seznam přes uložené
   * kresby dřív, než se stihnou obnovit — tedy tiché smazání práce uživatele.
   */
  let tichaZmena = false;
  const ohlasZmenu = () => {
    if (!tichaZmena) handlers.onDrawingsChanged?.();
  };

  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(container);

  return {
    /**
     * Loader si data tahá sám, když chart dostane symbol a období.
     * `nactiSvice(interval)` vrací pole svíček, o zbytek se stará knihovna.
     */
    setLoader(nactiSvice) {
      aktualniLoader = nactiSvice;
      chart.setDataLoader({
        getBars: async ({ type, period, callback }) => {
          if (type !== 'init') {
            // Dohrávání historie při odscrollování zatím neřešíme.
            callback([], false);
            return;
          }
          try {
            callback(await aktualniLoader(period), false);
          } catch {
            callback([], false);
          }
        },
        subscribeBar: ({ callback }) => {
          zivyCallback = callback;
          handlers.onSubscribe?.();
        },
        unsubscribeBar: () => {
          zivyCallback = null;
          handlers.onUnsubscribe?.();
        },
      });
    },

    setSymbol(ticker, pricePrecision) {
      chart.setSymbol({ ticker, pricePrecision, volumePrecision: 0 });
    },

    setInterval(interval) {
      chart.setPeriod(OBDOBI[interval] || OBDOBI['15']);
    },

    /** Živá svíčka z WebSocketu. */
    updateCandle(bar) {
      zivyCallback?.(bar);
    },

    /* ---------- čáry pozice ---------- */

    setPositionLines(lines) {
      idCarPozice.forEach((id) => chart.removeOverlay(id));
      idCarPozice = lines.map((l) =>
        chart.createOverlay({
          name: 'positionLine',
          groupId: SKUPINA_POZICE,
          points: [{ value: l.price }],
          lock: true, // uživatel jimi nesmí hýbat, patří pozici
          extendData: {
            color: l.color,
            title: l.title,
            width: l.width,
            solid: l.solid,
            dotted: l.dotted,
          },
        }),
      );
    },

    /* ---------- kreslení ---------- */

    /** Spustí kreslení: uživatel doklepe body přímo v grafu. */
    startDrawing(nastroj) {
      chart.createOverlay({
        name: nastroj,
        groupId: SKUPINA_KRESBY,
        styles: { line: { color: '#4c9aff' }, text: { color: '#4c9aff' } },
        onDrawEnd: () => {
          ohlasZmenu();
          return false;
        },
        onRemoved: () => {
          ohlasZmenu();
          return false;
        },
      });
    },

    /** Kresby uživatele v podobě, která jde uložit do telefonu. */
    getDrawings() {
      return chart
        .getOverlays()
        .filter((o) => o.groupId === SKUPINA_KRESBY)
        .map((o) => ({ name: o.name, points: o.points }));
    },

    restoreDrawings(kresby) {
      tichaZmena = true;
      try {
        chart
          .getOverlays()
          .filter((o) => o.groupId === SKUPINA_KRESBY)
          .forEach((o) => chart.removeOverlay(o.id));

        (kresby || []).forEach((k) => {
          chart.createOverlay({
            name: k.name,
            groupId: SKUPINA_KRESBY,
            points: k.points,
            styles: { line: { color: '#4c9aff' }, text: { color: '#4c9aff' } },
            onDrawEnd: () => {
              ohlasZmenu();
              return false;
            },
            onRemoved: () => {
              ohlasZmenu();
              return false;
            },
          });
        });
      } finally {
        // Až po vyprázdnění fronty — callbacky knihovny nemusí běžet hned.
        setTimeout(() => {
          tichaZmena = false;
        }, 0);
      }
    },

    clearDrawings() {
      chart
        .getOverlays()
        .filter((o) => o.groupId === SKUPINA_KRESBY)
        .forEach((o) => chart.removeOverlay(o.id));
      // Tady je prázdný seznam správný výsledek, uživatel si o to řekl.
      handlers.onDrawingsChanged?.();
    },

    /* ---------- indikátory ---------- */

    toggleIndicator(nazev, vlastniPanel) {
      if (idIndikatoru.has(nazev)) {
        chart.removeIndicator({ paneId: idIndikatoru.get(nazev), name: nazev });
        idIndikatoru.delete(nazev);
        return false;
      }
      const paneId = chart.createIndicator(nazev, true, vlastniPanel ? {} : { id: 'candle_pane' });
      if (paneId) idIndikatoru.set(nazev, paneId);
      return true;
    },

    activeIndicators() {
      return [...idIndikatoru.keys()];
    },

    destroy() {
      observer.disconnect();
      K().dispose(container);
    },
  };
}
