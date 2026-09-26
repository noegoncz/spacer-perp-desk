# -*- coding: utf-8 -*-
"""
Zvonek u vybrané kresby z ní udělá alarm.

Tři tvary, tři druhy alarmu:
  trendová čára  → alarm drží čáru, hlídaná úroveň se mění s časem,
  vodorovná čára → pevná hladina,
  svislá čára    → okamžik v čase.

Kresba přitom musí zmizet — jinak by na stejném místě ležely dvě čáry
a nebylo by poznat, která z nich zvoní.

Kreslí se **skutečnými dotyky**: kříž se posouvá tažením kdekoli po ploše
a klepnutí bod potvrdí, přesně jak to dělá prst na telefonu.
"""
import os, sys, time, json
# Konzole Windows (cp1250) neumí „→“; výpis na tom nesmí padat.
sys.stdout.reconfigure(errors='replace')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()
mock += """
localStorage.removeItem('perpdesk.alarms');
localStorage.removeItem('perpdesk.drawings.JUPUSDT');
// Řízený WebSocket, ať jde poslat cena jako z burzy (viz test-zive-svicky.py).
window.__ws = [];
window.WebSocket = function (url) {
  this.url = url;
  this.readyState = 0;
  this.send = () => {};
  this.close = () => { this.readyState = 3; };
  window.__ws.push(this);
  setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 60);
};
window.WebSocket.OPEN = 1;
window.__zprava = (topic, data) => {
  window.__ws.forEach((s) => { if (s.onmessage) s.onmessage({ data: JSON.stringify({ topic, data }) }); });
};
navigator.vibrate = () => { window.__vibrace = (window.__vibrace || 0) + 1; return true; };
"""

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
p.prikaz('Network.enable')
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(4)


def ev(v):
    return p.prikaz('Runtime.evaluate', expression=v,
                    returnByValue=True).get('result', {}).get('value')


def klepni(x, y):
    bod = [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.4)


def plocha():
    return json.loads(ev("""(() => { const r = document.getElementById('drawLayer')
      .getBoundingClientRect(); return JSON.stringify([r.left, r.top, r.width, r.height]); })()"""))


def ulozene():
    return json.loads(ev("localStorage.getItem('perpdesk.alarms')") or '[]')


def kreseb():
    return ev("window.__graf.getOverlays({ groupId: 'kresby' }).length")


def alarmu():
    return ev("window.__graf.getOverlays({ groupId: 'alarmy' }).length")


def nakresli(nastroj, tahy):
    """Zapne nástroj a naklade body: mezi klepnutími se kříž posune tažením."""
    ev("document.querySelector('.tool-btn[data-tool=\"%s\"]').click()" % nastroj)
    time.sleep(0.4)
    left, top, w, h = plocha()
    stred = (left + w / 2, top + h / 2)
    for dx, dy in tahy:
        if dx or dy:
            p.prejed(stred[0], stred[1], stred[0] + dx, stred[1] + dy)
        klepni(*stred)
    time.sleep(0.5)


def alarm_z_vybrane_kresby():
    """Klepnutí na kresbu ji vybere, zvonek v paletě z ní udělá alarm."""
    ev("document.getElementById('styleAlarmBtn').click()")
    time.sleep(0.6)
    otevreno = ev("!document.getElementById('sheetAlarm').hidden")
    ev("document.getElementById('alarmSaveBtn').click()")
    time.sleep(0.5)
    return otevreno


def vyber_kresbu(x, y):
    klepni(x, y)
    return ev("!document.getElementById('stylePanel').hidden")


vysledky = []

# ---- trendová čára → alarm, který drží čáru ----
nakresli('segment', [(0, 0), (90, -60)])
print('kreseb po nakreslení trendové čáry:', kreseb())
left, top, w, h = plocha()
vybrana = vyber_kresbu(left + w / 2 + 45, top + h / 2 - 30)  # střed úsečky
print('kresba vybraná (paleta se ukázala):', vybrana)
otevreno = alarm_z_vybrane_kresby()
a = ulozene()[-1] if ulozene() else {}
print('formulář se otevřel:', otevreno, ' typ alarmu:', a.get('typ'),
      ' bodů:', len(a.get('body') or []))
print('kreseb zbylo:', kreseb(), ' alarmů v grafu:', alarmu())

# Alarm si musí nechat barvu kresby a **její délku** — ne se protáhnout přes
# celý graf, jak to dělala první verze.
vzhled = json.loads(ev("""JSON.stringify((() => {
  const o = window.__graf.getOverlays({ groupId: 'alarmy' })[0];
  return { barva: o.extendData.color, bodu: o.points.length }; })())""") or '{}')
print('barva z kresby:', vzhled.get('barva'), ' bodů v grafu:', vzhled.get('bodu'))
vysledky.append(vybrana and otevreno and a.get('typ') == 'cara'
                and len(a.get('body') or []) == 2 and kreseb() == 0 and alarmu() == 1
                and bool(vzhled.get('barva')) and vzhled.get('bodu') == 2)
print()

# ---- za koncem čáry alarm mlčí a sám se vypne ----
# Čára se kreslila doprostřed grafu, takže oba její body leží v minulosti:
# hlídat už nemá co. Cena přes její úroveň tedy nesmí nic spustit.
uroven = (a.get('body') or [{}])[-1].get('value')
vibrace_pred = ev("window.__vibrace") or 0
for cena in (round(uroven - 0.01, 5), round(uroven + 0.01, 5)):
    t_svicky = ev("window.__graf.getDataList().slice(-1)[0].timestamp")
    ev("""window.__zprava('kline.240.JUPUSDT', [{ start: %d, open: '%s', high: '%s',
      low: '%s', close: '%s', volume: '10', confirm: false }])"""
       % (t_svicky, cena, cena, cena, cena))
    time.sleep(0.6)
po = [x for x in ulozene() if x.get('typ') == 'cara'][0]
zvonilo = (ev("window.__vibrace") or 0) - vibrace_pred
print('cena protla úroveň doběhlé čáry → zaznění:', zvonilo, '(má být 0)')
print('doběhlá čára se sama vypnula:', po.get('aktivni') is False)
vysledky.append(zvonilo == 0 and po.get('aktivni') is False)
print()

# ---- vodorovná čára → pevná hladina ----
nakresli('horizontalStraightLine', [(0, 70)])
left, top, w, h = plocha()
vybrana = vyber_kresbu(left + w / 2, top + h / 2 + 70)
otevreno = alarm_z_vybrane_kresby()
a = ulozene()[-1] if ulozene() else {}
print('vodorovná čára → typ:', a.get('typ'), ' cena:', a.get('price'),
      ' paleta:', vybrana, ' formulář:', otevreno)
print('kreseb zbylo:', kreseb(), ' alarmů v grafu:', alarmu())
vysledky.append(vybrana and otevreno and a.get('typ') == 'cena'
                and (a.get('price') or 0) > 0 and kreseb() == 0 and alarmu() == 2)
print()

# ---- svislá čára → alarm na čas ----
# Svislá čára padne doprostřed grafu, tedy do historie. Aplikace takový alarm
# uložit nesmí a musí to říct hned, ne až po klepnutí na Uložit.
nakresli('verticalStraightLine', [(60, 0)])
left, top, w, h = plocha()
vybrana = vyber_kresbu(left + w / 2 + 60, top + h / 2)
ev("document.getElementById('styleAlarmBtn').click()")
time.sleep(0.6)
otevreno = ev("!document.getElementById('sheetAlarm').hidden")
typVeFormulari = ev("""(() => {
  const r = [...document.querySelectorAll('#alarmBody .nastaveni-radek')]
    .find((x) => x.querySelector('input[type=datetime-local]'));
  return r ? r.querySelector('.nastaveni-popisek').textContent : ''; })()""")
varovani = (ev("document.getElementById('alarmNote').textContent") or '').splitlines()[0]
pred = len(ulozene())
ev("document.getElementById('alarmSaveBtn').click()")
time.sleep(0.4)
odmitnuto = len(ulozene()) == pred
print('svislá čára → pole ve formuláři:', typVeFormulari or '(žádné)',
      ' paleta:', vybrana, ' formulář:', otevreno)
print('varování hned po otevření:', varovani)
print('čas v minulosti se neuložil:', odmitnuto)

# Po posunu času do budoucna se uložit musí.
ev("""(() => {
  const pole = document.querySelector('#alarmBody input[type=datetime-local]');
  const zitra = new Date(Date.now() + 86400000);
  const dd = (n) => String(n).padStart(2, '0');
  pole.value = `${zitra.getFullYear()}-${dd(zitra.getMonth() + 1)}-${dd(zitra.getDate())}`
    + `T${dd(zitra.getHours())}:${dd(zitra.getMinutes())}`;
  pole.dispatchEvent(new Event('change', { bubbles: true }));
})()""")
ev("document.getElementById('alarmSaveBtn').click()")
time.sleep(0.5)
a = ulozene()[-1] if ulozene() else {}
print('po posunu na zítra → typ:', a.get('typ'), ' alarmů v grafu:', alarmu())
vysledky.append(vybrana and otevreno and odmitnuto and bool(varovani)
                and a.get('typ') == 'cas' and (a.get('cas') or 0) > time.time() * 1000
                and kreseb() == 0 and alarmu() == 3)
print()

chyby = ev('(window.__chyby||[]).join(" | ")') or ''
print('chyby v konzoli:', chyby or '(žádné)')
print()
print('VÝSLEDEK:', 'KRESBY SE MĚNÍ V ALARMY' if all(vysledky) and not chyby
      else '!!! PŘEVOD KRESBY NA ALARM MÁ CHYBU %s' % vysledky)
