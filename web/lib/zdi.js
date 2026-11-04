// Rozdělení stavu zdí do řádků zdi_stav (id 1…CASTI_ZDI) podle trhu.
// Kopie z js/zdi-format.js (server/zdi.mjs) — měnit obojí.
export const CASTI_ZDI = 3;
export function castZdi(klic) {
  let h = 0;
  for (let i = 0; i < klic.length; i++) h = (h * 31 + klic.charCodeAt(i)) >>> 0;
  return h % CASTI_ZDI;
}
