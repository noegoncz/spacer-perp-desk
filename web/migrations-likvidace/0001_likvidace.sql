-- Likvidační mapa Hyperliquidu (server/likvidace.mjs → /api/watcher/liq).
-- Vlastní databáze perpyx-likvidace, oddělená od účtů (perpyx-web):
-- jiný objem dat i jiný režim mazání.
--
-- Jeden řádek = jeden coin, jedna hodina, jedno rozlišení:
--   rozliseni 1  — snímky po minutách ('K' + rozdílové 'D'), drží se 3 dny
--   rozliseni 15 — snímky po 15 min (jen 'K'), drží se 90 dní
-- data = řádky formátu js/likvidace-format.js oddělené \n; minutové se
-- doplňují připojením na konec (data || nové), bez čtení.
CREATE TABLE liq_hodiny (
  coin TEXT NOT NULL,
  rozliseni INTEGER NOT NULL,
  hodina INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (coin, rozliseni, hodina)
) WITHOUT ROWID;

-- Stav sběru (poslední hlášení serveru) — jen pro kontrolu provozu.
CREATE TABLE liq_stav (
  id INTEGER PRIMARY KEY,
  seen_at INTEGER NOT NULL,
  info TEXT NOT NULL
);
