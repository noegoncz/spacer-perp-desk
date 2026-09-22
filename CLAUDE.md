# Spacer Perp Desk

Mobilní PWA pro monitoring otevřených perpetual pozic na Bybitu. Náhrada za TabTrader.

## Kontext

- **Jediné cílové zařízení:** Samsung Galaxy Z Fold 5 (Android, Chrome).
  Neřešíme desktop ani iOS, neřešíme starší prohlížeče.
- **Jazyk:** komunikace s uživatelem **česky**. UI aplikace je **anglicky**
  (výchozí), čeština je volitelná mutace. Kód a komentáře **zůstávají česky**.
- **Popisek ikony na ploše:** `Perp Desk` (pole `short_name` v manifestu).
- **Režim:** read-only monitoring. Aplikace nikdy neodesílá obchodní příkazy.
  API klíč se používá výhradně read-only.

## Pravidlo pro práci na projektu

> **Po úpravě souboru ověř, že se opravdu provedla.** Textová náhrada, která
> nenajde kotvu, tiše neudělá nic. Stalo se to v tomhle projektu třikrát:
> jednou prošel commit se slíbenými tenkými čarami, které v něm nebyly,
> a jednou se přidalo volání funkce, jejíž definice se nevložila — aplikace
> pak padala na `vykresliCary is not defined`.


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
js/format.js            # formátování čísel, cen, časů (podle jazyka)
js/i18n.js              # ⚠ překlady; texty nikdy přímo v kódu ani v HTML
js/i18n/en.js           # anglický slovník — základ
js/i18n/cs.js           # český slovník
js/ui.js                # vykreslování DOM
js/chart.js             # obal nad knihovnou grafu (KLineChart), o Bybitu neví
js/draw.js              # dotykové kreslení se zaměřovacím křížem
js/indikatory.js        # schémata nastavení indikátorů + vyhlazovací funkce (SMA/EMA/SMMA/WMA)
js/app.js               # orchestrace, lifecycle, update service workeru
vendor/                 # KLineChart + licence, stažené v repu (ne CDN)
tools/                  # testy přes DevTools Protocol, bez API klíčů (viz tools/README.md)
.github/workflows/deploy.yml
```

### `js/bybit.js` je izolovaný záměrně

Veškerá komunikace s burzou (REST i WebSocket) je **jen** v tomto modulu.
Zbytek aplikace ho zná přes úzké API a nikdy nesahá na `fetch` ani `WebSocket`
přímo. Důvod: v checkpointu 10 se aplikace balí do APK přes Capacitor a transport
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
zrychlit checkpoint 10 (Capacitor nativní HTTP obchází CORS úplně).

### ⚠ Adresy streamů — `public` v cestě

```
wss://stream.bybit.com/v5/public/linear    ← veřejný (svíčky, ticker)
wss://stream.bybit.com/v5/private          ← privátní (pozice)
```

Veřejná adresa **musí obsahovat `public`**. Bez něj se spojení vůbec nenaváže:
zavře se kódem 1006, tiše, a aplikace jen pořád dokola zkouší znovu.

Stalo se to a nikdo si toho dlouho nevšiml (opraveno 2026-09-22, v0.10.7).
Veřejný stream **nikdy nefungoval**, takže se živé svíčky nehýbaly a mark cena
se měnila jen při dotazu po 30 s. Vypadalo to jako chybějící funkce, přitom šlo
o jedno chybějící slovo v adrese.

⚠ **Podstrčená data takovou chybu z principu neodhalí** — mock odpoví na cokoli,
takže se špatná adresa tváří v pořádku. Proto je `tools/test-spojeni-burza.py`,
který jde **proti skutečné burze** a ověří, že se každá adresa opravdu otevře
a že v datech jsou pole, která čteme. Klíče na to nejsou potřeba, všechno
potřebné je veřejné. Pouštěj ho po každém zásahu do `js/bybit.js`.

⚠ **Svíčky v mocku musí sedět na skutečné hranice období**
(`Math.floor(Date.now() / krok) * krok`). S vymyšlenými časy vyjde živá svíčka
z burzy „starší" než poslední podstrčená a knihovna ji právem zahodí — což
vypadá jako chyba aplikace, ale je to chyba testu. Taky na to jeden test doplatil.

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

#### Jednotný systém čar

Všechny čáry pozice mají **tloušťku 1** a liší se barvou i čárkováním.
U SL, TP a likvidace nese barva informaci, tam se vyplatí.

| čára | čárkování | barva |
|---|---|---|
| vstup | `7-3-2-3` čerchovaná | fialová `#a78bfa` |
| likvidace | `12-5` dlouhá | červená |
| SL / TP celé pozice | `6-4` | oranžová / zelená |
| částečné TP a SL | `3-3` krátká | oranžová / zelená |
| limitky | `1-4` tečkovaná | šedá |

**Kresby uživatele** mají naopak výchozí barvu **bílou** (první v paletě),
aby nepřebíjely svíčky. Ostatní barvy zůstávají na výběr.

Popisky jsou u pravého okraje vedle cenové osy, **bez podkladu a rámečku**;
barevný blok za textem jen ujídal pohled na svíčky.

Popisky jsou schválně krátké: `Vstup`, `SL`, `TP`
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

#### Vzhled kreseb a alarmy

Po vybrání kresby se dole objeví paleta: šest barev, tři tloušťky, tři
průhlednosti, zvonek (alarm) a koš. Styl se drží v `extendData` overlaye,
takže se ukládá i načítá spolu s body. Nová kresba převezme naposledy
nastavený vzhled.

**Alarm při protnutí cenou** je v `app.js`. Hodnota kresby v čase se u
vodorovné čáry bere přímo, u dvoubodových se dopočítá z přímky mezi body
(a za koncem extrapoluje). Protnutí se pozná ze změny znaménka rozdílu
oproti minulé ceně. Alarm je **jednorázový** — po zaznění se vypne, jinak
by zvonil při každém ticku. Zvuková a vibrační odezva plus pruh v UI.

⚠ Upozornění při **zavřené** aplikaci potřebuje APK z checkpointu 10;
v prohlížeči to spolehlivě nejde.

#### Srovnání pohledu a celá obrazovka

⚠ **Instance grafu se mezi otevřeními recykluje** kvůli rychlosti, takže si
nese posun i přiblížení z minula. Uživatel pak po otevření grafu hledal, kde
vůbec jsou aktuální svíčky — poslední svíčka byla klidně trojnásobek šířky
plátna mimo obraz. Proto `srovnejPohled()` (výchozí šířka svící + skok na
konec dat) běží **po dodání dat i po změně intervalu**.

Měřením ověřeno: po srovnání je vidět ~48 svíček, poslední je v pravé části
plátna a svíčky vyplňují okolo 88 % výšky.

Dřív tu byl svislý posuvník vlevo s vlastním `createRange`. Zrušen — uživateli
překážel a jeho přínos nahradilo automatické srovnání. Osu si knihovna zase
počítá sama podle viditelných svíček.

⚠ Ověřeno, že **čáry pozice cenovou osu neroztahují** (ani likvidace 74 % pod
cenou). Kdyby graf někdy vypadal zmáčknutě, viník je jinde — nejspíš zase
zděděný posun.

Tlačítko v hlavičce přepíná skutečnou celou obrazovku přes Fullscreen API;
všechny nástroje zůstávají, ustoupí jen údaje o pozici.

#### Volume profile

V 27 vestavěných indikátorech **není** (`AVP` je průměrná cena, ne profil
objemu). Doplnit ho jde přes `registerIndicator`, kde vlastní indikátor dostane
plátno (`ctx`) i obě osy pro převod ceny na pixely — přesně co profil objemu
potřebuje.

Poctivý volume profile ale potřebuje data o jednotlivých obchodech. Bybit na to
endpoint nemá, takže ze svíček (OHLCV) půjde jen **odhad** — objem každé svíčky
rozprostřený mezi její minimum a maximum. Dělá to tak většina retailových
nástrojů, ale přesné to není a uživatel o tom ví.

### ✅ 4) Angličtina jako základ, texty stranou

Aplikace vznikla česky, ale **výchozím jazykem má být angličtina** — kdyby se
někdy prodávala, čeština by byla ta okrajová mutace, ne naopak.

- Všechny texty viditelné uživateli vytáhnout do **jednoho slovníku**
  (`js/i18n/en.js`, `js/i18n/cs.js`), aby šlo další jazyk přidat překladem
  jednoho souboru, ne hledáním řetězců po kódu.
- Týká se i textů v `index.html` (přes `data-i18n`), chybových hlášek
  Bybitu v `bybit.js`, návodů při kreslení a názvů nástrojů a indikátorů.
- Výchozí angličtina, čeština volitelně; jazyk podle nastavení, ne podle
  prohlížeče, ať se dá přepnout.
- **Kód a komentáře zůstávají česky** — píše se pro uživatele, ne pro překlad.

#### Jak to funguje

`t('klic')` vrátí text, `t('klic', { n: 1 })` dosadí `{n}` v šabloně.
Statické texty v HTML nesou atributy `data-i18n`, `data-i18n-title`,
`data-i18n-aria` a `data-i18n-ph`; `applyStaticTexts()` je při startu a po
změně jazyka přepíše. Jako záložní obsah je v HTML rovnou **anglický text**,
aby stránka dávala smysl i kdyby JavaScript selhal.

Chybí-li klíč ve zvoleném jazyce, vezme se anglický; chybí-li i tam, vrátí se
**samotný klíč**, takže je v UI hned vidět, co se zapomnělo doplnit.

Formátování čísel a časů se řídí jazykem (`getLocale()`), ne nastavením
telefonu — anglicky 1,234.56, česky 1 234,56.

⚠ **Nový text nikdy nepiš přímo do kódu ani do HTML.** Přidej klíč do
`en.js` i `cs.js`. Kontrola, že se na to nezapomnělo: hledání řetězců
s diakritikou v `js/*.js` mimo komentáře musí vracet prázdno.

### 5) Layout pro Fold

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

### 6) Záložky na hlavní obrazovce a historie

Hlavní obrazovka má nahoře tři záložky: **Pozice**, **Trhy** a **Historie**.

#### ✅ Trhy

Všech ~775 linear USDT párů z `/v5/market/tickers` (veřejné, bez klíčů),
seřazených podle obratu za 24 h. Hvězdička přidá pár mezi oblíbené a ty se
řadí navrch. Hledání filtruje celý seznam, přepínač ukáže jen oblíbené.

⚠ Bez ořezu by se seznam na telefonu vlekl, takže se kreslí **oblíbené plus
prvních 150** podle obratu. **Při hledání se neořezává**, jinak by se hledaný
pár nemusel vůbec objevit.

Ověřeno 2026-09-21: všech 775 USDT symbolů v `category=linear` jsou opravdu
**perpetuály**, ani jeden nemá datum dodání. Padesát z nich je ale
v předlistingové fázi (`curPreListingPhase`) a ještě se neobchoduje — ty se
odfiltrovávají, zbývá jich 725.

**Mini-graf trendu za 24 h** u každého řádku. Bybit nemá hromadný endpoint na
svíčky, takže se tahá **jeden pár za jedno volání** (24 hodinových svíček,
~2 kB). Proto se načítá až pro řádky, které jsou vidět (`IntersectionObserver`
s předstihem 150 px), nejvýš čtyři naráz, a jednou stažený pár se drží
v paměti. Bez toho by otevření záložky spustilo 150 volání naráz.

Mezi oblíbenými a zbytkem je **dělicí tlačítko** („Zobrazit / skrýt všechny
páry") se šipkami. Dělá totéž co hvězdička filtru nahoře, jen je po ruce tam,
kde seznam končí. Při hledání se neukazuje — ve výsledcích by jen mátlo.

Mezi záložkami jde **přejíždět prstem**. Vyžaduje se pohyb aspoň 55 px
a vodorovně víc než dvojnásobek svislého. Po přejetí se potlačí následné
klepnutí, jinak by se otevřel pár pod prstem. Nad otevřeným grafem
a v nastavení se přejíždění neuplatní.

⚠ **Musí stát na dotykových událostech, ne na ukazovátkových.** Prohlížeč si
gesto po pár pixelech vezme na svislé scrollování (prst má vždycky nějaký
svislý posun) a ukazovátkový proud ukončí `pointercancel` — `pointerup` už
nikdy nepřijde. Dotykové události přitom běží dál. Ověřeno skutečným gestem:

```
pointerdown → touchstart → pointermove → touchmove → pointercancel
            → touchmove×8 → touchend
```

`preventDefault()` na `touchmove` scrollování zastaví; na `pointermove`
nedělá nic. Volá se až ve chvíli, kdy je jasné, že jde o vodorovný tah.
K tomu `touch-action: pan-y` na třech obrazovkách záložek — na grafu ne,
tam by to sebralo dotyk vodorovně posuvným lištám.

#### Rozvržení obrazovky grafu

Shora dolů: **hlavička** (zpět, pár, PnL, celá obrazovka) → **údaje o pozici**
→ **kreslicí lišta** → **graf** → **timeframy**.

Údaje o pozici jsou nahoře schválně: pod nimi zůstane graf souvislý až
k timeframům. V celé obrazovce ustoupí, nástroje zůstávají.

Kreslicí lišta ukazuje **všech 12 nástrojů** plus magnet, indikátory, koš
a celou obrazovku (ta je vždy úplně vpravo), proto jsou tlačítka 34 px. Na
rozevřeném Foldu se vejdou bez posouvání, na zavřeném displeji se lišta
posouvá do strany.

Výchozí interval je **4h**.

⚠ **Pomocná tlačítka lišty (magnet, indikátory, koš, celá obrazovka)
jsou v napevno ukotvené části vpravo**, mimo posuvnou oblast s nástroji.
Dřív byla v posuvné části a na úzkém displeji skončila mimo obrazovku —
uživatel na ikonu indikátorů vůbec nedosáhl.

⚠ **Gesto zahájené na cenové ose musí zůstat u osy.** Když prst sjede do
plochy grafu, knihovna by začala graf posouvat a obraz poskakuje. Řeší to
`oddelGestaOsy()`: na `touchstart` nad osou vypne posun a zoom grafu a vrátí
je až po zvednutí prstu.

⚠ **Při změně intervalu se čáry i kresby nejdřív sundají** a vrátí až spolu
s novými svíčkami. Jinak se na okamžik přepočítaly na stará data, poskočily,
a teprve pak naskočil nový graf.

⚠ **Zoom dvěma prsty si řídíme sami** (`zapojZoomDvemaPrsty()` v chart.js).
Vestavěný zoom knihovny je na telefonu moc citlivý a hlavně: prsty nejde
z displeje sundat současně, takže zbylý prst okamžitě pokračoval jako posun
a obraz odskočil. Po dobu gesta se posun i zoom knihovny vypnou, šířka svíčky
se nastavuje přes `setBarSpace()` s útlumem `pomer ** 0.55`, a posun se vrátí
teprve až **nezůstane na displeji žádný prst** — ne po prvním `touchend`.

⚠ **Tlačítko s třídou `.interval-btn` musí mít `data-interval`, nebo se z něj
nesmí vybírat.** Tlačítko středu (CENTER) chvíli sdílelo vzhled s timeframy
a stálo v jejich liště. Posluchač `document.querySelectorAll('.interval-btn')`
ho vzal jako přepnutí na interval `undefined`: graf se vyprázdnil (0 svíček,
osa 0–10), zmizely kresby i čáry. Selektory jsou proto
`.interval-btn[data-interval]` a `zmenInterval()` prázdný interval odmítne.
Test s mockem to dřív nechytil, protože mock vracel svíčky pro jakýkoli interval —
`tools/mock-bybit.js` teď pro neexistující interval vrací prázdno.

**Tlačítko středu je zrušené** (uživatel 2026-09-21: „to je na nic"). Srovnání
pohledu obstarává `srovnejPohled()` sám při otevření grafu a změně intervalu.

⚠ **Snímek kreseb při změně intervalu se bere jen jednou.** `setInterval()` si
kresby zapamatuje z grafu a pak je z něj sundá. Při rychlém proklikávání
timeframů byl graf už prázdný, druhý snímek byl prázdný a obnovilo se „nic“ —
kresby zmizely z obrazovky, ač v úložišti zůstaly (po restartu byly zpátky).
Ukládání se spouští jen vytvořením a potvrzenou úpravou, ne smazáním overlaye,
proto se o data přijít nedá. Test: `tools/test-rychle-prepinani.py`.

⚠ Při testování gest dvěma prsty přes CDP je nutné dávat dotykovým bodům
**výslovné `id`**. Bez nich Chrome přiřadí bod podle pořadí a pohyb zbylého
prstu se tváří jako nový, třetí prst — test pak hlásí odskok, který v aplikaci
není. (Stálo to jeden falešný poplach.)

⚠ **Na stejné období knihovna znovu nesáhne pro data.** `setPeriod()` se stejnou
hodnotou nezavolá `getBars`, a právě v něm se kresby vracejí do grafu. Druhé
klepnutí na už aktivní timeframe tak kresby sundalo a neměl je kdo vrátit —
objevily se až po přepnutí na jiný timeframe. Ošetřeno dvakrát: `zmenInterval()`
klepnutí na aktivní timeframe ignoruje (jako TradingView) a `setInterval()`
v chart.js při shodném období kresby vůbec nesundává.
Test: `tools/test-stejny-timeframe.py`.

⚠ **Srovnání pohledu se plánuje přes `requestAnimationFrame`, ne `setTimeout(…, 0)`.**
Po otevření grafu se ještě vracejí kresby a čáry pozice a plátno se překresluje;
srovnání puštěné dřív se nestihlo projevit a pohled skončil o sedm svíček před
koncem dat, takže poslední svíčka nebyla vidět. Dva snímky za sebou
(`srovnejAzPoVykresleni()`), první jen zpracuje probíhající změny.

⚠ **Svíčky nového timeframu se stahují dopředu** (`zmenInterval()` v app.js).
Při přepnutí se kresby z grafu sundají a vracejí se až s novými daty, takže
bez předstihu blikaly pryč po celou dobu čekání na síť — na telefonu klidně
půl vteřiny. Loader si předchystaná data vyzvedne z `pripraveneSvice`. Rychlé
klepání ošetřuje počítadlo žádostí: starší odpověď se zahodí.

⚠ **Kresby a čáry se vracejí ve stejném průchodu jako data**, ne přes
`setTimeout`. Jakýkoli odklad znamená snímek, ve kterém graf nové svíčky už má
a kresby ne — a ty probliknou. Měří to `tools/test-probliknuti.py`: kresba
dostane nepřehlédnutelnou barvu a během přepínání se hustě vzorkuje plátno.
Před opravou chyběla ve 37 ze 130 snímků, po ní v nule.

#### Indikátory a jejich nastavení

Schémata nastavení jsou v **`js/indikatory.js`**. Obrazovka nastavení se z nich
generuje sama, takže přidat volbu (nebo celý indikátor) znamená sáhnout jen do
toho souboru. Pole s `param: n` jde do `calcParams[n]`, tedy do výpočtu;
ostatní pole jsou vzhled a stačí překreslit.

⚠ **Pole podřízené přepínači se obaluje `podle(pole, 'klicPrepinace')`.** Když
je přepínač vypnutý, řádek zešedne a jeho ovládání se zablokuje — jinak by
uživatel ladil barvu něčeho, co není vidět. Přepínač musí ve schématu stát
**před** tím, co ovládá, aby zešedlá pole dávala smysl na první pohled.

Výška vlastního panelu (`vyskaPanelu`) se zadává **v procentech plochy grafu**,
ne v pixelech: na rozevřeném Foldu a na zavřeném displeji je plocha jinak
vysoká a pevná hodnota by jednou zabrala půlku, podruhé proužek. Uplatňuje se
přes `setPaneOptions({ id, height })` (výchozí výška panelu knihovny je 100 px)
a přepočítává se i při změně rozměrů. Svíčkám vždy zbyde aspoň 45 % plochy.

⚠ **Objem se nedá vložit do hlavního panelu jako vestavěný `VOL`.** Má
`series: 'volume'`, takže si vyrobí vlastní svislou osu, **přebere jí pravou
stupnici** (místo ceny se ukazuje objem) a sloupce roztáhne přes celou výšku —
svíčky pak nejsou vidět. Ověřeno měřením: osa se po vložení změnila z rozsahu
cen na rozsah objemů.

Proto je v `chart.js` pod stejným názvem `VOL` registrovaný **vlastní
indikátor s prázdným `figures`**. Bez figur do měřítka osy nemluví, cenová
stupnice zůstane cenová, a sloupce si kreslíme sami do spodního pruhu panelu
(výška a průhlednost jsou nastavitelné). Měřítko sloupců se bere **jen
z právě viditelných svíček** — jinak jeden dávný výkyv zploští všechno ostatní.

RSI je taky vlastní: vestavěné kreslí tři křivky, neumí pásma ani volbu zdroje
ceny. Naše má jednu křivku, volitelný průměr (**SMA, EMA, SMMA, WMA** — funkce
`vyhladit()` v `js/indikatory.js`, ověřená proti ručně spočítaným hodnotám),
pásma s výplní a pevnou stupnici 0–100. `calcParams` RSI je
`[délka, délka průměru, zdroj ceny, typ průměru]`.

⚠ **Pole ve schématu bez `param` se do výpočtu nedostane.** Volba zdroje ceny
u RSI takhle první verzi nefungovala (nebylo vidět, protože testovací data
měla `close = open + konstanta` a všechny zdroje dávaly stejné RSI). ⚠ Křivku knihovna **skrýt neumí** — vypnutý průměr se řeší průhlednou
barvou.

⚠ **Legendu indikátoru skládá knihovna ze surových `calcParams`** — z „RSI(14,14,0,0)"
uživatel nepozná nic. Přepisuje ji `createTooltipDataSource`, které stačí vrátit
`calcParamsText`; hodnoty křivek si knihovna doplní sama (výchozí legendy staví
dřív a vlastní zdroj přepíše jen to, co vrátí). Teď stojí v grafu
`RSI 14 · Close · WMA 14` a `Vol MA 20`, a text se mění s nastavením.
Test: `tools/test-legenda.py`.

⚠ **Živá svíčka musí mít pole `timestamp`, ne `time`.** Knihovna svíčku
s cizím názvem pole **tiše zahodí** — nic nevypíše, jen se nic nestane.
Modul Bybitu mluví o `time`, takže překlad dělá `updateCandle()` v chart.js.
Bez něj vypadalo, že živé svíčky vůbec neumíme: cena se v grafu hnula až po
přenačtení dat při změně timeframu. Odběr `kline.{interval}.{symbol}` přitom
běžel správně celou dobu. Ověřeno měřením: s `time` zůstala poslední cena
0.3, s `timestamp` se změnila. Test: `tools/test-zive-svicky.py`.

⚠ `klinecharts.getChart()` ve verzi 10 **neexistuje**. K instanci grafu se
z testu dostaneš jedině obalením `klinecharts.init` (viz `tools/mock-bybit.js`,
instance je pak v `window.__graf`).

⚠ Vysouvací nabídky (`.sheet`) jsou **`position: fixed`**, ne `absolute`.
Ve vnořeném rozvržení se jinak ukotví k rodiči a skončí uprostřed obrazovky,
kde je uživatel nehledá. Nabídka indikátorů má v každém řádku ikonku, zkratku
a stručný popis, a po výběru se sama zavře.

Klepnutí na pár otevře graf. Proto graf nově funguje **i bez otevřené pozice**:
`chartSymbol` je zdroj pravdy o tom, co se kreslí, `chartPosition` může být
`null`. Pak se nekreslí čáry pozice, panel pod grafem ustoupí a v hlavičce je
místo PnL změna za 24 h. Příkazy se dotahují jen s uloženými klíči.

#### ✅ Historie

**Historie** vypíše posledních pár obchodů na páru se vším podstatným
a po rozkliknutí ukáže graf z té doby s vyznačenými vstupy a výstupy.

Ověřeno 2026-09-21, že Bybit tahle data dává a CORS je propouští:

| Endpoint | K čemu |
|---|---|
| `/v5/position/closed-pnl` | uzavřené obchody: vstup, výstup, PnL, páka, čas |
| `/v5/execution/list` | **jednotlivá plnění** — přesný čas a cena každého vstupu i výstupu |
| `/v5/order/history` | historie příkazů |

Pro značky v grafu je klíčový `execution/list`, ne `closed-pnl` — ten dává jen
průměrný vstup a výstup, kdežto plnění mají přesné časy, takže se dají položit
na správné svíčky. Obchod postavený z více nákupů a prodejů se tak ukáže tak,
jak opravdu probíhal.

⚠ **`side` v `closed-pnl` je strana zavírací objednávky, ne směr pozice** —
dlouhá pozice se zavírá prodejem. Směr se proto odvozuje z cen a zisku:
když se vydělalo a výstup byl výš než vstup, šlo o long. Je to samo o sobě
konzistentní a nezávisí to na výkladu cizího pole.

Klepnutí na obchod otevře graf z jeho doby se značkami plnění (trojúhelník
ve směru obchodu + popisek). **Interval se volí podle délky obchodu** — na
hodinový obchod je denní svíčka k ničemu a na dvouměsíční zase minutová.
Kline se načítá s parametrem `end`, jinak by Bybit vrátil nejnovější svíčky
místo těch z doby obchodu.

### 7) Rozšířená data o účtu

- Přehled účtu: equity, volný margin, využití marginu (`/v5/account/wallet-balance`).
- Funding: příští sazba a čas do stržení, náklad na pozici za den.
- Otevřené příkazy jako samostatný seznam, nejen čáry v grafu.

### 8) Pohodlí

- Řazení a filtrování pozic (PnL, velikost, blízkost likvidace).
- Barevné varování na kartě při přiblížení k likvidaci, s volitelnou hranicí.
- Vibrace nebo zvuk při zásahu SL/TP.
- Volume profile jako vlastní indikátor (viz checkpoint 3).
- Alarm při protnutí nakreslené čáry cenou.

### 9) Bezpečnost

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
- Nejsilnější varianta přijde až s APK (checkpoint 10): **Android Keystore**
  s hardwarově chráněným klíčem. To PWA neumí. Zvážit, jestli v PWA fázi
  nestačí jednodušší řešení a to pořádné nenechat až na APK.

Dál: přepínač na **testnet** (`api-testnet.bybit.com`, `stream-testnet.bybit.com`).
Ověřeno, že testnet odpovídá včetně CORS stejně jako produkce, takže jde jen
o výměnu základní adresy v `js/bybit.js`.

**Tenhle checkpoint musí být hotový dřív než checkpoint 11.** Dokud je klíč
read-only, je čitelný secret v `localStorage` přijatelné riziko — nejhorší
následek je, že někdo uvidí pozice. S právem obchodovat je nejhorší následek
vybydlený účet a stejné úložiště přijatelné přestává být.

### 10) APK přes Capacitor + notifikace

Zabalit do APK, aby aplikace mohla běžet na pozadí a posílat notifikace
(blížící se likvidace, zasažení SL/TP, výrazná změna PnL). Tady se vymění
transport v `js/bybit.js` za nativní HTTP/WebSocket plugin.

### 11) Zadávání příkazů (jen pokud se aplikace osvědčí)

Zatím **se nedělá** a aplikace zůstává výhradně read-only. Poznámky, ať se na
to při návrhu nezapomíná:

- Přidání je levné, protože veškerá komunikace je v `js/bybit.js`. Bybit V5
  podepisuje u POSTu místo query stringu **syrové tělo požadavku** — jinak
  stejný postup.
- Práva klíče na Bybitu nejdou dodatečně změnit, bude potřeba **nový klíč**.
  Výměnu klíče aplikace zvládá.
- **Pravidlo:** modul nabízí pouze čtení. Zápis přijde jako zřetelně oddělená
  část s potvrzovacím krokem, aby chyba v UI nemohla omylem odeslat příkaz.
- Předpoklad: hotový checkpoint 9 (šifrované klíče).

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

## Plán a otevřené věci

Pořadí, jak se na to má chodit. Odškrtnuté jsou hotové.

### Nejbližší dodělávky (drobné)

- [ ] **Ověřit na telefonu** (v0.10.5): kresby při přepínání timeframu ani
  neprobliknou; graf se po otevření ukáže u posledních svíček.
- [ ] **Zvážit kontrolu shody verzí** mezi `index.html` a `js/version.js`.
  Rozpadlá aktualizace (nová stránka + starý skript) se teď přežije, ale
  aplikace o nesouladu neví a běží dál se starým kódem, dokud se worker
  nepřehoupne sám.
- [ ] **RSI dál** podle TradingView: Calculate Divergence, VWMA, SMA + Bollinger
  Bands (BB StdDev), přechodová výplň pásem. (SMA, EMA, SMMA a WMA hotové.)
- [ ] **Volume dál**: přesnost (precision), popisky na cenové ose.
- [ ] **Nastavení ostatních indikátorů**: MACD, KDJ, MA, EMA, BOLL, SAR mají zatím
  jen periody (a výšku panelu) — chybí barvy a přepínače viditelnosti čar.
- [ ] **Alarmy — vlastní obrazovka a vzhled.** Podle TradingView (screenshot
  2026-09-22, dialog „Create alert"). Převzít: podmínka (protnutí hladiny,
  případně směr nahoru/dolů), **Trigger** (jen jednou / při každém protnutí),
  **Expiration** (platnost, pak alarm sám zmizí), vlastní **zpráva** a volba
  způsobu upozornění. V grafu má mít alarm **jinou čáru než kresby** —
  čerchovanou, vlastní barvou, s ikonou budíku u popisku. Zadávání musí být
  pohodlné, ne přes kreslicí nástroj.
- [ ] **Notifikace při zavřené aplikaci — rozhodnout cestu.** Když je aplikace
  zavřená, žádný její kód neběží; service worker prohlížeč uspí. Periodic
  Background Sync o časování rozhoduje sám (hodiny, ne vteřiny) a je
  experimentální, takže na cenové alarmy nestačí. Zbývají dvě cesty:
  **(a) server** hlídá veřejné ceny a pošle web push — tak to dělá TradingView
  i TabTrader; API klíč by ven nešel, jen pár a hladina, ale hladiny alarmů
  by telefon opustily a hosting je potřeba platit a udržovat;
  **(b) APK** (checkpoint 10) s během na pozadí — nic neodchází, nic se
  neplatí, ale Samsung služby na pozadí zabíjí, takže to chce výjimku
  z optimalizace baterie. ⚠ Uživatel používá **Brave**; u varianty (a) nejdřív
  ověřit push přímo na jeho telefonu.
- [ ] **Volume profile** jako vlastní indikátor (odhad ze svíček, viz checkpoint 3).

### Checkpointy

1. ✅ Připojení a seznam pozic
2. ✅ Graf se svíčkami
3. ✅ Kreslení a indikátory (rozšiřuje se dál výše)
4. ✅ Angličtina jako základ
5. ⏳ Layout pro Fold — stav při přeložení telefonu
6. ✅ Záložky Pozice / Trhy / Historie
7. ⏳ Rozšířená data o účtu (equity, margin, funding, příkazy)
8. ⏳ Pohodlí (řazení, varování před likvidací, vibrace)
9. ⏳ **Bezpečnost — otisk prstu (WebAuthn PRF) + šifrovaný secret + testnet.
   Musí být hotové před 11.**
10. ⏳ APK přes Capacitor + notifikace
11. ⏳ Zadávání příkazů — jen pokud se aplikace osvědčí; pořadí testnet →
    subúčet → hlavní účet, výběr nikdy

## Start aplikace musí být neprůstřelný

⚠ **Registrace service workeru stojí v `boot()` jako první**, hned za hlídáním
tichých chyb. Je to jediná cesta, kterou se telefon dostane k opravné verzi.
Dřív visela až za sestavením obrazovky — a když sestavení spadlo, aplikace se
nemohla opravit ani stažením nové verze. Nikdy ji neposouvej níž.

⚠ **Na prvky se věší přes `naUdalost(id, …)` a `prepniTridu(id, …)`**, ne přímo
přes `el('x').addEventListener`. Chybějící prvek se přeskočí místo pádu.

Proč: při aktualizaci umí prohlížeč krátce servírovat **novou `index.html`
se starým `app.js`** (nebo naopak). Starý kód pak sahá na prvek, který v nové
stránce už není. Stalo se 2026-09-21 po odstranění tlačítka středu: telefon
zůstal na verzi 0.10.1, ukazoval „Loading…", „Not connected" a červenou lištu
„Cannot read properties of null (reading 'addEventListener')". Aplikace se
z toho sama nedostala, protože se start nedobral k registraci workeru.

Test: `tools/test-odolny-start.py` servíruje stránku bez pěti tlačítek
a ověřuje, že se aplikace přesto sestaví, načte pozice a registraci spustí.
Na starém kódu padá stejně jako telefon uživatele.

⚠ Ten test **neměří `getRegistrations()`**. V headless Chrome registrace
uspěje (`register()` se splní), ale ve výpisu se stejně neobjeví — měřil by
vrtoch prohlížeče, ne aplikaci. Počítá se proto volání `register()`.

## Odkud berou obrazovky data

| co | zdroj | jak často |
|---|---|---|
| pozice | privátní WebSocket + REST záchrana | push; REST každých 30 s |
| živá svíčka v grafu | veřejný WS `kline.{interval}.{symbol}` | push při každém ticku |
| mark cena, změna 24 h | veřejný WS `tickers.{symbol}` | push |
| historie svíček | REST `/v5/market/kline` | při otevření grafu a změně intervalu |

Graf tedy **nemá žádný obnovovací interval** — svíčka se hýbe, jak přicházejí
ticky. Když se nehýbe, je rozbité spojení, ne časování.

## Časové limity u volání

⚠ **`fetch` sám o sobě žádný časový limit nemá.** Na telefonu se požadavek umí
zaseknout natrvalo (přepnutí sítě, mrtvá Wi-Fi). Stalo se ve verzi 0.7.0:
`/v5/market/time` neodpovědělo, `refresh()` na něm uvázlo, a protože se
opakované dotahování spouštělo až **po** něm, nikdy se nerozeběhlo — aplikace
zůstala natrvalo na „Načítám pozice…" bez jediné hlášky.

Proto `defaultHttpGet` používá `AbortController` s limitem 15 s a `start()`
rozjíždí opakované dotahování **jako první**, ještě před prvním načtením.

K tomu `hlidejTicheChyby()` v `app.js`: každá neodchycená chyba i zamítnutý
slib se ukáží v chybové liště. Nic nesmí selhat potichu — zamrzlá obrazovka
bez hlášky je to nejhorší, co uživatel může dostat.

## Diagnostika v aplikaci

Dokud nejsou vidět pozice, ukazuje se pod hláškou **diagnostický blok**: krok,
počet pokusů, stav REST i WebSocketu, čas posledních dat a poslední chyba
s časem. K tomu tlačítko **Zkusit znovu**.

Důvod: chybu na cizím telefonu jinak nejde než hádat, a hádání už dvakrát
minulo. Uživatel blok vyfotí a je hned jasné, kde se to zaseklo. Jakmile
pozice dorazí, blok zmizí.

Stopu plní `client.zapisDiag()` v `js/bybit.js`. ⚠ Chyba v `syncTime()` se
už **nesmí polykat potichu** — zapisuje se do stopy, i když se běží dál.

## Testování aplikace bez klíčů

`tools/app-test.py` spustí aplikaci s podstrčenými odpověďmi Bybitu, takže jdou
ověřit i cesty, které se bez přihlášení nespustí (vykreslení pozic, chování při
chybě, zaseknuté spojení). Právě tak se našla ta chyba s chybějícím limitem.

## Testování dotykových gest

⚠ **Syntetické `PointerEvent` vyslané z JavaScriptu obcházejí rozhodování
prohlížeče o gestech.** Projdou i u ovládání, které na telefonu nefunguje —
stalo se přesně to u přejíždění mezi záložkami.

Na gesta je proto `tools/touch-test.py`, který přes DevTools Protocol posílá
skutečné dotyky. Návod k použití je v hlavičce souboru. Do nasazení se
nedostane, workflow kopíruje jen `css`, `js`, `icons` a `vendor`.

⚠ **Testovací prohlížeč musí mít čistý profil, nebo vypnutý service worker.**
Jednou zaregistrovaný worker servíruje zakešované moduly, takže test ukazuje
starý kód a úpravy vypadají, že se neprovedly. Stalo se to u nastavení
indikátorů: obrazovka tvrdošíjně ukazovala staré schéma, přestože soubor na
disku byl nový. Odregistrování za běhu nestačí — stránka se už načetla
z cache, pomůže až nový `--user-data-dir`.

## Lokální vývoj

`file://` nestačí (ES moduly + service worker potřebují origin). Spusť:

```bash
python -m http.server 8080
```

a otevři `http://localhost:8080`. Service worker běží i na `localhost` bez HTTPS.
