/**
 * Alarmy hlídané serverem — aby zazněly i se zhasnutým displejem.
 *
 * Když je uživatel přihlášený k účtu a v APK povolil notifikace:
 *  - telefon posílá svůj seznam alarmů na perpyx.com (po každé změně),
 *  - serverový hlídač (server/hlidac.mjs) hlídá ceny nonstop a při
 *    protnutí pošle push přes Firebase,
 *  - telefon si stahuje stav (co mezitím zaznělo) a jednorázové alarmy
 *    vypne stejně jako po zaznění u sebe.
 *
 * Bez účtu nebo bez povolených notifikací se hlídá jako dřív jen v telefonu.
 * ⚠ API klíč se nikam neposílá — hlídač čte jen veřejné ceny.
 */
import * as ucet from './ucet.js';
import * as alarmy from './alarmy.js';
import * as push from './push.js';
import { naZmenuDat } from './store.js';
import { getLanguage } from './i18n.js';

const KLIC_TOKENU = 'perpdesk.pushToken';
const ODKLAD = 2000;
// Když se hlídač neozval déle, než tohle, jeho alarmy se nepočítají za
// spolehlivé (výpadek serveru) — telefon pak hlídá i na pozadí sám.
const HLIDAC_ZIVY = 3 * 60 * 1000;

let stav = { push: 'off', hlidacVidet: null, chyba: null };   // push: off | on | denied | unsupported | error
let casovac = null;
let posledniOdeslane = '';
let handlery = {};
const posluchaci = new Set();

export const naZmenu = (fn) => posluchaci.add(fn);
const ohlas = () => posluchaci.forEach((fn) => fn(stav));
export const stavServeru = () => stav;

/** Hlídá alarmy server? (účet + push + hlídač se nedávno ozval) */
export function hlidaServer() {
  if (!ucet.prihlasen() || stav.push !== 'on') return false;
  return Boolean(stav.hlidacVidet) && Date.now() - new Date(stav.hlidacVidet) < HLIDAC_ZIVY;
}

async function odesli() {
  if (!ucet.prihlasen()) return;
  const seznam = alarmy.vsechny();
  const otisk = JSON.stringify(seznam);
  if (otisk === posledniOdeslane) return;
  try {
    await ucet.api('PUT', '/alarms', { alarms: seznam, lang: getLanguage() || 'en' });
    posledniOdeslane = otisk;
  } catch {
    // Zkusí se při další změně nebo při návratu do aplikace.
  }
}

function naplanuj() {
  clearTimeout(casovac);
  casovac = setTimeout(odesli, ODKLAD);
}

/**
 * Stáhne ze serveru, co mezitím zaznělo, a promítne to do alarmů v telefonu.
 * Vrací true, když se nějaký alarm změnil (je potřeba překreslit graf).
 */
export async function stahniStav() {
  if (!ucet.prihlasen()) return false;
  try {
    const d = await ucet.api('GET', '/alarms');
    stav = { ...stav, hlidacVidet: d.watcherSeen || null };
    let zmena = false;
    for (const a of d.alarms || []) {
      if (a.firedAt && alarmy.oznacZaznelo(a.id, a.firedAt)) zmena = true;
    }
    ohlas();
    return zmena;
  } catch {
    return false;
  }
}

/** Povolit notifikace a zaregistrovat telefon na účtu. */
export async function zapniPush() {
  if (!ucet.prihlasen()) return stav;
  const r = await push.zapni({
    onPrijato: (data) => handlery.onPush?.(data),
    onKlepnuti: (data) => handlery.onKlepnuti?.(data),
  });
  if (r.ok) {
    try {
      await ucet.api('POST', '/push-token', { token: r.token });
      localStorage.setItem(KLIC_TOKENU, r.token);
      stav = { ...stav, push: 'on', chyba: null };
    } catch (e) {
      stav = { ...stav, push: 'error', chyba: e?.kod || e?.message };
    }
  } else {
    stav = { ...stav, push: r.duvod === 'denied' ? 'denied' : r.duvod === 'unsupported' ? 'unsupported' : 'error', chyba: r.chyba };
  }
  ohlas();
  if (stav.push === 'on') {
    posledniOdeslane = '';
    await odesli();
    await stahniStav();
  }
  return stav;
}

/** Před odhlášením: zařízení už nemá dostávat push toho účtu. */
export async function odhlasZarizeni() {
  let token = '';
  try {
    token = localStorage.getItem(KLIC_TOKENU) || '';
    localStorage.removeItem(KLIC_TOKENU);
  } catch { /* nic */ }
  if (token && ucet.prihlasen()) {
    try {
      await ucet.api('DELETE', '/push-token', { token });
    } catch { /* relace skončí stejně */ }
  }
  stav = { push: 'off', hlidacVidet: null, chyba: null };
  posledniOdeslane = '';
  ohlas();
}

/**
 * Zapojení při startu. `onPush(data)` — push dorazil do otevřené aplikace,
 * `onKlepnuti(data)` — uživatel klepl na notifikaci, `onZmena()` — stav
 * alarmů se změnil (překreslit).
 */
export function spust(h = {}) {
  handlery = h;
  naZmenuDat((klic) => {
    if (klic === 'perpdesk.alarms') naplanuj();
  });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && await stahniStav()) handlery.onZmena?.();
  });
  if (!ucet.prihlasen()) return;
  if (push.podporovano()) {
    // Povolení se neptá samo od sebe při startu — jen když už ho uživatel
    // jednou dal (jinak by vyskočilo hned po otevření aplikace).
    push.povoleno().then((p) => {
      if (p === 'granted') zapniPush();
      else stav = { ...stav, push: p === 'denied' ? 'denied' : 'off' };
      ohlas();
    });
  } else {
    stav = { ...stav, push: 'unsupported' };
  }
  odesli();
  stahniStav().then((z) => z && handlery.onZmena?.());
}
