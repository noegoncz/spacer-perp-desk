/*
 * Podstrčené SOUKROMÉ API Binance USDⓈ-M (v0.59.4) — vkládá se ZA
 * mock-bybit.js. Podepsané dotazy (`signature=` v adrese) na fapi odpoví
 * vymyšlenými daty, veřejná data (trhy, svíčky, ceny) jdou dál na skutečnou
 * burzu. Bez klíče, nic se neposílá ven.
 *
 * Účet: long JUPUSDT 42 @ 0.3084 (jako na snímku uživatele 2026-10-16),
 * jedna limitka a TP/SL ve službě Algo Orders — částečné i „Position
 * TP/SL" (closePosition, množství 0).
 *
 * Řízení z testu:
 *   window.__binanceChyba1021 = n  → n dotazů na příkazy vrátí -1021
 *   window.__binanceDotazy         → seznam cest podepsaných dotazů
 */
(() => {
  const TED = Date.now();
  const json = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data),
    { status, headers: { 'Content-Type': 'application/json' } }));
  const algo = (id, typ, strana, trigger, mnozstvi, cela = false) => ({
    algoId: id, clientAlgoId: `algo${id}`, algoType: 'CONDITIONAL', orderType: typ, symbol: 'JUPUSDT',
    side: strana, positionSide: 'BOTH', timeInForce: 'GTC', quantity: cela ? '0' : String(mnozstvi),
    algoStatus: 'NEW', triggerPrice: String(trigger), price: '0', icebergQuantity: null, selfTradePreventionMode: 'EXPIRE_MAKER',
    workingType: 'CONTRACT_PRICE', priceMatch: 'NONE', closePosition: cela, priceProtect: false, reduceOnly: !cela,
    activatePrice: '', callbackRate: '', createTime: TED - 60e3, updateTime: TED - 60e3, triggerTime: 0, goodTillDate: 0,
  });
  const ALGO = [
    algo(1, 'TAKE_PROFIT_MARKET', 'SELL', '2.0000', 3),
    algo(2, 'TAKE_PROFIT_MARKET', 'SELL', '0.5464', 14),
    algo(3, 'STOP_MARKET', 'SELL', '0.2607', 42),
    algo(4, 'TAKE_PROFIT_MARKET', 'SELL', '1.0000', 0, true),
    algo(5, 'STOP_MARKET', 'SELL', '0.1000', 0, true),
  ];
  const LIMITKA = {
    orderId: 77, symbol: 'JUPUSDT', status: 'NEW', clientOrderId: 'lim', price: '0.2800', avgPrice: '0', origQty: '20',
    executedQty: '0', cumQuote: '0', timeInForce: 'GTC', type: 'LIMIT', reduceOnly: false, closePosition: false,
    side: 'BUY', positionSide: 'BOTH', stopPrice: '0', workingType: 'CONTRACT_PRICE', priceProtect: false,
    origType: 'LIMIT', time: TED - 120e3, updateTime: TED - 120e3,
  };
  const POZICE = {
    symbol: 'JUPUSDT', positionSide: 'BOTH', positionAmt: '42', entryPrice: '0.3084', breakEvenPrice: '0.3085',
    markPrice: '0.3096', unRealizedProfit: '0.05', liquidationPrice: '0.04944', isolatedMargin: '0',
    notional: '13.0', marginAsset: 'USDT', isolatedWallet: '0', initialMargin: '0.87', maintMargin: '0.07',
    positionInitialMargin: '0.87', openOrderInitialMargin: '0', adl: 1, bidNotional: '0', askNotional: '0',
    updateTime: TED - 300e3, leverage: '15', marginType: 'cross',
  };
  window.__binanceDotazy = [];
  const puvodni = window.fetch;
  window.fetch = function (vstup, volby) {
    const u = String(vstup && vstup.url ? vstup.url : vstup);
    if (!/fapi\.binance\.com/.test(u) || !/signature=/.test(u)) return puvodni.call(this, vstup, volby);
    const cesta = new URL(u).pathname;
    window.__binanceDotazy.push(cesta);
    if (/\/(openOrders|openAlgoOrders)$/.test(cesta) && window.__binanceChyba1021 > 0) {
      window.__binanceChyba1021 -= 1;
      return json({ code: -1021, msg: 'Timestamp for this request is outside of the recvWindow.' }, 400);
    }
    if (/positionRisk$/.test(cesta)) return json([POZICE]);
    if (/\/account$/.test(cesta)) {
      return json({
        totalWalletBalance: '100', totalUnrealizedProfit: '0.05', totalMarginBalance: '100.05', availableBalance: '99',
        maxWithdrawAmount: '99', totalInitialMargin: '0.87', totalMaintMargin: '0.07', totalCrossWalletBalance: '100',
        assets: [{ asset: 'USDT', walletBalance: '100', unrealizedProfit: '0.05', marginBalance: '100.05',
          maintMargin: '0.07', initialMargin: '0.87', positionInitialMargin: '0.87', openOrderInitialMargin: '0',
          crossWalletBalance: '100', crossUnPnl: '0.05', availableBalance: '99', maxWithdrawAmount: '99', updateTime: TED }],
        positions: [],
      });
    }
    if (/\/balance$/.test(cesta)) {
      return json([{ accountAlias: 'x', asset: 'USDT', balance: '100', crossWalletBalance: '100', crossUnPnl: '0.05',
        availableBalance: '99', maxWithdrawAmount: '99', marginAvailable: true, updateTime: TED }]);
    }
    if (/\/openOrders$/.test(cesta)) return json(/symbol=/.test(u) && !/symbol=JUPUSDT/.test(u) ? [] : [LIMITKA]);
    if (/\/openAlgoOrders$/.test(cesta)) return json(/symbol=/.test(u) && !/symbol=JUPUSDT/.test(u) ? [] : ALGO);
    if (/leverageBracket$/.test(cesta)) {
      return json([{ symbol: 'JUPUSDT', brackets: [{ bracket: 1, initialLeverage: 50, notionalCap: 5000,
        notionalFloor: 0, maintMarginRatio: 0.01, cum: 0 }] }]);
    }
    if (/\/userTrades$/.test(cesta)) {
      return json(/symbol=JUPUSDT/.test(u) ? [{ symbol: 'JUPUSDT', id: 501, orderId: 900, side: 'BUY', price: '0.3084',
        qty: '42', realizedPnl: '0', quoteQty: '12.95', commission: '0.005', commissionAsset: 'USDT',
        time: TED - 300e3, positionSide: 'BOTH', buyer: true, maker: false }] : []);
    }
    if (/\/income$/.test(cesta)) return json([]);
    if (/positionSide\/dual$/.test(cesta)) return json({ dualSidePosition: false });
    if (/multiAssetsMargin$/.test(cesta)) return json({ multiAssetsMargin: false });
    return json({});
  };
})();
