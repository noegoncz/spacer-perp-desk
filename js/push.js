/**
 * Push notifikace přes Firebase Cloud Messaging — jen v APK (nativní plugin
 * `@capacitor/push-notifications`, `window.Capacitor.Plugins.PushNotifications`).
 *
 * Push posílá serverový hlídač alarmů (server/hlidac.mjs), když cena protne
 * hladinu. Android ho doručí i do spícího telefonu se zhasnutým displejem —
 * to je celý důvod, proč push existuje (stránka v telefonu mezitím spí).
 *
 * Modul nesahá na DOM ani na účet; jen registruje zařízení a hlásí události.
 */
import { t } from './i18n.js';

const P = () => self.Capacitor?.Plugins?.PushNotifications;

export const podporovano = () => Boolean(P() && self.Capacitor?.isNativePlatform?.());

let posluchaceZapojene = false;

/**
 * Povolí a zaregistruje push. Vrací { ok, token } nebo { ok: false, duvod }:
 * 'unsupported' (prohlížeč), 'denied' (uživatel notifikace zakázal), 'error'.
 * `onPrijato(data)` — push přišel, když je aplikace otevřená (Android ho
 * pak sám nezobrazí); `onKlepnuti(data)` — klepnutí na notifikaci.
 */
export async function zapni({ onPrijato, onKlepnuti } = {}) {
  const p = P();
  if (!podporovano()) return { ok: false, duvod: 'unsupported' };
  try {
    // Vlastní kanál s nejvyšší důležitostí: zvuk, vibrace, vyskočí i přes
    // zamčenou obrazovku. Server na něj posílá (channel_id 'alarms').
    await p.createChannel({
      id: 'alarms',
      name: t('push.channel'),
      description: t('push.channelDesc'),
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
    });
    let pravo = await p.checkPermissions();
    if (pravo.receive === 'prompt' || pravo.receive === 'prompt-with-rationale') {
      pravo = await p.requestPermissions();
    }
    if (pravo.receive !== 'granted') return { ok: false, duvod: 'denied' };

    const token = await new Promise((hotovo, chyba) => {
      const limit = setTimeout(() => chyba(new Error('registration timeout')), 20000);
      p.addListener('registration', (r) => { clearTimeout(limit); hotovo(r.value); });
      p.addListener('registrationError', (e) => { clearTimeout(limit); chyba(new Error(e?.error || 'registration')); });
      if (!posluchaceZapojene) {
        posluchaceZapojene = true;
        p.addListener('pushNotificationReceived', (n) => onPrijato?.(n?.data || {}));
        p.addListener('pushNotificationActionPerformed', (a) => onKlepnuti?.(a?.notification?.data || {}));
      }
      p.register();
    });
    return { ok: true, token };
  } catch (e) {
    return { ok: false, duvod: 'error', chyba: e?.message };
  }
}

/** Stav povolení bez ptaní — pro nastavení. */
export async function povoleno() {
  if (!podporovano()) return 'unsupported';
  try {
    const r = await P().checkPermissions();
    return r.receive === 'granted' ? 'granted' : r.receive === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unsupported';
  }
}

/*
 * Místní systémová notifikace alarmu (v0.62.1, přání uživatele: „ve všech
 * případech standardní notifikace telefonu, nic víc, nic méně"). Push ze
 * serveru Android v otevřené aplikaci sám neukáže a dřív se místo něj
 * pouštěla houkačka z WebAudio. Teď stejná notifikace jako se zhasnutým
 * displejem: kanál `alarms`, ikonka se šipkou, klepnutí otevře graf.
 * Plugin `@capacitor/local-notifications` (apk.yml) — starší APK ho nemá.
 */
const L = () => self.Capacitor?.Plugins?.LocalNotifications;

export const mistniPodporovano = () => Boolean(L() && self.Capacitor?.isNativePlatform?.());

const IKONY = { nahoru: 'ic_stat_nahoru', dolu: 'ic_stat_dolu' };
const BARVY = { nahoru: '#3ee6a4', dolu: '#ff6b78' };
let mistniPripraveno = null;

function pripravMistni(onKlepnuti) {
  if (!mistniPripraveno) {
    mistniPripraveno = (async () => {
      const l = L();
      // Stejný kanál jako push (kanál je v Androidu jeden pro celou aplikaci).
      await l.createChannel?.({
        id: 'alarms', name: t('push.channel'), description: t('push.channelDesc'),
        importance: 5, visibility: 1, vibration: true, lights: true,
      }).catch(() => {});
      l.addListener('localNotificationActionPerformed', (a) => onKlepnuti?.(a?.notification?.extra || {}));
    })();
  }
  return mistniPripraveno;
}

/** Zapojí klepnutí na místní notifikace (při startu, ať funguje i po probuzení). */
export function zapojMistni(onKlepnuti) {
  if (mistniPodporovano()) pripravMistni(onKlepnuti).catch(() => {});
}

/** Ukáže notifikaci; vrací false, když to telefon neumí (pak ať se aplikace ozve sama). */
export async function ukazMistni({ titulek, text, smer = null, data = {} }) {
  if (!mistniPodporovano()) return false;
  try {
    await pripravMistni();
    await L().schedule({
      notifications: [{
        id: Math.floor(Math.random() * 2e9),
        title: titulek,
        body: text,
        channelId: 'alarms',
        smallIcon: IKONY[smer] || 'ic_stat_perpyx',
        iconColor: BARVY[smer] || '#22d3ee',
        extra: data,
      }],
    });
    return true;
  } catch {
    return false;
  }
}
