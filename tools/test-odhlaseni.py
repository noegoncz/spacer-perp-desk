# -*- coding: utf-8 -*-
"""
Odhlášení smaže data z telefonu, přihlášení je vrátí z cloudu (2026-10-03).

Data dřív v telefonu po odhlášení zůstávala — další přihlášený účet by
viděl API klíč, kresby i alarmy předchozího a zazálohoval by je do svého
cloudu. Teď:

  1. odhlášení nejdřív pošle poslední změny do zálohy, pak z telefonu smaže
     všechno PerpyX kromě jazyka, kategorií coinů a přečteného upozornění,
  2. když záloha selže a uživatel odhlášení zruší, nic se nesmaže,
  3. přihlášení do prázdného telefonu vrátí data z cloudu bez ptaní;
     API klíč ne (v cloudu není).

perpyx.com je podstrčený. Spuštění:
    python tools/test-odhlaseni.py http://localhost:8075/index.html
"""
import os, sys, time, json
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
po = """
(() => {
  const bybit = window.fetch;
  window.__dotazy = JSON.parse(sessionStorage.getItem('__dotazy') || '[]');
  window.__potvrzeni = [];
  window.confirm = (text) => { window.__potvrzeni.push(text); return sessionStorage.getItem('__zrusit') ? false : true; };
  if (!sessionStorage.getItem('__data')) {
    sessionStorage.setItem('__data', '1');
    localStorage.setItem('perpdesk.drawings.JUPUSDT', JSON.stringify([{ name: 'segment', points: [], style: {} }]));
    localStorage.setItem('perpdesk.language', 'en');
    localStorage.setItem('perpdesk.lock', JSON.stringify({ x: 1 }));
  }
  const zaloha = { aplikace: 'PerpyX', typ: 'zaloha', verze: 1, vytvoreno: '2026-10-03T08:00:00Z',
    data: { 'perpdesk.drawings.BTCUSDT': JSON.stringify([{ name: 'segment', points: [], style: {} }]) } };
  window.fetch = async function (vstup, volby = {}) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (!u.startsWith('https://perpyx.com/api/account')) return bybit(vstup, volby);
    const c = u.replace('https://perpyx.com/api/account', '');
    const m = (volby.method || 'GET').toUpperCase();
    window.__dotazy.push(m + ' ' + c);
    sessionStorage.setItem('__dotazy', JSON.stringify(window.__dotazy));
    if (m === 'PUT' && c === '/backup' && sessionStorage.getItem('__zalohaSelze')) {
      return new Response(JSON.stringify({ ok: false, error: 'server-error' }), { status: 500 });
    }
    const odp = {
      '/start': { ok: true },
      '/verify': { ok: true, token: '1'.repeat(64), email: 'druhy@example.com', created: '2026-10-03' },
      '/me': { ok: true, email: 'druhy@example.com', backup: { version: 4, created_at: '2026-10-03T08:00:00Z' } },
      '/backup': m === 'GET' ? { ok: true, backup: zaloha } : { ok: true, version: 5 },
    }[c] || { ok: true };
    return new Response(JSON.stringify(odp), { status: 200 });
  };
})();
"""

p = Prohlizec()
for c in ('Page.enable', 'Runtime.enable', 'Network.enable'):
    p.prikaz(c)
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setDeviceMetricsOverride', width=412, height=880, deviceScaleFactor=1, mobile=True)
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


klice = lambda: sorted(json.loads(ev("JSON.stringify(Object.keys(localStorage).filter(k => k.startsWith('perpdesk.')))") or '[]'))
vidim = lambda i: ev(f"!document.getElementById('{i}').hidden")

p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
pred = klice()
over('perpdesk.apiKey' in pred and 'perpdesk.drawings.JUPUSDT' in pred and 'perpdesk.session' in pred, 'telefon má klíč, kresby a přihlášení')

print('1) záloha selže, uživatel odhlášení zruší')
ev("sessionStorage.setItem('__zalohaSelze', '1'); sessionStorage.setItem('__zrusit', '1')")
ev("document.getElementById('settingsBtn').click()")
time.sleep(0.4)
ev("document.getElementById('accountLogoutBtn').click()")
time.sleep(1.5)
over(len(ev("window.__potvrzeni") or []) == 1, 'zrušeno už u první otázky')
ev("sessionStorage.removeItem('__zrusit')")
# první otázka ano, druhá (záloha selhala) ne
ev("window.confirm = (t) => { window.__potvrzeni.push(t); return window.__potvrzeni.length === 2; }")
ev("document.getElementById('accountLogoutBtn').click()")
time.sleep(2)
over(len(ev("window.__potvrzeni") or []) == 3 and 'could not be saved' in (ev("window.__potvrzeni[2]") or ''), 'záloha selhala → druhá otázka')
over(klice() == pred, 'po zrušení se nic nesmazalo')

print('2) odhlášení se zálohou')
ev("sessionStorage.removeItem('__zalohaSelze'); window.confirm = (t) => { window.__potvrzeni.push(t); return true; }")
ev("window.__potvrzeni = []")
ev("document.getElementById('accountLogoutBtn').click()")
time.sleep(5)
dotazy = ev("window.__dotazy") or []
put = max((i for i, d in enumerate(dotazy) if d == 'PUT /backup'), default=-1)
out = max((i for i, d in enumerate(dotazy) if d == 'POST /logout'), default=-1)
over(put >= 0 and out > put, f'nejdřív záloha, pak odhlášení ({dotazy[-4:]})')
po_odhlaseni = klice()
over(set(po_odhlaseni) <= {'perpdesk.language', 'perpdesk.coinCategories', 'perpdesk.disclaimerSeen'},
     f'z telefonu smazáno vše kromě věcí zařízení ({po_odhlaseni})')
over(vidim('onboarding') and vidim('onbLogin'), 'po odhlášení přihlášení')

print('3) přihlášení jiným účtem do prázdného telefonu')
ev("window.__potvrzeni = []")
ev("document.getElementById('accountEmail').value = 'druhy@example.com'")
ev("document.getElementById('accountSendBtn').click()")
time.sleep(0.8)
ev("(() => { const i = document.getElementById('accountCode'); i.value = '123456'; i.dispatchEvent(new Event('input')); })()")
time.sleep(6)
po_prihlaseni = klice()
over('perpdesk.drawings.BTCUSDT' in po_prihlaseni, f'data z cloudu vrácena ({po_prihlaseni})')
over('perpdesk.drawings.JUPUSDT' not in po_prihlaseni and 'perpdesk.apiKey' not in po_prihlaseni,
     'nic z předchozího účtu, žádný API klíč')
over(not any('backup from' in (x or '') for x in (ev("window.__potvrzeni") or [])), 'obnova bez ptaní')

konzole = ev('(window.__chyby||[]).join(" | ")') or ''
over(not konzole, f'bez chyb v konzoli ({konzole})')
print()
print('VÝSLEDEK:', 'VŠE V POŘÁDKU' if not chyby else f'!!! {len(chyby)} chyb')
