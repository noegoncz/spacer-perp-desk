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
 *   window.__binanceZdrzeniPrikazu → ms, o kolik přijdou příkazy později
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
    if (!(volby && volby.__bezZdrzeni)) window.__binanceDotazy.push(cesta);
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
    if (/\/(openOrders|openAlgoOrders)$/.test(cesta) && window.__binanceZdrzeniPrikazu > 0 && !(volby && volby.__bezZdrzeni)) {
      const zdrzeni = window.__binanceZdrzeniPrikazu;
      return new Promise((ok) => setTimeout(ok, zdrzeni)).then(() => window.fetch(vstup, { ...volby, __bezZdrzeni: true }));
    }
    if (/\/openOrders$/.test(cesta)) return json(/symbol=/.test(u) && !/symbol=JUPUSDT/.test(u) ? [] : [LIMITKA]);
    if (/\/openAlgoOrders$/.test(cesta)) return json(/symbol=/.test(u) && !/symbol=JUPUSDT/.test(u) ? [] : ALGO);
    if (/leverageBracket$/.test(cesta)) {
      return json([{ symbol: 'JUPUSDT', brackets: [{ bracket: 1, initialLeverage: 50, notionalCap: 5000,
        notionalFloor: 0, maintMarginRatio: 0.01, cum: 0 }] }]);
    }
    if (/\/userTrades$/.test(cesta)) {
      // Pozice otevřená před 3 dny (jedno plnění) — od něj se počítá funding.
      const q = new URL(u).searchParams;
      const otevreni = TED - 3 * 864e5;
      const vOkne = !q.get('startTime') || (otevreni >= Number(q.get('startTime')) && otevreni <= Number(q.get('endTime') || Infinity));
      if (/symbol=BTCUSDT/.test(u)) {
        // Uzavřený obchod (v0.59.11): jeden nákup a jeden prodej.
        const od = Number(q.get('startTime') || 0);
        const doKdy = Number(q.get('endTime') || Infinity);
        return json([
          { symbol: 'BTCUSDT', id: 701, orderId: 801, side: 'BUY', price: '80000', qty: '0.01', realizedPnl: '0',
            quoteQty: '800', commission: '0.3', commissionAsset: 'USDT', time: TED - 2 * 864e5, positionSide: 'BOTH', buyer: true, maker: false },
          { symbol: 'BTCUSDT', id: 702, orderId: 802, side: 'SELL', price: '81000', qty: '0.01', realizedPnl: '10',
            quoteQty: '810', commission: '0.3', commissionAsset: 'USDT', time: TED - 864e5, positionSide: 'BOTH', buyer: false, maker: false },
        ].filter((x) => x.time >= od && x.time <= doKdy));
      }
      if (!/symbol=JUPUSDT/.test(u)) return json([]);
      const od = Number(q.get('startTime') || 0);
      const doKdy = Number(q.get('endTime') || Infinity);
      return json([
        // Uzavřený obchod na JUP (v0.59.11): jeden nákup, jeden prodej.
        { symbol: 'JUPUSDT', id: 401, orderId: 851, side: 'BUY', price: '0.3000', qty: '10', realizedPnl: '0',
          quoteQty: '3', commission: '0.001', commissionAsset: 'USDT', time: TED - 5 * 864e5, positionSide: 'BOTH', buyer: true, maker: false },
        { symbol: 'JUPUSDT', id: 402, orderId: 852, side: 'SELL', price: '0.3200', qty: '10', realizedPnl: '0.2',
          quoteQty: '3.2', commission: '0.001', commissionAsset: 'USDT', time: TED - 4 * 864e5, positionSide: 'BOTH', buyer: false, maker: false },
        // Současná pozice.
        { symbol: 'JUPUSDT', id: 501, orderId: 900, side: 'BUY', price: '0.3084',
          qty: '42', realizedPnl: '0', quoteQty: '12.95', commission: '0.005', commissionAsset: 'USDT',
          time: otevreni, positionSide: 'BOTH', buyer: true, maker: false },
      ].filter((x) => !q.get('startTime') || (x.time >= od && x.time <= doKdy)));
    }
    if (/\/income$/.test(cesta)) {
      // Funding po 8 h od otevření (před 3 dny), long platí 0.002 USDT.
      const q = new URL(u).searchParams;
      if (q.get('incomeType') === 'REALIZED_PNL') {
        const od = Number(q.get('startTime') || 0);
        const doKdy = Number(q.get('endTime') || Infinity);
        const zaznamy = [
          { symbol: 'BTCUSDT', incomeType: 'REALIZED_PNL', income: '10', asset: 'USDT', info: '', time: TED - 864e5, tranId: 8001, tradeId: '702' },
          { symbol: 'JUPUSDT', incomeType: 'REALIZED_PNL', income: '0.2', asset: 'USDT', info: '', time: TED - 4 * 864e5, tranId: 8002, tradeId: '402' },
        ];
        return json(zaznamy.filter((x) => x.time >= od && x.time <= doKdy));
      }
      if (q.get('incomeType') !== 'FUNDING_FEE') return json([]);
      window.__binanceIncome = (window.__binanceIncome || []).concat(u.replace(/signature=\w+/, ''));
      const od = Number(q.get('startTime') || 0);
      const doKdy = Number(q.get('endTime') || Infinity);
      const zaznamy = [];
      for (let i = 1; i <= 9; i += 1) {
        const cas = TED - 3 * 864e5 + i * 8 * 3600e3 - 60e3;
        if (cas >= od && cas <= doKdy && cas < TED) {
          zaznamy.push({ symbol: 'JUPUSDT', incomeType: 'FUNDING_FEE', income: '-0.00200000', asset: 'USDT',
            info: 'FUNDING_FEE', time: cas, tranId: 9000 + i, tradeId: '' });
        }
      }
      return json(zaznamy);
    }
    if (/positionSide\/dual$/.test(cesta)) return json({ dualSidePosition: false });
    if (/multiAssetsMargin$/.test(cesta)) return json({ multiAssetsMargin: false });
    return json({});
  };
})();
