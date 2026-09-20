/**
 * Překlady. Výchozí jazyk je **angličtina** — čeština je volitelná mutace.
 *
 * Všechny texty viditelné uživateli patří do slovníků v `js/i18n/`. Nikdy se
 * nepíšou přímo do kódu ani do HTML, aby šel další jazyk přidat přeložením
 * jednoho souboru místo hledání řetězců po celém projektu.
 *
 * Kód a komentáře zůstávají česky — píšou se pro vývoj, ne pro překlad.
 */

import { en } from './i18n/en.js';
import { cs } from './i18n/cs.js';

const SLOVNIKY = { en, cs };

export const JAZYKY = [
  { id: 'en', nazev: 'English' },
  { id: 'cs', nazev: 'Čeština' },
];

const VYCHOZI = 'en';
let jazyk = VYCHOZI;

export function setLanguage(id) {
  jazyk = SLOVNIKY[id] ? id : VYCHOZI;
  document.documentElement.lang = jazyk;
}

export function getLanguage() {
  return jazyk;
}

/** Formátování čísel a časů se řídí jazykem, ne nastavením telefonu. */
export function getLocale() {
  return jazyk === 'cs' ? 'cs-CZ' : 'en-US';
}

/**
 * Překlad klíče. Chybí-li v jazyce, vezme se anglický originál; chybí-li
 * i tam, vrátí se klíč, ať je v UI hned vidět, co se zapomnělo doplnit.
 */
export function t(klic, parametry) {
  const text = SLOVNIKY[jazyk]?.[klic] ?? en[klic] ?? klic;
  if (!parametry) return text;
  return text.replace(/\{(\w+)\}/g, (cely, jmeno) =>
    parametry[jmeno] !== undefined ? String(parametry[jmeno]) : cely,
  );
}

/**
 * Přeloží statické texty v HTML podle atributů:
 *   data-i18n      → textContent
 *   data-i18n-title → title
 *   data-i18n-aria  → aria-label
 *   data-i18n-ph    → placeholder
 */
export function applyStaticTexts(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
}
