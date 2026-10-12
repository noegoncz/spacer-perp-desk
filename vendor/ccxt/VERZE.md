# CCXT — vložená verze

- Balíček: `ccxt` 4.5.85 z npm (MIT, https://github.com/ccxt/ccxt),
  soubor `dist/ccxt.browser.min.js` (uvnitř hlásí `ccxt.version` 4.5.84).
- SHA-256: `8b18b4631bc4687bbdeeb0210f56529bd9ccbe691aca0043787bcd52cde02222`
  — ověřeno 2026-10-12 proti otisku na jsDelivr (data.jsdelivr.com).
- Licence: `LICENSE.txt` (MIT, © Igor Kroitor), licence přibalených
  knihoven `ccxt.browser.min.js.LICENSE.txt`.

⚠ **Žádné automatické aktualizace.** Novou verzi vkládat jen vědomě:
stáhnout, porovnat SHA-256 s jsDelivr / npm, projet
`tools/test-kontrakt-burzy.py` a zapsat sem novou verzi a otisk.

Načítá se líně (`js/burzy/ccxt.js`) — jen když je připojená burza přes
CCXT; uživatel jen s Bybitem knihovnu vůbec nestahuje. Není v `SHELL`
service workeru (1,1 MB po kompresi by se jinak stahovalo při každé nové
verzi aplikace všem).
