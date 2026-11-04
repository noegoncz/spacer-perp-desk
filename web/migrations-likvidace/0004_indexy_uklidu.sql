-- Indexy pro úklid starých řádků (2026-11-04, Cloudflare hlásil 78 % denního
-- limitu D1 rows_read). DELETE ... WHERE hodina < ? / den < ? neměl index
-- a pokaždé prošel celou tabulku: liq_hodiny (~80 000 řádků a roste) dvakrát
-- za hodinu ≈ 4 M přečtených řádků denně. S indexem čte jen mazané řádky.
-- Klíč indexu se při připojování dat (data || nové) nemění → zápis navíc
-- jen u nového řádku.
CREATE INDEX IF NOT EXISTS liq_hodiny_cas ON liq_hodiny (rozliseni, hodina);
CREATE INDEX IF NOT EXISTS zdi_dny_den ON zdi_dny (den);
CREATE INDEX IF NOT EXISTS zdi_zadosti_cas ON zdi_zadosti (cas);
CREATE INDEX IF NOT EXISTS likvidovano_dny_den ON likvidovano_dny (den);
