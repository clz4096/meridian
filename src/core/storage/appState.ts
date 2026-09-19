/**
 * appState — the save / sync / dirty core.
 *
 * This owns the app's persistence lifecycle: loading the four stores from the
 * durable local read, tracking unsaved changes, the debounced autosave, the
 * explicit/awaited save through the {@link SyncEngine}, the exit flush, and the
 * Discard (revert-to-last-saved) path. It paints the Save chip through the
 * {@link AppHost} port and never touches the DOM directly.
 *
 * The four store *objects* still physically live as legacy `let` bindings during
 * the migration; this module reads and writes them through the injected
 * `read`/`write` bridge (the same seam the SyncEngine already used), and the
 * loaders return freshly-built store objects for the caller to assign. That
 * keeps a single source of truth — there is no divergent in-module copy — until
 * the view slices relocate the bindings entirely.
 *
 * Clock and scheduler are injected so the dirty/autosave logic is unit-testable
 * without real time or a real store.
 */

import { addTombstone } from '@/core/util';
import type { AppHost } from '@/core/appHost';

export type StoreKey = 'core' | 'overload' | 'surplus' | 'csgraph' | 'theorist';

/** The subset of the SyncEngine facade (MeridianCore.sync) this module drives. */
export interface SyncFacade {
  create(config: {
    read(key: StoreKey): Record<string, unknown>;
    write(key: StoreKey, data: Record<string, unknown>): void;
    onStatus?(result: SaveResult): void;
  }): unknown;
  save(): Promise<SaveResult>;
  discard(): Promise<{ restored: StoreKey[]; skipped: StoreKey[] }>;
  anyDirty(): boolean;
  baseRev(): number;
}

export interface SaveResult {
  localOk: boolean;
  localFailed: string[];
  cloud: 'synced' | 'noop' | 'throttled' | 'failed' | 'skipped' | string;
  cloudError?: { message?: string } | null;
}

export interface AppStateDeps {
  host: Pick<AppHost, 'paintSaveChip' | 'flashSaved'>;
  /** Durable 3-backend read (MeridianCore.storeGet). */
  storeGet(key: string): Promise<string | null>;
  /** The SyncEngine facade (MeridianCore.sync). */
  sync: SyncFacade;
  /** The four legacy localStorage keys. */
  keys: Record<StoreKey, string>;
  /** Baked-in default workout (MeridianCore.data.defaultWorkout). */
  defaultWorkout: WorkoutStore;
  /** Live read of a store binding — the bridge the SyncEngine reads through. */
  read(key: StoreKey): Record<string, unknown>;
  /** Write a store binding back (assign legacy global + persist) — the SyncEngine write bridge. */
  write(key: StoreKey, data: Record<string, unknown>): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  /** Re-render whatever panes are visible after a Discard/pull applied changes. */
  onExternalChange?(): void;
  /** Record an exit-flush marker (diagnostic only). */
  markFlush?(reason: string): void;
}

/* The stores are dynamically-shaped legacy blobs; the typed selectors own their
   real schemas. Loosely typed here on purpose — this module moves bytes, not logic. */
type Store = Record<string, any>;
interface WorkoutStore extends Store {
  settings?: Store;
  days?: Record<string, any[]>;
  bw?: Store;
  rpe?: Store;
  done?: Store;
  sessionDone?: Store;
  incr?: Store;
}

// Debounce after the last edit before autosaving. Short enough that the quiet
// save status clears promptly; each edit resets it, so a burst still saves once.
const AUTOSAVE_MS = 5_000;

export interface AppState {
  init(): void;
  /** Live read of a store (the same object the SyncEngine sees) — safe to mutate in place. */
  get(key: StoreKey): Store;
  /** Replace a store binding (import/pull reassignment) and persist. */
  set(key: StoreKey, data: Store): void;
  loadCore(): Promise<Store>;
  loadWorkout(): Promise<WorkoutStore>;
  loadMeal(): Promise<Store>;
  loadKnowledge(current: Store): Promise<Store>;
  loadTheorist(): Promise<Store>;
  markDirty(): void;
  markWorkoutDirty(): void;
  markMealDirty(): void;
  markKnowledgeDirty(): void;
  markTheoristDirty(): void;
  anyDirty(): boolean;
  save(): Promise<SaveResult>;
  flush(reason: string): void;
  baseRev(): number;
  tomb(store: Store, id: unknown): void;
  discard(): Promise<boolean>;
  /** Repaint the Save chip from current dirty state (optional status override). */
  paintChip(text?: string, failed?: boolean): void;
}

export function createAppState(deps: AppStateDeps): AppState {
  /** All four legacy dirty flags collapse to one: they were only ever OR'd and reset together. */
  let dirtyLocal = false;
  let saveTimer: number | null = null;
  let flushing = false;

  function anyDirty(): boolean {
    return deps.sync.anyDirty() || dirtyLocal;
  }

  function paintChip(text?: string, failed = false): void {
    // The floating status reflects LOCAL data safety (unsaved local edits), not cloud
    // sync — cloud state lives in the Data tab. So it clears as soon as the local write lands.
    deps.host.paintSaveChip({ dirty: dirtyLocal, text, failed });
  }

  /** Faithful port of the legacy onStatus switch: chip messaging + dirty reset. */
  function onStatus(r: SaveResult): void {
    dirtyLocal = false;
    let clean = true;
    if (!r.localOk) {
      paintChip('Save failed: ' + r.localFailed.join(', '), true);
      clean = false;
    } else if (r.cloud === 'synced') {
      paintChip('All changes saved');
    } else if (r.cloud === 'noop') {
      paintChip('All changes saved · cloud already in sync');
    } else if (r.cloud === 'throttled') {
      paintChip('Saved · cloud sync queued');
    } else if (r.cloud === 'failed') {
      // Local write succeeded; cloud will retry. Data is safe — don't alarm the status.
      paintChip('Saved here only — cloud: ' + ((r.cloudError && r.cloudError.message) || 'failed'));
    } else {
      paintChip('All changes saved');
    }
    // The pill now hides on a clean save, so confirm the save with the transient flash.
    // A failure keeps the pill visible instead (no flash).
    if (clean) deps.host.flashSaved();
  }

  function armAutosave(): void {
    if (saveTimer !== null) deps.clearTimeout(saveTimer);
    saveTimer = deps.setTimeout(() => void save(), AUTOSAVE_MS);
  }

  function markDirty(): void {
    dirtyLocal = true;
    paintChip();
    // Only the generic/core edit path arms the long autosave safety-net; the
    // per-view marks below intentionally do not (explicit Save + exit-flush cover them).
    armAutosave();
  }
  // The UI now shows a quiet auto-save status (no manual Save button), so every edit
  // path arms the debounced autosave — it fires AUTOSAVE_MS after you stop editing.
  function markWorkoutDirty(): void {
    dirtyLocal = true;
    paintChip();
    armAutosave();
  }
  function markMealDirty(): void {
    dirtyLocal = true;
    paintChip();
    armAutosave();
  }
  function markKnowledgeDirty(): void {
    dirtyLocal = true;
    paintChip();
    armAutosave();
  }
  function markTheoristDirty(): void {
    dirtyLocal = true;
    paintChip();
    armAutosave();
  }

  function save(): Promise<SaveResult> {
    return deps.sync.save();
  }

  function flush(reason: string): void {
    // visibilitychange-hidden, pagehide and beforeunload all co-fire on one unload;
    // guard so a single unload flushes once instead of firing three saves in a row.
    if (flushing) return;
    flushing = true;
    try {
      void Promise.resolve(deps.sync.save()).finally(() => {
        flushing = false;
      });
      deps.markFlush?.(reason);
    } catch {
      flushing = false; // backgrounding must never throw
    }
  }

  function baseRev(): number {
    return deps.sync.baseRev();
  }

  function tomb(store: Store, id: unknown): void {
    store._del = addTombstone(store._del, id, deps.now());
  }

  async function discard(): Promise<boolean> {
    const res = await deps.sync.discard();
    if (!res.restored.length) return false;
    // Reverting to the last-saved state means there are no local edits left.
    // (Legacy left the per-store dirty flags set here, so the chip kept nagging
    // "unsaved" right after a Discard — corrected as part of the cancel-save fix.)
    dirtyLocal = false;
    paintChip();
    try {
      deps.onExternalChange?.();
    } catch {
      /* a failing re-render must not abort the revert */
    }
    return true;
  }

  function init(): void {
    deps.sync.create({ read: deps.read, write: deps.write, onStatus });
  }

  function get(key: StoreKey): Store {
    return deps.read(key);
  }
  function set(key: StoreKey, data: Store): void {
    deps.write(key, data);
  }

  /* ---- loaders (seeding/merge logic moved verbatim from index.html) ---- */

  async function loadCore(): Promise<Store> {
    const s = await deps.storeGet(deps.keys.core);
    let core: Store = { schedule: {}, entries: [] };
    if (s) {
      try {
        core = JSON.parse(s);
      } catch {
        core = { schedule: {}, entries: [] };
      }
    }
    if (!core.schedule) core.schedule = {};
    if (!core.entries) core.entries = [];
    if (!core.todos) core.todos = [];
    if (!core.scratch) core.scratch = [];
    return core;
  }

  async function loadWorkout(): Promise<WorkoutStore> {
    const DEFAULT_WK = deps.defaultWorkout;
    const s = await deps.storeGet(deps.keys.overload);
    let wk: WorkoutStore | null = null;
    if (s) {
      try {
        const st = JSON.parse(s);
        wk = {
          settings: st.settings || {},
          days: st.days || {},
          bw: st.bw || {},
          rpe: st.rpe || {},
          done: st.done || {},
          reopened: st.reopened || {},
          sessionDone: st.sessionDone || {},
          incr: st.incr || {},
          _del: st._del || {},
        };
      } catch {
        wk = null;
      }
    }
    // Fresh device / empty storage → seed from baked-in defaults IN MEMORY ONLY.
    // Do NOT write it back: a transient empty read on a device that actually has
    // data would otherwise be destroyed. Persist only on a real user edit.
    if (!s || !wk || !wk.days || Object.keys(wk.days).length === 0) {
      wk = JSON.parse(JSON.stringify(DEFAULT_WK));
      if (!wk!.settings) wk!.settings = {};
      if (!wk!.days) wk!.days = {};
      if (!wk!.bw) wk!.bw = {};
      if (!wk!.rpe) wk!.rpe = {};
      if (!wk!.done) wk!.done = {};
      if (!wk!.sessionDone) wk!.sessionDone = {};
      if (!wk!.incr) wk!.incr = {};
    } else {
      // Stored data wins, but MERGE IN any exercise the baked defaults know about
      // that this device has never seen (e.g. newly added lifts like Leg Press).
      const have = new Set<string>();
      Object.values(wk.days).forEach((d) => (d || []).forEach((x: any) => have.add(x.ex)));
      Object.keys(DEFAULT_WK.days || {}).forEach((day) => {
        (DEFAULT_WK.days![day] || []).forEach((set: any) => {
          if (have.has(set.ex)) return;
          if (!wk!.days![day]) wk!.days![day] = [];
          if (!wk!.days![day].some((x: any) => x.id === set.id)) wk!.days![day].push(JSON.parse(JSON.stringify(set)));
        });
      });
    }
    if (!wk!.done) wk!.done = {};
    if (!wk!.sessionDone) wk!.sessionDone = {};
    if (!wk!.incr) wk!.incr = {};
    return wk!;
  }

  async function loadMeal(): Promise<Store> {
    const s = await deps.storeGet(deps.keys.surplus);
    let sg: Store = { settings: {}, days: {}, tad: {} };
    if (s) {
      try {
        const st = JSON.parse(s);
        sg = { settings: st.settings || {}, days: st.days || {}, tad: st.tad || {}, _del: st._del || {} };
      } catch {
        sg = { settings: {}, days: {}, tad: {} };
      }
    }
    // Fresh device → bake in the real bulk targets so the header is correct immediately.
    const DEF = { current: 120, goal: 147, maintenance: 2200, surplus: 500, proteinTarget: 147 };
    if (!sg.settings || Object.keys(sg.settings).length === 0) sg.settings = { ...DEF };
    if (!sg.settings.maintenance) sg.settings.maintenance = DEF.maintenance;
    if (!sg.settings.surplus) sg.settings.surplus = DEF.surplus;
    if (!sg.settings.proteinTarget) sg.settings.proteinTarget = DEF.proteinTarget;
    if (!sg.settings.current) sg.settings.current = DEF.current;
    if (!sg.settings.goal) sg.settings.goal = DEF.goal;
    if (!sg.tad) sg.tad = {};
    return sg;
  }

  async function loadKnowledge(current: Store): Promise<Store> {
    let kg = current;
    const s = await deps.storeGet(deps.keys.csgraph);
    if (s) {
      try {
        const p = JSON.parse(s);
        if (p && p.mastery) kg = p;
      } catch {
        /* keep current on parse failure */
      }
    }
    if (!kg.mastery) kg.mastery = {};
    if (!kg.srs) kg.srs = {};
    if (!kg.log) kg.log = [];
    if (!kg.gymDone) kg.gymDone = {};
    return kg;
  }

  // The legacy Study Tracker blob and the one-shot migration marker are plain
  // localStorage keys (the tracker wrote them directly, pre-sync). appState
  // otherwise reads through deps.storeGet; these are read directly, guarded so
  // node/private-mode never throws.
  const LEGACY_TRACKER_KEY = 'meridian.tracker.v1';
  const THEORIST_MIGRATED_KEY = 'meridian.theorist.migrated';
  // Phase 3: the pre-sync per-course checkbox blob and its one-shot migration
  // marker. Folds into the nested (synced) `mastery` map; the local key is never
  // deleted.
  const CURRICULUM_KEY = 'meridian.curriculum.v1';
  const MASTERY_MIGRATED_KEY = 'meridian.mastery.migrated';
  const ls = (): Storage | null => (typeof localStorage !== 'undefined' ? localStorage : null);
  const localTodayISO = (): string => {
    const d = new Date(deps.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const freshTheoristDay = (): Store => ({ date: '', blocks: {}, scores: {}, banked: false, events: {} });

  async function loadTheorist(): Promise<Store> {
    const s = await deps.storeGet(deps.keys.theorist);
    let tg: Store = { banked: {}, day: freshTheoristDay() };
    if (s) {
      try {
        const p = JSON.parse(s);
        if (p && typeof p === 'object') tg = p;
      } catch {
        /* keep default on parse failure */
      }
    }
    if (!tg.banked || typeof tg.banked !== 'object') tg.banked = {};
    if (!tg.day || typeof tg.day !== 'object') tg.day = freshTheoristDay();
    // Phase 2 (additive): default a missing `day.events` to `{}` so downstream
    // XP math never touches undefined; leave `dayType` undefined. Both are
    // absent-tolerant in merge/projection, so no new migration marker is needed
    // and the legacy fold below is untouched.
    if (tg.day.events == null || typeof tg.day.events !== 'object') tg.day.events = {};

    // One-shot fold-in of the pre-sync `meridian.tracker.v1` blob. Runs only when
    // the durable store is still empty AND the migration has never been marked
    // done, so it never doubles up (e.g. after a deliberate reset) and never
    // touches (or deletes) the legacy blob.
    const emptyStore = Object.keys(tg.banked).length === 0 && tg.day.banked !== true;
    const store = ls();
    const alreadyMigrated = store ? store.getItem(THEORIST_MIGRATED_KEY) != null : false;
    if (emptyStore && !alreadyMigrated && store) {
      let legacy: { cumXP?: number; logged?: unknown; day?: Store } | null = null;
      try {
        const raw = store.getItem(LEGACY_TRACKER_KEY);
        if (raw) legacy = JSON.parse(raw);
      } catch {
        legacy = null;
      }
      let folded = false;
      if (legacy && typeof legacy === 'object') {
        const cumXP = typeof legacy.cumXP === 'number' && legacy.cumXP > 0 ? legacy.cumXP : 0;
        const logged = Array.isArray(legacy.logged) ? legacy.logged.filter((x): x is string => typeof x === 'string') : [];
        const banked: Record<string, number> = {};
        for (const iso of logged) banked[iso] = 0;
        if (cumXP > 0) banked['__carry'] = cumXP;
        const today = localTodayISO();
        const day =
          legacy.day && typeof legacy.day === 'object' && legacy.day.date === today
            ? legacy.day
            : freshTheoristDay();
        tg = { banked, day };
        folded = Object.keys(banked).length > 0 || day.banked === true;
      }
      // ORDER MATTERS. When we actually folded data, persist it durably FIRST,
      // THEN set the migration marker. A crash between the two then leaves the
      // durable store NON-empty (data safe) — the fold is simply re-skipped next
      // boot — instead of empty-with-marker, which would orphan the legacy XP
      // forever. `deps.write` is a synchronous localStorage write (one of the
      // three durable backends); `markTheoristDirty` schedules the fuller
      // sync/IndexedDB/cloud propagation.
      if (folded) {
        deps.write('theorist', tg);
        markTheoristDirty();
      }
      // Mark migrated regardless of whether a legacy blob existed — a fresh
      // device with no legacy data must not keep re-checking on every boot. This
      // marker must survive a resetAll (durable empty + reset epoch) so a reset
      // is never undone by a re-import.
      try { store.setItem(THEORIST_MIGRATED_KEY, new Date(deps.now()).toISOString()); } catch { /* best effort */ }
    }

    // One-shot fold-in of the pre-sync `meridian.curriculum.v1` per-course
    // checkboxes into the nested `mastery` map. Mirrors the legacy fold above:
    // guarded by its own marker so it never doubles up (e.g. after a resetAll,
    // which also empties `mastery`), and it never deletes the local key. A
    // checked course seeds level 1, an unchecked one level 0, both stamped with
    // `now` as `reviewedAt`. Existing mastery keys are never clobbered.
    const masteryMigrated = store ? store.getItem(MASTERY_MIGRATED_KEY) != null : false;
    if (!masteryMigrated && store) {
      let checks: Record<string, unknown> | null = null;
      try {
        const raw = store.getItem(CURRICULUM_KEY);
        if (raw) checks = JSON.parse(raw);
      } catch {
        checks = null;
      }
      if (checks && typeof checks === 'object' && !Array.isArray(checks)) {
        const now = deps.now();
        const mastery: Record<string, { level: number; reviewedAt: number }> =
          tg.mastery && typeof tg.mastery === 'object' ? { ...tg.mastery } : {};
        let folded = false;
        for (const [code, done] of Object.entries(checks)) {
          if (mastery[code]) continue; // never clobber a synced value
          mastery[code] = { level: done === true ? 1 : 0, reviewedAt: now };
          folded = true;
        }
        // Persist durably BEFORE the marker (same crash-safety ordering as the
        // legacy fold): a crash between the two re-runs the harmless fold rather
        // than orphaning the checkboxes behind a set marker.
        if (folded) {
          tg.mastery = mastery;
          deps.write('theorist', tg);
          markTheoristDirty();
        }
      }
      try { store.setItem(MASTERY_MIGRATED_KEY, new Date(deps.now()).toISOString()); } catch { /* best effort */ }
    }
    return tg;
  }

  return {
    init,
    get,
    set,
    loadCore,
    loadWorkout,
    loadMeal,
    loadKnowledge,
    loadTheorist,
    markDirty,
    markWorkoutDirty,
    markMealDirty,
    markKnowledgeDirty,
    markTheoristDirty,
    anyDirty,
    save,
    flush,
    baseRev,
    tomb,
    discard,
    paintChip,
  };
}
