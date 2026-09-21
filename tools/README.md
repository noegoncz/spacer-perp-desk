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

## Co je co

| soubor | ověřuje |
|---|---|
| `dotyk.py` | ovladač Chrome přes DevTools Protocol, skutečné dotyky |
| `mock-bybit.js` | podstrčená data, falešné klíče, zachycení instance grafu do `window.__graf` |
| `test-rychle-prepinani.py` | rychlé proklikání timeframů nemaže kresby ani čáry pozice |
| `test-stejny-timeframe.py` | druhé klepnutí na aktivní timeframe nemaže kresby; graf se otevře u posledních svíček |
| `test-zoom-dvema-prsty.py` | zoom dvěma prsty, odskok při zvednutí prstu |
| `test-rsi-nastaveni.py` | typ průměru a zdroj ceny u RSI skutečně mění křivku |
| `test-vyhlazovani.py` | SMA/EMA/SMMA/WMA proti ručně spočítaným hodnotám |
| `test-lista-panely-nastaveni.py` | výška panelu indikátoru, zešednutí závislých voleb |

⚠ Dotykovým bodům u gest dvěma prsty dávej výslovné `id`, jinak se pohyb
zbylého prstu tváří jako třetí prst a test hlásí odskok, který v aplikaci není.

⚠ Testovací data musí mít **nezávislé** open a close. Když je `close = open + konstanta`,
dávají všechny zdroje ceny stejné RSI a volba zdroje vypadá, že nefunguje.
