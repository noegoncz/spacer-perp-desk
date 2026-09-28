-- Spouští se při každém nasazení, po migracích (web/migrations/).
-- Zkušební přihlášky z ověřování nasazení (doména .invalid neexistuje,
-- skutečný zájemce ji mít nemůže) se uklidí.
DELETE FROM subscribers WHERE email LIKE '%@test.perpyx.invalid';
