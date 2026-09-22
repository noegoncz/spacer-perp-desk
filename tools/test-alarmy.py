# -*- coding: utf-8 -*-
"""
Cenové alarmy: zadání, hladina v grafu a zaznění při protnutí.

Jde celou cestou, kterou projde uživatel: zvonek v liště → formulář →
uložení → hladina v grafu → podstrčená cena z burzy → zvuk, vibrace a pruh
v UI. Ověřuje se i to, co se snadno rozbije:

* jednorázový alarm po zaznění zešedne (`aktivni: false`), ale **nezmizí**,
* opakovaný alarm zůstává zapnutý,
* první cena po otevření nic nespustí (není s čím porovnat),
* klepnutí na hladinu v grafu ji otevře k úpravě,
* přepnutí timeframu hladinu neztratí.

Vlastní WebSocket (jako v test-zive-svicky.py), ať jde cena posílat ručně.
"""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec

KOREN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mock = open(os.path.join(KOREN, 'tools', 'mock-bybit.js'), encoding='utf-8').read()

mock += """
window.__ws = [];
window.WebSocket = function (url) {
  this.url = url;
  this.readyState = 0;
  this.odeslano = [];
  this.send = (d) => { this.odeslano.push(d); };
  this.close = () => { this.readyState = 3; };
  window.__ws.push(this);
  setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 60);
};
window.WebSocket.OPEN = 1;
window.__zprava = (topic, data) => {
  window.__ws.forEach((s) => { if (s.onmessage) s.onmessage({ data: JSON.stringify({ topic, data }) }); });
};
// Vibrace a zvuk se v headless prohlížeči nedají slyšet, tak se počítají.
navigator.vibrate = () => { window.__vibrace = (window.__vibrace || 0) + 1; return true; };
window.__pipnuti = 0;
const PuvodniAudio = window.AudioContext;
window.AudioContext = function () {
  const k = new PuvodniAudio();
  const puvodni = k.createOscillator.bind(k);
  k.createOscillator = () => { window.__pipnuti += 1; return puvodni(); };
  return k;
};
localStorage.removeItem('perpdesk.alarms');
"""

p = Prohlizec()
p.prikaz('Page.enable')
p.prikaz('Runtime.enable')
# Bez tohohle umí Chrome servírovat index.html z HTTP cache a test pak měří
# starou stránku bez nových prvků. (Stálo to jeden zmatený běh.)
p.prikaz('Network.enable')
p.prikaz('Network.setCacheDisabled', cacheDisabled=True)
# Na hladinu se klepe **skutečným dotykem**. Syntetický PointerEvent tu byl
# nespolehlivý (občas se ztratil) — přesně ten druh falešného výsledku, kvůli
# kterému se gesta testují přes CDP, ne z JavaScriptu.
p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
p.prikaz('Page.addScriptToEvaluateOnNewDocument', source=mock)
p.prikaz('Page.navigate', url=sys.argv[1])
time.sleep(5)
p.js("document.querySelector('.position').click()")
time.sleep(4)


def ev(v):
    return p.prikaz('Runtime.evaluate', expression=v,
                    returnByValue=True).get('result', {}).get('value')


def hladiny():
    """Hladiny alarmů, jak je vidí knihovna grafu."""
    return json.loads(ev("""JSON.stringify(
      window.__graf.getOverlays({ groupId: 'alarmy' })
        .map((o) => ({ cena: o.points[0].value, ...o.extendData })))""") or '[]')


def ulozene():
    return json.loads(ev("localStorage.getItem('perpdesk.alarms')") or '[]')


def klepni(x, y):
    """Skutečné klepnutí prstem přes DevTools Protocol."""
    bod = [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1, 'id': 1}]
    p.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod)
    time.sleep(0.05)
    p.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
    time.sleep(0.5)


def radek_formulare(popisek):
    """Řádek nastavení podle popisku — pořadí se s typem alarmu mění."""
    return ("""[...document.querySelectorAll('#alarmBody .nastaveni-radek')]
      .find((r) => r.querySelector('.nastaveni-popisek').textContent === '%s')""" % popisek)


def y_hladiny(cena):
    """Kde v okně leží daná cena — kam tedy klepnout na hladinu alarmu."""
    return ev("""(() => {
      const vrstva = document.getElementById('drawLayer').getBoundingClientRect();
      const yy = window.__graf.convertToPixel({ value: %s }, { paneId: 'candle_pane' });
      return vrstva.top + (Array.isArray(yy) ? yy[0].y : yy.y); })()""" % cena)


def posli_cenu(cena):
    """Živá svíčka s danou uzavírací cenou — jako tick z burzy."""
    t = ev("window.__graf.getDataList().slice(-1)[0].timestamp")
    ev("""window.__zprava('kline.240.JUPUSDT', [{ start: %d, open: '%s',
      high: '%s', low: '%s', close: '%s', volume: '10', confirm: false }])"""
       % (t, cena, cena, cena, cena))
    time.sleep(0.6)


cena_ted = ev("window.__graf.getDataList().slice(-1)[0].close")
print('cena v grafu:', cena_ted)

# ---- zadání alarmu přes zvonek v liště ----
# Zvonek nespustí formulář rovnou: nejdřív se hladina ukáže křížem v grafu,
# protože ťukat cenu na klávesnici je na telefonu nejpomalejší cesta.
ev("document.getElementById('alarmBtn').click()")
time.sleep(0.5)
kriz = ev("!!document.querySelector('.draw-layer.kresli')")
stred = ev("""(() => { const r = document.getElementById('drawLayer').getBoundingClientRect();
  return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()""")
klepni(*json.loads(stred))  # klepnutí potvrdí hladinu pod křížem
print('zvonek spustil kříž:', kriz)
otevreno = ev("!document.getElementById('sheetAlarm').hidden")
poli = ev("document.querySelectorAll('#alarmBody .nastaveni-radek').length")
predvyplnena = ev("document.querySelector('#alarmBody input[type=number]').value")
print('formulář otevřen:', otevreno, ' řádků:', poli,
      ' hladina z grafu:', predvyplnena)

# Hladina kousek nad cenou, ať ji jde protnout směrem nahoru.
uroven = round(cena_ted + 0.01, 5)
ev("""(() => { const p = document.querySelector('#alarmBody input[type=number]');
  p.value = '%s'; p.dispatchEvent(new Event('change', { bubbles: true })); })()""" % uroven)
ev("document.getElementById('alarmSaveBtn').click()")
time.sleep(0.6)

zavreno = ev("document.getElementById('sheetAlarm').hidden")
h = hladiny()
print('formulář se zavřel:', zavreno, ' hladin v grafu:', len(h))
print('hladina:', h[0] if h else None)
print('v úložišti:', len(ulozene()), 'alarm(ů)')
print()

# ---- první cena nic nespustí, protnutí ano ----
posli_cenu(round(cena_ted - 0.005, 5))
predcasne = ev("window.__pipnuti") or 0
print('pípnutí po první ceně (má být 0):', predcasne)

posli_cenu(round(uroven + 0.004, 5))
pipnuti = ev("window.__pipnuti") or 0
vibrace = ev("window.__vibrace") or 0
pruh = ev("document.getElementById('errorBar').hidden ? '' : document.getElementById('errorBar').textContent")
print('po protnutí — pípnutí:', pipnuti, ' vibrace:', vibrace)
print('pruh v UI:', pruh or '(nic)')

po = ulozene()[0] if ulozene() else {}
h = hladiny()
print('alarm po zaznění — aktivní:', po.get('aktivni'), ' zůstal v grafu:', len(h) == 1,
      ' šedý:', (h[0].get('aktivni') if h else None) is False)
print()

# ---- klepnutí na hladinu otevře úpravu ----
klepni(200, y_hladiny(uroven))
uprava = ev("!document.getElementById('sheetAlarm').hidden")
nadpis = ev("document.getElementById('alarmTitle').textContent")
radku = ev("document.querySelectorAll('#alarmBody .nastaveni-radek').length")
print('klepnutí na hladinu otevřelo úpravu:', uprava, '—', nadpis,
      '(řádků %s, u uloženého alarmu přibyl přepínač Zapnutý)' % radku)
print()

# ---- opakovaný alarm zůstává zapnutý ----
ev("%s.querySelectorAll('.nastaveni-volba')[1].click()" % radek_formulare('Trigger'))
ev("%s.querySelector('.nastaveni-prepinac').click()" % radek_formulare('Active'))
ev("document.getElementById('alarmSaveBtn').click()")
time.sleep(0.6)
# Tři přechody přes hladinu (dolů, nahoru, dolů) = tři zaznění. Počítají se
# přes vibrace: těch je jedna na zaznění, kdežto tónů má houkačka víc.
pred = ev("window.__vibrace") or 0
posli_cenu(round(uroven - 0.01, 5))
posli_cenu(round(uroven + 0.01, 5))
posli_cenu(round(uroven - 0.01, 5))
opakovany = ulozene()[0] if ulozene() else {}
zaznelo = (ev("window.__vibrace") or 0) - pred
print('opakovaný alarm — zůstal zapnutý:', opakovany.get('aktivni'),
      ' zaznění:', zaznelo, '(mají být 3)')
print()

# ---- přepnutí timeframu hladinu neztratí ----
ev("document.getElementById('sheetBackdrop').click()")
time.sleep(0.3)
ev("document.querySelector('.interval-btn[data-interval=\"15\"]').click()")
time.sleep(2.5)
po_prepnuti = len(hladiny())
print('hladin po přepnutí na 15m:', po_prepnuti)

chyby = ev('(window.__chyby||[]).join(" | ")') or ''
print('chyby v konzoli:', chyby or '(žádné)')
print()

ok = (kriz and otevreno and zavreno and len(ulozene()) == 1 and predcasne == 0
      and pipnuti >= 1 and vibrace >= 1 and pruh
      and po.get('aktivni') is False and opakovany.get('aktivni') is True
      and zaznelo == 3 and uprava and po_prepnuti == 1 and not chyby)
print('VÝSLEDEK:', 'ALARMY FUNGUJÍ' if ok else '!!! ALARMY MAJÍ CHYBU')
