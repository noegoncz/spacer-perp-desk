-- Seznam zájemců o betu (původní podoba, 2026-09-28). IF NOT EXISTS,
-- protože tabulka vznikla dřív, než se začaly používat migrace.
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  consent_version TEXT NOT NULL
);
