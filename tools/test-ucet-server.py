# -*- coding: utf-8 -*-
"""
Účty na ostrém serveru perpyx.com (web/functions/api/account/*).

Jde proti **skutečnému** nasazení, ne proti mocku — mock by odpověděl
na cokoli (viz „Podstrčená data takovou chybu z principu neodhalí"
v CLAUDE.md). Používá testovací adresu na neexistující doméně
`@test.perpyx.invalid`: server jí kód místo e-mailu vrátí v odpovědi,
ale jen s tajným klíčem AUTH_TEST_KEY (tajemství repozitáře). Testovací
účty se při dalším nasazení smažou (web/uklid.sql).

Spuštění:
    set AUTH_TEST_KEY=…   (nebo soubor s klíčem jako druhý argument)
    python tools/test-ucet-server.py [https://perpyx.com] [soubor_s_klicem]
"""
import json, os, sys, time, urllib.request, urllib.error
sys.stdout.reconfigure(errors='replace')

API = (sys.argv[1] if len(sys.argv) > 1 else 'https://perpyx.com').rstrip('/') + '/api/account'
KLIC = os.environ.get('AUTH_TEST_KEY') or (open(sys.argv[2]).read().strip() if len(sys.argv) > 2 else '')
PUVOD = 'https://noegoncz.github.io'
EMAIL = f'ucet{int(time.time())}@test.perpyx.invalid'
chyby = []


def dotaz(metoda, cesta, telo=None, token=None, test=False, hlavicky=None):
    h = {'Origin': PUVOD, 'Content-Type': 'application/json'}
    if token:
        h['Authorization'] = f'Bearer {token}'
    if test:
        h['X-Test-Key'] = KLIC
    h.update(hlavicky or {})
    data = json.dumps(telo).encode() if telo is not None else None
    r = urllib.request.Request(API + cesta, data=data, method=metoda, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=20) as o:
            return o.status, json.loads(o.read() or b'{}'), dict(o.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}'), dict(e.headers)


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def prihlas():
    s, o, _ = dotaz('POST', '/start', {'email': EMAIL}, test=True)
    kod = o.get('testCode', '')
    s, o, _ = dotaz('POST', '/verify', {'email': EMAIL, 'code': kod, 'device': 'test'})
    return o.get('token')


print('CORS')
r = urllib.request.Request(API + '/me', method='OPTIONS', headers={
    'Origin': PUVOD, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization'})
with urllib.request.urlopen(r, timeout=20) as o:
    over(o.headers.get('Access-Control-Allow-Origin') == PUVOD, 'předběžný dotaz povolí původ aplikace')
    over('Authorization' in (o.headers.get('Access-Control-Allow-Headers') or ''), '… i hlavičku Authorization')
s, o, h = dotaz('GET', '/me', hlavicky={'Origin': 'https://evil.example'})
over('Access-Control-Allow-Origin' not in h, 'cizí původ CORS nedostane')

print('přihlášení')
s, o, _ = dotaz('POST', '/start', {'email': EMAIL})
over(s == 400, 'testovací adresa bez klíče neprojde')
s, o, _ = dotaz('POST', '/start', {'email': EMAIL}, test=True)
kod = o.get('testCode', '')
over(s == 200 and len(kod) == 6, f'kód vydán ({s})')
spatny = '000000' if kod != '000000' else '111111'
s, o, _ = dotaz('POST', '/verify', {'email': EMAIL, 'code': spatny})
over(s == 400 and o.get('error') == 'wrong-code' and o.get('left') == 4, f'špatný kód odmítnut, zbývají 4 pokusy ({o})')
s, o, _ = dotaz('POST', '/verify', {'email': EMAIL, 'code': kod, 'device': 'test'})
token = o.get('token', '')
over(s == 200 and len(token) == 64 and o.get('email') == EMAIL, 'správný kód → relace')
s, o, _ = dotaz('POST', '/verify', {'email': EMAIL, 'code': kod})
over(s == 400 and o.get('error') == 'code-expired', 'kód jde použít jen jednou')

print('záloha')
s, o, _ = dotaz('GET', '/me', token=token)
over(s == 200 and o.get('backup') is None, 'nový účet zálohu nemá')
zaloha = {'aplikace': 'PerpyX', 'typ': 'zaloha', 'verze': 1, 'vytvoreno': '2026-09-28T00:00:00Z',
          'data': {'perpdesk.lists': '{"x":1}', 'perpdesk.apiKey': 'NESMI', 'perpdesk.apiSecret': 'NESMI'}}
s, o, _ = dotaz('PUT', '/backup', zaloha, token=token)
over(s == 200 and o.get('version') == 1, f'první verze uložena ({o})')
s, o, _ = dotaz('GET', '/backup', token=token)
d = o.get('backup', {}).get('data', {})
over(s == 200 and d.get('perpdesk.lists') == '{"x":1}', 'záloha se vrátí')
over('perpdesk.apiKey' not in d and 'perpdesk.apiSecret' not in d, 'server klíče ze zálohy vyhodil')
zaloha['vytvoreno'] = '2026-09-28T01:00:00Z'
s, o, _ = dotaz('PUT', '/backup', zaloha, token=token)
over(o.get('unchanged') is True and o.get('version') == 1, 'stejná data → žádná nová verze')
zaloha['data']['perpdesk.lists'] = '{"x":2}'
s, o, _ = dotaz('PUT', '/backup', zaloha, token=token)
over(o.get('version') == 2, 'změněná data → verze 2')
s, o, _ = dotaz('GET', '/backups', token=token)
over([v['version'] for v in o.get('versions', [])] == [2, 1], 'seznam verzí, nejnovější první')
s, o, _ = dotaz('GET', '/backup?version=1', token=token)
over(o.get('backup', {}).get('data', {}).get('perpdesk.lists') == '{"x":1}', 'starší verze jde načíst')
s, o, _ = dotaz('PUT', '/backup', {'data': {}}, token=token)
over(s == 400, 'cizí JSON odmítnut')

print('aktivita a odhlášení')
s, o, _ = dotaz('POST', '/ping', {'version': 'test'}, token=token)
over(s == 200, 'denní aktivita zapsána')
s, o, _ = dotaz('POST', '/logout', token=token)
s, o, _ = dotaz('GET', '/me', token=token)
over(s == 401, 'po odhlášení token neplatí')
s, o, _ = dotaz('GET', '/me', token='0' * 64)
over(s == 401, 'vymyšlený token neprojde')

print('smazání účtu')
token = prihlas()
s, o, _ = dotaz('GET', '/me', token=token)
over(s == 200 and o.get('backup', {}).get('version') == 2, 'znovu přihlášený vidí svou zálohu')
s, o, _ = dotaz('POST', '/delete', token=token)
over(s == 200, 'účet smazán')
token = prihlas()
s, o, _ = dotaz('GET', '/me', token=token)
over(s == 200 and o.get('backup') is None, 'po smazání je účet prázdný (zálohy pryč)')
dotaz('POST', '/delete', token=token)

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
