/*
 * Společný model burz — „řeč PerpyX" (krok 1 napojení více burz, v0.52.0).
 *
 * Aplikace (graf, Historie, funding, alarmy, Watchlists) pracuje JEN s tímhle
 * tvarem dat. Každá burza má adaptér, který svoje API převede sem; nic jiného
 * nedělá. Nová funkce nad existujícími daty se tak píše jednou a platí pro
 * všechny burzy. Když funkce potřebuje nový druh dat, přidá se sem pole nebo
 * metoda a burzy, které ho neumí, to přiznají ve `schopnostech`
 * (js/burzy/index.js) — aplikace pak danou věc u nich neukáže.
 *
 * Kanonické hodnoty (adaptér na ně převádí, aplikace s jinými nepočítá):
 *  - strana: 'Buy' | 'Sell' (směr pozice i příkazu; long = Buy),
 *  - symbol páru: základ + kotace bez oddělovačů, např. 'JUPUSDT'
 *    (adaptér si drží převod na symbol své burzy — OKX 'JUP-USDT-SWAP',
 *    CCXT 'JUP/USDT:USDT'…),
 *  - čas: milisekundy od epochy (number),
 *  - ceny a množství: number (ne řetězec), chybějící hodnota null.
 *
 * Soubor nesmí sahat na DOM ani na síť — používá ho i kontraktní test.
 */

export const STRANY = ['Buy', 'Sell'];

/**
 * Typy podmíněných příkazů (pole `stopType` u příkazu). Prázdný řetězec =
 * obyčejný příkaz. Názvy převzaté z Bybitu, ostatní burzy na ně převádí.
 */
export const TYPY_STOP = ['', 'TakeProfit', 'StopLoss', 'PartialTakeProfit', 'PartialStopLoss',
  'TrailingStop', 'Stop', 'tpslOrder', 'BidirectionalTpslOrder', 'MmRateClose'];

/*
 * Popis tvarů. Každé pole: [typ, povinné]. Typy: 'cislo', 'cislo?' (number
 * nebo null), 'text', 'strana', 'cas' (ms > 0), 'cas?', 'bool', 'stop'.
 * Pole navíc adaptér přidat smí (aplikace je ignoruje), chybět nesmí.
 */
export const TVARY = {
  /** Otevřená pozice — `onPositions` z adaptéru. */
  pozice: {
    symbol: 'text', side: 'strana', size: 'cislo', entry: 'cislo', mark: 'cislo', pnl: 'cislo',
    liq: 'cislo?', leverage: 'cislo?', value: 'cislo', stopLoss: 'cislo?', takeProfit: 'cislo?',
    openedAt: 'cas?', updatedAt: 'cas',
  },
  /** Otevřený příkaz — `getOpenOrders`, `onOrders`. */
  prikaz: {
    id: 'text', symbol: 'text', side: 'strana', type: 'text', stopType: 'stop',
    price: 'cislo?', trigger: 'cislo?', qty: 'cislo', filled: 'cislo', reduceOnly: 'bool', createdAt: 'cislo',
  },
  /** Uzavírací záznam obchodu — `getClosedTrades`. */
  obchod: {
    id: 'text', symbol: 'text', qty: 'cislo', entry: 'cislo', exit: 'cislo', pnl: 'cislo',
    long: 'bool', closedAt: 'cas',
  },
  /** Jedno plnění příkazu — `getExecutions`. */
  plneni: {
    buy: 'bool', price: 'cislo', qty: 'cislo', time: 'cas', orderId: 'text', execId: 'text',
  },
  /** Svíčka — `getKlines`. */
  svicka: {
    time: 'cas', open: 'cislo', high: 'cislo', low: 'cislo', close: 'cislo', volume: 'cislo',
  },
  /** Řádek trhu — `getTickers`. */
  ticker: {
    symbol: 'text', last: 'cislo', changePct: 'cislo', turnover: 'cislo',
  },
};

/*
 * Metody, které musí mít každý adaptér (kontrolu dělá kontraktní test
 * tools/test-kontrakt-burzy.py). Volitelné jsou podmíněné schopnostmi.
 */
export const METODY = [
  'setCredentials', 'hasCredentials', 'start', 'stop', 'refresh', 'ensureConnected', 'setForeground',
  'getOpenOrders', 'getClosedTrades', 'getExecutions', 'getKlines', 'getTicker', 'getTickers',
  'setKlineSubscription', 'setExtraTickers', 'testCredentials', 'opravneniKlice', 'popisUctu',
];

/**
 * Zkontroluje jeden objekt proti tvaru. Vrací seznam chyb (prázdný = v pořádku).
 * Pro testy a pro ladění nového adaptéru — aplikace ji za běhu nevolá.
 */
export function zkontroluj(tvar, objekt) {
  const popis = TVARY[tvar];
  if (!popis) return [`neznámý tvar ${tvar}`];
  if (!objekt || typeof objekt !== 'object') return [`${tvar}: není objekt`];
  const chyby = [];
  for (const [pole, typ] of Object.entries(popis)) {
    const v = objekt[pole];
    const spatne = (() => {
      switch (typ) {
        case 'cislo': return !(typeof v === 'number' && Number.isFinite(v));
        case 'cislo?': return !(v === null || (typeof v === 'number' && Number.isFinite(v)));
        case 'text': return !(typeof v === 'string' && v.length > 0);
        case 'strana': return !STRANY.includes(v);
        case 'cas': return !(typeof v === 'number' && v > 0);
        case 'cas?': return !(v === null || (typeof v === 'number' && v > 0));
        case 'bool': return typeof v !== 'boolean';
        case 'stop': return !TYPY_STOP.includes(v);
        default: return true;
      }
    })();
    if (spatne) chyby.push(`${tvar}.${pole}: čekám ${typ}, je ${JSON.stringify(v)}`);
  }
  return chyby;
}
