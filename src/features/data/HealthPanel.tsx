/**
 * Performance & health — the on-device observability panel in the Data tab.
 * Collapsed by default and computes nothing until opened, so it costs the tab
 * nothing. Reads the telemetry ring (src/core/telemetry.ts) plus a few live
 * browser facts (storage quota, service worker, cache) fetched on open.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { snapshot, resetTelemetry, telemetryJSON, type MetricSummary, type TelemetrySnapshot } from '@/core/telemetry';
import { STORAGE_KEYS } from '@/app/bootstrap';

type Tone = 'ok' | 'warn' | 'bad' | '';
// Budgets: page-load rows use the web.dev "good / needs improvement" cut-offs;
// in-app rows use 100 ms (feels instant) and 300 ms (feels slow).
const LOAD_ROWS: Array<[string, string, number, number, (v: number) => string]> = [
  ['load:fcp', 'First paint', 1800, 3000, ms],
  ['load:lcp', 'Main content painted', 2500, 4000, ms],
  ['load:ttfb', 'Server response', 800, 1800, ms],
  ['load:cls', 'Layout shift', 0.1, 0.25, (v) => v.toFixed(3)],
  ['interaction:worst', 'Slowest tap response', 200, 500, ms],
];
const TAB_LABELS: Record<string, string> = {
  todos: 'Todos', scratch: 'Scratchpad', knowledge: 'Knowledge', tracker: 'Princeton Roadmap',
  roadmap: 'WGU Roadmap', workout: 'Workout', meal: 'Food & Body', data: 'Data',
};

function ms(v: number): string {
  return v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms';
}
function tone(v: number, good: number, poor: number): Tone {
  return v <= good ? 'ok' : v <= poor ? 'warn' : 'bad';
}
function ago(at: number | undefined): string {
  if (!at) return 'never';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
const kb = (bytes: number): string => (bytes / 1024).toFixed(1) + ' KB';

function Row({ label, s, good, poor, fmt = ms }: { label: string; s?: MetricSummary; good: number; poor: number; fmt?: (v: number) => string }) {
  return (
    <tr>
      <th scope="row">
        <span class={'hp-dot ' + (s ? tone(s.p95, good, poor) : '')} aria-hidden="true" />
        {label}
      </th>
      <td>{s ? fmt(s.p50) : '·'}</td>
      <td>{s ? fmt(s.p95) : '·'}</td>
      <td>{s ? s.n : 0}</td>
    </tr>
  );
}

function Table({ children }: { children: ComponentChildren }) {
  return (
    <div class="hp-scroll">
      <table class="hp-table">
        <thead>
          <tr><th scope="col" /><th scope="col">typical</th><th scope="col">slow (p95)</th><th scope="col">n</th></tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

interface Live {
  usage?: number; quota?: number; persisted?: boolean;
  sw: string; cacheEntries?: number;
  stores: Array<[string, number]>;
}

async function readLive(): Promise<Live> {
  const live: Live = { sw: 'unsupported', stores: [] };
  const enc = new TextEncoder();
  for (const [name, key] of Object.entries(STORAGE_KEYS)) {
    try { live.stores.push([name, enc.encode(localStorage.getItem(key) ?? '').length]); } catch { /* blocked */ }
  }
  try {
    const est = await navigator.storage?.estimate?.();
    live.usage = est?.usage;
    live.quota = est?.quota;
    live.persisted = await navigator.storage?.persisted?.();
  } catch { /* unsupported */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    live.sw = !reg ? 'not installed' : reg.waiting ? 'update waiting' : reg.active ? 'active' : 'installing';
    let n = 0;
    for (const name of await caches.keys()) n += (await (await caches.open(name)).keys()).length;
    live.cacheEntries = n;
  } catch { /* unsupported */ }
  return live;
}

function Body() {
  const [snap, setSnap] = useState<TelemetrySnapshot>(snapshot);
  const [live, setLive] = useState<Live | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { void readLive().then(setLive); }, []);

  const m = snap.metrics;
  const c = snap.counts;
  const tabs = Object.keys(m).filter((k) => k.startsWith('tab:')).sort();
  const errKinds = Object.keys(c).filter((k) => k.startsWith('ai:error:'));
  const syncOutcomes = Object.keys(c).filter((k) => k.startsWith('sync:save:'));

  const copy = (): void => {
    void navigator.clipboard?.writeText(telemetryJSON()).then(() => setMsg('Copied telemetry as JSON'), () => setMsg('Copy failed: clipboard blocked'));
  };
  const reset = (): void => {
    resetTelemetry();
    setSnap(snapshot());
    setMsg('Telemetry cleared');
  };

  return (
    <div class="ddisc-b hp">
      <div class="dcard-desc" style="margin-top:0">
        Recorded on this device only. Never synced or exported. {snap.sessions}{' '}
        {snap.sessions === 1 ? 'session' : 'sessions'} since {new Date(snap.since).toLocaleDateString()}. Page-load
        numbers are recorded when you leave the app.
      </div>

      <div class="dadv-sec">Page load</div>
      <Table>
        {LOAD_ROWS.map(([k, label, good, poor, fmt]) => <Row key={k} label={label} s={m[k]} good={good} poor={poor} fmt={fmt} />)}
      </Table>

      <div class="dadv-sec">In the app</div>
      <Table>
        <Row label="Enter to Today" s={m['boot:enter']} good={300} poor={1000} />
        {tabs.map((k) => <Row key={k} label={'Open ' + (TAB_LABELS[k.slice(4)] ?? k.slice(4))} s={m[k]} good={100} poor={300} />)}
        <Row label={`Long tasks (${c.longtask ?? 0} total)`} s={m.longtask} good={100} poor={250} />
      </Table>

      <div class="dadv-sec">Sync</div>
      <Table>
        <Row label="Save" s={m['sync:save']} good={1000} poor={3000} />
        <Row label="Pull" s={m['sync:pull']} good={1000} poor={3000} />
      </Table>
      <div class="note hp-kv">
        {syncOutcomes.length ? syncOutcomes.map((k) => `${k.slice(10)} ${c[k]}`).join(' · ') : 'No saves recorded yet'}
        {c['sync:pull:error'] ? ` · pull errors ${c['sync:pull:error']}` : ''}
        <br />Last successful sync: {ago(snap.last['sync:save:synced'])}
      </div>

      <div class="dadv-sec">AI</div>
      <Table>
        <Row label="Response time" s={m['ai:latency']} good={5000} poor={15000} />
        <Row label="Tokens per call" s={m['ai:tokens']} good={Infinity} poor={Infinity} fmt={(v) => String(Math.round(v))} />
      </Table>
      <div class="note hp-kv">
        {c['ai:ok'] ?? 0} ok{errKinds.map((k) => ` · ${k.slice(9)} ${c[k]}`).join('')}
      </div>

      <div class="dadv-sec">Storage &amp; offline</div>
      {live ? (
        <div class="note hp-kv">
          {live.usage !== undefined && live.quota ? `${kb(live.usage)} used of ${(live.quota / 1048576).toFixed(0)} MB` : 'Quota unavailable'}
          {live.persisted === undefined ? '' : live.persisted ? ' · protected from eviction' : ' · may be evicted by the browser'}
          <br />
          {live.stores.map(([n, b]) => `${n} ${kb(b)}`).join(' · ')}
          <br />
          Offline cache: {live.sw}
          {live.cacheEntries !== undefined ? ` · ${live.cacheEntries} files` : ''}
        </div>
      ) : (
        <div class="note">Reading…</div>
      )}

      <div class="dadv-sec">Recent errors</div>
      {snap.errors.length ? (
        <ul class="hp-errors">
          {[...snap.errors].reverse().slice(0, 10).map((e, i) => (
            <li key={i}><span>{ago(e.at)} · {e.source}</span>{e.message}</li>
          ))}
        </ul>
      ) : (
        <div class="note">None recorded</div>
      )}

      <div class="dactions">
        <button class="mbtn" type="button" onClick={() => { setSnap(snapshot()); void readLive().then(setLive); }}>Refresh</button>
        <button class="mbtn" type="button" onClick={copy}>Copy as JSON</button>
        <button class="mbtn" type="button" onClick={reset}>Clear</button>
      </div>
      {msg && <div class="note" role="status">{msg}</div>}
    </div>
  );
}

export function HealthPanel() {
  const [open, setOpen] = useState(false);
  return (
    <details class="ddisc dadv" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Performance &amp; health</summary>
      {open && <Body />}
    </details>
  );
}
