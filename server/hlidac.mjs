/**
 * Hlídač cenových alarmů PerpyX — běží nonstop na serveru (Hetzner).
 *
 * Proč server: se zhasnutým displejem Android aplikaci uspí a alarm
 * v telefonu nemá kdo vyhodnotit. Hlídač drží živé ceny z burzy, a když
 * cena protne hladinu, pošle push přes Firebase Cloud Messaging — ten
 * Android doručí i do spícího telefonu.
 *
 * - Žádné API klíče uživatelů: čte jen **veřejné** ceny (ticker stream).
 * - Alarmy a push tokeny si stahuje z perpyx.com (/api/watcher/*,
 *   tajný WATCHER_TOKEN); do databáze sám nesahá.
 * - Protnutí počítá **stejný kód jako aplikace** (js/alarmy-logika.js).
 * - Bez závislostí: Node 22 má WebSocket i fetch vestavěné, podpis pro
 *   Firebase (JWT RS256) dělá node:crypto.
 *
 * Proměnné prostředí (/etc/perpyx/hlidac.env):
 *   WATCHER_TOKEN  tajný token pro /api/watcher/*
 *   API            https://perpyx.com
 *   FCM_FILE       cesta k JSON servisního účtu Firebase
 *   ZKOUSKA=1      nic neposílat, jen vypisovat (test)
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { uroven, protnuto, dobehla, vyprsel } from '../js/alarmy-logika.js';

const API = (process.env.API || 'https://perpyx.com').replace(/\/$/, '');
const TOKEN = process.env.WATCHER_TOKEN || '';
const ZKOUSKA = process.env.ZKOUSKA === '1';
const STREAM = process.env.STREAM || 'wss://stream.bybit.com/v5/public/linear';
const OBNOVA_ALARMU = 15000;      // jak často si stáhnout alarmy
const CASOVE_ALARMY = 5000;       // kontrola alarmů „v čas"
const PING = 20000;               // Bybit chce ping, jinak spojení zavře

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- Firebase Cloud Messaging (HTTP v1) ---------- */

let fcm = null;          // { projekt, email, klic }
let pristup = null;      // { token, platiDo }

function nactiFcm() {
  if (fcm || !process.env.FCM_FILE) return fcm;
  const s = JSON.parse(readFileSync(process.env.FCM_FILE, 'utf8'));
  fcm = { projekt: s.project_id, email: s.client_email, klic: s.private_key };
  return fcm;
}

const b64u = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

async function tokenFcm() {
  if (pristup && pristup.platiDo > Date.now() + 60000) return pristup.token;
  const f = nactiFcm();
  const ted = Math.floor(Date.now() / 1000);
  const obsah = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({
    iss: f.email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: ted, exp: ted + 3600,
  })}`;
  const podpis = createSign('RSA-SHA256').update(obsah).sign(f.klic).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${obsah}.${podpis}` }),
  });
  const d = await res.json();
  if (!d.access_token) throw new Error(`FCM token: ${JSON.stringify(d).slice(0, 200)}`);
  pristup = { token: d.access_token, platiDo: Date.now() + (d.expires_in || 3600) * 1000 };
  return pristup.token;
}

/** Pošle push na jedno zařízení. Vrací 'ok' | 'neplatny' (zařízení už není) | 'chyba'. */
async function posliPush(token, { titulek, text, data }) {
  if (ZKOUSKA) {
    log('ZKOUŠKA push', token.slice(0, 12), titulek, text);
    return 'ok';
  }
  const f = nactiFcm();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${f.projekt}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await tokenFcm()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: titulek, body: text },
        data,
        android: {
          priority: 'HIGH',            // doručit hned, i do spícího telefonu
          ttl: '600s',                 // alarm starší deseti minut už nemá cenu
          notification: {
            channel_id: 'alarms', sound: 'default', default_vibrate_timings: true,
            notification_priority: 'PRIORITY_MAX', tag: data.alarmId,
          },
        },
      },
    }),
  });
  if (res.ok) return 'ok';
  const chyba = await res.text();
  if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT.*token/i.test(chyba)) return 'neplatny';
  log('FCM chyba', res.status, chyba.slice(0, 200));
  return 'chyba';
}

/* ---------- alarmy z perpyx.com ---------- */

let alarmy = [];            // zapnuté alarmy všech účtů
let tokeny = {};            // účet → [push tokeny]
const spusteneTed = new Set();   // jednorázové, které už zazněly (do další obnovy)

async function watcherApi(cesta, telo) {
  const res = await fetch(API + cesta, {
    method: telo ? 'POST' : 'GET',
    headers: { 'X-Watcher-Token': TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'PerpyX-hlidac/1' },
    body: telo ? JSON.stringify(telo) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${cesta}: HTTP ${res.status}`);
  return res.json();
}

async function obnovAlarmy() {
  try {
    const d = await watcherApi(`/api/watcher/alarms?info=${encodeURIComponent(`par:${ceny.size} ws:${stavWs}`)}`);
    alarmy = (d.alarms || []).filter((a) => !spusteneTed.has(`${a.account}:${a.id}`));
    tokeny = d.tokens || {};
    spusteneTed.clear();
    prihlasOdbery();
  } catch (e) {
    log('obnova alarmů selhala:', e.message);
  }
}

/* ---------- vyhodnocení ---------- */

const ceny = new Map();     // symbol → poslední cena

const formatCeny = (x) => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : '');

function texty(a, cena) {
  const cs = a.jazyk === 'cs';
  const titulek = `PerpyX · ${a.symbol}`;
  if (a.typ === 'cas') {
    return { titulek, text: a.zprava || (cs ? 'Nastal čas alarmu.' : 'Your time alert is due.') };
  }
  const hladina = formatCeny(uroven(a));
  const zakladni = cs ? `${a.symbol} dosáhl ${hladina} (cena ${formatCeny(cena)})`
    : `${a.symbol} reached ${hladina} (price ${formatCeny(cena)})`;
  return { titulek, text: a.zprava ? `${a.zprava} — ${zakladni}` : zakladni };
}

async function spust(a, cena) {
  const klic = `${a.account}:${a.id}`;
  if (!a.opakovat) {
    spusteneTed.add(klic);
    alarmy = alarmy.filter((x) => x !== a);
  }
  const { titulek, text } = texty(a, cena);
  const neplatne = [];
  for (const t of tokeny[a.account] || []) {
    const v = await posliPush(t, {
      titulek, text,
      data: { alarmId: a.id, symbol: a.symbol, price: String(cena ?? ''), at: String(Date.now()) },
    });
    if (v === 'neplatny') neplatne.push(t);
  }
  log('alarm', a.symbol, a.typ, a.id, 'zařízení:', (tokeny[a.account] || []).length);
  try {
    await watcherApi('/api/watcher/fired', {
      account: a.account, id: a.id, at: Date.now(), repeat: Boolean(a.opakovat), invalidTokens: neplatne,
    });
  } catch (e) {
    log('hlášení zaznění selhalo:', e.message);
  }
}

function novaCena(symbol, cena) {
  const predchozi = ceny.get(symbol);
  ceny.set(symbol, cena);
  // První cena po startu jen založí referenci (jako v aplikaci).
  if (!Number.isFinite(predchozi)) return;
  const ted = Date.now();
  for (const a of alarmy) {
    if (a.symbol !== symbol || a.typ === 'cas' || vyprsel(a, ted) || dobehla(a, ted)) continue;
    if (protnuto(a, predchozi, cena, ted)) spust(a, cena);
  }
}

function zkontrolujCasove() {
  const ted = Date.now();
  for (const a of alarmy) {
    if (a.typ === 'cas' && Number.isFinite(a.cas) && a.cas <= ted && a.cas > ted - 3600e3) spust(a, null);
  }
}

/* ---------- živé ceny z Bybitu ---------- */

let ws = null;
let stavWs = 'zavreno';
let odebirane = new Set();
let pokus = 0;

function prihlasOdbery() {
  const chci = new Set(alarmy.filter((a) => a.typ !== 'cas').map((a) => a.symbol));
  if (!ws || ws.readyState !== 1) {
    odebirane = new Set();
    return;
  }
  const pridat = [...chci].filter((s) => !odebirane.has(s));
  const odebrat = [...odebirane].filter((s) => !chci.has(s));
  // Bybit bere nejvýš 10 témat v jedné zprávě.
  for (let i = 0; i < pridat.length; i += 10) {
    ws.send(JSON.stringify({ op: 'subscribe', args: pridat.slice(i, i + 10).map((s) => `tickers.${s}`) }));
  }
  for (let i = 0; i < odebrat.length; i += 10) {
    ws.send(JSON.stringify({ op: 'unsubscribe', args: odebrat.slice(i, i + 10).map((s) => `tickers.${s}`) }));
  }
  odebrat.forEach((s) => { odebirane.delete(s); ceny.delete(s); });
  pridat.forEach((s) => odebirane.add(s));
}

function pripoj() {
  stavWs = 'pripojuji';
  ws = new WebSocket(STREAM);
  let ping = null;
  ws.addEventListener('open', () => {
    stavWs = 'otevreno';
    pokus = 0;
    odebirane = new Set();
    prihlasOdbery();
    ping = setInterval(() => ws?.readyState === 1 && ws.send('{"op":"ping"}'), PING);
    log('stream otevřen');
  });
  ws.addEventListener('message', (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (!m.topic?.startsWith('tickers.') || !m.data) return;
    // Snapshot i delta: lastPrice chodí, jen když se změnila.
    const cena = Number(m.data.lastPrice);
    if (Number.isFinite(cena) && cena > 0) novaCena(m.data.symbol || m.topic.slice(8), cena);
  });
  ws.addEventListener('close', () => {
    clearInterval(ping);
    stavWs = 'zavreno';
    ceny.clear();   // po výpadku by stará cena vyrobila falešné protnutí
    const cekat = Math.min(60000, 1000 * 2 ** pokus++);
    log(`stream zavřen, znovu za ${cekat / 1000} s`);
    setTimeout(pripoj, cekat);
  });
  ws.addEventListener('error', () => { /* zavření řeší 'close' */ });
}

/* ---------- start ---------- */

if (!TOKEN) {
  console.error('Chybí WATCHER_TOKEN.');
  process.exit(1);
}
if (!ZKOUSKA) nactiFcm();
log(`hlídač startuje (API ${API}${ZKOUSKA ? ', ZKOUŠKA' : ''})`);
await obnovAlarmy();
pripoj();
setInterval(obnovAlarmy, OBNOVA_ALARMU);
setInterval(zkontrolujCasove, CASOVE_ALARMY);
