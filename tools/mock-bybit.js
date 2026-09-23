// Service worker v testu jen překáží: servíruje zakešované moduly,
// takže by se změny v kódu vůbec neprojevily.
if (navigator.serviceWorker) {
  navigator.serviceWorker.register = () => Promise.reject(new Error('test'));
  navigator.serviceWorker.getRegistrations().then(
    (r) => r.forEach((x) => x.unregister())).catch(() => {});
}
if (window.caches) caches.keys().then((k) => k.forEach((n) => caches.delete(n))).catch(() => {});

window.__chyby = [];
window.addEventListener('error', (e) => window.__chyby.push('error: ' + e.message));
localStorage.setItem('perpdesk.apiKey','FAKEKEY1234567890ab');
localStorage.setItem('perpdesk.apiSecret','FAKESECRET1234567890abcdef');
window.WebSocket = function(){this.readyState=0;this.send=()=>{};this.close=()=>{};};
window.WebSocket.OPEN = 1;
// ⚠ `createdTime` je u Bybitu čas, kdy na páru vznikla pozice POPRVÉ
// v historii — schválně dávno, aby bylo poznat, že se podle něj čas
// otevření brát nesmí. Současnou pozici otevřelo nejstarší plnění níž
// (40 h zpátky), a jen odtud se smí sčítat funding.
const OTEVRENO = Date.now() - 49 * 86400e3;
const pozice = { symbol:'JUPUSDT', side:'Buy', size:'2547', avgPrice:'0.30135',
  markPrice:'0.30580', unrealisedPnl:'11.34', liqPrice:'0.07233', leverage:'10',
  positionValue:'778.87', stopLoss:'0.295', takeProfit:'0.365', positionIdx:0,
  createdTime:String(OTEVRENO) };
const ok = (t) => Promise.resolve(new Response(JSON.stringify(t),
  {status:200, headers:{'Content-Type':'application/json'}}));
window.fetch = function (vstup) {
  const u = String(vstup && vstup.url ? vstup.url : vstup);
  if (u.includes('/v5/market/time'))
    return ok({retCode:0, result:{timeNano:String(Date.now()*1e6)}, time:Date.now()});
  if (u.includes('/v5/position/list')) return ok({retCode:0, result:{list:[pozice]}});
  if (u.includes('/v5/market/kline')) {
    const m = /interval=([^&]+)/.exec(u); const iv = m && decodeURIComponent(m[1]);
    (window.__ivl = window.__ivl || []).push(String(iv));
    const platny = ['1','5','15','60','240','D','W','M'].includes(iv);
    const krok = { '1':60e3,'5':300e3,'15':900e3,'60':3600e3,'240':14400e3,
                   D:86400e3, W:604800e3, M:2592000e3 }[iv] || 14400e3;
    // Časy musí sedět na skutečné hranice svíček, jinak živá svíčka z burzy
    // vyjde „starší" než naše poslední a knihovna ji právem zahodí.
    const l = []; let t = Math.floor(Date.now() / krok) * krok;
    if (platny) for (let i=0;i<300;i++){ const b=0.30+Math.sin(i/9)*0.01;
      l.push([String(t-i*krok),String(b),String(b+0.004),String(b-0.004),
              String(b+0.004*Math.sin(i*2.3)),'900','1']); }
    // hodinovy interval odpovida pomalu, ostatni rychle
    const odpoved = ok({retCode:0, result:{list:l}});
    return iv === '60' ? new Promise((r) => setTimeout(() => r(odpoved), 700)) : odpoved;
  }
  // Prehled uctu (checkpoint 7). window.__bezPenezenky simuluje klic bez
  // opravneni Wallet — Bybit na nej odpovida chybou, ne prazdnym seznamem.
  if (u.includes('/v5/account/wallet-balance')) {
    if (window.__bezPenezenky) return ok({retCode:10005, retMsg:'Permission denied'});
    return ok({retCode:0, result:{list:[{
      totalEquity:'1250.50', totalAvailableBalance:'1130.20',
      totalInitialMargin:'120.30', accountIMRate:'0.0962',
      coin:[{coin:'USDT', equity:'1250.50', availableToWithdraw:'1130.20'}],
    }]}});
  }
  // Funding: sazba i cas dalsiho strzeni.
  if (u.includes('/v5/market/tickers')) {
    return ok({retCode:0, result:{list:[{
      symbol:'JUPUSDT', lastPrice:'0.30580', price24hPcnt:'0.0123',
      turnover24h:'1234567', fundingRate:'0.0001',
      nextFundingTime:String(Date.now() + 3600e3),
    }]}});
  }
  if (u.includes('/v5/market/instruments-info')) {
    return ok({retCode:0, result:{list:[{symbol:'JUPUSDT', fundingInterval:480}]}});
  }
  // Otevrene prikazy — jak pro graf (symbol=), tak pro seznam (settleCoin=).
  if (u.includes('/v5/order/realtime')) {
    return ok({retCode:0, result:{list:[
      {orderId:'o1', symbol:'JUPUSDT', side:'Buy', orderType:'Limit', price:'0.2850',
       qty:'500', cumExecQty:'0', reduceOnly:false, createdTime:String(Date.now()-3600e3)},
      {orderId:'o2', symbol:'JUPUSDT', side:'Sell', orderType:'Market', stopOrderType:'PartialTakeProfit',
       triggerPrice:'0.3400', qty:'1000', cumExecQty:'250', reduceOnly:true,
       createdTime:String(Date.now()-7200e3)},
    ]}});
  }
  // Jednotliva plneni — z nich jsou v grafu trojuhelniky vstupu a vystupu.
  // Dve koupe (vstup do longu) a jeden castecny prodej (vystup).
  if (u.includes('/v5/execution/list')) {
    if (window.__bezPlneni) return ok({retCode:10005, retMsg:'Permission denied'});
    // 1500 + 1300 - 253 = 2547, tedy přesne velikost pozice. Z toho se
    // pozpatku dopocita, ze pozici otevrel nakup pred 40 hodinami.
    const vse = [
      {symbol:'JUPUSDT', side:'Buy', execType:'Trade', execPrice:'0.2990',
       execQty:'1500', execTime:String(Date.now() - 40*3600e3)},
      {symbol:'JUPUSDT', side:'Buy', execType:'Trade', execPrice:'0.3050',
       execQty:'1300', execTime:String(Date.now() - 20*3600e3)},
      {symbol:'JUPUSDT', side:'Sell', execType:'Trade', execPrice:'0.3100',
       execQty:'253', execTime:String(Date.now() - 8*3600e3)},
    ];
    const q = new URL(u, location.origin).searchParams;
    const od = Number(q.get('startTime')) || 0;
    const doKdy = Number(q.get('endTime')) || Date.now();
    return ok({retCode:0, result:{list: vse.filter((e) =>
      Number(e.execTime) >= od && Number(e.execTime) <= doKdy)}});
  }
  // Transakcni denik — z nej se scita zaplaceny funding.
  //
  // Napodobuje omezeni skutecneho Bybitu, protoze prave na nich to
  // na telefonu padalo, zatimco vsemu povolny mock hlasil, ze je vse v poradku:
  //  * startTime a endTime musi prijit SPOLU,
  //  * okno smi byt nejvys 7 dni,
  //  * bez casu se vrati jen poslednich 24 h,
  //  * denik neumi filtrovat na symbol, jen na baseCoin, a strankuje po 50.
  if (u.includes('/v5/account/transaction-log')) {
    const q = new URL(u, location.origin).searchParams;
    const od = Number(q.get('startTime')) || 0;
    const doKdy = Number(q.get('endTime')) || 0;
    if ((od && !doKdy) || (doKdy && !od))
      return ok({retCode:10001, retMsg:'startTime and endTime must be passed together'});
    if (od && doKdy - od > 7*86400e3 + 1000)
      return ok({retCode:10001, retMsg:'the max query range is 7 days'});

    const zacatek = Math.max(od || Date.now() - 86400e3, OTEVRENO);
    const konec = Math.min(doKdy || Date.now(), Date.now());
    const l = [];
    for (let t = Math.ceil(zacatek / (8*3600e3)) * 8*3600e3; t < konec; t += 8*3600e3) {
      // Sud a lich: do deniku pada i jiny par, aby bylo poznat, ze se
      // radky filtruji. Bez baseCoin je jich dvakrat tolik.
      l.push({symbol:'JUPUSDT', type:'SETTLEMENT', currency:'USDT',
              funding:'-0.0620', transactionTime:String(Math.round(t))});
      if (q.get('baseCoin') !== 'JUP') {
        l.push({symbol:'ETHUSDT', type:'SETTLEMENT', currency:'USDT',
                funding:'-9.9900', transactionTime:String(Math.round(t))});
      }
    }
    return ok({retCode:0, result:{list:l.slice(0, 50), nextPageCursor:''}});
  }
  return ok({retCode:0, result:{list:[]}});
};

// Graf si schovame, az ho app.js vyrobi — z venku k nemu jinak neni pristup.
(function cekejNaKnihovnu() {
  if (!window.klinecharts || !window.klinecharts.init) return setTimeout(cekejNaKnihovnu, 50);
  const puvodni = window.klinecharts.init;
  window.klinecharts.init = function (...a) {
    const g = puvodni.apply(this, a);
    window.__graf = g;
    return g;
  };
})();
