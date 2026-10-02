# -*- coding: utf-8 -*-
"""
Pozvi přátele v aplikaci (js/pozvanky.js), API perpyx.com podstrčené.

  * tlačítko vlevo dole je jen na přehledu pozic (ne v Trzích), stejně
    vysoké jako bublina hlášení vpravo, a jen pro přihlášené,
  * bez přezdívky: výběr jména; obsazené jméno → srozumitelná chyba,
  * s přezdívkou: odkaz perpyx.com/ref/<jméno>, sdílet / kopírovat,
  * tři stupně: počty a seznam se zamaskovanými e-maily,
  * ruční zadání toho, kdo pozval (jen když to server dovolí).

Ostrý server ověřuje tools/test-referraly-server.py.
Spuštění: python tools/test-pozvanky.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const dalsi = window.fetch;
  const stav = { ok: true, nick: null, link: null, counts: { invited: 1, joined: 1, active: 1 },
    people: [ { email: 'p***@gmail.com', stage: 'active' }, { email: 'j***@seznam.cz', stage: 'joined' },
              { email: 'k***@icloud.com', stage: 'invited' } ],
    invitedBy: null, canEnterCode: true, activeDays: 3 };
  window.__pozvanky = [];
  const odp = (d, s = 200) => Promise.resolve(new Response(JSON.stringify(d), { status: s }));
  window.fetch = function (vstup, volby = {}) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (u.endsWith('/api/account/referral')) {
      const m = (volby.method || 'GET').toUpperCase();
      const telo = volby.body ? JSON.parse(volby.body) : {};
      window.__pozvanky.push(m + ' ' + JSON.stringify(telo));
      if (m === 'PUT') {
        if (telo.nick === 'roman') return odp({ ok: false, error: 'taken' }, 409);
        stav.nick = telo.nick; stav.link = 'https://perpyx.com/ref/' + telo.nick;
      }
      if (m === 'POST') {
        if (telo.code !== 'pavel') return odp({ ok: false, error: 'not-found' }, 404);
        stav.invitedBy = 'pavel'; stav.canEnterCode = false;
      }
      return odp(stav);
    }
    return dalsi(vstup, volby);
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=344, height=882, deviceScaleFactor=1, mobile=True)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock + '\n' + po)


def ev(v):
    r = p.prikaz('Runtime.evaluate', expression=v, returnByValue=True)
    if 'exceptionDetails' in r:
        print('  !! výjimka:', r['exceptionDetails'].get('exception', {}).get('description', '')[:200])
        return None
    return r.get('result', {}).get('value')


chyby = []


def over(podminka, popis):
    print(('  ok   ' if podminka else '  CHYBA ') + popis)
    if not podminka:
        chyby.append(popis)


vidim = lambda i: ev(f"(() => {{ const e = document.getElementById('{i}'); return !!e && e.getClientRects().length > 0 && !e.closest('[hidden]'); }})()")

p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
print('1) tlačítko')
over(vidim('inviteBtn'), 'na přehledu pozic je tlačítko Pozvat')
r = json.loads(ev("""(() => { const a = document.getElementById('inviteBtn').getBoundingClientRect();
  const b = document.getElementById('feedbackBtn').getBoundingClientRect();
  return JSON.stringify({ vlevo: a.left, vyska: a.height, vyskaB: b.height, sirka: a.width, sirkaB: b.width, dole: Math.abs(a.bottom - b.bottom) }); })()""") or '{}')
over(r.get('vlevo', 99) < 30 and r.get('vyska') == r.get('vyskaB') and r.get('dole', 9) < 1 and r.get('sirka', 0) > r.get('sirkaB', 0),
     f'vlevo dole, stejně vysoké jako hlášení, širší ({r})')
ev("document.querySelector('.tab[data-tab=watchlist]').click()")
time.sleep(0.6)
over(not vidim('inviteBtn'), 'v Trzích tlačítko není')
ev("document.querySelector('.tab[data-tab=positions]').click()")
time.sleep(0.4)

print('2) jméno pro pozvánky')
ev("document.getElementById('inviteBtn').click()")
time.sleep(0.6)
over(vidim('sheetInvite') and vidim('inviteNickBox') and not vidim('inviteLinkBox'), 'okno otevřené, bez jména výběr jména')
ev("document.getElementById('inviteNickInput').value = 'roman'; document.getElementById('inviteNickSave').click()")
time.sleep(0.5)
over('already taken' in (ev("document.getElementById('inviteMsg').textContent") or ''), 'obsazené jméno: srozumitelná chyba')
ev("document.getElementById('inviteNickInput').value = 'Roman83'; document.getElementById('inviteNickSave').click()")
time.sleep(0.5)
over(ev("document.getElementById('inviteLink').textContent") == 'perpyx.com/ref/roman83', 'odkaz s jménem (malými písmeny)')
over(not vidim('inviteNickBox') and vidim('inviteShare') and vidim('inviteCopyLink') and vidim('inviteCopyCode'), 'sdílet, kopírovat odkaz i kód')

print('3) stupně')
pocty = [ev(f"document.getElementById('{i}').textContent") for i in ('inviteCountInvited', 'inviteCountJoined', 'inviteCountActive')]
over(pocty == ['1', '1', '1'], f'tři počty ({pocty})')
lide = ev("[...document.querySelectorAll('#invitePeople li')].map(l => l.textContent).join(' | ')") or ''
over('p***@gmail.com' in lide and 'Accepted' in lide and 'Signed up' in lide, f'seznam se zamaskovanými e-maily ({lide})')

print('4) kdo mě pozval')
over(vidim('inviteByBox'), 'ruční zadání nabídnuto')
ev("document.getElementById('inviteByInput').value = 'nikdo'; document.getElementById('inviteBySave').click()")
time.sleep(0.5)
over('No one uses' in (ev("document.getElementById('inviteMsg').textContent") or ''), 'neznámé jméno: chyba')
ev("document.getElementById('inviteByInput').value = 'pavel'; document.getElementById('inviteBySave').click()")
time.sleep(0.5)
over(not vidim('inviteByBox') and vidim('invitedBy') and ev("document.getElementById('invitedByNick').textContent") == 'pavel',
     'po zadání: „Invited by pavel", pole zmizí')

print('5) bez účtu')
ev("sessionStorage.setItem('__bezUctu', '1'); localStorage.removeItem('perpdesk.session')")
p.prikaz('Page.reload')
time.sleep(4)
over(not vidim('inviteBtn'), 'nepřihlášený tlačítko nevidí')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
