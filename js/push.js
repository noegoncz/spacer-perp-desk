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
