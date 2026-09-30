/**
 * Meridian — merge semantics for the six real stores.
 *
 * Union-by-id for collections, key-wise last-writer-wins for scalars, and
 * tombstones that suppress a row from either side. Each operation is
 * commutative and idempotent, which is what makes convergence provable.
 */

import type {
  CoreState, KnowledgeState, MealState, Millis, TheoristState, Tombstones, WorkoutState,
} from '@/core/types';
import { pruneTombstones, toId, toNum } from '@/core/util';
import { DEFAULT_CONFIG } from '@/core/types';
import type { CamItem, CamQuestion, CambridgeState } from '@/features/cambridge/types';

export type StoreKey = 'core' | 'overload' | 'surplus' | 'csgraph' | 'theorist' | 'cambridge';

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
    reopened: mergeListMap(local.reopened, remote.reopened),
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
    todos: unionById(local.todos, remote.todos, dead),
    scratch: unionById(local.scratch, remote.scratch, dead),
    _del: mergeTombs(local._del, remote._del),
  };
}

const EMPTY_KNOWLEDGE: KnowledgeState = { mastery: {}, srs: {}, log: [], gymDone: {} };

/** A copy of `m` without the keys in `dead` (used to drop discarded generated ids). */
function without<T>(m: Record<string, T>, dead: ReadonlySet<string>): Record<string, T> {
  if (dead.size === 0) return m;
  const out: Record<string, T> = {};
  for (const k of Object.keys(m)) if (!dead.has(k)) out[k] = m[k]!;
  return out;
}

export function mergeKnowledge(local: KnowledgeState, remote: KnowledgeState, localWins: boolean): KnowledgeState {
  // Reset epoch: a "Reset knowledge" bumps `resetAt` and empties the store. Since
  // knowledge has no per-id tombstones, the union would otherwise resurrect the
  // other device's stale entries. Discard any side older than the newest epoch so
  // the wipe propagates and sticks; sides AT the same epoch union normally (so a
  // fresh answer made after the reset survives). Both 0 → ordinary union.
  const lEpoch = toNum(local.resetAt, 0);
  const rEpoch = toNum(remote.resetAt, 0);
  const epoch = Math.max(lEpoch, rEpoch);
  const l = lEpoch === epoch ? local : EMPTY_KNOWLEDGE;
  const r = rEpoch === epoch ? remote : EMPTY_KNOWLEDGE;
  const deadGen = new Set<string>([...(l.genDiscarded ?? []), ...(r.genDiscarded ?? [])]);
  return {
    ...(epoch > 0 ? { resetAt: epoch as KnowledgeState['resetAt'] } : {}),
    mastery: without(mergeScalarMap(l.mastery, r.mastery, localWins), deadGen),
    srs: without(mergeScalarMap(l.srs, r.srs, localWins), deadGen),
    gymDone: mergeScalarMap(l.gymDone, r.gymDone, localWins),
    log: unionById(l.log, r.log, new Set()).filter((e) => !deadGen.has(String((e as { qid?: string }).qid ?? ''))),
    // AI-generated cards union by id per topic — but a DISCARDED id (genDiscarded, a
    // grow-only tombstone) is dropped on both sides so a discard sticks across devices
    // instead of resurrecting from the other side; its progress/log are stripped above.
    generated: mergeDayMap(l.generated, r.generated, deadGen),
    ...(deadGen.size ? { genDiscarded: [...deadGen] } : {}),
  };
}

const EMPTY_THEORIST: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false } };

/**
 * Merge two Study Tracker stores. Mirrors {@link mergeKnowledge}: a global reset
 * bumps `resetAt` and empties the store, and since the tracker has no per-key
 * tombstones the union would otherwise resurrect the other device's stale
 * banked days. Any side older than the newest epoch is discarded so the wipe
 * propagates and sticks; sides AT the same epoch merge normally. Both 0 →
 * ordinary merge.
 *
 * `banked` is a grow-only map: keys only ever added and values only ever rise
 * (per-key `Math.max`), except when a strictly-greater `resetAt` empties it.
 * `day` is picked by the later ISO date, or unioned (OR/max) on a tie.
 *
 * Phase 2 adds two ADDITIVE, absent-safe day fields: `events` (per-key max
 * union) and `dayType` (LWW by `dayTouchedAt`, tie → 'light'). On different
 * dates both ride with the winning `day`; a `resetAt` wipe drops them with the
 * day (EMPTY_THEORIST carries neither).
 *
 * Phase 3 adds a TOP-LEVEL, absent-safe `mastery` map merged per-topic LWW by
 * the larger `reviewedAt` (tie → larger `level`). It is date-independent (unlike
 * `day`) and a `resetAt` wipe clears it with the stale side.
 */
export function mergeTheorist(local: TheoristState, remote: TheoristState, _localWins: boolean): TheoristState {
  const lEpoch = toNum(local.resetAt, 0);
  const rEpoch = toNum(remote.resetAt, 0);
  const epoch = Math.max(lEpoch, rEpoch);
  const l = lEpoch === epoch ? local : EMPTY_THEORIST;
  const r = rEpoch === epoch ? remote : EMPTY_THEORIST;

  // banked: per-key union, Math.max on collision (monotone, never loses a day).
  const banked: Record<string, number> = {};
  for (const k of new Set([...Object.keys(l.banked ?? {}), ...Object.keys(r.banked ?? {})])) {
    const lv = l.banked?.[k];
    const rv = r.banked?.[k];
    banked[k] = lv === undefined ? rv! : rv === undefined ? lv : Math.max(lv, rv);
  }

  // day: the later ISO date wins wholesale (carrying its dayTouchedAt); on the
  // same date, OR the blocks/banked flag and max the scores so no tick is lost.
  const ld = l.day ?? EMPTY_THEORIST.day;
  const rd = r.day ?? EMPTY_THEORIST.day;
  const lTouched = toNum(l.dayTouchedAt, 0);
  const rTouched = toNum(r.dayTouchedAt, 0);
  let day: TheoristState['day'];
  let dayTouchedAt: number;
  if (ld.date === rd.date) {
    const blocks: Record<string, boolean> = {};
    for (const k of new Set([...Object.keys(ld.blocks ?? {}), ...Object.keys(rd.blocks ?? {})])) {
      blocks[k] = !!(ld.blocks?.[k] || rd.blocks?.[k]);
    }
    const scores: Record<string, number> = {};
    for (const k of new Set([...Object.keys(ld.scores ?? {}), ...Object.keys(rd.scores ?? {})])) {
      const lv = ld.scores?.[k];
      const rv = rd.scores?.[k];
      scores[k] = lv === undefined ? rv! : rv === undefined ? lv : Math.max(lv, rv);
    }
    // events (Phase 3, additive): per-key max union, absent-safe. Only present
    // when at least one side carried the field, so an old-shape day (no events)
    // merges to an old-shape day. Max is an idempotent lattice op → CRDT-safe.
    let events: Record<string, number> | undefined;
    if (ld.events || rd.events) {
      events = {};
      for (const k of new Set([...Object.keys(ld.events ?? {}), ...Object.keys(rd.events ?? {})])) {
        const lv = ld.events?.[k];
        const rv = rd.events?.[k];
        events[k] = lv === undefined ? rv! : rv === undefined ? lv : Math.max(lv, rv);
      }
    }
    // dayType (additive): absent-safe LWW by dayTouchedAt. Equal values need no
    // tiebreak (keeps it idempotent even though dayTouchedAt converges to the
    // max); a touch tie between DIFFERING values prefers 'light' (deterministic
    // ⇒ commutative).
    const ldt = ld.dayType;
    const rdt = rd.dayType;
    let dayType: 'full' | 'light' | undefined;
    if (ldt === undefined) dayType = rdt;
    else if (rdt === undefined) dayType = ldt;
    else if (ldt === rdt) dayType = ldt;
    else if (lTouched !== rTouched) dayType = lTouched > rTouched ? ldt : rdt;
    else dayType = 'light';
    day = {
      date: ld.date,
      blocks,
      scores,
      banked: !!(ld.banked || rd.banked),
      ...(events ? { events } : {}),
      ...(dayType ? { dayType } : {}),
    };
    dayTouchedAt = Math.max(lTouched, rTouched);
  } else {
    // Different dates. The '' EMPTY sentinel always loses to a real day.
    // Otherwise prefer the day touched more recently — this guards an active
    // older-date in-progress day from being clobbered by a rolled-over EMPTY
    // newer-date day across a midnight/timezone boundary (which would drop
    // unbanked ticks). On a dayTouchedAt tie, the later ISO date wins.
    // Commutative + idempotent: the choice is a pure function of the two
    // (date, dayTouchedAt) pairs, and dayTouchedAt converges to the max.
    const pickRemote =
      ld.date === '' ? true :
      rd.date === '' ? false :
      rTouched !== lTouched ? rTouched > lTouched :
      rd.date > ld.date;
    day = pickRemote ? rd : ld;
    dayTouchedAt = Math.max(lTouched, rTouched);
  }

  // mastery (Phase 3, additive, TOP-LEVEL): per-topic LWW by the LARGER
  // `reviewedAt`. Only present when at least one (current-epoch) side carried
  // it, so an old-shape store stays old-shape and a reset wipe drops it with the
  // stale side (EMPTY_THEORIST carries no mastery). A `reviewedAt` tie takes the
  // larger `level` — deterministic, so the result is commutative + idempotent.
  let mastery: TheoristState['mastery'];
  if (l.mastery || r.mastery) {
    mastery = {};
    for (const k of new Set([...Object.keys(l.mastery ?? {}), ...Object.keys(r.mastery ?? {})])) {
      const lv = l.mastery?.[k];
      const rv = r.mastery?.[k];
      if (lv === undefined) { mastery[k] = rv!; continue; }
      if (rv === undefined) { mastery[k] = lv; continue; }
      if (lv.reviewedAt !== rv.reviewedAt) mastery[k] = lv.reviewedAt > rv.reviewedAt ? lv : rv;
      else mastery[k] = lv.level >= rv.level ? lv : rv;
    }
  }

  return {
    banked,
    day,
    ...(dayTouchedAt > 0 ? { dayTouchedAt } : {}),
    ...(mastery ? { mastery } : {}),
    ...(epoch > 0 ? { resetAt: epoch as Millis } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Cambridge: per-record last-writer-wins                               */
/* ------------------------------------------------------------------ */

interface Stamped { updatedAt: number; deleted?: boolean }

/**
 * The newer of two copies of one record. A tie must still pick the same copy
 * whichever side is local, or two devices would each keep their own and never
 * converge: a tombstone wins the tie (a delete is the more deliberate act), then
 * the larger serialisation, which is arbitrary but symmetric.
 */
function newer<T extends Stamped>(a: T, b: T): T {
  const at = toNum(a.updatedAt, 0);
  const bt = toNum(b.updatedAt, 0);
  if (at !== bt) return at > bt ? a : b;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function mergeRecords<T extends Stamped>(
  a: Record<string, T> | undefined,
  b: Record<string, T> | undefined,
  pick: (a: T, b: T) => T = newer,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const av = a?.[k];
    const bv = b?.[k];
    out[k] = av === undefined ? bv! : bv === undefined ? av : pick(av, bv);
  }
  return out;
}

/**
 * Orders two copies of one item: the later stamp, then a tombstone, then the
 * larger serialisation of everything but the questions. 0 means the copies are
 * identical apart from their questions. The questions are left out because the
 * merge changes them, and a merged copy must compare exactly as its source did,
 * or merging in a different order would give a different answer.
 */
function itemOrder(a: CamItem, b: CamItem): number {
  const at = toNum(a.updatedAt, 0);
  const bt = toNum(b.updatedAt, 0);
  if (at !== bt) return at - bt;
  if (!!a.deleted !== !!b.deleted) return a.deleted ? 1 : -1;
  const ra = JSON.stringify({ ...a, questions: undefined });
  const rb = JSON.stringify({ ...b, questions: undefined });
  return ra === rb ? 0 : ra > rb ? 1 : -1;
}

/**
 * Orders two copies of one question from equally new items. A bare timer
 * (nothing but its cold time, as the merge leaves a question only an older copy
 * had) always loses to a copy with more fields.
 */
function questionOrder(a: CamQuestion, b: CamQuestion): number {
  const fields = (q: CamQuestion): number => Object.entries(q).filter(([k, v]) => k !== 'coldSec' && v !== undefined).length;
  const d = fields(a) - fields(b);
  if (d !== 0) return d;
  const ka = JSON.stringify({ ...a, coldSec: undefined });
  const kb = JSON.stringify({ ...b, coldSec: undefined });
  return ka === kb ? 0 : ka > kb ? 1 : -1;
}

/** Every question from both sides; on a clash the larger by `questionOrder`, always with the larger cold time. */
function joinQuestions(a: CamItem['questions'], b: CamItem['questions']): CamItem['questions'] {
  const out: CamItem['questions'] = {};
  for (const q of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    const aq = a?.[q];
    const bq = b?.[q];
    if (!aq || !bq) { out[q] = (aq ?? bq)!; continue; }
    const base = questionOrder(aq, bq) >= 0 ? aq : bq;
    out[q] = { ...base, coldSec: Math.max(toNum(aq.coldSec, 0), toNum(bq.coldSec, 0)) };
  }
  return out;
}

/**
 * The newer item wins, fields and questions alike, except that cold-attempt
 * time never goes down: each question keeps the largest time any copy has, and
 * a question only the older copy had stays as a bare timer (its time, not its
 * other fields, which go with the older copy). Minutes spent thinking are real
 * work, so they are never merged away. Because the timers form a max-register
 * per question and everything else is a single winner, the result is the same
 * in whatever order devices sync (the property test checks associativity).
 */
function mergeItem(a: CamItem, b: CamItem): CamItem {
  const order = itemOrder(a, b);
  if (order === 0) return { ...a, questions: joinQuestions(a.questions, b.questions) };
  const [win, lose] = order > 0 ? [a, b] : [b, a];
  let questions: CamItem['questions'] | null = null;
  for (const [q, lq] of Object.entries(lose.questions ?? {})) {
    const wq = win.questions?.[q];
    const sec = toNum(lq.coldSec, 0);
    if (wq && sec <= toNum(wq.coldSec, 0)) continue;
    questions ??= { ...(win.questions ?? {}) };
    questions[q] = wq ? { ...wq, coldSec: sec } : { q, coldSec: sec };
  }
  return questions ? { ...win, questions } : win;
}

/**
 * Merge two Cambridge stores (contract 1.1). Items, errors, gates and weeks are
 * last-writer-wins per record by `updatedAt`, so an edit reaches the other
 * device (unlike `unionById`, where local always wins). Deletions are
 * tombstones carried by the record itself. `awarded` is a grow-only union that
 * keeps the earliest payout time, so an XP guard can never be lost.
 */
export function mergeCambridge(local: CambridgeState, remote: CambridgeState, _localWins: boolean): CambridgeState {
  const awarded: Record<string, number> = {};
  for (const k of new Set([...Object.keys(local.awarded ?? {}), ...Object.keys(remote.awarded ?? {})])) {
    const lv = local.awarded?.[k];
    const rv = remote.awarded?.[k];
    awarded[k] = lv === undefined ? rv! : rv === undefined ? lv : Math.min(lv, rv);
  }
  const lm = toNum(local.migratedAt, 0);
  const rm = toNum(remote.migratedAt, 0);
  const migratedAt = lm && rm ? Math.min(lm, rm) : lm || rm;
  return {
    v: 1,
    items: mergeRecords(local.items, remote.items, mergeItem),
    errors: mergeRecords(local.errors, remote.errors),
    gates: mergeRecords(local.gates, remote.gates),
    weeks: mergeRecords(local.weeks, remote.weeks),
    awarded,
    ...(migratedAt ? { migratedAt } : {}),
  };
}

/** Drop Cambridge tombstones older than the shared tombstone age (30 days). */
function pruneCambridge(data: CambridgeState, now: number): CambridgeState {
  const cutoff = now - DEFAULT_CONFIG.tombstoneMaxAgeDays * 86_400_000;
  const stale = (r: Stamped): boolean => !!r.deleted && toNum(r.updatedAt, 0) <= cutoff;
  const keep = <T extends Stamped>(m: Record<string, T> | undefined): Record<string, T> | null => {
    if (!m || !Object.values(m).some(stale)) return null;
    return Object.fromEntries(Object.entries(m).filter(([, r]) => !stale(r)));
  };
  const items = keep(data.items);
  const errors = keep(data.errors);
  if (!items && !errors) return data;
  return { ...data, ...(items ? { items } : {}), ...(errors ? { errors } : {}) };
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
    case 'theorist': return mergeTheorist(local as never, remote as never, localWins) as never;
    case 'cambridge': return mergeCambridge(local as never, remote as never, localWins) as never;
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
  if (key === 'csgraph' || key === 'theorist') return data;
  if (key === 'cambridge') return pruneCambridge(data as never, now) as never;
  const del = (data as { _del?: Tombstones })._del;
  if (!del || Object.keys(del).length === 0) return data;
  const pruned = pruneTombstones(del, now, DEFAULT_CONFIG);
  if (Object.keys(pruned).length === Object.keys(del).length) return data;
  return { ...data, _del: pruned };
}
