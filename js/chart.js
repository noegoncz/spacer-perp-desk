/**
 * Obal nad knihovnou KLineChart (vendor/klinecharts.js).
 *
 * O Bybitu nic neví — data si vyžádá přes loader, který mu podstrčí app.js.
 * Díky tomu jde knihovna vyměnit bez zásahu do zbytku aplikace. Tahle vrstva
 * se už jednou vyměňovala (dřív lightweight-charts) a stálo to jen tenhle
 * soubor, takže se to vyplácí držet.
 *
 * Kreslení **nepoužívá** vestavěné kreslení knihovny. To klade body přímo pod
 * prst, což je na telefonu nepoužitelné. Místo toho je v js/draw.js vlastní
 * ovládání se zaměřovacím křížem.
 */

import { createTouchDrawing } from './draw.js';
import { formatPrice } from './format.js';

/** Datum a čas pro cenovku u kříže — stejné pásmo jako osa grafu. */
function formatCas(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Prague',
  });
}

const K = () => window.klinecharts;

const BARVY = {
  pozadi: '#0b0f14',
  text: '#8b9bb0',
  mrizka: '#1a232e',
  okraj: '#253141',
  rust: '#16c784',
  pokles: '#ea3943',
  kresba: '#4c9aff',
};

/** Bybit používá vlastní kódy intervalů, knihovna potřebuje jiný tvar. */
const OBDOBI = {
  1: { type: 'minute', span: 1 },
  5: { type: 'minute', span: 5 },
  15: { type: 'minute', span: 15 },
  60: { type: 'hour', span: 1 },
  240: { type: 'hour', span: 4 },
  D: { type: 'day', span: 1 },
  W: { type: 'week', span: 1 },
  M: { type: 'month', span: 1 },
};

/**
 * Kreslicí nástroje. `body` je počet bodů, které uživatel klade křížem —
 * musí sedět s tím, co knihovna u daného tvaru očekává.
 */
export const NASTROJE = [
  { id: 'segment', nazev: 'Úsečka', body: 2 },
  { id: 'rayLine', nazev: 'Polopřímka', body: 2 },
  { id: 'straightLine', nazev: 'Přímka', body: 2 },
  { id: 'horizontalStraightLine', nazev: 'Vodorovná úroveň', body: 1 },
  { id: 'verticalStraightLine', nazev: 'Svislá čára', body: 1 },
  { id: 'priceLine', nazev: 'Cenová čára', body: 1 },
  { id: 'priceChannelLine', nazev: 'Cenový kanál', body: 3 },
  { id: 'parallelStraightLine', nazev: 'Rovnoběžky', body: 3 },
  { id: 'fibonacciLine', nazev: 'Fibonacci', body: 2 },
  { id: 'simpleAnnotation', nazev: 'Poznámka', body: 1 },
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

const HLAVNI_PANEL = 'candle_pane';
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
    indicator: { tooltip: { text: { color: BARVY.text, size: 11 } } },
    overlay: {
      line: { color: BARVY.kresba },
      point: { color: BARVY.kresba, borderColor: 'rgba(76,154,255,0.25)' },
      text: { color: BARVY.kresba },
    },
  };
}

const STYL_KRESBY = {
  line: { color: BARVY.kresba, size: 1.5 },
  text: { color: BARVY.kresba },
  polygon: { color: 'rgba(76,154,255,0.12)' },
};

export function createPriceChart(container, layer, handlers = {}) {
  registrovatCaruPozice();

  const chart = K().init(container, { styles: styly() });
  chart.setTimezone('Europe/Prague');
  chart.setLocale('en-US'); // knihovna češtinu nemá; ovlivňuje popisky v tooltipu

  let idCarPozice = [];
  const aktivniIndikatory = new Set();
  let zivyCallback = null;
  let aktualniLoader = null;
  let magnet = false;
  let rozdelanyNastroj = null;
  let upravovanaKresba = null;

  /**
   * Obnova kreseb nejdřív maže staré overlaye a každé smazání hlásí změnu.
   * Bez umlčení by se při otevření grafu uložil prázdný seznam přes uložené
   * kresby dřív, než se stihnou obnovit — tedy tiché smazání práce uživatele.
   */
  let tichaZmena = false;
  const ohlasZmenu = () => {
    if (!tichaZmena) handlers.onDrawingsChanged?.();
  };

  /* ---------- převody souřadnic ---------- */

  /**
   * Kreslicí vrstva se posadí přesně na plochu se svíčkami (bez cenové osy
   * a bez panelů indikátorů). Díky tomu jsou její pixely totožné s těmi,
   * se kterými počítá knihovna, a netřeba nic přepočítávat.
   */
  function umistiVrstvu() {
    const b = chart.getSize(HLAVNI_PANEL, 'main');
    if (!b) return;
    layer.style.left = `${b.left}px`;
    layer.style.top = `${b.top}px`;
    layer.style.width = `${b.width}px`;
    layer.style.height = `${b.height}px`;
  }

  const toPixel = (bod) => {
    const c = chart.convertToPixel(
      { timestamp: bod.timestamp, value: bod.value },
      { paneId: HLAVNI_PANEL },
    );
    const v = Array.isArray(c) ? c[0] : c;
    return { x: v?.x ?? NaN, y: v?.y ?? NaN };
  };

  const fromPixel = (x, y) => {
    const p = chart.convertFromPixel([{ x, y }], { paneId: HLAVNI_PANEL });
    const bod = Array.isArray(p) ? p[0] : p;
    return { timestamp: bod?.timestamp, value: bod?.value };
  };

  /* ---------- kreslení prstem ---------- */

  const kresleni = createTouchDrawing({
    layer,
    toPixel,
    fromPixel,
    formatPrice,
    formatTime: formatCas,
    onCreate: (body) => {
      chart.createOverlay({
        name: rozdelanyNastroj,
        groupId: SKUPINA_KRESBY,
        points: body,
        lock: true, // posouvá se jen přes naše úchyty, ne prstem po čáře
        mode: magnet ? 'weak_magnet' : 'normal',
        styles: STYL_KRESBY,
      });
      rozdelanyNastroj = null;
      ohlasZmenu();
      handlers.onDrawEnd?.();
    },
    onEdit: (index, bod) => {
      if (!upravovanaKresba) return;
      const body = [...upravovanaKresba.points];
      body[index] = bod;
      chart.overrideOverlay({ id: upravovanaKresba.id, points: body });
      upravovanaKresba = chart.getOverlays({ id: upravovanaKresba.id })[0] ?? upravovanaKresba;
      ohlasZmenu();
    },
    onCancel: () => {
      rozdelanyNastroj = null;
      upravovanaKresba = null;
      handlers.onDrawEnd?.();
    },
  });

  /**
   * Klepnutí na hotovou kresbu ji vezme do úprav. Vrstva je v klidu průchozí,
   * takže se posloucha přímo na grafu — a tažení se od klepnutí pozná podle
   * toho, o kolik se prst posunul.
   */
  let dotyk = null;
  container.addEventListener(
    'pointerdown',
    (e) => {
      if (kresleni.isActive()) return;
      dotyk = { x: e.clientX, y: e.clientY };
    },
    { passive: true },
  );
  container.addEventListener(
    'pointerup',
    (e) => {
      if (!dotyk || kresleni.isActive()) return;
      const posun = Math.hypot(e.clientX - dotyk.x, e.clientY - dotyk.y);
      dotyk = null;
      if (posun > 8) return; // uživatel posouval graf, ne vybíral kresbu

      const r = layer.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (mx < 0 || my < 0 || mx > r.width || my > r.height) return;

      const kresby = chart.getOverlays({ groupId: SKUPINA_KRESBY });
      const index = kresleni.hitTest(mx, my, kresby);
      if (index >= 0) {
        upravovanaKresba = kresby[index];
        kresleni.beginEdit(upravovanaKresba.points);
      }
    },
    { passive: true },
  );

  const observer = new ResizeObserver(() => {
    chart.resize();
    umistiVrstvu();
    kresleni.redraw();
  });
  observer.observe(container);

  return {
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
          setTimeout(umistiVrstvu, 0);
        },
        subscribeBar: ({ callback }) => {
          zivyCallback = callback;
        },
        unsubscribeBar: () => {
          zivyCallback = null;
        },
      });
    },

    setSymbol(ticker, pricePrecision) {
      chart.setSymbol({ ticker, pricePrecision, volumePrecision: 0 });
    },

    setInterval(interval) {
      chart.setPeriod(OBDOBI[interval] || OBDOBI['15']);
    },

    updateCandle(bar) {
      zivyCallback?.(bar);
    },

    /* ---------- čáry pozice ---------- */

    setPositionLines(lines) {
      idCarPozice.forEach((id) => chart.removeOverlay({ id }));
      idCarPozice = lines.map((l) =>
        chart.createOverlay({
          name: 'positionLine',
          groupId: SKUPINA_POZICE,
          points: [{ value: l.price }],
          lock: true,
          extendData: {
            color: l.color,
            title: l.title,
            width: l.width,
            solid: l.solid,
            dotted: l.dotted,
          },
        }),
      );
      umistiVrstvu();
    },

    /* ---------- kreslení ---------- */

    startDrawing(nastroj) {
      const definice = NASTROJE.find((n) => n.id === nastroj);
      if (!definice) return;
      rozdelanyNastroj = nastroj;
      upravovanaKresba = null;
      umistiVrstvu();
      kresleni.beginCreate(definice.body);
    },

    cancelDrawing() {
      if (kresleni.isActive()) kresleni.cancel();
      rozdelanyNastroj = null;
      upravovanaKresba = null;
    },

    setMagnet(zapnuto) {
      magnet = zapnuto;
    },

    getDrawings() {
      return chart
        .getOverlays({ groupId: SKUPINA_KRESBY })
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
            lock: true,
            styles: STYL_KRESBY,
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
      upravovanaKresba = null;
      // Tady je prázdný seznam správný výsledek, uživatel si o to řekl.
      handlers.onDrawingsChanged?.();
    },

    /** Smaže jen kresbu, kterou má uživatel zrovna v úpravách. */
    deleteSelected() {
      if (!upravovanaKresba) return false;
      chart.removeOverlay({ id: upravovanaKresba.id });
      upravovanaKresba = null;
      kresleni.cancel();
      handlers.onDrawingsChanged?.();
      return true;
    },

    hasSelection() {
      return Boolean(upravovanaKresba);
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
        setTimeout(umistiVrstvu, 0);
        return false;
      }

      const id = vlastniPanel
        ? chart.createIndicator(nazev)
        : chart.createIndicator({ name: nazev, paneId: HLAVNI_PANEL });

      if (!id) return false;
      aktivniIndikatory.add(nazev);
      handlers.onIndicatorsChanged?.();
      setTimeout(umistiVrstvu, 0);
      return true;
    },

    restoreIndicators(nazvy, jeVlastniPanel) {
      (nazvy || []).forEach((nazev) => {
        if (aktivniIndikatory.has(nazev)) return;
        const id = jeVlastniPanel(nazev)
          ? chart.createIndicator(nazev)
          : chart.createIndicator({ name: nazev, paneId: HLAVNI_PANEL });
        if (id) aktivniIndikatory.add(nazev);
      });
      setTimeout(umistiVrstvu, 0);
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
