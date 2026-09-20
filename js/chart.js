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

/** ID hlavního panelu se svíčkami — sem jdou indikátory bez vlastního panelu. */
const HLAVNI_PANEL = 'candle_pane';

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
  const aktivniIndikatory = new Set();
  let zivyCallback = null;
  let aktualniLoader = null;
  let magnet = false;

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

    /**
     * Spustí kreslení. `continuous` znamená jedno tažení prstem místo
     * klepání bod po bodu — výchozí `step` je na dotykovém displeji
     * skoro nepoužitelný, protože klepnutí se často vyhodnotí jako posun
     * grafu a bod se vůbec nezapíše.
     */
    startDrawing(nastroj) {
      chart.createOverlay({
        name: nastroj,
        groupId: SKUPINA_KRESBY,
        drawingMode: 'continuous',
        mode: magnet ? 'weak_magnet' : 'normal',
        styles: { line: { color: '#4c9aff' }, text: { color: '#4c9aff' } },
        onDrawEnd: () => {
          ohlasZmenu();
          handlers.onDrawEnd?.();
          return false;
        },
        onRemoved: () => {
          ohlasZmenu();
          return false;
        },
      });
    },

    /** Zrušit rozdělané kreslení (uživatel přepnul nástroj nebo dal kurzor). */
    cancelDrawing() {
      chart
        .getOverlays({ groupId: SKUPINA_KRESBY })
        .filter((o) => o.currentStep !== -1)
        .forEach((o) => chart.removeOverlay({ id: o.id }));
    },

    /** Přichytávání k cenám svíček — na dotyku hodně pomáhá přesnosti. */
    setMagnet(zapnuto) {
      magnet = zapnuto;
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
        chart.removeOverlay({ groupId: SKUPINA_KRESBY });

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
      chart.removeOverlay({ groupId: SKUPINA_KRESBY });
      // Tady je prázdný seznam správný výsledek, uživatel si o to řekl.
      handlers.onDrawingsChanged?.();
    },

    /* ---------- indikátory ---------- */

    /**
     * `createIndicator` má ve verzi 10 jen dva parametry a vrací **ID
     * indikátoru**, ne ID panelu. Dřív se ukládalo jako paneId a mazání pak
     * hledalo podle klíče, který nikdy neseděl — indikátory nešly vypnout.
     * Filtr podle názvu je spolehlivý.
     */
    toggleIndicator(nazev, vlastniPanel) {
      if (aktivniIndikatory.has(nazev)) {
        chart.removeIndicator({ name: nazev });
        aktivniIndikatory.delete(nazev);
        handlers.onIndicatorsChanged?.();
        return false;
      }

      const id = vlastniPanel
        ? chart.createIndicator(nazev)
        : chart.createIndicator({ name: nazev, paneId: HLAVNI_PANEL });

      if (!id) return false;
      aktivniIndikatory.add(nazev);
      handlers.onIndicatorsChanged?.();
      return true;
    },

    /** Obnova zapnutých indikátorů po startu aplikace. */
    restoreIndicators(nazvy, jeVlastniPanel) {
      (nazvy || []).forEach((nazev) => {
        if (aktivniIndikatory.has(nazev)) return;
        const id = jeVlastniPanel(nazev)
          ? chart.createIndicator(nazev)
          : chart.createIndicator({ name: nazev, paneId: HLAVNI_PANEL });
        if (id) aktivniIndikatory.add(nazev);
      });
    },

    activeIndicators() {
      return [...aktivniIndikatory];
    },

    destroy() {
      observer.disconnect();
      K().dispose(container);
    },
  };
}
