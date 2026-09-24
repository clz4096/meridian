/**
 * On-device telemetry. First-party, never sent anywhere, never synced or
 * exported: it lives in one localStorage key that is not a sync store.
 *
 * Cost model: every record is an O(1) array push into a capped ring; browser
 * observers are passive; persistence happens only when the page is hidden, so
 * nothing touches storage on the hot path. Percentiles are computed only when
 * the Data tab's health panel asks for a snapshot.
 */

const KEY = 'meridian.telemetry.v1';
const MAX_SAMPLES = 50; // per metric: enough for a stable p50/p95, small enough to persist cheaply
const MAX_ERRORS = 20;

export interface ErrorRecord { at: number; source: string; message: string }
interface Persisted {
  v: 1;
  since: number;
  sessions: number;
  samples: Record<string, number[]>;
  counts: Record<string, number>;
  last: Record<string, number>; // epoch ms of the latest event per name (e.g. last good sync)
  errors: ErrorRecord[];
}

const fresh = (): Persisted => ({ v: 1, since: Date.now(), sessions: 0, samples: {}, counts: {}, last: {}, errors: [] });
let data: Persisted = fresh();

function load(): void {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Persisted) : null;
    if (p && p.v === 1) data = { ...fresh(), ...p };
  } catch { /* corrupt or blocked: start clean */ }
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* quota: telemetry is expendable */ }
}

/** Append one sample (ms unless the name says otherwise). */
export function record(name: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const xs = (data.samples[name] ??= []);
  xs.push(Math.round(value * 10) / 10);
  if (xs.length > MAX_SAMPLES) xs.shift();
}

export function count(name: string, n = 1): void {
  data.counts[name] = (data.counts[name] ?? 0) + n;
  data.last[name] = Date.now();
}

export function error(source: string, message: unknown): void {
  data.errors.push({ at: Date.now(), source, message: String(message ?? '').slice(0, 200) });
  if (data.errors.length > MAX_ERRORS) data.errors.shift();
  count('error:' + source);
}

/** Start a timer; call the returned function to record the elapsed ms. */
export function span(name: string): () => number {
  const t0 = performance.now();
  return () => {
    const ms = performance.now() - t0;
    record(name, ms);
    return ms;
  };
}

/** Record `name` once the frame the caller just scheduled has painted (rAF, then a macrotask). */
export function afterPaint(end: () => unknown): void {
  requestAnimationFrame(() => setTimeout(end, 0));
}

/* ── pending navigation: started by the action that switches tabs, ended by App after paint ── */
let pendingNav: { name: string; end: () => number } | null = null;
export function navStart(tab: string): void {
  pendingNav = { name: 'tab:' + tab, end: span('tab:' + tab) };
}
export function navEnd(tab: string): void {
  const p = pendingNav;
  if (!p || p.name !== 'tab:' + tab) return;
  pendingNav = null;
  afterPaint(p.end);
}

/* ── browser observers ── */
function observe(type: string, cb: (e: PerformanceEntry) => void): void {
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({ type, buffered: true } as PerformanceObserverInit);
  } catch { /* unsupported entry type (e.g. longtask on Safari) */ }
}

let started = false;
/** Install observers and lifecycle hooks. Idempotent; call once at startup. */
export function startTelemetry(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  load();
  data.sessions++;

  // Page-load vitals. LCP and CLS finalize when the page is first hidden.
  let lcp = 0;
  let cls = 0;
  let worstInteraction = 0;
  observe('largest-contentful-paint', (e) => { lcp = e.startTime; });
  observe('layout-shift', (e) => {
    const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!s.hadRecentInput) cls += s.value;
  });
  observe('paint', (e) => { if (e.name === 'first-contentful-paint') record('load:fcp', e.startTime); });
  observe('longtask', (e) => { record('longtask', e.duration); count('longtask'); });
  // Worst interaction per session: an INP stand-in that needs no percentile bookkeeping.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) worstInteraction = Math.max(worstInteraction, e.duration);
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
  } catch { /* no Event Timing API */ }

  window.addEventListener('error', (e) => error('window', e.message));
  window.addEventListener('unhandledrejection', (e) => error('promise', (e.reason as Error)?.message ?? e.reason));

  let finalized = false;
  const onHide = (): void => {
    if (!finalized) {
      finalized = true; // vitals are once per page load
      // Read navigation timing here, not at startup: this module runs before DOMContentLoaded.
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (nav) {
        record('load:ttfb', nav.responseStart);
        if (nav.domContentLoadedEventEnd) record('load:dcl', nav.domContentLoadedEventEnd);
      }
      if (lcp) record('load:lcp', lcp);
      record('load:cls', cls);
    }
    if (worstInteraction) { record('interaction:worst', worstInteraction); worstInteraction = 0; }
    save();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });
  window.addEventListener('pagehide', onHide);
}

/* ── read side (the health panel) ── */
export interface MetricSummary { n: number; p50: number; p95: number; last: number }

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

export function summarize(xs: readonly number[] | undefined): MetricSummary | null {
  if (!xs || xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), last: xs[xs.length - 1]! };
}

export interface TelemetrySnapshot {
  since: number;
  sessions: number;
  metrics: Record<string, MetricSummary>;
  counts: Record<string, number>;
  last: Record<string, number>;
  errors: ErrorRecord[];
}

export function snapshot(): TelemetrySnapshot {
  const metrics: Record<string, MetricSummary> = {};
  for (const [k, xs] of Object.entries(data.samples)) {
    const s = summarize(xs);
    if (s) metrics[k] = s;
  }
  return { since: data.since, sessions: data.sessions, metrics, counts: { ...data.counts }, last: { ...data.last }, errors: [...data.errors] };
}

export function resetTelemetry(): void {
  data = fresh();
  save();
}

/** The raw persisted blob, for "copy as JSON". */
export function telemetryJSON(): string {
  return JSON.stringify(data, null, 2);
}
