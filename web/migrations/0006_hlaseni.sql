-- Hlášení z aplikace (problém / nápad) během bety.
-- Text a technické údaje se drží kvůli přehledu a denního limitu;
-- screenshoty se neukládají — jdou jen jako příloha e-mailu provozovateli.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  info TEXT,
  images INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS feedback_account ON feedback (account_id, created_at);
