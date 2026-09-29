-- Alarmy hlídané serverem (server/hlidac.mjs) a zařízení pro push.
--
-- Definici alarmu (hladina, směr, opakování…) vlastní telefon a posílá
-- ji celou (data = JSON, stejný tvar jako v aplikaci). Server k ní přidává
-- jen stav: kdy alarm zazněl. Když zazní jednorázový alarm, vypne se tady
-- i v telefonu (ten si stav stáhne).
CREATE TABLE IF NOT EXISTS alarms (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  data TEXT NOT NULL,
  active INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,     -- kdy ho uživatel naposledy upravil (ms)
  fired_at INTEGER,                -- kdy naposledy zazněl na serveru (ms)
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS alarms_active ON alarms (active);

-- Token Firebase Cloud Messaging jednoho zařízení (aplikace v telefonu).
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS push_tokens_account ON push_tokens (account_id);

-- Kdy se hlídač naposledy ozval — pro přehled, jestli alarmy opravdu běží.
CREATE TABLE IF NOT EXISTS watcher_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  seen_at TEXT NOT NULL,
  info TEXT
);
