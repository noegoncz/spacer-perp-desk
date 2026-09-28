# -*- coding: utf-8 -*-
"""
Kategorie coinů z CoinGecko → web/public/data/kategorie.json.

Běží jednou denně v GitHub Actions (web.yml) a výsledek se servíruje
z https://perpyx.com/data/kategorie.json. Aplikace si stáhne jen tenhle
jeden soubor — telefon se CoinGecka vůbec neptá, takže ho nebrzdí limit
bezplatného API (desítky dotazů za minutu) a nic z něj nikam neodchází.

Soubor je nezávislý na burze: klíčem je **zkratka coinu** (JUP, PEPE),
ne pár. Převod `1000PEPEUSDT` → PEPE dělá aplikace, protože tvar párů
je věc burzy.

Víc coinů se stejnou zkratkou (na CoinGecku je „PEPE" několik) →
bere se ten s největší kapitalizací; na burzách s perpetuály se
obchoduje skoro vždy ten velký. Ruční opravu umí aplikace.

Spuštění:  python web/tools/kategorie.py [cilovy_soubor]
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CIL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(KOREN, 'public', 'data', 'kategorie.json')

# (id na CoinGecku, krátký název pro čip v aplikaci, kolik stránek po 250)
# Vybrané podle toho, jak o trhu mluví tradeři — ne všech ~770 kategorií
# CoinGecka (spousta z nich jsou portfolia fondů nebo „Made in …").
KATEGORIE = [
    ('artificial-intelligence', 'AI', 2),
    ('ai-agents', 'AI Agents', 1),
    ('meme-token', 'Meme', 4),
    ('layer-1', 'L1', 2),
    ('layer-2', 'L2', 1),
    ('layer-0-l0', 'L0', 1),
    ('cross-chain-communication', 'Interop', 1),
    ('identity', 'Identity', 1),
    ('decentralized-finance-defi', 'DeFi', 4),
    ('decentralized-exchange', 'DEX', 2),
    ('decentralized-perpetuals', 'Perps', 1),
    ('privacy', 'Privacy', 1),
    ('real-world-assets-rwa', 'RWA', 2),
    ('depin', 'DePIN', 1),
    ('gaming', 'Gaming', 2),
    ('infrastructure', 'Infra', 2),
    ('zero-knowledge-zk', 'ZK', 1),
    ('oracle', 'Oracle', 1),
    ('exchange-based-tokens', 'Exchange', 1),
    ('liquid-staking', 'Staking', 1),
    ('storage', 'Storage', 1),
    ('non-fungible-tokens-nft', 'NFT', 1),
    ('metaverse', 'Metaverse', 1),
    ('socialfi', 'SocialFi', 1),
    ('prediction-markets', 'Prediction', 1),
    ('payment-solutions', 'Payments', 1),
]

API = 'https://api.coingecko.com/api/v3'
KLIC = os.environ.get('COINGECKO_API_KEY', '')  # nepovinný (Demo klíč)
# Bez klíče pouští CoinGecko jen pár dotazů za minutu; při rychlejším tempu
# padaly odpovědi 429 a každá stála minutu čekání navíc.
MEZERA = 2.5 if KLIC else 13.0


def stahni(cesta):
    hlavicky = {'User-Agent': 'perpyx-kategorie', 'Accept': 'application/json'}
    if KLIC:
        hlavicky['x-cg-demo-api-key'] = KLIC
    for pokus in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + cesta, headers=hlavicky), timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 or e.code >= 500:
                cekej = 65 if e.code == 429 else 15
                print(f'  {e.code}, čekám {cekej} s', flush=True)
                time.sleep(cekej)
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(15)
    raise RuntimeError(f'nepodařilo se stáhnout {cesta}')


coiny = {}  # id → {s, n, cap, k:set}
for index, (kat, nazev, stranek) in enumerate(KATEGORIE):
    pocet = 0
    for strana in range(1, stranek + 1):
        data = stahni(f'/coins/markets?vs_currency=usd&category={kat}&order=market_cap_desc'
                      f'&per_page=250&page={strana}&sparkline=false')
        time.sleep(MEZERA)
        for c in data:
            z = coiny.setdefault(c['id'], {'s': c['symbol'].upper(), 'n': c['name'],
                                           'cap': c.get('market_cap') or 0, 'k': set()})
            z['cap'] = max(z['cap'], c.get('market_cap') or 0)
            z['k'].add(index)
        pocet += len(data)
        if len(data) < 250:
            break
    print(f'{nazev:12} {pocet:5} coinů', flush=True)

# Zkratka → coin s největší kapitalizací.
podle_zkratky = {}
for z in coiny.values():
    s = z['s']
    if s not in podle_zkratky or z['cap'] > podle_zkratky[s]['cap']:
        podle_zkratky[s] = z

vystup = {
    'verze': 1,
    'vytvoreno': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'zdroj': 'CoinGecko',
    'kategorie': [{'id': k, 'nazev': n} for k, n, _ in KATEGORIE],
    # zkratka → [jméno, [indexy kategorií]]
    'coiny': {s: [z['n'], sorted(z['k'])] for s, z in sorted(podle_zkratky.items())},
}
os.makedirs(os.path.dirname(CIL), exist_ok=True)
with open(CIL, 'w', encoding='utf-8') as f:
    json.dump(vystup, f, ensure_ascii=False, separators=(',', ':'))
print(f'{len(vystup["coiny"])} zkratek -> {CIL} ({os.path.getsize(CIL) // 1024} kB)')
