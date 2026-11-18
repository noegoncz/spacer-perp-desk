"""Denní archiv sběru do R2 (workflow archiv-r2.yml, 2026-11-18).

Z jedné nebo víc kopií databáze perpyx-likvidace (SQLite načtené z
`wrangler d1 export`) složí pro každý den zabalené soubory:

    out/den/RRRR-MM-DD/mapa15.jsonl.gz       [coin, hodina, data]   snímky mapy HL po 15 min
    out/den/RRRR-MM-DD/mapa1.jsonl.gz        [coin, hodina, data]   minutové snímky (D1 je drží jen 3 dny)
    out/den/RRRR-MM-DD/zdi.jsonl.gz          [trh, data]            hotové zdi v knize
    out/den/RRRR-MM-DD/likvidovano.jsonl.gz  [coin, data]           proběhlé likvidace CEX + HL

`data` je beze změny tak, jak leží v D1 (formáty: js/likvidace-format.js,
web/functions/api/zdi.js, web/functions/api/likvidovano.js). Je-li stejný
klíč ve víc databázích (záloha + živá), vezme se delší data.

Použití: python archiv.py --db a.sqlite [--db b.sqlite] --dny 2026-11-17,2026-11-16 | --vse  --out dir
"""
import argparse
import datetime as dt
import gzip
import json
import os
import sqlite3

DEN = 86400000


def den_ms(text):
    d = dt.datetime.strptime(text, '%Y-%m-%d').replace(tzinfo=dt.timezone.utc)
    return int(d.timestamp() * 1000)


def text_dne(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%d')


HOD = 3600000


def prvni_radek(data):
    """Jako substr(data, 1, instr(data, char(10))) v /api/likvidace (i s \\n)."""
    i = data.find('\n')
    return data if i < 0 else data[:i + 1]


def zapis(cesta, text):
    os.makedirs(os.path.dirname(cesta), exist_ok=True)
    with open(cesta, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


ZED_MIN = 20 * 60000


def dost_dlouha(radek):
    try:
        z = json.loads(radek)
        return z[3] - z[2] >= ZED_MIN
    except (ValueError, IndexError, TypeError):
        return False


def graf(out, den, soubory, souhrn):
    """Kousky odpovědí pro graf (čte je web, viz web/lib/historie.js).

    graf/mapa/k1/<coin>/<den>  prvky [hodina, data] — jen první snímek hodiny
    graf/mapa/k6/<coin>/<den>  první snímek každé 6. hodiny
    graf/zdi/<burza~PÁR>/<den> prvky [strana, cena, od, do, min, max], jen zdi
                               stojící ≥ 20 min (graf kreslí z historie zdi ≥ 1 h,
                               kousky spojuje přes mezery < 30 min; všechny = 20 MB / den)
    Všechny snímky po 15 min (12 MB / den) se pro graf neukládají — 1h graf
    starší než živá D1 dostane snímek po hodině. Úplná data jsou v den/….
    Obsah = prvky JSON pole oddělené čárkou, bez závorek — web je jen
    přepošle do odpovědi (bez rozbalování, kvůli limitu CPU).
    """
    po_coinech = {}
    for c, h, d in soubory.get('mapa15', []):
        po_coinech.setdefault(c, []).append((h, d))
    n = 0
    for c, radky in po_coinech.items():
        radky.sort()
        js = lambda h, t: json.dumps([h, t], ensure_ascii=False, separators=(',', ':'))
        varianty = {
            'k1': [js(h, prvni_radek(d)) for h, d in radky],
            'k6': [js(h, prvni_radek(d)) for h, d in radky if h % (6 * HOD) == 0],
        }
        for k, prvky in varianty.items():
            if prvky:
                zapis(os.path.join(out, 'graf', 'mapa', k, c, den), ','.join(prvky))
                n += 1
    for k, data in soubory.get('zdi', []):
        prvky = [r for r in data.split('\n') if r.strip() and dost_dlouha(r)]
        if prvky:
            # „binance:BTCUSDT“ → „binance~BTCUSDT“ (dvojtečka v názvu souboru)
            zapis(os.path.join(out, 'graf', 'zdi', k.replace(':', '~'), den), ','.join(prvky))
            n += 1
    souhrn.setdefault(den, {})['graf'] = [n, 0]


def tabulky(con):
    return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', action='append', required=True)
    ap.add_argument('--dny', default='')
    ap.add_argument('--vse', action='store_true')
    ap.add_argument('--out', required=True)
    ap.add_argument('--graf', action='store_true', help='i kousky odpovědí pro graf (graf/…)')
    a = ap.parse_args()

    # klíč → (data); delší vyhrává
    mapa = {15: {}, 1: {}}
    zdi = {}
    likv = {}

    def vloz(slovnik, klic, data):
        if data is None:
            return
        if len(data) > len(slovnik.get(klic, '')):
            slovnik[klic] = data

    for cesta in a.db:
        con = sqlite3.connect(cesta)
        t = tabulky(con)
        if 'liq_hodiny' in t:
            for coin, r, hodina, data in con.execute('SELECT coin, rozliseni, hodina, data FROM liq_hodiny'):
                if r in mapa:
                    vloz(mapa[r], (coin, hodina), data)
        if 'zdi_dny' in t:
            for klic, den, data in con.execute('SELECT klic, den, data FROM zdi_dny'):
                vloz(zdi, (klic, den), data)
        if 'likvidovano_dny' in t:
            for coin, den, data in con.execute('SELECT coin, den, data FROM likvidovano_dny'):
                vloz(likv, (coin, den), data)
        con.close()

    vsechny = set()
    for r in mapa.values():
        vsechny |= {text_dne(h // DEN * DEN) for (_, h) in r}
    vsechny |= {text_dne(d) for (_, d) in zdi}
    vsechny |= {text_dne(d) for (_, d) in likv}
    dny = sorted(vsechny) if a.vse else [d for d in a.dny.split(',') if d]

    # Rozdělit po dnech jednou (dřív se pro každý den třídilo všechno znovu).
    po_dnech = {}
    for r, jmeno in ((15, 'mapa15'), (1, 'mapa1')):
        for (c, h), d in mapa[r].items():
            po_dnech.setdefault(text_dne(h // DEN * DEN), {}).setdefault(jmeno, []).append([c, h, d])
    for (k, dd), d in zdi.items():
        po_dnech.setdefault(text_dne(dd), {}).setdefault('zdi', []).append([k, d])
    for (c, dd), d in likv.items():
        po_dnech.setdefault(text_dne(dd), {}).setdefault('likvidovano', []).append([c, d])

    souhrn = {}
    for den in dny:
        soubory = po_dnech.get(den, {})
        for jmeno in ('mapa15', 'mapa1'):
            soubory.get(jmeno, []).sort(key=lambda x: (x[1], x[0]))
        for jmeno in ('zdi', 'likvidovano'):
            soubory.get(jmeno, []).sort()
        slozka = os.path.join(a.out, 'den', den)
        for jmeno, radky in soubory.items():
            if not radky:
                continue
            os.makedirs(slozka, exist_ok=True)
            cesta = os.path.join(slozka, f'{jmeno}.jsonl.gz')
            with gzip.open(cesta, 'wt', encoding='utf-8', compresslevel=6) as f:
                for r in radky:
                    f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
            souhrn.setdefault(den, {})[jmeno] = [len(radky), os.path.getsize(cesta)]
        if a.graf:
            graf(a.out, den, soubory, souhrn)
    for den, s in souhrn.items():
        print(den, ' '.join(f'{k}:{v[0]}r/{v[1] // 1024}kB' for k, v in s.items()))
    print('dní:', len(souhrn), 'celkem kB:', sum(v[1] for s in souhrn.values() for v in s.values()) // 1024)


if __name__ == '__main__':
    main()
