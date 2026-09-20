/**
 * English — the base language. Every user-visible string lives here.
 *
 * Adding a language = copying this file and translating the values.
 * Keys never change; if a key is missing in another language, the English
 * text is used instead.
 */
export const en = {
  /* ---------- app shell ---------- */
  'app.description': 'Monitor your open Bybit positions',
  'update.available': 'New version available',
  'update.reload': 'Reload',

  'action.hideAmounts': 'Hide amounts',
  'action.refresh': 'Refresh',
  'action.settings': 'Settings',
  'action.close': 'Close',
  'action.back': 'Back to positions',
  'action.openSettings': 'Open settings',

  /* ---------- connection status ---------- */
  'status.idle': 'Not connected',
  'status.connecting': 'Connecting…',
  'status.reconnecting': 'Reconnecting…',
  'status.live': 'Live',
  'status.error': 'Connection error',
  'status.updated': 'updated {time}',

  /* ---------- positions ---------- */
  'positions.unrealisedPnl': 'Unrealised PnL',
  'positions.count': 'Positions',
  'positions.loading': 'Loading positions…',
  'positions.none': 'No open positions.',
  'positions.failed': 'Could not load positions.',
  'positions.noKeys': 'Enter a read-only Bybit API key first. It is stored on this phone only.',
  'positions.keysCleared': 'No keys stored.',

  'position.size': 'Size',
  'position.entry': 'Entry',
  'position.mark': 'Mark',
  'position.value': 'Value',
  'position.margin': 'Margin',
  'position.liquidation': 'Liquidation',
  'position.toLiquidation': 'To liquidation',
  'position.stopLossFull': 'Stop loss (full)',
  'position.takeProfitFull': 'Take profit (full)',
  'position.roe': 'ROE',
  'position.priceChange': 'price',
  'position.change': 'Change',
  'position.notSet': 'none',
  'position.long': 'LONG',
  'position.short': 'SHORT',

  /* ---------- chart lines ---------- */
  'line.entry': 'Entry',
  'line.liquidation': 'Liquidation',
  'line.stopLoss': 'SL',
  'line.takeProfit': 'TP',
  'line.takeProfitN': 'TP{n}',
  'line.stopLossN': 'SL{n}',
  'line.withShare': '{label} ({percent} %)',
  'line.limit': 'Limit',

  /* ---------- chart tools ---------- */
  'chart.indicators': 'Indicators',
  'chart.moreTools': 'More tools',
  'chart.cursor': 'Cursor',
  'chart.magnet': 'Snap to candles',
  'chart.eraseDrawings': 'Delete drawings',
  'style.color': 'Colour',
  'style.width': 'Thickness',
  'style.opacity': 'Opacity',
  'chart.confirmEraseAll': 'Delete all drawings on this pair?',

  'interval.1m': '1m',
  'interval.5m': '5m',
  'interval.15m': '15m',
  'interval.1h': '1h',
  'interval.4h': '4h',
  'interval.1d': '1D',
  'interval.1w': '1W',
  'interval.1M': '1M',

  /* ---------- drawing tools ---------- */
  'tool.segment': 'Trend line',
  'tool.rayLine': 'Ray',
  'tool.straightLine': 'Extended line',
  'tool.horizontalStraightLine': 'Horizontal line',
  'tool.verticalStraightLine': 'Vertical line',
  'tool.priceLine': 'Price line',
  'tool.priceChannelLine': 'Price channel',
  'tool.parallelStraightLine': 'Parallel channel',
  'tool.fibonacciLine': 'Fibonacci',
  'tool.simpleAnnotation': 'Note',

  /* ---------- drawing guidance ---------- */
  'draw.setPoint': 'Tap to set point {n} of {total}',
  'draw.finish': 'Tap to finish ({n} of {total})',
  'draw.movePoint': 'Move the point and tap to confirm',
  'draw.editHint': 'Tap an end point, or tap away to finish',
  'draw.cancel': 'Cancel drawing',

  /* ---------- indicators ---------- */
  'indicator.VOL': 'Volume',
  'indicator.RSI': 'RSI',
  'indicator.MACD': 'MACD',
  'indicator.KDJ': 'KDJ',
  'indicator.MA': 'Moving average',
  'indicator.EMA': 'EMA',
  'indicator.BOLL': 'Bollinger bands',
  'indicator.SAR': 'Parabolic SAR',

  /* ---------- settings ---------- */
  'settings.title': 'Bybit connection',
  'settings.hint':
    'Enter a read-only API key. The key and secret are stored on this phone only, '
    + 'are never sent anywhere else and are not in the repository. Requests are '
    + 'signed on the device itself.',
  'settings.apiKey': 'API key',
  'settings.apiSecret': 'API secret',
  'settings.apiKeyPlaceholder': 'e.g. AbCdEf123456',
  'settings.revealSecret': 'Show secret',
  'settings.save': 'Save and connect',
  'settings.saving': 'Connecting…',
  'settings.test': 'Test',
  'settings.testing': 'Testing…',
  'settings.clear': 'Delete keys from this phone',
  'settings.confirmClear': 'Really delete the API keys from this phone?',
  'settings.cleared': 'Keys deleted.',
  'settings.fillBoth': 'Fill in both the API key and the secret.',
  'settings.ok': 'Connection works, the key is valid.',
  'settings.language': 'Language',

  'settings.helpTitle': 'How to create a read-only key on Bybit',
  'settings.help1': 'Bybit → profile → API → Create New Key.',
  'settings.help2': 'Choose System-generated API Keys.',
  'settings.help3': 'Permissions: read-only, tick Positions (and Orders for the chart).',
  'settings.help4': 'Leave trading and withdrawals unticked.',
  'settings.help5': 'Leave the IP restriction empty — mobile networks change IP.',

  /* ---------- Bybit errors ---------- */
  'error.badKey': 'Invalid API key or signature. Check that you copied both the key and the secret in full, without spaces.',
  'error.clock': 'Clock mismatch. Check that automatic date and time is enabled on your phone.',
  'error.noPermission': 'The key cannot read positions. Create a read-only key on Bybit with the Positions permission.',
  'error.ipLocked': 'The API key is restricted to another IP address. Remove the IP restriction — mobile networks change IP.',
  'error.expired': 'The API key has expired. Create a new one on Bybit.',
  'error.bybit': 'Bybit: {message} (code {code})',
  'error.bybitCode': 'Bybit returned error {code}.',
  'error.rejected': 'Bybit rejected the key{detail}. Check that the key is valid, active, can read positions and has no IP restriction.',
  'error.rateLimit': 'Too many requests to Bybit. Try again in a moment.',
  'error.outage': 'Bybit is having an outage (HTTP {status}). Try again in a moment.',
  'error.unexpected': 'Bybit returned an unexpected response (HTTP {status}){detail}.',
  'error.offline': 'Could not reach Bybit. Check your internet connection.',
  'error.noKeys': 'No API keys stored.',
};
