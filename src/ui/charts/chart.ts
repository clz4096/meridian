/**
 * chart — pure inline-SVG chart figures for the progress views.
 *
 * Self-contained (no external chart library — Meridian ships as one offline HTML
 * file): each figure is a single-series line or bar, titled by what it shows (so
 * no legend), with recessive axes, a headline value, sparse x-labels, and an
 * optional goal/target reference line. Colours are the app's theme tokens, so
 * the same markup reads correctly in light and dark. Returns an HTML string.
 */
import { esc } from '@/ui/html';
import type { Point } from '@/ui/charts/progress';

export interface ChartOpts {
  kind: 'line' | 'bar';
  title: string;
  points: Point[];
  /** Value formatter for the headline + axis (default: rounded integer). */
  format?: (v: number) => string;
  /** Unit shown after the headline value (e.g. 'lb', 'g', '%'). */
  unit?: string;
  /** A goal/target reference line. */
  reference?: { value: number; label: string } | null;
  /** Stroke/fill colour (a CSS custom property). */
  color?: string;
  /** Which number to headline (default: 'last' for line, 'sum' for bar). */
  summary?: 'last' | 'sum' | 'avg' | 'max';
  /** Log-scale the Y axis (positive values only; the baseline drops below the min). */
  logY?: boolean;
  /** Optional controls rendered inside the card, below the header (e.g. a series picker). */
  controls?: string;
}

const W = 320;
const H = 142;
const PAD_L = 6;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 18;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function summarise(vals: number[], how: NonNullable<ChartOpts['summary']>): number {
  if (!vals.length) return 0;
  switch (how) {
    case 'last':
      return vals[vals.length - 1];
    case 'sum':
      return vals.reduce((a, b) => a + b, 0);
    case 'avg':
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'max':
      return Math.max(...vals);
  }
}

/** Indices to label on the x-axis — first, last, and a few evenly spaced between. */
function labelIndices(n: number, max = 5): Set<number> {
  if (n <= max) return new Set(Array.from({ length: n }, (_, i) => i));
  const out = new Set<number>([0, n - 1]);
  const step = (n - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) out.add(Math.round(i * step));
  return out;
}

export function chart(opts: ChartOpts): string {
  const { kind, title, points } = opts;
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)));
  const color = opts.color ?? 'var(--fuel)';
  const unit = opts.unit ? ` ${esc(opts.unit)}` : '';

  if (!points.length) {
    return (
      `<figure class="chart">` +
      `<figcaption class="chart-h"><span class="chart-t">${esc(title)}</span></figcaption>` +
      (opts.controls ?? '') +
      `<div class="chart-empty">No data yet</div></figure>`
    );
  }

  const vals = points.map((p) => p.value);
  const headline = summarise(vals, opts.summary ?? (kind === 'bar' ? 'sum' : 'last'));

  const refV = opts.reference ? opts.reference.value : null;
  const logY = !!opts.logY && vals.some((v) => v > 0);
  let dmax: number;
  let dmin: number;
  let y: (v: number) => number;
  if (logY) {
    // Log scale: positive domain only; drop the baseline below the smallest bar
    // so the shortest bar stays visible. Non-positive values clamp to the floor.
    const pos = vals.filter((v) => v > 0);
    const refPos = refV && refV > 0 ? refV : null;
    dmax = Math.max(...pos, refPos ?? -Infinity);
    dmin = Math.min(...pos, refPos ?? Infinity);
    if (!(dmax > dmin)) dmax = dmin * 10;
    const floor = kind === 'bar' ? dmin / 2 : dmin;
    const lmin = Math.log(floor);
    const lspan = Math.log(dmax) - lmin || 1;
    y = (v: number) => PAD_T + PLOT_H * (1 - (Math.log(Math.max(v, floor)) - lmin) / lspan);
  } else {
    dmax = Math.max(...vals, refV ?? -Infinity);
    dmin = kind === 'bar' ? 0 : Math.min(...vals, refV ?? Infinity);
    if (!(dmax > dmin)) dmax = dmin + 1;
    y = (v: number) => PAD_T + PLOT_H * (1 - (v - dmin) / (dmax - dmin));
  }

  const n = points.length;
  const xLine = (i: number) => (n === 1 ? PAD_L + PLOT_W / 2 : PAD_L + (PLOT_W * i) / (n - 1));

  const marks: string[] = [];
  let defs = '';
  const gid = 'g-' + title.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(0, 24);

  // reference (goal/target) line
  if (opts.reference) {
    const ry = y(opts.reference.value).toFixed(1);
    marks.push(
      `<line x1="${PAD_L}" y1="${ry}" x2="${PAD_L + PLOT_W}" y2="${ry}" stroke="var(--ok)" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`,
    );
    marks.push(
      `<text x="${PAD_L + PLOT_W}" y="${(y(opts.reference.value) - 2).toFixed(1)}" text-anchor="end" font-size="7" fill="var(--ok)">${esc(opts.reference.label)}</text>`,
    );
  }

  if (kind === 'line') {
    const pts = points.map((p, i) => `${xLine(i).toFixed(1)},${y(p.value).toFixed(1)}`);
    const line = 'M' + pts.join(' L');
    const baseY = (PAD_T + PLOT_H).toFixed(1);
    // gradient area fill under the line — the "alive" depth (fades to nothing at the baseline)
    defs =
      `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${color}" stop-opacity="0.22"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
    const area = `${line} L${xLine(n - 1).toFixed(1)},${baseY} L${xLine(0).toFixed(1)},${baseY} Z`;
    marks.push(`<path d="${area}" fill="url(#${gid})" stroke="none"/>`);
    marks.push(`<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    // end marker on the latest point, ringed so it reads as the "current" value
    marks.push(`<circle cx="${xLine(n - 1).toFixed(1)}" cy="${y(vals[n - 1]).toFixed(1)}" r="3.2" fill="${color}" stroke="var(--surface-1)" stroke-width="1.5"/>`);
  } else {
    const slot = PLOT_W / n;
    const bw = Math.max(1, slot - 2); // 2px surface gap between bars
    const baseY = PAD_T + PLOT_H;
    for (let i = 0; i < n; i++) {
      const bx = PAD_L + i * slot + (slot - bw) / 2;
      const by = y(points[i].value);
      const bh = Math.max(0, baseY - by);
      const rx = Math.min(2, bw / 2);
      // emphasise the current (last) period; earlier bars recede — mirrors the mockup
      const op = i === n - 1 ? '1' : '0.45';
      marks.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${rx}" fill="${color}" fill-opacity="${op}"/>`);
    }
  }

  // sparse x-axis labels — pin the first/last to the plot edges so they never clip
  const want = labelIndices(n);
  const xLabels = points
    .map((p, i) => {
      if (!want.has(i)) return '';
      const first = i === 0;
      const last = i === n - 1;
      const anchor = first ? 'start' : last ? 'end' : 'middle';
      const cx = first ? PAD_L : last ? PAD_L + PLOT_W : kind === 'line' ? xLine(i) : PAD_L + (i + 0.5) * (PLOT_W / n);
      return `<text x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}" font-size="9" fill="var(--faint)">${esc(p.label)}</text>`;
    })
    .join('');

  // range caption (mockup's small "PER WEEK / TREND" under the title)
  const sub = kind === 'bar' ? 'per period' : logY ? 'trend · log' : 'trend';

  return (
    `<figure class="chart">` +
    `<figcaption class="chart-h"><span class="chart-t">${esc(title)}</span>` +
    `<span class="chart-v" style="color:${color}">${esc(fmt(headline))}${unit}</span></figcaption>` +
    `<div class="chart-sub">${esc(sub)}</div>` +
    (opts.controls ?? '') +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">` +
    defs +
    marks.join('') +
    xLabels +
    `</svg></figure>`
  );
}
