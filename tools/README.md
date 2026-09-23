# Testovací nástroje

Nedostanou se do nasazení (workflow kopíruje jen `css`, `js`, `icons`, `vendor`).
Testy jedou proti **falešným odpovědím Bybitu** (`mock-bybit.js`), takže se
nepotřebuje žádný API klíč.

## Spuštění

```bash
python -m http.server 8075                      # v kořeni repa
chrome --headless=new --remote-debugging-port=9223 \
       --user-data-dir=/cesta/k/CISTEMU/profilu --window-size=500,900 about:blank
python tools/test-stejny-timeframe.py http://localhost:8075/index.html
```

⚠ **Profil musí být čistý** (nový `--user-data-dir` při každé sérii). Jednou
zaregistrovaný service worker servíruje zakešované moduly a test pak ukazuje
starý kód.

⚠ **Dlouho běžící prohlížeč sbírá cizí `addScriptToEvaluateOnNewDocument`.**
`Prohlizec()` si vždy vezme první otevřenou kartu (`/json`, první `type:
"page"`), takže dvě různá spuštění testu v téže relaci klidně sdílí jednu
kartu z dřívějška. Registrace vstřikovaného skriptu (`Page.
addScriptToEvaluateOnNewDocument`) se ale nikde neruší — po desítkách
spuštění během jedné dlouhé session se jich nahromadí tolik, že se různé
mocky perou mezi sebou a test začne hlásit chybu, která v aplikaci není
(stalo se: klepnutí na hladinu alarmu po změně rozměrů okna přestalo
fungovat, viníkem nebyla appka, ale zaneřáděná karta). Pomůže jen nová
instance Chromu (nový `--user-data-dir`, jako u service workeru výš) — ne
jen nová stránka ve staré kartě.

## Co je co

| soubor | ověřuje |
|---|---|
| `dotyk.py` | ovladač Chrome přes DevTools Protocol, skutečné dotyky |
| `mock-bybit.js` | podstrčená data, falešné klíče, zachycení instance grafu do `window.__graf` |
| `test-rychle-prepinani.py` | rychlé proklikání timeframů nemaže kresby ani čáry pozice |
| `test-stejny-timeframe.py` | druhé klepnutí na aktivní timeframe nemaže kresby; graf se otevře u posledních svíček |
| `test-spojeni-burza.py` | adresy Bybitu opravdu odpovídají (jde proti skutečné burze, bez klíčů) |
| `test-zive-svicky.py` | živá svíčka z WebSocketu se projeví v grafu (celá cesta burza → knihovna) |
| `test-odolny-start.py` | start přežije stránku bez několika prvků a spustí registraci service workeru |
| `test-probliknuti.py` | kresby při přepnutí timeframu ani na okamžik nezmizí (měří se z plátna) |
| `test-legenda.py` | legenda indikátoru je čitelná, ne surové calcParams |
| `test-zoom-dvema-prsty.py` | zoom dvěma prsty, odskok při zvednutí prstu |
| `test-rsi-nastaveni.py` | typ průměru a zdroj ceny u RSI skutečně mění křivku |
| `test-vyhlazovani.py` | SMA/EMA/SMMA/WMA proti ručně spočítaným hodnotám |
| `test-lista-panely-nastaveni.py` | výška panelu indikátoru, zešednutí závislých voleb |
| `test-alarmy.py` | cenový alarm: zadání křížem, hladina v grafu, zaznění při protnutí, opakování |
| `test-alarm-z-kresby.py` | zvonek u kresby z ní udělá alarm (trendová → čára, vodorovná → hladina, svislá → čas) |
| `test-preloseni-foldu.py` | stav appky (pár, interval, zoom) i mřížka karty pozice přežijí přeložení Foldu |
| `test-ucet-a-pohodli.py` | přehled účtu, funding, seznam příkazů, řazení/filtr pozic, práh likvidace, volume profile |

⚠ Dotykovým bodům u gest dvěma prsty dávej výslovné `id`, jinak se pohyb
zbylého prstu tváří jako třetí prst a test hlásí odskok, který v aplikaci není.

⚠ Klepnutí posílej **skutečným dotykem** (`Input.dispatchTouchEvent`), ne
syntetickým `PointerEvent` z JavaScriptu. Ten se při výběru hladiny alarmu
občas ztratil a test hlásil chybu, která v aplikaci není.

⚠ Kdo zapisuje alarmy přímo do `localStorage`, musí stránku přenačíst —
`js/alarmy.js` čte úložiště jen jednou za běh.

⚠ **Zapnuté indikátory přežívají v `localStorage` mezi běhy.** Test, který
indikátor zapíná klepnutím, ho při druhém spuštění naopak vypne a ohlásí
chybu, která v aplikaci není — proto na začátku `localStorage.removeItem(
'perpdesk.indicators')`.

⚠ Testovací data musí mít **nezávislé** open a close. Když je `close = open + konstanta`,
dávají všechny zdroje ceny stejné RSI a volba zdroje vypadá, že nefunguje.
