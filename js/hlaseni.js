/**
 * Hlášení problému nebo nápadu z aplikace (během bety).
 *
 * Uživatel napíše text a přiloží screenshoty z galerie (na telefonu se
 * problém popisuje špatně, snímek řekne víc). Snímky se tady zmenší na
 * nejvýš 1600 px a převedou na JPEG, ať se odešlou rychle i po mobilních
 * datech. Posílá se přes účet (/api/account/feedback) — server z toho
 * udělá e-mail provozovateli se snímky v příloze.
 *
 * ⚠ Technické údaje jsou jen verze, telefon, obrazovka, jazyk a poslední
 * chyba. **API klíč ani nic z účtu na burze se nikdy nepřikládá.**
 * Modul nesahá na DOM stránky (jen na <canvas> pro zmenšení snímku).
 */
import * as ucet from './ucet.js';

export const MAX_SNIMKU = 3;
const MAX_ROZMER = 1600;

/** Soubor obrázku → { nahled (data URL), base64 } zmenšený JPEG. */
export async function zmensiSnimek(soubor) {
  const url = URL.createObjectURL(soubor);
  try {
    const img = await new Promise((hotovo, chyba) => {
      const i = new Image();
      i.onload = () => hotovo(i);
      i.onerror = () => chyba(new Error('not-an-image'));
      i.src = url;
    });
    const pomer = Math.min(1, MAX_ROZMER / Math.max(img.naturalWidth, img.naturalHeight));
    const platno = document.createElement('canvas');
    platno.width = Math.round(img.naturalWidth * pomer);
    platno.height = Math.round(img.naturalHeight * pomer);
    platno.getContext('2d').drawImage(img, 0, 0, platno.width, platno.height);
    let data = platno.toDataURL('image/jpeg', 0.82);
    // Velký snímek (hodně detailů) ještě jednou s nižší kvalitou.
    if (data.length > 1.4e6) data = platno.toDataURL('image/jpeg', 0.6);
    return { nahled: data, base64: data.slice(data.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Technické údaje, které se k hlášení přiloží (a uživatel je vidí). */
export function technickeUdaje(doplnek = {}) {
  const android = /Android [\d.]+/.exec(navigator.userAgent)?.[0] || '';
  const model = /;\s*([^;)]+)\)\s*AppleWebKit/.exec(navigator.userAgent)?.[1] || '';
  return {
    version: `${self.APP_VERSION || '?'} (${self.APP_BUILD || 'dev'})`,
    device: [android, model, self.Capacitor?.isNativePlatform?.() ? 'APK' : 'web'].filter(Boolean).join(' · '),
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}`,
    ...doplnek,
  };
}

export async function odesli({ druh, text, snimky, info }) {
  return ucet.api('POST', '/feedback', {
    kind: druh,
    message: text,
    images: snimky.map((s) => s.base64),
    info,
  });
}
