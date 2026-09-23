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
import { nactiNastaveni, parametryVypoctu, ZDROJE, TYPY_MA, vyhladit } from './indikatory.js';

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

/** Délka jedné svíčky v ms — pro odpočet do jejího uzavření. */
const DELKA_OBDOBI = {
  1: 60e3, 5: 300e3, 15: 900e3, 60: 3600e3, 240: 14400e3,
  D: 86400e3, W: 604800e3, M: 2592000e3,
};

/** mm:ss, u delších svíček h:mm:ss. */
function odpocet(ms) {
  const celkem = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(celkem / 3600);
  const m = Math.floor((celkem % 3600) / 60);
  const sek = celkem % 60;
  const dd = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dd(m)}:${dd(sek)}` : `${dd(m)}:${dd(sek)}`;
}

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
  // Objem se vkládá přímo do hlavního panelu, ne pod něj — viz registrovatObjem.
  { id: 'VOL', vlastniPanel: false },
  { id: 'RSI', vlastniPanel: true },
  { id: 'MACD', vlastniPanel: true },
  { id: 'KDJ', vlastniPanel: true },
  { id: 'MA', vlastniPanel: false },
  { id: 'EMA', vlastniPanel: false },
  { id: 'BOLL', vlastniPanel: false },
  { id: 'SAR', vlastniPanel: false },
  // Profil se kreslí do hlavního panelu, přes svíčky.
  { id: 'VPROFILE', vlastniPanel: false },
];

export const nazevIndikatoru = (id) => t(`indicator.${id}`);
export const popisIndikatoru = (id) => t(`indicatorDesc.${id}`);

/** Drobné ikonky do nabídky, ať jde indikátor poznat i bez čtení. */
export const IKONY_INDIKATORU = {
  VOL: '<path d="M4 20V13M9 20V8M14 20V11M19 20V5"/>',
  RSI: '<path d="M3 16c3-8 6 4 9-3s6 2 9-4"/><path d="M3 6h18M3 18h18" opacity=".4"/>',
  MACD: '<path d="M3 14c3-6 6 2 9-4s6 4 9-2"/><path d="M6 19v-3M12 19v-5M18 19v-2"/>',
  KDJ: '<path d="M3 15c4-7 8 3 12-5"/><path d="M3 18c4-5 8 4 12-7" opacity=".5"/><path d="M19 4v16"/>',
  MA: '<path d="M3 15c4-6 8 2 12-4s4-2 6-3"/>',
  EMA: '<path d="M3 17c4-4 6 1 9-5s6 1 9-4"/><circle cx="21" cy="8" r="1.6"/>',
  BOLL: '<path d="M3 13c4-5 8 1 12-4s2-1 6-2"/><path d="M3 7c4-5 8 1 12-4" opacity=".45"/><path d="M3 19c4-5 8 1 12-4" opacity=".45"/>',
  SAR: '<path d="M3 16c4-6 8 2 12-5"/><circle cx="6" cy="19" r="1.3"/><circle cx="11" cy="17" r="1.3"/><circle cx="16" cy="8" r="1.3"/><circle cx="21" cy="6" r="1.3"/>',
  VPROFILE: '<path d="M3 5h11M3 9h6M3 13h14M3 17h8M3 21h4"/>',
};

const HLAVNI_PANEL = 'candle_pane';
const SKUPINA_POZICE = 'pozice';
const SKUPINA_KRESBY = 'kresby';
const SKUPINA_ZNACKY = 'znacky';
const SKUPINA_ALARMY = 'alarmy';

/**
 * Alarm má v grafu **vlastní vzhled**, ať se neplete s kresbami ani s čarami
 * pozice: tyrkysová (jinou barvu nic jiného nemá), čerchovaná a s ikonou
 * budíku u popisku. Vypnutý alarm zešedne, ale zůstane vidět.
 */
export const BARVA_ALARMU = '#22d3ee';
const BARVA_ALARMU_VYPNUTY = '#5a6a7d';
const CARKOVANI_ALARMU = [6, 3, 2, 3];

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
          // Všechny čáry stejně tenké. Rozlišuje je barva a typ čárkování,
          // ne tloušťka — jinak graf působí jako změť různých linek.
          styles: {
            color: d.color,
            size: 1,
            style: 'dashed',
            dashedValue: d.dash || [6, 4],
          },
        },
        {
          // Popisek u pravého okraje, vedle cenové osy. Bez podkladu —
          // barevný blok za textem ujídá pohled na svíčky.
          type: 'text',
          attrs: {
            x: bounding.width - 5,
            y: y - 3,
            text: d.title || '',
            align: 'right',
            baseline: 'bottom',
          },
          styles: {
            color: d.color,
            size: 11,
            family: 'sans-serif',
            backgroundColor: 'transparent',
            borderSize: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
          },
        },
      ];
    },
  });
}

/** Ikonka budíku z figur knihovny — ciferník, ručičky a dvě ouška. */
function budik(stred, barva) {
  const { x, y } = stred;
  const cara = (souradnice) => ({
    type: 'line',
    attrs: { coordinates: souradnice },
    styles: { color: barva, size: 1 },
  });
  return [
    {
      type: 'arc',
      attrs: { x, y, r: 4.5, startAngle: 0, endAngle: Math.PI * 2 },
      styles: { color: barva, size: 1 },
    },
    cara([{ x, y: y - 2.5 }, { x, y }]),
    cara([{ x, y }, { x: x + 2.2, y }]),
    cara([{ x: x - 3.4, y: y - 3.4 }, { x: x - 5.4, y: y - 5.4 }]),
    cara([{ x: x + 3.4, y: y - 3.4 }, { x: x + 5.4, y: y - 5.4 }]),
  ];
}

/** Popisek alarmu u pravého okraje; budík stojí vlevo od něj. */
function popisAlarmu(text, x, y, barva) {
  /*
   * Šířku vykresleného textu knihovna neprozradí, takže se odhaduje —
   * budík stojí kousek vlevo od popisku a pár pixelů sem tam nevadí.
   */
  const stred = { x: x - 8 - text.length * 6.2, y: y - 7 };
  return [
    ...budik(stred, barva),
    {
      type: 'text',
      attrs: { x, y: y - 3, text, align: 'right', baseline: 'bottom' },
      styles: {
        color: barva,
        size: 11,
        family: 'sans-serif',
        backgroundColor: 'transparent',
        borderSize: 0,
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
      },
    },
  ];
}

const caraAlarmu = (souradnice, barva) => ({
  type: 'line',
  attrs: { coordinates: souradnice },
  styles: { color: barva, size: 1, style: 'dashed', dashedValue: CARKOVANI_ALARMU },
});

/**
 * Vypnutý alarm zešedne. Zapnutý si drží barvu, se kterou vznikl — alarm
 * z kresby zůstává v barvě té kresby, ostatní jsou tyrkysové.
 */
const barvaAlarmu = (d) =>
  (d.aktivni === false ? BARVA_ALARMU_VYPNUTY : (d.color || BARVA_ALARMU));

/**
 * Tři podoby alarmu: pevná hladina, šikmá čára a okamžik v čase. Vlastní
 * overlaye proto, že vestavěné čáry neumí popisek ani ikonu.
 */
function registrovatCaryAlarmu() {
  const zaklad = {
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
  };

  // Pevná hladina přes celou šířku.
  K().registerOverlay({
    ...zaklad,
    name: 'alarmLine',
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const d = overlay.extendData || {};
      const y = coordinates[0].y;
      const barva = barvaAlarmu(d);
      return [
        caraAlarmu([{ x: 0, y }, { x: bounding.width, y }], barva),
        ...popisAlarmu(d.title || '', bounding.width - 5, y, barva),
      ];
    },
  });

  /*
   * Šikmá čára si nechává **barvu i délku původní kresby** — mění se jen
   * čárkování a přibude budík. Prodlužovat ji k okraji se neosvědčilo:
   * z kresby se tím stala nekonečná čára přes celý graf.
   */
  K().registerOverlay({
    ...zaklad,
    name: 'alarmTrend',
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData || {};
      const [a, b] = coordinates;
      if (!a || !b) return [];
      const barva = barvaAlarmu(d);
      // Popisek visí na pravějším konci, aby nezakrýval samotnou čáru.
      const konec = a.x >= b.x ? a : b;
      return [
        caraAlarmu([a, b], barva),
        ...budik({ x: konec.x + 9, y: konec.y }, barva),
        {
          type: 'text',
          attrs: {
            x: konec.x + 17,
            y: konec.y,
            text: d.title || '',
            align: 'left',
            baseline: 'middle',
          },
          styles: {
            color: barva,
            size: 11,
            family: 'sans-serif',
            backgroundColor: 'transparent',
            borderSize: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
          },
        },
      ];
    },
  });

  // Okamžik v čase: svislá čára s budíkem u horního okraje.
  K().registerOverlay({
    ...zaklad,
    name: 'alarmTime',
    createPointFigures: ({ overlay, coordinates, bounding }) => {
      const d = overlay.extendData || {};
      const x = coordinates[0].x;
      const barva = barvaAlarmu(d);
      return [
        caraAlarmu([{ x, y: 0 }, { x, y: bounding.height }], barva),
        ...budik({ x, y: 12 }, barva),
        {
          type: 'text',
          attrs: { x: x + 8, y: 12, text: d.title || '', align: 'left', baseline: 'middle' },
          styles: {
            color: barva,
            size: 11,
            family: 'sans-serif',
            backgroundColor: 'transparent',
            borderSize: 0,
            paddingLeft: 0,
            paddingRight: 0,
            paddingTop: 0,
            paddingBottom: 0,
          },
        },
      ];
    },
  });
}

/**
 * Značka jednoho plnění: trojúhelník ve směru obchodu a cena u něj.
 * Sedí na konkrétní svíčce, protože zná přesný čas plnění.
 */
function registrovatZnackuPlneni() {
  K().registerOverlay({
    name: 'tradeMark',
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ overlay, coordinates }) => {
      const d = overlay.extendData || {};
      const { x, y } = coordinates[0];
      const smer = d.vstup ? 1 : -1;
      const zaklad = y + smer * 13;
      return [
        {
          type: 'polygon',
          attrs: {
            coordinates: [
              { x, y: y + smer * 3 },
              { x: x - 6, y: zaklad },
              { x: x + 6, y: zaklad },
            ],
          },
          styles: { style: 'fill', color: d.color },
        },
        {
          type: 'text',
          attrs: {
            x,
            y: zaklad + (d.vstup ? 2 : -2),
            text: d.title || '',
            align: 'center',
            baseline: d.vstup ? 'top' : 'bottom',
          },
          styles: { color: d.color, size: 10, family: 'sans-serif' },
        },
      ];
    },
  });
}

/* ---------- vlastní indikátory ---------- */

/**
 * Objem vnořený do hlavního panelu, jak to dělá TradingView.
 *
 * Vestavěný `VOL` sem vložit nejde: má `series: 'volume'`, takže si vyrobí
 * vlastní svislou osu, přebere jí pravou stupnici a sloupce roztáhne přes
 * celou výšku — svíčky pak nejsou vidět (ověřeno, viz CLAUDE.md).
 *
 * Proto stejný název registrujeme znovu s prázdným `figures`. Bez figur
 * indikátor do měřítka osy nemluví, cenová stupnice zůstane cenová, a
 * sloupce si dokreslíme sami do spodního pruhu panelu.
 */
function registrovatObjem() {
  K().registerIndicator({
    name: 'VOL',
    shortName: 'Vol',
    series: 'normal',
    calcParams: [20],
    figures: [],
    // Bez tohohle by v legendě stálo „Vol(20)" i s vypnutým průměrem.
    createTooltipDataSource: ({ indicator }) => {
      const n = nactiNastaveni('VOL');
      return { calcParamsText: n.zobrazitMa ? ` MA ${indicator.calcParams?.[0]}` : '' };
    },
    calc: (data, indikator) => {
      const delka = Math.max(1, Number(indikator.calcParams?.[0]) || 20);
      const out = [];
      let soucet = 0;
      for (let i = 0; i < data.length; i += 1) {
        const k = data[i];
        const v = Number(k.volume) || 0;
        soucet += v;
        if (i >= delka) soucet -= Number(data[i - delka].volume) || 0;
        const predchozi = i > 0 ? data[i - 1].close : k.open;
        out.push({
          v,
          // Obě varianty barvení spočítáme rovnou. Přepnutí je pak jen
          // překreslení, ne přepočet celé řady.
          rustOC: k.close >= k.open,
          rustPC: k.close >= predchozi,
          ma: i >= delka - 1 ? soucet / delka : undefined,
        });
      }
      return out;
    },
    draw: ({ ctx, chart, indicator, bounding }) => {
      const n = nactiNastaveni('VOL');
      const vysledek = indicator.result || [];
      const rozsah = chart.getVisibleRange();
      const { gapBar } = chart.getBarSpace();
      if (!rozsah) return true;

      // Měřítko z právě viditelných svíček, ne z celé historie — jinak by
      // jeden dávný výkyv zploštil všechno ostatní na neviditelnou čáru.
      let max = 0;
      for (let i = rozsah.from; i < rozsah.to; i += 1) {
        const r = vysledek[i];
        if (r && r.v > max) max = r.v;
      }
      if (max <= 0) return true;

      const pas = bounding.height * (Number(n.vyska) || 22) / 100;
      const dno = bounding.height;
      const doPixelu = (hodnota) => dno - (hodnota / max) * pas;
      const x = (i) =>
        chart.convertToPixel({ dataIndex: i, value: 0 }, { paneId: HLAVNI_PANEL }).x;

      ctx.save();
      ctx.globalAlpha = Number(n.pruhlednost) || 0.45;
      for (let i = rozsah.from; i < rozsah.to; i += 1) {
        const r = vysledek[i];
        if (!r) continue;
        const roste = n.podlePredchozi ? r.rustPC : r.rustOC;
        ctx.fillStyle = roste ? n.barvaRust : n.barvaPokles;
        const y = doPixelu(r.v);
        ctx.fillRect(x(i) - gapBar / 2, y, Math.max(1, gapBar), dno - y);
      }

      if (n.zobrazitMa) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = n.barvaMa;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let zacato = false;
        for (let i = rozsah.from; i < rozsah.to; i += 1) {
          const r = vysledek[i];
          if (!r || r.ma === undefined) continue;
          const bx = x(i);
          const by = doPixelu(r.ma);
          if (zacato) ctx.lineTo(bx, by);
          else { ctx.moveTo(bx, by); zacato = true; }
        }
        ctx.stroke();
      }
      ctx.restore();
      return true; // výchozí kreslení knihovny přeskočit
    },
  });
}

/**
 * Volume profile — kde se objem obchodoval, podle ceny.
 *
 * ⚠ **Je to odhad, ne pravda.** Poctivý profil potřebuje jednotlivé obchody,
 * a na ty Bybit endpoint nemá. Ze svíček (OHLCV) jde jen rozprostřít objem
 * každé svíčky rovnoměrně mezi její minimum a maximum. Dělá to tak většina
 * retailových nástrojů, ale přesné to není a uživatel o tom ví (CLAUDE.md,
 * checkpoint 3).
 *
 * Kreslí se stejnou technikou jako objem: prázdné `figures`, takže indikátor
 * nemluví do měřítka cenové osy a sloupce si vykreslíme sami.
 */
function registrovatVolumeProfile() {
  K().registerIndicator({
    name: 'VPROFILE',
    shortName: 'VP',
    series: 'normal',
    calcParams: [],
    figures: [],
    createTooltipDataSource: () => {
      const n = nactiNastaveni('VPROFILE');
      return { calcParamsText: ` ${n.radku}` };
    },
    // Výpočet nic nevrací: profil závisí na tom, co je právě vidět, takže
    // se celý počítá až v draw(). Řada musí mít délku dat, jinak knihovna
    // indikátor považuje za prázdný a draw() vůbec nezavolá.
    calc: (data) => data.map(() => ({})),
    draw: ({ ctx, chart, bounding }) => {
      const n = nactiNastaveni('VPROFILE');
      const rozsah = chart.getVisibleRange();
      const data = chart.getDataList();
      if (!rozsah || !data.length) return true;

      const od = Math.max(0, rozsah.from);
      const doKonce = Math.min(data.length, rozsah.to);
      if (doKonce <= od) return true;

      // Cenové rozpětí bere jen viditelné svíčky — profil má popisovat to,
      // na co se uživatel dívá, ne celou historii.
      let min = Infinity;
      let max = -Infinity;
      for (let i = od; i < doKonce; i += 1) {
        if (data[i].low < min) min = data[i].low;
        if (data[i].high > max) max = data[i].high;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return true;

      const radku = Math.max(6, Math.round(Number(n.radku) || 24));
      const pasma = new Array(radku).fill(0);
      const vyskaPasma = (max - min) / radku;

      for (let i = od; i < doKonce; i += 1) {
        const k = data[i];
        const objem = Number(k.volume) || 0;
        if (objem <= 0) continue;
        // Svíčka bez rozpětí (low === high) spadne celá do jednoho pásma.
        const prvni = Math.min(radku - 1, Math.max(0, Math.floor((k.low - min) / vyskaPasma)));
        const posledni = Math.min(radku - 1, Math.max(0, Math.floor((k.high - min) / vyskaPasma)));
        const pocet = posledni - prvni + 1;
        const dil = objem / pocet;
        for (let j = prvni; j <= posledni; j += 1) pasma[j] += dil;
      }

      const nejvic = Math.max(...pasma);
      if (nejvic <= 0) return true;

      const naY = (cena) => {
        const bod = chart.convertToPixel({ value: cena }, { paneId: HLAVNI_PANEL });
        const v = Array.isArray(bod) ? bod[0] : bod;
        return v?.y;
      };

      const maxSirka = bounding.width * (Number(n.sirka) || 30) / 100;
      const nejsilnejsi = pasma.indexOf(nejvic);

      ctx.save();
      ctx.globalAlpha = Number(n.pruhlednost) || 0.45;
      for (let j = 0; j < radku; j += 1) {
        if (pasma[j] <= 0) continue;
        const yHorni = naY(min + (j + 1) * vyskaPasma);
        const yDolni = naY(min + j * vyskaPasma);
        if (!Number.isFinite(yHorni) || !Number.isFinite(yDolni)) continue;

        // Mezera mezi sloupci, ať profil nevypadá jako jedna plocha.
        const vyska = Math.max(1, Math.abs(yDolni - yHorni) - 1);
        const sirka = maxSirka * (pasma[j] / nejvic);
        ctx.fillStyle = (n.zobrazitPoc && j === nejsilnejsi) ? n.barvaPoc : n.barvaProfil;
        // Od levého okraje doprava: vpravo jsou nejnovější svíčky a cenová
        // osa, tam profil překážet nemá.
        ctx.fillRect(0, Math.min(yHorni, yDolni), sirka, vyska);
      }
      ctx.restore();
      return true; // výchozí kreslení knihovny přeskočit
    },
  });
}

/**
 * RSI po vzoru TradingView: jedna křivka, volitelný klouzavý průměr a
 * pásma překoupenosti s výplní. Vestavěné RSI kreslí tři křivky bez pásem
 * a nedá se u něj zvolit zdroj ceny.
 */
function registrovatRsi() {
  K().registerIndicator({
    name: 'RSI',
    shortName: 'RSI',
    series: 'normal',
    precision: 2,
    calcParams: [14, 14, 0, 0], // délka, délka průměru, zdroj ceny, typ průměru
    figures: [
      { key: 'rsi', title: 'RSI: ', type: 'line' },
      { key: 'ma', title: 'MA: ', type: 'line' },
    ],
    /*
     * Knihovna sama vypisuje surové `calcParams`, tedy „RSI(14,14,0,0)" —
     * z toho uživatel nepozná nic. Vracíme jen text parametrů; hodnoty
     * křivek si knihovna doplní sama.
     */
    createTooltipDataSource: ({ indicator }) => {
      const [delka, delkaMa, zdrojIndex, typIndex] = indicator.calcParams || [];
      const n = nactiNastaveni('RSI');
      const casti = [String(delka), t(`source.${ZDROJE[Number(zdrojIndex) || 0] || 'close'}`)];
      if (n.zobrazitMa) {
        casti.push(`${(TYPY_MA[Number(typIndex) || 0] || 'sma').toUpperCase()} ${delkaMa}`);
      }
      return { calcParamsText: ` ${casti.join(' · ')}` };
    },
    calc: (data, indikator) => {
      const [delkaVstup, delkaMaVstup, zdrojIndex, typIndex] = indikator.calcParams || [];
      const delka = Math.max(2, Number(delkaVstup) || 14);
      const delkaMa = Math.max(1, Number(delkaMaVstup) || 14);
      const zdroj = ZDROJE[Number(zdrojIndex) || 0] || 'close';
      const typMa = TYPY_MA[Number(typIndex) || 0] || 'sma';

      const rada = new Array(data.length).fill(undefined);
      let prumerRustu = 0;
      let prumerPoklesu = 0;

      for (let i = 1; i < data.length; i += 1) {
        const zmena = Number(data[i][zdroj]) - Number(data[i - 1][zdroj]);
        const rust = Math.max(0, zmena);
        const pokles = Math.max(0, -zmena);

        if (i <= delka) {
          // Prvních `delka` změn tvoří prostý průměr, pak se vyhlazuje
          // Wilderovým způsobem — stejně to počítá TradingView.
          prumerRustu += rust / delka;
          prumerPoklesu += pokles / delka;
        } else {
          prumerRustu = (prumerRustu * (delka - 1) + rust) / delka;
          prumerPoklesu = (prumerPoklesu * (delka - 1) + pokles) / delka;
        }
        if (i < delka) continue;
        rada[i] = prumerPoklesu === 0 ? 100 : 100 - 100 / (1 + prumerRustu / prumerPoklesu);
      }

      // Průměr RSI se počítá vždy, i vypnutý — je to jen barva. Tím je
      // přepnutí zobrazení okamžité a nevyžaduje přepočet.
      const prumer = vyhladit(rada, delkaMa, typMa);
      return rada.map((rsi, i) => (rsi === undefined ? {} : { rsi, ma: prumer[i] }));
    },
    draw: ({ ctx, chart, indicator, bounding }) => {
      const n = nactiNastaveni('RSI');
      if (!n.zobrazitPasma) return false;
      const naY = (hodnota) => {
        const b = chart.convertToPixel({ value: hodnota }, { paneId: indicator.paneId });
        return Array.isArray(b) ? b[0].y : b.y;
      };
      const horni = naY(Number(n.horniPasmo));
      const dolni = naY(Number(n.dolniPasmo));
      if (!Number.isFinite(horni) || !Number.isFinite(dolni)) return false;

      ctx.save();
      if (n.vypln) {
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = n.barvaRsi;
        ctx.fillRect(0, horni, bounding.width, dolni - horni);
      }
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = n.barvaPasem;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      [horni, dolni].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(bounding.width, y);
        ctx.stroke();
      });
      ctx.restore();
      return false; // křivky nad pásmy dokreslí knihovna
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
      // Značka poslední ceny a pod ní odpočet do uzavření svíčky.
      priceMark: {
        show: true,
        last: {
          show: true,
          line: { show: true, style: 'dashed', dashedValue: [4, 4], size: 1 },
          text: { show: true, size: 11, paddingLeft: 4, paddingRight: 4,
                  paddingTop: 3, paddingBottom: 3, borderRadius: 3 },
          extendTexts: [{
            show: true,
            position: 'below_price',
            color: '#ffffff',
            backgroundColor: 'rgba(37, 49, 65, 0.95)',
            size: 10,
            paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2,
            borderRadius: 3,
          }],
        },
      },
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
export const BARVY_KRESEB = ['#e6edf5', '#4c9aff', '#16c784', '#ea3943', '#f0b90b', '#a78bfa'];
export const TLOUSTKY = [1, 2, 3];
export const PRUHLEDNOSTI = [1, 0.6, 0.3];

export const VYCHOZI_STYL = { color: BARVY_KRESEB[0], width: 1, opacity: 1 };

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
  registrovatCaryAlarmu();
  registrovatZnackuPlneni();
  registrovatObjem();
  registrovatVolumeProfile();
  registrovatRsi();

  const chart = K().init(container, { styles: styly() });
  chart.setTimezone('Europe/Prague');

  const VYCHOZI_SIRKA_SVICE = 10;

  /** Vykreslí čáry pozice. Volá se i po výměně dat při změně intervalu. */
  function vykresliCary(lines) {
    idCarPozice.forEach((id) => chart.removeOverlay({ id }));
    idCarPozice = (lines || []).map((l) =>
      chart.createOverlay({
        name: 'positionLine',
        groupId: SKUPINA_POZICE,
        points: [{ value: l.price }],
        lock: true,
        extendData: { color: l.color, title: l.title, dash: l.dash },
      }),
    );
    umistiVrstvu();
  }

  /**
   * Vykreslí alarmy. Kreslí se stejně jako čáry pozice, mimo skupinu kreseb —
   * tvar se řídí typem alarmu (hladina, šikmá čára, okamžik v čase).
   */
  function vykresliAlarmy(seznam) {
    chart.removeOverlay({ groupId: SKUPINA_ALARMY });
    (seznam || []).forEach((a) => {
      const tvar = {
        cara: { name: 'alarmTrend', points: a.body || [] },
        cas: { name: 'alarmTime', points: [{ timestamp: a.cas }] },
      }[a.typ] || { name: 'alarmLine', points: [{ value: a.price }] };

      chart.createOverlay({
        ...tvar,
        groupId: SKUPINA_ALARMY,
        lock: true, // alarm se mění v jeho nastavení, ne taháním po grafu
        extendData: {
          id: a.id, typ: a.typ, title: a.title, aktivni: a.aktivni, color: a.barva,
        },
      });
    });
  }

  /** Vykreslí kresby uživatele bez hlášení změn — jde o obnovu, ne úpravu. */
  function vykresliKresby(kresby) {
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
  }

  /**
   * Srovná pohled: výchozí šířka svící a skok na konec dat.
   *
   * ⚠ Volá se při otevření grafu i při změně intervalu. Instance grafu se
   * mezi otevřeními recykluje kvůli rychlosti, takže by si jinak nesla posun
   * a přiblížení z minula — uživatel pak po otevření hledal, kde vůbec jsou
   * aktuální svíčky.
   */
  function srovnejPohled() {
    chart.setBarSpace(VYCHOZI_SIRKA_SVICE);
    chart.scrollToRealTime(0);
  }

  /*
   * ⚠ Srovnání se musí naplánovat až za vykreslení, ne přes `setTimeout(…, 0)`.
   * Při otevření grafu se hned po něm ještě vracejí kresby a čáry pozice
   * a plátno se překresluje; srovnání puštěné dřív se nestihlo projevit
   * a pohled skončil o pár svíček před koncem dat — poslední svíčka tedy
   * nebyla vidět. Dva snímky proto, že první jen zpracuje probíhající změny.
   */
  function srovnejAzPoVykresleni() {
    requestAnimationFrame(() => requestAnimationFrame(srovnejPohled));
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
  let vyberBodu = null; // křížem se zrovna vybírá hladina alarmu, ne kresba
  // Co je v grafu nakresleno — při změně intervalu se to na chvíli sundá
  // a vrátí až s novými svíčkami, aby nic nepřeskakovalo zvlášť.
  let posledniCary = [];
  let posledniAlarmy = [];
  let prepinaSeInterval = false;
  let zalohaKreseb = [];
  let posledniInterval = null;
  let delkaObdobi = DELKA_OBDOBI['15'];
  let tikani = null;

  /*
   * Odpočet do uzavření svíčky u poslední ceny, jako v TradingView.
   * Knihovna na to má `extendTexts` u značky poslední ceny; text dodá tenhle
   * formátovač. Aby odpočet běžel i mezi ticky z burzy, jednou za sekundu se
   * vynutí překreslení.
   */
  chart.setFormatter({
    formatExtendText: ({ type, data }) => {
      if (type !== 'last_price' || !data?.timestamp) return '';
      const zbyva = data.timestamp + delkaObdobi - Date.now();
      if (zbyva <= 0 || zbyva > delkaObdobi) return '';
      return odpocet(zbyva);
    },
  });

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
      // Zadávání alarmu si jen půjčuje kříž — kresba z toho nevzniká.
      if (vyberBodu) {
        const predej = vyberBodu;
        vyberBodu = null;
        predej(body[0]);
        handlers.onDrawEnd?.();
        return;
      }
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
      vyberBodu = null;
      upravovanaKresba = null;
      handlers.onSelectionChanged?.(null);
      handlers.onDrawEnd?.();
    },
  });

  /** Jak daleko od čáry ještě klepnutí platí — prst je tlustší než čára. */
  const DOSAH_ALARMU = 16;

  /**
   * Který alarm má uživatel pod prstem. U šikmé čáry se měří svisle od
   * **prodloužené** přímky, ne od úsečky mezi body — čára pokračuje až
   * k pravému okraji a klepnout na ni musí jít po celé délce.
   */
  function alarmPodPrstem(mx, my) {
    let nej = null;
    for (const o of chart.getOverlays({ groupId: SKUPINA_ALARMY })) {
      const d = o.extendData || {};
      const body = (o.points || []).map(toPixel);
      let vzdalenost = Infinity;

      if (d.typ === 'cas') {
        vzdalenost = Math.abs(body[0]?.x - mx);
      } else if (d.typ === 'cara' && body.length >= 2) {
        const [a, b] = body;
        const smernice = (b.y - a.y) / ((b.x - a.x) || 1);
        vzdalenost = Math.abs(a.y + smernice * (mx - a.x) - my);
      } else {
        vzdalenost = Math.abs(body[0]?.y - my);
      }

      if (vzdalenost < DOSAH_ALARMU && (!nej || vzdalenost < nej.vzdalenost)) {
        nej = { id: d.id, vzdalenost };
      }
    }
    return nej?.id || null;
  }

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
        return;
      }

      // Klepnutí na alarm ho otevře k úpravě. Až za kresbami: alarm je jen
      // čára, kdežto kresba pod prstem bývá záměr.
      const alarm = alarmPodPrstem(mx, my);
      if (alarm) handlers.onAlarmTapped?.(alarm);
    },
    { passive: true },
  );

  /*
   * Gesto zahájené na cenové ose musí zůstat u osy, i když prst sjede do
   * plochy grafu. Bez toho se při tažení palcem u okraje graf začne sám
   * posouvat a obraz poskakuje. Řeší se vypnutím posunu a zoomu grafu na
   * dobu, kdy prst drží osu.
   */
  /**
   * Přepíše indikátoru vstupy výpočtu a vynutí překreslení. Pole, která
   * ovlivňují jen vzhled, si vlastní kreslení přečte samo, ale knihovna o
   * nich neví — `overrideIndicator` je jediný spolehlivý způsob, jak ji
   * donutit indikátor znovu nakreslit.
   */
  function pouzijNastaveni(nazev) {
    const zmena = { name: nazev };
    const parametry = parametryVypoctu(nazev);
    if (parametry) zmena.calcParams = parametry;

    if (nazev === 'RSI') {
      const n = nactiNastaveni('RSI');
      // Pevná stupnice 0–100 drží pásma na stejném místě i v klidném trhu.
      zmena.minValue = n.pevnaStupnice ? 0 : null;
      zmena.maxValue = n.pevnaStupnice ? 100 : null;
      zmena.styles = {
        lines: [
          { color: n.barvaRsi, size: 1 },
          // Knihovna křivku skrýt neumí; průhledná barva je jediný způsob,
          // jak ji nechat spočítat, ale nevykreslit.
          { color: n.zobrazitMa ? n.barvaMa : 'transparent', size: 1 },
        ],
      };
    }

    try {
      chart.overrideIndicator(zmena);
    } catch {
      /* neznámý indikátor — nastavení prostě nemá co přepsat */
    }
    pouzijVyskuPanelu(nazev);
  }

  /*
   * Výška vlastního panelu indikátoru. Zadává se v procentech plochy grafu,
   * ne v pixelech — na rozevřeném Foldu a na zavřeném displeji je plocha
   * jinak vysoká a pevná hodnota by jednou zabírala půlku, podruhé proužek.
   */
  const NEJMENE_PRO_SVICKY = 0.45; // svíčkám musí zbýt aspoň tolik plochy

  function pouzijVyskuPanelu(nazev) {
    const n = nactiNastaveni(nazev);
    if (n.vyskaPanelu === undefined) return;
    const indikator = chart.getIndicators({ name: nazev })?.[0];
    if (!indikator?.paneId || indikator.paneId === HLAVNI_PANEL) return;

    const plocha = container.clientHeight;
    if (!plocha) return;
    // Panely ostatních indikátorů si drží svoje; strop počítáme jen proti
    // tomu, co je k dispozici, aby svíčky nikdy nezmizely úplně.
    const strop = plocha * (1 - NEJMENE_PRO_SVICKY);
    const vyska = Math.round(Math.min(strop, plocha * n.vyskaPanelu / 100));
    if (vyska < 30) return;
    try {
      chart.setPaneOptions({ id: indikator.paneId, height: vyska });
    } catch {
      /* panel mezitím zmizel */
    }
  }

  /** Po změně rozměrů se procenta musí přepočítat na nové pixely. */
  function srovnejVyskyPanelu() {
    aktivniIndikatory.forEach(pouzijVyskuPanelu);
  }

  /*
   * Zoom dvěma prsty.
   *
   * Vestavěný zoom knihovny je na telefonu příliš citlivý a hlavně: když se
   * jeden prst zvedne dřív než druhý, zbylý prst okamžitě pokračuje jako
   * posun a obraz odskočí. Prsty nejde z displeje sundat současně, takže se
   * to dělo skoro pokaždé.
   *
   * Řešení: po dobu gesta dvěma prsty vypneme posun i zoom knihovny a šířku
   * svíčky nastavujeme sami s útlumem. Po zvednutí prvního prstu zůstává
   * posun vypnutý, dokud nezmizí i ten druhý.
   */
  const UTLUM_ZOOMU = 0.55;      // 1 = původní citlivost, méně = klidnější
  const SIRKA_SVICE_MIN = 1;
  const SIRKA_SVICE_MAX = 50;

  function zapojZoomDvemaPrsty() {
    let vychoziVzdalenost = 0;
    let vychoziSirka = 0;
    let stiskaji = false;

    const vzdalenost = (dotyky) => {
      const dx = dotyky[0].clientX - dotyky[1].clientX;
      const dy = dotyky[0].clientY - dotyky[1].clientY;
      return Math.hypot(dx, dy);
    };

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length < 2) return;
      stiskaji = true;
      vychoziVzdalenost = vzdalenost(e.touches);
      vychoziSirka = chart.getBarSpace().bar;
      chart.setScrollEnabled(false);
      chart.setZoomEnabled(false);
    }, { passive: true });

    container.addEventListener('touchmove', (e) => {
      if (!stiskaji || e.touches.length < 2 || vychoziVzdalenost <= 0) return;
      const pomer = vzdalenost(e.touches) / vychoziVzdalenost;
      // Mocnina menší než 1 stlačí velké i malé změny k sobě: prst ujede
      // stejně, ale graf se zvětší méně.
      const tlumeny = Math.pow(pomer, UTLUM_ZOOMU);
      const sirka = Math.min(SIRKA_SVICE_MAX,
                             Math.max(SIRKA_SVICE_MIN, vychoziSirka * tlumeny));
      chart.setBarSpace(sirka);
    }, { passive: true });

    const konec = (e) => {
      if (!stiskaji) return;
      // Teprve až je pryč i poslední prst. Jinak by zbylý palec rozjel posun.
      if (e.touches && e.touches.length > 0) return;
      stiskaji = false;
      vychoziVzdalenost = 0;
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
    };
    document.addEventListener('touchend', konec, { passive: true });
    document.addEventListener('touchcancel', konec, { passive: true });
  }
  zapojZoomDvemaPrsty();

  function oddelGestaOsy() {
    const osa = chart.getDom(HLAVNI_PANEL, 'yAxis');
    if (!osa) return;
    let drziOsu = false;

    osa.addEventListener('touchstart', () => {
      drziOsu = true;
      chart.setScrollEnabled(false);
      chart.setZoomEnabled(false);
    }, { passive: true });

    const pust = () => {
      if (!drziOsu) return;
      drziOsu = false;
      chart.setScrollEnabled(true);
      chart.setZoomEnabled(true);
    };
    document.addEventListener('touchend', pust, { passive: true });
    document.addEventListener('touchcancel', pust, { passive: true });
  }
  setTimeout(oddelGestaOsy, 0);

  const observer = new ResizeObserver(() => {
    chart.resize();
    srovnejVyskyPanelu();
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
          /*
           * ⚠ Kresby a čáry se musí vrátit **ve stejném průchodu jako data**,
           * ne přes `setTimeout`. Odklad znamená snímek, ve kterém graf už
           * nové svíčky má, ale kresby ještě ne — a ty na okamžik probliknou
           * pryč. Srovnání pohledu odložit smí, to se na vzhledu neprojeví.
           */
          if (prepinaSeInterval) {
            prepinaSeInterval = false;
            vykresliKresby(zalohaKreseb);
            vykresliCary(posledniCary);
            vykresliAlarmy(posledniAlarmy);
          }
          umistiVrstvu();
          srovnejAzPoVykresleni();
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

    /**
     * Při změně intervalu se čáry i kresby nejdřív sundají. Jinak se na
     * chvilku přepočítají na staré svíčky, poskočí, a teprve pak naskočí
     * nová data — což vypadalo rozbitě.
     */
    setInterval(interval) {
      delkaObdobi = DELKA_OBDOBI[interval] || DELKA_OBDOBI['15'];
      /*
       * ⚠ Na stejné období knihovna znovu nesáhne pro data — `getBars` se
       * nezavolá a kresby by neměl kdo vrátit. Sundávat je tedy nesmíme.
       * Pohled ale srovnat chceme: sem se při stejném intervalu dostane jen
       * otevření grafu, a to má vždy začít u posledních svíček.
       */
      if (interval === posledniInterval) {
        srovnejAzPoVykresleni();
        return;
      }
      posledniInterval = interval;
      /*
       * ⚠ Snímek kreseb se bere jen jednou, při prvním přepnutí. Při rychlém
       * proklikávání timeframů je graf už vyprázdněný předchozím přepnutím,
       * takže druhý snímek by byl prázdný a obnovilo by se „nic". Kresby pak
       * na obrazovce zmizely, ač v úložišti zůstaly.
       */
      if (!prepinaSeInterval) {
        zalohaKreseb = chart
          .getOverlays({ groupId: SKUPINA_KRESBY })
          .map((o) => ({ name: o.name, points: o.points, style: o.extendData }));
      }
      prepinaSeInterval = true;
      chart.removeOverlay({ groupId: SKUPINA_POZICE });
      chart.removeOverlay({ groupId: SKUPINA_KRESBY });
      chart.removeOverlay({ groupId: SKUPINA_ALARMY });
      idCarPozice = [];
      chart.setPeriod(OBDOBI[interval] || OBDOBI['15']);
    },

    /** Odpočet tiká jen s otevřeným grafem, ať nežere baterku na pozadí. */
    setTicking(zapnuto) {
      clearInterval(tikani);
      tikani = null;
      if (zapnuto) tikani = setInterval(() => chart.resize(), 1000);
    },

    /**
     * Živá svíčka z burzy.
     *
     * ⚠ Knihovna chce pole **`timestamp`**, zatímco modul Bybitu mluví o
     * `time`. Svíčku s cizím názvem pole **tiše zahodí** — nic nevypíše,
     * jen se nic nestane. Graf pak vypadá, že živé svíčky neumíme, a cena
     * naskočí až po přenačtení dat. Ověřeno měřením: s `time` zůstala
     * poslední cena 0.3, s `timestamp` se změnila.
     */
    updateCandle(bar) {
      if (!bar) return;
      zivyCallback?.({
        timestamp: bar.timestamp ?? bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
    },

    /* ---------- čáry pozice ---------- */

    setPositionLines(lines) {
      posledniCary = lines;
      // Během přepínání intervalu se nekreslí — vrátí se až s novými daty.
      if (!prepinaSeInterval) vykresliCary(lines);
    },

    /* ---------- hladiny alarmů ---------- */

    setAlarmLines(seznam) {
      posledniAlarmy = seznam || [];
      if (!prepinaSeInterval) vykresliAlarmy(posledniAlarmy);
    },

    /* ---------- značky plnění při prohlížení obchodu ---------- */

    setTradeMarks(znacky) {
      chart.removeOverlay({ groupId: SKUPINA_ZNACKY });
      (znacky || []).forEach((z) => {
        chart.createOverlay({
          name: 'tradeMark',
          groupId: SKUPINA_ZNACKY,
          points: [{ timestamp: z.time, value: z.price }],
          lock: true,
          extendData: { vstup: z.vstup, color: z.color, title: z.title },
        });
      });
    },

    clearTradeMarks() {
      chart.removeOverlay({ groupId: SKUPINA_ZNACKY });
    },

    /** Posune pohled na dobu obchodu. */
    scrollToTime(timestamp) {
      chart.scrollToTimestamp(timestamp, 0);
    },

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

    /**
     * Vybrání jedné hladiny křížem — stejné ovládání jako kreslení, jen
     * z něj nevznikne kresba, ale hodnota pro alarm. Číselník na telefonu
     * nikdo nechce vyťukávat.
     */
    pickPrice(popis, hotovo) {
      rozdelanyNastroj = null;
      dodatekKresby = null;
      upravovanaKresba = null;
      vyberBodu = hotovo;
      umistiVrstvu();
      kresleni.beginCreate(1, popis);
    },

    cancelDrawing() {
      if (kresleni.isActive()) kresleni.cancel();
      rozdelanyNastroj = null;
      dodatekKresby = null;
      vyberBodu = null;
      upravovanaKresba = null;
    },

    setMagnet(zapnuto) {
      magnet = zapnuto;
    },

    getDrawings() {
      return chart
        .getOverlays({ groupId: SKUPINA_KRESBY })
        .map((o) => ({ id: o.id, name: o.name, points: o.points, style: o.extendData }));
    },

    restoreDrawings(kresby) {
      zalohaKreseb = kresby || [];
      vykresliKresby(zalohaKreseb);
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

    /**
     * Tvar, body a vzhled vybrané kresby — podklad pro alarm, který z ní
     * vznikne. Barva se přenáší, aby alarm zůstal tou čárou, kterou
     * uživatel nakreslil, jen jinak čárkovanou.
     */
    selectedDrawing() {
      if (!upravovanaKresba) return null;
      return {
        name: upravovanaKresba.name,
        points: upravovanaKresba.points,
        style: vybranyStyl(),
      };
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
      pouzijNastaveni(nazev);
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
        if (!id) return;
        pouzijNastaveni(nazev);
        aktivniIndikatory.add(nazev);
      });
      setTimeout(umistiVrstvu, 0);
    },

    /** Promítne uložené nastavení do běžícího indikátoru. */
    applyIndicatorSettings(nazev) {
      if (!aktivniIndikatory.has(nazev)) return;
      pouzijNastaveni(nazev);
    },

    activeIndicators() {
      return [...aktivniIndikatory];
    },

    destroy() {
      clearInterval(tikani);
      observer.disconnect();
      K().dispose(container);
    },
  };
}
