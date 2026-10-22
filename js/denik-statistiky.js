/*
 * Deník, záložka Edge (v0.64.0, fáze 2): souhrn obchodů za období a věty
 * „co mi to o mně říká". Jen výpočty, bez DOM a bez burzy — vstupem jsou
 * složené obchody z Historie (`seskupObchody`) a jejich poznámky z deníku.
 *
 * Návrh schválený uživatelem: https://claude.ai/artifact/N1SiWyTgnoPuRmmmvGzkda
 * (Edge: Net PnL, průměrné R, křivka, úspěšnost, profit factor, dodržení
 * plánu; nejlepší setup, cena porušeného plánu; čekající zhodnocení).
 */

/** Kolik obchodů musí setup mít, aby o něm padla věta. */
export const MIN_OBCHODU_SETUPU = 3;
/** Od kolika signálů je obchod „s vysokou confluence". */
export const VYSOKA_CONFLUENCE = 3;

const skupinaStat = () => ({ pocet: 0, vyhranych: 0, pnl: 0, soucetR: 0, sR: 0 });
function pridej(sk, pnl, r) {
  sk.pocet += 1;
  if (pnl > 0) sk.vyhranych += 1;
  sk.pnl += pnl;
  if (r !== null) { sk.soucetR += r; sk.sR += 1; }
}
const vystup = (sk) => (sk.pocet ? {
  pocet: sk.pocet, uspesnost: sk.vyhranych / sk.pocet, pnl: sk.pnl, prumerR: sk.sR ? sk.soucetR / sk.sR : null,
} : null);

/**
 * obchody: [{ pnl, zavreno, poznamka }] — jen uzavřené, v období.
 * poznamka = výsledek denik.najdi (nebo null).
 */
export function souhrn(obchody) {
  const serazene = [...obchody].sort((a, b) => a.zavreno - b.zavreno);
  let zisky = 0;
  let ztraty = 0;
  let vyhranych = 0;
  let soucetR = 0;
  let sR = 0;
  let planOdpovedi = 0;
  let planAno = 0;
  let bezZhodnoceni = 0;
  let porusenyPlanPnl = 0;
  let porusenyPlanR = 0;
  let porusenych = 0;
  const setupy = new Map();
  const confVysoka = skupinaStat();
  const confNizka = skupinaStat();
  const bezSetupu = skupinaStat();
  const krivka = [];
  let prubezne = 0;

  serazene.forEach((o) => {
    const pnl = Number(o.pnl) || 0;
    if (pnl > 0) { zisky += pnl; vyhranych += 1; } else ztraty += pnl;
    prubezne += pnl;
    krivka.push({ t: o.zavreno, v: prubezne });

    const v = o.poznamka?.vstup;
    const z = o.poznamka?.zhodnoceni;
    const r = v?.riziko > 0 ? pnl / v.riziko : null;
    if (r !== null) { soucetR += r; sR += 1; }
    if (!z) bezZhodnoceni += 1;
    if (z?.plan) {
      planOdpovedi += 1;
      if (z.plan === 'yes') planAno += 1;
      if (z.plan === 'no') {
        porusenych += 1;
        porusenyPlanPnl += pnl;
        if (r !== null) porusenyPlanR += r;
      }
    }
    if (v) {
      const n = v.signaly?.length || 0;
      pridej(n >= VYSOKA_CONFLUENCE ? confVysoka : confNizka, pnl, r);
      if (!v.setup) pridej(bezSetupu, pnl, r);
    }
    if (v?.setup) {
      const s = setupy.get(v.setup) || { nazev: v.setup, pocet: 0, vyhranych: 0, pnl: 0, soucetR: 0, sR: 0 };
      s.pocet += 1;
      if (pnl > 0) s.vyhranych += 1;
      s.pnl += pnl;
      if (r !== null) { s.soucetR += r; s.sR += 1; }
      setupy.set(v.setup, s);
    }
  });

  const pocet = serazene.length;
  const statSetupu = [...setupy.values()].map((s) => ({
    nazev: s.nazev,
    pocet: s.pocet,
    uspesnost: s.vyhranych / s.pocet,
    pnl: s.pnl,
    prumerR: s.sR ? s.soucetR / s.sR : null,
  }));
  return {
    pocet,
    pnl: prubezne,
    uspesnost: pocet ? vyhranych / pocet : null,
    profitFactor: ztraty < 0 ? zisky / -ztraty : (zisky > 0 ? Infinity : null),
    prumerR: sR ? soucetR / sR : null,
    planDodrzen: planOdpovedi ? planAno / planOdpovedi : null,
    bezZhodnoceni,
    krivka,
    setupy: statSetupu,
    confluence: { vysoka: vystup(confVysoka), nizka: vystup(confNizka) },
    bezSetupu: vystup(bezSetupu),
    porusenyPlan: porusenych ? { pocet: porusenych, pnl: porusenyPlanPnl, r: porusenyPlanR } : null,
  };
}

/**
 * Věty pro „Your edge" — jen z dost velkého vzorku, ať appka nevyvozuje
 * závěry ze dvou obchodů. Vrací [{ klic, data }] pro překlad.
 */
export function vety(s) {
  const vysledek = [];
  // Nejlepší setup podle průměrného R (bez R podle zisku), aspoň 3 obchody.
  const kandidati = s.setupy.filter((x) => x.pocet >= MIN_OBCHODU_SETUPU);
  const podleR = kandidati.filter((x) => x.prumerR !== null);
  const nejlepsi = podleR.length
    ? podleR.reduce((a, b) => (b.prumerR > a.prumerR ? b : a))
    : kandidati.reduce((a, b) => (!a || b.pnl > a.pnl ? b : a), null);
  if (nejlepsi && (nejlepsi.prumerR ?? nejlepsi.pnl) > 0) {
    vysledek.push({ klic: nejlepsi.prumerR !== null ? 'bestSetupR' : 'bestSetup', data: nejlepsi });
  }
  // Nejhorší setup, když je ztrátový (a není to ten nejlepší).
  const nejhorsi = (podleR.length ? podleR : kandidati)
    .reduce((a, b) => (!a || (b.prumerR ?? b.pnl) < (a.prumerR ?? a.pnl) ? b : a), null);
  if (nejhorsi && nejhorsi !== nejlepsi && (nejhorsi.prumerR ?? nejhorsi.pnl) < 0) {
    vysledek.push({ klic: nejhorsi.prumerR !== null ? 'worstSetupR' : 'worstSetup', data: nejhorsi });
  }
  // Confluence: obchody s 3+ signály proti ostatním s plánem.
  const { vysoka, nizka } = s.confluence || {};
  if (vysoka?.pocet >= MIN_OBCHODU_SETUPU && nizka?.pocet >= MIN_OBCHODU_SETUPU) {
    vysledek.push({ klic: 'confN', data: { n: VYSOKA_CONFLUENCE, vysoka, nizka } });
  }
  if (s.bezSetupu?.pocet >= MIN_OBCHODU_SETUPU) {
    vysledek.push({ klic: s.bezSetupu.prumerR !== null ? 'noSetupR' : 'noSetup', data: s.bezSetupu });
  }
  if (s.porusenyPlan && s.porusenyPlan.pnl < 0) {
    vysledek.push({ klic: s.porusenyPlan.r < 0 ? 'planCostR' : 'planCost', data: s.porusenyPlan });
  }
  return vysledek;
}
