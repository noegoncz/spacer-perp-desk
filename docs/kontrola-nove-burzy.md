# Kontrola nové burzy

Sepsáno 2026-10-16 ze zkušeností s Bybitem a Binance. Každá chyba níž se
u Binance opravdu stala — testy s podstrčenými daty ji nechytily, chytil ji
až skutečný účet. Proto dvě části: co ověřím já před předáním, a co se
ověří na telefonu se skutečným (nebo demo) účtem.

## A) Já před předáním (bez účtu)

Každý bod naostro proti burze, ne proti mocku — mock si píšu sám podle
dokumentace, takže chybu v dokumentaci nebo změnu API neodhalí.

1. **Trhy a regiony** — perpetuály v USDT i USDC (Binance: USDC kvůli
   MiCA), regionální verze s perpetuály, symboly → `BTCUSDT`.
2. **Svíčky** — strop počtu na dotaz (OKX 300 — chyběl konec grafu),
   až k dnešku, bez děr, všechny timeframy, svíčky z minulosti (`end`).
3. **Živý proud** — správná adresa a že po odběru **opravdu chodí data**
   (Binance `/ws` odběr potvrdí a mlčí, data jsou na `/market/ws`).
4. **Váhy dotazů** (omezovač CCXT) — nic drahého po 2–3 s (Binance:
   ceny všech párů 40, příkazy bez páru 40 — fronta byla trvale plná
   a graf čekal 5 s). Veřejná, soukromá a hromadná data ve vlastních
   frontách.
5. **Podmíněné příkazy** — kde je burza drží (Binance: služba Algo
   Orders, běžný dotaz je nevrací), jak se pozná TP / SL / trailing,
   „TP/SL na celou pozici" (množství 0).
6. **Funding** — sazba, **interval z burzy** (Binance ho v CCXT nedává,
   JUP má 4 h, ne 8), příští stržení, deník zaplaceného.
7. **Plnění a uzavřené obchody** — jak daleko zpátky (Binance 6 měsíců),
   okno na dotaz, stránkování.
8. **Klíč jen pro čtení** — jak burza hlásí oprávnění (a jestli to jde
   z WebView — Binance `sapi` bez CORS → nativní HTTP).
9. **CORS** — veřejná i soukromá API z WebView; bez CORS nativní HTTP.
10. **Chyby** — po návratu do aplikace (zestárlý podpis, -1021) potichu
    znovu; do UI nikdy surová zpráva (adresa s podpisem).
11. **Kontraktní test** (`tools/test-kontrakt-burzy.py`) + test aplikace
    s podstrčeným soukromým API podle skutečných odpovědí.

## B) Na telefonu (skutečný účet, malá pozice nebo demo)

Po každém bodu: sedí to s aplikací burzy?

1. **Připojení** — klíč jen pro čtení projde; klíč s obchodováním
   aplikace odmítne / varuje; vymyšlený klíč srozumitelná hláška.
2. **Pozice** — karta: směr, páka, velikost, vstup, cena, PnL,
   likvidace; long i short; pár v USDT i USDC.
3. **Příkazy** — limitka nákup i prodej; TP a SL na celou pozici;
   částečné TP a SL; trailing / stop. V grafu (čára, popisek, cenovka)
   i na kartě (proužek SL — vstup — TP).
4. **Graf** — otevře se rychle (do 1 s); živá svíčka se hýbe; přepnutí
   timeframů; **přepnutí na stejný pár jiné burzy** (žádné cizí čáry ani
   svíčky); trojúhelníky nákupů a prodejů pozice.
5. **Přehled účtu** — equity, volné, margin.
6. **Funding** — sazba a interval, příští stržení, celkem od otevření.
7. **Historie** — uzavřít obchod (1 nákup + 1 prodej), pak obchod
   s přikoupením a částečným výstupem: karta (data, výstupy, součet =
   PnL na burze), klepnutí → prohlídka jen s plněními toho obchodu
   (I1…, O1…). Přepnout účty v Historii tam a zpět, zavřít a otevřít
   aplikaci — obchody se nesmí přeskládat ani smíchat s jiným účtem.
8. **Alarmy** — alarm na páru té burzy, zhasnout displej → push přijde,
   text s názvem burzy, klepnutí otevře graf té burzy.
9. **Odolnost** — přepnout do jiné aplikace a zpět (žádné chybové
   hlášky), vypnout a zapnout síť, nechat telefon uspat.
10. **Watchlists** — dlaždice té burzy, cena se hýbe, hledání ji nabízí.

Body B1–B3 a B7 jsou ty, na kterých se u Binance našlo nejvíc chyb.
