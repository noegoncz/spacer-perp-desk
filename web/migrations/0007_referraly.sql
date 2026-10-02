-- Doporučení (referraly). Kdo zve, má přezdívku = kód odkazu
-- perpyx.com/ref/<přezdívka>; přezdívka je unikátní napříč účty.
--
-- Tři stupně pozvaného:
--   1) přijal pozvánku  — zapsal se na webu přes odkaz (subscribers.ref)
--   2) začal používat   — přihlásil se v aplikaci (řádek v referrals)
--   3) aktivní          — aplikaci použil několik různých dní (active_at);
--                         teprve to se počítá jako bod
ALTER TABLE accounts ADD COLUMN ref_nick TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_ref_nick ON accounts (ref_nick);

ALTER TABLE subscribers ADD COLUMN ref TEXT;
CREATE INDEX IF NOT EXISTS subscribers_ref ON subscribers (ref);

CREATE TABLE IF NOT EXISTS referrals (
  referred_id TEXT PRIMARY KEY,   -- účet pozvaného (pozvaný má jen jednoho zvoucího)
  referrer_id TEXT NOT NULL,      -- účet toho, kdo pozval
  source TEXT NOT NULL,           -- 'web' (přes odkaz a stejný e-mail) | 'manual' (zadal přezdívku)
  joined_at TEXT NOT NULL,        -- stupeň 2
  active_at TEXT                  -- stupeň 3
);
CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer_id);
