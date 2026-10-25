-- Skutečné likvidace z CEX (server/likvidovano.mjs → /api/watcher/likvidovano).
--
-- likvidovano_stav: jeden řádek, přepisuje se každou minutu — záznamy od
--   poslední hodinové dávky (JSON { coin: [[minuta, cena, usd, strana, burza]] }).
-- likvidovano_dny: historie, řádek = coin × den, data = řádky JSON
--   [minuta, cena, usd, strana, burza] oddělené \n; připojuje se jednou
--   za hodinu. Drží se 365 dní (porovnání s kalkulovanou mapou).
CREATE TABLE likvidovano_stav (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  data TEXT NOT NULL,
  info TEXT NOT NULL
);

CREATE TABLE likvidovano_dny (
  coin TEXT NOT NULL,
  den INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (coin, den)
) WITHOUT ROWID;
