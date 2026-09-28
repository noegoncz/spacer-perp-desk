-- Účty, přihlášení kódem z e-mailu, cloudová záloha a denní aktivita.
-- Heslo neexistuje: přihlašuje se jednorázovým kódem z e-mailu a pak
-- drží dlouhodobá relace (token). Tokeny i kódy jsou uložené jen jako
-- otisk (SHA-256) — kdo by přečetl databázi, nepřihlásí se.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  device TEXT
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

-- Záloha = celý stav aplikace (stejný tvar jako soubor zálohy, bez klíčů).
-- Každé uložení je nová verze; drží se 30 dní, poslední vždycky.
CREATE TABLE IF NOT EXISTS backups (
  account_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (account_id, version)
);

-- Jeden řádek na účet a den, kdy byl aktivní: denně / měsíčně aktivní
-- uživatelé, retence, rozšíření verzí. Nic víc se o používání neukládá.
CREATE TABLE IF NOT EXISTS activity (
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  app_version TEXT,
  PRIMARY KEY (account_id, day)
);
