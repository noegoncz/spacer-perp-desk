/**
 * Výpočty alarmů bez úložiště a bez DOM: hlídaná úroveň, protnutí,
 * doběhnutí šikmé čáry.
 *
 * ⚠ **Sdílí ho aplikace (js/alarmy.js) i hlídač na serveru
 * (server/hlidac.mjs)** — ten si ho bere přímo z repozitáře. Alarm tak
 * zazní za stejných podmínek v telefonu i na serveru. Modul proto nesmí
 * importovat nic, co v Node.js neexistuje (localStorage, DOM, fetch
 * s cookies…).
 */

/** Od kdy do kdy šikmá čára platí — mimo tenhle úsek se nehlídá. */
export function rozsahCary(alarm) {
  const [a, b] = alarm?.body || [];
  if (!a || !b || !Number.isFinite(a.timestamp) || !Number.isFinite(b.timestamp)) return null;
  return { od: Math.min(a.timestamp, b.timestamp), do: Math.max(a.timestamp, b.timestamp) };
}

/**
 * Úroveň, kterou alarm právě hlídá.
 *
 * U šikmé čáry se dopočítá z přímky mezi body a **platí jen po její délku**.
 * Za koncem vrací NaN: kdyby se přímka extrapolovala donekonečna, alarm by
 * jednou zahoukal kdesi mimo nakreslenou čáru a uživatel by netušil proč.
 */
export function uroven(alarm, cas = Date.now()) {
  if (!alarm || alarm.typ === 'cas') return NaN;
  if (alarm.typ !== 'cara') return Number(alarm.price);

  const [a, b] = alarm.body || [];
  if (!a || !Number.isFinite(a.value)) return NaN;
  if (!b || !Number.isFinite(b.value) || a.timestamp === b.timestamp) return Number(a.value);

  const rozsah = rozsahCary(alarm);
  if (rozsah && (cas < rozsah.od || cas > rozsah.do)) return NaN;

  const podil = (cas - a.timestamp) / (b.timestamp - a.timestamp);
  return a.value + (b.value - a.value) * podil;
}

/** Doběhla už šikmá čára do konce? Takový alarm se sám vypíná. */
export function dobehla(alarm, cas = Date.now()) {
  if (alarm?.typ !== 'cara') return false;
  const rozsah = rozsahCary(alarm);
  return Boolean(rozsah) && cas > rozsah.do;
}

/** Protnula cena hlídanou úroveň ve směru, na který si uživatel počkal? */
export function protnuto(alarm, predchozi, cena, cas = Date.now()) {
  const u = uroven(alarm, cas);
  if (!Number.isFinite(u) || !Number.isFinite(predchozi) || !Number.isFinite(cena)) return false;
  const nahoru = predchozi < u && cena >= u;
  const dolu = predchozi > u && cena <= u;
  if (alarm.smer === 'up') return nahoru;
  if (alarm.smer === 'down') return dolu;
  return nahoru || dolu;
}

/** Vypršela platnost alarmu (volba „platí 1 / 7 / 30 dní")? */
export const vyprsel = (alarm, ted = Date.now()) => Boolean(alarm?.vyprsi) && alarm.vyprsi <= ted;
