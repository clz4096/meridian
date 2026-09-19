// @vitest-environment jsdom
/**
 * Study Tracker sync tests.
 *
 * jsdom is required: the projection reality-check drives the real `appState`
 * singleton (which reads localStorage), and the migration fold reads the legacy
 * `meridian.tracker.v1` blob + marker directly from localStorage. The merge and
 * registration properties are otherwise pure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { TheoristState } from '@/core/types';
import { mergeTheorist, mergeStore as merge } from '@/core/sync/mergeStores';
import { normaliseTheorist } from '@/features/data/dataSelectors';
import { createAppState, type SaveResult, type StoreKey } from '@/core/storage/appState';
import {
  SyncEngine, STORE_KEYS,
  type CloudPayload, type CloudReadResult, type CloudWriteResult, type StorageAdapter, type CloudProvider,
} from '@/core/sync/SyncEngine';
import { appState } from '@/app/bootstrap';
import {
  syncTrackerFromStore, trackerState, levelIndex, dayXP, streakCount, todayISO,
  creditEvent, currentMastery, reviewTopic, markTopicReviewed, stalestTopic,
  weeklySessions, setDayType,
  EVENT_WEIGHTS, HALF_LIFE_DAYS, WEEKLY_TARGET,
} from '@/features/studytracker/trackerStore';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;

/** Deterministic key-sorted serialisation so two structurally-equal states compare equal. */
const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
};
const canon = (v: unknown): string => JSON.stringify(sortKeys(v));

/* ── arbitraries ── */
const arbBankKey = fc.oneof(
  fc.constantFrom('2026-01-01', '2026-01-02', '2026-02-15', '2026-09-30'),
  fc.constant('__carry'),
);
const arbBanked = fc.dictionary(arbBankKey, fc.nat({ max: 5000 }), { maxKeys: 5 });
const arbBlockId = fc.constantFrom('b1', 'b4', 'b8', 'b12');
const arbScoreId = fc.constantFrom('s1', 's2', 's7');
const arbEventId = fc.constantFrom('e1', 'e2', 'e3');
const arbDate = fc.constantFrom('', '2026-01-01', '2026-01-02', '2026-05-05');
// Phase 2 additive fields (`events`, `dayType`) are fuzzed as optional so the
// algebra properties also exercise present/absent/empty combinations.
const arbDay = fc.record({
  date: arbDate,
  blocks: fc.dictionary(arbBlockId, fc.boolean(), { maxKeys: 4 }),
  scores: fc.dictionary(arbScoreId, fc.constantFrom(0, 1, 2), { maxKeys: 3 }),
  banked: fc.boolean(),
  events: fc.option(fc.dictionary(arbEventId, fc.nat({ max: 500 }), { maxKeys: 3 }), { nil: undefined }),
  dayType: fc.option(fc.constantFrom('full', 'light'), { nil: undefined }),
});
// Phase 3 additive TOP-LEVEL field (`mastery`) fuzzed as optional so the algebra
// properties exercise present/absent/empty combinations and the reviewedAt tie.
const arbTopic = fc.constantFrom('COS 226', 'MIT 6.006', 'MIT 18.06');
const arbMastery = fc.option(
  fc.dictionary(arbTopic, fc.record({ level: fc.constantFrom(0, 0.3, 0.5, 1), reviewedAt: fc.constantFrom(10, 20, 30) }), { maxKeys: 3 }),
  { nil: undefined },
);
const arbTheorist: fc.Arbitrary<TheoristState> = fc.record({
  banked: arbBanked,
  day: arbDay,
  dayTouchedAt: fc.option(fc.integer({ min: 1, max: 1e12 }), { nil: undefined }),
  mastery: arbMastery,
  resetAt: fc.option(fc.constantFrom(0, 100, 200, 300), { nil: undefined }),
}) as fc.Arbitrary<TheoristState>;

/* A theorist with no reset epoch, for the union invariants that only hold at an equal epoch. */
const arbNoReset: fc.Arbitrary<TheoristState> = fc.record({
  banked: arbBanked,
  day: arbDay,
  dayTouchedAt: fc.option(fc.integer({ min: 1, max: 1e12 }), { nil: undefined }),
  mastery: arbMastery,
}) as fc.Arbitrary<TheoristState>;

describe('mergeTheorist algebra', () => {
  it('is commutative (localWins is irrelevant — max/later-date tiebreaks)', () => {
    fc.assert(fc.property(arbTheorist, arbTheorist, (a, b) => {
      expect(canon(mergeTheorist(a, b, true))).toBe(canon(mergeTheorist(b, a, false)));
    }), opts);
  });

  it('is idempotent — folding an input already merged in changes nothing', () => {
    fc.assert(fc.property(arbTheorist, arbTheorist, (a, b) => {
      const m = mergeTheorist(a, b, true);
      expect(canon(mergeTheorist(m, a, true))).toBe(canon(m));
      expect(canon(mergeTheorist(m, b, true))).toBe(canon(m));
    }), opts);
  });

  it('never loses a banked day at an equal epoch, and values only rise (monotone)', () => {
    fc.assert(fc.property(arbNoReset, arbNoReset, (a, b) => {
      const m = mergeTheorist(a, b, true);
      for (const k of new Set([...Object.keys(a.banked), ...Object.keys(b.banked)])) {
        const expected = Math.max(a.banked[k] ?? -Infinity, b.banked[k] ?? -Infinity);
        expect(m.banked[k]).toBe(expected);
      }
    }), opts);
  });

  it('propagates a reset epoch — the older side is wiped and the epoch sticks', () => {
    const fresh: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, resetAt: 500 };
    const stale: TheoristState = {
      banked: { '2026-01-01': 100, '__carry': 900 },
      day: { date: '2026-01-01', blocks: { b1: true }, scores: {}, banked: true },
    };
    const m = mergeTheorist(stale, fresh, true);
    expect(m.resetAt).toBe(500);
    expect(m.banked).toEqual({});           // stale banked days dropped
    expect(m.day.date).toBe('');            // stale day dropped
    // commutative under the wipe too
    expect(canon(mergeTheorist(fresh, stale, false))).toBe(canon(m));
  });

  it('both epochs zero → an ordinary union (no wipe)', () => {
    const a: TheoristState = { banked: { '2026-01-01': 100 }, day: { date: '', blocks: {}, scores: {}, banked: false } };
    const b: TheoristState = { banked: { '2026-01-02': 200 }, day: { date: '', blocks: {}, scores: {}, banked: false } };
    const m = mergeTheorist(a, b, true);
    expect(m.banked).toEqual({ '2026-01-01': 100, '2026-01-02': 200 });
    expect(m.resetAt).toBeUndefined();
  });

  it('day merge (different dates): the more recently TOUCHED day wins, not the later date [finding 3]', () => {
    // An active older-date day (touched later) must not be clobbered by a
    // rolled-over newer-date day (touched earlier) — that would drop unbanked ticks.
    const olderButActive: TheoristState = {
      banked: {}, day: { date: '2026-01-01', blocks: { b1: true }, scores: { s1: 2 }, banked: false }, dayTouchedAt: 900,
    };
    const newerButStale: TheoristState = {
      banked: {}, day: { date: '2026-01-02', blocks: {}, scores: {}, banked: false }, dayTouchedAt: 100,
    };
    const m = mergeTheorist(olderButActive, newerButStale, true);
    expect(m.day).toEqual(olderButActive.day);      // older date, but newer touch → wins
    expect(m.dayTouchedAt).toBe(900);               // converges to the max
    // commutative
    expect(canon(mergeTheorist(newerButStale, olderButActive, false))).toBe(canon(m));
    // idempotent
    expect(canon(mergeTheorist(m, newerButStale, true))).toBe(canon(m));
  });

  it('day merge (different dates): a dayTouchedAt tie falls back to the later ISO date', () => {
    const a: TheoristState = { banked: {}, day: { date: '2026-01-01', blocks: { b1: true }, scores: {}, banked: false }, dayTouchedAt: 50 };
    const b: TheoristState = { banked: {}, day: { date: '2026-01-02', blocks: {}, scores: {}, banked: false }, dayTouchedAt: 50 };
    const m = mergeTheorist(a, b, true);
    expect(m.day.date).toBe('2026-01-02');
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m)); // commutative
  });

  it('day merge (different dates): the "" EMPTY sentinel always loses to a real day', () => {
    const empty: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, dayTouchedAt: 999 };
    const real: TheoristState = { banked: {}, day: { date: '2026-01-01', blocks: { b1: true }, scores: {}, banked: false }, dayTouchedAt: 1 };
    expect(mergeTheorist(empty, real, true).day).toEqual(real.day);   // real wins despite lower touch
    expect(mergeTheorist(real, empty, false).day).toEqual(real.day);  // both orders
  });

  it('day merge: same date → OR the blocks/banked flag, max the scores, max dayTouchedAt', () => {
    const a: TheoristState = {
      banked: {}, day: { date: '2026-03-03', blocks: { b1: true, b4: false }, scores: { s1: 1, s2: 2 }, banked: false }, dayTouchedAt: 100,
    };
    const b: TheoristState = {
      banked: {}, day: { date: '2026-03-03', blocks: { b4: true }, scores: { s1: 2 }, banked: true }, dayTouchedAt: 200,
    };
    const m = mergeTheorist(a, b, true);
    expect(m.day).toEqual({ date: '2026-03-03', blocks: { b1: true, b4: true }, scores: { s1: 2, s2: 2 }, banked: true });
    expect(m.dayTouchedAt).toBe(200);
  });

  it('mergeStore dispatches "theorist" to mergeTheorist (not the localWins fallback)', () => {
    const a: TheoristState = { banked: { '2026-01-01': 10 }, day: { date: '', blocks: {}, scores: {}, banked: false } };
    const b: TheoristState = { banked: { '2026-01-01': 40 }, day: { date: '', blocks: {}, scores: {}, banked: false } };
    const out = merge('theorist', a as never, b as never, true) as unknown as TheoristState;
    expect(out.banked['2026-01-01']).toBe(40); // max, not "local wins"
  });
});

/* ================================================================== */
/* Phase 2 additive day fields: events + dayType                       */
/* ================================================================== */

describe('mergeTheorist additive fields (events, dayType)', () => {
  const D = '2026-04-04';
  const base = (day: TheoristState['day'], dayTouchedAt?: number): TheoristState => ({ banked: {}, day, ...(dayTouchedAt ? { dayTouchedAt } : {}) });

  it('events: same-date per-key max union', () => {
    const a = base({ date: D, blocks: {}, scores: {}, banked: false, events: { e1: 5, e2: 0 } });
    const b = base({ date: D, blocks: {}, scores: {}, banked: false, events: { e1: 3, e2: 9, e3: 2 } });
    const m = mergeTheorist(a, b, true);
    expect(m.day.events).toEqual({ e1: 5, e2: 9, e3: 2 });
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m)); // commutative
    expect(canon(mergeTheorist(m, a, true))).toBe(canon(m));   // idempotent
  });

  it('events: absent-safe — a side without the field contributes nothing', () => {
    const a = base({ date: D, blocks: {}, scores: {}, banked: false, events: { e1: 7 } });
    const b = base({ date: D, blocks: {}, scores: {}, banked: false }); // no events field
    const m = mergeTheorist(a, b, true);
    expect(m.day.events).toEqual({ e1: 7 });
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m));
  });

  it('old-shape day (no events, no dayType) merges to old-shape (no events key, no data loss)', () => {
    const a = base({ date: D, blocks: { b1: true }, scores: { s2: 2 }, banked: false });
    const b = base({ date: D, blocks: { b4: true }, scores: { s2: 1 }, banked: false });
    const m = mergeTheorist(a, b, true);
    expect('events' in m.day).toBe(false);   // additive field stays absent
    expect('dayType' in m.day).toBe(false);
    expect(m.day.blocks).toEqual({ b1: true, b4: true });
    expect(m.day.scores).toEqual({ s2: 2 });
  });

  it('dayType: same-date LWW by dayTouchedAt — the later touch wins', () => {
    const a = base({ date: D, blocks: {}, scores: {}, banked: false, dayType: 'full' }, 100);
    const b = base({ date: D, blocks: {}, scores: {}, banked: false, dayType: 'light' }, 200);
    const m = mergeTheorist(a, b, true);
    expect(m.day.dayType).toBe('light'); // b touched later
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m));
  });

  it('dayType: a touch tie between differing values prefers "light" (deterministic)', () => {
    const a = base({ date: D, blocks: {}, scores: {}, banked: false, dayType: 'full' }, 500);
    const b = base({ date: D, blocks: {}, scores: {}, banked: false, dayType: 'light' }, 500);
    const m = mergeTheorist(a, b, true);
    expect(m.day.dayType).toBe('light');
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m)); // commutative on the tie
  });

  it('dayType: absent-safe — the present value survives a missing one', () => {
    const a = base({ date: D, blocks: {}, scores: {}, banked: false, dayType: 'full' }, 100);
    const b = base({ date: D, blocks: {}, scores: {}, banked: false }, 900); // no dayType, later touch
    const m = mergeTheorist(a, b, true);
    expect(m.day.dayType).toBe('full'); // present value wins over a later-touched absent
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m));
  });

  it('events + dayType ride with the winning day on different dates', () => {
    const older = base({ date: '2026-01-01', blocks: {}, scores: {}, banked: false, events: { e1: 4 }, dayType: 'light' }, 900);
    const newerStale = base({ date: '2026-01-02', blocks: {}, scores: {}, banked: false, events: { e1: 99 }, dayType: 'full' }, 100);
    const m = mergeTheorist(older, newerStale, true);
    expect(m.day.date).toBe('2026-01-01');       // more-recently-touched day wins
    expect(m.day.events).toEqual({ e1: 4 });      // rides with the winner (not max'd across dates)
    expect(m.day.dayType).toBe('light');
    expect(canon(mergeTheorist(newerStale, older, false))).toBe(canon(m));
  });

  it('a resetAt wipe clears events + dayType with the day', () => {
    const fresh: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, resetAt: 500 };
    const stale: TheoristState = {
      banked: { '2026-01-01': 100 },
      day: { date: '2026-01-01', blocks: {}, scores: { s2: 2 }, banked: true, events: { e1: 50 }, dayType: 'full' },
    };
    const m = mergeTheorist(stale, fresh, true);
    expect(m.day.date).toBe('');
    expect('events' in m.day).toBe(false);
    expect('dayType' in m.day).toBe(false);
    expect(canon(mergeTheorist(fresh, stale, false))).toBe(canon(m));
  });
});

/* ================================================================== */
/* Phase 3 additive TOP-LEVEL field: mastery                           */
/* ================================================================== */

describe('mergeTheorist mastery (Phase 3)', () => {
  const withMastery = (m: TheoristState['mastery']): TheoristState => ({
    banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, mastery: m,
  });

  it('per-topic LWW by the LARGER reviewedAt — the newer review carries its level', () => {
    const a = withMastery({ 'COS 226': { level: 1, reviewedAt: 100 } });
    const b = withMastery({ 'COS 226': { level: 0.2, reviewedAt: 500 } });
    const m = mergeTheorist(a, b, true);
    expect(m.mastery!['COS 226']).toEqual({ level: 0.2, reviewedAt: 500 }); // newer wins
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m)); // commutative
    expect(canon(mergeTheorist(m, a, true))).toBe(canon(m));   // idempotent
  });

  it('disjoint topics both survive; absent-safe', () => {
    const a = withMastery({ 'COS 226': { level: 1, reviewedAt: 100 } });
    const b = withMastery({ 'MIT 6.006': { level: 0.5, reviewedAt: 200 } });
    const m = mergeTheorist(a, b, true);
    expect(m.mastery).toEqual({ 'COS 226': { level: 1, reviewedAt: 100 }, 'MIT 6.006': { level: 0.5, reviewedAt: 200 } });
    // a side without mastery contributes nothing
    const c = mergeTheorist(a, { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false } }, true);
    expect(c.mastery).toEqual({ 'COS 226': { level: 1, reviewedAt: 100 } });
  });

  it('a reviewedAt tie takes the larger level (deterministic ⇒ commutative)', () => {
    const a = withMastery({ 'COS 226': { level: 0.3, reviewedAt: 400 } });
    const b = withMastery({ 'COS 226': { level: 0.9, reviewedAt: 400 } });
    const m = mergeTheorist(a, b, true);
    expect(m.mastery!['COS 226'].level).toBe(0.9);
    expect(canon(mergeTheorist(b, a, false))).toBe(canon(m));
  });

  it('an old-shape store (no mastery) merges to no mastery key', () => {
    const a: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false } };
    const m = mergeTheorist(a, a, true);
    expect('mastery' in m).toBe(false);
  });

  it('a resetAt wipe clears mastery (EMPTY carries none)', () => {
    const fresh: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, resetAt: 900 };
    const stale = { ...withMastery({ 'COS 226': { level: 1, reviewedAt: 100 } }), banked: { '2026-01-01': 5 } };
    const m = mergeTheorist(stale, fresh, true);
    expect('mastery' in m).toBe(false);
    expect(m.banked).toEqual({});
    expect(canon(mergeTheorist(fresh, stale, false))).toBe(canon(m));
  });

  it('mastery survives a merge at an equal epoch (a review made after the reset)', () => {
    const a: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, mastery: { 'COS 226': { level: 1, reviewedAt: 700 } }, resetAt: 500 };
    const b: TheoristState = { banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, mastery: { 'MIT 6.006': { level: 0.5, reviewedAt: 800 } }, resetAt: 500 };
    const m = mergeTheorist(a, b, true);
    expect(m.mastery).toEqual({ 'COS 226': { level: 1, reviewedAt: 700 }, 'MIT 6.006': { level: 0.5, reviewedAt: 800 } });
    expect(m.resetAt).toBe(500);
  });
});

/* ================================================================== */
/* dayXP graded-log formula (Phase 2)                                  */
/* ================================================================== */

describe('dayXP derives from the graded scorecard, not block ticks', () => {
  it('pins an all-Met day: deep s2..s6 (5×20) + routine s1,s7..s10 (5×10) = 150', () => {
    const day = {
      date: todayISO(),
      blocks: {},
      scores: { s1: 2, s2: 2, s3: 2, s4: 2, s5: 2, s6: 2, s7: 2, s8: 2, s9: 2, s10: 2 },
      banked: false,
    };
    expect(dayXP(day)).toBe(5 * 20 + 5 * 10); // 150
  });

  it('a mixed day: deep Partial + Met and routine Partial, unrated items contribute 0', () => {
    const day = {
      date: todayISO(),
      blocks: {},
      // deep: s2 Met (20) + s3 Partial (10) = 30; routine: s1 Partial (5) + s7 Met (10) = 15; rest unrated → 0
      scores: { s2: 2, s3: 1, s1: 1, s7: 2 },
      banked: false,
    };
    expect(dayXP(day)).toBe(30 + 15); // 45
  });

  it('unrated (empty scores) is 0, and an explicit Missed (0) contributes 0', () => {
    expect(dayXP({ date: todayISO(), blocks: {}, scores: {}, banked: false })).toBe(0);
    expect(dayXP({ date: todayISO(), blocks: {}, scores: { s2: 0, s4: 0 }, banked: false })).toBe(0);
  });

  it('events are added at face value (Phase 3 wiring; default {} ⇒ 0 now)', () => {
    const day = { date: todayISO(), blocks: {}, scores: { s2: 2 }, banked: false, events: { e1: 7, e2: 3 } };
    expect(dayXP(day)).toBe(20 + 7 + 3); // 30
    // absent events derive fine (old shape)
    expect(dayXP({ date: todayISO(), blocks: {}, scores: { s2: 2 }, banked: false })).toBe(20);
  });

  it('blocks no longer affect XP: ticking a block leaves dayXP unchanged', () => {
    const noBlocks = { date: todayISO(), blocks: {}, scores: { s2: 2 }, banked: false };
    const withBlocks = { date: todayISO(), blocks: { b1: true, b4: true, b8: true }, scores: { s2: 2 }, banked: false };
    expect(dayXP(withBlocks)).toBe(dayXP(noBlocks));
    expect(dayXP(withBlocks)).toBe(20); // only s2 counts
  });

  it('historical banked days are frozen — a prior banked value is never recomputed by the new formula', () => {
    const today = todayISO();
    // '2026-01-01' was banked under the OLD block formula (e.g. 40). cumXP sums
    // `banked` verbatim; switching the dayXP formula must not recompute it.
    const pinned: TheoristState = {
      banked: { '2026-01-01': 40, [today]: 0 },
      day: { date: today, blocks: {}, scores: { s2: 2 }, banked: false },
    };
    appState.set('theorist', pinned as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(trackerState.value.cumXP).toBe(40); // historical value intact
    expect(dayXP(trackerState.value.day)).toBe(20); // today uses the new formula
  });
});

/* ================================================================== */
/* Migration fold                                                      */
/* ================================================================== */

function buildAppState(durableTheorist: string | null) {
  const keys: Record<StoreKey, string> = {
    core: 'meridian-core', overload: 'overload-tracker-state',
    surplus: 'surplus-tracker-state', csgraph: 'csgraph_profile_v2', theorist: 'meridian-theorist',
  };
  // `stored` models the durable backend storeGet reads from; `write` heals it so
  // a fold's synchronous durable write is visible to a later storeGet.
  const stored: Partial<Record<StoreKey, string | null>> = { theorist: durableTheorist };
  const keyToStore = Object.fromEntries((Object.keys(keys) as StoreKey[]).map((k) => [keys[k], k]));
  const storesObj: Record<StoreKey, Record<string, unknown>> = { core: {}, overload: {}, surplus: {}, csgraph: {}, theorist: {} };
  const markDirtyCalls: StoreKey[] = [];
  const sync = {
    create: vi.fn(() => ({})), save: vi.fn(async () => ({} as SaveResult)),
    discard: vi.fn(async () => ({ restored: [], skipped: [] })), anyDirty: vi.fn(() => false), baseRev: vi.fn(() => 0),
  };
  const app = createAppState({
    host: { paintSaveChip: vi.fn(), flashSaved: vi.fn() },
    storeGet: async (k: string) => stored[keyToStore[k] as StoreKey] ?? null,
    sync: sync as never,
    keys,
    defaultWorkout: {} as never,
    read: (k) => storesObj[k],
    write: (k, d) => { storesObj[k] = d; stored[k] = JSON.stringify(d); },
    now: () => Date.now(),
    setTimeout: () => { markDirtyCalls.push('theorist'); return 0; },
    clearTimeout: () => {},
  });
  return { app, stored, storesObj, markDirtyCalls };
}

describe('loadTheorist migration fold', () => {
  const LEGACY = 'meridian.tracker.v1';
  const MARKER = 'meridian.theorist.migrated';
  const d0 = todayISO();
  const d1 = todayISO(new Date(Date.now() - 86_400_000));
  const d2 = todayISO(new Date(Date.now() - 2 * 86_400_000));

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('folds cumXP + logged into banked (sum preserved, __carry present, streak correct)', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({
      cumXP: 5000, logged: [d0, d1, d2],
      day: { date: d0, blocks: { b1: true }, scores: {}, banked: false },
    }));
    const { app } = buildAppState(null);
    const t = (await app.loadTheorist()) as unknown as TheoristState;

    const sum = Object.values(t.banked).reduce((a, b) => a + b, 0);
    expect(sum).toBe(5000);
    expect(t.banked['__carry']).toBe(5000);
    // every logged ISO date is a key (superset of `logged`)
    for (const iso of [d0, d1, d2]) expect(t.banked[iso]).toBe(0);
    const logged = Object.keys(t.banked).filter((k) => /^\d{4}-\d\d-\d\d$/.test(k));
    expect(streakCount(logged)).toBe(3);
    // legacy day matches today → carried through verbatim
    expect(t.day).toEqual({ date: d0, blocks: { b1: true }, scores: {}, banked: false });
    // marker set, legacy blob untouched
    expect(localStorage.getItem(MARKER)).not.toBeNull();
    expect(localStorage.getItem(LEGACY)).not.toBeNull();
  });

  it('persists the folded state DURABLY before the marker (crash-safety) [finding 1]', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ cumXP: 5000, logged: [d0] }));
    const h = buildAppState(null);
    await h.app.loadTheorist();
    // The durable backend now holds the folded data — a crash before any autosave
    // cannot orphan the legacy XP; a re-boot reads it back non-empty.
    const durable = JSON.parse(h.stored.theorist as string) as TheoristState;
    expect(durable.banked['__carry']).toBe(5000);
    // Fuller sync/IDB propagation was scheduled too.
    expect(h.markDirtyCalls.length).toBeGreaterThan(0);
    // A fresh loader reading that durable copy re-skips the fold (store non-empty).
    const again = buildAppState(h.stored.theorist as string);
    const t2 = (await again.app.loadTheorist()) as unknown as TheoristState;
    expect(t2.banked['__carry']).toBe(5000);
  });

  it('does not double: with the marker present the fold is skipped', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ cumXP: 5000, logged: [d0] }));
    localStorage.setItem(MARKER, '2026-01-01T00:00:00.000Z');
    const { app } = buildAppState(null);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.banked).toEqual({});          // no re-fold
    expect(t.day.banked).toBe(false);
  });

  it('the marker survives a resetAll: durable empty + marker set → no re-import', async () => {
    // After resetAll the durable store is empty again (banked {}, day fresh), but
    // the marker from the original migration must keep the legacy blob from being
    // folded back in, or the reset would be silently undone.
    localStorage.setItem(LEGACY, JSON.stringify({ cumXP: 5000, logged: [d0] }));
    localStorage.setItem(MARKER, '2026-01-01T00:00:00.000Z');
    const durableAfterReset = JSON.stringify({ banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, resetAt: Date.now() });
    const { app } = buildAppState(durableAfterReset);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.banked).toEqual({});          // reset stuck; legacy NOT re-folded
  });

  it('a non-empty durable store is never overwritten by the fold', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({ cumXP: 5000, logged: [d0] }));
    const durable = JSON.stringify({ banked: { '2026-01-01': 42 }, day: { date: '', blocks: {}, scores: {}, banked: false } });
    const { app } = buildAppState(durable);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.banked).toEqual({ '2026-01-01': 42 });
  });

  it('stale legacy day (not today) is dropped for a fresh empty day', async () => {
    localStorage.setItem(LEGACY, JSON.stringify({
      cumXP: 100, logged: [d1],
      day: { date: d1, blocks: { b1: true }, scores: {}, banked: true },
    }));
    const { app } = buildAppState(null);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.day).toEqual({ date: '', blocks: {}, scores: {}, banked: false, events: {} });
    expect(t.banked['__carry']).toBe(100);
  });
});

/* ================================================================== */
/* Phase 3 curriculum → mastery one-shot migration                     */
/* ================================================================== */

describe('loadTheorist mastery migration', () => {
  const CUR = 'meridian.curriculum.v1';
  const MMARK = 'meridian.mastery.migrated';

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('folds checks into mastery (checked→1, unchecked→0, stamped now) and sets the marker; local key kept', async () => {
    localStorage.setItem(CUR, JSON.stringify({ 'COS 226': true, 'MIT 6.006': false }));
    const before = Date.now();
    const { app } = buildAppState(null);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.mastery!['COS 226']).toMatchObject({ level: 1 });
    expect(t.mastery!['MIT 6.006']).toMatchObject({ level: 0 });
    expect(t.mastery!['COS 226'].reviewedAt).toBeGreaterThanOrEqual(before);
    expect(localStorage.getItem(MMARK)).not.toBeNull();
    expect(localStorage.getItem(CUR)).not.toBeNull(); // never deleted
  });

  it('persists the folded mastery DURABLY and schedules a sync (crash-safety)', async () => {
    localStorage.setItem(CUR, JSON.stringify({ 'COS 226': true }));
    const h = buildAppState(null);
    await h.app.loadTheorist();
    const durable = JSON.parse(h.stored.theorist as string) as TheoristState;
    expect(durable.mastery!['COS 226'].level).toBe(1);
    expect(h.markDirtyCalls.length).toBeGreaterThan(0);
  });

  it('with the marker present the fold is skipped (no doubling)', async () => {
    localStorage.setItem(CUR, JSON.stringify({ 'COS 226': true }));
    localStorage.setItem(MMARK, '2026-01-01T00:00:00.000Z');
    const { app } = buildAppState(null);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.mastery).toBeUndefined();
  });

  it('survives a resetAll: marker present + durable reset → mastery NOT re-folded', async () => {
    localStorage.setItem(CUR, JSON.stringify({ 'COS 226': true }));
    localStorage.setItem(MMARK, '2026-01-01T00:00:00.000Z');
    const durable = JSON.stringify({ banked: {}, day: { date: '', blocks: {}, scores: {}, banked: false }, resetAt: Date.now() });
    const { app } = buildAppState(durable);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.mastery).toBeUndefined();
  });

  it('an old-shape store with no mastery loads and derives fine', async () => {
    const durable = JSON.stringify({ banked: { '2026-01-01': 100 }, day: { date: '', blocks: {}, scores: {}, banked: false } });
    const { app } = buildAppState(durable);
    const t = (await app.loadTheorist()) as unknown as TheoristState;
    expect(t.mastery).toBeUndefined();
    expect(t.banked).toEqual({ '2026-01-01': 100 });
    expect(t.day.events).toEqual({}); // Phase-2 normalisation still applies
  });
});

/* ================================================================== */
/* Projection reality-check (drives the real appState singleton)       */
/* ================================================================== */

describe('projection reality-check', () => {
  it('pins a known banked map to exact level / streak / todayXP', () => {
    const today = todayISO();
    const yesterday = todayISO(new Date(Date.now() - 86_400_000));
    const pinned: TheoristState = {
      // Blocks are ticked but must NOT contribute XP post-Phase-2; XP is the
      // scores-derived total: s2 (deep, Met) 20 + s1 (routine, Met) 10 = 30.
      banked: { [today]: 0, [yesterday]: 0, '__carry': 5000 },
      day: { date: today, blocks: { b1: true, b4: true }, scores: { s2: 2, s1: 2 }, banked: false },
    };
    appState.set('theorist', pinned as unknown as Record<string, unknown>);
    syncTrackerFromStore();

    const s = trackerState.value;
    expect(s.cumXP).toBe(5000);
    expect(levelIndex(s.cumXP) + 1).toBe(3);        // 5000 → "Problem Solver" tier (idx 2)
    expect(s.logged.sort()).toEqual([yesterday, today].sort());
    expect(streakCount(s.logged)).toBe(2);
    expect(dayXP(s.day)).toBe(30);                  // scores-derived, blocks ignored
    expect(s.day.events).toEqual({});               // absent events normalised on projection
  });
});

/* ================================================================== */
/* Phase 3 economy, decaying mastery, weekly ring (drive appState)     */
/* ================================================================== */

describe('Phase 3 economy weights', () => {
  it('retrieval is STRICTLY the highest-paid event', () => {
    const others = [
      EVENT_WEIGHTS.paperReproduce, EVENT_WEIGHTS.topicReview,
      EVENT_WEIGHTS.algoStudied, EVENT_WEIGHTS.journalSave,
    ];
    for (const w of others) expect(EVENT_WEIGHTS.retrieval).toBeGreaterThan(w);
    expect(EVENT_WEIGHTS.retrieval).toBe(50);
  });
});

describe('creditEvent (idempotent, max-merged)', () => {
  const setToday = () => {
    const t: TheoristState = { banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} } };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
  };

  it('a double-fire of the same id same day pays once (max), and lower re-fires never lower it', () => {
    setToday();
    creditEvent('algo:studied', 20);
    creditEvent('algo:studied', 20); // same value again
    expect(trackerState.value.day.events!['algo:studied']).toBe(20); // single credit
    creditEvent('algo:studied', 5); // a lower value can't reduce it
    expect(trackerState.value.day.events!['algo:studied']).toBe(20);
    creditEvent('algo:studied', 50); // a higher value raises it (max)
    expect(trackerState.value.day.events!['algo:studied']).toBe(50);
  });

  it('dayXP sums scored items AND event credits', () => {
    setToday();
    const t = appState.get('theorist') as unknown as TheoristState;
    // s2 Met (deep, 20) + a retrieval event (50) = 70
    appState.set('theorist', { ...t, day: { ...t.day, scores: { s2: 2 } } } as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    creditEvent('journal:retrieval:e1', EVENT_WEIGHTS.retrieval);
    expect(dayXP(trackerState.value.day)).toBe(20 + 50);
  });

  it('per-entry retrieval keys let two distinct reconstructions each pay; the same entry pays once', () => {
    setToday();
    // Two DISTINCT cold reconstructions the same day → keyed by entry id → both pay.
    creditEvent('journal:retrieval:e1', EVENT_WEIGHTS.retrieval);
    creditEvent('journal:retrieval:e2', EVENT_WEIGHTS.retrieval);
    expect(dayXP(trackerState.value.day)).toBe(2 * EVENT_WEIGHTS.retrieval); // 100
    // Re-firing the SAME entry can't double-pay (max per id).
    creditEvent('journal:retrieval:e1', EVENT_WEIGHTS.retrieval);
    expect(dayXP(trackerState.value.day)).toBe(2 * EVENT_WEIGHTS.retrieval);
  });
});

describe('currentMastery decay + reviewTopic', () => {
  const HALF_MS = HALF_LIFE_DAYS * 86_400_000;

  it('decays with a 30-day half-life: level 1 → 0.5 at 30d, 0.25 at 60d', () => {
    const t0 = 1_000_000_000_000;
    const t: TheoristState = {
      banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} },
      mastery: { 'COS 226': { level: 1, reviewedAt: t0 } },
    };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(currentMastery('COS 226', t0)).toBeCloseTo(1, 6);
    expect(currentMastery('COS 226', t0 + HALF_MS)).toBeCloseTo(0.5, 6);
    expect(currentMastery('COS 226', t0 + 2 * HALF_MS)).toBeCloseTo(0.25, 6);
    expect(currentMastery('never-reviewed', t0)).toBe(0); // absent topic → 0
  });

  it('a mastery record with a non-finite reviewedAt (or level) reads 0, not NaN', () => {
    const t = {
      banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} },
      mastery: { bad: { level: 1 }, worse: { level: Number.NaN, reviewedAt: 10 } },
    };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(currentMastery('bad')).toBe(0);   // reviewedAt missing → 0 (no NaN)
    expect(currentMastery('worse')).toBe(0); // level NaN → 0
  });

  it('reviewTopic (Curriculum button) sets level 1 at now and credits topic-review (25) only', () => {
    const base: TheoristState = { banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} } };
    appState.set('theorist', base as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    const before = Date.now();
    reviewTopic('MIT 6.006');
    const stored = appState.get('theorist') as unknown as TheoristState;
    expect(stored.mastery!['MIT 6.006'].level).toBe(1);
    expect(stored.mastery!['MIT 6.006'].reviewedAt).toBeGreaterThanOrEqual(before);
    expect(stored.day.events!['topic:MIT 6.006']).toBe(EVENT_WEIGHTS.topicReview); // 25
    expect(dayXP(stored.day)).toBe(EVENT_WEIGHTS.topicReview); // exactly 25, no retrieval
    expect(currentMastery('MIT 6.006')).toBeCloseTo(1, 3);
  });

  it('markTopicReviewed refreshes mastery WITHOUT any economy credit', () => {
    const base: TheoristState = { banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} } };
    appState.set('theorist', base as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    markTopicReviewed('COS 226');
    const stored = appState.get('theorist') as unknown as TheoristState;
    expect(stored.mastery!['COS 226'].level).toBe(1);
    expect(stored.day.events ?? {}).toEqual({}); // no credit emitted
    // Spaced-return course path parity: mastery-only + retrieval(50) = 50, not 75.
    creditEvent('retrieval', EVENT_WEIGHTS.retrieval);
    expect(dayXP((appState.get('theorist') as unknown as TheoristState).day)).toBe(EVENT_WEIGHTS.retrieval);
  });
});

describe('stalestTopic surfaces only once-reviewed, decayed topics', () => {
  const HALF_MS = HALF_LIFE_DAYS * 86_400_000;

  it('a migrated-unchecked (level 0) topic is NOT surfaced', () => {
    const t: TheoristState = {
      banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} },
      mastery: { 'COS 226': { level: 0, reviewedAt: Date.now() } },
    };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(stalestTopic()).toBeNull();
  });

  it('a decayed (>0, <0.5) topic surfaces; a still-reconstructable one does not', () => {
    const now = 2_000_000_000_000;
    const t: TheoristState = {
      banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} },
      mastery: {
        stale: { level: 1, reviewedAt: now - 2 * HALF_MS },  // 0.25 → surfaces
        fresh: { level: 1, reviewedAt: now },                 // 1.0 → not stale
      },
    };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    const s = stalestTopic(now);
    expect(s?.id).toBe('stale');
    expect(s?.level).toBeCloseTo(0.25, 6);
  });

  it('picks the LOWEST current mastery among several stale topics', () => {
    const now = 2_000_000_000_000;
    const t: TheoristState = {
      banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} },
      mastery: {
        a: { level: 1, reviewedAt: now - 1.2 * HALF_MS }, // ~0.435
        b: { level: 1, reviewedAt: now - 3 * HALF_MS },   // 0.125 (lowest)
      },
    };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(stalestTopic(now)?.id).toBe('b');
  });
});

describe('weeklySessions (trailing 7-day ring, light day counts)', () => {
  const iso = (now: number, back: number) => todayISO(new Date(now - back * 86_400_000));

  it('counts banked days within the trailing window; WEEKLY_TARGET is 4', () => {
    expect(WEEKLY_TARGET).toBe(4);
    const now = Date.parse('2026-05-20T12:00:00');
    const t: TheoristState = {
      banked: {
        [iso(now, 0)]: 30, [iso(now, 2)]: 10, [iso(now, 6)]: 0, // in window (0 counts — banked)
        [iso(now, 8)]: 99, // 8 days ago → outside the 7-day window
        '__carry': 5000,   // not an ISO date → ignored
      },
      day: { date: iso(now, 0), blocks: {}, scores: {}, banked: true, events: {} },
    };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(weeklySessions(now)).toBe(3); // the three in-window banked ISO days
  });

  it("today counts once it clears the bar even before banking; a light day clears a lower bar", () => {
    const now = Date.parse('2026-05-20T12:00:00');
    const today = iso(now, 0);
    // Full day, not banked, only a ticked block (no score/event) → does NOT count.
    const full: TheoristState = { banked: {}, day: { date: today, blocks: { b1: true }, scores: {}, banked: false, events: {} } };
    appState.set('theorist', full as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(weeklySessions(now)).toBe(0);
    // Mark it a light day → the same ticked block now clears the lower bar.
    setDayType('light');
    expect(weeklySessions(now)).toBe(1);
  });

  it('an auto-Light Sabbath day with a block counts as a met session', () => {
    const now = Date.parse('2026-05-22T19:00:00'); // a Friday evening — Sabbath window
    const today = iso(now, 0);
    const t: TheoristState = { banked: {}, day: { date: today, blocks: { b1: true }, scores: {}, banked: false, events: {}, dayType: 'light' } };
    appState.set('theorist', t as unknown as Record<string, unknown>);
    syncTrackerFromStore();
    expect(weeklySessions(now)).toBe(1);
  });
});

/* ================================================================== */
/* normaliseTheorist score clamp [finding 4]                           */
/* ================================================================== */

describe('normaliseTheorist score clamp', () => {
  it('clamps score values to an integer in 0..2', () => {
    const raw = {
      banked: { '2026-01-01': 10, bad: -5 },
      day: { date: '2026-01-01', blocks: { b1: true }, scores: { s1: 9, s2: -3, s3: 1.7, s4: 2 }, banked: false },
    };
    const t = normaliseTheorist(raw);
    expect(t.day.scores).toEqual({ s1: 2, s2: 0, s3: 2, s4: 2 });
    // banked keeps only non-negative values
    expect(t.banked['2026-01-01']).toBe(10);
    expect(t.banked['bad']).toBeUndefined();
  });
});

/* ================================================================== */
/* Registration completeness                                           */
/* ================================================================== */

describe('sync registration completeness', () => {
  it('STORE_KEYS includes "theorist"', () => {
    expect(STORE_KEYS).toContain('theorist');
  });

  it('a CloudPayload round-trips the theorist store through push → pull', async () => {
    // Minimal in-memory ports.
    const disk = new Map<string, string>();
    const storage: StorageAdapter = {
      get: async (k) => disk.get(k) ?? null,
      set: async (k, v) => { disk.set(k, v); return true; },
    };
    let cloudDoc: CloudPayload | null = null;
    const cloud: CloudProvider = {
      read: async (): Promise<CloudReadResult> => ({ ok: true, payload: cloudDoc ? structuredClone(cloudDoc) : undefined }),
      write: async (p): Promise<CloudWriteResult> => { cloudDoc = structuredClone(p); return { ok: true, rev: p.rev }; },
    };
    const clock = { now: () => 1 };

    const a = new SyncEngine({ storage, cloud, clock, merge: (l, r, key, lw) => merge(key, l, r, lw) });
    a.edit('theorist', () => ({ banked: { '2026-01-01': 123, '__carry': 77 }, day: { date: '2026-01-01', blocks: {}, scores: {}, banked: true } }));
    const pushed = await a.save();
    expect(pushed.cloud).toBe('synced');
    expect(cloudDoc!.theorist).toBeDefined();

    // A second device pulls and sees the theorist store.
    const b = new SyncEngine({ storage, cloud, clock, merge: (l, r, key, lw) => merge(key, l, r, lw) });
    const res = await b.pull();
    expect(res.applied).toBe(true);
    expect((b.getStore('theorist') as unknown as TheoristState).banked).toEqual({ '2026-01-01': 123, '__carry': 77 });
  });
});
