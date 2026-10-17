-- Odkaz pro přátele už pro zájemce z webu (2026-10-18). Kdo potvrdí
-- e-mail, dostane přezdívku = kód odkazu perpyx.com/ref/<přezdívka>
-- (první čtyři znaky e-mailu + tři náhodné, např. „noeg-7k2"). Přihlásí-li
-- se pak v aplikaci, účet ji převezme (accounts.ref_nick).
ALTER TABLE subscribers ADD COLUMN ref_nick TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_ref_nick ON subscribers (ref_nick);

-- Kdy dostal zvoucí naposledy e-mail „přítel se zapsal" — nejvýš jeden denně.
CREATE TABLE IF NOT EXISTS ref_notices (
  email TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL
);
