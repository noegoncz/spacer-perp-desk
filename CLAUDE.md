# Spacer Perp Desk

Mobilní PWA pro monitoring otevřených perpetual pozic na Bybitu. Náhrada za TabTrader.

## Kontext

- **Jediné cílové zařízení:** Samsung Galaxy Z Fold 5 (Android, Chrome).
  Neřešíme desktop ani iOS, neřešíme starší prohlížeče.
- **Jazyk:** veškeré UI, texty, chybové hlášky i komunikace s uživatelem **česky**.
- **Popisek ikony na ploše:** `Perp Desk` (pole `short_name` v manifestu).
- **Režim:** read-only monitoring. Aplikace nikdy neodesílá obchodní příkazy.
  API klíč se používá výhradně read-only.

## Pravidlo pro práci na projektu

> **Po každém dokončeném checkpointu a i po každé větší změně udělej `git commit`
> a `git push` na GitHub.** Rozpracovaná práce se nikdy nesmí ztratit.

Platí bez výjimky, i když je checkpoint hotový jen částečně, ale běží. Raději
commit navíc. Push jde na `origin/main`, odkud se automaticky nasazuje GitHub Pages.

## Bezpečnost klíčů

- API key a secret se zadávají v aplikaci a ukládají **jen do `localStorage`
  v telefonu**.
- **Klíče nikdy nesmí skončit v repozitáři** — ani v kódu, ani v commit message,
  ani v testovacích souborech, ani v logu. Žádný `.env` s reálnými hodnotami.
- Podpis se počítá lokálně v zařízení přes WebCrypto. Secret neopouští telefon
  (posílá se jen odvozený HMAC podpis na Bybit).
- Používej výhradně klíč s oprávněním **jen pro čtení**.

## Architektura

Statická PWA, **bez build kroku**. Žádné npm, žádný bundler. Soubory se servírují
tak, jak leží v repu. ES moduly, vanilla JS.

```
index.html              # jediná stránka, obě obrazovky (pozice / nastavení)
manifest.webmanifest
sw.js                   # service worker, cache + detekce nové verze
css/style.css
js/version.js           # classic script: self.APP_VERSION, self.APP_BUILD
js/bybit.js             # ⚠ jediný modul, který mluví s Bybitem
js/store.js             # localStorage: klíče + nastavení
js/format.js            # formátování čísel, cen, časů
js/ui.js                # vykreslování DOM
js/app.js               # orchestrace, lifecycle, update service workeru
.github/workflows/deploy.yml
```

### `js/bybit.js` je izolovaný záměrně

Veškerá komunikace s burzou (REST i WebSocket) je **jen** v tomto modulu.
Zbytek aplikace ho zná přes úzké API a nikdy nesahá na `fetch` ani `WebSocket`
přímo. Důvod: v checkpointu 4 se aplikace balí do APK přes Capacitor a transport
se bude muset vyměnit za nativní HTTP plugin (kvůli CORS/pozadí). Ta výměna se
pak dělá na jednom místě.

Modul proto:
- nesahá na DOM,
- přijímá transport zvenčí (`httpGet` lze podstrčit, default je `fetch`),
- výsledky hlásí callbacky, ne globálním stavem.

### Verzování a detekce nové verze

Zdroj pravdy je `js/version.js` (`APP_VERSION` ručně, `APP_BUILD` = placeholder
`__BUILD_ID__`). Workflow při deploy nahradí `__BUILD_ID__` krátkým SHA commitu
v `js/version.js` **i v `sw.js`**.

Nahrazení v `sw.js` je podstatné: prohlížeč detekuje novou verzi service workeru
podle změny bajtů souboru `sw.js`. Kdyby se měnil jen `version.js`, aktualizace
by se nemusela spolehlivě chytit. Číslo verze i build se zobrazují v patičce UI.

Update flow: SW se nikdy neaktivuje sám (`skipWaiting` jen na vyžádání). Když
najde novou verzi, UI ukáže lištu **„Nová verze – načíst"**; teprve klik pošle
`SKIP_WAITING` a stránku po `controllerchange` jednou reloadne.

⚠ **Registrace musí mít `updateViaCache: 'none'`.** Výchozí hodnota `'imports'`
sice stahuje `sw.js` mimo HTTP cache, ale skripty z `importScripts()` bere
z cache — a `sw.js` importuje `js/version.js`. Zastaralá kopie `version.js`
dá jiný obsah workeru než ten aktivní, prohlížeč to považuje za novou verzi
a lišta „Nová verze – načíst" se vrací donekonečna (stalo se, verze 0.1.0).

Lišta se navíc řídí stavem (`registration.waiting`), ne jednorázovou událostí,
ať se schová i tehdy, když čekající worker mezitím převezme řízení.

### CORS — ověřeno

Bybit V5 REST **povoluje volání přímo z prohlížeče**, ověřeno 2026-09-20 proti
produkčnímu API:

- `Access-Control-Allow-Origin` se reflektuje podle `Origin` (i pro
  `https://noegoncz.github.io`).
- Preflight `OPTIONS` na `/v5/position/list` vrací
  `Access-Control-Allow-Headers: x-bapi-api-key, x-bapi-timestamp, x-bapi-sign,
  x-bapi-recv-window, x-bapi-sign-type` a `Access-Control-Max-Age: 7200`.
- CORS hlavičky jsou i na chybových odpovědích (401), takže chyby jde číst.
- Ověřeno i reálným `fetch` z prohlížeče (origin `http://localhost`), ne jen curlem.

**Pozor — chyby autentizace nechodí jako JSON.** Při neplatném klíči vrací Bybit
`HTTP 401` s **prázdným tělem** (`Content-Length: 0`); text je jen ve stavovém
řádku (`401 API key is invalid.`), kam se přes HTTP/2 z prohlížeče nedostaneme
(`res.statusText` je prázdný). `JSON.parse` na takové odpovědi spadne, takže
`defaultHttpGet` musí prázdné tělo odchytit a odvodit hlášku ze stavového kódu.
Kontrola `retCode` sama o sobě nestačí.

**Proxy tedy není potřeba.** Pokud by to Bybit někdy změnil, je to jediný důvod
zrychlit checkpoint 4 (Capacitor nativní HTTP obchází CORS úplně).

### Podpis Bybit V5

REST GET:
```
sign = HMAC_SHA256(timestamp + apiKey + recvWindow + queryString, secret)  → hex
```
`queryString` musí být přesně ten, který se odesílá, ve stejném pořadí.
Hlavičky: `X-BAPI-API-KEY`, `X-BAPI-TIMESTAMP`, `X-BAPI-RECV-WINDOW`, `X-BAPI-SIGN`.

Privátní WebSocket:
```
sign = HMAC_SHA256("GET/realtime" + expires, secret)  → hex
{ op: "auth", args: [apiKey, expires, sign] }
```

Hodiny v telefonu se rozjíždějí, proto se při startu volá `/v5/market/time`
a drží se offset vůči serveru. Bez toho padají podpisy na chybu 10002.

## Checkpointy

### ✅ 1) Připojení a seznam pozic

Nastavení s read-only klíči (jen lokálně), podpis přes WebCrypto, načtení
otevřených pozic (`category=linear`, `settleCoin=USDT`). Seznam ukazuje: pár,
směr, velikost, vstupní cenu, mark cenu, nerealizované PnL, likvidační cenu.
Živé aktualizace přes privátní WebSocket s automatickým znovupřipojením
(exponenciální backoff), plus veřejný ticker stream pro živou mark cenu
a REST poll jako záchranná síť. Verze v UI + hláška o nové verzi. Deploy na
GitHub Pages přes Actions.

### 2) Graf se svíčkami

Svíčkový graf vybraného páru s vodorovnými čarami: vstup, likvidace,
stop-loss, take-profit a otevřené limitky. Data z `/v5/market/kline`,
`/v5/order/realtime` (otevřené příkazy) a SL/TP z pozice. Živá poslední
svíčka přes veřejný WS. Přepínač intervalu, posun a zoom prstem.

Graf kreslí **`lightweight-charts`** (Apache-2.0). Má vestavěné cenové čáry
(`createPriceLine`), což je přesně to, co checkpoint potřebuje, a zvládá
dotykové ovládání. Knihovna je **stažená v repozitáři ve `vendor/`, ne z CDN**:
offline režim by na cizím skriptu padal, v APK není při startu zaručená síť
a cizí server nemá co dělat v kritické cestě aplikace na sledování peněz.
Princip „bez build kroku" to neruší, je to jeden hotový soubor.

### 3) Layout pro Fold

- **Zavřený displej** (úzký, cover screen): jen seznam pozic.
- **Rozevřený** (velký, skoro čtvercový): graf + seznam vedle sebe.

Přepínat podle `matchMedia` na šířku/poměr stran, ne podle detekce zařízení.
Stav (vybraný pár, scroll, zoom grafu) musí přežít přeložení telefonu —
Android při změně skládání stránku nereloaduje, ale layout se musí přepnout
plynule.

### 4) Rozšířená data

- Přehled účtu: equity, volný margin, využití marginu (`/v5/account/wallet-balance`).
- Funding: příští sazba a čas do stržení, náklad na pozici za den.
- Otevřené příkazy jako samostatný seznam, nejen čáry v grafu.
- Realizované PnL a historie uzavřených obchodů (`/v5/position/closed-pnl`).

### 5) Pohodlí

- Řazení a filtrování pozic (PnL, velikost, blízkost likvidace).
- Barevné varování na kartě při přiblížení k likvidaci, s volitelnou hranicí.
- Vibrace nebo zvuk při zásahu SL/TP.

### 6) Bezpečnost

- Secret zašifrovaný (WebCrypto, klíč odvozený PBKDF2 z PINu), odemykání
  PINem nebo otiskem prstu přes WebAuthn.
- Přepínač na testnet, ať se dá zkoušet bez rizika.

**Tenhle checkpoint musí být hotový dřív než checkpoint 8.** Dokud je klíč
read-only, je čitelný secret v `localStorage` přijatelné riziko — nejhorší
následek je, že někdo uvidí pozice. S právem obchodovat je nejhorší následek
vybydlený účet a stejné úložiště přijatelné přestává být.

### 7) APK přes Capacitor + notifikace

Zabalit do APK, aby aplikace mohla běžet na pozadí a posílat notifikace
(blížící se likvidace, zasažení SL/TP, výrazná změna PnL). Tady se vymění
transport v `js/bybit.js` za nativní HTTP/WebSocket plugin.

### 8) Zadávání příkazů (jen pokud se aplikace osvědčí)

Zatím **se nedělá** a aplikace zůstává výhradně read-only. Poznámky, ať se na
to při návrhu nezapomíná:

- Přidání je levné, protože veškerá komunikace je v `js/bybit.js`. Bybit V5
  podepisuje u POSTu místo query stringu **syrové tělo požadavku** — jinak
  stejný postup.
- Práva klíče na Bybitu nejdou dodatečně změnit, bude potřeba **nový klíč**.
  Výměnu klíče aplikace zvládá.
- **Pravidlo:** modul nabízí pouze čtení. Zápis přijde jako zřetelně oddělená
  část s potvrzovacím krokem, aby chyba v UI nemohla omylem odeslat příkaz.
- Předpoklad: hotový checkpoint 6 (šifrované klíče).

## Lokální vývoj

`file://` nestačí (ES moduly + service worker potřebují origin). Spusť:

```bash
python -m http.server 8080
```

a otevři `http://localhost:8080`. Service worker běží i na `localhost` bez HTTPS.
