/**
 * Meridian — pure export / import / aggregation.
 *
 * Replaces the derivation half of `renderData` (11.1 KB, 52 branches). The
 * critical property here is round-trip fidelity: whatever the user exports must
 * import back byte-for-byte identical, or a backup is worse than useless.
 *
 * `importBundle` is a validating parser, not a cast. It returns either a fully
 * normalised state or a list of reasons, so the UI can explain a bad file
 * instead of silently writing garbage into storage.
 */

import type { CoreState, KnowledgeState, MealState, WorkoutState } from '@/core/types';
import { toNum } from '@/core/util';

export const BUNDLE_VERSION = 2 as const;

export interface AppState {
  core: CoreState;
  overload: WorkoutState;
  surplus: MealState;
  csgraph: KnowledgeState;
}

export interface Bundle {
  meridian: typeof BUNDLE_VERSION;
  exportedAt: string;
  data: AppState;
}

export type ImportResult =
  | { ok: true; state: AppState; warnings: string[] }
  | { ok: false; errors: string[] };

/* ================================================================== */
/* Normalisation — every import passes through this                    */
/* ================================================================== */

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Deterministically order object keys so two structurally equal states
 * serialise to identical strings. Without this, round-trip comparison would
 * be sensitive to insertion order.
 */
export function canonicalise<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonicalise) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = canonicalise((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

export function normaliseWorkout(raw: unknown): WorkoutState {
  const w = obj(raw);
  const days: WorkoutState['days'] = {};
  for (const [date, sets] of Object.entries(obj(w.days))) {
    days[date] = arr(sets).map((s) => {
      const x = obj(s);
      return {
        id: String(x.id ?? ''),
        ex: String(x.ex ?? ''),
        type: (['warm', 'top', 'back', 'cardio'].includes(String(x.type)) ? x.type : 'top'),
        weight: toNum(x.weight as never, 0),
        reps: toNum(x.reps as never, 0),
        // Cardio-only time/distance — preserved so an export/import round-trip doesn't
        // silently drop a logged run back to a meaningless "0 × 0".
        mins: x.mins === undefined ? undefined : toNum(x.mins as never, 0),
        dist: x.dist === undefined ? undefined : toNum(x.dist as never, 0),
        muscle: x.muscle === undefined ? undefined : String(x.muscle),
        group: x.group === undefined ? undefined : String(x.group),
      } as WorkoutState['days'][string][number];
    });
  }
  const strMap = (v: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [k, val] of Object.entries(obj(v))) out[k] = arr(val).map(String);
    return out;
  };
  const numMap = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(obj(v))) out[k] = toNum(val as never, 0);
    return out;
  };
  const boolMap = (v: unknown): Record<string, boolean> => {
    const out: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(obj(v))) out[k] = val === true;
    return out;
  };
  return {
    settings: obj(w.settings) as WorkoutState['settings'],
    days,
    bw: numMap(w.bw),
    rpe: numMap(w.rpe),
    done: strMap(w.done),
    reopened: strMap(w.reopened),
    sessionDone: boolMap(w.sessionDone),
    incr: numMap(w.incr),
    _del: numMap(w._del),
  };
}

export function normaliseMeals(raw: unknown): MealState {
  const m = obj(raw);
  const days: MealState['days'] = {};
  for (const [date, meals] of Object.entries(obj(m.days))) {
    days[date] = arr(meals).map((x) => {
      const o = obj(x);
      return {
        id: String(o.id ?? ''),
        name: String(o.name ?? ''),
        cal: toNum(o.cal as never, 0),
        protein: toNum(o.protein as never, 0),
        est: o.est === true,
      } as MealState['days'][string][number];
    });
  }
  const tad: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(m.tad))) tad[k] = toNum(v as never, 0);
  const del: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(m._del))) del[k] = toNum(v as never, 0);
  return { settings: obj(m.settings) as MealState['settings'], days, tad, _del: del };
}

export function normaliseCore(raw: unknown): CoreState {
  const c = obj(raw);
  const schedule: CoreState['schedule'] = {};
  for (const [date, items] of Object.entries(obj(c.schedule))) {
    schedule[date] = arr(items).map((x) => {
      const o = obj(x);
      return {
        id: String(o.id ?? ''),
        label: String(o.label ?? ''),
        start: o.start === undefined ? undefined : String(o.start),
        end: o.end === undefined ? undefined : String(o.end),
        done: o.done === true,
      } as CoreState['schedule'][string][number];
    });
  }
  const entries = arr(c.entries).map((x) => {
    const o = obj(x);
    return {
      id: String(o.id ?? ''),
      date: String(o.date ?? ''),
      stream: String(o.stream ?? ''),
      source: o.source === undefined ? undefined : String(o.source),
      xp: toNum(o.xp as never, 0),
    } as CoreState['entries'][number];
  });
  const del: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(c._del))) del[k] = toNum(v as never, 0);
  return { schedule, entries, _del: del };
}

export function normaliseKnowledge(raw: unknown): KnowledgeState {
  const k = obj(raw);
  const mastery: KnowledgeState['mastery'] = {};
  for (const [id, v] of Object.entries(obj(k.mastery))) {
    const n = Math.round(toNum(v as never, 0));
    if (n >= 1 && n <= 5) mastery[id] = n as KnowledgeState['mastery'][string];
  }
  const srs: KnowledgeState['srs'] = {};
  for (const [id, v] of Object.entries(obj(k.srs))) {
    const e = obj(v);
    srs[id] = {
      due: String(e.due ?? ''),
      ivl: toNum((e.ivl ?? e.interval) as never, 0),
      ease: toNum(e.ease as never, 2.5),
      n: toNum((e.n ?? e.reps) as never, 0),
    };
  }
  const gymDone: Record<string, boolean> = {};
  for (const [key, v] of Object.entries(obj(k.gymDone))) gymDone[key] = v === true;
  const log = arr(k.log).map((x) => {
    const o = obj(x);
    return {
      id: String(o.id ?? ''),
      qid: String(o.qid ?? o.id ?? ''),
      at: toNum(o.at as never, 0),
      rating: Math.round(toNum((o.rating ?? o.score) as never, 1)),
    } as KnowledgeState['log'][number];
  });
  return { mastery, srs, gymDone, log };
}

export function normaliseState(raw: unknown): AppState {
  const s = obj(raw);
  return canonicalise({
    core: normaliseCore(s.core),
    overload: normaliseWorkout(s.overload),
    surplus: normaliseMeals(s.surplus),
    csgraph: normaliseKnowledge(s.csgraph),
  });
}

/* ================================================================== */
/* Export / import                                                     */
/* ================================================================== */

export function exportBundle(state: AppState, exportedAt: string): Bundle {
  return { meridian: BUNDLE_VERSION, exportedAt, data: normaliseState(state) };
}

export function serialise(bundle: Bundle): string {
  return JSON.stringify(canonicalise(bundle));
}

/** Parse and validate. Returns reasons rather than throwing. */
export function importBundle(text: string): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['top level must be a JSON object'] };
  }

  const b = parsed as Record<string, unknown>;
  const version = toNum(b.meridian as never, 0);
  let payload: unknown;

  if (version >= 1 && obj(b.data) !== undefined && b.data !== undefined) {
    payload = b.data;
    if (version !== BUNDLE_VERSION) {
      warnings.push(`bundle version ${version}; expected ${BUNDLE_VERSION} — migrated on import`);
    }
  } else if (b.core || b.overload || b.surplus || b.csgraph) {
    payload = b;                       // bare state, no envelope
    warnings.push('no bundle envelope found; treated as a bare state object');
  } else {
    return { ok: false, errors: ['unrecognised file: no meridian bundle or store keys found'] };
  }

  const state = normaliseState(payload);
  const stores = ['core', 'overload', 'surplus', 'csgraph'] as const;
  for (const key of stores) {
    if ((payload as Record<string, unknown>)[key] === undefined) {
      warnings.push(`store "${key}" missing from file; imported as empty`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, state, warnings };
}

/** Round-trip in one call, for tests and for a pre-write self-check. */
export function roundTrip(state: AppState, exportedAt = '1970-01-01'): ImportResult {
  return importBundle(serialise(exportBundle(state, exportedAt)));
}

/* ================================================================== */
/* Aggregation                                                         */
/* ================================================================== */

export interface StorageMetrics {
  bytes: number;
  kilobytes: number;
  perStore: Record<keyof AppState, number>;
  counts: {
    workoutDays: number;
    workoutSets: number;
    mealDays: number;
    meals: number;
    knowledgeItems: number;
    scheduleDays: number;
    entries: number;
    tombstones: number;
  };
}

export function storageMetrics(state: AppState): StorageMetrics {
  const size = (v: unknown): number => JSON.stringify(v ?? null).length;
  const perStore = {
    core: size(state.core),
    overload: size(state.overload),
    surplus: size(state.surplus),
    csgraph: size(state.csgraph),
  };
  const bytes = Object.values(perStore).reduce((a, b) => a + b, 0);
  const workoutSets = Object.values(state.overload.days ?? {}).reduce((a, s) => a + s.length, 0);
  const meals = Object.values(state.surplus.days ?? {}).reduce((a, s) => a + s.length, 0);
  const tombstones =
    Object.keys(state.overload._del ?? {}).length +
    Object.keys(state.surplus._del ?? {}).length +
    Object.keys(state.core._del ?? {}).length;
  return {
    bytes,
    kilobytes: Math.round((bytes / 1024) * 10) / 10,
    perStore,
    counts: {
      workoutDays: Object.keys(state.overload.days ?? {}).length,
      workoutSets,
      mealDays: Object.keys(state.surplus.days ?? {}).length,
      meals,
      knowledgeItems: Object.keys(state.csgraph.mastery ?? {}).length,
      scheduleDays: Object.keys(state.core.schedule ?? {}).length,
      entries: (state.core.entries ?? []).length,
      tombstones,
    },
  };
}

/* ================================================================== */
/* CSV                                                                 */
/* ================================================================== */

/** RFC 4180 quoting: wrap when needed, double embedded quotes. */
export function csvCell(value: unknown): string {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function workoutCsv(state: WorkoutState): string {
  const rows: unknown[][] = [['date', 'exercise', 'type', 'weight', 'reps', 'muscle']];
  for (const date of Object.keys(state.days ?? {}).sort()) {
    for (const s of state.days[date] ?? []) {
      rows.push([date, s.ex, s.type, toNum(s.weight, 0), toNum(s.reps, 0), s.muscle ?? '']);
    }
  }
  return toCsv(rows);
}

export function mealCsv(state: MealState): string {
  const rows: unknown[][] = [['date', 'meal', 'calories', 'protein', 'estimated']];
  for (const date of Object.keys(state.days ?? {}).sort()) {
    for (const m of state.days[date] ?? []) {
      rows.push([date, m.name, toNum(m.cal, 0), toNum(m.protein, 0), m.est ? 'yes' : 'no']);
    }
  }
  return toCsv(rows);
}
