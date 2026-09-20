/**
 * Obal nad knihovnou lightweight-charts (vendor/lightweight-charts.js).
 *
 * O Bybitu nic neví — dostává hotové svíčky a seznam čar. Díky tomu jde
 * knihovna kdykoli vyměnit, aniž by se sahalo na zbytek aplikace.
 */

const LC = () => window.LightweightCharts;

const BARVY = {
  pozadi: '#0b0f14',
  text: '#8b9bb0',
  mrizka: '#1a232e',
  okraj: '#253141',
  rust: '#16c784',
  pokles: '#ea3943',
};

/**
 * Krypto ceny mají rozsah od statisíců po miliontiny, takže počet desetinných
 * míst se volí podle řádu. Stejná logika jako v format.js, tady ale musí být
 * jako číslo pro priceFormat knihovny.
 */
export function decimalsForPrice(value) {
  const abs = Math.abs(value || 0);
  if (abs >= 1000) return 2;
  if (abs >= 10) return 3;
  if (abs >= 1) return 4;
  if (abs >= 0.01) return 5;
  if (abs >= 0.0001) return 6;
  return 8;
}

function formatTickMark(time, tickMarkType) {
  const d = new Date(time * 1000);
  const T = LC().TickMarkType;
  if (tickMarkType === T.Year) return String(d.getFullYear());
  if (tickMarkType === T.Month) return d.toLocaleDateString('cs-CZ', { month: 'short' });
  if (tickMarkType === T.DayOfMonth) {
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
  }
  return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

export function createPriceChart(container) {
  const lib = LC();
  const chart = lib.createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { type: lib.ColorType.Solid, color: BARVY.pozadi },
      textColor: BARVY.text,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: BARVY.mrizka },
      horzLines: { color: BARVY.mrizka },
    },
    rightPriceScale: { borderColor: BARVY.okraj },
    timeScale: {
      borderColor: BARVY.okraj,
      timeVisible: true,
      secondsVisible: false,
      // Knihovna kreslí čas v UTC; přeformátovat na místní, ať sedí s telefonem.
      tickMarkFormatter: formatTickMark,
    },
    crosshair: { mode: lib.CrosshairMode.Normal },
    localization: {
      locale: 'cs-CZ',
      timeFormatter: (time) =>
        new Date(time * 1000).toLocaleString('cs-CZ', {
          day: 'numeric',
          month: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
    },
  });

  const series = chart.addSeries(lib.CandlestickSeries, {
    upColor: BARVY.rust,
    downColor: BARVY.pokles,
    borderUpColor: BARVY.rust,
    borderDownColor: BARVY.pokles,
    wickUpColor: BARVY.rust,
    wickDownColor: BARVY.pokles,
  });

  let priceLines = [];

  // Přeložení Foldu nebo otočení mění rozměr bez reloadu stránky.
  const observer = new ResizeObserver(() => {
    chart.resize(container.clientWidth, container.clientHeight);
  });
  observer.observe(container);

  return {
    /** Nastaví přesnost cen podle řádu, jinak by se drobné páry zaokrouhlily. */
    setPrecision(referencePrice) {
      const precision = decimalsForPrice(referencePrice);
      series.applyOptions({
        priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
      });
    },

    setCandles(bars) {
      series.setData(bars);
      chart.timeScale().fitContent();
    },

    /** Živá svíčka — update() tu poslední přepíše nebo přidá novou. */
    updateCandle(bar) {
      series.update(bar);
    },

    /**
     * Čáry se překreslují celé. Je jich pár jednotek, takže se nevyplácí
     * řešit rozdíly oproti minulému stavu.
     */
    setLines(lines) {
      priceLines.forEach((line) => series.removePriceLine(line));
      priceLines = lines.map((l) =>
        series.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: l.width ?? 1,
          lineStyle: l.style ?? LC().LineStyle.Dashed,
          axisLabelVisible: true,
          title: l.title,
        }),
      );
    },

    destroy() {
      observer.disconnect();
      chart.remove();
    },
  };
}
