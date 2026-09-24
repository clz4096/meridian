/**
 * Composition root — creates the stores, wires the SyncEngine facade + appState,
 * installs window lifecycle, and boots. Lifted from entry.ts's mountApp, minus all
 * the render/nav/carousel/tab-routing glue (Preact components + signals replace it).
 */
import { SyncEngine, STORE_KEYS, type SaveResult, type StoreKey } from '@/core/sync/SyncEngine';
import { BrowserStorageAdapter, SupabaseCloudProvider, systemClock } from '@/core/storage/adapters';
import { mergeStore, sanitizeStore } from '@/core/sync/mergeStores';
import { storeGet } from '@/core/storage/store';
import { DATA } from '@/core/data/index';
import { createAppState } from '@/core/storage/appState';
import { host } from '@/ui/host';
import { bump } from '@/ui/store';
import { syncTrackerFromStore, ensureToday as ensureTrackerToday } from '@/features/studytracker/trackerStore';
import { span, count } from '@/core/telemetry';

export const STORAGE_KEYS: Record<StoreKey, string> = {
  core: 'meridian-core',
  overload: 'overload-tracker-state',
  surplus: 'surplus-tracker-state',
  csgraph: 'csgraph_profile_v2',
  theorist: 'meridian-theorist',
};

/* ── the four store objects (owned here; read/mutated in place by actions) ── */
export const stores: Record<StoreKey, Record<string, unknown>> = {
  core: { schedule: {}, entries: [], todos: [], scratch: [] },
  overload: { settings: {}, days: {}, bw: {}, rpe: {} },
  surplus: { settings: {}, days: {}, tad: {} },
  csgraph: { mastery: {}, srs: {}, log: [], gymDone: {} },
  theorist: { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false } },
};

/* ── load gate ──
 * Only core and theorist load at boot; overload, surplus, and csgraph load lazily.
 * Until a store has loaded from disk, `stores[key]` is an empty placeholder, and
 * syncing it is destructive: a pull merges the cloud into the placeholder and
 * writes that over the disk copy (losing this device's unsynced edits), and a
 * later save pushes the disk copy over the pulled data (losing the other
 * device's). So a store joins a save (and its write-back) only once loaded, and
 * pulls, force-pushes, and cloud pushes wait until every store has loaded. */
const loadedKeys = new Set<StoreKey>();
let openGate: () => void = () => {};
const allStoresLoaded = new Promise<void>((resolve) => { openGate = resolve; });
export function markStoreLoaded(key: StoreKey): void {
  loadedKeys.add(key);
  if (STORE_KEYS.every((k) => loadedKeys.has(k))) openGate();
}
const everyStoreLoaded = (): boolean => STORE_KEYS.every((k) => loadedKeys.has(k));

// The lazy loaders live in ui/actions (which imports this module), so they register
// here instead of being imported. A gated path starts them rather than waiting on a
// screen that may never be opened.
let loadAll: () => Promise<void> = () => Promise.resolve();
export function registerLoadAll(fn: () => Promise<void>): void {
  loadAll = fn;
}
// Work that must reach the store before the page-hide save captures it (a delete
// waiting behind its Undo toast). Registered by ui/actions for the same reason.
let beforeHide: () => void = () => {};
export function registerBeforeHide(fn: () => void): void {
  beforeHide = fn;
}
const GATE_TIMEOUT_MS = 15_000;
/** Wait for every store to load, starting the loaders; reject if they don't finish. */
async function whenAllLoaded(): Promise<void> {
  if (everyStoreLoaded()) return;
  void loadAll().catch(() => { /* surfaced by the timeout below */ });
  let timer = 0;
  try {
    await Promise.race([
      allStoresLoaded,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('some data has not finished loading; reopen the app and try again')), GATE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

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
      theorist: config.read('theorist'),
    },
  );
  return engine;
}

/** Each loaded store's JSON, taken before an await so the write-back can tell whether it changed. */
function captureLive(): Partial<Record<StoreKey, string>> {
  const before: Partial<Record<StoreKey, string>> = {};
  for (const key of STORE_KEYS) if (loadedKeys.has(key)) before[key] = JSON.stringify(setup!.read(key));
  return before;
}

/** Copy each loaded live store into the engine when it differs (before a save/pull/force-push). */
function feedEngine(before: Partial<Record<StoreKey, string>>): void {
  for (const key of STORE_KEYS) {
    const json = before[key];
    if (json !== undefined && json !== JSON.stringify(engine!.getStore(key))) {
      const live = setup!.read(key);
      engine!.edit(key, () => live);
    }
  }
}

/**
 * After an await, publish the engine's copies (which may now hold merged cloud rows)
 * to the live stores. Two things the old wholesale write-back got wrong:
 *  - a store that was still a placeholder when the operation started is never
 *    written (it may have loaded meanwhile, and the engine copy is still empty);
 *  - a store the user edited during the await is merged with the engine copy,
 *    not replaced by it, and the edit is queued for the next save.
 */
function writeBack(before: Partial<Record<StoreKey, string>>): void {
  let editedMeanwhile = false;
  for (const key of STORE_KEYS) {
    if (before[key] === undefined) continue;
    const live = setup!.read(key);
    if (JSON.stringify(live) !== before[key]) {
      engine!.edit(key, (eng) => mergeStore(key, live, eng, true));
      editedMeanwhile = true;
    }
    setup!.write(key, engine!.getStore(key));
  }
  if (editedMeanwhile) appState.markDirty();
}

async function syncSave(opts: { cloud?: boolean } = {}): Promise<SaveResult> {
  if (!engine || !setup) throw new Error('sync not initialised');
  const end = span('sync:save');
  const before = captureLive(); // placeholders are never captured, so never persisted
  feedEngine(before);
  // Local writes start now (synchronously, for the page-hide flush); the cloud push
  // runs only when sync is set up and every store has loaded (see boot()).
  const result = await engine.save({ cloud: opts.cloud !== false && cloudEnabled() && everyStoreLoaded() });
  end();
  count('sync:save:' + result.cloud);
  setup.onStatus?.(result);
  writeBack(before);
  bump(); // sync status changed (Today's Data tile reads it)
  return result;
}

async function syncPull(): Promise<boolean> {
  if (!engine || !setup) return false;
  await whenAllLoaded();
  const before = captureLive();
  feedEngine(before);
  const end = span('sync:pull');
  let res: Awaited<ReturnType<SyncEngine['pull']>>;
  try {
    res = await engine.pull();
  } catch (e) {
    count('sync:pull:error');
    throw e;
  }
  end();
  if (!res.ok) {
    // The engine reports offline / HTTP errors in the result rather than throwing;
    // callers must not read that as "already up to date".
    count('sync:pull:error');
    throw new Error(res.reason ?? 'could not reach the cloud');
  }
  count(res.applied ? 'sync:pull:applied' : 'sync:pull:unchanged');
  if (res.applied) writeBack(before);
  return res.applied;
}

/**
 * Overwrite the cloud with this device's local state, bypassing push()'s
 * fold-in merge — the only way a cleaned store (knowledge has no delete path)
 * can be made to stick. Bridges the live stores → engine → both local backends
 * exactly like syncSave, so localStorage AND IndexedDB get the clean copy.
 */
async function syncForcePush(only?: readonly StoreKey[]): Promise<{ cloud: SaveResult['cloud']; cloudError?: SaveResult['cloudError'] }> {
  if (!engine || !setup) throw new Error('sync not initialised');
  await whenAllLoaded();
  const before = captureLive();
  feedEngine(before);
  const result = await engine.forcePush(only);
  writeBack(before);
  setup.onStatus?.({ localOk: result.cloud !== 'skipped', localFailed: [], cloud: result.cloud, cloudError: result.cloudError });
  return result;
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
  forcePush: (only?: readonly StoreKey[]) => syncForcePush(only),
  push: async (force = false) => {
    if (!engine) return { cloud: 'skipped' as const };
    await whenAllLoaded();
    return engine.push(force);
  },
  /** Resolves once every store has loaded from disk (starts the loaders if needed). */
  whenLoaded: whenAllLoaded,
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
  onExternalChange: () => {
    // A discard/pull reassigned the store bindings → re-derive the UI and
    // re-project the theorist store into the tracker signal.
    bump();
    syncTrackerFromStore();
  },
  markFlush: (reason) => host.setItem('meridian_last_flush', new Date().toISOString() + ' (' + reason + ')'),
});

/* ── window lifecycle: flush on background, opportunistic pull on foreground, ⌘S save ── */
/** Page going to the background: apply pending work, then save synchronously. */
export function handleHide(): void {
  beforeHide();
  appState.flush('hidden');
}
function wireLifecycle(): void {
  const onHide = handleHide;
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
  // Back online: publish anything that failed to reach the cloud while offline.
  window.addEventListener('online', () => {
    if (cloudEnabled() && sync.anyDirty()) void appState.save();
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
  markStoreLoaded('core');
  stores.theorist = await appState.loadTheorist();
  markStoreLoaded('theorist');
  syncTrackerFromStore();
  // A new day since last use: auto-bank the old one now, before the boot pull
  // could replace this device's unbanked day with another device's newer one.
  ensureTrackerToday();
  // Saves before the gate opened were local-only; publish them once it does.
  void allStoresLoaded.then(() => { if (sync.anyDirty()) void appState.save(); });
  syncTrackerFromStore(); // project the durable theorist store into the tracker signal
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
