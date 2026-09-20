/**
 * Čeština. Klíče musí odpovídat `en.js`; co tu chybí, vezme se anglicky.
 */
export const cs = {
  /* ---------- kostra aplikace ---------- */
  'app.description': 'Sledování otevřených pozic na Bybitu',
  'update.available': 'Nová verze – načíst',
  'update.reload': 'Načíst',

  'action.hideAmounts': 'Skrýt částky',
  'action.refresh': 'Obnovit',
  'action.settings': 'Nastavení',
  'action.close': 'Zavřít',
  'action.back': 'Zpět na pozice',
  'action.openSettings': 'Otevřít nastavení',

  /* ---------- stav spojení ---------- */
  'status.idle': 'Nepřipojeno',
  'status.connecting': 'Připojuji…',
  'status.reconnecting': 'Obnovuji spojení…',
  'status.live': 'Živě',
  'status.error': 'Chyba spojení',
  'status.updated': 'aktualizace {time}',

  /* ---------- pozice ---------- */
  'positions.unrealisedPnl': 'Nerealizované PnL',
  'positions.count': 'Pozic',
  'positions.loading': 'Načítám pozice…',
  'positions.none': 'Žádné otevřené pozice.',
  'positions.failed': 'Pozice se nepodařilo načíst.',
  'positions.noKeys': 'Nejdřív zadej read-only API klíč z Bybitu. Uloží se jen do tohoto telefonu.',
  'positions.keysCleared': 'Nejsou uložené žádné klíče.',

  'position.size': 'Velikost',
  'position.entry': 'Vstup',
  'position.mark': 'Mark',
  'position.value': 'Hodnota',
  'position.margin': 'Margin',
  'position.liquidation': 'Likvidace',
  'position.toLiquidation': 'Do likvidace',
  'position.stopLossFull': 'SL celé pozice',
  'position.takeProfitFull': 'TP celé pozice',
  'position.roe': 'ROE',
  'position.priceChange': 'cena',
  'position.change': 'Změna',
  'position.notSet': 'není',
  'position.long': 'LONG',
  'position.short': 'SHORT',

  /* ---------- čáry v grafu ---------- */
  'line.entry': 'Vstup',
  'line.liquidation': 'Likvidace',
  'line.stopLoss': 'SL',
  'line.takeProfit': 'TP',
  'line.takeProfitN': 'TP{n}',
  'line.stopLossN': 'SL{n}',
  'line.withShare': '{label} ({percent} %)',
  'line.limit': 'Limit',

  /* ---------- nástroje grafu ---------- */
  'chart.indicators': 'Indikátory',
  'chart.moreTools': 'Další nástroje',
  'chart.cursor': 'Kurzor',
  'chart.magnet': 'Přichytávat ke svíčkám',
  'chart.eraseDrawings': 'Smazat kresby',
  'chart.confirmEraseAll': 'Smazat všechny kresby u tohoto páru?',

  'interval.1m': '1m',
  'interval.5m': '5m',
  'interval.15m': '15m',
  'interval.1h': '1h',
  'interval.4h': '4h',
  'interval.1d': '1d',
  'interval.1w': '1t',
  'interval.1M': '1M',

  /* ---------- kreslicí nástroje ---------- */
  'tool.segment': 'Trendová čára',
  'tool.rayLine': 'Polopřímka',
  'tool.straightLine': 'Přímka',
  'tool.horizontalStraightLine': 'Vodorovná úroveň',
  'tool.verticalStraightLine': 'Svislá čára',
  'tool.priceLine': 'Cenová čára',
  'tool.priceChannelLine': 'Cenový kanál',
  'tool.parallelStraightLine': 'Rovnoběžky',
  'tool.fibonacciLine': 'Fibonacci',
  'tool.simpleAnnotation': 'Poznámka',

  /* ---------- návody při kreslení ---------- */
  'draw.setPoint': 'Klepnutím urči {n}. bod z {total}',
  'draw.finish': 'Klepnutím dokonči ({n}. z {total})',
  'draw.movePoint': 'Posuň bod a klepnutím potvrď',
  'draw.editHint': 'Klepni na konec čáry, nebo vedle pro konec úprav',
  'draw.cancel': 'Zrušit kreslení',

  /* ---------- indikátory ---------- */
  'indicator.VOL': 'Objem',
  'indicator.RSI': 'RSI',
  'indicator.MACD': 'MACD',
  'indicator.KDJ': 'KDJ',
  'indicator.MA': 'Klouzavý průměr',
  'indicator.EMA': 'EMA',
  'indicator.BOLL': 'Bollinger',
  'indicator.SAR': 'Parabolic SAR',

  /* ---------- nastavení ---------- */
  'settings.title': 'Připojení k Bybitu',
  'settings.hint':
    'Zadej read-only API klíč. Klíč i secret se ukládají pouze do paměti tohoto '
    + 'telefonu, nikam se neodesílají a nejsou v repozitáři. Podpis požadavků se '
    + 'počítá přímo v zařízení.',
  'settings.apiKey': 'API key',
  'settings.apiSecret': 'API secret',
  'settings.apiKeyPlaceholder': 'např. AbCdEf123456',
  'settings.revealSecret': 'Zobrazit secret',
  'settings.save': 'Uložit a připojit',
  'settings.saving': 'Připojuji…',
  'settings.test': 'Vyzkoušet',
  'settings.testing': 'Zkouším…',
  'settings.clear': 'Smazat klíče z telefonu',
  'settings.confirmClear': 'Opravdu smazat API klíče z tohoto telefonu?',
  'settings.cleared': 'Klíče smazány.',
  'settings.fillBoth': 'Vyplň API key i secret.',
  'settings.ok': 'Spojení funguje, klíč je platný.',
  'settings.language': 'Jazyk',

  'settings.helpTitle': 'Jak vytvořit read-only klíč na Bybitu',
  'settings.help1': 'Bybit → profil → API → Create New Key.',
  'settings.help2': 'Zvol System-generated API Keys.',
  'settings.help3': 'Oprávnění: jen pro čtení, zaškrtni Positions (a Orders kvůli grafu).',
  'settings.help4': 'Obchodování a výběry nezaškrtávej.',
  'settings.help5': 'IP omezení nech prázdné — mobilní síť mění IP adresu.',

  /* ---------- chyby Bybitu ---------- */
  'error.badKey': 'Neplatný API klíč nebo podpis. Zkontroluj, že jsi zkopíroval klíč i secret celé a bez mezer.',
  'error.clock': 'Nesedí čas. Zkontroluj v telefonu automatické nastavení data a času.',
  'error.noPermission': 'Klíč nemá oprávnění číst pozice. Vytvoř na Bybitu read-only klíč s právem na Pozice.',
  'error.ipLocked': 'API klíč je omezený na jinou IP adresu. Zruš IP omezení, mobilní síť mění IP.',
  'error.expired': 'API klíč vypršel. Vytvoř na Bybitu nový.',
  'error.bybit': 'Bybit: {message} (kód {code})',
  'error.bybitCode': 'Bybit vrátil chybu {code}.',
  'error.rejected': 'Bybit odmítl klíč{detail}. Zkontroluj, že je klíč platný, aktivní, má oprávnění číst pozice a nemá omezení na IP adresu.',
  'error.rateLimit': 'Příliš mnoho požadavků na Bybit. Zkus to za chvíli.',
  'error.outage': 'Bybit má výpadek (HTTP {status}). Zkus to za chvíli.',
  'error.unexpected': 'Bybit vrátil neočekávanou odpověď (HTTP {status}){detail}.',
  'error.offline': 'Nepodařilo se spojit s Bybitem. Zkontroluj připojení k internetu.',
  'error.noKeys': 'Nejsou uložené API klíče.',
};
