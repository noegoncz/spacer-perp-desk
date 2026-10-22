-- Zdi v knize příkazů (server/zdi.mjs → /api/watcher/zdi, v0.72.0).
--
-- zdi_stav: jeden řádek, přepisuje se každou minutu — živé zdi všech
--   sledovaných trhů a zdi hotové za posledních 90 min (JSON).
-- zdi_dny: historie hotových zdí, řádek = trh × den, data = řádky JSON
--   [strana, cena, od, do, min, max] oddělené \n; připojuje se jednou
--   za hodinu (data || nové). Drží se 30 dní.
-- zdi_zadosti: trhy, jejichž graf někdo otevřel (server je sleduje 7 dní
--   od posledního otevření). Zapisuje se nejvýš jednou za 12 h na trh.
CREATE TABLE zdi_stav (
  id INTEGER PRIMARY KEY,
  t INTEGER NOT NULL,
  data TEXT NOT NULL,
  info TEXT NOT NULL
);

CREATE TABLE zdi_dny (
  klic TEXT NOT NULL,
  den INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (klic, den)
) WITHOUT ROWID;

CREATE TABLE zdi_zadosti (
  klic TEXT PRIMARY KEY,
  cas INTEGER NOT NULL
) WITHOUT ROWID;
