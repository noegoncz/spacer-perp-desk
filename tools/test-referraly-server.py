# -*- coding: utf-8 -*-
"""
Doporučení (referraly) na ostrém serveru perpyx.com — celá cesta naostro.

  A si zabere přezdívku → web ji zná (/api/ref) → /ref/<přezdívka>
  přesměruje na přihlášku → B se zapíše na webu s ref → B se přihlásí
  v aplikaci stejným e-mailem → spárováno (stupeň 2) → B je aktivní
  3 různé dny → uznáno (stupeň 3). Navíc: obsazená a nepovolená jména,
  zamčení jména po použití, ruční zadání (C), vlastní pozvánka, smazání.

Testovací adresy @test.perpyx.invalid a klíč AUTH_TEST_KEY (jako
tools/test-ucet-server.py); úklid je smaže při dalším nasazení.

Spuštění:
    set AUTH_TEST_KEY=…   (nebo soubor s klíčem jako druhý argument)
    python tools/test-referraly-server.py [https://perpyx.com] [soubor_s_klicem]
"""
import json, os, sys, time, datetime, urllib.request, urllib.error
sys.stdout.reconfigure(errors='replace')

WEB = (sys.argv[1] if len(sys.argv) > 1 else 'https://perpyx.com').rstrip('/')
KLIC = os.environ.get('AUTH_TEST_KEY') or (open(sys.argv[2]).read().strip() if len(sys.argv) > 2 else '')
UA = 'Mozilla/5.0 (Linux; Android 14) PerpyX-test'
APP = 'https://noegoncz.github.io'
T = int(time.time())
chyby = []


def dotaz(metoda, cesta, telo=None, token=None, test=False, puvod=APP):
    h = {'Origin': puvod, 'Content-Type': 'application/json', 'User-Agent': UA}
    if token:
        h['Authorization'] = f'Bearer {token}'
    if test:
        h['X-Test-Key'] = KLIC
    r = urllib.request.Request(WEB + cesta, data=json.dumps(telo).encode() if telo is not None else None,
                               method=metoda, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=20) as o:
            return o.status, json.loads(o.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


def ucet(jmeno):
    email = f'{jmeno}{T}@test.perpyx.invalid'
    s, o = dotaz('POST', '/api/account/start', {'email': email}, test=True)
    s, o = dotaz('POST', '/api/account/verify', {'email': email, 'code': o.get('testCode', ''), 'device': 'test'})
    return email, o.get('token')


print('1) přezdívka')
_, a = ucet('refa')
nick = f'tester{T % 100000}'
s, o = dotaz('GET', '/api/account/referral', token=a)
over(s == 200 and o.get('nick') is None and o.get('counts') == {'invited': 0, 'joined': 0, 'active': 0}, 'nový účet: bez jména, nuly')
over(dotaz('PUT', '/api/account/referral', {'nick': 'ab'}, token=a)[1].get('error') == 'invalid', 'krátké jméno: invalid')
over(dotaz('PUT', '/api/account/referral', {'nick': 'admin'}, token=a)[1].get('error') == 'reserved', 'admin: reserved')
s, o = dotaz('PUT', '/api/account/referral', {'nick': nick.upper()}, token=a)
over(s == 200 and o.get('nick') == nick and o.get('link') == f'https://perpyx.com/ref/{nick}', f'jméno uloženo malými písmeny ({o.get("link")})')
_, c = ucet('refc')
over(dotaz('PUT', '/api/account/referral', {'nick': nick}, token=c)[1].get('error') == 'taken', 'stejné jméno jiný účet: taken')

print('2) web')
s, o = dotaz('GET', f'/api/ref?nick={nick}', puvod='https://perpyx.com')
over(o.get('exists') is True and o.get('nick') == nick, 'web jméno zná')
over(dotaz('GET', '/api/ref?nick=neexistuje-xyz', puvod='https://perpyx.com')[1].get('exists') is False, 'neznámé jméno: neexistuje')


class BezPresmerovani(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


op = urllib.request.build_opener(BezPresmerovani)
try:
    op.open(urllib.request.Request(f'{WEB}/ref/{nick}', headers={'User-Agent': UA}), timeout=20)
    kam = ''
except urllib.error.HTTPError as e:
    kam = e.headers.get('Location', '')
over(f'ref={nick}' in kam and '#' not in kam, f'/ref/{nick} → úvodní stránka nahoře s ref ({kam})')

email_b = f'refb{T}@test.perpyx.invalid'
s, o = dotaz('POST', '/api/signup', {'email': email_b, 'consent': True, 'ref': nick}, puvod='https://perpyx.com')
over(s == 200 and o.get('ok'), 'B se zapsal na webu přes odkaz')
s, o = dotaz('GET', '/api/account/referral', token=a)
maska = o.get('people', [{}])[0].get('email', '')
over(o.get('counts', {}).get('invited') == 1 and maska.startswith('re') and '@' not in maska and set(maska[2:]) <= {'*', '.'},
     f'A vidí B jako „přijal pozvánku", e-mail zamaskovaný ({maska})')
over(dotaz('PUT', '/api/account/referral', {'nick': nick + 'x'}, token=a)[1].get('error') == 'locked', 'použité jméno už změnit nejde')

print('3) aplikace')
_, b = ucet('refb')
o = dotaz('GET', '/api/account/referral', token=a)[1]
over(o.get('counts') == {'invited': 0, 'joined': 1, 'active': 0}, f'B se přihlásil stejným e-mailem → „začal používat" ({o.get("counts")})')
over(dotaz('GET', '/api/account/referral', token=b)[1].get('invitedBy') == nick, 'B vidí, kdo ho pozval')
dnes = datetime.date.today()
# 13 různých dní (s mezerami — po sobě jít nemusí) ještě nestačí, 14. uzná.
dny = [dnes + datetime.timedelta(days=2 * i) for i in range(14)]
for den in dny[:13]:
    dotaz('POST', '/api/account/ping', {'version': 'test', 'day': den.isoformat()}, token=b, test=True)
over(dotaz('GET', '/api/account/referral', token=a)[1].get('counts', {}).get('active') == 0, 'po 13 dnech ještě není uznán')
dotaz('POST', '/api/account/ping', {'version': 'test', 'day': dny[13].isoformat()}, token=b, test=True)
o = dotaz('GET', '/api/account/referral', token=a)[1]
over(o.get('counts') == {'invited': 0, 'joined': 0, 'active': 1}, f'po 14 různých dnech uznán ({o.get("counts")})')

print('4) ruční zadání')
over(dotaz('POST', '/api/account/referral', {'code': 'neexistuje-xyz'}, token=c)[1].get('error') == 'not-found', 'neznámé jméno')
_, d = ucet('refd')
dotaz('PUT', '/api/account/referral', {'nick': f'd{T % 100000}x'}, token=d)
over(dotaz('POST', '/api/account/referral', {'code': f'd{T % 100000}x'}, token=d)[1].get('error') == 'self', 'sám sebe ne')
s, o = dotaz('POST', '/api/account/referral', {'code': nick}, token=c)
over(s == 200 and o.get('invitedBy') == nick and o.get('canEnterCode') is False, 'C zadal jméno A')
over(dotaz('POST', '/api/account/referral', {'code': nick}, token=c)[1].get('error') == 'already', 'podruhé už ne')
over(dotaz('GET', '/api/account/referral', token=a)[1].get('counts', {}).get('joined') == 1, 'A vidí C jako „začal používat"')
over(dotaz('POST', '/api/account/referral', {'code': nick}, token=b)[1].get('error') == 'already', 'B (už spárovaný) jiné jméno nezadá')

print('5) smazání')
dotaz('POST', '/api/account/delete', token=c)
over(dotaz('GET', '/api/account/referral', token=a)[1].get('counts', {}).get('joined') == 0, 'smazaný C z přehledu A zmizí')
dotaz('POST', '/api/account/delete', token=a)
over(dotaz('GET', f'/api/ref?nick={nick}', puvod='https://perpyx.com')[1].get('exists') is False, 'po smazání A jméno přestane platit')
for t in (b, d):
    dotaz('POST', '/api/account/delete', token=t)

print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
