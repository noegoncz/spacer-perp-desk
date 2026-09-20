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
import { t, getLocale } from './i18n.js';

/** Datum a čas pro cenovku u kříže — stejné pásmo jako osa grafu. */
function formatCas(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString(getLocale(), {
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
  { id: 'segment', body: 2 },
  { id: 'rayLine', body: 2 },
  { id: 'straightLine', body: 2 },
  { id: 'horizontalStraightLine', body: 1 },
  { id: 'verticalStraightLine', body: 1 },
  { id: 'priceLine', body: 1 },
  { id: 'priceChannelLine', body: 3 },
  { id: 'parallelStraightLine', body: 3 },
  { id: 'fibonacciLine', body: 2 },
  { id: 'simpleAnnotation', body: 1 },
];

/** Název nástroje v jazyce uživatele. */
export const nazevNastroje = (id) => t(`tool.${id}`);

/** Indikátory nabízené uživateli, z 27 vestavěných. */
export const INDIKATORY = [
  { id: 'VOL', vlastniPanel: true },
  { id: 'RSI', vlastniPanel: true },
  { id: 'MACD', vlastniPanel: true },
  { id: 'KDJ', vlastniPanel: true },
  { id: 'MA', vlastniPanel: false },
  { id: 'EMA', vlastniPanel: false },
  { id: 'BOLL', vlastniPanel: false },
  { id: 'SAR', vlastniPanel: false },
];

export const nazevIndikatoru = (id) => t(`indicator.${id}`);

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

/* ---------- vzhled kreseb ---------- */

/** Záměrně malá paleta. Velká se nepoužívá, jen se v ní člověk hrabe. */
export const BARVY_KRESEB = ['#4c9aff', '#16c784', '#ea3943', '#f0b90b', '#a78bfa', '#e6edf5'];
export const TLOUSTKY = [1, 2, 3];
export const PRUHLEDNOSTI = [1, 0.6, 0.3];

export const VYCHOZI_STYL = { color: BARVY_KRESEB[0], width: 2, opacity: 1 };

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Styl kresby se drží v `extendData`, aby se dal uložit i načíst zpět. */
function stylKresby(styl) {
  const s = { ...VYCHOZI_STYL, ...(styl || {}) };
  const barva = rgba(s.color, s.opacity);
  return {
    line: { color: barva, size: s.width },
    text: { color: barva },
    point: { color: barva, borderColor: rgba(s.color, s.opacity * 0.3) },
    polygon: { color: rgba(s.color, s.opacity * 0.18) },
  };
}

export function createPriceChart(container, layer, handlers = {}) {
  registrovatCaruPozice();

  const chart = K().init(container, { styles: styly() });
  chart.setTimezone('Europe/Prague');

  /*
   * Svislý posun a roztažení cenové osy. Knihovna osu normálně dopočítává
   * sama podle viditelných svíček; `createRange` ten výsledek jen posune
   * a roztáhne, takže automatika zůstává a jen se na ni dívá „jinudy".
   */
  let posunY = 0; // podíl rozsahu
  let zoomY = 1;
  const VYCHOZI_SIRKA_SVICE = 10;

  chart.overrideYAxis({
    createRange: ({ defaultRange }) => {
      if (posunY === 0 && zoomY === 1) return defaultRange;
      const { from, to } = defaultRange;
      const stred = (from + to) / 2;
      const puvodni = to - from;
      const novy = puvodni * zoomY;
      const offset = puvodni * posunY;
      const f = stred - novy / 2 + offset;
      const tt = stred + novy / 2 + offset;
      return { ...defaultRange, from: f, to: tt, range: tt - f, realFrom: f, realTo: tt, realRange: tt - f };
    },
  });

  // Překreslení se sdruží do jednoho snímku, ať tažení prstem neseká.
  let cekaNaSnimek = false;
  function prekresliOsu() {
    if (cekaNaSnimek) return;
    cekaNaSnimek = true;
    requestAnimationFrame(() => {
      cekaNaSnimek = false;
      chart.resize();
      kresleni.redraw();
    });
  }
  chart.setLocale('en-US'); // knihovna češtinu nemá; ovlivňuje popisky v tooltipu

  let idCarPozice = [];
  const aktivniIndikatory = new Set();
  let zivyCallback = null;
  let aktualniLoader = null;
  let magnet = false;
  let rozdelanyNastroj = null;
  let upravovanaKresba = null;
  // Nová kresba převezme vzhled té naposledy nastavené — nikdo nechce
  // přebarvovat každou čáru znovu.
  let posledniStyl = { ...VYCHOZI_STYL };
  let dodatekKresby = null;

  const vybranyStyl = () => ({ ...VYCHOZI_STYL, ...(upravovanaKresba?.extendData || {}) });

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

  /** Jak blízko musí kříž být, aby ho magnet chytil na cenu svíčky. */
  const DOSAH_MAGNETU = 16;

  /**
   * Magnet knihovny (`mode: 'weak_magnet'`) se uplatní jen u jejího vlastního
   * kreslení. My body počítáme sami, takže si přichytávání musíme udělat taky
   * sami — jinak by magnet nedělal vůbec nic.
   *
   * Chytá na otevření, maximum, minimum i uzavření nejbližší svíčky, tedy na
   * konce knotů i těl, což je přesně to, čeho se trendová čára dotýká.
   */
  function snapNaSvicku(x, y) {
    if (!magnet) return null;

    const p = chart.convertFromPixel([{ x, y }], { paneId: HLAVNI_PANEL });
    const bod = Array.isArray(p) ? p[0] : p;
    const svicka = chart.getDataList()[bod?.dataIndex];
    if (!svicka) return null;

    let nej = null;
    for (const hodnota of [svicka.open, svicka.high, svicka.low, svicka.close]) {
      const c = chart.convertToPixel(
        { timestamp: svicka.timestamp, value: hodnota },
        { paneId: HLAVNI_PANEL },
      );
      const v = Array.isArray(c) ? c[0] : c;
      if (!Number.isFinite(v?.y)) continue;
      const vzdalenost = Math.abs(v.y - y);
      if (vzdalenost < DOSAH_MAGNETU && (!nej || vzdalenost < nej.vzdalenost)) {
        nej = { x: v.x, y: v.y, vzdalenost };
      }
    }
    return nej ? { x: nej.x, y: nej.y } : null;
  }

  const kresleni = createTouchDrawing({
    layer,
    toPixel,
    fromPixel,
    snap: snapNaSvicku,
    formatPrice,
    formatTime: formatCas,
    onCreate: (body) => {
      chart.createOverlay({
        name: rozdelanyNastroj,
        groupId: SKUPINA_KRESBY,
        points: body,
        lock: true, // posouvá se jen přes naše úchyty, ne prstem po čáře
        mode: magnet ? 'weak_magnet' : 'normal',
        extendData: { ...posledniStyl, ...(dodatekKresby || {}) },
        styles: stylKresby(posledniStyl),
      });
      rozdelanyNastroj = null;
      dodatekKresby = null;
      ohlasZmenu();
      handlers.onDrawEnd?.();
    },
    /**
     * Volá se při každém posunu, ne až na konci — uživatel musí vidět, jak
     * se celá čára hýbe, aby podle toho mohl mířit. Do telefonu se ukládá
     * až potvrzený stav, ne každý mezikrok.
     */
    onEdit: (index, bod, hotovo) => {
      if (!upravovanaKresba) return;
      const body = [...upravovanaKresba.points];
      body[index] = bod;
      chart.overrideOverlay({ id: upravovanaKresba.id, points: body });
      upravovanaKresba = chart.getOverlays({ id: upravovanaKresba.id })[0] ?? {
        ...upravovanaKresba,
        points: body,
      };
      if (hotovo) ohlasZmenu();
    },
    onCancel: () => {
      rozdelanyNastroj = null;
      upravovanaKresba = null;
      handlers.onSelectionChanged?.(null);
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
        handlers.onSelectionChanged?.(vybranyStyl());
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

    /** `dodatek` doplní vlastnosti nové kresby, např. rovnou zapnutý alarm. */
    startDrawing(nastroj, dodatek = null) {
      const definice = NASTROJE.find((n) => n.id === nastroj);
      if (!definice) return;
      rozdelanyNastroj = nastroj;
      dodatekKresby = dodatek;
      upravovanaKresba = null;
      umistiVrstvu();
      kresleni.beginCreate(definice.body);
    },

    cancelDrawing() {
      if (kresleni.isActive()) kresleni.cancel();
      rozdelanyNastroj = null;
      dodatekKresby = null;
      upravovanaKresba = null;
    },

    setMagnet(zapnuto) {
      magnet = zapnuto;
    },

    /* ---------- svislý posun a reset pohledu ---------- */

    /** `delta` je podíl výšky grafu; kladné posouvá pohled dolů. */
    posunSvisle(delta) {
      posunY = Math.max(-2, Math.min(2, posunY + delta));
      prekresliOsu();
      return posunY;
    },

    posunSvislyPodil() {
      return posunY;
    },

    /** Zpět na 100 %: automatická osa, výchozí šířka svící, konec dat. */
    resetPohledu() {
      posunY = 0;
      zoomY = 1;
      chart.setBarSpace(VYCHOZI_SIRKA_SVICE);
      chart.scrollToRealTime();
      prekresliOsu();
    },

    getDrawings() {
      return chart
        .getOverlays({ groupId: SKUPINA_KRESBY })
        .map((o) => ({ id: o.id, name: o.name, points: o.points, style: o.extendData }));
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
            extendData: { ...VYCHOZI_STYL, ...(k.style || {}) },
            styles: stylKresby(k.style),
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
      handlers.onSelectionChanged?.(null);
      // Tady je prázdný seznam správný výsledek, uživatel si o to řekl.
      handlers.onDrawingsChanged?.();
    },

    /** Smaže jen kresbu, kterou má uživatel zrovna v úpravách. */
    deleteSelected() {
      if (!upravovanaKresba) return false;
      chart.removeOverlay({ id: upravovanaKresba.id });
      upravovanaKresba = null;
      handlers.onSelectionChanged?.(null);
      kresleni.cancel();
      handlers.onDrawingsChanged?.();
      return true;
    },

    hasSelection() {
      return Boolean(upravovanaKresba);
    },

    selectedStyle: vybranyStyl,

    /** Alarm se drží ve stejném objektu jako vzhled, ať se ukládá spolu s ním. */
    setAlarm(id, zapnuto) {
      const kresba = chart.getOverlays({ id })[0];
      if (!kresba) return;
      const data = { ...VYCHOZI_STYL, ...(kresba.extendData || {}), alarm: zapnuto };
      chart.overrideOverlay({ id, extendData: data, styles: stylKresby(data) });
      if (upravovanaKresba?.id === id) {
        upravovanaKresba = chart.getOverlays({ id })[0] ?? upravovanaKresba;
        handlers.onSelectionChanged?.(vybranyStyl());
      }
      handlers.onDrawingsChanged?.();
    },

    selectedId() {
      return upravovanaKresba?.id ?? null;
    },

    /** Přepíše vzhled vybrané kresby a zapamatuje si ho pro další. */
    setSelectedStyle(zmena) {
      if (!upravovanaKresba) return;
      const novy = { ...vybranyStyl(), ...zmena };
      posledniStyl = { ...novy };
      chart.overrideOverlay({
        id: upravovanaKresba.id,
        extendData: novy,
        styles: stylKresby(novy),
      });
      upravovanaKresba = chart.getOverlays({ id: upravovanaKresba.id })[0] ?? {
        ...upravovanaKresba,
        extendData: novy,
      };
      handlers.onDrawingsChanged?.();
      handlers.onSelectionChanged?.(novy);
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
