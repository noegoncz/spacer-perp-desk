// Úsporný režim zápisů do D1 (bezplatný tarif: 100 000 zapsaných řádků denně
// na celý účet). 2026-11-04 spotřebovalo vytvoření indexů (migrace
// likvidace 0004) ~77 000 zápisů naráz; do půlnoci UTC se zapisuje jen
// nezbytné, ať D1 nezačne vracet chyby (padaly by i alarmy).
export const SETRIT_DO = Date.UTC(2026, 10, 5);
export const setrit = () => Date.now() < SETRIT_DO;

// Odpověď „zkus později": server data podrží a pošle je po konci úspory.
export const pozdeji = () => Response.json({ ok: false, pozdeji: true }, { status: 503 });
