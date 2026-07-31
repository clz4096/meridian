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
import { SyncEngine, type SaveResult, type StoreKey } from '../SyncEngine.js';
import { mergeStore, sanitizeStore } from '../mergeStores.js';

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
      ? bodyweight.goal - bodyweight.current
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
    repaint(state, date, today, overrides = {}, bodyweight = { current: null, goal: null }) {
      const vm = selectWorkoutView(state, date, today, overrides, DEFAULT_CONFIG);
      const options = buildOptions(state, date, today, opts, bodyweight, DEFAULT_CONFIG);
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
    repaint(state: Parameters<typeof selectMealView>[0], date: string, today: string) {
      return ctrl.repaint(selectMealView(state, date, today));
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
};

declare global {
  interface Window {
    MeridianCore: typeof api;
  }
}
window.MeridianCore = api;

export type { Split, WorkoutActions };
