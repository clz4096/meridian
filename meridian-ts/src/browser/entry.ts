/**
 * Single-file PWA entry point.
 *
 * esbuild bundles this as an IIFE and the build script injects the result into
 * index.html, so the legacy inline script can call into the typed core through
 * one global. Nothing else is exposed — the surface is deliberately small so
 * the remaining legacy code cannot reach past the seam.
 */

import {
  DEFAULT_CONFIG,
  type ProgressionConfig,
  type SessionOverrides,
  type Split,
  type WorkoutState,
} from '../types.js';
import { inferIncrement, isCardio, restSeconds, selectWorkoutView } from '../workoutSelectors.js';
import { addTombstone, pruneTombstones, sameId, shiftDate, toNum } from '../util.js';
import { selectMealView, dayTotals, macroConsistency, resolveTargets, supplementView, averageCalories } from '../mealSelectors.js';
import { selectStudyView, schedule, dueCards, MASTERY_LABEL, isDue, normaliseEntry, daysBetween, studyStreak, DEFAULT_SRS } from '../knowledgeSelectors.js';
import { DATA } from '../data/index.js';
import {
  exportBundle, importBundle, serialise, normaliseState, storageMetrics,
  workoutCsv, mealCsv, toCsv, csvCell, roundTrip, canonicalise, BUNDLE_VERSION,
} from '../dataSelectors.js';
import {
  WorkoutViewController,
  type WorkoutActions,
  type WorkoutViewOptions,
} from '../workoutView.js';
import { DomViewHost } from './domHost.js';
import { domId } from '../html.js';
import {
  selectTodayView, scheduleBlocks, streamTotals, entryStreak, parseClock, entriesOn,
} from '../coreSelectors.js';
import { MealViewController, renderMealHTML, type MealActions, type MealViewOptions } from '../mealView.js';
import { DataViewController, renderDataHTML, type DataActions, type DataViewModel } from '../dataView.js';
import {
  KnowledgeViewController, renderKnowledgeHTML, formatReveal, MASTERY_COLOUR, MASTERY_TEXT,
  type KnowledgeActions, type KnowledgeViewModel,
} from '../knowledgeView.js';
import { BrowserStorageAdapter, SupabaseCloudProvider, systemClock } from './adapters.js';
import { aiCall, estimateMacros } from './ai.js';
import { fetchQuestionBank } from './questionBank.js';
import { storeGet } from './store.js';
import { SyncEngine, type SaveResult, type StoreKey } from '../SyncEngine.js';
import { mergeStore, sanitizeStore } from '../mergeStores.js';
import { DomAppHost } from './domAppHost.js';
import { RestTimer } from '../restTimer.js';
import { createAppState, type StoreKey as AppStoreKey } from '../appState.js';
import { createApp, type AppController } from '../app.js';
import type { AppHost } from '../appHost.js';

export interface MountOptions {
  container: HTMLElement;
  actions: WorkoutActions;
  videoUrl(exercise: string): string;
  dateLabel(date: string): string;
}

export interface WorkoutViewHandle {
  /** Recompute and repaint. Returns false when nothing changed. */
  repaint(
    state: WorkoutState,
    date: string,
    today: string,
    overrides?: SessionOverrides,
    bodyweight?: { current: number | null; goal: number | null },
    charts?: string,
    logOpen?: boolean,
    collapsed?: string[],
  ): boolean;
  /** Drop the "user typed here" flag for one exercise after logging. */
  clearEdits(exercise?: string): void;
  host: DomViewHost;
}

function buildOptions(
  state: WorkoutState,
  date: string,
  today: string,
  opts: MountOptions,
  bodyweight: { current: number | null; goal: number | null },
  config: ProgressionConfig,
): WorkoutViewOptions {
  const rest: WorkoutViewOptions['restSeconds'] = {};
  const increments: Record<string, number> = {};
  for (const ex of Object.keys(state.days ?? {}).length ? uniqueExercises(state) : []) {
    rest[ex] = {
      warm: restSeconds(state, ex, 'warm', config),
      top: restSeconds(state, ex, 'top', config),
      back: restSeconds(state, ex, 'back', config),
    };
    increments[ex] = inferIncrement(state, ex, config);
  }
  const toGoal =
    bodyweight.current !== null && bodyweight.goal !== null
      ? Math.round((bodyweight.goal - bodyweight.current) * 10) / 10
      : null;
  return {
    restSeconds: rest,
    increments,
    videoUrl: opts.videoUrl,
    bodyweight: { ...bodyweight, toGoal },
    dateLabel: opts.dateLabel,
    isToday: date === today,
  };
}

function uniqueExercises(state: WorkoutState): string[] {
  const seen = new Set<string>();
  for (const sets of Object.values(state.days ?? {})) {
    for (const s of sets) seen.add(s.ex);
  }
  return [...seen];
}

export function mountWorkoutView(opts: MountOptions): WorkoutViewHandle {
  const host = new DomViewHost(opts.container);
  const controller = new WorkoutViewController(host, opts.actions, (id) => host.readNumber(id));

  return {
    repaint(state, date, today, overrides = {}, bodyweight = { current: null, goal: null }, charts = '', logOpen = false, collapsed = []) {
      const vm = selectWorkoutView(state, date, today, overrides, DEFAULT_CONFIG);
      const options = buildOptions(state, date, today, opts, bodyweight, DEFAULT_CONFIG);
      options.charts = charts;
      options.logOpen = logOpen;
      options.collapsed = collapsed;
      return controller.repaint(vm, options);
    },
    clearEdits(exercise?: string) {
      host.clearUserEdits(exercise);
    },
    host,
  };
}

/* ------------------------------------------------------------------ */
/* Meal + Data view mounts                                              */
/* ------------------------------------------------------------------ */

export function mountMealView(container: HTMLElement, actions: MealActions, options: MealViewOptions) {
  const host = new DomViewHost(container);
  const ctrl = new MealViewController(host, actions, (id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    return el?.value ?? '';
  }, options);
  return {
    repaint(state: Parameters<typeof selectMealView>[0], date: string, today: string, charts = '', logOpen = false) {
      return ctrl.repaint(selectMealView(state, date, today), charts, logOpen);
    },
    host,
  };
}

export function mountKnowledgeView(container: HTMLElement, actions: KnowledgeActions) {
  const host = new DomViewHost(container);
  const ctrl = new KnowledgeViewController(host, actions);
  return { repaint: (vm: KnowledgeViewModel) => ctrl.repaint(vm), host };
}

export function mountDataView(container: HTMLElement, actions: DataActions) {
  const host = new DomViewHost(container);
  const ctrl = new DataViewController(host, actions, (id) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    return el?.value ?? '';
  });
  return { repaint: (vm: DataViewModel) => ctrl.repaint(vm), host };
}

/* ------------------------------------------------------------------ */
/* Sync engine wiring                                                   */
/* ------------------------------------------------------------------ */

/** The four legacy localStorage keys, preserved so existing data loads. */
export const STORAGE_KEYS: Record<StoreKey, string> = {
  core: 'meridian-core',
  overload: 'overload-tracker-state',
  surplus: 'surplus-tracker-state',
  csgraph: 'csgraph_profile_v2',
};

export interface SyncSetup {
  /** Live references to the legacy in-memory stores. */
  read(key: StoreKey): Record<string, unknown>;
  /** Called after a merge so the legacy globals see the merged result. */
  write(key: StoreKey, data: Record<string, unknown>): void;
  onStatus?(result: SaveResult): void;
}

let engine: SyncEngine | null = null;
let setup: SyncSetup | null = null;

export function createSync(config: SyncSetup): SyncEngine {
  setup = config;
  engine = new SyncEngine({
    storage: new BrowserStorageAdapter(STORAGE_KEYS),
    cloud: new SupabaseCloudProvider(() => {
  try {
    const url = localStorage.getItem('meridian_supabase_url');
    const key = localStorage.getItem('meridian_supabase_key');
    return url && key ? { projectUrl: url, anonKey: key } : null;
  } catch { return null; }
}),
    clock: systemClock,
    merge: (local, remote, key, localWins) => mergeStore(key, local, remote, localWins),
    sanitize: (key, data, now) => sanitizeStore(key, data, now),
    minPushGap: 4000,
    rateLimitBackoff: 30_000,
  }, {
    core: config.read('core'),
    overload: config.read('overload'),
    surplus: config.read('surplus'),
    csgraph: config.read('csgraph'),
  });
  return engine;
}

/** Pull the legacy globals into the engine, save, then push results back. */
async function syncSave(): Promise<SaveResult> {
  if (!engine || !setup) throw new Error('sync not initialised — call createSync first');
  for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) {
    const live = setup.read(key);
    if (JSON.stringify(live) !== JSON.stringify(engine.getStore(key))) {
      engine.edit(key, () => live);
    }
  }
  const result = await engine.save();
  for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) {
    setup.write(key, engine.getStore(key));
  }
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
  if (res.applied) {
    for (const key of Object.keys(STORAGE_KEYS) as StoreKey[]) {
      setup.write(key, engine.getStore(key));
    }
  }
  return res.applied;
}

/** Revert to the last persisted state, then push the result back to the host. */
async function syncDiscard(): Promise<{ restored: StoreKey[]; skipped: StoreKey[] }> {
  if (!engine || !setup) return { restored: [], skipped: [] };
  const res = await engine.discard();
  for (const key of res.restored) setup.write(key, engine.getStore(key));
  return res;
}

const sync = {
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

/* Global surface consumed by the remaining legacy inline script. */
const api = {
  // static build-time content (seed workout, book registry, gym/topics/targets, exercise videos)
  data: DATA,

  // AI service (meal estimation, Knowledge answer/grade) via the OpenRouter proxy
  aiCall, estimateMacros,

  // question-bank loader (fetch + offline cache)
  fetchQuestionBank,

  // durable local read store (3-backend, newest-wins) for the boot loaders
  storeGet,

  mountWorkoutView,
  selectWorkoutView,
  // pure helpers the legacy code still needs while it is being strangled
  inferIncrement,
  restSeconds,
  isCardio,
  shiftDate,
  toNum,
  sameId,
  pruneTombstones,
  addTombstone,
  DEFAULT_CONFIG,

  // meals & supplements
  selectMealView, dayTotals, macroConsistency, resolveTargets, supplementView, averageCalories,

  // knowledge & spaced repetition
  selectStudyView, schedule, dueCards, MASTERY_LABEL, isDue, normaliseEntry, daysBetween, studyStreak, DEFAULT_SRS,

  // data: export / import / metrics
  exportBundle, importBundle, serialise, normaliseState, storageMetrics,
  workoutCsv, mealCsv, toCsv, csvCell, roundTrip, canonicalise, BUNDLE_VERSION,

  // today / study derivation
  selectTodayView, scheduleBlocks, streamTotals, entryStreak, parseClock, entriesOn,

  // views
  mountMealView,
  mountDataView,
  mountKnowledgeView,
  renderKnowledgeHTML,
  formatReveal,
  MASTERY_COLOUR,
  MASTERY_TEXT,
  renderMealHTML,
  renderDataHTML,

  // sync engine
  sync,
  mergeStore,
  sanitizeStore,

  // app-shell mount (no-op stub until the orchestration slices land)
  mountApp,
  DomAppHost,
  RestTimer,
  createAppState,
  createApp,
  domId,
};

declare global {
  interface Window {
    MeridianCore: typeof api;
  }
}
window.MeridianCore = api;

/* ------------------------------------------------------------------ */
/* App-shell mount (grown across the app.ts migration slices)           */
/* ------------------------------------------------------------------ */

/**
 * Mount the whole app against an {@link AppHost} — the composition root.
 *
 * Owns the four store objects and wires them to the SyncEngine (via appState) and
 * the view layer (app.ts); installs routing, the save-chip/discard handlers,
 * window lifecycle, and boot. index.html is reduced to a single call to this.
 */
export function mountApp(host: AppHost): void {
  const KEYS = STORAGE_KEYS;

  /* Impure browser helpers: session-unique ids + local-date formatting. */
  let uidSeq = 0;
  const uid = (): string => {
    uidSeq = (uidSeq + 1) % 1000000;
    return Date.now().toString(36) + '-' + uidSeq.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  };
  const dstr = (d?: Date): string => {
    const dt = d ?? new Date();
    return (
      dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0')
    );
  };
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dLabel = (ds: string): string => {
    const p = ds.split('-');
    const dt = new Date(+p[0], +p[1] - 1, +p[2]);
    return (ds === dstr() ? 'Today · ' : '') + WD[dt.getDay()] + ', ' + MO[dt.getMonth()] + ' ' + dt.getDate();
  };
  const cloudEnabled = (): boolean =>
    !!(host.getItem('meridian_supabase_url') && host.getItem('meridian_supabase_key'));

  /* The four store objects — owned here, bridged to the SyncEngine + app.ts. */
  const stores: Record<AppStoreKey, Record<string, unknown>> = {
    core: { schedule: {}, entries: [] },
    overload: { settings: {}, days: {}, bw: {}, rpe: {} },
    surplus: { settings: {}, days: {}, tad: {} },
    csgraph: { mastery: {}, srs: {}, log: [], gymDone: {} },
  };

  let app: AppController;

  const appState = createAppState({
    host,
    storeGet: api.storeGet,
    sync: api.sync,
    keys: KEYS,
    defaultWorkout: api.data.defaultWorkout as Record<string, unknown>,
    read: (key) => stores[key] || {},
    write: (key, data) => {
      stores[key] = data;
      host.setItem(KEYS[key], JSON.stringify(data));
    },
    now: () => Date.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h),
    onExternalChange: () => app.renderAll(),
    markFlush: (reason) => host.setItem('meridian_last_flush', new Date().toISOString() + ' (' + reason + ')'),
  });

  app = createApp(host, {
    MC: api,
    appState,
    keys: KEYS,
    uid,
    today: () => dstr(),
    now: () => Date.now(),
    dateLabel: dLabel,
    cloudEnabled,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (h) => window.clearInterval(h),
    pushState: () => window.history.pushState({ meridianDetail: 1 }, ''),
  });

  appState.init();

  // Browser/OS back returns a tab's Detail screen to its Progress screen.
  window.addEventListener('popstate', () => {
    app.handleBack();
  });

  /* --- tab routing --- */
  host.onTabChange((tab) => {
    // Open each tab at the top. Swapping a tab's content while the page is scrolled is
    // what makes iOS re-anchor the fixed bottom bar (the "jump"); resetting first avoids it.
    window.scrollTo(0, 0);
    host.showTab(tab);
    if (tab === 'workout') app.renderWorkout();
    else if (tab === 'knowledge') app.renderKnowledge();
    else if (tab === 'meal') app.renderWeight();
    else if (tab === 'data') app.renderData();
  });

  /* --- save chip + discard (cancel unsaved changes) --- */
  host.onSave(() => void appState.save());
  host.onDiscard(() => {
    if (!appState.anyDirty()) return;
    if (!host.confirm('Discard all unsaved changes and return to the last saved state?')) return;
    void appState.discard().then((ok) => {
      if (ok) host.flashSaved();
    });
  });

  /* --- window lifecycle: flush on background, opportunistic pull on foreground, ⌘S save --- */
  host.onLifecycle('hide', () => appState.flush('hidden'));
  host.onLifecycle('visible', () => {
    if (cloudEnabled() && !appState.anyDirty()) {
      void api.sync
        .pull()
        .then((applied) => {
          if (applied) app.renderAll();
        })
        .catch(() => {
          /* offline — fine */
        });
    }
  });
  host.onLifecycle('save-shortcut', () => void appState.save());

  /* --- boot --- */
  void (async () => {
    stores.core = await appState.loadCore();
    appState.paintChip();
    host.showTab('knowledge');
    app.renderKnowledge();
    // Pull from cloud in the background once the UI is ready.
    if (cloudEnabled()) {
      window.setTimeout(async () => {
        try {
          const applied = await api.sync.pull();
          if (applied) app.renderAll();
        } catch {
          /* offline — fine */
        }
      }, 2000);
    }
  })();
}

export type { Split, WorkoutActions };
