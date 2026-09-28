-- Seznam zájemců o betu. Spouští se při každém nasazení, proto jen
-- „IF NOT EXISTS" — nic, co by smazalo nebo přepsalo existující data.
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  consent_version TEXT NOT NULL
);
