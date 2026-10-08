/**
 * Podržení dlaždice ve vlastním seznamu v Trzích (jako v TabTraderu):
 *  - podržet a táhnout → dlaždice se přesune na místo té, nad kterou se
 *    prst pustí,
 *  - podržet a pustit bez pohybu → nabídka (odebrat ze seznamu).
 *
 * Krátké klepnutí otevírá graf (to obsluhuje dlaždice sama), pohyb prstu
 * před uplynutím podržení je obyčejné posouvání stránky nebo přejetí na
 * jiný seznam — do toho se nezasahuje.
 *
 * ⚠ Stojí na dotykových událostech, ne ukazovátkových (stejně jako
 * přejíždění mezi záložkami — viz CLAUDE.md): prohlížeč si gesto bere
 * na posouvání a ukazovátkový proud ukončí `pointercancel`.
 */
const DRZENI_MS = 450;

export function zapojDlazdice(kontejner, { onPresun, onNabidka }) {
  let s = null;

  const uklid = () => {
    kontejner.querySelectorAll('.tile.cil').forEach((x) => x.classList.remove('cil'));
  };

  kontejner.addEventListener('touchstart', (e) => {
    clearTimeout(s?.casovac);
    s = null;
    const tile = e.target.closest?.('.tile');
    if (!tile || e.touches.length !== 1 || !kontejner.classList.contains('lze-presouvat')) return;
    if (e.target.closest('button')) return;
    const d = e.touches[0];
    const stav = { tile, x: d.clientX, y: d.clientY, aktivni: false, pohnuto: false, cil: null };
    stav.casovac = setTimeout(() => {
      if (s !== stav) return;
      stav.aktivni = true;
      tile.classList.add('drzena');
      navigator.vibrate?.(15);
    }, DRZENI_MS);
    s = stav;
  }, { passive: true });

  kontejner.addEventListener('touchmove', (e) => {
    if (!s) return;
    const d = e.touches[0];
    const dx = d.clientX - s.x;
    const dy = d.clientY - s.y;
    if (!s.aktivni) {
      // Pohyb před podržením = posouvání stránky / přejetí, ne přesun.
      if (Math.hypot(dx, dy) > 8) {
        clearTimeout(s.casovac);
        s = null;
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (Math.hypot(dx, dy) > 6) s.pohnuto = true;
    s.tile.style.transform = `translate(${dx}px, ${dy}px)`;
    s.tile.style.pointerEvents = 'none';
    const pod = document.elementFromPoint(d.clientX, d.clientY)?.closest?.('.tile');
    s.tile.style.pointerEvents = '';
    uklid();
    s.cil = pod && pod !== s.tile && kontejner.contains(pod) ? pod : null;
    s.cil?.classList.add('cil');
  }, { passive: false });

  const konec = (e, zruseno) => {
    if (!s) return;
    clearTimeout(s.casovac);
    const st = s;
    s = null;
    if (!st.aktivni) return;
    e.stopPropagation();
    st.tile.classList.remove('drzena');
    st.tile.style.transform = '';
    uklid();
    // Klepnutí, které po puštění prstu případně dorazí, nesmí otevřít graf.
    st.tile.dataset.potlacKlik = '1';
    setTimeout(() => { delete st.tile.dataset.potlacKlik; }, 450);
    if (zruseno) return;
    if (st.pohnuto && st.cil) {
      const dlazdice = [...kontejner.querySelectorAll('.tile')];
      onPresun(st.tile.dataset.symbol, dlazdice.indexOf(st.cil));
    } else if (!st.pohnuto) {
      onNabidka(st.tile.dataset.symbol, st.tile);
    }
  };
  kontejner.addEventListener('touchend', (e) => konec(e, false));
  kontejner.addEventListener('touchcancel', (e) => konec(e, true));
}
