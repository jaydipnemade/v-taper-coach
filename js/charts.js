// js/charts.js
// Pure numeric/SVG-string helpers for the Body tab's charts. No DOM, no
// IndexedDB — just data in, string/array out. Deliberately dependency-free
// (no chart library) per the project's "plain SVG" constraint.

/**
 * 7-day (or any window) rolling average, same length as `values`. Each
 * output[i] is the average of values[max(0, i-windowSize+1) .. i] — i.e. a
 * PARTIAL window at the start of the series (the spec's "7-day rolling
 * average over a history shorter than 7 days" case), not a sliding window
 * that only starts producing values once a full window is available.
 *
 * Examples (from the task brief):
 *   rollingAverage([70,71,72], 7) -> [70, 70.5, 71]
 *   rollingAverage([1,2,3,4,5,6,7,8], 7)[7] === (2+3+4+5+6+7+8)/7
 *
 * @param {number[]} values
 * @param {number} windowSize
 * @returns {number[]}
 */
export function rollingAverage(values, windowSize) {
  const result = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - windowSize + 1);
    let sum = 0;
    for (let j = start; j <= i; j += 1) sum += values[j];
    result[i] = sum / (i - start + 1);
  }
  return result;
}

/**
 * Builds a complete, self-contained `<svg>...</svg>` string for a simple
 * line chart: the data points normalized into the given viewbox, drawn as
 * one `<path>` (line) plus a small `<circle>` marker per point.
 *
 * Handles degenerate inputs defensively (rather than producing NaN
 * coordinates or throwing) since the Body tab calls this before the trainee
 * necessarily has any real history yet:
 *   - 0 points: returns a valid empty-chart SVG (no path/circles).
 *   - 1 point, or every point sharing the same x and/or y: that axis is
 *     centered instead of dividing by a zero range.
 *
 * @param {{x: number, y: number}[]} points
 * @param {{width: number, height: number, color: string, padding?: number}} opts
 * @returns {string}
 */
export function buildSVGLineChart(points, opts) {
  const { width, height, color } = opts;
  const padding = opts.padding ?? 8;

  const innerWidth = Math.max(0, width - 2 * padding);
  const innerHeight = Math.max(0, height - 2 * padding);

  const svgOpen = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`;

  if (!Array.isArray(points) || points.length === 0) {
    return `${svgOpen}<path d="" fill="none" stroke="${color}" stroke-width="2"></path></svg>`;
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;

  const toSvgX = (x) => (xRange === 0
    ? padding + innerWidth / 2
    : padding + ((x - xMin) / xRange) * innerWidth);
  // SVG y grows downward; flip so a higher value draws higher on the chart.
  const toSvgY = (y) => (yRange === 0
    ? padding + innerHeight / 2
    : padding + innerHeight - ((y - yMin) / yRange) * innerHeight);

  const coords = points.map((p) => ({ x: toSvgX(p.x), y: toSvgY(p.y) }));

  const d = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(' ');

  const circles = coords
    .map((c) => `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="3" fill="${color}"></circle>`)
    .join('');

  return `${svgOpen}<path d="${d}" fill="none" stroke="${color}" stroke-width="2"></path>${circles}</svg>`;
}
