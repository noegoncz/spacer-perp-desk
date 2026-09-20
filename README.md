# Spacer Perp Desk

Mobilní PWA pro sledování otevřených perpetual pozic na Bybitu. Náhrada za
TabTrader, dělaná na Samsung Galaxy Z Fold 5.

**Aplikace je read-only. Neodesílá žádné obchodní příkazy.**

## Spuštění v telefonu

1. Otevři `https://noegoncz.github.io/spacer-perp-desk/` v Chrome.
2. Menu Chrome → *Přidat na plochu*. Na ploše se objeví ikona **Perp Desk**.
3. V aplikaci otevři ⚙ a vlož read-only API klíč z Bybitu.

Klíč i secret se ukládají **jen do localStorage telefonu**. Neodcházejí nikam
kromě podepsaných požadavků přímo na Bybit a nikdy nejsou v repozitáři.

## Read-only klíč na Bybitu

Bybit → profil → API → Create New Key → System-generated API Keys.
Oprávnění pouze pro čtení, zaškrtni *Positions* a *Orders*. Obchodování a výběry
nech nezaškrtnuté. IP omezení nech prázdné — mobilní síť mění IP adresu.

## Vývoj

Statická PWA bez build kroku. Žádné npm, žádný bundler.

```bash
python -m http.server 8080
```

Pak `http://localhost:8080`. Service worker na localhostu funguje i bez HTTPS.

Podrobnosti o architektuře a checkpointech jsou v [CLAUDE.md](CLAUDE.md).
