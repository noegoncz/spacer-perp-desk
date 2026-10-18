/*
 * Okna deníku obchodů (v0.61.0): poznámka při vstupu, poznámky během
 * obchodu, zhodnocení po zavření a krátký souhrn na kartách pozic
 * a v Historii. Model a úložiště jsou v denik.js.
 *
 * Okno se staví při každém otevření znovu (jeden `.sheet` v body).
 * ⚠ Klepnutí v souhrnu na kartě nesmí probublat — karta by otevřela graf.
 */
import * as denik from './denik.js';
import { t, getLocale } from './i18n.js';
import { formatPrice, formatSize, formatUsd, formatSignedUsd } from './format.js';

let pozadi = null;
let okno = null;
let otevrenoV = 0;

const el = (tag, trida = '', text = '') => {
  const e = document.createElement(tag);
  if (trida) e.className = trida;
  if (text) e.textContent = text;
  return e;
};

function tlacitko(text, trida, akce) {
  const b = el('button', trida, text);
  b.type = 'button';
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    akce(e);
  });
  return b;
}

function pripravOkno() {
  if (okno) return;
  pozadi = el('div', 'sheet-backdrop feedback-backdrop');
  pozadi.hidden = true;
  // Klepnutí, které okno otevřelo, dojde jako click až po otevření.
  pozadi.addEventListener('click', () => { if (Date.now() - otevrenoV > 400) zavri(); });
  okno = el('div', 'sheet feedback-sheet denik-sheet');
  okno.hidden = true;
  okno.setAttribute('role', 'dialog');
  document.body.append(pozadi, okno);
}

export function zavri() {
  if (!okno) return;
  okno.hidden = true;
  pozadi.hidden = true;
}

export const jeOtevrene = () => Boolean(okno && !okno.hidden);

function otevri(obsah) {
  pripravOkno();
  okno.replaceChildren(...obsah);
  okno.scrollTop = 0;
  okno.hidden = false;
  pozadi.hidden = false;
  otevrenoV = Date.now();
}

function hlavicka(nadpis, podnadpis) {
  const h = el('div', 'sheet-head');
  const vlevo = el('div', 'denik-titul');
  vlevo.append(el('span', '', nadpis), el('span', 'denik-pod', podnadpis));
  const krizek = tlacitko('✕', 'icon-btn', zavri);
  krizek.setAttribute('aria-label', t('action.close'));
  h.append(vlevo, krizek);
  return h;
}

function skupina(nadpis, ...obsah) {
  const s = el('div', 'denik-skupina');
  s.append(el('div', 'denik-label', nadpis), ...obsah);
  return s;
}

/** Řada štítků. `vyber`: Set vybraných; `jeden` = jen jeden vybraný. */
function stitky(polozky, vyber, jeden, seznam = null, prekresli = null) {
  const radek = el('div', 'denik-chips');
  const upravuji = Boolean(seznam && radek.dataset);
  polozky.forEach((p) => {
    const b = tlacitko(p, `chip${vyber.has(p) ? ' on' : ''}`, () => {
      if (vyber.has(p)) vyber.delete(p);
      else {
        if (jeden) vyber.clear();
        vyber.add(p);
      }
      radek.querySelectorAll('.chip[data-p]').forEach((x) => x.classList.toggle('on', vyber.has(x.dataset.p)));
    });
    b.dataset.p = p;
    radek.append(b);
  });
  if (upravuji) {
    // Úprava seznamu: ✕ u položek a pole pro novou.
    const uprava = tlacitko(t('journal.edit'), 'chip pridat', () => {
      const edit = !radek.classList.contains('uprava');
      radek.classList.toggle('uprava', edit);
      uprava.textContent = t(edit ? 'journal.done' : 'journal.edit');
      radek.querySelectorAll('.chip[data-p]').forEach((x) => {
        x.querySelector('.denik-smazat')?.remove();
        if (edit) {
          const sm = el('span', 'denik-smazat', '✕');
          sm.addEventListener('click', (e) => {
            e.stopPropagation();
            denik.upravSeznam(seznam, x.dataset.p, false);
            vyber.delete(x.dataset.p);
            x.remove();
          });
          x.append(sm);
        }
      });
      novy.hidden = !edit;
    });
    const novy = el('div', 'denik-novy');
    novy.hidden = true;
    const vstup = el('input', 'denik-pole');
    vstup.type = 'text';
    vstup.maxLength = 40;
    vstup.placeholder = t('journal.newItemPh');
    const pridat = tlacitko(t('journal.addItem'), 'secondary-btn', () => {
      const text = vstup.value.trim();
      if (!text) return;
      denik.upravSeznam(seznam, text, true);
      vyber.add(text);
      prekresli?.();
    });
    vstup.addEventListener('keydown', (e) => { if (e.key === 'Enter') pridat.click(); });
    novy.append(vstup, pridat);
    radek.append(uprava);
    const obal = el('div');
    obal.append(radek, novy);
    return obal;
  }
  return radek;
}

function cisla(hodnota, vybrana, nastav) {
  const radek = el('div', 'denik-cisla');
  for (let i = 1; i <= 5; i += 1) {
    const b = tlacitko(String(i), `denik-cislo${vybrana() === i ? ' on' : ''}`, () => {
      nastav(vybrana() === i ? null : i);
      radek.querySelectorAll('.denik-cislo').forEach((x, j) => x.classList.toggle('on', vybrana() === j + 1));
    });
    radek.append(b);
  }
  return radek;
}

function textPole(hodnota, ph) {
  const a = el('textarea', 'feedback-text denik-text');
  a.value = hodnota || '';
  a.placeholder = ph;
  a.maxLength = 1000;
  a.rows = 3;
  return a;
}

function auto(a, mena) {
  const m = el('div', 'denik-auto');
  const pol = (popis, hodnota) => {
    if (hodnota === null || hodnota === undefined || hodnota === '') return;
    const d = el('div');
    d.append(el('span', '', popis), el('b', '', hodnota));
    m.append(d);
  };
  pol(t('journal.entry'), a.entry ? formatPrice(a.entry) : null);
  pol(t('journal.sl'), a.sl ? formatPrice(a.sl) : null);
  pol(t('journal.tp'), a.tp ? formatPrice(a.tp) : null);
  pol(t('journal.risk'), a.riziko ? `${formatUsd(a.riziko)} ${mena}` : null);
  pol(t('journal.rr'), a.rr ? `1 : ${formatSize(Math.round(a.rr * 10) / 10)}` : null);
  pol(t('journal.tf'), a.interval ? popisIntervalu(a.interval) : null);
  return m;
}

const popisIntervalu = (i) => ({ 1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1h', 240: '4h', D: '1D', W: '1W', M: '1M' }[i] || String(i));

function cas(ms) {
  return new Date(ms).toLocaleString(getLocale(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Doba držení: „1 d 6 h", „5 h 20 m", „40 m". */
export function drzeno(ms) {
  if (!(ms > 0)) return '';
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m % 60} m`;
  return `${m} m`;
}

export const textR = (r) => (r === null || !Number.isFinite(r) ? '' : `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)} R`);

/* ---------- poznámka při vstupu (a během obchodu) ---------- */

/**
 * @param {object} o { klic, nazev, poznamka, automaticky, mena, obchodBezi, onUlozeno }
 */
export function otevriVstup(o) {
  const v = o.poznamka?.vstup || {};
  const setup = new Set(v.setup ? [v.setup] : []);
  const conf = new Set(v.confluence || []);
  let jistota = v.jistota || null;
  const text = textPole(v.text, t('journal.whyNowPh'));
  const a = { ...(o.automaticky || {}), ...(v.auto || {}) };

  const prekresli = () => otevriVstup({ ...o, poznamka: { ...o.poznamka, vstup: { ...v, setup: [...setup][0] || null, confluence: [...conf], jistota, text: text.value } } });

  const obsah = [
    hlavicka(t('journal.whyTitle'), o.nazev),
    skupina(t('journal.setup'), stitky(denik.setupy(), setup, true, 'setupy', prekresli)),
    skupina(t('journal.confluence'), stitky(denik.confluence(), conf, false, 'confluence', prekresli)),
    skupina(t('journal.confidence'), cisla(jistota, () => jistota, (x) => { jistota = x; })),
    skupina(t('journal.whyNow'), text),
  ];
  const autoBlok = auto(a, o.mena || 'USDT');
  obsah.push(skupina(t('journal.auto'), autoBlok));
  if (!a.sl) obsah.push(el('p', 'hint', t('journal.noSl')));

  // Poznámky během obchodu (jen u obchodu, který ještě běží nebo už má vstup).
  const behem = o.poznamka?.behem || [];
  if (o.obchodBezi || behem.length) {
    const seznam = el('div', 'denik-behem');
    behem.forEach((b) => {
      const r = el('div', 'denik-behem-radek');
      r.append(el('b', '', cas(b.cas)), el('span', '', b.text),
        tlacitko('✕', 'text-btn denik-x', () => {
          denik.smazPoznamkuBehem(o.klic, b.cas);
          r.remove();
        }));
      seznam.append(r);
    });
    if (o.obchodBezi) {
      const nova = el('div', 'denik-novy');
      const vstup = el('input', 'denik-pole');
      vstup.type = 'text';
      vstup.maxLength = 300;
      vstup.placeholder = t('journal.duringPh');
      const pridat = tlacitko(t('journal.addNote'), 'secondary-btn', () => {
        if (!vstup.value.trim()) return;
        denik.zapis(o.klic, 'behem', { text: vstup.value });
        const r = el('div', 'denik-behem-radek');
        r.append(el('b', '', cas(Date.now())), el('span', '', vstup.value.trim()));
        seznam.append(r);
        vstup.value = '';
        o.onUlozeno?.();
      });
      vstup.addEventListener('keydown', (e) => { if (e.key === 'Enter') pridat.click(); });
      nova.append(vstup, pridat);
      obsah.push(skupina(t('journal.during'), seznam, nova));
    } else {
      obsah.push(skupina(t('journal.during'), seznam));
    }
  }

  const ulozit = tlacitko(t('journal.save'), 'primary-btn denik-ulozit', () => {
    denik.zapis(o.klic, 'vstup', {
      setup: [...setup][0] || null,
      confluence: [...conf],
      jistota,
      text: text.value.trim(),
      auto: a,
      riziko: a.riziko || null,
    });
    zavri();
    o.onUlozeno?.();
  });
  obsah.push(ulozit);
  otevri(obsah);
}

/* ---------- zhodnocení po zavření ---------- */

/**
 * @param {object} o { klic, nazev, poznamka, pnl, mena, otevreno, zavreno, onUlozeno, onVstup }
 */
export function otevriZhodnoceni(o) {
  const z = o.poznamka?.zhodnoceni || {};
  const duvod = new Set(z.duvod ? [z.duvod] : []);
  const plan = new Set(z.plan ? [z.plan] : []);
  let hodnoceni = z.hodnoceni || null;
  const lekce = textPole(z.lekce, t('journal.lessonPh'));

  const vysledek = el('div', 'denik-vysledek');
  const r = denik.vysledekR(o.poznamka, o.pnl);
  const vl = el('div');
  vl.append(el('div', 'hint', t('journal.result')), r === null ? el('div', 'hint', t('journal.noR')) : el('div', `denik-r ${o.pnl >= 0 ? 'up' : 'down'}`, textR(r)));
  const vp = el('div', 'denik-vysledek-vpravo');
  vp.append(el('div', `denik-pnl ${o.pnl >= 0 ? 'up' : 'down'}`, `${formatSignedUsd(o.pnl)} ${o.mena || 'USDT'}`),
    el('div', 'hint', o.otevreno && o.zavreno ? t('journal.held', { d: drzeno(o.zavreno - o.otevreno) }) : ''));
  vysledek.append(vl, vp);

  const DUVODY = ['tp', 'sl', 'manualPlan', 'manualEmotion', 'liq'];
  const PLANY = ['yes', 'partly', 'no'];
  const volby = (klice, predpona, vyber) => {
    const radek = el('div', 'denik-chips');
    klice.forEach((k) => {
      const b = tlacitko(t(`${predpona}.${k}`), `chip${vyber.has(k) ? ' on' : ''}`, () => {
        const uz = vyber.has(k);
        vyber.clear();
        if (!uz) vyber.add(k);
        radek.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', vyber.has(x.dataset.k)));
      });
      b.dataset.k = k;
      radek.append(b);
    });
    return radek;
  };

  const obsah = [
    hlavicka(t('journal.reviewTitle'), o.nazev),
    vysledek,
  ];
  if (o.poznamka?.vstup) obsah.push(souhrn(o.poznamka, { kompaktni: false }));
  obsah.push(
    skupina(t('journal.exitReason'), volby(DUVODY, 'journal.exit', duvod)),
    skupina(t('journal.plan'), volby(PLANY, 'journal.planAns', plan)),
    skupina(t('journal.rating'), cisla(hodnoceni, () => hodnoceni, (x) => { hodnoceni = x; })),
    skupina(t('journal.lesson'), lekce),
  );
  const radek = el('div', 'denik-tlacitka');
  radek.append(
    tlacitko(t(o.poznamka?.vstup ? 'journal.editEntry' : 'journal.addEntry'), 'secondary-btn', () => o.onVstup?.()),
    tlacitko(t('journal.saveReview'), 'primary-btn denik-ulozit', () => {
      denik.zapis(o.klic, 'zhodnoceni', {
        duvod: [...duvod][0] || null,
        plan: [...plan][0] || null,
        hodnoceni,
        lekce: lekce.value.trim(),
      });
      zavri();
      o.onUlozeno?.();
    }),
  );
  obsah.push(radek);
  otevri(obsah);
}

/* ---------- souhrn na kartě ---------- */

/**
 * Krátký souhrn poznámky pro kartu: setup, počet confluence, jistota,
 * plán a hodnocení, začátek textu. `review` = štítek „Review" (zavřený
 * obchod bez zhodnocení). Bez poznámky tlačítko „Why?".
 */
export function souhrn(poznamka, { review = false, onClick = null, kompaktni = true, pridat = null } = {}) {
  const radek = el('div', 'denik-souhrn');
  const chip = (text, trida = '') => radek.append(el('span', `chip mini ${trida}`.trim(), text));
  const v = poznamka?.vstup;
  const z = poznamka?.zhodnoceni;
  if (review) chip(`● ${t('journal.review')}`, 'denik-review');
  if (!v && !z) {
    if (pridat) radek.append(el('span', 'chip mini pridat', pridat));
  } else {
    radek.append(el('span', 'denik-ikona', '📝'));
    if (v?.setup) chip(v.setup, 'on');
    if (v?.confluence?.length) chip(t('journal.nConf', { n: v.confluence.length }));
    if (v?.jistota) chip(t('journal.confShort', { n: v.jistota }));
    if (z?.plan) chip(t(`journal.planShort.${z.plan}`));
    if (z?.hodnoceni) chip(`★ ${z.hodnoceni}`);
    const text = z?.lekce || v?.text;
    if (text) radek.append(el('span', 'denik-citace', kompaktni ? `„${text.length > 70 ? `${text.slice(0, 70)}…` : text}“` : `„${text}“`));
  }
  if (onClick) {
    radek.setAttribute('role', 'button');
    radek.tabIndex = 0;
    radek.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return radek;
}
