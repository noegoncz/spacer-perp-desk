/**
 * Dotykové kreslení se zaměřovacím křížem.
 *
 * Vestavěné kreslení knihovny klade body přímo pod prst. Na telefonu to
 * nefunguje: prst zakrývá místo, kam míříš, a klepnutí se často vyhodnotí
 * jako posun grafu. Proto tenhle modul — prst kříž jen **posouvá** (relativně,
 * kdekoli po displeji) a teprve klepnutí bod potvrdí. Stejně to má TabTrader
 * i TradingView na mobilu.
 *
 * O konkrétní knihovně grafu neví nic, převody souřadnic dostane zvenčí.
 */

import { t } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Posun přes tolik pixelů už není klepnutí, ale tažení. */
const PRAH_TAHU = 8;

/** Jak blízko musí klepnutí být, aby se kresba považovala za trefenou. */
const PRAH_ZASAHU = 22;

function svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** Vzdálenost bodu od úsečky — pro trefování kreseb prstem. */
function vzdalenostOdUsecky(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const delka2 = dx * dx + dy * dy;
  if (delka2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / delka2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * @param {object} cfg
 * @param {HTMLElement} cfg.layer   prvek přesně přes plochu grafu
 * @param {Function} cfg.toPixel    {timestamp,value} → {x,y}
 * @param {Function} cfg.fromPixel  (x,y) → {timestamp,value}
 * @param {Function} cfg.onCreate   (body) → hotová nová kresba
 * @param {Function} cfg.onEdit     (index, bod) → posunutý bod hotové kresby
 * @param {Function} cfg.onCancel   uživatel kreslení opustil
 */
export function createTouchDrawing({
  layer,
  toPixel,
  fromPixel,
  snap,
  formatPrice,
  formatTime,
  onCreate,
  onEdit,
  onCancel,
}) {
  const plocha = svg('svg', { class: 'draw-svg' });
  const carySvisla = svg('line', { class: 'draw-cross' });
  const caraVodorovna = svg('line', { class: 'draw-cross' });
  const nahled = svg('polyline', { class: 'draw-preview' });
  // Tečka je schválně malá. Bod se často klade přesně na konec knotu svíčky
  // a musí být vidět, že se ho dotýká — velká tečka by to překryla.
  const tecka = svg('circle', { class: 'draw-dot', r: 3 });
  const prstenec = svg('circle', { class: 'draw-snap', r: 8 });
  // Krátká vlnka po chycení bodu: ukáže, že teď se hýbe prstem kdekoli.
  const vlnka = svg('circle', { class: 'draw-ripple', r: 6 });
  const uchyty = svg('g', {});
  plocha.append(nahled, carySvisla, caraVodorovna, uchyty, vlnka, prstenec, tecka);

  // Návod nahoře a cenovky na osách — bez nich uživatel kreslí naslepo.
  const pruh = document.createElement('div');
  pruh.className = 'draw-banner';
  const pruhText = document.createElement('span');
  const pruhZrusit = document.createElement('button');
  pruhZrusit.type = 'button';
  pruhZrusit.className = 'draw-banner-cancel';
  pruhZrusit.setAttribute('aria-label', t('draw.cancel'));
  pruhZrusit.textContent = '✕';
  pruh.append(pruhText, pruhZrusit);

  const cenovka = document.createElement('div');
  cenovka.className = 'draw-badge draw-badge-price';
  const casovka = document.createElement('div');
  casovka.className = 'draw-badge draw-badge-time';

  layer.append(plocha, pruh, cenovka, casovka);

  pruhZrusit.addEventListener('pointerdown', (e) => e.stopPropagation());
  pruhZrusit.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    konec();
  });

  let rezim = 'idle'; // idle | create | move | handles
  let potreba = 0; // kolik bodů ještě chybí
  let celkem = 0;
  let hotoveBody = []; // už potvrzené body nové kresby (v pixelech)
  let kriz = { x: 0, y: 0 };
  let prichyceno = false; // kříž sedí na ceně svíčky
  let editace = null; // { body, index }
  let smycka = null;
  let vlastniNavod = ''; // přebije text v pruhu, když se neklade bod kresby

  /** Magnet: u svíčky se kříž sám nalepí na otevření, high, low nebo close. */
  function sMagnetem(x, y) {
    const cil = snap?.(x, y);
    prichyceno = Boolean(cil);
    return cil || { x, y };
  }

  function navod() {
    if (rezim === 'create') {
      // Vlastní popisek má přednost — u alarmu se neklade bod kresby,
      // ale hladina, a „1. bod z 1" by uživateli nic neřeklo.
      if (vlastniNavod) return vlastniNavod;
      const cislo = celkem - potreba + 1;
      return potreba === 1 && celkem > 1
        ? t('draw.finish', { n: cislo, total: celkem })
        : t('draw.setPoint', { n: cislo, total: celkem });
    }
    if (rezim === 'move') return t('draw.movePoint');
    if (rezim === 'handles') return t('draw.editHint');
    return '';
  }

  /* ---------- vykreslování ---------- */

  function prekresli() {
    const w = layer.clientWidth;
    const h = layer.clientHeight;
    plocha.setAttribute('viewBox', `0 0 ${w} ${h}`);

    const krizVidet = rezim === 'create' || rezim === 'move';
    [carySvisla, caraVodorovna, tecka].forEach((e) => {
      e.style.display = krizVidet ? '' : 'none';
    });

    pruh.style.display = rezim === 'idle' ? 'none' : '';
    pruhText.textContent = navod();
    cenovka.style.display = krizVidet ? '' : 'none';
    casovka.style.display = krizVidet ? '' : 'none';

    if (krizVidet) {
      // Cenovka na pravém okraji, čas dole — jako na osách v TradingView.
      const bod = fromPixel(kriz.x, kriz.y);
      cenovka.textContent = formatPrice?.(bod.value) ?? '';
      cenovka.style.top = `${kriz.y}px`;
      casovka.textContent = formatTime?.(bod.timestamp) ?? '';
      casovka.style.left = `${kriz.x}px`;
    }

    // Prstenec ukáže, že magnet chytil cenu svíčky.
    prstenec.style.display = krizVidet && prichyceno ? '' : 'none';
    if (krizVidet && prichyceno) {
      prstenec.setAttribute('cx', kriz.x);
      prstenec.setAttribute('cy', kriz.y);
    }

    if (krizVidet) {
      carySvisla.setAttribute('x1', kriz.x);
      carySvisla.setAttribute('x2', kriz.x);
      carySvisla.setAttribute('y1', 0);
      carySvisla.setAttribute('y2', h);
      caraVodorovna.setAttribute('x1', 0);
      caraVodorovna.setAttribute('x2', w);
      caraVodorovna.setAttribute('y1', kriz.y);
      caraVodorovna.setAttribute('y2', kriz.y);
      tecka.setAttribute('cx', kriz.x);
      tecka.setAttribute('cy', kriz.y);
    }

    // Náhled čáry mezi už potvrzenými body a křížem.
    if (rezim === 'create' && hotoveBody.length) {
      const body = [...hotoveBody, kriz].map((b) => `${b.x},${b.y}`).join(' ');
      nahled.setAttribute('points', body);
      nahled.style.display = '';
    } else {
      nahled.style.display = 'none';
    }

    // Úchyty hotové kresby, kterou uživatel vybral k úpravě. Jsou schválně
    // velké a s pulzujícím kruhem kolem — musí být jasné, že se jich má
    // uživatel dotknout, ne že jen označují konce.
    uchyty.replaceChildren();
    if ((rezim === 'handles' || rezim === 'move') && editace) {
      editace.body.forEach((bod, i) => {
        const p = toPixel(bod);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
        if (rezim === 'move' && i === editace.index) return; // ten drží kříž
        const g = svg('g', { class: 'draw-handle-g' });
        g.append(svg('circle', { class: 'draw-handle-halo', cx: p.x, cy: p.y, r: 16 }));
        g.append(svg('circle', { class: 'draw-handle', cx: p.x, cy: p.y, r: 10 }));
        g.append(svg('circle', { class: 'draw-handle-core', cx: p.x, cy: p.y, r: 3.5 }));
        uchyty.append(g);
      });
    }
  }

  /** Vlnka se přehraje jednou; restart vyžaduje sundat a vrátit třídu. */
  function prehrajVlnku(x, y) {
    vlnka.setAttribute('cx', x);
    vlnka.setAttribute('cy', y);
    vlnka.classList.remove('play');
    void vlnka.getBoundingClientRect(); // vynutí reflow, jinak se animace nespustí znovu
    vlnka.classList.add('play');
  }

  /** Při posunu grafu se úchyty musí hýbat s ním. */
  function spustSmycku() {
    if (smycka) return;
    const krok = () => {
      if (rezim === 'handles' || rezim === 'move') {
        prekresli();
        smycka = requestAnimationFrame(krok);
      } else {
        smycka = null;
      }
    };
    smycka = requestAnimationFrame(krok);
  }

  function nastavRezim(novy) {
    rezim = novy;
    // Když nekreslíme, vrstva nesmí brát dotyky — graf se musí dát posouvat.
    layer.style.pointerEvents = novy === 'idle' ? 'none' : 'auto';
    layer.classList.toggle('kresli', novy === 'create' || novy === 'move');
    prekresli();
    if (novy === 'handles' || novy === 'move') spustSmycku();
  }

  /* ---------- ovládání prstem ---------- */

  let start = null;

  layer.addEventListener('pointerdown', (e) => {
    if (rezim === 'idle') return;
    layer.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, kriz: { ...kriz }, tazeno: false };
  });

  layer.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > PRAH_TAHU) start.tazeno = true;

    if (rezim === 'create' || rezim === 'move') {
      // Relativní posun: prst může být kdekoli, kříž se hýbe o stejný kus.
      // Magnet se počítá až z výsledku, ale zpátky do základu se nepropisuje,
      // jinak by kříž po každém přichycení odskakoval.
      kriz = sMagnetem(
        Math.max(0, Math.min(layer.clientWidth, start.kriz.x + dx)),
        Math.max(0, Math.min(layer.clientHeight, start.kriz.y + dy)),
      );
      prekresli();
      // Při úpravě se kresba hýbe rovnou, ať je vidět, jak vypadá celá.
      if (rezim === 'move') zivaUprava(false);
    }
  });

  function zivaUprava(hotovo) {
    if (!editace || editace.index < 0) return;
    const bod = fromPixel(kriz.x, kriz.y);
    editace.body[editace.index] = bod;
    onEdit?.(editace.index, bod, hotovo);
  }

  layer.addEventListener('pointerup', (e) => {
    if (!start) return;
    const tazeno = start.tazeno;
    const bod = { x: e.clientX, y: e.clientY };
    start = null;

    if (tazeno) return; // tažení jen posouvalo, nepotvrzuje

    if (rezim === 'create') {
      potvrdBod();
      return;
    }
    if (rezim === 'move') {
      zivaUprava(true); // tentokrát i ulož
      nastavRezim('handles');
      return;
    }
    if (rezim === 'handles') {
      // Klepnutí na úchyt ho vezme do ruky, klepnutí jinam úpravu ukončí.
      const r = layer.getBoundingClientRect();
      const mx = bod.x - r.left;
      const my = bod.y - r.top;
      const index = editace.body.findIndex((b) => {
        const p = toPixel(b);
        return Math.hypot(p.x - mx, p.y - my) < PRAH_ZASAHU;
      });
      if (index >= 0) {
        editace.index = index;
        const p = toPixel(editace.body[index]);
        kriz = { x: p.x, y: p.y };
        prichyceno = false;
        nastavRezim('move');
        prehrajVlnku(p.x, p.y);
      } else {
        konec();
      }
    }
  });

  function potvrdBod() {
    hotoveBody.push({ ...kriz });
    potreba -= 1;
    if (potreba > 0) {
      prekresli();
      return;
    }
    const body = hotoveBody.map((b) => fromPixel(b.x, b.y));
    hotoveBody = [];
    vlastniNavod = '';
    nastavRezim('idle');
    onCreate?.(body);
  }

  function konec() {
    hotoveBody = [];
    editace = null;
    vlastniNavod = '';
    nastavRezim('idle');
    onCancel?.();
  }

  return {
    /**
     * Spustí kladení bodů křížem. `popis` přebije návod v pruhu — používá
     * ho zadávání alarmu, které bod kresby neklade.
     */
    beginCreate(pocetBodu, popis = '') {
      hotoveBody = [];
      potreba = pocetBodu;
      celkem = pocetBodu;
      editace = null;
      vlastniNavod = popis;
      prichyceno = false;
      kriz = { x: layer.clientWidth / 2, y: layer.clientHeight / 2 };
      nastavRezim('create');
    },

    /** Ukáže úchyty hotové kresby, aby šla upravit. */
    beginEdit(body) {
      editace = { body: [...body], index: -1 };
      nastavRezim('handles');
    },

    cancel: konec,

    isActive() {
      return rezim !== 'idle';
    },

    /** Trefil uživatel prstem některou z kreseb? Vrací její index. */
    hitTest(mx, my, kresby) {
      for (let i = kresby.length - 1; i >= 0; i -= 1) {
        const body = kresby[i].points.map(toPixel);
        if (body.length === 1) {
          // Vodorovné a cenové čáry jdou přes celou šířku.
          if (Math.abs(body[0].y - my) < PRAH_ZASAHU) return i;
          continue;
        }
        for (let j = 0; j < body.length - 1; j += 1) {
          const a = body[j];
          const b = body[j + 1];
          if (vzdalenostOdUsecky(mx, my, a.x, a.y, b.x, b.y) < PRAH_ZASAHU) return i;
        }
      }
      return -1;
    },

    redraw: prekresli,
  };
}
