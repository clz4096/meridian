/**
 * Composition root — creates the stores, wires the SyncEngine facade + appState,
 * installs window lifecycle, and boots. Lifted from entry.ts's mountApp, minus all
 * the render/nav/carousel/tab-routing glue (Preact components + signals replace it).
 */
import { SyncEngine, type SaveResult, type StoreKey } from '@/core/sync/SyncEngine';
import { BrowserStorageAdapter, SupabaseCloudProvider, systemClock } from '@/core/storage/adapters';
import { mergeStore, sanitizeStore } from '@/core/sync/mergeStores';
import { storeGet } from '@/core/storage/store';
import { DATA } from '@/core/data/index';
import { createAppState } from '@/core/storage/appState';
import { host } from '@/ui/host';
import { bump } from '@/ui/store';

export const STORAGE_KEYS: Record<StoreKey, string> = {
  core: 'meridian-core',
  overload: 'overload-tracker-state',
  surplus: 'surplus-tracker-state',
  csgraph: 'csgraph_profile_v2',
};

/* ── the four store objects (owned here; read/mutated in place by actions) ── */
export const stores: Record<StoreKey, Record<string, unknown>> = {
  core: { schedule: {}, entries: [], todos: [], scratch: [] },
  overload: { settings: {}, days: {}, bw: {}, rpe: {} },
  surplus: { settings: {}, days: {}, tad: {} },
  csgraph: { mastery: {}, srs: {}, log: [], gymDone: {} },
};

/* ── SyncEngine facade (verbatim port of entry.ts's sync wiring) ── */
interface SyncSetup {
  read(key: StoreKey): Record<string, unknown>;
  write(key: StoreKey, data: Record<string, unknown>): void;
  onStatus?(result: SaveResult): void;
}
let engine: SyncEngine | null = null;
let setup: SyncSetup | null = null;

function createSync(config: SyncSetup): SyncEngine {
  setup = config;
  engine = new SyncEngine(
    {
      storage: new BrowserStorageAdapter(STORAGE_KEYS),
      cloud: new SupabaseCloudProvider(() => {
        try {
          const url = localStorage.getItem('meridian_supabase_url');
          const key = localStorage.getItem('meridian_supabase_key');
          return url && key ? { projectUrl: url, anonKey: key } : null;
        } catch {
          return null;
        }
      }),
      clock: systemClock,
      merge: (local, remote, key, localWins) => mergeStore(key, local, remote, localWins),
      sanitize: (key, data, now) => sanitizeStore(key, data, now),
      minPushGap: 4000,
      rateLimitBackoff: 30_000,
    },
    {
      core: config.read('core'),
      overload: config.read('overload'),
      surplus: config.read('surplus'),
      csgraph: config.read('csgraph'),
    },
  );
  return engine;
}

async function syncSave(): Promise<SaveResult> {
  if (!engine || !setup) throw new Error('sync not initialised');
  for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) {
    const live = setup.read(key);
    if (JSON.stringify(live) !== JSON.stringify(engine.getStore(key))) engine.edit(key, () => live);
  }
  const result = await engine.save();
  for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) setup.write(key, engine.getStore(key));
  setup.onStatus?.(result);
  return result;
}

async function syncPull(): Promise<boolean> {
  if (!engine || !setup) return false;
  for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) {
    const live = setup.read(key);
    if (JSON.stringify(live) !== JSON.stringify(engine.getStore(key))) engine.edit(key, () => live);
  }
  const res = await engine.pull();
  if (res.applied) for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) setup.write(key, engine.getStore(key));
  return res.applied;
}

async function syncDiscard(): Promise<{ restored: StoreKey[]; skipped: StoreKey[] }> {
  if (!engine || !setup) return { restored: [], skipped: [] };
  const res = await engine.discard();
  for (const key of res.restored) setup.write(key, engine.getStore(key));
  return res;
}

export const sync = {
  create: createSync,
  save: syncSave,
  pull: syncPull,
  discard: syncDiscard,
  push: (force = false) => engine?.push(force) ?? Promise.resolve({ cloud: 'skipped' as const }),
  anyDirty: () => engine?.anyDirty() ?? false,
  isDirtyCloud: (key: StoreKey) => engine?.isDirtyCloud(key) ?? false,
  isDirtyLocal: (key: StoreKey) => engine?.isDirtyLocal(key) ?? false,
  baseRev: () => engine?.getBaseRev() ?? 0,
  snapshot: () => engine?.snapshot() ?? null,
  keys: STORAGE_KEYS,
};

/* ── impure helpers (session ids + local-date formatting) ── */
let uidSeq = 0;
export const uid = (): string => {
  uidSeq = (uidSeq + 1) % 1000000;
  return Date.now().toString(36) + '-' + uidSeq.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
};
export const dstr = (d?: Date): string => {
  const dt = d ?? new Date();
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
};
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dateLabel = (ds: string): string => {
  const p = ds.split('-');
  const dt = new Date(+p[0]!, +p[1]! - 1, +p[2]!);
  return (ds === dstr() ? 'Today · ' : '') + WD[dt.getDay()] + ', ' + MO[dt.getMonth()] + ' ' + dt.getDate();
};
export const cloudEnabled = (): boolean =>
  !!(host.getItem('meridian_supabase_url') && host.getItem('meridian_supabase_key'));

/* ── appState (persistence / dirty / autosave / discard) ── */
export const appState = createAppState({
  host,
  storeGet,
  sync,
  keys: STORAGE_KEYS,
  defaultWorkout: DATA.defaultWorkout as Record<string, unknown>,
  read: (key) => stores[key] || {},
  write: (key, data) => {
    stores[key] = data;
    host.setItem(STORAGE_KEYS[key], JSON.stringify(data));
  },
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h),
  onExternalChange: () => bump(), // a discard/pull applied changes → re-derive
  markFlush: (reason) => host.setItem('meridian_last_flush', new Date().toISOString() + ' (' + reason + ')'),
});

/* ── window lifecycle: flush on background, opportunistic pull on foreground, ⌘S save ── */
function wireLifecycle(): void {
  const onHide = () => appState.flush('hidden');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onHide();
  });
  window.addEventListener('pagehide', onHide);
  window.addEventListener('beforeunload', onHide);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cloudEnabled() && !appState.anyDirty()) {
      void sync.pull().then((applied) => { if (applied) bump(); }).catch(() => {});
    }
  });
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void appState.save();
    }
  });
}

/* ── boot: init sync, load the durable core store, then background-pull ── */
export async function boot(): Promise<void> {
  appState.init();
  wireLifecycle();
  stores.core = await appState.loadCore();
  bump(); // core (schedule/entries/todos/scratch) is in — re-derive anything already mounted
  appState.paintChip();
  if (cloudEnabled()) {
    window.setTimeout(async () => {
      try {
        if (await sync.pull()) bump();
      } catch {
        /* offline — fine */
      }
    }, 2000);
  }
}
