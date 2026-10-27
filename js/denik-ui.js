/*
 * Okna deníku obchodů: jedno okno s částmi Plan (setup, signály,
 * jistota, poznámky během obchodu) a Review (zhodnocení po zavření),
 * tlačítka Plan / Review na kartách (v0.67.0). Model v denik.js,
 * katalog setupů a signálů s kresbami v denik-katalog.js.
 *
 * Okno se staví při každém otevření znovu (jeden `.sheet` v body).
 * ⚠ Klepnutí v souhrnu na kartě nesmí probublat — karta by otevřela graf.
 */
import * as denik from './denik.js';
import { t, getLocale } from './i18n.js';
import { formatPrice, formatSize, formatUsd, formatSignedUsd } from './format.js';
import { SKUPINY, SKUPINY_SIGNALU, svg } from './denik-katalog.js';
import { CHYBY, EMOCE } from './denik-statistiky.js';

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
  document.querySelectorAll('.denik-vrstva').forEach((x) => x.remove());
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

/* ---------- dlaždice setupů a signálů (v0.67.0) ---------- */

/**
 * Detail položky přes okno: velká kresba, popis, kdy platí, použití.
 * Druhá vrstva nad oknem deníku (`.denik-vrstva`), klepnutí kamkoli zavře.
 */
function ukazVrstvu(obsah, zavritKlepnutim = true) {
  const vrstva = el('div', 'denik-vrstva');
  const karta = el('div', 'denik-vrstva-karta');
  karta.append(...obsah);
  vrstva.append(karta);
  const otevrenaV = Date.now();
  vrstva.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() - otevrenaV < 350) return;
    if (zavritKlepnutim || e.target === vrstva) vrstva.remove();
  });
  document.body.append(vrstva);
  return vrstva;
}

const barvaSkupiny = (s) => SKUPINY[s] || SKUPINY.uroven;

function kresbaPolozky(p, trida) {
  const obal = el('div', trida);
  if (p.kresba) obal.innerHTML = svg(p.kresba);
  else obal.append(el('span', 'denik-pismeno', (p.nazev || '?').slice(0, 1).toUpperCase()));
  return obal;
}

export function ukazDetail(typ, p) {
  const titul = el('div', 'denik-detail-titul');
  const skup = el('span', 'denik-detail-skupina', t(`journal.group.${p.skupina}`));
  skup.style.setProperty('--c', barvaSkupiny(p.skupina));
  titul.append(el('b', '', p.nazev), skup);
  const obsah = [titul, kresbaPolozky(p, 'denik-detail-kresba')];
  obsah.push(el('p', 'denik-detail-popis', p.popis || t('journal.ownNoHint')));
  if (p.kdy) {
    const kdy = el('p', 'denik-detail-kdy');
    kdy.append(el('span', '', `${t('journal.whenLabel')}: `), document.createTextNode(p.kdy));
    obsah.push(kdy);
  }
  if (p.pocet) obsah.push(el('p', 'hint', t('journal.usedN', { n: p.pocet })));
  ukazVrstvu(obsah);
}

/** Okno vlastní položky: nová (`p` null) nebo úprava existující. */
function oknoVlastni(typ, p, hotovo) {
  const signal = typ === 'signaly';
  const nazevPole = el('input', 'denik-pole');
  nazevPole.type = 'text';
  nazevPole.maxLength = 40;
  nazevPole.value = p?.nazev || '';
  nazevPole.placeholder = t('journal.ownName');
  const napoveda = textPole(p?.napoveda || '', t('journal.ownHint'));
  napoveda.maxLength = 200;
  napoveda.rows = 2;
  let skupina = p?.skupina && p.skupina !== 'setup' ? p.skupina : 'uroven';
  const obsah = [el('b', 'denik-vrstva-nadpis', t(signal ? 'journal.ownTitleSignal' : 'journal.ownTitleSetup')),
    skupinaPole(t('journal.ownName'), nazevPole)];
  if (signal) {
    const radek = el('div', 'denik-skupiny');
    SKUPINY_SIGNALU.forEach((s) => {
      const b = tlacitko(t(`journal.group.${s}`), `denik-skupina-btn${s === skupina ? ' on' : ''}`, () => {
        skupina = s;
        radek.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.s === s));
      });
      b.dataset.s = s;
      b.style.setProperty('--c', barvaSkupiny(s));
      radek.append(b);
    });
    obsah.push(skupinaPole(t('journal.ownGroup'), radek));
  }
  obsah.push(napoveda);
  const tlac = el('div', 'denik-tlacitka');
  if (p) {
    tlac.append(tlacitko(t('journal.ownDelete'), 'secondary-btn denik-odebrat', () => {
      denik.smazPolozku(typ, p.id);
      vrstva.remove();
      hotovo(null, p.id);
    }));
  }
  tlac.append(tlacitko(t('journal.ownSave'), 'primary-btn', () => {
    if (!nazevPole.value.trim()) { nazevPole.focus(); return; }
    let id = p?.id;
    if (p) denik.upravPolozku(typ, p.id, { nazev: nazevPole.value, skupina, napoveda: napoveda.value });
    else id = denik.pridejPolozku(typ, { nazev: nazevPole.value, skupina, napoveda: napoveda.value });
    vrstva.remove();
    hotovo(id);
  }));
  obsah.push(tlac);
  const vrstva = ukazVrstvu(obsah, false);
  vrstva.classList.add('denik-vrstva-formular');
  setTimeout(() => { if (!p) nazevPole.focus(); }, 60);
}

function skupinaPole(nadpis, ...obsah) {
  const s = el('label', 'denik-skupina');
  s.append(el('span', 'denik-label', nadpis), ...obsah);
  return s;
}

/**
 * Mřížka dlaždic. `vyber` = Set id; `jeden` = setup (jen jeden, nebo
 * „No setup"). Pořadí podle použití se určí jednou (při otevření okna) —
 * pod prstem nic neuskočí. Klepnutí = vybrat, ⓘ nebo podržení = detail.
 */
function dlazdice(typ, poradi, vyber, jeden, poZmene) {
  const obal = el('div', 'denik-mrizka-obal');
  let uprava = false;
  const mrizka = el('div', `denik-mrizka denik-${typ}`);

  const vykresli = () => {
    mrizka.replaceChildren();
    mrizka.classList.toggle('uprava', uprava);
    if (jeden && !uprava) {
      const nic = tlacitko(t('journal.noSetup'), `denik-tile denik-nic${vyber.size ? '' : ' on'}`, () => {
        vyber.clear();
        vykresli();
        poZmene();
      });
      mrizka.append(nic);
    }
    poradi.forEach((p) => {
      const tile = el('button', `denik-tile${vyber.has(p.id) ? ' on' : ''}`);
      tile.type = 'button';
      tile.dataset.id = p.id;
      tile.style.setProperty('--c', barvaSkupiny(p.skupina));
      tile.append(kresbaPolozky(p, 'denik-tile-kresba'), el('span', 'denik-tile-nazev', p.kratky || p.nazev));
      const info = el('span', 'denik-tile-info', uprava ? '✕' : 'i');
      info.setAttribute('role', 'button');
      info.setAttribute('aria-label', uprava ? t('journal.ownDelete') : p.nazev);
      tile.append(info);
      let drzeni = null;
      let detailUkazan = false;
      tile.addEventListener('touchstart', () => {
        detailUkazan = false;
        drzeni = setTimeout(() => { detailUkazan = true; ukazDetail(typ, p); }, 500);
      }, { passive: true });
      const zrus = () => clearTimeout(drzeni);
      tile.addEventListener('touchmove', zrus, { passive: true });
      tile.addEventListener('touchend', zrus);
      tile.addEventListener('touchcancel', zrus);
      tile.addEventListener('contextmenu', (e) => e.preventDefault());
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        if (detailUkazan) { detailUkazan = false; return; }
        if (e.target === info) {
          if (!uprava) { ukazDetail(typ, p); return; }
          denik.smazPolozku(typ, p.id);
          vyber.delete(p.id);
          poradi.splice(poradi.indexOf(p), 1);
          vykresli();
          poZmene();
          return;
        }
        if (uprava) {
          if (!p.vychozi) {
            oknoVlastni(typ, { ...p, napoveda: p.popis }, (id, smazano) => {
              if (smazano) { vyber.delete(smazano); poradi.splice(poradi.indexOf(p), 1); }
              else Object.assign(p, denik.polozka(typ, id));
              vykresli();
              poZmene();
            });
          }
          return;
        }
        if (vyber.has(p.id)) vyber.delete(p.id);
        else {
          if (jeden) vyber.clear();
          vyber.add(p.id);
        }
        vykresli();
        poZmene();
      });
      mrizka.append(tile);
    });
    const vlastni = tlacitko(`+ ${t('journal.own')}`, 'denik-tile denik-vlastni', () => {
      oknoVlastni(typ, null, (id) => {
        if (!id) return;
        if (!poradi.some((x) => x.id === id)) poradi.push({ ...denik.polozka(typ, id), pocet: 0 });
        if (jeden) vyber.clear();
        vyber.add(id);
        vykresli();
        poZmene();
      });
    });
    mrizka.append(vlastni);
    if (uprava) {
      const odebrane = denik.odebraneVychozi(typ);
      if (odebrane.length) {
        const r = el('div', 'denik-odebrane');
        r.append(el('span', 'hint', `${t('journal.removed')}:`));
        odebrane.forEach((p) => r.append(tlacitko(`+ ${p.kratky || p.nazev}`, 'text-btn', () => {
          denik.vratVychozi(typ, p.id);
          poradi.push({ ...p, pocet: 0 });
          vykresli();
        })));
        mrizka.append(r);
      }
    }
  };

  const upravit = tlacitko(t('journal.edit'), 'text-btn denik-upravit', () => {
    uprava = !uprava;
    upravit.textContent = t(uprava ? 'journal.done' : 'journal.edit');
    vykresli();
  });
  vykresli();
  obal.append(mrizka, upravit);
  return obal;
}

/* ---------- okno deníku: Plan | Review ---------- */

/**
 * Jedno okno se dvěma částmi a přepínačem nahoře. Rozepsané změny drží
 * při přepínání; Uložit zapíše, co se změnilo.
 * @param {object} o { klic, nazev, poznamka, automaticky, mena, obchodBezi,
 *   uzavreny, pnl, otevreno, zavreno, cast: 'plan'|'review', onUlozeno }
 */
export function otevriDenik(o) {
  const v = o.poznamka?.vstup || {};
  const z = o.poznamka?.zhodnoceni || {};
  const plan = {
    setup: new Set(v.setup ? [v.setup] : []),
    signaly: new Set(v.signaly || []),
    jistota: v.jistota || null,
    text: textPole(v.text, t('journal.whyNowPh')),
    zmena: false,
  };
  const review = {
    duvod: new Set(z.duvod ? [z.duvod] : []),
    plan: new Set(z.plan ? [z.plan] : []),
    hodnoceni: z.hodnoceni || null,
    chyby: new Set(z.chyby || []),
    emoce: new Set(z.emoce ? [z.emoce] : []),
    lekce: textPole(z.lekce, t('journal.lessonPh')),
    zmena: false,
  };
  const vynechani = { ano: Boolean(o.poznamka?.vynechano), zmena: false };
  plan.text.addEventListener('input', () => { plan.zmena = true; });
  review.lekce.addEventListener('input', () => { review.zmena = true; });
  // Pořadí dlaždic jednou za otevření okna.
  const poradiSetupu = denik.polozky('setupy');
  const poradiSignalu = denik.polozky('signaly');
  const a = { ...(o.automaticky || {}), ...(v.auto || {}) };
  const minSignalu = Number(denik.nastaveni().minSignalu) || 0;
  let cast = o.uzavreny && o.cast === 'review' ? 'review' : 'plan';
  let telo = null;

  const castPlan = () => {
    const obsah = [];
    if (v.poZavreni) obsah.push(el('p', 'denik-pozdeji', `⚠ ${t('journal.editedAfterCloseHint')}`));
    const conf = el('span', 'denik-conf');
    const pravidlo = el('div', 'denik-pravidlo');
    const obnovConf = () => {
      const n = plan.signaly.size;
      conf.textContent = t('journal.confluenceN', { n });
      conf.classList.toggle('nula', !n);
      pravidlo.hidden = !(minSignalu && n < minSignalu);
      pravidlo.textContent = t('journal.belowRule', { n: minSignalu });
    };
    obnovConf();
    obsah.push(skupina(t('journal.setupOptional'), dlazdice('setupy', poradiSetupu, plan.setup, true, () => { plan.zmena = true; })));
    const hlava = el('div', 'denik-label-radek');
    hlava.append(el('div', 'denik-label', t('journal.signals')), conf);
    const sig = el('div', 'denik-skupina');
    sig.append(hlava, dlazdice('signaly', poradiSignalu, plan.signaly, false, () => { plan.zmena = true; obnovConf(); }), pravidlo);
    obsah.push(sig,
      skupina(t('journal.confidence'), cisla(plan.jistota, () => plan.jistota, (x) => { plan.jistota = x; plan.zmena = true; })),
      skupina(t('journal.whyNow'), plan.text),
      skupina(t('journal.auto'), auto(a, o.mena || 'USDT')));
    if (!a.sl) obsah.push(el('p', 'hint', t('journal.noSl')));
    const behem = poznamkyBehem(o);
    if (behem) obsah.push(behem);
    return obsah;
  };

  const castReview = () => {
    const vysledek = el('div', 'denik-vysledek');
    const r = denik.vysledekR(o.poznamka, o.pnl);
    const vl = el('div');
    vl.append(el('div', 'hint', t('journal.result')), r === null ? el('div', 'hint', t('journal.noR')) : el('div', `denik-r ${o.pnl >= 0 ? 'up' : 'down'}`, textR(r)));
    const vp = el('div', 'denik-vysledek-vpravo');
    vp.append(el('div', `denik-pnl ${o.pnl >= 0 ? 'up' : 'down'}`, `${formatSignedUsd(o.pnl)} ${o.mena || 'USDT'}`),
      el('div', 'hint', o.otevreno && o.zavreno ? t('journal.held', { d: drzeno(o.zavreno - o.otevreno) }) : ''));
    vysledek.append(vl, vp);
    const metriky = el('div', 'denik-metriky');
    vyplnMetriky(metriky, o);
    const volby = (klice, predpona, vyber, vice = false) => {
      const radek = el('div', 'denik-chips');
      klice.forEach((k) => {
        const b = tlacitko(t(`${predpona}.${k}`), `chip${vyber.has(k) ? ' on' : ''}`, () => {
          const uz = vyber.has(k);
          if (!vice) vyber.clear();
          if (uz) vyber.delete(k); else vyber.add(k);
          review.zmena = true;
          radek.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', vyber.has(x.dataset.k)));
        });
        b.dataset.k = k;
        radek.append(b);
      });
      return radek;
    };
    const chyby = el('div', 'denik-skupina');
    chyby.append(el('div', 'denik-label', t('journal.mistakes')));
    Object.entries(CHYBY).forEach(([skup, ids]) => {
      const r = el('div', 'denik-chyby-radek');
      r.append(el('span', 'denik-chyby-skupina', t(`journal.mistakeGroup.${skup}`)), volby(ids, 'journal.mistake', review.chyby, true));
      chyby.append(r);
    });
    const obsah = [vysledek, metriky,
      skupina(t('journal.exitReason'), volby(['tp', 'sl', 'manualPlan', 'manualEmotion', 'liq'], 'journal.exit', review.duvod)),
      skupina(t('journal.plan'), volby(['yes', 'partly', 'no'], 'journal.planAns', review.plan)),
      chyby,
      skupina(t('journal.emotion'), volby(EMOCE, 'journal.emo', review.emoce)),
      skupina(t('journal.rating'), cisla(review.hodnoceni, () => review.hodnoceni, (x) => { review.hodnoceni = x; review.zmena = true; })),
      skupina(t('journal.lesson'), review.lekce)];
    return obsah;
  };

  const hotovaPlan = () => Boolean(o.poznamka?.vstup);
  const hotovaReview = () => Boolean(o.poznamka?.zhodnoceni);
  const prepinac = el('div', 'denik-prepinac');
  const zalozka = (id, text, hotova, povolena) => {
    const b = tlacitko(`${hotova ? '✓ ' : ''}${text}`, `denik-zalozka${cast === id ? ' on' : ''}${hotova ? ' hotova' : ''}`, () => {
      if (!povolena) {
        b.classList.add('zatrest');
        setTimeout(() => b.classList.remove('zatrest'), 400);
        return;
      }
      cast = id;
      prepinac.querySelectorAll('.denik-zalozka').forEach((x) => x.classList.toggle('on', x.dataset.c === id));
      vykresliTelo();
    });
    b.dataset.c = id;
    b.disabled = !povolena;
    if (!povolena) b.title = t('journal.reviewClosedOnly');
    return b;
  };
  prepinac.append(zalozka('plan', t('journal.planTab'), hotovaPlan(), true),
    zalozka('review', t('journal.reviewTab'), hotovaReview(), Boolean(o.uzavreny)));

  // Nepočítat do statistik: platí pro celý obchod, proto nad částmi.
  const radekVynechani = el('div', 'denik-vynechat');
  const prepVynechani = tlacitko('', 'nastaveni-prepinac', () => {
    vynechani.ano = !vynechani.ano;
    vynechani.zmena = true;
    prepVynechani.setAttribute('aria-pressed', String(vynechani.ano));
    radekVynechani.classList.toggle('on', vynechani.ano);
  });
  prepVynechani.setAttribute('aria-pressed', String(vynechani.ano));
  prepVynechani.setAttribute('aria-label', t('journal.exclude'));
  const textVynechani = el('div', 'denik-vynechat-text');
  textVynechani.append(el('span', '', t('journal.exclude')), el('small', 'hint', t('journal.excludeHint')));
  radekVynechani.append(textVynechani, prepVynechani);
  radekVynechani.classList.toggle('on', vynechani.ano);

  const vykresliTelo = () => {
    const nove = el('div', 'denik-telo');
    nove.append(...(cast === 'plan' ? castPlan() : castReview()));
    if (telo) telo.replaceWith(nove);
    telo = nove;
    okno.scrollTop = 0;
  };

  const ulozit = tlacitko(t('journal.save2'), 'primary-btn denik-ulozit', () => {
    if (plan.zmena) {
      denik.zapis(o.klic, 'vstup', {
        setup: [...plan.setup][0] || null,
        signaly: [...plan.signaly],
        jistota: plan.jistota,
        text: plan.text.value.trim(),
        auto: a,
        riziko: a.riziko || null,
        // Plán psaný se znalostí výsledku: zůstává, ale označený.
        poZavreni: Boolean(v.poZavreni || (o.uzavreny && o.zavreno)),
      });
    }
    if (review.zmena && o.uzavreny) {
      denik.zapis(o.klic, 'zhodnoceni', {
        duvod: [...review.duvod][0] || null,
        plan: [...review.plan][0] || null,
        hodnoceni: review.hodnoceni,
        chyby: [...review.chyby],
        emoce: [...review.emoce][0] || null,
        lekce: review.lekce.value.trim(),
      });
    }
    if (vynechani.zmena) denik.nastavVynechani(o.klic, vynechani.ano);
    zavri();
    if (plan.zmena || review.zmena || vynechani.zmena) o.onUlozeno?.();
  });

  otevri([hlavicka(o.nazev, t('journal.tradePlan')), prepinac, radekVynechani, el('div', 'denik-telo'), ulozit]);
  telo = okno.querySelector('.denik-telo');
  vykresliTelo();
}

/**
 * MFE / MAE: nejlepší a nejhorší cena během obchodu (v R, když plán má
 * SL, jinak v %). `o.metriky()` vrátí slib s { mfe, mae, mfePct, maePct }
 * nebo null — počítá se ze svíček, poprvé chvíli trvá.
 */
function vyplnMetriky(box, o) {
  if (!o.metriky) { box.hidden = true; return; }
  box.replaceChildren(el('span', 'hint', t('journal.mfeLoading')));
  const riziko = Math.abs((o.poznamka?.vstup?.auto?.entry || 0) - (o.poznamka?.vstup?.auto?.sl || 0));
  o.metriky().then((m) => {
    if (!box.isConnected) return;
    if (!m) { box.hidden = true; return; }
    const hodnota = (cena, pct, znamenko) => {
      const text = riziko > 0 ? (cena / riziko).toFixed(1) : pct.toFixed(2);
      return `${Number(text) ? znamenko : ''}${text} ${riziko > 0 ? 'R' : '%'}`;
    };
    const bunka = (popis, text, trida) => {
      const d = el('div', 'denik-metrika');
      d.append(el('span', '', popis), el('b', trida, text));
      return d;
    };
    box.replaceChildren(
      bunka(t('journal.mfe'), hodnota(m.mfe, m.mfePct, '+'), 'up'),
      bunka(t('journal.mae'), hodnota(m.mae, m.maePct, '−'), 'down'),
      el('p', 'hint denik-metriky-pozn', t('journal.mfeHint')),
    );
  }).catch(() => { box.hidden = true; });
}

/** Poznámky během obchodu (jen u obchodu, který běží nebo je už má). */
function poznamkyBehem(o) {
  const behem = o.poznamka?.behem || [];
  if (!o.obchodBezi && !behem.length) return null;
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
  if (!o.obchodBezi) return skupina(t('journal.during'), seznam);
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
  return skupina(t('journal.during'), seznam, nova);
}

/* ---------- tlačítka Plan / Review na kartách ---------- */

/**
 * Řádek na kartě pozice / obchodu: tlačítko Plan (✓ vyplněný), u obchodu
 * v Journalu i Review (zašedlé, dokud obchod běží; tečka = čeká na
 * zhodnocení) a krátký souhrn plánu („Retest · 3 signals").
 * ⚠ Klepnutí nesmí probublat — karta by otevřela graf.
 */
export function tlacitka(poznamka, { review = false, uzavreny = false, cekaReview = false, onPlan, onReview } = {}) {
  const radek = el('div', 'denik-radek');
  const v = poznamka?.vstup;
  const z = poznamka?.zhodnoceni;
  const vynechano = Boolean(poznamka?.vynechano);
  // Vynechaný obchod na zhodnocení nečeká (žádné žluté tlačítko).
  if (vynechano) cekaReview = false;
  const btn = (text, hotovo, akce, trida = '') => {
    const b = tlacitko(`${hotovo ? '✓' : '＋'} ${text}`, `denik-btn${hotovo ? ' hotovo' : ''} ${trida}`.trim(), akce);
    return b;
  };
  radek.append(btn(t('journal.planBtn'), Boolean(v), () => onPlan?.(), 'denik-btn-plan'));
  if (review) {
    const b = btn(t('journal.reviewBtn'), Boolean(z), () => { if (uzavreny) onReview?.(); }, `denik-btn-review${uzavreny ? '' : ' zasedle'}${cekaReview && uzavreny && !z ? ' ceka' : ''}`);
    if (!uzavreny) b.setAttribute('aria-disabled', 'true');
    radek.append(b);
  }
  if (vynechano) {
    // Klepnutí otevře okno, kde jde vynechání zrušit.
    radek.append(tlacitko(t('journal.excluded'), 'denik-vynechano', () => onPlan?.()));
  }
  if (v) {
    const casti = [];
    if (v.setup) casti.push(denik.nazev('setupy', v.setup));
    const n = v.signaly?.length || 0;
    if (n) casti.push(n === 1 ? t('journal.oneSignal') : t('journal.nSignals', { n }));
    if (z?.plan) casti.push(t(`journal.planShort.${z.plan}`));
    if (z?.hodnoceni) casti.push(`★ ${z.hodnoceni}`);
    const s = el('span', 'denik-shrnuti', casti.join(' · '));
    if (v.poZavreni) s.append(el('span', 'denik-pozde', t('journal.editedAfterClose')));
    radek.append(s);
  }
  return radek;
}

/* ---------- filtry v Trades (v0.68.0) ---------- */

/**
 * Okno filtrů. Každé klepnutí se projeví hned (`onZmena`), tlačítko dole
 * ukazuje, kolik obchodů projde (`pocet(f)`), a okno zavře.
 * @param {object} o { filtr, onZmena(f), pocet(f) }
 */
export function otevriFiltry(o) {
  const f = JSON.parse(JSON.stringify(o.filtr || {}));
  // Období je v okně text (data-h), ven jde jako číslo dní.
  if (f.obdobi) f.obdobi = String(f.obdobi);
  const ven = () => ({ ...JSON.parse(JSON.stringify(f)), obdobi: Number(f.obdobi) || 0 });
  const ukaz = tlacitko('', 'primary-btn denik-ulozit', zavri);
  const popisTlacitka = () => {
    const n = o.pocet(ven());
    ukaz.textContent = t(n === 1 ? 'journal.f.show1' : 'journal.f.show', { n });
  };
  const obnov = () => {
    popisTlacitka();
    o.onZmena(ven());
  };

  // Jedna volba (klepnutí na vybranou ji zruší) nebo víc voleb.
  const volby = (klic, hodnoty, vice) => {
    const radek = el('div', 'denik-chips');
    const vybrana = (h) => (vice ? (f[klic] || []).includes(h) : f[klic] === h);
    hodnoty.forEach(([h, text, barva]) => {
      const b = tlacitko(text, `chip${vybrana(h) ? ' on' : ''}`, () => {
        if (vice) {
          const s = new Set(f[klic] || []);
          if (s.has(h)) s.delete(h); else s.add(h);
          f[klic] = [...s];
        } else f[klic] = f[klic] === h ? '' : h;
        radek.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', vybrana(x.dataset.h)));
        obnov();
      });
      b.dataset.h = h;
      if (barva) {
        b.classList.add('chip-barva');
        b.style.setProperty('--c', barva);
      }
      radek.append(b);
    });
    return radek;
  };

  const setupy = [['-', t('journal.noSetup')], ...denik.polozky('setupy').map((p) => [p.id, p.kratky || p.nazev, SKUPINY.setup])];
  const signaly = denik.polozky('signaly').map((p) => [p.id, p.kratky || p.nazev, SKUPINY[p.skupina]]);
  const obsah = [
    hlavicka(t('journal.filters'), ''),
    skupina(t('journal.f.period'), volby('obdobi', [[7, '7 d'], [30, '30 d'], [90, '90 d']].map(([d, x]) => [String(d), x]), false)),
    skupina(t('journal.f.result'), volby('vysledek', [['win', t('journal.f.win')], ['loss', t('journal.f.loss')]], false)),
    skupina(t('journal.f.status'), volby('stav', [['open', t('journal.f.open')], ['closed', t('journal.f.closed')]], false)),
    skupina(t('journal.setup'), volby('setupy', setupy, true)),
    skupina(t('journal.signals'), volby('signaly', signaly, true)),
    skupina(t('journal.f.conf'), volby('conf', [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3+']], true)),
    skupina(t('journal.plan'), volby('plan', [['yes', t('journal.planAns.yes')], ['partly', t('journal.planAns.partly')], ['no', t('journal.planAns.no')], ['none', t('journal.f.planNone')]], true)),
    skupina(t('journal.reviewTab'), volby('review', [['done', t('journal.f.reviewDone')], ['missing', t('journal.f.reviewMissing')], ['excluded', t('journal.excluded')]], false)),
    skupina(t('journal.mistakes'), volby('chyby', [['none', t('journal.f.noMistakes')], ...Object.values(CHYBY).flat().map((c) => [c, t(`journal.mistake.${c}`)])], true)),
    skupina(t('journal.emotion'), volby('emoce', EMOCE.map((e) => [e, t(`journal.emo.${e}`)]), true)),
    skupina(t('journal.f.held'), volby('drzeni', [['h', '< 1 h'], ['d', '1 h – 1 d'], ['w', '1–7 d'], ['m', '> 7 d']], true)),
  ];
  const radek = el('div', 'denik-tlacitka');
  radek.append(tlacitko(t('journal.f.reset'), 'secondary-btn', () => {
    Object.keys(f).forEach((k) => delete f[k]);
    obnov();
    otevriFiltry({ ...o, filtr: {} });
  }), ukaz);
  obsah.push(radek);
  otevri(obsah);
  popisTlacitka();
}
