# PerpyX

Mobilní PWA pro monitoring otevřených perpetual pozic na Bybitu. Náhrada za TabTrader.

Projekt v repu i na GitHubu se pořád jmenuje `spacer-perp-desk` (pracovní
název odshora) — je to jen adresář a URL, ne jméno aplikace. Přejmenování
repozitáře je samostatné rozhodnutí (mění se tím živá adresa GitHub Pages),
zatím k němu nedošlo.

## Vizuální identita

Ikona a značka appky je **tkané X** — dva pruhy s gradientem tyrkysová
`#22d3ee` → fialová `#7c5cff` na tmavé dlaždici `#0d1420`, kde jeden pruh
vizuálně podjíždí druhý (rozdělený na dvě části s mezerou, druhý pruh vcelku
nakreslený přes ni). Vzniklo brainstormem v konverzaci 2026-09-22 — několik
kol zamítnutých směrů (holé zaměřovací kříže → moc chladné a technické;
jednoduché barevné/tučné „X" → moc jednoduché; maskot robota/sovy → možná
moc hravé na seriózní tradingovou appku) než se ustálilo na týž tvar použitý
jak pro ikonu appky, tak jako poslední písmeno v nápisu „PerpyX" — uživatel
výslovně chtěl, aby to bylo **totéž**, ne dvě různé grafiky.

- SVG definice (jediný zdroj pravdy pro tvar): dvě `rect` o `width 64 height
  16 rx 4` v `<g transform="translate(50,50) rotate(±45)">` uvnitř
  `viewBox="0 0 100 100"`; „podjíždějící" pruh je rozdělený na dva `rect`
  (šířka 22, mezera 20) místo jednoho vcelku.
- `icons/icon-192.png` a `icons/icon-512.png`: ikona na zaoblené dlaždici
  (`rx 22`), vyrenderováno z SVG přes headless Chrome (`Page.captureScreenshot`
  s průhledným pozadím) — appka nemá build krok, takže se PNG negeneruje
  automaticky, jen jednorázově pro tenhle vzhled.
- `icons/maskable-512.png` je **jiná** varianta, ne jen zmenšenina: bez
  zaoblených rohů (OS aplikuje svou vlastní masku) a X zmenšené na 82 %,
  ať se vejde do bezpečné zóny ~66 % poloměru a žádná maska (kruh, čtverec
  se zaoblením, kapka) mu neusekne hroty.
- V hlavičce appky (`index.html`, `.topbar-brand`) je stejná grafika vložená
  přímo jako inline SVG vedle `<h1>PerpyX</h1>`, tentokrát **bez vlastní
  dlaždice** — na tmavém pozadí lišty by dlaždice jen duplikovala pozadí.
  Text nápisu zůstává v prostém řezu, ne v gradientu: v `.topbar h1` je
  `font-size: 1.05rem` (~17 px), kde by se jemné detaily gradientu i vlastní
  písmo Sora ztratily. Propracovanější wordmark (Sora, gradient přes celé
  „X", ikona + nápis vedle sebe) je promyšlený pro **větší kontexty** —
  README, případná úvodní obrazovka, opis appky v obchodě — ne pro
  16px lištu v telefonu.
- **Reference v1** je uložená v `design/logo-v1/` (SVG značky, SVG ikony
  a PNG z doby vzniku). **Doladění (2026-09-28)** před stavbou webu:
  srovnání v1 se sedmi variantami téhož tkaného X (čistý kanál, hloubka
  u křížení, zkosené konce, protisměrné přechody, pilulky, prémiová
  dlaždice, stoupající pruh navrchu, kombinace) je na plátně
  https://claude.ai/artifact/8NUuFpWtN9Shghdjgr4scY — dvě sady (jemné
  doladění A–H a odvážnější směry I–P: stuhy s hranou, asymetrie, šipka,
  vyražená ikona, prstenec „perpetual", bílé X, obrysy, sklo).
  **Rozhodnutí: zůstává v1** (uživatel po obou sadách, 2026-09-28). Nový
  návrh loga už nenabízet sám; kdyby se k tomu vrátil, plátno obě sady má.
- ⚠ Font **Sora** z Google Fonts se používá **jen** ve wordmark náhledech
  (zatím žádné v repu), ne v appce samotné — appka drží zavedený
  `-apple-system, "Segoe UI", Roboto, system-ui, sans-serif` všude, ať se
  nezavádí síťová závislost na fontu do PWA, která má fungovat i offline.

## Kontext

- **Jediné cílové zařízení:** Samsung Galaxy Z Fold 5 (Android, Chrome).
  Neřešíme desktop ani iOS, neřešíme starší prohlížeče.
- **Jazyk:** komunikace s uživatelem **česky**. UI aplikace je **anglicky**
  (výchozí), čeština je volitelná mutace. Kód a komentáře **zůstávají česky**.
- **Popisek ikony na ploše:** `PerpyX` (pole `short_name` v manifestu).
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
- ⚠ **Aplikace to vynucuje** (v0.20.1, z auditu 2026-09-28): Test
  i Uložit se po ověření spojení zeptají `/v5/user/query-api`. Klíč
  s právem **výběru** (`Withdraw` v oprávněních) i klíč, který **není
  read-only** (`readOnly` ≠ 1), se odmítne a do telefonu se neuloží.
  Dřív uložený takový klíč aplikaci nezablokuje (uživatel by se nedostal
  ke svým datům), ale v liště chyb trvale visí varování, dokud se klíč
  nevymění — úspěšné načtení pozic ho nesmaže. Když se oprávnění
  nepodaří ověřit (síť), klíč projde s upozorněním „zkontroluj si to".
  Test: `tools/test-opravneni-klice.py` (na starém kódu padá v 6 bodech).
  ⚠ Mock (`mock-bybit.js`) odpovídá na query-api klíčem jen pro čtení;
  bez toho by testy s ukládáním klíče padaly.

## Architektura

Statická PWA, **bez build kroku**. Žádné npm, žádný bundler. Soubory se servírují
tak, jak leží v repu. ES moduly, vanilla JS.

```
apk/                    # obal pro Android (Capacitor); staví se jen v GitHub Actions
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
js/alarmy.js            # cenové alarmy: model, vyhodnocení protnutí, ukládání
js/sestavy.js           # sestavy coinů v Trzích + kategorie z CoinGecko (bez DOM)
js/zaloha.js            # záloha a obnova dat do souboru (bez API klíčů)
js/ucet.js              # účet PerpyX: přihlášení kódem, cloudová záloha, denní aktivita
js/zamek.js             # volitelný zámek aplikace: PIN + otisk prstu
js/app.js               # orchestrace, lifecycle, update service workeru
vendor/                 # KLineChart + licence, stažené v repu (ne CDN)
tools/                  # testy přes DevTools Protocol, bez API klíčů (viz tools/README.md)
.github/workflows/deploy.yml
.github/workflows/apk.yml   # sestavení APK, vydání apk-latest
.github/workflows/web.yml   # nasazení webu perpyx.com na Cloudflare
web/                    # web aplikace (úvod + přihláška do bety), NE aplikace samotná
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

⚠ **Od v0.34.0 servíruje worker všechno z cache své verze, bez sítě**
(i `index.html`). Dřív šla navigace vždy nejdřív na server a ostatní
soubory se při každém startu stahovaly na pozadí znovu: na mobilu to
zdržovalo start (vteřina i víc před prvním vykreslením, ~25 požadavků
proti prvním dotazům na burzu) a navíc to tahalo soubory **novější verze
ze serveru do cache běžící verze** — právě ta míchanice, kvůli které je
`cache: 'reload'` při instalaci. Nová verze se teď do telefonu dostane
jen celou: nasazení změní `sw.js` (BUILD_ID) → nový worker si při
instalaci stáhne celou sadu → po „Aktualizovat" se přepne. Ze sítě jde
jen to, co v cache není (soubor mimo SHELL, úplně první spuštění).
⚠ Nový soubor aplikace proto **musí být v `SHELL`**, jinak se poprvé
stáhne ze sítě a pak zůstane v cache i přes další verze.

Stalo se ve verzi 0.1.2: `version.js` se stáhl čerstvý a UI hlásilo novou
verzi, ale `style.css` se vzal starý, takže oprava v CSS se do telefonu
nedostala, přestože na serveru byla.

### Pozvi přátele — doporučení / referraly (v0.28.0, 2026-10-02)

Rozhodnutí uživatele: odměna za doporučení bez přesného slibu („bonusový
čas Pro, až bude PerpyX placený, čím víc přátel, tím víc"). Pravidla
v podmínkách 7a (můžou se změnit, bez peněžní hodnoty, zneužití se nepočítá)
a v zásadách „Invites".

- **Přezdívka = kód odkazu** `perpyx.com/ref/<přezdívka>` (3–20 znaků,
  malá písmena, čísla, pomlčka; rezervovaná slova a hrubý filtr nadávek;
  unikátní — `accounts.ref_nick`). Jde změnit, dokud odkaz nikdo nepoužil.
- **Párování přes e-mail, ne přes obchod:** `/ref/<x>` přesměruje na
  `/?ref=x#beta`, web ukáže proužek „Pozval tě x" a pošle `ref`
  s přihláškou (`subscribers.ref`, jen poprvé). Když se pak člověk
  v aplikaci poprvé přihlásí **stejným e-mailem**, server ho spáruje
  (`verify.js` → `sparujPriZalozeni`). Funguje pro APK, uzavřený test
  i produkci v Play — obchod nemusí nic předávat.
- **Záchrana:** v okně Pozvi přátele jde prvních 7 dní po založení účtu
  ručně zadat přezdívku toho, kdo pozval (jednou, ne sám sebe).
- **Tři stupně:** přijal pozvánku (zapsal se na webu) → začal používat
  (přihlásil se v aplikaci, `referrals`) → uznáno (aplikaci použil
  **14 různých dní**, nemusí jít po sobě — `AKTIVNI_DNU` v
  `web/lib/ref.js`; kontroluje `ping.js`). Uživateli se přesné číslo
  neříká („několik různých dní").
- Zvoucí vidí počty a seznam se **zamaskovanými e-maily**: první dva
  znaky, zbytek hvězdičky, tečky zůstávají (`ro*******.***`).
- Aplikace: `js/pozvanky.js`, tlačítko **Pozvat vlevo dole jen na
  přehledu pozic** (stejně vysoké jako bublina hlášení vpravo), okno
  `#sheetInvite`. Sdílení přes plugin Share / Web Share / schránku.
- Smazání účtu maže vazby v obou směrech a přezdívku z přihlášek.
- Testy: `tools/test-pozvanky.py` (aplikace, API podstrčené),
  `tools/test-referraly-server.py` (naostro, `AUTH_TEST_KEY`; testovací
  účty smí v `ping` zapsat jiný den).
- Později: **Install Referrer z Google Play** jako třetí pojistka
  a bonus za pozvaného, který si koupí předplatné.

### Lišta nové verze a „Co je nového" (v0.27.0)

Tlumená lišta nahoře: vlevo „Verze X je připravená · Co je nového ▾"
(rozbalí seznam), vpravo tlačítko **Aktualizovat**. Obsah je
v **`novinky.json`** v kořeni repa: `verze`, `novinky[]`, `opravy[]`,
každá položka `{ en, cs }`. Drží se **jen poslední verze**, historie ne.

- ⚠ **Při každém zvednutí `APP_VERSION` přepiš `novinky.json`.** Novinky
  nahoře (to zajímavé, jednou větou), opravy jen obecně a stručně, ať
  nebudí pozornost.
- Lištu kreslí **stará** (běžící) verze, poznámky čte ze serveru
  (`novinky.json?t=…`, `cache: 'no-store'`; SW ho necachuje) — patří tak
  k čekající nové verzi. Nová podoba lišty se proto u uživatele poprvé
  ukáže až při aktualizaci **z** v0.27.0 na další.
- deploy.yml kopíruje `novinky.json` do Pages. Mock (`mock-bybit.js`)
  ho pouští na server. Test: `tools/test-nova-verze.py`.

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

⚠ **Po probuzení z pozadí 10002 i se správnými hodinami** (v0.31.5,
2026-10-05): offset změřený před hodinami už neplatí a probouzející se
síť požadavek pozdrží — v liště chyb na chvíli viselo „Clock mismatch".
`signedGet` teď offset starší než 10 min obnoví před podpisem a na 10002
změří čas znovu a dotaz **jednou potichu zopakuje**. Hláška zůstává jen
při trvalém 10002 (hodiny telefonu opravdu mimo). Neúspěšné měření času
se zkusí znovu nejdřív za minutu. Test: `tools/test-cas-po-spanku.py`,
na starém kódu padá.

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
| vstup (průměrný) | **jen štítek ceny na ose**, v grafu nic (`jenOsa`, v0.31.1 — čára i zub vadily) | fialová |
| likvidace | `12-5` dlouhá | červená |
| SL, celé i částečné | `14-6` dlouhá | oranžová |
| TP, celé i částečné | `20-7` delší | **červená** `#f6465d` (prodej) |
| limitky | `8-5` čárkovaná | nákup **zelená** `#2ebd85`, prodej červená |
| alarm | `6-3-2-3` | **světle šedá**; vypnutý tmavě šedá s **přeškrtnutým zvonkem** |

**Změna 2026-10-03 (v0.30.0, přání uživatele):** TP a limitky mají **pod
čarou vpravo množství a hodnotu** („500 JUP · 142.50 USDT"; se skrytými
částkami ••••), nad čarou zůstává popisek. Vstup vede **od levého okraje
k poslední svíčce, kde se nakoupilo** (`chartPosledniVstup` z plnění),
popisek vlevo, čára tlumená — dřív od první nákupní svíčky doprava.
Alarmy byly výrazně tyrkysové, teď světle šedé (alarm z kresby si dál
drží barvu kresby).
**Barva = směr příkazu (v0.30.1):** prodej červeně, nákup zeleně — TP
longu červeně, TP shortu zeleně, v grafu i v panelu nad ním; trojúhelníky
plnění nákup `#7dffb8`, prodej `#ff8a9a` (světlejší než svíčky), větší
(7×14 px) s obrysem 2 px — uživatel je přehlížel. SL zůstává oranžový
(schválil), ale pod čarou má množství a hodnotu jako TP.
**v0.30.2:** plnění za 7 dní — ta **otevřené pozice** velká a sytá (nákup
`#4dff88`, prodej `#ff6b4a`), **starší zavřené obchody malé a tlumené**
(`stary`); bez pozice jsou všechna malá. Šipka podle směru: nákup ▲, prodej ▼.
**v0.31.0 (2026-10-03):**
- **Popisky čar:** nad čarou typ příkazu **jako na burze** (`TYP_PRIKAZU`:
  Take Profit, Partial TP, Stop Loss, Partial SL, Trailing Stop, Limit Buy/
  Sell, Liquidation — anglicky i v češtině) a množství v coinu, **pod čarou
  hodnota v USDT**. Zrušené TP1/TP2 a podíly v % — zabíraly šířku a lezly
  do grafu.
- **Linka zisku:** nad čarou `PnL USDT | %`, pod čarou velikost pozice
  v coinech (avg z linky zmizel, průměr je zub u osy).
- **Značky plnění bez obrysu** a **celá historie na páru**: plnění se
  dotahují zpětně po 7denních oknech až k začátku načtených svíček
  (`dotahniPlneni`, cache `plneniPary` po dobu běhu, strop 60 oken).
- **Hlavička grafu:** mřížka 3 × 3 nahrazena jedním řádkem: „● Bybit ·
  Unified/Classic" (typ účtu z `client.typUctu`), velikost v coinu
  a USDT, margin, likvidace; ROE vedle PnL v horním řádku.

**v0.37.0 (2026-10-09): značky plnění zase přesně na ceně plnění**, na
všech timeframech — uživatel si spletl, jak to měl TabTrader (měl je na
ceně, jen s tlumenějšími svíčkami). Přikládání ke knotu (níž, v0.31.1)
je zrušené i s `umisteniZnacky` a testem `test-znacka-ziva-svicka.py`.
Jedna značka na příkaz (v0.31.2) zůstává.

~~**v0.31.1 (2026-10-04): značky plnění přiléhají ke svíčce**~~ (zrušeno) jako v TabTraderu
— nákup ▲ těsně pod spodní knot, prodej ▼ nad horní knot, ne na přesnou
cenu plnění (tam se ztrácely ve svíčce). Víc plnění téže strany na jedné
svíčce se řadí za sebe (`umisteniZnacky` v chart.js, svíčka podle času
plnění v aktuálním timeframu, výsledek v cache do změny dat či značek).
⚠ V cache je jen **index svíčky a pořadí**, svíčka se čte při každém
kreslení znovu (v0.32.1): živá svíčka mění minimum s každým tickem
a dřív zůstal trojúhelník u starého minima uvnitř svíčky. Test:
`tools/test-znacka-ziva-svicka.py`, na starém kódu padá.

**v0.31.2 (2026-10-04): jeden trojúhelník = jeden příkaz** (`sloucitPodlePrikazu`
v app.js, podle `orderId`; čas prvního plnění, cena vážená množstvím). Tržní
příkaz burza vyplní klidně ve dvaceti kusech a na denní svíčce pak stál
sloupec dvaceti trojúhelníků (snímek z telefonu). Platí i pro prohlídku
z Historie. **Všechny značky v živém grafu jsou malé** (3,5 × 7 px) —
běžící obchod se od starých liší jen sytou barvou, staré jsou tlumené.
Velké s popiskem zůstaly jen pro obchod prohlížený z Historie.
| aktuální cena (PNLLINE) | **plná**, přes celou šířku | zelená `#3ee6a4` / červená podle zisku |

Plné jsou jen dvě čáry, které ukazují **fakt** (kde jsem nakoupil, kde je
cena teď). Čárkované jsou úrovně, které teprve čekají (SL, TP, likvidace,
příkazy).

**Kresby uživatele** mají naopak výchozí barvu **bílou** (první v paletě),
aby nepřebíjely svíčky. Ostatní barvy zůstávají na výběr.

Popisky jsou u pravého okraje vedle cenové osy, **bez podkladu a rámečku**;
barevný blok za textem jen ujídal pohled na svíčky.

Popisky jsou schválně krátké: `SL`, `TP` pro celou pozici a `TP1 (29 %)`,
`SL1 (16 %)` pro částečné. Číslují se podle toho, v jakém pořadí je cena
zasáhne — nejblíž vstupu je první.

**Cenovky na cenové ose (v0.16.9).** SL, TP (celé i částečné) a likvidace
mají na ose štítek s cenou ve své barvě, stejně jako aktuální cena. Z popisku
„SL" u okraje grafu nebylo poznat, na jaké ceně úroveň leží. Kreslí je
`createYAxisFigures` overlaye `positionLine`; písmo je tmavé na světlém
podkladu (oranžový SL), jinak bílé (`svetlaBarva()`). **Limitky cenovku
nemají** (`bezCenovky`) — u přikupování jich bývá víc a osa by se zaplnila.
Čára mimo viditelnou část grafu štítek nemá, není kam ho dát.
Test: `tools/test-graf-osa-a-zpet.py`, na starém kódu padá.

#### Vstup: čára průměru a trojúhelníky plnění

**Čára průměrného vstupu** (v0.17.0) je tenká **plná fialová**, stejná barva
jako v proužku karty, s popiskem `Entry` a cenovkou na ose. **Nezačíná
u levého okraje, ale u svíčky, kde se poprvé nakoupilo** — před otevřením
pozice žádný vstup nebyl. Čas otevření dopočítá `client.otevreniPozice()`
z plnění (viz checkpoint 7); dokud nedorazí, vede čára od levého okraje
(`nactiOtevreni()` v app.js ji pak překreslí). Bod overlaye má kvůli tomu
i čas (`odCasu`), ostatní čáry pozice jen cenu.

(Ve v0.16.1 čára zmizela a nahradily ji jen trojúhelníky. Uživatel ji chtěl
zpátky: trojúhelníky ukážou, kde se nakupovalo, ale ne průměr, se kterým se
počítá zisk.)

Vedle ní zůstávají **malé trojúhelníky v místech, kde se doopravdy
obchodovalo** — nahoru u nákupů, dolů u prodejů. Jedna čára průměru neřekne,
že se přikupovalo třikrát; trojúhelníky ano. Data jdou z `/v5/execution/list`
za posledních sedm dní (od otevření pozice, pokud je mladší).

Značky pro otevřenou pozici jsou **malé a bez popisku** (`maly: true`);
velká varianta s cenou zůstává pro prohlížení uzavřeného obchodu z historie.

⚠ **Značka nesmí mít barvu svíčky.** Leží skoro vždycky na svíčce, ve které
se obchodovalo, takže `#16c784` na zelené a `#ea3943` na červené prostě
zmizí. Nákup je proto **světlá zelená `#7dffb8`**, prodej jde **do oranžova
`#ff9f43`** (`BARVA_PLNENI` v app.js). K tomu obrys barvou pozadí — bez něj
byly na zkušebním snímku ze tří značek vidět dvě.

#### Aktuální cena se ziskem — indikátor `PNLLINE`

Vestavěná linka poslední ceny je **vypnutá** (`candle.priceMark.last.line`)
a nahrazuje ji vlastní: barevná podle toho, jestli je pozice nad průměrným
vstupem, s textem `+26.50 USDT | +2.50 %` u pravého okraje.

⚠ **Plná, ne čárkovaná, a zelená jiná než svíčky** (`BARVA_ZISKU = #3ee6a4`,
svíčky mají `#16c784`). Linka vychází z poslední svíčky, která bývá zelená,
a ve stejné barvě s ní splývala. Test měří plnost linky v pixelech (plná
≥ 85 %, čárkování 4-4 dávalo 51 %).

Linka vede **přes celou šířku grafu** (od v0.17.1). Předtím začínala
u poslední svíčky — to bylo zase málo: úroveň aktuální ceny šla přes graf
sledovat špatně a uživatel ji chtěl celou. (Úplně první verze ji měla přes
celou šířku čárkovanou a vadila; plná a v jiné zelené než svíčky už ne.)

⚠ Je to **indikátor, ne overlay.** Overlay by musel dostávat novou cenu při
každém ticku zvlášť; `draw()` indikátoru běží při každém překreslení sám
a poslední cenu si vezme z dat, takže linka drží krok s živou svíčkou bez
jediného volání navíc.

⚠ **`PNLLINE` se nesmí zapsat mezi indikátory uživatele.** `aktivniIndikatory`
se ukládá do telefonu jako jeho výběr; kdyby v něm linka byla, obnovila by se
i na páru bez pozice, kde nemá co počítat. Drží se ve vlastním příznaku.

⚠ Text je **bez podkladu, ale obtažený barvou pozadí** (trojí `fillText` se
`shadowBlur`). Bez toho z „−3,44" na snímku zbylo „−,44" — číslici spolkla
svíčka pod ní.

Zisk se počítá z **poslední ceny v grafu**, ne z mark ceny v kartě. Musí
sedět s tím, kde linka leží; mark a poslední cena se liší o zlomky procenta.

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

**Kresby se pamatují podle páru, natrvalo, dokud je uživatel nesmaže**
(`perpdesk.drawings.<SYMBOL>` v `localStorage`). Jsou stejné, ať se graf
otevře z Pozic, z Trhů nebo z Historie, a přežijí zavření i otevření nové
pozice na stejném páru. Ověřeno testy 2026-09-25 a 09-27: podstrčené kresby,
kresby nakreslené prstem, zdržená síť, střídání Pozice / Trhy / dva páry.
⚠ **Prohlížeč a APK mají každý své úložiště** — kresby nakreslené v Brave
v APK nejsou a naopak; a odinstalování ladicího APK úložiště smaže.

⚠ **Uživatel dvakrát hlásil „z Trhů kresby nejsou vidět"** a úložiště přitom
fungovalo. Skutečná příčina (v0.17.4): **prohlídka obchodu z Historie
přepnula timeframe** podle délky obchodu (1m, 5m…) a ten zůstal i pro další
grafy. Na minutovém grafu je načtených jen posledních 300 svíček, tedy pár
hodin, a kresby nakreslené o dny dřív na 4h se ocitly mimo obraz. Historie
si teď interval jen půjčí (`intervalUzivatele` v app.js); běžný graf
z Pozic, Trhů i ze seznamu příkazů se otevře na timeframu, který si zvolil
uživatel. Test: `tools/test-historie-obchod.py`, na starém kódu padá.

⚠ Obecně: **kresba v minulosti za začátkem načtených svíček není vidět**
(na krátkém timeframu se načítá jen 300 svíček a dohrávání historie při
posunu zatím neumíme). Vodorovná čára je vidět vždy, šikmé ne.

⚠ **`restoreDrawings` musí umlčet hlášení změn.** Obnova nejdřív maže staré
overlaye a každé smazání hlásí změnu. Bez umlčení se při otevření grafu uloží
prázdný seznam přes uložené kresby dřív, než se stihnou obnovit — tedy tiché
smazání práce uživatele. Řeší to příznak `tichaZmena`.

#### Cenovky kreseb, procenta u kříže a měření (v0.17.1)

**Vodorovná čára a cenová čára mají trvale cenu na ose** ve své barvě, jako
čáry pozice. Vestavěné tvary knihovny ji ukazují jen u kresby vybrané
knihovnou, a to se na telefonu nestává (vybírá se našimi úchyty). Proto jsou
v `registrovatVodorovneKresby()` **přeregistrované pod stejnými názvy**
(`horizontalStraightLine`, `priceLine`) — uložené kresby se načtou beze změny.
Cenovka u začátku cenové čáry vypadla, cena je na ose.

**U ceny kříže při kreslení je vzdálenost od vstupu** v procentech
(`+1.97 % vs entry`), v samostatném štítku vlevo od cenovky (`formatPct`
v `draw.js`). Jen když je otevřená pozice.

**Nástroj Měření** (poslední v liště, ikona svislé šipky mezi dvěma
vodorovnými čarami — první ikona pravítka byla nesrozumitelná): dva body, obdélník
s šipkami a štítek s rozdílem ceny i v procentech, počtem svíček a časem —
modře nahoru, červeně dolů, jako v TradingView. Čísla se ukazují **už během
tažení druhého bodu** (`onPreview` v `draw.js`), kvůli tomu se měří.
⚠ Měření **není kresba**: je ve vlastní skupině `mereni`, neukládá se,
nové ho nahradí a zmizí s dalším otevřením grafu.

**Klepnutím na měření se vybere** jako kresba (v0.17.3): úchyty na obou
bodech (velikost jde upravit) a paleta **jen s košem** (`jen-smazat`) —
barvy, tloušťka ani alarm u měření smysl nemají. Klepnutí platí v celém
obdélníku s okrajem na prst a ve štítku nad ním / pod ním (`naMereni()`).
Dřív na měření nešlo klepnout a nešlo ho smazat jinak než košem všech kreseb. Počet svíček
se počítá z šířky v pixelech a šířky svíčky (body nesou jen čas a cenu).

Test: `tools/test-mereni-a-cenovky.py` (skutečné dotyky), na starém kódu
padá všech sedm kontrol.

#### Vzhled kreseb a alarmy

Po vybrání kresby se dole objeví paleta: šest barev, tři tloušťky, tři
průhlednosti, zvonek (alarm) a koš. Styl se drží v `extendData` overlaye,
takže se ukládá i načítá spolu s body. Nová kresba převezme naposledy
nastavený vzhled — **i po restartu aplikace** (`perpdesk.drawStyle`,
v0.17.2; dřív se po restartu vracela bílá).

⚠ **Náhled rozkreslené čáry má vzhled hotové kresby** (`stylNahledu`
v `draw.js`). Dřív byl vždycky modrý a na naposledy použitou barvu kresba
přeskočila až po potvrzení posledního bodu — vypadalo to, jako by se barva
měnila sama. Měření si nechává vlastní modrou a červenou.

#### Cenové alarmy

Samostatná entita v **`js/alarmy.js`** (podmínka, opakování, platnost, zpráva,
zvuk, vibrace, notifikace), ne vlastnost kresby: alarm musí přežít smazání
kreseb i zavření grafu. Tři typy podle toho, co hlídají:

| typ | co hlídá | tvar v grafu |
|---|---|---|
| `cena` | pevnou hladinu | vodorovná čára (`alarmLine`) |
| `cara` | úroveň, která se mění s časem — přímka dvěma body, **platná jen po délku čáry** | šikmá čára **v původní délce a barvě kresby** (`alarmTrend`) |
| `cas` | okamžik v budoucnosti, cena do toho nemluví | svislá čára (`alarmTime`) |

**Tři cesty, jak alarm vzniká** (kreslicí nástroj „cenový alarm" zmizel):

0. **Rychlý alarm podržením prstu** (v0.33.0, podle TabTraderu): prst
   podržet v ploše svíček (≥ 450 ms bez posunu), knihovna ukáže kříž,
   ten jde posouvat. **Během podržení** stojí u ceny kříže (vlevo od
   cenové osy) štítek se vzdáleností od aktuální ceny v % (`.krizek-procenta`,
   nahoru zeleně +, dolů červeně −; v0.35.0). Po puštění se **v místě
   prstu** (nad ním, když nahoře není místo, pod ním) objeví nabídka
   `#quickMenu`: cena s procenty a dvě volby — **Set alarm** a
   **Horizontal line** (vodorovná kresba na té ceně, `addHorizontalLine`
   v chart.js, uloží se mezi kresby páru). Obě mají cenovku na ose,
   dokud je nesmažeš (`alarmLine` má od v0.35.0 `createYAxisFigures`).
   Původní popis: Klepnutí alarm **rovnou uloží a zapne** s výchozími
   volbami (oba směry, jednou, bez vypršení) — bez okna s nastavením;
   doladit jde klepnutím na čáru. Tlačítko zmizí po 6 s, dalším dotykem
   v grafu, změnou timeframu a zavřením grafu. Krátké klepnutí, posun
   grafu, dva prsty, stisk na cenové ose, vybraná kresba nebo otevřená
   nabídka ho neukážou. Rozpoznání je v chart.js (`onLongPress`), alarm
   v app.js (`ukazRychlyAlarm`). Test: `tools/test-rychly-alarm.py`
   (skutečné dotyky).


1. **Zvonek v ukotvené části kreslicí lišty** → přes graf se položí zaměřovací
   kříž, klepnutí určí hladinu a teprve pak se otevře nastavení. Ťukat cenu na
   klávesnici je na telefonu nejpomalejší cesta; číselník v nastavení zůstal
   jen na doladění a je u něj **zaměřovač**, který kříž vyvolá znovu.
2. **Zvonek v paletě vybrané kresby** → z kresby se stane alarm se stejnou
   geometrií a rovnou se otevře jeho nastavení. Kresba tím **zaniká** — jinak
   by na stejném místě ležely dvě čáry a nebylo by poznat, která zvoní.

##### Obrazovka alarmu

Vejít se musí na **zavřený displej Foldu**, jinak zůstane tlačítko Uložit pod
okrajem a uživatel netuší, že tam ještě něco je (stalo se, v0.12.0). Proto:

- řádky v `#sheetAlarm` jsou nižší než v nastavení indikátorů,
- **kompaktní okno (v0.25.0, přání uživatele — zabíralo moc místa):**
  zaměřovač a číselník ceny v jednom řádku, krátké volby (`↕ Both / ↑ Up /
  ↓ Down`, `Once`, `1 d / 7 d / 30 d`), na rozevřeném Foldu volby ve
  **dvou sloupcích** (okno ~310 px místo ~2/3 výšky), nižší Uložit,
- **přepínač Active je v hlavičce** vedle nadpisu (`#alarmActiveBox`) —
  u použitého, zešedlého alarmu je to první, co se hledá,
- **volby zvuk / vibrace / notifikace zmizely** (v0.25.0): alarm vždy
  doručuje server pushem. Zvonek byl webová notifikace (Notifications
  API), kterou WebView v APK neumí — šel vypnout, ale už ne zapnout
  („Notifications are blocked"). Viz Odezva níž,
- `.sheet-akce` je `position: sticky` u spodního okraje, takže Uložit je vidět
  vždycky. Měří to `tools/test-alarmy.py` na emulovaných 430×820.

Zaměřovač je **hlavní cesta k hladině**, proto je to tlačítko přes celou šířku
pod číselníkem, ne ikonka vedle něj. Pod ním stojí **vzdálenost hladiny od
vstupu do pozice a od aktuální ceny v procentech** — v tom uživatel o hladinách
přemýšlí, ne v absolutní ceně. Procenta se přepočítávají při každé změně ceny.

Další vlastnosti:

- Ukládá se **jeden společný seznam** (`perpdesk.alarms`) se symbolem u každého
  alarmu, ne rozdělený po párech — hlídat se musí i pár, který zrovna není
  otevřený, a přehled všech alarmů pak půjde načíst z jednoho místa.
- Barva je tyrkysová `#22d3ee` (jinou takovou v grafu nic nemá), čárkování
  `6-3-2-3` a u popisku je **ikona budíku**. Klepnutí na čáru ji otevře
  k úpravě; u šikmé se měří svisle od prodloužené přímky, aby šlo klepnout
  i tam, kam kresba nesahá.
- ⚠ **Alarm z kresby si nechává barvu i délku té kresby** a mění jen čárkování.
  První verze ho protahovala k pravému okraji, „aby bylo vidět, kudy čára
  povede" — z úhledné trendové čáry se tím stala nekonečná čára přes celý
  graf a uživatel to odmítl.
- ⚠ **Šikmý alarm platí jen po délku čáry.** Za jejím koncem `uroven()` vrací
  NaN a alarm se při první kontrole **sám vypne** (zešedne). Rozhodl tak
  uživatel a je to správně: extrapolovaná přímka by jednou zahoukala kdesi
  mimo nakreslenou čáru a nikdo by nechápal proč. Do kdy alarm platí, stojí
  v poznámce pod formulářem; po doběhnutí je tam místo toho výzva čáru
  posunout. Test: `tools/test-alarm-z-kresby.py`.
- Jednorázový alarm po zaznění **zešedne, ale nesmaže se** — čára zůstane vidět
  a jde ji zase zapnout. Mazání je vždy na uživateli.
- Modul drží seznam v paměti a čte `localStorage` jen jednou za běh. Jediný
  zapisovatel je aplikace sama, takže to stačí; ⚠ testy, které zapisují alarmy
  do úložiště zvenčí, musí stránku přenačíst, jinak jsou jejich data neviditelná.
- Časové alarmy tikají vlastním odpočtem po 10 s, protože nezávisí na cenách
  ani na otevřeném grafu. Čas v minulosti se uložit nedá a formulář to řekne
  hned při otevření, ne až u tlačítka Uložit — svislá čára se skoro vždy kreslí
  do historie.

⚠ **Protnutí se pozná jen ze dvou cen po sobě**, takže první cena po otevření
alarm nikdy nespustí — jen založí referenci. Bez toho by se při startu spustily
všechny alarmy pod aktuální cenou.

⚠ **Mark cena a uzavírací cena svíčky se nesmějí míchat.** Pár s otevřenou
pozicí se hlídá z ticker streamu i se zavřeným grafem, otevřený pár z živé
svíčky. Kdyby do jedné hladiny padaly obě, jejich rozdíl by kolem ní vyrobil
protnutí, které se nestalo. Proto `onPositions` otevřený pár přeskakuje
a `closeChart` zahodí referenční cenu.

Alarm na páru **bez pozice a bez otevřeného grafu se nehlídá** — aplikace pro
takový pár nemá odkud brát cenu. Píše se to i v nápovědě pod formulářem.

##### Odezva: zvuk, vibrace, notifikace

**Od v0.25.0** (`ozviSe()`): v otevřené aplikaci pruh + vibrace; pípnutí
z aplikace jen jako **záloha, když server alarmy nehlídá**, a u zásahu
SL/TP (ten server nehlídá). Jinak zvoní push ze serveru. Starší popis
níž platí pro tu záložní cestu.

⚠ **Klepnutí vedle nabídky se chvíli po otevření ignoruje** (400 ms,
`otevrenaNabidkaV`). Klepnutí, které okno alarmu otevřelo (potvrzení
hladiny křížem), dojde jako `click` až po otevření — a u nízkého okna
trefilo ztmavené pozadí a okno hned zavřelo. Chytil to `test-alarmy.py`.

Zvuk počítá WebAudio, v repozitáři žádný soubor není.

⚠ **Sinus 880 Hz byl v telefonu skoro neslyšet.** Alarm musí být pronikavý, ne
hezký: teď je to **obdélníková vlna** (plná vyšších harmonických, na které je
sluch i reproduktor telefonu citlivější) a tón **skáče mezi 988 a 1319 Hz**
šestkrát po sobě — kolísání si ucho všimne spíš než stálého pípnutí.

⚠ **Zvukový kontext se probouzí při prvním dotyku na stránku**, ne až když má
alarm zaznít. Prohlížeč zvuk bez interakce nepustí a ve chvíli zaznění už
uživatel telefon v ruce mít nemusí.

⚠ **Systémová notifikace musí jít přes service worker**
(`registration.showNotification`). Mobilní Chrome konstruktor `new Notification()`
nepodporuje a vyhodí výjimku. Povolení se vyžádá až při zapnutí přepínače
u konkrétního alarmu, ne při startu aplikace.

⚠ Notifikace dorazí, jen dokud stránka žije (i na pozadí). Upozornění při
**zavřené** aplikaci potřebuje APK z checkpointu 10; v prohlížeči to
spolehlivě nejde.

#### Srovnání pohledu a celá obrazovka

⚠ **Instance grafu se mezi otevřeními recykluje** kvůli rychlosti, takže si
nese posun i přiblížení z minula. Uživatel pak po otevření grafu hledal, kde
vůbec jsou aktuální svíčky — poslední svíčka byla klidně trojnásobek šířky
plátna mimo obraz. Proto `srovnejPohled()` (výchozí šířka svící + skok na
konec dat) běží **po dodání dat i po změně intervalu**.

Měřením ověřeno: po srovnání je vidět ~48 svíček, poslední je v pravé části
plátna a svíčky vyplňují okolo 88 % výšky.

⚠ **Do příchodu svíček nového páru je plátno schované** (v0.17.3). Kvůli
recyklaci instance ukazoval graf po klepnutí na jiný pár **svíčky
předchozího páru**, dokud nedorazila data ze sítě — na telefonu klidně půl
vteřiny, a pak to přebliklo. `setSymbol()` při změně páru přidá třídu
`ceka-na-data` (`visibility: hidden`, ne `display: none` — knihovna
potřebuje skutečné rozměry) a loader ji po doručení dat a srovnání pohledu
sundá. ⚠ Odkrývá **jen loader**, ne každé srovnání pohledu: srovnání běží
i při otevření grafu se stejným obdobím, ještě nad starými svíčkami, a první
verze opravy se proto odkryla předčasně (test to zachytil). Pojistka odkryje
graf po 4 s i bez dat. Test: `tools/test-mereni-mazani-a-prepnuti-paru.py`
(mock zdrží svíčky druhého páru o vteřinu).

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

### ✅ 5) Layout pro Fold

- **Zavřený displej** (úzký, cover screen): seznam pozic.
- **Rozevřený**: graf zůstává **přes celou obrazovku**, ne vedle seznamu.

Rozhodnuto uživatelem po vyzkoušení checkpointu 2. Původní zadání znělo
„rozevřený: graf + seznam vedle sebe", ale v praxi se osvědčil celoobrazovkový
graf v obou polohách. Rozdělené zobrazení se zatím **nedělá**.

Zbývalo tedy: chování při přeložení telefonu. Stav (otevřený graf, vybraný pár,
interval, zoom, scroll seznamu) musí přeložení přežít — Android při změně
skládání stránku nereloaduje, ale rozměry se mění a layout se musí přepnout
plynule. Přepínat podle `matchMedia` na šířku a poměr stran, ne podle detekce
zařízení.

**Ověřeno 2026-09-22 přes CDP na rozměrech Z Fold 5** (zavřený cover
~344×882, rozevřený hlavní displej ~673×841): stav grafu (pár, interval,
zoom/`barSpace`) **už přežíval sám** — appka se při přeložení nereloaduje,
proměnné zůstávají v paměti a KLineChart má vlastní `ResizeObserver`
(`chart.js`), který canvas i kreslicí vrstvu (`umistiVrstvu()`) přepočítá
při každé změně rozměrů kontejneru. Šířku svíčky (`setBarSpace`) resize
sám od sebe nemění — jen se při širším plátně přirozeně zobrazí víc
svíček za stejnou cenu, což je správně.

⚠ **Jediné, co reálně chybělo:** karta pozice (`.pos-grid`) měla napevno
3 sloupce, takže na širokém rozevřeném displeji zbyl nevyvážený poslední
řádek — dvě osamocené hodnoty s obří mezerou. Řešil to `@media (min-width:
480px) and (min-aspect-ratio: 3/4)` s pěti sloupci; podmínka jde na šířku
**i** poměr stran, ať telefon na šířku nespadne do stejného pravidla jen
proto, že je taky široký.

Od v0.16.3 karta **žádnou mřížku nemá** — všechno se čte z proužku,
z hlavičky a z patičky — takže široký displej nepotřebuje nic zvláštního
a pravidlo zmizelo. Test místo sloupců měří, že z karty nic nevytéká ven,
a to na obou rozměrech.

Test: `tools/test-preloseni-foldu.py` — simuluje přeložení změnou rozměrů
okna bez reloadu (`Emulation.setDeviceMetricsOverride`), ověří že pár,
interval a zoom zůstanou stejné, a že karta pozice dostane 5 sloupců na
rozevřeném displeji.

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

⚠ **Příznak „po přejetí potlač klepnutí" se maže každým novým dotykem**
(v0.17.2). Má zachytit jen klepnutí z **téhož** gesta, které záložku
přepnulo. Android ale po přejetí klepnutí většinou vůbec nepošle, takže
příznak zůstal viset a **snědl první skutečné klepnutí** — karta pozice
problikla, graf se neotevřel, prošlo až druhé klepnutí. Uživatel to znal
jako „někdy to reaguje, někdy ne" a hledal v tom citlivost. Reprodukováno
testem `tools/test-klepnuti-na-kartu.py` (po přejetí 0 z 5 otevření, po
opravě 5 z 5). Tentýž test ukázal, že **překreslování karet při každém
ticku ceny** (13× za vteřinu) klepnutí **nevadí** — prohlížeč klepnutí
vyhodnotí až při zvednutí prstu na prvku, který tam je.

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

Shora dolů: **hlavička** (zpět, **logo**, pár, PnL) → **údaje o pozici**
→ **graf** → **kreslicí lišta** → **timeframy**. Lišta s nástroji je pod
grafem od v0.31.4 (přání uživatele 2026-10-05) — nástroje i timeframy jsou
dole na palec. Velké tlačítko zpět dole má stejnou šipku „←" jako nahoře
(dřív lomené „<"). Značky starších obchodů mají průhlednost 0,35 (dřív 0,55).

**Logo v hlavičce grafu (v0.31.2, přání uživatele: logo na každé
obrazovce):** značka tkaného X s vlastním přechodem (`brandGradChart`),
nápis „PerpyX" jen od šířky 560 px. Na zavřeném displeji (≤ 420 px) jdou
PnL a procenta pod sebe a pár se ořízne, nelomí — jinak se odznak
„LONG 10×" rozpadl na dva řádky.

Údaje o pozici jsou nahoře schválně: pod nimi zůstane graf souvislý až
k timeframům. V celé obrazovce ustoupí, nástroje zůstávají.

**Kreslicí nástroje jsou v nabídce** (v0.32.0, přání uživatele 2026-10-05,
vzor TradingView): v liště je jen kurzor a tlačítko `#toolsBtn`, které
otevře `#sheetTools` — mřížku 11 nástrojů s velkými ikonami a názvy.
Výběr nabídku zavře a tlačítko pak nese ikonu zvoleného nástroje (svítí).
Dřív se 13 nástrojů posouvalo v liště a na zavřeném displeji byly vidět
dva. Vpravo zůstává alarm, magnet, vrstvy, indikátory, koš a celá
obrazovka; tlačítka 38 px. Lišta se vejde i na 344 px bez posouvání.

**Timeframy** (v0.37.0): 1m, 5m, 15m, **30m**, 1h, 4h, 1D, 1W, 1M v pevném
pořadí. Lišta vyplní místo vlevo od tlačítka zpět (to má pevnou šířku
`clamp(104px, 26vw, 200px)`), volně se posouvá a vybraný timeframe se
plynule vystředí (`vycentrujInterval`), i krajní 1m a 1M díky mezerám na
koncích (`::before/::after`). Kolotoč z v0.32.0 (přeskládávání dokola)
je zrušený — lišta se nedala rozumně posouvat.

**Horní část grafu je čistá** (v0.32.0): legenda svíčky (Time, Open,
High…) je vypnutá (`candle.tooltip.showRule: 'none'`) a indikátory
v hlavním panelu nemají legendu (`createTooltipDataSource` prázdný
při vložení). Panely pod grafem (RSI, MACD) legendu s hodnotou mají.
Řádek nad grafem: burza, velikost, margin a **objem za 24 h v USDT**
(stejné číslo jako v Trzích, nemění se s timeframem; z Pozic se
dotáhne `getTicker`). Likvidace z řádku zmizela — má čáru v grafu.
Bez pozice zůstane řádek s burzou a objemem.
Test: `tools/test-nastroje-a-timeframy.py`.

Výchozí interval je **4h**.

**Velké tlačítko zpět vpravo dole** (v0.16.9), na konci lišty timeframů,
mimo jejich posuvnou oblast. Uživatel drží telefon v pravé ruce a šipka
nahoře vlevo je z dosahu palce. Je větší než timeframy (56×46 px)
a modře orámované, aby se nepletlo s přepínáním intervalu. ⚠ Nesmí mít
třídu `interval-btn` — ta tlačítka se berou jako přepnutí timeframu (stalo
se s tlačítkem středu, viz níž).

**Šířka (v0.24.1):** tlačítko vyplní místo mezi posledním timeframem
a pravým okrajem (`flex: 1 0 104px`, nejvýš 260 px) — na rozevřeném Foldu
~200 px, na zavřeném displeji 104 px (dřív 56, v rohu se špatně trefovalo).
⚠ **Od pravého kraje drží odstup ~18 px** (`margin-right`): u samé hrany
ho dlaň mačkala omylem. Lišta timeframů se dál posouvá do strany.
Test: `tools/test-start-a-zpet.py`.

⚠ **Pomocná tlačítka lišty (magnet, indikátory, koš, celá obrazovka)
jsou v napevno ukotvené části vpravo**, mimo posuvnou oblast s nástroji.
Dřív byla v posuvné části a na úzkém displeji skončila mimo obrazovku —
uživatel na ikonu indikátorů vůbec nedosáhl.

**Vrstvy (v0.26.0, rozhodnutí uživatele 2026-10-01)** — ikona vrstev
v ukotvené části lišty (před indikátory) otevře nabídku se čtyřmi
přepínači: **Kresby**, **Alarmy** (skryté dál hlídají), **Indikátory**
(všechny najednou, včetně panelů RSI/MACD) a **Obchod** (vstup, SL/TP,
limitky, likvidace, trojúhelníky plnění, linka zisku). Cenovky na ose,
legenda ani mřížka vrstvy nejsou — uživatel je řešit nechce. Nahoře
Skrýt vše / Zobrazit vše.

- Skryté se **nemaže**: overlaye dostanou `visible: false`
  (`chart.setLayers()`), i nově vznikající (po změně intervalu).
  ⚠ Indikátory se naopak z grafu **vyndají** (`removeIndicator`) — jen
  zneviditelněné by nechaly prázdný panel; výběr (`aktivniIndikatory`,
  `perpdesk.indicators`) zůstává a s odkrytím se vloží zpátky.
- Ikona **svítí**, když je něco skryté — jinak to vypadá, že kresby
  zmizely. Stav je společný pro všechny páry (`perpdesk.layers`).
- Skrytá kresba ani alarm nejdou vybrat klepnutím. Co uživatel začne
  používat, samo se ukáže: nástroj kreslení → Kresby, zvonek → Alarmy,
  výběr indikátoru → Indikátory.
- Test: `tools/test-vrstvy.py`.

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

⚠ **Do hlavního panelu se indikátor přidává s `createIndicator(…, true)`**
(`pridejDoHlavnihoPanelu()` v chart.js, v0.17.5). Bez druhého argumentu ho
knihovna nevrství, ale **vymění** — `addIndicator` nejdřív smaže všechno,
co v panelu je. Linka zisku (PNLLINE) je taky indikátor v hlavním panelu,
takže po otevření grafu pozice potichu smazala objem, EMA, Bollingera…:
v nabídce svítily jako zapnuté a v grafu nebyly. Vypnutí a zapnutí je
vrátilo, jenže tím zase zmizela linka zisku. Test:
`tools/test-indikatory-vrstveni.py`, na starém kódu padá v osmi bodech.

**Výška panelu tažením** (v0.34.0, přání uživatele): na hranici mezi
grafem a panelem indikátoru (RSI, MACD…) je úchyt `.pane-uchyt` s madlem;
tažení nahoru panel zvětší, dolů zmenší (40 px až 55 % plochy — svíčkám
zbyde 45 %). Výška se uloží do nastavení indikátoru jako procento
(`vyskaPanelu`), takže platí i po přeložení Foldu a restartu; v nastavení
pak nemusí svítit žádná z pevných voleb. ⚠ Úchyt má z-index 21 — knihovna
má na hranici vlastní 7px oddělovač se z-index 20, který by dotyk sebral.
Úchyty se rozmisťují v `umistiVrstvu()` (běží po každé změně rozměrů,
dat i indikátorů). Test: `tools/test-vyska-panelu-tazenim.py` (skutečné
dotyky).

**RSI nemá prázdné okraje nad 100 a pod 0.** Výchozí `gap` osy Y knihovny
nechává nahoře 20 % a dole 10 % výšky panelu prázdných; u nízkého panelu
to byla skoro třetina místa. `osaRsiBezOkraju()` ho přes `overrideYAxis`
stáhne na ~7 px, aby se popisky 100 a 0 vešly celé. Jen s pevnou
stupnicí — bez ní RSI kolísá a okraj se hodí.

⚠ **Okraj osy se zadává jako podíl výšky (< 1), nikdy v pixelech.** Pixely
(hodnoty ≥ 1) knihovna přepočítává **dělením výškou panelu**. Při zavření
grafu se obrazovka schová a výška je 0 → dělení nulou → nekonečno →
rozpadne se celé rozvržení a **panel se svíčkami zůstane natrvalo s nulovou
výškou**. Uživatel pak při druhém otevření grafu viděl jen RSI a prázdnou
plochu (v0.17.5, opraveno v0.17.7). Podíl se počítá z aktuální výšky panelu
a přepočítává s každou její změnou (`pouzijVyskuPanelu`). Test:
`tools/test-znovuotevreni-grafu.py` — otevře graf pětkrát po sobě; ostatní
testy otevíraly graf jen jednou, proto to nechytily. ResizeObserver navíc
schovaný graf (nulová plocha) vůbec nepřepočítává.
Legenda vlevo nahoře pak zajede do plochy RSI, uživateli to tak vyhovuje.
Výška panelu nabízí i **10 a 15 %**.

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

**Pozice otevřená při otevřeném grafu** (v0.35.0, jako v TabTraderu):
`syncOpenChart` při každé dávce pozic zkontroluje, jestli se na páru
otevřeného grafu (dosud bez pozice) neobjevila pozice — pak ji převezme
(hlavička, řádek nad grafem, čáry, příkazy, značky plnění, linka zisku).
Stojí to nic navíc: pozice chodí privátním streamem tak jako tak, práce
se dělá jen jednou při přechodu. Zavření pozice graf vrátí do režimu bez
pozice a limitky na páru znovu načte. Test: `tools/test-nova-pozice-v-grafu.py`
(na starém kódu padá).

Klepnutí na pár otevře graf. Proto graf nově funguje **i bez otevřené pozice**:
`chartSymbol` je zdroj pravdy o tom, co se kreslí, `chartPosition` může být
`null`. Pak se nekreslí čáry pozice, panel pod grafem ustoupí a v hlavičce je
místo PnL změna za 24 h. Příkazy se dotahují jen s uloženými klíči.

#### ✅ Sestavy a kategorie (v0.18.0, 2026-09-28)

Tři vrstvy: **všechny páry** → **kategorie** (AI, L1, Meme…) jako filtr →
**vlastní sestavy**. Nahoře v Trzích lišta sestav (`All`, `Favourites`,
vlastní, `+`), pod ní čipy kategorií s počty párů. Hvězdička u páru
otevře nabídku: do kterých sestav patří (zaškrtávání, nová sestava)
a jeho kategorie (ruční oprava, „Reset" vrátí CoinGecko). Klepnutí na
aktivní sestavu → přejmenovat / smazat.

- **Přejíždění je vnořené** (rozhodnutí uživatele): v Trzích přejetí
  přepíná sestavy, za poslední / před první pokračuje na sousední
  záložku. Tah začatý na liště sestav, čipech nebo v nabídce si nechávají
  ony (posouvají se do strany).
- **Dosavadní oblíbené** (hvězdičky) se při prvním spuštění staly
  sestavou „Favourites". Filtr „jen oblíbené" a dělič v seznamu zmizely —
  totéž teď dělá sestava. „All" oblíbené nahoru neřadí.
- ⚠ **Datový model je připravený na další burzy:** sestava drží
  `burza:pár` (`bybit:JUPUSDT`), kategorie se vážou na **zkratku coinu**
  (`JUP`). Převod páru na zkratku (`1000PEPEUSDT` → PEPE, `SHIB1000` →
  SHIB, přejmenované `RAYDIUM` → RAY) je `zkratkaCoinu()` v sestavy.js.
- **Kategorie jsou předpočítané** (rozhodnutí uživatele): web.yml je
  jednou denně stáhne z CoinGecko (`web/tools/kategorie.py`, 26 vybraných
  kategorií, u stejné zkratky vyhrává největší kapitalizace) do
  https://perpyx.com/data/kategorie.json (CORS povolený). Telefon se
  CoinGecka nikdy neptá. Tlačítko **Identify coins** (poprvé povinné)
  a ikona obnovení na konci čipů stáhnou jen ten soubor; uloží se do
  telefonu a znovu se sám nestahuje.
- ⚠ Bez klíče pouští CoinGecko jen pár dotazů za minutu: generátor jde
  po 13 s a na 429 čeká minutu; běh trvá desítky minut. Nepovinné
  tajemství `COINGECKO_API_KEY` (Demo) ho zrychlí. Když CoinGecko nevyjde,
  nasadí se včerejší soubor z webu.
- Kategorie pokryjí ~460 ze ~730 párů. Zbytek jsou hlavně **akcie,
  komodity a indexy**, které Bybit nabízí jako perpetuály (XAU, CL,
  SAMSUNG, TQQQ…) — ty CoinGecko nezná. Proto čip **No category**.
- **Vzhled složek (v0.18.1, rozhodnutí uživatele):** v Trzích se hlavní
  lišta záložek napojí na řadu seznamů (`.tabs.s-podzalozkami`), seznamy
  jsou hranaté jako hlavní záložky, jen menší, a vybraný seznam má barvu
  panelu s kategoriemi pod sebou — jako záložka šanonu. Vybraný seznam
  i kategorie se posouvají doprostřed lišty (`vycentruj()` — ne
  `scrollIntoView`, to by posunulo i stránku). Tlačítko `+ New` má text.
- **Watchlist místo oblíbených:** u páru je **záložka s plusem** (plná
  modrá, když je pár v nějakém seznamu), seznamy se jmenují watchlist
  (česky „seznam"). Výchozí „Favourites" se přejmenoval na
  „My watchlist" — uživatel: oblíbené ztratily smysl, každý seznam je
  vlastní výběr.
- **Pořadí seznamů (v0.31.3, přání uživatele):** vlastní seznamy
  a **„All" až na konci**, před `+ New` (`sestavy.poradi()`). Přejetí
  z Pozic do Trhů otevře **první vlastní seznam**, z Historie „All"
  (sousední strana, jako vnořené stránky). Klepnutí na záložku Trhy
  nechá naposledy otevřený seznam. Nová instalace začíná na „My watchlist".
- **Řádek trhu se nelomí** (v0.31.3): pár i obrat jsou `nowrap` s trojtečkou;
  na ≤ 420 px užší pevné sloupce (hvězdička 26, změna 62, graf 46 px).
  Dřív se „BTCUSDT" na zavřeném Foldu lámal na „BTCUS / DT".
- **Přepnutí seznamu vždy ukáže všechno** — filtr kategorie i hledání se
  zruší (uživatel: nesmí zůstat schované coiny z filtru jiného seznamu).
- **Řazení** tlačítkem vedle hledání: objem 24h (výchozí), změna 24h,
  funding, open interest — vše ze stejného dotazu na tickery. Opětovná
  volba otočí směr. Pod názvem páru stojí hodnota, podle které se řadí.
  Uživatel vybral tyto čtyři; nabídnuté a zatím nevybrané: volatilita
  24h, tržní kapitalizace (CoinGecko), nové listingy.
- Test: `tools/test-sestavy.py` (skutečné dotyky pro přejíždění).
- **Dlaždice místo řádků (v0.36.0, podle TabTraderu, rozhodnutí
  uživatele 2026-10-08):**
  - **Vlastní seznam** = dlaždice v pořadí uživatele (`paryVPoradi`),
    bez hledání, řazení a kategorií. Rozložení `mrizka` (2 vedle sebe na
    zavřeném Foldu, víc na rozevřeném) / `siroke`, přepínač vpravo nad
    dlaždicemi, pamatuje se zvlášť pro seznamy a „All"
    (`perpdesk.marketsLayout`); „All" začíná široké.
  - Dlaždice: burza, pár, metrika / kategorie, mini-graf, cena, změna;
    vlevo dole **hodnota otevřené pozice** a proužek vlevo ve směru
    pozice (`renderTiles` v ui.js).
  - **Plovoucí + vpravo dole** (jen ve vlastním seznamu) → vyhledávání
    (`#sheetAddPair`): bez dotazu 30 nejobchodovanějších, s dotazem
    shody podle objemu; výběr páru přidá na konec seznamu, ukáže krátké
    potvrzení, **vyprázdní pole a nechá v něm kurzor** pro další pár;
    přidané mají fajfku, podruhé → „už je v seznamu". Bublina hlášení
    v Trzích uhne nad + (`body.na-trzich`).
  - Záložka se od v0.36.1 jmenuje **Watchlists** (česky Seznamy). Mřížka
    má vždy **2 sloupce**, široké **1** — na zavřeném i rozevřeném Foldu
    (jako TabTrader); na rozevřeném jsou dlaždice jen širší.
  - **Podržet dlaždici** (`js/dlazdice.js`, dotykové události): táhnout →
    **výměna místa** s dlaždicí pod prstem (`sestavy.prohod`, v0.36.1); pustit bez
    pohybu → nabídka (odebrat ze seznamu / do jiného seznamu). ⚠ Klepnutí
    po zvednutí prstu by trefilo právě ukázané pozadí a nabídku zavřelo —
    450 ms po otevření se klik na pozadí ignoruje (`menuOtevrenoV`).
  - ⚠ `renderTiles` mění jen třídy rozložení; `lze-presouvat` nastavuje
    app.js před vykreslením a přepsání `className` ho dřív smazalo.
  - **Limity** (10 párů na seznam, 5 seznamů — budoucí bezplatná úroveň)
    jsou připravené v `sestavy.LIMITY`, zatím `zapnuto: false`.
  - Test: `tools/test-dlazdice.py` (skutečné dotyky: +, hledání, přesun,
    nabídka, rozložení).
- ⚠ Magnet v grafu dřív v obsluze klepnutí sahal na tlačítko filtru
  oblíbených (zbloudilý řádek) — se zrušeným tlačítkem by spadl. Odstraněno.

#### ✅ Záloha a obnova dat (v0.19.0, 2026-09-28)

V nastavení **Save backup / Restore**. Soubor `perpyx-backup-RRRR-MM-DD.json`
obsahuje všechno `perpdesk.*` z úložiště: seznamy, kresby, alarmy,
indikátory, vzhled kreseb, opravy kategorií, nastavení.

- ⚠ **API klíč a secret se do zálohy nikdy nedostanou** a obnova je ze
  souboru ani nezapíše (podvržený soubor klíč nepřepíše). Soubor putuje
  na Disk, do e-mailu — klíč patří jen do telefonu. Stažené kategorie
  z CoinGecko se také nezálohují (jde je stáhnout znovu).
- **Obnova nahrazuje celý stav** (ne doplňuje): nejdřív se ukáže souhrn
  (kolik seznamů, kreseb, alarmů, z jakého data) a potvrzení, pak se
  stránka přenačte — moduly drží data v paměti.
- ⚠ **Android WebView neumí stáhnout soubor** (odkaz s `download` tam
  nic neudělá). V APK proto jde záloha přes nativní pluginy
  **Filesystem + Share** (`@capacitor/filesystem`, `@capacitor/share`
  v apk.yml): soubor se zapíše do cache a nabídne ke sdílení (Disk,
  Gmail, Soubory). Starší APK bez pluginů zkopíruje zálohu do schránky;
  v prohlížeči klasické stažení. Nativní pluginy fungují i se
  `server.url` (stránka z GitHub Pages) — most Capacitoru se vkládá do
  každé stránky ve WebView (`window.Capacitor.Plugins`).
- Načtení souboru jde přes `<input type=file>` — výběr souborů
  WebView Capacitoru umí.
- Test: `tools/test-zaloha.py`.
- ⚠ Nové moduly (`sestavy.js`, `zaloha.js`) musí být i v seznamu
  `SHELL` v `sw.js`, jinak aplikace bez sítě nenaběhne (v0.18.0 tam
  `sestavy.js` chyběl, opraveno v0.19.0).

#### ✅ Účet PerpyX a cloudová záloha (v0.20.0, 2026-09-28)

Rozhodnutí uživatele: aplikace bude jednou placená (měsíční předplatné
přes Google Play), takže **účet je základ** — pro zálohu, přehled
uživatelů, měření používání a později předplatné i push alarmy. Zatím je
**volitelný**; pro betu se přepne na povinný.

- **Přihlášení kódem z e-mailu, jednou na zařízení** (bez hesla). Pak
  drží dlouhodobá relace, kterou server posouvá, dokud se aplikace
  používá; nepoužitá rok propadne. Šest číslic v poli přihlásí samo.
  Účet vznikne prvním přihlášením. Otisk prstu bude **volitelný zámek
  aplikace** (zvlášť, s nativním pluginem), ne přihlášení; passkey
  místo kódu později.
- **Automatická záloha**: každá změna uložených dat (`store.write`,
  nastavení indikátorů) naplánuje zálohu za 15 s; při odchodu z aplikace
  se rozdělaná záloha odešle hned. Server stejná data jako poslední
  verze znovu neukládá. Verze se drží **30 dní**, poslední vždycky.
- **Po přihlášení na novém telefonu** se nabídne obnova; když má telefon
  vlastní data, volí se, která platí (OK = cloud, Zrušit = telefon).
  **Prázdný telefon** (po odhlášení) dostane data z cloudu bez ptaní.
- ⚠ **Odhlášení i smazání účtu smaže z telefonu všechna data PerpyX**
  (v0.29.0, rozhodnutí uživatele 2026-10-03; `zaloha.vymazMistniData()`):
  API klíč, kresby, seznamy, alarmy, nastavení, zámek. Zůstane jen jazyk,
  kategorie coinů a přečtené upozornění. Dřív data v telefonu zůstávala
  a další přihlášený účet je viděl i zálohoval do svého cloudu. Před
  smazáním se pošle poslední záloha; když selže, uživatel rozhodne.
  API klíč se po přihlášení zadává znovu (do cloudu nejde).
  ⚠ `mock-bybit.js` proto podstrčí účet a klíč jen jednou za test
  (`sessionStorage.__mockUcet/__mockKlic`). Test: `tools/test-odhlaseni.py`.
- **Denní aktivita** (jeden řádek na účet a den + verze aplikace) —
  z toho denně / měsíčně aktivní uživatelé a retence. Nic víc.
- ⚠ **API klíče na server nikdy** — záloha je stejná jako soubor zálohy
  (bez klíčů a relace) a server je pro jistotu vyhodí znovu.
- Server: Pages Functions `web/functions/api/account/*` na perpyx.com,
  tabulky v D1 (`web/migrations/0003_ucty.sql`), tokeny i kódy jen jako
  otisk SHA-256, 5 pokusů na kód, nový kód nejdřív po minutě, strop kódů
  za hodinu. CORS jen pro původ aplikace (GitHub Pages, `https://localhost`
  pro budoucí APK se zabaleným kódem, localhost pro testy).
- ⚠ **Cloudflare odmítá výchozí User-Agent Pythonu (403)** — testy
  posílají prohlížečový. WebView v APK má User-Agent Chromu, jeho se to
  netýká.
- Úklid (`web/uklid.sql`, běží při každém nasazení i denně): prošlé
  kódy, relace nepoužité rok, zálohy starší 30 dní, testovací účty.
  ⚠ **Zbývá:** e-mail s upozorněním před smazáním účtu neaktivního
  12 měsíců (slíbené v zásadách) — nejpozději do září 2027.
- Testy **proti ostrému serveru**: `tools/test-ucet-server.py`
  (API) a `tools/test-ucet-aplikace.py` (celá aplikace, Bybit
  podstrčený). Testovací adresy `@test.perpyx.invalid` dostanou kód
  v odpovědi jen s tajným klíčem `AUTH_TEST_KEY` (tajemství repozitáře,
  webu ho předá web.yml; lokální kopie není v repu — když chybí,
  vygeneruj nový a nastav `gh secret set AUTH_TEST_KEY`).

**Plán navazující na účty** (rozhodnuto 2026-09-28): uzavřená beta přes
Google Play (nové osobní účty vývojáře potřebují před zveřejněním
**12 testerů 14 dní** v uzavřeném testu — ověřit v Play Console),
oddělené kanály beta / stabilní (verze pro Play budou mít kód zabalený
v APK, ne živě z GitHub Pages), měření používání, přehled pro
provozovatele (administrace), pak měsíční předplatné přes Google Play
Billing. Žádné roční ani doživotní licence — uživatel chce mít volnou
cestu projekt kdykoli ukončit.

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

⚠ **`closed-pnl` nedává čas otevření obchodu.** Jeho `createdTime` je vznik
záznamu, tedy skoro totéž co zavření (v ukázce dokumentace se liší o 19 ms).
Graf z historie se proto dřív otevíral jen kolem okamžiku zavření: karta
ukazovala „Held 0 m", zvolil se minutový interval a **nákupy z předchozích
dní v grafu chyběly** — byly vidět jen zavírací prodeje. Opraveno ve v0.17.0:

- `client.plneniObchodu(obchod)` dopočítá plnění **jen tohoto obchodu**: od
  zavíracího příkazu (`orderId` záznamu; když mezi plněními není, třeba
  u likvidace, poslední plnění před zavřením) jde dozadu po sedmidenních
  oknech, po zavření je pozice nulová, odečítá se, čím se měnila, a kde je
  zase nula, tam obchod začal. Nic před ním ani po něm — plnění sousedních
  obchodů na stejném páru se do grafu nepřipletou.
- Interval se volí podle **dopočtené** délky obchodu.
- Směr obchodu se bere z plnění, které ho otevřelo (nákup = long).
- Karta v historii ukazuje jen **čas zavření**, dokud Bybit čas otevření
  nedává (když rozdíl časů dává smysl, ukáže celý rozsah).
- `getExecutions()` **stránkuje** (po 100, nejvýš 5 stránek na okno) —
  při čilém obchodování se týden do jedné stránky nevešel.

Test: `tools/test-historie-obchod.py`, na starém kódu padá. Mock
(`/v5/position/closed-pnl`) má `createdTime` stejně jako Bybit a vedle
prohlíženého obchodu i starší obchod a současnou pozici na stejném páru.

⚠ **Číslo zisku v historii je `closedPnl` od Bybitu**, PerpyX ho nepočítá.
Kdyby se rozcházelo s aplikací Bybitu, chyba není ve výpočtu, ale v tom,
který záznam se ukazuje (Bybit dělá záznam na každý zavírací příkaz, takže
pozice zavíraná po částech má záznamů víc).

⚠ **`side` v `closed-pnl` je strana zavírací objednávky, ne směr pozice** —
dlouhá pozice se zavírá prodejem. Směr se proto odvozuje z cen a zisku:
když se vydělalo a výstup byl výš než vstup, šlo o long. Je to samo o sobě
konzistentní a nezávisí to na výkladu cizího pole.

⚠ **Uzavřené obchody jdou jen po 7denních oknech** (v0.31.2). Bez
`startTime`/`endTime` vrací `closed-pnl` jen **posledních 7 dní** — Historie
pak ukazovala 3 obchody a vypadalo to jako omezení zobrazení. Teď
`getClosedTrades(od, do)` jde po týdnech (stránkuje, odstraní duplicity
na hranách oken) a aplikace načte napoprvé **30 dní**, další měsíc až po
doscrollování ke konci seznamu (`nactiStarsiHistorii`, IntersectionObserver
na `#historyNote`; prázdný měsíc konec neodsune, proto se po vykreslení
zkontroluje znovu). Strop 2 roky (tolik Bybit drží). Při návratu na záložku
se dotáhne posledních 7 dní. Mock napodobuje omezení Bybitu; test
`tools/test-historie-strankovani.py` (`__mnohoObchodu`), na starém kódu padá.

**Historie po obchodech (v0.38.0, přání uživatele 2026-10-10):**
- **Načítání:** napoprvé jen 7 dní (1 dotaz), starší po 30 dnech
  tlačítkem `#historyMore`; nad seznamem „Trades closed since …".
  Okna `closed-pnl` i plnění (`dotahniPlneni`) se stahují **souběžně** —
  dřív jedno po druhém a měsíc trval několik vteřin. Automatické
  načítání při scrollu je zrušené.
- **Seskupení:** Bybit dělá záznam za každý zavírací příkaz, takže
  pozice zavíraná po částech dávala víc „obchodů". `seskupObchody` (app.js)
  přiřadí záznamy obchodům podle plnění páru: od současné velikosti
  pozice dozadu, kde je nula, tam obchod začal. Obchod pozice, která dál
  běží, je **otevřený** (štítek Open, čárkovaný rámeček, „still open"),
  klepnutí otevře graf živé pozice. Uzavřený → prohlídka od otevření po
  poslední zavírací příkaz. Bez práva na plnění zůstane každý záznam
  samostatně.
- **Karta:** hlavička (pár, směr, Open), „Opened … → closed …", pod ní
  řádek na každý výstup ve dvou linkách (datum · doba držení … PnL;
  velikost v coinu · USDT … vstup → výstup (%)), dole podtržený součet.
- ⚠ Plnění se rozlišují podle `execId` (getExecutions ho vrací); mock
  má pro plnění současné pozice pevný čas `TED_MOCKU`, jinak opakované
  stažení vyrábělo duplikáty a součet velikosti nikdy nevyšel na nulu.
- Testy: `test-historie-skupiny.py` (nový), `test-historie-strankovani.py`
  (tlačítko), `test-historie-obchod.py`.

**Barvy jako TabTrader (v0.38.0):** svíčky tlumené `#60a868` / `#e05858`
(`BARVY.svickaRust/svickaPokles`), trojúhelníky plnění jasné `#00e020` /
`#f84840` — odebrané z uživatelova screenshotu TT. Syté `rust`/`pokles`
zůstávají pro linku zisku a měření.

Klepnutí na obchod otevře graf z jeho doby se značkami plnění (trojúhelník
ve směru obchodu + popisek). **Interval se volí podle délky obchodu** — na
hodinový obchod je denní svíčka k ničemu a na dvouměsíční zase minutová.
Kline se načítá s parametrem `end`, jinak by Bybit vrátil nejnovější svíčky
místo těch z doby obchodu.

### ✅ 7) Rozšířená data o účtu

- Přehled účtu: equity, volný margin, využití marginu (`/v5/account/wallet-balance`).
- Funding: příští sazba a čas do stržení, náklad na pozici za den.
- Otevřené příkazy jako samostatný seznam, nejen čáry v grafu.

⚠ **Klíč jen s právem na pozice přehled účtu nedostane** — Bybit odpoví 10005.
Není to chyba spojení a nesmí se tak chovat: pozice jedou dál, přehled se
schová a pod ním se objeví věta, že klíči chybí oprávnění Wallet. Proto
`getWalletBalance()` vrací chybu **jako hodnotu**, ne výjimkou. Typ účtu se
zkouší v pořadí `UNIFIED` → `CONTRACT`; starší účty mají čísla v `coin[]`
místo v součtech.

⚠ **Doplňková data jdou mimo `refresh()`** (`refreshExtras()`), bez `await`
a s vlastním `catch` u každé části. Kdyby visela v hlavní cestě, jeden pomalý
nebo zakázaný dotaz by zdržel nebo shodil seznam pozic — a ten je to hlavní,
co má appka ukázat.

**Funding** má u každého páru vlastní interval (osm hodin je jen nejčastější)
a v tickeru není — musí se doptat `instruments-info`. Mění se prakticky nikdy,
takže se pamatuje do konce běhu; sazba se drží deset minut, aby se každý
třicetisekundový poll neptal znovu. Na kartě není jen číslo, ale i **směr
platby**: kladná sazba znamená, že long platí shortovi, a ze samotného
„+0,01 %" to nikdo nepozná.

⚠ **Ukazuje se částka za jedno stržení i za den.** První verze měla jen denní
součet a uživatel z toho usoudil, že se platí jednou za 24 h — přitom se u
většiny párů platí **po osmi hodinách**, tedy třikrát denně. Interval se
vypisuje z reálné hodnoty (`8 h`, `4 h`, `1 h`), ne natvrdo.

**Zaplacený funding za dobu držení** se sčítá z `transaction-log`, typ
`SETTLEMENT`. Pole `funding` je **záporné, když se platí**.

⚠ **`createdTime` z `position/list` není čas otevření pozice** — je to čas,
kdy na tom páru vznikla pozice **poprvé v historii**. Uživateli to u páru
obchodovaného před sedmi týdny napsalo `paid 0.91 USDT in 49 d`, přestože
pozici držel dvacet minut; v součtu byl funding dávno zavřených obchodů.
Čas otevření proto dopočítává `otevreniPozice()` **z plnění**: jde se od teď
dozadu a odečítá se, čím se pozice měnila; jakmile velikost padne na nulu,
stojíme na plnění, které ji otevřelo. Když se to do osmi týdnů nepovede
(nebo klíč na plnění nemá právo), vrací `null` a sčítá se posledních sedm
dní — karta to pak přizná místo aby si vymýšlela. Výsledek se drží v paměti,
dokud pozice žije; přikoupení ani částečné zavření čas otevření nemění.

Stejný čas používají i **trojúhelníky plnění v grafu**, jinak by ukazovaly
obchody z předchozí, dávno zavřené pozice.

Jde se nejvýš tři stránky po 50 na okno.

⚠ **Místo v cache se zamluví dřív, než se začne čekat na odpověď.**
Dotahování běží každých třicet vteřin, kdežto dopočet času otevření i součtu
může trvat dýl. Bez zámluvy se rozjel druhý, třetí a čtvrtý běh na tomtéž
páru, dotazy se znásobily a burza je začala odmítat kvůli limitu — pak zmizel
i součet, který předtím chodil. Ze stejného důvodu se v `otevreniCache` drží
**rozdělaná práce (slib), ne hotová hodnota**: ptá se odtud funding i graf.

⚠ **Neúspěšný dopočet otevření se nezapamatuje.** Klíč bez práva na plnění
a vyčerpaný limit dotazů vypadají stejně, jenže limit za chvíli povolí — a
uložené `null` by u té pozice nechalo nepřesný součet až do jejího zavření.

⚠ **Součet se dopočítává, nepočítá znovu.** Pozici jde držet měsíce a projít
celou její historii po sedmidenních oknech při každém desetiminutovém
obnovení by znamenalo desítky dotazů pořád dokola. Drží se proto mezivýsledek
(`fundingSoucty`) a přidává se jen to, co přibylo od minule; drahý je jen
první průchod. Maže se spolu s pozicí.

⚠ **Strop 52 oken (rok) není limit na dobu držení**, ale pojistka proti
nekonečné smyčce, kdyby čas otevření vyšel nesmyslně — třeba z rozjetých
hodin v telefonu. Díky dopočítávání se těch 52 dotazů udělá jednou za pozici.
(Dřív to bylo osm oken, tedy dva měsíce, a to už limit na dobu držení byl.) ⚠ Potřebuje oprávnění Wallet stejně jako přehled účtu, takže má
vlastní `try` — bez něj se ukáže zbytek fundingu a jen chybí součet.

⚠ **Deník má tři omezení a na každém z nich to spadlo** (v0.16.0–0.16.2,
nakonec opraveno v `sectiFunding()`):

1. `startTime` a `endTime` musí přijít **spolu**. Samotný začátek dotaz shodí.
2. Okno smí být nejvýš **sedm dní**, takže se chodí po sedmidenních oknech
   od otevření pozice (strop osm oken, tedy zhruba dva měsíce).
3. Deník **neumí filtrovat na `symbol`**, jen na `baseCoin`. Bez něj se do
   stránek po 50 řádcích vejde při více pozicích sotva den — proto stálo na
   telefonu `paid 0.00 USDT in 1 d` i u pozice držené několik dní. Když by
   Bybit `baseCoin` u páru neplnil, jde druhé kolo bez něj a řádky se
   odfiltrují podle symbolu jako dřív.

Jedno vypadlé okno nesmí shodit celý součet — zapíše se do diagnostické stopy
a pokračuje se dál.

⚠ **Popisek pak nesmí tvrdit „celkem".** Když se nepokrylo od otevření pozice
(neznámý `createdTime`, strop nebo vypadlé okno), nese výsledek
`odOtevreni: false` a v kartě stojí `paid 0.37 USDT in 2 d` místo `paid so far`.
Číslo, které se tváří na celou dobu držení a není, je horší než žádné.

⚠ **Mock musí tahle omezení napodobit.** Dokud odpovídal na cokoli, hlásil
test zelenou, zatímco na telefonu součet nedorazil ani jednou — přesně ten
případ, proti kterému je `tools/test-spojeni-burza.py`.

### ✅ 8) Pohodlí

- Řazení a filtrování pozic (PnL, velikost, blízkost likvidace).
- Barevné varování na kartě při přiblížení k likvidaci, s volitelnou hranicí.
- Vibrace nebo zvuk při zásahu SL/TP.
- Volume profile jako vlastní indikátor (viz checkpoint 3).
- Alarm při protnutí nakreslené čáry cenou.

Řazení podle likvidace jde podle **vzdálenosti** k ní, ne podle ceny — zajímá,
jak blízko to má. Pozice bez likvidační ceny padá na konec. Druhé klepnutí na
tentýž klíč otočí směr, jako v každé tabulce. Volba se ukládá do telefonu.

⚠ **Prázdný výsledek filtru není totéž co „žádné pozice"** — data jsou, jen je
schoval filtr. Proto `showFilterEmpty()` s vlastním textem, ne stejná hláška
jako u prázdného účtu.

#### Horní část obrazovky (v0.16.6)

Značka je větší (1,28 rem) a **stav spojení stojí vedle ní**, ne pod ní —
kvůli jednomu slovu se nevyplatí celý řádek.

⚠ **Řádek se značkou se nikdy nezalamuje** (`flex-wrap: nowrap`, text stavu
se ořízne). Delší hláška („Connecting…") by jinak stav shodila na druhý
řádek, hlavička by povyskočila a stránka by při každé změně spojení
poskočila s ní. Test měří, že výška hlavičky je pro všechny hlášky stejná.

⚠ **Ikonová tlačítka v hlavičce jsou užší (38 px), než jsou vysoká.**
Dotyková plocha 44 px se drží na výšku; tři tlačítka po 44 px do šířky ale
na zavřeném displeji Foldu ukousla tolik, že se vedle značky nevešel stav.

**Přehledy jsou jeden řádek na blok**, popisek vedle hodnoty. Kartičky
s popiskem nad hodnotou zabíraly tolik, že ze čtyř pozic byly na displeji
vidět dvě. U přehledu účtu se proto nepíše „USDT" u každého čísla (účet je
v USDT celý) a popisky jsou krátké (`Free`, `Margin`) — jinak se na 344 px
řádek zalomí a úspora je pryč. Test hlídá, že oba přehledy mají jeden řádek.

**Mezi záložkami jsou šipky `‹ ›`** jako nápověda, že se dá přejíždět
prstem. Gesto samo o sobě není nijak vidět a uživatel se o něm nemá jak
dozvědět. Jsou to dekorace (`aria-hidden`), přepíná se klepnutím.

#### Proužek úrovní v kartě pozice

Samostatný seznam otevřených příkazů pod pozicemi se neosvědčil — uživatel ho
označil za zbytečný. Nahradil ho **proužek přímo v kartě**, stupnice jako na
starém rádiu: uprostřed vstup, vlevo strana ztráty (SL), vpravo strana zisku
(TP), po délce jezdí svítící ukazatel aktuální ceny. Smysl: bez otevírání
grafu je vidět, kolik mám kde nastavených příkazů a jak blízko k nim cena je.
Úroveň pro celou pozici je silnější čára než dílčí příkaz. Pod proužkem stojí
vzdálenost k nejbližšímu SL a TP v procentech a velikost pozice (hodnota
v USDT a podíl na equity).

⚠ **Každá strana má vlastní měřítko.** Společné vypadalo logicky, ale TP bývá
dvacet procent daleko a SL dvě — vzdálený TP pak stlačil oba stop-lossy na
jednu čáru u středu a nebylo poznat, jak blízko k nim cena je. Teď levá půlka
pokrývá vstup → nejzazší SL, pravá vstup → nejzazší TP.

⚠ **Likvidace se do měřítka nepočítá** — bývá desítky procent daleko a
stlačila by SL i TP k sobě. Zůstává v mřížce karty jako číslo.

⚠ U shortu se osa **zrcadlí**, aby „vlevo = ztráta" platilo vždycky.

**Vstup uprostřed je plná fialová, silnější než ostatní značky** — a schválně
ne čárkovaná jako v grafu. Je to **průměrná** cena ze všech nákupů, ne jeden
konkrétní vstup; plná čára to od dílčích příkazů odlišuje na první pohled.

##### Rozvržení karty (v0.16.4)

**Mřížka s hodnotami je pryč.** Opakovala o dva řádky výš přesně to, co
proužek sám znázorňuje. Cíl je vejít tři pozice na displej, takže se nikde
neplýtvá řádkem:

| co | kde |
|---|---|
| velikost v coinu a v USDT | drobně **v závorce za pákou**, na prvním řádku |
| likvidační cena | **hned za hodnotou pozice** v hlavičce |
| aktuální cena | **nad svým ukazatelem**, jezdí s ním |
| vzdálenost k nejbližšímu SL a TP v % + **cena vstupu** mezi nimi | první řádek pod proužkem |
| co ten SL a TP znamenají v penězích | druhý řádek pod proužkem |
| funding | patička, pořadí níž |

Likvidace patří k hodnotě pozice, ne do patičky k fundingu: obojí říká, co
se děje s penězi, a oko to najde na jednom místě. V patičce mezi čtyřmi
údaji zapadla. Popisek je krátký (`Liq`) — vedle ceny je jasné, o co jde,
a plné „Liquidation" shodilo hlavičku na zavřeném displeji Foldu na tři
řádky.

⚠ **Levá část hlavičky je flexbox s `flex: 1` a lomí se mezi údaji.** Bez
`flex: 1` se zúžila na nejužší možný obsah a každý údaj skončil na vlastním
řádku; bez `white-space: nowrap` na údajích se zase „(2 547 JUP · 778.87
USDT)" rozpadlo doprostřed a druhý řádek začínal osamoceným „USDT)".

Měřeno: proti v0.16.6 je karta na rozevřeném Foldu o 18 px nižší, na 416 px
o 5 px nižší, a na nejužších 344 px o 10 px **vyšší** — tam se hlavička lomí
na tři řádky. Za to, že na obou displejích, které se používají, je karta
kratší, to stojí.

**ROE se neukazuje.** Procento vedle PnL bylo jen jinak vyjádřené totéž
a stálo celý řádek na každé kartě.

**Ukazatel aktuální ceny má barvu zisku** (zelený nad vstupem, červený pod
ním), stejnou jako číslo nad ním. Bílá čára o tom, jestli jsem ve ztrátě,
neřekla nic.

Patička jde v pořadí **sazba → nejbližší stržení a jeho částka (v závorce
interval a denní částka) → součet za dobu držení**. Odpočet
a částka patří k sobě: „za 4 h 47 m zaplatíš 0,10 USDT" se čte samo, kdežto
dvě čísla na opačných koncích řádku si musel uživatel spojovat sám.

⚠ **Interval fundingu musí být vypsaný slovem** — `every 8 h`, ne jen `8 h`.
Každý pár ho má vlastní (osm hodin je jen nejčastější, jsou i čtyři a jedna)
a holé „8 h" v závorce vypadalo jako cokoli.

⚠ **U součtu stojí `total` a vždycky doba, za kterou je** —
`total paid 0.31 USDT in 1 d 11 h`. Bez slova „total" šlo číslo splést
s částkou za jedno stržení o kousek vlevo; bez doby zase nebylo poznat, co
přesně se sečetlo. Směr (`paid` / `received`) se řídí **znaménkem součtu**,
ne aktuální sazbou — sazba se v čase přehazuje, takže pozice, která teď
dostává, mohla celkově zaplatit. Rozdíl mezi „celkem" a „za posledních pár dní" musel uživatel
hlídat sám a u pozice držené den je to stejně totéž číslo. Doba se počítá od
**nejstaršího započítaného stržení**, takže neslibuje víc, než se stáhlo.

⚠ **Nad proužkem smí stát jediné číslo.** Vstup i mark cena tam chvíli byly
obě (v0.16.2) a u čerstvě otevřené pozice se napsaly přes sebe — cena leží
skoro na vstupu. Vstup je navíc napevno uprostřed, takže se jeho cena nemá
proč vozit nahoře; patří dolů mezi SL a TP, což jsou stejně tak pevné úrovně.

**Vzdálenost k likvidaci se neukazuje.** U pozice s pákou 10× je to skoro
vždycky desítky procent, tedy číslo bez informace. Řazení „to liquidation"
v liště nad seznamem zůstává — to je funkce, ne údaj na kartě.

Likvidace zůstává i bez likvidační ceny (napíše se `none`) — „likvidace není"
je sama o sobě informace.

Seznam pod pozicemi zůstal jen pro příkazy na **párech bez otevřené pozice** —
ty by se jinak neměly kde ukázat, proužek bez pozice nemá kam kreslit.

**Varování před likvidací** obarví celou kartu, ne jen jedno číslo: v rychlém
pohledu na seznam se přebarvená hodnota snadno přehlédne. Hranice je
v nastavení (výchozích 10 % odpovídá tomu, co měla karta napevno dřív).

⚠ **Zásah SL/TP se pozná z protnutí mark ceny, ne ze zmizení pozice.** Pozice
zmizí i při ručním zavření a to zvonit nemá. Stejný princip jako u cenových
alarmů: porovnává se s minulou cenou, takže první tick po startu nespustí nic.
Zavřené pozice se z paměti uklízejí, ať tam neleží navždy.

#### Volume profile

⚠ **Je to odhad, ne pravda.** Poctivý profil potřebuje jednotlivé obchody
a na ty Bybit endpoint nemá, takže se objem každé svíčky rovnoměrně rozprostře
mezi její minimum a maximum. Dělá to tak většina retailových nástrojů, ale
přesné to není — uživatel o tom ví.

Kreslí se stejnou technikou jako objem: registrovaný indikátor s **prázdným
`figures`**, aby nemluvil do měřítka cenové osy, a sloupce si vykreslíme sami
v `draw()`. `calc()` musí vrátit řadu dlouhou jako data (byť prázdných
objektů) — jinak knihovna indikátor považuje za prázdný a `draw()` vůbec
nezavolá. Rozpětí i měřítko se bere **jen z právě viditelných svíček**, profil
má popisovat to, na co se uživatel dívá. Nejsilnější pásmo se volitelně
obarví zvlášť.

Test obojího: `tools/test-ucet-a-pohodli.py`.

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

**Naléhavost:** dokud je klíč read-only (a zápis příkazů v plánu není, viz
níž), je čitelný secret v `localStorage` přijatelné riziko — nejhorší
následek je, že někdo uvidí pozice. Otisk prstu je proto hlavně pohodlí
a ochrana soukromí, ne pojistka proti ztrátě peněz. Nejsilnější varianta
(Android Keystore) přichází s APK, takže dává smysl dělat tenhle checkpoint
**až po checkpointu 10**.

### 10) APK přes Capacitor + notifikace

Zabalit do APK, aby aplikace mohla běžet na pozadí a posílat notifikace
(blížící se likvidace, zasažení SL/TP, výrazná změna PnL).

**Proč to alarmům pomůže:** PWA je stránka v prohlížeči a se zhasnutým
displejem ji Android uspí — kód neběží, spojení s burzou spadne, alarm nemá
co spustit. Aplikace pro Android může spustit **službu na popředí**
(foreground service) s trvalou notifikací („PerpyX hlídá 3 alarmy"), kterou
systém nechá běžet i se zhasnutým displejem — jako navigaci nebo přehrávač.
Ta drží vlastní spojení s burzou, kontroluje hladiny a při protnutí pošle
systémovou notifikaci se zvukem a vibrací.

#### Rozhodnuto (2026-09-24)

- **Vývoj zůstává v HTML verzi** a testuje se jako dosud (prohlížeč + telefon
  přes GitHub Pages). APK se staví jen občas.
- **APK se staví v GitHub Actions** (`.github/workflows/apk.yml`), ne na
  počítači — není tam Node, Java ani Android SDK a instalace by byla velká.
  Sestavuje se při změně ve složce `apk/` nebo ručně. Výsledek jde do vydání
  **`apk-latest`** s pevnou adresou, aby šlo APK stáhnout přímo v telefonu:
  https://github.com/noegoncz/spacer-perp-desk/releases/download/apk-latest/PerpyX.apk
- **Obal načítá aplikaci z GitHub Pages** (`server.url` v
  `apk/capacitor.config.json`), nevozí si ji v sobě. Změny webu se tak do APK
  dostanou samy, stejně jako do PWA; nové APK je potřeba jen při změně obalu
  nebo nativní části.
- ⚠ **npm je jen pro obal ve složce `apk/`**, a to jen v Actions. Webová
  aplikace dál žádný build krok nemá.
- Projekt `apk/android/` se zatím generuje při každém sestavení (`cap add
  android`) a v repu není. Až přibude nativní kód, půjde do repa.

⚠ **APK má vlastní úložiště**, oddělené od prohlížeče. API klíč, kresby
a alarmy z PWA v Brave se do něj samy nepřenesou — v APK se klíč zadává
znovu.

✅ **Pevný podpisový klíč (2026-09-28).** Dřív ladicí podpis, který si
runner pokaždé vyrobil nový — novější APK pak šlo nainstalovat jen po
odinstalování staršího, a to smazalo úložiště (klíč, kresby, alarmy).

- Klíč je **PKCS12** (`perpyx-release.p12`, alias `perpyx`, RSA 2048,
  platnost 30 let), vyrobený jednou lokálně v Pythonu (`cryptography`),
  protože na počítači není Java.
- **Kopie pro sestavení** je v šifrovaných tajemstvích repozitáře:
  `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`.
  Z GitHubu se zpátky stáhnout nedá.
- **Záloha u uživatele**: `C:\Users\roman\PerpyX-podpis` (klíč + `CTI-ME.txt`
  s heslem). ⚠ Ztráta klíče = každá další verze jen po odinstalování.
- Workflow podepisuje přes `npx cap build android --androidreleasetype APK
  --signing-type apksigner` a na konci **ověří `apksigner`em, že podpis je
  `CN=PerpyX`** — kdyby se omylem podepsalo ladicím klíčem, sestavení spadne.
- `versionCode` = číslo běhu workflow, roste s každým sestavením (Android
  starší číslo jako aktualizaci odmítne).
- ⚠ Klíč **nikdy do repozitáře** (`.gitignore` má `*.p12`, `*.keystore`,
  `*.jks`) ani do logu.
- Přechod z ladicího podpisu na trvalý vyžadoval **jedno poslední
  odinstalování** (2026-09-28); od té doby se APK instaluje přes předchozí.

Stavová lišta v APK má světlé ikony (`plugins.SystemBars.style: "DARK"`
v `apk/capacitor.config.json` — „tmavý styl" znamená světlý obsah pro tmavé
pozadí).

#### Ověřeno na telefonu (2026-09-24, první APK)

Instaluje se, aplikace v něm běží celá (pozice, graf, kresby, funding) a alarm
**zazní i s aplikací na pozadí**. Sestavilo se s **Capacitorem 8** (verze se
bere `@latest`).

⚠ **Okraje systémových lišt.** Capacitor 8 kreslí aplikaci pod stavovou
i navigační lištu (edge-to-edge) a okraje předává jako CSS proměnné
`--safe-area-inset-*` (plugin `SystemBars`, `insetsHandling: css` — jen když
má stránka `viewport-fit=cover`, což má). Android WebView přitom
z `env(safe-area-inset-*)` vrací nulu. V prvním APK proto obsah zalezl pod
lišty: **na timeframy nešlo klepnout**, překryl je panel aplikací Foldu,
a hlavička se tlačila pod stavovou lištu. Opraveno v CSS: proměnné
`--okraj-nahore/-dole/-vlevo/-vpravo` berou větší z `env()` a z proměnné
Capacitoru, a **v CSS se nikde nepoužívá `env()` napřímo**. Pozor na prvky
s `position: fixed` (graf, vysouvací nabídky) — okraje z `body` se jich
netýkají, musí si je vzít samy. Test: `tools/test-okraje-apk.py`, na starém
CSS padá.

⚠ **Systémové notifikace v APK nefungují** a z webu fungovat nebudou:
Android WebView nepodporuje Notifications API ani `showNotification` service
workeru. Musí jít přes nativní plugin (`@capacitor/local-notifications`)
a na Androidu 13+ i s povolením `POST_NOTIFICATIONS`. Zvuk a vibrace chodí,
protože je dělá WebAudio a `navigator.vibrate` přímo ve stránce.

**Při příštím sestavení APK přidat** (ne dřív — každé sestavení s ladicím
podpisem znamená odinstalovat a znovu zadat klíč): `plugins.SystemBars.style:
"DARK"` v `apk/capacitor.config.json`, aby ikony ve stavové liště byly světlé
na tmavém pozadí (teď jsou tmavé a skoro nejsou vidět).

**Je to samostatná aplikace?** Napůl. APK je nativní obal s vlastní ikonou
a vlastním úložištěm, ale kód rozhraní si stahuje z GitHub Pages — bez
internetu nenaběhne poprvé (pak ji podrží service worker v cache). Pro
aplikaci, která stejně bez internetu nemá z burzy žádná data, to nevadí,
a díky tomu se změny webu do APK dostanou samy. Skutečně „aplikační" budou
až nativní části: notifikace a služba na popředí.

**Další kroky:** (1) pevný podpisový klíč, aby šlo aktualizovat bez
odinstalování, (2) nativní notifikace, (3) služba na popředí s hlídáním
alarmů při zhasnutém displeji, (4) výjimka z optimalizace baterie u Samsungu.

### Mimo plán: zadávání příkazů

**Z plánu vypuštěno** (rozhodnutí uživatele 2026-09-24). Aplikace zůstává
výhradně read-only; zápis je nanejvýš možná nástavba někdy v budoucnu. Pro
případné uvedení na trh by zápis celou věc výrazně zkomplikoval (bezpečnost
klíčů s právem obchodovat, odpovědnost za chybně odeslaný příkaz, pravidla
obchodů s aplikacemi). **Nenavrhuj ho sám.**

Poznámky níž zůstávají jen pro případ, že by se k tomu někdy vrátil:

- Přidání je levné, protože veškerá komunikace je v `js/bybit.js`. Bybit V5
  podepisuje u POSTu místo query stringu **syrové tělo požadavku** — jinak
  stejný postup.
- Práva klíče na Bybitu nejdou dodatečně změnit, bude potřeba **nový klíč**.
  Výměnu klíče aplikace zvládá.
- **Pravidlo:** modul nabízí pouze čtení. Zápis přijde jako zřetelně oddělená
  část s potvrzovacím krokem, aby chyba v UI nemohla omylem odeslat příkaz.
- Předpoklad: hotový checkpoint 9 (šifrované klíče) — s právem obchodovat
  už čitelný secret v úložišti přijatelný není.

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

### Stav k 2026-09-29 večer (v0.23.2, APK 1.0.7) — odkud pokračovat

**Hotovo** (podrobnosti v sekcích výš): pevný podpis APK · web perpyx.com
s betou (double opt-in, zásady, podmínky, e-mail privacy@/hello@) ·
Trhy se seznamy a kategoriemi, řazení · záloha do souboru · **účet**
(povinný při prvním spuštění, kód z e-mailu, cloudová záloha s historií,
denní aktivita, limity proti hádání kódu) · **alarmy se zhasnutým
displejem** (hlídač na Hetzneru + Firebase, test naostro prošel) ·
zámek aplikace PIN + otisk · jen klíč pro čtení (vynucené) · APK bez
systémové zálohy · úvodní obrazovka (účet → burza), klíč v nastavení
nikdy vidět · audit soukromí body 1–5.

**Ověřeno na telefonu 2026-09-30:** push alarmu (notifikace přijde),
hlášení z aplikace. **Příště:** pohodlnější okno nastavení alarmu (uživatel
to chce řešit později).

**Čeká na ověření v telefonu** (uživatel zatím nepotvrdil): otisk prstu, záloha do souboru přes
sdílení, úvodní obrazovka, oprava v0.23.2 (zámek byl zaseklý kvůli
syntaktické chybě v en.js — uživatel má aplikaci zavřít a otevřít).

**Další v pořadí:** 1) Binance (nejdřív společné rozhraní burz, pak
adaptér; ověřit dostupnost futures pro EU/ČR) → 2) Hyperliquid (bez
klíče, jen adresa) → 3) OKX · pak RSI divergence (graf) → skener nad
seznamem (na serveru) · přehled pro provozovatele (zájemci, účty,
aktivita, stav hlídače) · Google Play (uzavřený test 12 testerů / 14 dní,
kód zabalený v APK, kanály beta/stabilní) · předplatné (Play Billing) ·
passkey místo kódu (před placenou verzí).

**Drobné dluhy:** e-mail před smazáním neaktivního účtu a automatické
mazání zájemců po 24 měsících (slíbeno v zásadách, hoří 09/2027) ·
šifrování klíče v telefonu (Keystore) · přehled všech alarmů napříč
páry · tažení hladiny alarmu prstem · RSI/Volume/ostatní indikátory
dál (viz „Nejbližší dodělávky") · kontrola shody verzí index.html ×
version.js.

⚠ **Po každé úpravě textů pusť `tools/test-syntaxe.py`** a skripty
s texty piš do souboru (Write), ne přes heredoc v shellu — ten mění
zdvojená zpětná lomítka (v0.23.1 tak shodil celou aplikaci).

### Směr dál — rozhodnutí uživatele (2026-09-28)

Uživatel používá **už jen APK**; verzi v Brave nevyvíjíme ani nepoužíváme
(je to stejný kód z GitHub Pages, jen v prohlížeči — nic nekomplikuje).

1. **Pevný podpis APK** — trvalý podpisový klíč v tajemstvích GitHubu
   + záloha u uživatele. Bez něj každé nové APK vyžaduje odinstalování,
   a to smaže všechna data v aplikaci (klíč, kresby, alarmy, sestavy).
2. **Trhy: kategorie a vlastní sestavy.** Tři vrstvy: všechny coiny na
   burze → **kategorie** (AI, Privacy, Meme, L1, L2, DeFi…) jako filtry →
   **vlastní sestavy** (typicky 20–50 coinů), mezi kterými se **přejíždí
   prstem**; coin jde vložit do kterékoli sestavy odkudkoli.
   Kategorie se **předvyplní z CoinGecko** tlačítkem „Identifikovat coiny"
   — poprvé povinné, výsledek se uloží a CoinGecko se znovu volá jen
   tlačítkem „Obnovit" (nesmí zdržovat každé otevření). Shody zkratek
   (víc coinů pod „PEPE") → vzít největší kapitalizaci, kategorie jde
   u coinu ručně opravit; `1000PEPE` apod. převést na základní coin.
   ⚠ **Datový model připravit na další burzy** (Binance, MEXC…): kategorie
   se vážou na coin (JUP), sestavy na `burza:pár` (`bybit:JUPUSDT`).
3. **Záloha a obnova dat** do souboru (sestavy, kresby, alarmy).
4. **RSI divergence v grafu** — **býčí i medvědí**, nejdřív vizuálně
   a odladit detekci na skutečných grafech (pivoty vlevo/vpravo, rozpětí).
5. **Skener divergencí nad sestavou**, zatím s otevřenou aplikací.
6. **Server + push notifikace** (jako TradingView/TabTrader) — **zvolená
   cesta pro alarmy se zhaslým displejem**, ne služba v telefonu.
   Server hlídá ceny a skenuje divergence, push doručí Android přes
   Firebase Cloud Messaging; baterie telefonu se to prakticky netýká
   a je to použitelné i pro veřejnou verzi. **API klíče zůstávají
   v telefonu** — server potřebuje jen veřejné ceny; na server jdou jen
   hladiny alarmů a seznamy coinů.
7. **Webová stránka aplikace** se sběrem e-mailů zájemců o **beta
   testování** (uživatel ji chce mít brzy). Hosting volit tak, aby šel
   nasazovat automaticky odsud a uživatel nemusel nic složitě nastavovat.
8. **Další burzy** — až bude potřeba.

### Nejbližší dodělávky (drobné)

- [x] **Ověřeno na telefonu** (2026-09-24): kresby při přepínání timeframu
  neproblikávají, graf se otevře u posledních svíček. Dřív potvrzená gesta,
  mizení kreseb na stejném timeframu i živé svíčky.
- [x] **Funding ověřen na telefonu** (2026-09-24, v0.16.7): součet `total paid`
  se ukazuje a doba u dřív obchodovaného páru je krátká (doba držení současné
  pozice, ne desítky dní). Přesnou shodu částky s Bybitem si uživatel ověří
  v aplikaci Bybitu.
- [x] **Horní část obrazovky** (v0.16.6) — uživatel prozatím schválil.
- [ ] **Zvážit kontrolu shody verzí** mezi `index.html` a `js/version.js`.
  Rozpadlá aktualizace (nová stránka + starý skript) se teď přežije, ale
  aplikace o nesouladu neví a běží dál se starým kódem, dokud se worker
  nepřehoupne sám.
- [ ] **RSI dál** podle TradingView: Calculate Divergence, VWMA, SMA + Bollinger
  Bands (BB StdDev), přechodová výplň pásem. (SMA, EMA, SMMA a WMA hotové.)
- [ ] **Volume dál**: přesnost (precision), popisky na cenové ose.
- [ ] **Nastavení ostatních indikátorů**: MACD, KDJ, MA, EMA, BOLL, SAR mají zatím
  jen periody (a výšku panelu) — chybí barvy a přepínače viditelnosti čar.
- [x] **Alarmy — vlastní obrazovka a vzhled** (v0.11.0, rozšířeno v 0.12.0).
  Podmínka, trigger, platnost, zpráva, zvuk, vibrace i systémová notifikace;
  tři typy (hladina, šikmá čára, čas), zadávání křížem v grafu a převod kresby
  na alarm. Popsáno výš v „Cenové alarmy". Zbývá k tomu: **přehled všech
  alarmů** napříč páry (data pro něj už v jednom seznamu jsou) a **tažení
  hotové čáry prstem** bez otvírání nastavení.
- [ ] **Notifikace při zhasnutém displeji — rozhodnout cestu.** ⚠ Ověřeno
  uživatelem 2026-09-22 (v0.12.0): notifikace z běžící stránky dorazí jen
  **dokud je displej zapnutý**. Jakmile telefon zhasne, Android stránku uspí
  a alarm mlčí — pro sledování trhu je tedy PWA v tomhle stavu nepoužitelná
  a je to hlavní důvod jít dál. Možnosti:
  - **(a) APK přes Capacitor** (checkpoint 10) s **foreground service**:
    trvalá notifikace „PerpyX hlídá 3 alarmy", vlastní WebSocket
    v nativní vrstvě a `LocalNotifications`. Běží při zhasnutém displeji,
    nic neodchází z telefonu, nic se neplatí. Chce výjimku z optimalizace
    baterie (Samsung služby na pozadí zabíjí) a APK se musí instalovat mimo
    obchod. **Pro vlastní provoz jediná rozumná cesta.**
  - **(b) Server + web push (FCM/VAPID)**: server drží spojení na Bybit,
    hlídá hladiny a pošle push, který Android doručí i se zhasnutým
    displejem. Tak to dělá TradingView i TabTrader. API klíč ven nejde, ale
    **hladiny alarmů telefon opustí**, hosting se platí a udržuje a přibývá
    GDPR. **Pro komerční provoz nevyhnutelné** (bez něj by každý zákazník
    musel instalovat APK mimo obchod a na iOS by to nešlo vůbec).
  - **(c) Obojí**: nativní hlídání jako základ, push ze serveru jako záloha,
    až by se aplikace prodávala. Jeden WS na burzu pro všechny zákazníky,
    ne jeden na uživatele.
  - Periodic Background Sync **nestačí** — o časování rozhoduje prohlížeč
    (hodiny, ne vteřiny) a je experimentální.
  - ⚠ Uživatel používá **Brave**; u varianty (b) nejdřív ověřit push přímo
    na jeho telefonu.
- [x] **Volume profile** jako vlastní indikátor (v0.15.0) — odhad ze svíček, popsáno u checkpointu 8.

### Checkpointy

1. ✅ Připojení a seznam pozic
2. ✅ Graf se svíčkami
3. ✅ Kreslení a indikátory (rozšiřuje se dál výše)
4. ✅ Angličtina jako základ
5. ✅ Layout pro Fold — stav při přeložení telefonu
6. ✅ Záložky Pozice / Trhy / Historie
7. ✅ Rozšířená data o účtu (equity, margin, funding, příkazy)
8. ✅ Pohodlí (řazení, varování před likvidací, vibrace)
9. ⏳ Bezpečnost — otisk prstu + šifrovaný secret + testnet. Pohodlí
   a soukromí, ne ochrana peněz (klíč je read-only); nejlépe až po 10,
   s Android Keystore.
10. ⏳ **APK přes Capacitor + notifikace — další krok.** Jediná cesta k alarmům
    se zhasnutým displejem.

Zadávání příkazů je z plánu **vypuštěné** (viz „Mimo plán" výš).

Připomínky ke grafu a indikátorům má uživatel další a řeší se průběžně mezi
checkpointy — nečekají na ně.

## Hlášení problému / nápadu z aplikace (v0.24.0, 2026-09-30)

Na přání uživatele pro betu: testeři mají po ruce, kde nahlásit problém
nebo nápad, a na mobilu se problém líp ukáže screenshotem než popíše.

- **Bublina vpravo dole** na hlavních obrazovkách (`#feedbackBtn`,
  z-index 15 — graf ji překryje, nabídky taky) + řádek v Nastavení →
  O aplikaci. Jen pro přihlášené. **Dočasné**: po betě
  `HLASENI_ZAPNUTO = false` v app.js (řádek v nastavení zůstane).
- Okno: Problém / Nápad, text, **až 3 screenshoty z galerie** (uživatel
  udělá snímek jako obvykle a přiloží ho). `js/hlaseni.js` je zmenší na
  1600 px a JPEG. Technické údaje (verze, telefon, obrazovka, jazyk,
  obrazovka v aplikaci, burza ano/ne, push, zámek, poslední chyba) jsou
  vidět předem. ⚠ **Nikdy API klíč** — test to hlídá.
- Server `/api/account/feedback`: e-mail na `hello@perpyx.com` (Email
  Routing → Gmail) se snímky v příloze, **reply-to = e-mail uživatele**.
  Nejvýš 10 hlášení denně na účet; tabulka `feedback` drží text a údaje,
  **snímky ne** (jen v e-mailu); maže se se smazáním účtu. Testovací
  účty e-mail neposílají.
- Testy: `tools/test-hlaseni.py` (skutečný výběr souboru přes CDP),
  `tools/test-ucet-server.py` (naostro).
- ✅ **Ověřeno uživatelem na telefonu 2026-09-30** — hlášení se
  screenshotem dorazilo do Gmailu.

## Úvodní obrazovka: povinný účet, pak burza (v0.23.0, 2026-09-29)

Rozhodnutí uživatele: přihlášení v nastavení nestačí — **účet je povinný
hned při prvním spuštění** (beta i placená verze ho potřebují) a hned
potom nabídka připojit burzu. **Klíč se v nastavení nikdy nezobrazuje.**

- `#onboarding` (index.html) přes celou obrazovku, nad aplikací, pod
  zámkem (z-index 90 vs. 100). Krok **přihlášení** (e-mail → kód,
  souhlas s podmínkami, krátký disclaimer) **nejde zavřít**; po
  odhlášení i smazání účtu se vrací (`vykresliUcet` → `ukazUvod`).
- Krok **burza**: Bybit, vedle Binance / Hyperliquid / OKX jako „brzy".
  Formulář klíče (s kontrolou jen pro čtení) je jen tady. Jde přeskočit
  (`perpdesk.exchangeSkipped`) — Trhy fungují i bez klíče; tlačítko pod
  hláškou „bez klíče" vede sem, ne do nastavení.
- Nastavení: karta **Burzy** jen s přehledem („Klíč jen pro čtení
  ••••ABCD", Vyměnit klíč, Odpojit) — výměna otevře stejné okno
  s křížkem. Karta Obecné (likvidace, SL/TP, jazyk) a sbalená
  **Pokročilé** se zálohou do souboru: s účtem se zálohuje samo, soubor
  zůstává kvůli přenositelnosti dat (GDPR) a jako pojistka bez e-mailu.
- Jako u zámku: bez účtu přidá skript v `<head>` třídu `uvod-start`, ať
  úvodní okno naskočí dřív než aplikace (žádné probliknutí).
- ⚠ **Testy:** `mock-bybit.js` podstrčí přihlášený účet a klíč; testy
  účtu je vypínají přes `sessionStorage` `__bezUctu` / `__bezKlice`
  (musí se nastavit **před** mockem). Test: `tools/test-uvod.py`.

## Alarmy se zhasnutým displejem — server + push (v0.22.0, 2026-09-29)

Zvolená cesta (rozhodnutí uživatele 2026-09-28): **serverový hlídač
a push přes Firebase**, ne služba v telefonu.

```
telefon (účet, alarmy) ──PUT /api/account/alarms──▶ perpyx.com (D1)
                                                       ▲   │ GET /api/watcher/alarms (15 s)
                     push (FCM) ◀── hlídač na Hetzneru ◀┘   │ POST /api/watcher/fired
                                    ▲ veřejné ceny Bybitu (WS tickers)
```

- **Hlídač** `server/hlidac.mjs` (Node 22, bez závislostí): drží stream
  tickerů Bybitu pro páry s alarmy, vyhodnocuje protnutí **stejným
  kódem jako aplikace** (`js/alarmy-logika.js`, sdílený soubor — nesmí
  importovat nic, co v Node neexistuje), posílá push přes FCM HTTP v1
  (JWT RS256 přes node:crypto), hlásí zaznění. Ceny = `lastPrice`.
  ⚠ Po výpadku streamu se reference cen zahodí, jinak by stará cena
  vyrobila falešné protnutí. Test: `tools/test-hlidac.py` (skutečný
  stream Bybitu, podstrčené API, režim ZKOUSKA=1).
- **Server** Hetzner (CX23, Norimberk), zakládá ho `server.yml` přes
  Hetzner API ze šablony `server/cloud-init.yaml` (tajemství dosazená
  při založení). **Zvenku nemá otevřený žádný port** (firewall
  `perpyx-zavreno` bez příchozích pravidel), nikdo se na něj
  nepřihlašuje; SSH klíč se vyrobí jen kvůli e-mailu s heslem a zahodí.
  **Kód si stahuje z GitHubu každé 3 minuty sám** (systemd timer)
  a při změně `server/` nebo `js/alarmy-logika.js` restartuje službu —
  běžné změny hlídače tedy workflow nepotřebují. Po změně tajemství:
  spustit `server.yml` ručně se „znovu".
- **Stav hlídače bez přihlašování:** hlídač při každé obnově posílá
  `info` (stream, počet alarmů, poslední výsledek u Firebase) →
  `watcher_status`; číst jde `GET /api/watcher/status` s WATCHER_TOKEN.
  ⚠ Chyby FCM chodí jako víceřádkový JSON a zpráva („registration
  token…") stojí **před** kódem — rozpoznávat parsováním, ne regulárním
  výrazem přes text (první verze tak neplatné tokeny nemazala).
- **Tajemství:** `WATCHER_TOKEN` (hlídač ↔ perpyx.com; web.yml ho dá
  webu), `FCM_SERVICE_ACCOUNT` (jen na server, přes cloud-init),
  `GOOGLE_SERVICES_JSON` (do APK), `HCLOUD_TOKEN` (zakládání serveru).
- **Aplikace** (`js/alarmy-server.js`, `js/push.js`): po přihlášení
  povolí push (nativní `@capacitor/push-notifications`, kanál `alarms`
  s nejvyšší důležitostí), token pošle na účet; alarmy odesílá po každé
  změně (odklad 2 s), stav (co zaznělo) stahuje při návratu do aplikace
  a po push. Jednorázový alarm, který zazněl na serveru **po poslední
  úpravě v telefonu**, se vypne i v telefonu (`oznacZaznelo`, pole
  `zmeneno`); úprava v telefonu po zaznění ho zase zapne.
- ⚠ **Dvojité zvonění:** aplikace na pozadí + server hlídá → telefon
  místně nezvoní (ozve se push). Push do otevřené aplikace (Android ho
  sám nezobrazí) se ozve, jen když tentýž alarm nezazněl v telefonu
  v posledních 5 minutách. Klepnutí na notifikaci otevře graf páru
  **i s otevřenou pozicí** (v0.25.0, `otevriGrafZNotifikace`): dřív se
  otevřel jako z Trhů, bez čar a PnL. Po probuzení / studeném startu
  čeká na odemčení zámku a na první pozice (nejvýš 8 s); otevřený graf
  jiného páru nahradí bez dalšího záznamu v historii. Test:
  `tools/test-notifikace-graf.py`, na starém kódu padá ve 3 bodech.
- Hlídač se počítá za živý, když se ozval v posledních 3 minutách; jinak
  telefon hlídá i na pozadí sám a nastavení to přizná.
- Odhlášení i smazání účtu nejdřív odebere telefon z push.
- APK: `google-services.json` z tajemství, jednobarevná ikonka
  `ic_stat_perpyx` (barevné logo by Android ukázal jako bílý čtverec),
  `POST_NOTIFICATIONS`.
- Test celého řetězce **naostro**: `tools/test-alarmy-server.py`
  (aplikace → perpyx.com → hlídač na Hetzneru → Firebase; alarm těsně
  u ceny BTC, vymyšlený token musí Firebase odmítnout a hlídač smazat).

## Audit 2026-09-28: soukromí, disclaimer, klíče

Uživatel nechal projít zásady, disclaimer, podmínky, práci s klíči
a sběr e-mailů. Opraveno v tomto pořadí:

1. ✅ Klíč jen pro čtení se vynucuje (v0.20.1, viz „Bezpečnost klíčů").
2. ✅ **APK nezálohuje data přes Android** (apk.yml, krok „Vypnout
   systémovou zálohu dat"): šablona Capacitoru měla `allowBackup="true"`
   — ověřeno v logu sestavení — a Android by na Disk Google zálohoval
   i úložiště WebView s API klíčem. Teď `allowBackup="false"`,
   `fullBackupContent="false"` a `dataExtractionRules` bez čehokoli
   (Android 12+ jinak přenáší data na nový telefon). Zálohu řeší účet.
3. ✅ **Disclaimer v aplikaci** (v0.20.2): jednorázové upozornění nahoře
   na pozicích (`perpdesk.disclaimerSeen`) a trvale Nastavení → About
   PerpyX s odkazem na zásady; u alarmů dovětek „informativní, mohou
   přijít pozdě nebo vůbec". Na webu samostatný odstavec „Important"
   nad formulářem bety.
4. ✅ **Zásady doplněné:** GitHub Pages (IP adresy při načítání
   aplikace), Bybit jako samostatný správce, předávání do USA u Resendu,
   slib doplnit Hetzner / Google před jejich použitím.
5. ✅ **Podmínky používání** (`web/public/terms.html`, verze 1 pro bezplatnou betu): co PerpyX je a není, jen klíč pro čtení, data a alarmy „as is", účet, přijatelné použití, odpovědnost v mezích zákona (spotřebitelská práva nedotčena), ukončení, změny, české právo. Odkazy z patičky webu, z Nastavení → About a u přihlášení k účtu. ⚠ Před placenou verzí doplnit předplatné a nechat projít odborníkem.
6. ⏳ Automatické mazání seznamu zájemců po 24 měsících a e-mail před
   smazáním neaktivního účtu (slíbeno v zásadách, hoří od září 2027).
7. ⏳ Šifrování klíče v telefonu (Keystore) — checkpoint 9. **Zámek
   aplikace už je** (v0.21.0, níž); šifrování klíče samo zbývá.

### ✅ Zámek aplikace (v0.21.0, 2026-09-29)

**Volitelný** (rozhodnutí uživatele: otisk i zámek jen jako volba).
Nastavení → App lock. Chrání soukromí (kdo drží odemčený telefon, nevidí
pozice), ne peníze — klíč je jen pro čtení.

- Zámek = **PIN 4–6 číslic**; **otisk prstu je volitelná zkratka nad
  PINem** (čtečka selhává — mokrý prst, po restartu chce Android PIN —
  a bez záložní cesty by se uživatel nedostal dovnitř). Otisk se zapne
  až po úspěšném přiložení prstu.
- Zamyká se při startu a po odchodu z aplikace: hned (už při odchodu,
  ať náhled v přehledu aplikací neukazuje obsah), nebo po 1 / 5 / 15 min.
- PIN jen jako **PBKDF2** (sůl, 150 000 iterací). Pět pokusů volně,
  pak čekání 30 s, 60 s, 120 s…
- **Zapomenutý PIN** zruší zámek a **smaže API klíče** — seznamy,
  kresby, alarmy a nastavení zůstanou. Zloděj se ke klíči nedostane.
- Nastavení zámku patří k telefonu: **nezálohuje se** (zaloha.js,
  store.js) ani do cloudu.
- Otisk jen v APK: `@capgo/capacitor-native-biometric` (apk.yml),
  `window.Capacitor.Plugins.NativeBiometric` (`isAvailable`,
  `verifyIdentity`). ⚠ **Výzva k otisku je systémové okno a Android
  kvůli ní může hlásit změnu viditelnosti** — bez pojistky
  (`vyzvaBezi`, 3 s od poslední výzvy) by se výzva po zavření vyvolávala
  dokola. Sama se výzva nabídne jen po skutečném návratu do aplikace.
- Řádek s otiskem se v nastavení ukáže jen tam, kde telefon otisk umí;
  dostupnost se zjišťuje při každém otevření nastavení.
- ⚠ **Zámek musí zakrýt obsah dřív, než naběhne aplikace.** ES moduly
  běží až po vykreslení stránky, takže dashboard na vteřinu problikl
  (v0.21.0, hlášeno z telefonu). Proto malý skript v `<head>`: když je
  zámek zapnutý, přidá `html.zamek-start` — CSS skryje obsah a ukáže
  obrazovku zámku; `zamek.spust()` ji převezme a třídu sundá.
- Otisk je v nastavení vidět vždy, když ho telefon umí; **bez PINu
  zašedlý s vysvětlením** (rozhodnutí uživatele), zapnout nejde.
- Test: `tools/test-zamek.py` (otisk přes podstrčený plugin, měření
  v `readystatechange` „interactive" — to je před spuštěním modulů,
  `DOMContentLoaded` až po nich).

⚠ **`boot()` v app.js musí být úplně na konci souboru.** Ve v0.21.0 byl
v půlce a všechno přidané pod ním (záloha, účet, zámek) se spoléhalo, že
proměnné `let` už existují. Funkce se vytáhnou nahoru samy, proměnné ne:
start spadl na „Cannot access 'rezimZamku' before initialization" —
v telefonu problikla červená lišta. Testy to nechytily, protože chyba
byla v asynchronní funkci (zamítnutý slib) a mock hlídal jen `error`.
**`mock-bybit.js` teď hlídá i `unhandledrejection`** — do `__chyby`
padá obojí.

## Web perpyx.com (2026-09-28)

Úvodní stránka aplikace se sběrem e-mailů zájemců o betu, **anglicky**.
Je to samostatná věc ve složce `web/`, s aplikací nesdílí kód a do GitHub
Pages se nedostane (deploy.yml kopíruje jen `css`, `js`, `icons`, `vendor`).

- `web/public/` — statická stránka (`index.html`, `privacy.html`,
  `style.css`, snímky v `img/`), `_headers` s bezpečnostními hlavičkami
  (CSP bez cizích zdrojů).
- `web/functions/api/signup.js` — Pages Function: `POST /api/signup`
  uloží e-mail do **Cloudflare D1** (`perpyx-web`, tabulka `subscribers`,
  schéma v `web/schema.sql`).
- **Hosting Cloudflare** (Pages + D1, doména u Cloudflare Registrar).
  Zvoleno, aby šlo všechno zakládat a nasazovat odsud bez ručního
  nastavování: `.github/workflows/web.yml` sám založí databázi (v EU,
  `--location weur`), projekt Pages, připojí doménu a DNS záznamy —
  všechno jen pokud ještě neexistuje. Potřebuje jediné tajemství
  `CLOUDFLARE_API_TOKEN` (vlastní token `perpyx-deploy`: Account ·
  Cloudflare Pages · Edit, Workers Scripts · Edit, D1 · Edit; Zone · DNS ·
  Edit, Zone · Read, jen pro zónu perpyx.com). ⚠ Token nikdy do chatu ani
  do repa — uživatel ho zadává sám přes `gh secret set`.
- `web/wrangler.toml` se generuje při nasazení (nese ID databáze) a v repu
  není.
- **Potvrzení e-mailem (double opt-in, v2 2026-09-28):** přihláška je
  `pending`, dokud zájemce neklikne na odkaz z e-mailu (`/confirm?t=…`),
  pak `confirmed`; odhlášení (`/unsubscribe?t=…` i hlavička
  `List-Unsubscribe` jedním klepnutím) → `unsubscribed`. Nepotvrzené
  se po 30 dnech mažou (při každé přihlášce). E-maily posílá **Resend**
  (EU, `hello@perpyx.com`, bez sledování otevření a kliknutí), klíč je
  tajemství `RESEND_API_KEY`; workflow ho předá webu, založí odesílací
  doménu a zapíše její DNS záznamy. ⚠ **Potvrzuje se tlačítkem na stránce
  (POST), ne samotným otevřením odkazu** — poštovní filtry odkazy
  v e-mailech otevírají samy a potvrdily by adresu bez člověka.
- **Po potvrzení** dostane zájemce uvítací e-mail a provozovatel
  upozornění s počtem potvrzených — na `hello@perpyx.com` (přeposílá se
  na jeho Gmail), aby jeho osobní adresa nebyla ve veřejném repu. Jen při
  prvním potvrzení, na pozadí (`waitUntil`).
- **Tabulky se mění migracemi** (`web/migrations/`, `wrangler d1
  migrations apply`), ne přepisováním schématu. `web/uklid.sql` běží při
  každém nasazení (maže zkušební přihlášky na `@test.perpyx.invalid`).
- **Kde jsou e-maily:** Cloudflare → Storage & databases → D1 →
  `perpyx-web` → tabulka `subscribers` (sloupec `status`).
- **Pošta na perpyx.com: Zoho Mail (od 2026-10-01)**, tarif Mail Lite,
  datacentrum EU (zoho.eu). Schránka **roman@perpyx.com** (správce),
  aliasy **hello@** a **privacy@** (zobrazené jméno „PerpyX“). Web
  https://mail.zoho.eu, správa https://mailadmin.zoho.eu.
  - DNS: MX `mx/mx2/mx3.zoho.eu`, SPF jeden záznam
    `include:_spf.mx.cloudflare.net include:zohomail.eu ~all`, DKIM
    `zmail._domainkey`, DMARC `p=quarantine` beze změny. Zapsané přes
    Cloudflare „Domain Connect“ ze Zoho. Ověřeno: SPF a DKIM pro
    perpyx.com prošly, e-mail v Doručených.
  - Cloudflare **Email Routing (přeposílání do Gmailu) je vypnutý** —
    jeho MX nahradilo Zoho.
  - **Resend** (kódy, potvrzení, hlášení) jede dál přes `send.perpyx.com`
    a `resend._domainkey`, Zoho se ho netýká. Hlášení z aplikace a
    upozornění na nové zájemce chodí na hello@ — teď tedy do Zoho.
  - Zoho je v zásadách ochrany soukromí jako zpracovatel.
- ⚠ **Whalebone blokuje perpyx.com jako „Malware“** (2026-10-01, plané
  poplašení; DNS ochrana poskytovatelů, mj. INFOS Art u uživatele doma).
  Blokovací stránka má certifikát whalebone.io → v prohlížeči
  `ERR_CERT_COMMON_NAME_INVALID`; HSTS výjimku nepustí. Doma pak nejde
  ani web, ani `perpyx.com/api` v aplikaci (přihlášení, záloha, alarmy
  na server). Google Safe Browsing, Sucuri i Cloudflare security DNS
  čisté. Nahlášeno 2026-10-01 na vysla@infos.cz a
  domain-report@whalebone.io. Ověření: `nslookup perpyx.com` z domácí
  sítě — `95.179.149.165` = blokace, `188.114.9x.x` = Cloudflare (OK).
  ✅ **Vyřešeno 2026-10-02:** Whalebone doménu odebral z databáze hrozeb
  (ticket 56899), z domácí sítě ověřeno — vede na Cloudflare. Kdyby se
  to opakovalo, stačí znovu napsat na domain-report@whalebone.io.

**Ochrana soukromí je součást návrhu, ne dodatek:** stránka nenačítá nic
cizího (žádná písma z Google, analytika, skripty), takže nepotřebuje lištu
s cookies. Ukládá se **jen e-mail, časy a token** — žádná IP adresa ani
země. Duplicitní přihláška projde tiše, aby z odpovědi nešlo poznat, kdo
na seznamu je. Proti robotům skryté pole (honeypot) a kontrola `Origin`.
Souhlas je nezaškrtnutý checkbox s odkazem na `/privacy`.

**Obsah webu aktualizován 2026-10-01** (před rozesíláním odkazu na
betu): 9 funkcí (push alarmy, seznamy a kategorie, historie, záloha,
vrstvy), galerie 3 + 2 snímky (nově Trhy se seznamy a okno alarmu),
bezpečnost (vynucené read-only, server alarmů bez klíčů, zámek), plán
(burzy, divergence, skener, Google Play). ⚠ **Zásady ochrany soukromí
doplněny o Hetzner a Firebase** a sekci „Price alerts" — slibovaly to
„před spuštěním" a alarmy přitom už dva dny běžely. Podmínky v1.1: účet
je povinný. Při další serverové funkci zásady upravit **předem**.

**Snímky aplikace** vyrábí `tools/snimky-web.py` (od 2026-10-01 s
podstrčeným účtem, kategoriemi z perpyx.com, dvěma seznamy, alarmem
a „živým" hlídačem — jinak by vyfotil přihlašovací obrazovku): veřejná data (svíčky,
trhy) jdou ze skutečného Bybitu, pozice a účet jsou vymyšlené kolem
aktuálních cen — žádný klíč, nic ze skutečného účtu. Úrovně pozice
a kresby na BTC se rozmístí podle posledních svíček, aby byly v grafu
vidět. ⚠ Knihovna grafu píše písmem „Helvetica Neue", které na Windows
spadne na patkové; skript ho přesměruje na Roboto/Segoe UI (jen pro
snímky, v telefonu to nevadí).

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

## Výkon — jak měřit a co už je vyřešené

**Nástroj:** `tools/mereni-vykonu.py` spustí aplikaci se živým provozem jako
od Bybitu (ticker každých 100 ms pro čtyři pozice, u grafu živá svíčka po
250 ms), zpomalí procesor 4× (blíž telefonu než počítači) a ve třech
scénářích (přehled, interakce, otevřený graf) změří vzorkovacím profilerem
**vlastní čas funkcí a souborů**, metriky prohlížeče (skripty, styly,
rozvržení), **dlouhé úlohy > 50 ms** (ty uživatel cítí jako zaseknutí),
počet překreslení seznamu a doby interakcí. Výsledek jde i do
`%TEMP%/perpyx-vykon.json`, aby šlo porovnat měření před změnou a po ní.
**Před optimalizací změř, po ní změř znovu.**

⚠ Měří se v headless Chrome na počítači se zpomalením, ne na telefonu.
Poměry mezi částmi sedí, absolutní čísla jsou orientační. Doba přepnutí
na 1h obsahuje umělé zdržení 700 ms z mocku.

**První měření (2026-09-28, v0.17.5) a oprava (v0.17.6):**

| | před | po |
|---|---|---|
| přehled pozic: vytížení hlavního vlákna | 80 % | 18 % |
| přehled pozic: dlouhé úlohy za 10 s | 74× | 0× |
| otevřený graf: vytížení | 78 % | 15 % |
| otevřený graf: dlouhé úlohy za 10 s | 98× | 0× |
| otevření grafu | 944 ms | 669 ms |

Dvě příčiny, obě snadno přehlédnutelné:

1. ⚠ **`číslo.toLocaleString(jazyk, volby)` staví při každém volání nový
   `Intl.NumberFormat`** — a to je drahé. Formátování čísel (`format.js`)
   zabíralo přes polovinu času hlavního vlákna. Formátovače se teď
   vyrábějí jednou a drží v mapě podle jazyka a počtu desetinných míst;
   totéž cenovky na ose (`cenaSPresnosti`) a čas u kříže (`formatCas`).
   **Nový kód nesmí volat `toLocaleString` s volbami v ničem, co běží při
   každém ticku.**
2. ⚠ **Seznam pozic se celý stavěl znovu při každém ticku** — desetkrát za
   vteřinu, a to i pod otevřeným grafem, kde vůbec není vidět. Teď nejvýš
   jednou za 250 ms (`naplanujVykresleniPozic`), a když seznam není vidět,
   jen se poznamená a dokreslí při návratu (`dokresliSeznamJeLiZastaraly`
   po zavření grafu, přepnutí záložky a návratu z nastavení). Akce
   uživatele (řazení, filtr, skrytí částek) kreslí hned. Hlídání alarmů
   a zásahu SL/TP běží dál s každým tickem — omezuje se jen kreslení.

**Co zbývá, až bude potřeba:** otevření grafu (~0,7 s při 4× zpomalení,
většinou vnitřek knihovny grafu — přepočet indikátorů a první vykreslení
300 svíček) a pár dlouhých úloh při interakcích (nejdelší ~230 ms). Karta
pozice se pořád staví celá znovu místo úpravy jen změněných čísel; při
čtyřech překresleních za vteřinu to už nevadí, ale je to další rezerva.

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

## Rychlý start (v0.34.0, 2026-10-07)

Uživatel hlásil, že se start zpomalil a „vypadá divně". Měření:
`tools/mereni-startu.py` (CPU 4×, síť 150 ms, Bybit +250 ms, druhé
načtení přes service worker; vypíše časovou osu, soubory, dotazy na burzu,
dlouhé úlohy a vlastní čas skriptů). Skripty samy start nebrzdily
(žádná dlouhá úloha); zdržovala **síť v řadě za sebou**:

1. **index.html vždy ze sítě** a ~25 souborů znovu na pozadí → teď vše
   z cache verze (viz Verzování výš).
2. **Čas serveru před pozicemi** — `/v5/market/time` a teprve pak
   `/v5/position/list`, a znovu před každým 30s obnovením. Teď se čas
   měří souběžně s prvním dotazem a jen když je starší než 10 min;
   na 10002 se změří a dotaz zopakuje (`signedGet`).
3. **Prázdná obrazovka, pak vše naráz, přehled účtu ještě později**
   (stránka poskakovala). Teď se poslední známé pozice, přehled účtu
   a příkazy ukládají (`perpdesk.startSnimek`, nejvýš jednou za 20 s)
   a při startu se ukážou hned, **ztlumené** (`.zastarale`), dokud
   nedorazí čerstvá data. Snímek je starý nejvýš 7 dní; nezálohuje se,
   nespouští cloudovou zálohu (`BEZ_ZALOHY` ve store.js) a odhlášení
   ho smaže. Obrysy karet zůstaly jen pro úplně první start.

Výsledek měření: pozice vidět za ~0,33 s místo ~0,68 s (a bez obrysů),
čerstvá data o jednu cestu na burzu dřív. Test:
`tools/test-start-a-zpet.py` (obrysy při prvním startu, snímek při dalším).

## Diagnostika v aplikaci

⚠ **Prvních 6 s načítání jsou jen tiché obrysy karet** (`ui.showLoading()`,
v0.24.1), žádný text, tlačítko ani diagnostika. Běžný start trvá zlomek
vteřiny a „Loading positions… / Try again" s diagnostikou jen probleskly
a vypadaly jako chyba (hlášeno z telefonu). Diagnostika se ukáže, až když
data nejdou déle (`DIAGNOSTIKA_PO` v app.js). Test: `tools/test-start-a-zpet.py`.

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
