# Úvod a závěr k videím na X

Šablona pro krátká videa z telefonu (2026-10-11): úvod s animovaným logem
(tkané X se poskládá, „PerpyX“, „Your perpetuals, at a glance.“) a závěr
s „Join the beta“ / perpyx.com / „Early testers get serious perks.“

1. `python -m http.server 8078` v této složce, Chrome s portem 9223
   (viz tools/README.md), pak `python render.py` → snímky `uvod/`, `zaver/`
   (30 fps, 1080 × 1164 — rozměr nahrávky z Foldu po oříznutí).
2. Spojení ffmpegem (`winget install Gyan.FFmpeg`): nahrávku oříznout
   o stavovou lištu (56 px nahoře) a panel aplikací (od 1220 px dole),
   začátek bez černé (`blackdetect`), převést na 30 fps a napojit přes
   `xfade` (0,35 s úvod → nahrávka, 0,4 s nahrávka → závěr).

Rozměry jiné nahrávky změř dřív (snímek přes `ffmpeg -ss 6 -frames:v 1`).
**Náhled na X:** X bere jako náhled první snímek videa. Proto se používá
úvod `uvod-nahled` (logo, nápis i podtitul vidět od prvního snímku, jen
jemné přiblížení), ne `uvod` (logo se skládá z tmy → černý náhled).

Hotová videa ani snímky do repa nepatří.

**Pozadí ze záběru aplikace (2026-10-17):** `python render.py "pozadi=pozadi.png&burzy=…&perky=…"`
— snímek z nahrávky (`ffmpeg -ss 30 -i video.mp4 -frames:v 1 -vf crop=1080:1164:0:52 pozadi.png`)
leží za logem ztlumený a lehce rozmazaný; závěr logo poskládá jako úvod.
Nahrávka z rozevřeného Foldu 1080 × 1298: ořez `crop=1080:1164:0:52`.

**Zavřený displej (2026-10-20):** nahrávka 1080 × 2768, ořez
`crop=1080:2508:0:120` (stavová lišta / navigační lišta), šablona bere
výšku z okna → `VYSKA=2508 python render.py "pozadi=pozadi.png&burzy=…"`.
Stopu prstu na konci nahrávky odstřihnout (`trim`).
