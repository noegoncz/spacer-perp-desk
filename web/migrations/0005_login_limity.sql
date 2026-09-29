-- Denní limity přihlašování pro každý e-mail.
--
-- Kód má 6 číslic (milion možností) a 5 pokusů. Kdyby si ale útočník
-- nechával posílat nové kódy pořád dokola (jeden za minutu), zkusil by
-- za den tisíce kombinací. Proto strop přes všechny kódy: nejvýš
-- 10 kódů a 15 špatných pokusů na e-mail a den. Tím je šance uhodnout
-- kód zanedbatelná (15 z milionu za den).
CREATE TABLE IF NOT EXISTS login_limits (
  email TEXT NOT NULL,
  day TEXT NOT NULL,
  codes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, day)
);
