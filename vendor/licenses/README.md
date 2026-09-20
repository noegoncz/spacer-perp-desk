# Licence knihoven ve `vendor/`

Knihovna je pod **Apache License 2.0**. Plné znění je v `Apache-2.0.txt`.

| Soubor | Knihovna | Verze | Autor |
|---|---|---|---|
| `../klinecharts.js` | KLineChart | 10.0.3 | lihu |

`NOTICE-klinecharts.txt` je soubor NOTICE dodávaný s KLineChartem. **Uvádí
i TradingView**, protože KLineChart část kódu z jejich Lightweight Charts
přebírá — proto musí být zpřístupněný i on, ne jen jméno autora KLineChartu.

(Samotné Lightweight Charts tu bylo do verze 0.2.2 a pak ho nahradil
KLineChart, který umí kreslení a indikátory.)

## Co to znamená pro placené vydání aplikace

Apache-2.0 **výslovně dovoluje komerční užití**, prodej i šíření v uzavřené
podobě. Aplikaci je tedy možné dát do obchodu a prodávat.

Podmínky, které je potřeba splnit:

1. **Přiložit znění licence.** Proto je `Apache-2.0.txt` v repozitáři a musí
   se dostat i do APK.
2. **Zachovat oznámení o autorství.** Hlavičky `@license` přímo v souborech
   knihoven nemazat a obsah `NOTICE-klinecharts.txt` zpřístupnit uživateli.
3. **Označit vlastní úpravy.** Pokud se soubor knihovny upraví, musí to být
   v něm uvedeno. Zatím se neupravuje nic — knihovny jsou beze změny tak,
   jak přišly z npm.

Apache-2.0 navíc uděluje **licenci k patentům**, což je pro placené vydání
výhoda oproti MIT.

Co licence **neuděluje**: práva k ochranným známkám. Aplikace se tedy nesmí
jmenovat po knihovnách ani používat značku TradingView.

## Až se půjde do obchodu

Do aplikace přidat obrazovku „Použitý otevřený software" s tímto seznamem
a zněním licence. Bez ní by bod 1 a 2 nebyly splněné.

## Proč ne TradingView Advanced Charts

Plná knihovna TradingView (kreslení + přes sto indikátorů, používají ji velké
burzovní aplikace) je sice zdarma, ale **jen pro firmy a veřejné projekty**,
ne pro osobní použití. Navíc je zakázáno mít jakoukoli její část ve veřejném
repozitáři. Pro tento projekt je tedy nepoužitelná — ne technicky, ale
licenčně. Ověřeno 2026-09-20.
