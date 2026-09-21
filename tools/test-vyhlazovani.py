# -*- coding: utf-8 -*-
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotyk import Prohlizec
p = Prohlizec()
p.prikaz('Page.enable'); p.prikaz('Runtime.enable')
p.prikaz('Page.navigate', url=sys.argv[1]); time.sleep(3)
r = p.prikaz('Runtime.evaluate', awaitPromise=True, returnByValue=True, expression="""
(async () => {
  const { vyhladit } = await import('/js/indikatory.js?x=' + Date.now());
  const zaokr = (a) => a.map(v => v === undefined ? null : Math.round(v * 10000) / 10000);
  const x = [undefined, undefined, 1, 2, 3, 4, 5];
  return JSON.stringify({
    sma:  zaokr(vyhladit(x, 3, 'sma')),
    wma:  zaokr(vyhladit(x, 3, 'wma')),
    ema:  zaokr(vyhladit(x, 3, 'ema')),
    smma: zaokr(vyhladit(x, 3, 'smma')),
    kratka: zaokr(vyhladit([1, 2], 3, 'ema')),
    delka1: zaokr(vyhladit([3, 5, 8], 1, 'wma')),
  });
})()""")
v = json.loads(r['result']['value'])
ocek = {
  'sma':  [None, None, None, None, 2, 3, 4],
  'wma':  [None, None, None, None, 2.3333, 3.3333, 4.3333],
  'ema':  [None, None, None, None, 2, 3, 4],
  'smma': [None, None, None, None, 2, 2.6667, 3.4444],
  'kratka': [None, None],
  'delka1': [3, 5, 8],
}
for k in ocek:
    print('%-7s %-45s %s' % (k, v[k], 'OK' if v[k] == ocek[k] else '!!! ocekavano %s' % ocek[k]))
