/**
 * Meridian — merge semantics for the four real stores.
 *
 * Union-by-id for collections, key-wise last-writer-wins for scalars, and
 * tombstones that suppress a row from either side. Each operation is
 * commutative and idempotent, which is what makes convergence provable.
 */

import type {
  CoreState, KnowledgeState, MealState, Millis, Tombstones, WorkoutState,
} from '@/core/types';
import { pruneTombstones, toId, toNum } from '@/core/util';
import { DEFAULT_CONFIG } from '@/core/types';

export type StoreKey = 'core' | 'overload' | 'surplus' | 'csgraph';

interface Identified { id: unknown }

const deadSet = (...maps: Array<Tombstones | undefined>): Set<string> => {
  const s = new Set<string>();
  for (const m of maps) for (const k of Object.keys(m ?? {})) s.add(toId(k));
  return s;
};

/** Union two arrays by id, dropping anything tombstoned on either side. */
export function unionById<T extends Identified>(
  local: readonly T[] | undefined,
  remote: readonly T[] | undefined,
  dead: Set<string>,
): T[] {
  const byId = new Map<string, T>();
  for (const item of [...(remote ?? []), ...(local ?? [])]) {
    if (!item) continue;
    const id = toId(item.id);
    if (id === '' || dead.has(id)) continue;
    byId.set(id, item);           // local wins on a genuine id collision
  }
  return [...byId.values()];
}

/** Merge `{date: item[]}` maps, dropping days that end up empty. */
export function mergeDayMap<T extends Identified>(
  a: Record<string, T[]> | undefined,
  b: Record<string, T[]> | undefined,
  dead: Set<string>,
): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const merged = unionById(a?.[key], b?.[key], dead);
    if (merged.length > 0) out[key] = merged;
  }
  return out;
}

/** Key-wise last-writer-wins. Disjoint keys always both survive. */
export function mergeScalarMap<V>(
  a: Record<string, V> | undefined,
  b: Record<string, V> | undefined,
  aWins: boolean,
): Record<string, V> {
  const out: Record<string, V> = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const av = a?.[key];
    const bv = b?.[key];
    out[key] = av === undefined ? (bv as V) : bv === undefined ? av : aWins ? av : bv;
  }
  return out;
}

/** Union `{date: string[]}` maps — used for completion flags. */
export function mergeListMap(
  a: Record<string, string[]> | undefined,
  b: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    out[key] = [...new Set([...(a?.[key] ?? []), ...(b?.[key] ?? [])])].sort();
  }
  return out;
}

const mergeTombs = (a?: Tombstones, b?: Tombstones): Tombstones => {
  const out: Tombstones = { ...(b ?? {}) };
  for (const [k, v] of Object.entries(a ?? {})) {
    out[k] = Math.max(toNum(out[k] as never, 0), toNum(v as never, 0)) as Millis;
  }
  return out;
};

/* ------------------------------------------------------------------ */

export function mergeWorkout(local: WorkoutState, remote: WorkoutState, localWins: boolean): WorkoutState {
  const dead = deadSet(local._del, remote._del);
  return {
    settings: mergeScalarMap(local.settings as never, remote.settings as never, localWins) as WorkoutState['settings'],
    days: mergeDayMap(local.days, remote.days, dead),
    bw: mergeScalarMap(local.bw, remote.bw, localWins),
    rpe: mergeScalarMap(local.rpe, remote.rpe, localWins),
    done: mergeListMap(local.done, remote.done),
    sessionDone: mergeScalarMap(local.sessionDone, remote.sessionDone, localWins),
    incr: mergeScalarMap(local.incr, remote.incr, localWins),
    _del: mergeTombs(local._del, remote._del),
  };
}

export function mergeMeals(local: MealState, remote: MealState, localWins: boolean): MealState {
  const dead = deadSet(local._del, remote._del);
  return {
    settings: mergeScalarMap(local.settings as never, remote.settings as never, localWins) as MealState['settings'],
    days: mergeDayMap(local.days, remote.days, dead),
    tad: mergeScalarMap(local.tad, remote.tad, localWins),
    _del: mergeTombs(local._del, remote._del),
  };
}

export function mergeCore(local: CoreState, remote: CoreState, _localWins: boolean): CoreState {
  const dead = deadSet(local._del, remote._del);
  return {
    schedule: mergeDayMap(local.schedule, remote.schedule, dead),
    entries: unionById(local.entries, remote.entries, dead),
    _del: mergeTombs(local._del, remote._del),
  };
}

export function mergeKnowledge(local: KnowledgeState, remote: KnowledgeState, localWins: boolean): KnowledgeState {
  return {
    mastery: mergeScalarMap(local.mastery, remote.mastery, localWins),
    srs: mergeScalarMap(local.srs, remote.srs, localWins),
    gymDone: mergeScalarMap(local.gymDone, remote.gymDone, localWins),
    log: unionById(local.log, remote.log, new Set()),
  };
}

/** Dispatch by store key. This is the `MergeFn` the SyncEngine is given. */
export function mergeStore(
  key: StoreKey,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  localWins: boolean,
): Record<string, unknown> {
  switch (key) {
    case 'overload': return mergeWorkout(local as never, remote as never, localWins) as never;
    case 'surplus':  return mergeMeals(local as never, remote as never, localWins) as never;
    case 'core':     return mergeCore(local as never, remote as never, localWins) as never;
    case 'csgraph':  return mergeKnowledge(local as never, remote as never, localWins) as never;
    default:         return localWins ? local : remote;
  }
}

/**
 * Bound tombstone growth before a store is written.
 *
 * The audit found `_del` growing without limit on any device that never
 * synced, because pruning only happened inside the cloud merge. Wiring this
 * into the save lifecycle patches the leak regardless of network state.
 */
export function sanitizeStore(
  key: StoreKey,
  data: Record<string, unknown>,
  now: number,
): Record<string, unknown> {
  if (key === 'csgraph') return data;
  const del = (data as { _del?: Tombstones })._del;
  if (!del || Object.keys(del).length === 0) return data;
  const pruned = pruneTombstones(del, now, DEFAULT_CONFIG);
  if (Object.keys(pruned).length === Object.keys(del).length) return data;
  return { ...data, _del: pruned };
}
