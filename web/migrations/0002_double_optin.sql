-- Potvrzení e-mailem (double opt-in). Zájemce je „pending", dokud
-- neklikne na odkaz v e-mailu; teprve pak „confirmed". Po odhlášení
-- „unsubscribed". Jeden náhodný token slouží k potvrzení i odhlášení.
ALTER TABLE subscribers ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE subscribers ADD COLUMN token TEXT;
ALTER TABLE subscribers ADD COLUMN sent_at TEXT;
ALTER TABLE subscribers ADD COLUMN confirmed_at TEXT;
ALTER TABLE subscribers ADD COLUMN unsubscribed_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS subscribers_token ON subscribers (token);
