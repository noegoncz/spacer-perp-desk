"""
Ovládá headless Chrome přes DevTools Protocol a posílá SKUTEČNÉ dotykové
události. Syntetické PointerEvent z JavaScriptu obcházejí rozhodování
prohlížeče o gestech, takže by prošly i u rozbitého přejíždění.
"""
import json, socket, base64, os, struct, time, urllib.request


class WS:
    """Minimální WebSocket klient — jen tolik, kolik CDP potřebuje."""

    def __init__(self, url):
        _, _, zbytek = url.partition('://')
        hostport, _, cesta = zbytek.partition('/')
        host, _, port = hostport.partition(':')
        self.s = socket.create_connection((host, int(port or 80)), timeout=20)
        klic = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((
            f'GET /{cesta} HTTP/1.1\r\nHost: {hostport}\r\n'
            'Upgrade: websocket\r\nConnection: Upgrade\r\n'
            f'Sec-WebSocket-Key: {klic}\r\nSec-WebSocket-Version: 13\r\n\r\n'
        ).encode())
        self._buf = b''
        while b'\r\n\r\n' not in self._buf:
            self._buf += self.s.recv(4096)
        self._buf = self._buf.split(b'\r\n\r\n', 1)[1]

    def _cti(self, n):
        while len(self._buf) < n:
            kus = self.s.recv(65536)
            if not kus:
                raise IOError('spojení zavřeno')
            self._buf += kus
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def posli(self, data):
        telo = json.dumps(data).encode()
        maska = os.urandom(4)
        d = len(telo)
        if d < 126:
            hlavicka = struct.pack('!BB', 0x81, 0x80 | d)
        elif d < 1 << 16:
            hlavicka = struct.pack('!BBH', 0x81, 0x80 | 126, d)
        else:
            hlavicka = struct.pack('!BBQ', 0x81, 0x80 | 127, d)
        self.s.sendall(hlavicka + maska
                       + bytes(b ^ maska[i % 4] for i, b in enumerate(telo)))

    def prijmi(self):
        b1, b2 = self._cti(2)
        d = b2 & 0x7F
        if d == 126:
            d = struct.unpack('!H', self._cti(2))[0]
        elif d == 127:
            d = struct.unpack('!Q', self._cti(8))[0]
        return json.loads(self._cti(d))


class Prohlizec:
    def __init__(self, port=9223):
        cil = None
        for _ in range(40):
            try:
                seznam = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json'))
                cil = next((t for t in seznam if t['type'] == 'page'), None)
                if cil:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        if not cil:
            raise SystemExit('Chrome se nepodařilo najít')
        self.ws = WS(cil['webSocketDebuggerUrl'])
        self.id = 0

    def prikaz(self, metoda, **params):
        self.id += 1
        self.ws.posli({'id': self.id, 'method': metoda, 'params': params})
        while True:
            zprava = self.ws.prijmi()
            if zprava.get('id') == self.id:
                if 'error' in zprava:
                    raise RuntimeError(f"{metoda}: {zprava['error']}")
                return zprava.get('result', {})

    def js(self, vyraz):
        v = self.prikaz('Runtime.evaluate', expression=vyraz, returnByValue=True)
        return v.get('result', {}).get('value')

    def prejed(self, x1, y1, x2, y2, kroku=10):
        """Skutečné dotykové gesto, jak ho pošle prst."""
        bod = lambda x, y: [{'x': x, 'y': y, 'radiusX': 12, 'radiusY': 12, 'force': 1}]
        self.prikaz('Input.dispatchTouchEvent', type='touchStart', touchPoints=bod(x1, y1))
        for i in range(1, kroku + 1):
            self.prikaz('Input.dispatchTouchEvent', type='touchMove',
                        touchPoints=bod(x1 + (x2 - x1) * i / kroku,
                                        y1 + (y2 - y1) * i / kroku))
            time.sleep(0.012)
        self.prikaz('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
        time.sleep(0.15)


if __name__ == '__main__':
    import sys
    p = Prohlizec()
    p.prikaz('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
    p.prikaz('Emulation.setEmitTouchEventsForMouse', enabled=False)
    p.prikaz('Page.navigate', url=sys.argv[1])
    time.sleep(3)

    videt = ("['viewPositions','viewWatchlist','viewHistory']"
             ".find(v=>!document.getElementById(v).hidden)||'zadna'")
    print('start:                  ', p.js(videt))

    p.prejed(320, 400, 90, 412);  print('přejetí doleva:         ', p.js(videt))
    p.prejed(320, 400, 90, 412);  print('přejetí doleva:         ', p.js(videt))
    p.prejed(320, 400, 90, 412);  print('doleva na konci:        ', p.js(videt))
    p.prejed(90, 400, 320, 412);  print('přejetí doprava:        ', p.js(videt))
    p.prejed(90, 400, 320, 412);  print('přejetí doprava:        ', p.js(videt))
    p.prejed(90, 400, 320, 412);  print('doprava na začátku:     ', p.js(videt))
    p.prejed(320, 400, 290, 410); print('krátký tah (30 px):     ', p.js(videt))
    p.prejed(320, 300, 340, 600); print('svislý tah:             ', p.js(videt))
    print('lišta ukazuje:          ',
          p.js("(document.querySelector('.tab.active')||{}).dataset?.tab"))
