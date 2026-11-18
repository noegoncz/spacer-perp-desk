"""Nahrání složky do R2 přes API Cloudflare, paralelně (workflow archiv-r2.yml).

Klíč objektu = cesta souboru vůči složce (oddělovač /). `wrangler r2
object put` nahrává po jednom (~2 s na soubor) — archiv grafu má ~570
souborů denně a první nahrání zálohy ~13 000.

Prostředí: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
Použití: python nahraj-r2.py <bucket> <složka> [vláken]
"""
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = 'https://api.cloudflare.com/client/v4'


def main():
    bucket, slozka = sys.argv[1], sys.argv[2]
    vlaken = int(sys.argv[3]) if len(sys.argv) > 3 else 16
    token = os.environ['CLOUDFLARE_API_TOKEN']
    ucet = os.environ['CLOUDFLARE_ACCOUNT_ID']
    soubory = []
    for koren, _, jmena in os.walk(slozka):
        for j in jmena:
            cesta = os.path.join(koren, j)
            soubory.append((cesta, os.path.relpath(cesta, slozka).replace(os.sep, '/')))
    soubory.sort(key=lambda x: x[1])

    def nahraj(polozka):
        cesta, klic = polozka
        typ = 'application/gzip' if klic.endswith('.gz') else 'text/plain; charset=utf-8'
        with open(cesta, 'rb') as f:
            data = f.read()
        url = f'{API}/accounts/{ucet}/r2/buckets/{bucket}/objects/{urllib.parse.quote(klic, safe="/~")}'
        chyba = 'neznámá'
        for pokus in range(5):
            try:
                req = urllib.request.Request(url, data=data, method='PUT', headers={
                    'Authorization': f'Bearer {token}', 'Content-Type': typ, 'User-Agent': 'perpyx-archiv'})
                with urllib.request.urlopen(req, timeout=60) as r:
                    if r.status < 300:
                        return None
                    chyba = f'HTTP {r.status}'
            except Exception as e:  # noqa: BLE001 — opakovat, pak nahlásit
                chyba = str(e)
            time.sleep(1 + pokus * 2)
        return f'{klic}: {chyba}'

    zacatek = time.time()
    with ThreadPoolExecutor(vlaken) as ex:
        chyby = [c for c in ex.map(nahraj, soubory) if c]
    print(f'nahráno {len(soubory) - len(chyby)} / {len(soubory)} za {time.time() - zacatek:.0f} s')
    for c in chyby[:20]:
        print('CHYBA', c)
    if chyby or not soubory:
        sys.exit(1)


if __name__ == '__main__':
    main()
