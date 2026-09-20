/** Orchestrace: propojuje modul Bybitu, UI a lifecycle service workeru. */

import { BybitClient } from './bybit.js';
import * as store from './store.js';
import * as ui from './ui.js';

const el = (id) => document.getElementById(id);

let hideAmounts = store.loadHideAmounts();
let lastPositions = [];

const client = new BybitClient({
  onPositions(list) {
    lastPositions = list;
    ui.renderPositions(list, hideAmounts);
  },
  onStatus(status) {
    ui.renderStatus(status);
    // Chybu maže až úspěšné REST načtení. Kdyby se mazala při každé nové
    // pozici, schoval by ji i pouhý tick ceny, zatímco načítání dál padá.
    if (status.rest === 'ok') ui.clearError();
  },
  onError(message) {
    ui.showError(message);
    if (lastPositions.length === 0) {
      ui.showPlaceholder('Pozice se nepodařilo načíst.', 'Otevřít nastavení');
    }
  },
});

/* ---------- start ---------- */

function boot() {
  ui.renderVersion(self.APP_VERSION, self.APP_BUILD);
  el('hideBtn').classList.toggle('active', hideAmounts);
  wireEvents();
  registerServiceWorker();
  connectIfPossible();
}

async function connectIfPossible() {
  const { apiKey, apiSecret } = store.loadCredentials();

  if (!apiKey || !apiSecret) {
    ui.showPlaceholder(
      'Nejdřív zadej read-only API klíč z Bybitu. Uloží se jen do tohoto telefonu.',
      'Otevřít nastavení',
    );
    ui.showView('positions');
    return;
  }

  client.setCredentials(apiKey, apiSecret);
  ui.showPlaceholder('Načítám pozice…');
  await client.start();
}

/* ---------- ovládání ---------- */

function wireEvents() {
  el('settingsBtn').addEventListener('click', openSettings);
  el('backBtn').addEventListener('click', () => ui.showView('positions'));
  el('placeholderBtn').addEventListener('click', openSettings);

  el('refreshBtn').addEventListener('click', () => {
    if (client.hasCredentials()) client.refresh();
    else openSettings();
  });

  el('hideBtn').addEventListener('click', () => {
    hideAmounts = !hideAmounts;
    store.saveHideAmounts(hideAmounts);
    el('hideBtn').classList.toggle('active', hideAmounts);
    ui.renderPositions(lastPositions, hideAmounts);
  });

  el('revealBtn').addEventListener('click', () => {
    const input = el('apiSecret');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  el('saveBtn').addEventListener('click', saveAndConnect);
  el('testBtn').addEventListener('click', testCredentials);
  el('clearBtn').addEventListener('click', clearCredentials);

  // Android uspaná WS spojení tiše zabíjí — po návratu do popředí se ověří stav.
  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible';
    client.setForeground(visible);
    if (visible) {
      client.ensureConnected();
      checkForUpdate();
    }
  });
}

function openSettings() {
  const { apiKey, apiSecret } = store.loadCredentials();
  el('apiKey').value = apiKey;
  el('apiSecret').value = apiSecret;
  el('apiSecret').type = 'password';
  ui.clearSettingsMessage();
  ui.showView('settings');
}

function readForm() {
  return {
    apiKey: el('apiKey').value.trim(),
    apiSecret: el('apiSecret').value.trim(),
  };
}

async function testCredentials() {
  const { apiKey, apiSecret } = readForm();
  if (!apiKey || !apiSecret) {
    ui.showSettingsMessage('Vyplň API key i secret.', false);
    return;
  }

  const btn = el('testBtn');
  btn.disabled = true;
  btn.textContent = 'Zkouším…';
  ui.clearSettingsMessage();

  const result = await client.testCredentials(apiKey, apiSecret);

  btn.disabled = false;
  btn.textContent = 'Vyzkoušet';
  ui.showSettingsMessage(
    result.ok ? 'Spojení funguje, klíč je platný.' : result.message,
    result.ok,
  );
}

async function saveAndConnect() {
  const { apiKey, apiSecret } = readForm();
  if (!apiKey || !apiSecret) {
    ui.showSettingsMessage('Vyplň API key i secret.', false);
    return;
  }

  const btn = el('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Připojuji…';

  const result = await client.testCredentials(apiKey, apiSecret);

  btn.disabled = false;
  btn.textContent = 'Uložit a připojit';

  if (!result.ok) {
    ui.showSettingsMessage(result.message, false);
    return;
  }

  // Ukládá se až po ověření, ať se do telefonu nedostane nefunkční klíč.
  store.saveCredentials(apiKey, apiSecret);
  client.stop();
  client.setCredentials(apiKey, apiSecret);
  ui.clearError();
  ui.showPlaceholder('Načítám pozice…');
  ui.showView('positions');
  await client.start();
}

function clearCredentials() {
  if (!confirm('Opravdu smazat API klíče z tohoto telefonu?')) return;
  client.stop();
  store.clearCredentials();
  lastPositions = [];
  el('apiKey').value = '';
  el('apiSecret').value = '';
  ui.showSettingsMessage('Klíče smazány.', true);
  ui.showPlaceholder('Nejsou uložené žádné klíče.', 'Otevřít nastavení');
}

/* ---------- service worker a hláška o nové verzi ---------- */

let registration = null;
let updateRequested = false;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    registration = await navigator.serviceWorker.register('sw.js');
  } catch {
    return; // bez SW aplikace funguje dál, jen bez offline cache
  }

  // Update čekající z minulé návštěvy.
  if (registration.waiting && navigator.serviceWorker.controller) {
    ui.showUpdateBar(true);
  }

  registration.addEventListener('updatefound', () => {
    const incoming = registration.installing;
    if (!incoming) return;
    incoming.addEventListener('statechange', () => {
      // Bez controlleru jde o první instalaci, ne o update — lištu neukazovat.
      if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
        ui.showUpdateBar(true);
      }
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload jen když si ho uživatel vyžádal, jinak by první instalace
    // (clients.claim) způsobila reload hned po otevření.
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });

  el('updateBtn').addEventListener('click', () => {
    updateRequested = true;
    ui.showUpdateBar(false);
    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
}

function checkForUpdate() {
  registration?.update().catch(() => {});
}

boot();
