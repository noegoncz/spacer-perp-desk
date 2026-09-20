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
index.html              # jediná stránka, všechny obrazovky (pozice / graf / nastavení)
manifest.webmanifest
sw.js                   # service worker, cache + detekce nové verze
css/style.css
js/version.js           # classic script: self.APP_VERSION, self.APP_BUILD
js/bybit.js             # ⚠ jediný modul, který mluví s Bybitem
js/store.js             # localStorage: klíče + nastavení
js/format.js            # formátování čísel, cen, časů
js/ui.js                # vykreslování DOM
js/chart.js             # obal nad knihovnou grafu (KLineChart), o Bybitu neví
js/app.js               # orchestrace, lifecycle, update service workeru
vendor/                 # KLineChart + licence, stažené v repu (ne CDN)
.github/workflows/deploy.yml
```

### `js/bybit.js` je izolovaný záměrně

Veškerá komunikace s burzou (REST i WebSocket) je **jen** v tomto modulu.
Zbytek aplikace ho zná přes úzké API a nikdy nesahá na `fetch` ani `WebSocket`
přímo. Důvod: v checkpointu 8 se aplikace balí do APK přes Capacitor a transport
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

⚠ **Service worker musí stahovat s obejitím HTTP cache.** GitHub Pages servíruje
všechno s `Cache-Control: max-age=600`. `cache.addAll(SHELL)` respektuje HTTP
cache prohlížeče, takže si instalace nové verze uloží až deset minut starou
kopii souboru — a protože každý soubor vyprší jindy, vznikne v cache míchanice
nové a staré verze. Proto:

- `install` precachuje přes `new Request(url, { cache: 'reload' })`,
- `fetch` handler stahuje s `{ cache: 'no-cache' }` (podmíněný požadavek,
  obvykle levné 304).

Stalo se ve verzi 0.1.2: `version.js` se stáhl čerstvý a UI hlásilo novou
verzi, ale `style.css` se vzal starý, takže oprava v CSS se do telefonu
nedostala, přestože na serveru byla.

## Pozor na `hidden` v CSS

Atribut `hidden` schovává prvek přes `display: none` v **prohlížečovém** stylu,
který **jakýkoli** autorský `display` přebije — bez ohledu na specificitu.
Proto je na začátku `css/style.css` pravidlo `[hidden] { display: none !important }`.

Bez něj zůstávaly viditelné prvky s vlastním `display` (`.update-bar`,
`.summary`) i po nastavení `hidden`. Lišta „Nová verze" takhle visela od první
instalace a tvářila se jako rozbitá detekce aktualizací, přestože ta fungovala.
Při přidávání nového skrývatelného prvku na to nemyslet nemusíš, pravidlo to
pokrývá — ale nepřepisuj ho.

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
zrychlit checkpoint 8 (Capacitor nativní HTTP obchází CORS úplně).

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

### ✅ 2) Graf se svíčkami

Svíčkový graf vybraného páru přes celou obrazovku, s vodorovnými čarami:
vstup, likvidace, SL, TP a otevřené příkazy. Data z `/v5/market/kline`,
`/v5/order/realtime` a SL/TP z pozice. Živá poslední svíčka přes veřejný WS.
Přepínač intervalu, posun a zoom prstem. Návrat přes `history.pushState`, aby
graf zavíralo i hardwarové tlačítko zpět.

⚠ **Bybit vrací SL a TP pozice dvakrát** — jednou jako vlastnost pozice
(`stopLoss`, `takeProfit`) a podruhé jako podmíněné příkazy v
`/v5/order/realtime`. Bez odfiltrování se každá úroveň nakreslí dvakrát.
Příkazy se proto porovnávají s SL/TP pozice na shodu ceny (s tolerancí, ne na
rovnost) a duplicity se zahodí.

Zařazení příkazu na stranu zisku či ztráty jde primárně podle `stopOrderType`
(`TakeProfit`, `StopLoss`, `PartialTakeProfit`, `PartialStopLoss`,
`TrailingStop`, `Stop`). Když Bybit pošle jen obecné `Stop`, rozhodne poloha
vůči vstupu — u longu je cena nad vstupem výběr zisku, pod vstupem ochrana
ztráty, u shortu obráceně. **Heuristika platí jen na příkazy, které pozici
zavírají** (`reduceOnly` nebo s `stopOrderType`); obyčejná limitka pod vstupem
je přikupování, ne stop-loss.

Popisky jsou schválně krátké, ať neujídají plochu grafu: `Vstup`, `SL`, `TP`
pro celou pozici a `TP1 (29 %)`, `SL1 (16 %)` pro částečné. Číslují se podle
toho, v jakém pořadí je cena zasáhne — nejblíž vstupu je první.

Pod grafem je panel s údaji o pozici (velikost, hodnota, margin, vstup, mark,
ROE, SL, TP, likvidace). Nahradil legendu čar — ta jen opakovala hodnoty,
které graf sám píše na cenovou osu.

### ✅ 3) Kreslení a indikátory

Předsunuto před ostatní na přání uživatele: bez kreslení a indikátorů pro něj
aplikace nedává smysl.

Kreslicí nástroje (úsečka, polopřímka, přímka, vodorovná úroveň, svislá čára,
cenová čára, cenový kanál, rovnoběžky, Fibonacci, poznámka) a indikátory
(objem, RSI, MACD, KDJ, klouzavý průměr, EMA, Bollinger, SAR). Kresby se
ukládají do `localStorage` **podle páru**, takže přežijí zavření aplikace
i restart telefonu.

#### Výměna knihovny grafu

Graf kreslí **KLineChart** (`vendor/klinecharts.js`, Apache-2.0, 27 indikátorů
a 16 kreslicích nástrojů z krabice). Nahradil `lightweight-charts`, který
**kreslicí nástroje ani indikátory nemá** — umí jen vodorovné cenové čáry.

Proč ne TradingView Advanced Charts, kterou používají velké burzovní aplikace:
je zdarma, ale **jen pro firmy a veřejné projekty**, ne pro osobní použití,
a zakazuje mít jakoukoli svou část ve veřejném repozitáři. Pro tenhle projekt
je tedy nepoužitelná licenčně, ne technicky. Ověřeno 2026-09-20.

Výměna stála **jen `js/chart.js`** a tvar čar v `app.js`. Právě proto se
grafová vrstva drží v odděleném modulu, který o Bybitu nic neví.

#### Co je u KLineChartu jinak

- Data se nepředávají, **chart si je vyžádá sám** přes `setDataLoader`.
  `setSymbol` a `setPeriod` spustí `getBars`, živá svíčka jde přes callback
  z `subscribeBar`. Časy jsou v **milisekundách**.
- Časové pásmo umí nativně (`setTimezone('Europe/Prague')`), není potřeba
  přeformátovávat osu ručně.
- Vestavěný `priceLine` neumí popisek, takže čáry pozice kreslí **vlastní
  overlay `positionLine`** (čára + text) registrovaný přes `registerOverlay`.
  Má `lock: true`, aby s ním uživatel nemohl hýbat.
- Overlaye se dělí `groupId` na `pozice` a `kresby`. Bez toho by se čáry
  pozice ukládaly mezi kresby uživatele.

#### Kreslení jde mimo knihovnu — `js/draw.js`

⚠ **Vestavěné kreslení knihovny se nepoužívá.** Klade body přímo pod prst, což
je na telefonu nepoužitelné: prst zakrývá místo, kam míříš, a klepnutí se často
vyhodnotí jako posun grafu, takže se bod vůbec nezapíše. Ani `drawingMode:
'continuous'` (tažení místo klepání) uživateli nestačil.

`js/draw.js` proto dělá vlastní ovládání podle vzoru TabTraderu a mobilního
TradingView:

1. Po zapnutí nástroje se přes graf položí **čárkovaný kříž s tečkou**.
2. Prst kříž jen **posouvá relativně** — táhne se kdekoli po displeji, takže
   prst necloní cíli.
3. **Klepnutí** (tah kratší než 8 px) bod potvrdí.
4. Od potvrzeného bodu se táhne náhled dalšího úseku.
5. Po posledním bodu vznikne overlay v knihovně s hotovými body.

Úpravy: klepnutí na hotovou kresbu ji vybere a ukáže **velké duté kroužky** na
bodech. Klepnutí na kroužek ho vezme do kříže, posouvá se zase tažením kdekoli
a klepnutí posun potvrdí (`overrideOverlay`).

Doprovodné prvky, bez kterých se kreslí naslepo: **pruh s návodem** nahoře
(„Klepnutím urči 1. bod z 2") s křížkem na zrušení, **cenovka na pravém okraji**
a **čas dole**, obojí se mění s křížem.

Souřadnice: `chart.convertToPixel` / `convertFromPixel` s `paneId: 'candle_pane'`.
Kreslicí vrstva se proto musí položit **přesně na plochu se svíčkami** (bez
cenové osy a panelů indikátorů) podle `chart.getSize('candle_pane', 'main')` —
jinak by pixely nesouhlasily. Dělá to `umistiVrstvu()` po každé změně rozměrů,
dat i indikátorů.

Vrstva má v klidu `pointer-events: none`, aby šlo grafem normálně posouvat.
Kresby se vytvářejí s `lock: true`, takže s nimi knihovna sama hýbat nedovolí
— veškerý posun jde přes naše úchyty.

⚠ **`restoreDrawings` musí umlčet hlášení změn.** Obnova nejdřív maže staré
overlaye a každé smazání hlásí změnu. Bez umlčení se při otevření grafu uloží
prázdný seznam přes uložené kresby dřív, než se stihnou obnovit — tedy tiché
smazání práce uživatele. Řeší to příznak `tichaZmena`.

#### Volume profile

V 27 vestavěných indikátorech **není** (`AVP` je průměrná cena, ne profil
objemu). Doplnit ho jde přes `registerIndicator`, kde vlastní indikátor dostane
plátno (`ctx`) i obě osy pro převod ceny na pixely — přesně co profil objemu
potřebuje.

Poctivý volume profile ale potřebuje data o jednotlivých obchodech. Bybit na to
endpoint nemá, takže ze svíček (OHLCV) půjde jen **odhad** — objem každé svíčky
rozprostřený mezi její minimum a maximum. Dělá to tak většina retailových
nástrojů, ale přesné to není a uživatel o tom ví.

### 4) Layout pro Fold

- **Zavřený displej** (úzký, cover screen): seznam pozic.
- **Rozevřený**: graf zůstává **přes celou obrazovku**, ne vedle seznamu.

Rozhodnuto uživatelem po vyzkoušení checkpointu 2. Původní zadání znělo
„rozevřený: graf + seznam vedle sebe", ale v praxi se osvědčil celoobrazovkový
graf v obou polohách. Rozdělené zobrazení se zatím **nedělá**.

Zbývá tedy: chování při přeložení telefonu. Stav (otevřený graf, vybraný pár,
interval, zoom, scroll seznamu) musí přeložení přežít — Android při změně
skládání stránku nereloaduje, ale rozměry se mění a layout se musí přepnout
plynule. Přepínat podle `matchMedia` na šířku a poměr stran, ne podle detekce
zařízení.

### 5) Rozšířená data

- Přehled účtu: equity, volný margin, využití marginu (`/v5/account/wallet-balance`).
- Funding: příští sazba a čas do stržení, náklad na pozici za den.
- Otevřené příkazy jako samostatný seznam, nejen čáry v grafu.
- Realizované PnL a historie uzavřených obchodů (`/v5/position/closed-pnl`).

### 6) Pohodlí

- Řazení a filtrování pozic (PnL, velikost, blízkost likvidace).
- Barevné varování na kartě při přiblížení k likvidaci, s volitelnou hranicí.
- Vibrace nebo zvuk při zásahu SL/TP.
- Volume profile jako vlastní indikátor (viz checkpoint 3).

### 7) Bezpečnost

**Odemykání otiskem prstu je požadavek uživatele** (čtečka v bočním tlačítku
Foldu), ne jen PIN. Technicky to není přímočaré:

- WebAuthn sám o sobě šifrovací klíč nedává, jen podpis. Aby otisk skutečně
  odemykal zašifrovaný secret, je potřeba rozšíření **PRF**, které z passkey
  odvodí stabilní klíč pro WebCrypto.
- Chrome na Androidu PRF přes Google Password Manager podporuje, ale ne každý
  poskytovatel passkeys ho umí. **Nutno ověřit přímo na cílovém Foldu 5,**
  než se na tom postaví úložiště.
- **PIN není alternativa k otisku, ale povinná záloha pod ním.** Otisk selhává
  u mokrého prstu a po restartu telefonu. Bez záložní cesty se uživatel ke svým
  klíčům nedostane.
- Nejsilnější varianta přijde až s APK (checkpoint 8): **Android Keystore**
  s hardwarově chráněným klíčem. To PWA neumí. Zvážit, jestli v PWA fázi
  nestačí jednodušší řešení a to pořádné nenechat až na APK.

Dál: přepínač na **testnet** (`api-testnet.bybit.com`, `stream-testnet.bybit.com`).
Ověřeno, že testnet odpovídá včetně CORS stejně jako produkce, takže jde jen
o výměnu základní adresy v `js/bybit.js`.

**Tenhle checkpoint musí být hotový dřív než checkpoint 9.** Dokud je klíč
read-only, je čitelný secret v `localStorage` přijatelné riziko — nejhorší
následek je, že někdo uvidí pozice. S právem obchodovat je nejhorší následek
vybydlený účet a stejné úložiště přijatelné přestává být.

### 8) APK přes Capacitor + notifikace

Zabalit do APK, aby aplikace mohla běžet na pozadí a posílat notifikace
(blížící se likvidace, zasažení SL/TP, výrazná změna PnL). Tady se vymění
transport v `js/bybit.js` za nativní HTTP/WebSocket plugin.

### 9) Zadávání příkazů (jen pokud se aplikace osvědčí)

Zatím **se nedělá** a aplikace zůstává výhradně read-only. Poznámky, ať se na
to při návrhu nezapomíná:

- Přidání je levné, protože veškerá komunikace je v `js/bybit.js`. Bybit V5
  podepisuje u POSTu místo query stringu **syrové tělo požadavku** — jinak
  stejný postup.
- Práva klíče na Bybitu nejdou dodatečně změnit, bude potřeba **nový klíč**.
  Výměnu klíče aplikace zvládá.
- **Pravidlo:** modul nabízí pouze čtení. Zápis přijde jako zřetelně oddělená
  část s potvrzovacím krokem, aby chyba v UI nemohla omylem odeslat příkaz.
- Předpoklad: hotový checkpoint 7 (šifrované klíče).

#### Postup testování zápisu — tři vrstvy, ne jedna

Uživatel si výslovně nepřeje riskovat účet při vývoji zápisu. Pořadí je závazné:

1. **Testnet.** Veškerý vývoj a ladění zápisu. Falešné peníze, nulové riziko.
   Tohle je hlavní ochrana, ne doplněk.
2. **Subúčet s malou částkou.** Ověření, že se to chová stejně i v ostrém
   prostředí. Subúčet má vlastní API klíče, které se k penězům na hlavním účtu
   nedostanou, takže maximální ztráta je to, co je na subúčtu. Konkrétní
   chování subúčtů a rozsah jejich klíčů **ověřit v dokumentaci Bybitu**
   ve chvíli, kdy se k tomu dojde — nespoléhat na paměť.
3. **Hlavní účet** až nakonec, a i pak se stropem na velikost příkazu
   a potvrzovacím krokem.

**Oprávnění k výběru se nezapíná nikdy.** Je na Bybitu samostatné a navíc
vyžaduje předem schválené adresy. Bez něj je nejhorší možný následek chyby
špatný obchod, ne odtečení prostředků pryč z účtu. Tohle je ta vlastnost,
která celý zápis dělá přijatelně bezpečným.

## Lokální vývoj

`file://` nestačí (ES moduly + service worker potřebují origin). Spusť:

```bash
python -m http.server 8080
```

a otevři `http://localhost:8080`. Service worker běží i na `localhost` bez HTTPS.
