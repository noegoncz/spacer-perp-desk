# -*- coding: utf-8 -*-
"""
Serverový hlídač alarmů (server/hlidac.mjs) proti **skutečnému** streamu
Bybitu, s podstrčeným perpyx.com (malý HTTP server tady v testu).

Alarm na BTCUSDT se položí těsně nad a pod aktuální cenu, takže ho trh
během chvíle protne. Hlídač běží v režimu ZKOUSKA=1 — push neposílá,
jen ho vypíše. Ověřuje se, že:
  * hlídač si stáhne alarmy a přihlásí odběr ceny,
  * při protnutí „pošle" push s českým textem a nahlásí zaznění (fired),
  * jednorázový alarm zazní jen jednou,
  * časový alarm zazní bez ohledu na cenu,
  * alarm účtu bez push tokenu se nehlídá (to řeší už API, tady jen tvar).

Potřebuje Node 22: python tools/test-hlidac.py cesta/k/node[.exe]
"""
import json, os, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
sys.stdout.reconfigure(errors='replace')

NODE = sys.argv[1] if len(sys.argv) > 1 else 'node'
KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = 'testovaci-token'

cena = float(json.load(urllib.request.urlopen(
    'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', timeout=15))['result']['list'][0]['lastPrice'])
print('BTC teď:', cena)
ted = int(time.time() * 1000)
ALARMY = [
    # Nad a pod cenou — jeden z nich trh protne brzo. Jednorázové.
    {'account': 'u1', 'id': 'nad', 'symbol': 'BTCUSDT', 'typ': 'cena', 'price': cena + 1.5, 'smer': 'any',
     'opakovat': False, 'jazyk': 'cs', 'zprava': ''},
    {'account': 'u1', 'id': 'pod', 'symbol': 'BTCUSDT', 'typ': 'cena', 'price': cena - 1.5, 'smer': 'any',
     'opakovat': False, 'jazyk': 'cs', 'zprava': 'Test'},
    {'account': 'u1', 'id': 'cas', 'symbol': 'ETHUSDT', 'typ': 'cas', 'cas': ted + 4000, 'jazyk': 'en', 'zprava': ''},
]
fired = []
dotazy = {'alarms': 0}


class Api(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, d, kod=200):
        b = json.dumps(d).encode()
        self.send_response(kod)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.headers.get('X-Watcher-Token') != TOKEN:
            return self._json({'ok': False}, 403)
        dotazy['alarms'] += 1
        zbyle = [a for a in ALARMY if a['id'] not in {f['id'] for f in fired}]
        self._json({'ok': True, 'alarms': zbyle, 'tokens': {'u1': ['token-zarizeni-1234567890']}})

    def do_POST(self):
        d = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        fired.append(d)
        self._json({'ok': True})


srv = HTTPServer(('127.0.0.1', 8791), Api)
threading.Thread(target=srv.serve_forever, daemon=True).start()

env = dict(os.environ, WATCHER_TOKEN=TOKEN, API='http://127.0.0.1:8791', ZKOUSKA='1')
p = subprocess.Popen([NODE, os.path.join(KOREN, 'server', 'hlidac.mjs')], env=env,
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
vystup = []
threading.Thread(target=lambda: [vystup.append(r) for r in p.stdout], daemon=True).start()

konec = time.time() + 120
while time.time() < konec and len({f['id'] for f in fired} & {'nad', 'pod'}) < 1 or len(fired) < 2 and time.time() < konec:
    time.sleep(1)
time.sleep(20)   # další obnova alarmů — jednorázový už nesmí zaznít znovu
p.terminate()
srv.shutdown()

print(''.join(vystup[-15:]))
chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


ids = [f['id'] for f in fired]
over(any('stream otevřen' in r for r in vystup), 'stream Bybitu otevřen')
over(dotazy['alarms'] >= 2, f'alarmy se stahují opakovaně ({dotazy["alarms"]}×)')
over('cas' in ids, 'časový alarm zazněl')
cenove = [i for i in ids if i in ('nad', 'pod')]
over(len(cenove) >= 1, f'cenový alarm zazněl při protnutí ({cenove})')
over(all(ids.count(i) == 1 for i in set(ids)), f'každý jednorázový alarm zazněl jen jednou ({ids})')
push = [r for r in vystup if 'ZKOUŠKA push' in r]
over(any('dosáhl' in r for r in push), 'text push v češtině podle jazyka alarmu')
over(any('Your time alert is due' in r for r in push), 'časový alarm s anglickým textem')
over(all(f.get('repeat') is False for f in fired), 'zaznění hlášeno jako jednorázové')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
