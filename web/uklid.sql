-- Spouští se při každém nasazení, po migracích (web/migrations/).
-- Zkušební přihlášky z ověřování nasazení (doména .invalid neexistuje,
-- skutečný zájemce ji mít nemůže) se uklidí.
DELETE FROM subscribers WHERE email LIKE '%@test.perpyx.invalid';

-- Účty (web/migrations/0003_ucty.sql) — co se drží jak dlouho:
-- přihlašovací kódy platí 10 minut, pak k ničemu,
DELETE FROM login_codes WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day');
-- relace nepoužitá rok propadne (kdo aplikaci používá, zůstává přihlášený),
DELETE FROM sessions WHERE last_used_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days');
-- zálohy starší 30 dní pryč, poslední verze každého účtu zůstává.
DELETE FROM backups WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')
  AND version < (SELECT MAX(b.version) FROM backups b WHERE b.account_id = backups.account_id);
-- Testovací účty z ověřování nasazení.
DELETE FROM backups WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@test.perpyx.invalid');
DELETE FROM activity WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@test.perpyx.invalid');
DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@test.perpyx.invalid');
DELETE FROM alarms WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@test.perpyx.invalid');
DELETE FROM push_tokens WHERE account_id IN (SELECT id FROM accounts WHERE email LIKE '%@test.perpyx.invalid');
DELETE FROM accounts WHERE email LIKE '%@test.perpyx.invalid';
DELETE FROM login_codes WHERE email LIKE '%@test.perpyx.invalid';
