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
const arbDate = fc.constantFrom('', '2026-01-01', '2026-01-02', '2026-05-05');
const arbDay = fc.record({
  date: arbDate,
  blocks: fc.dictionary(arbBlockId, fc.boolean(), { maxKeys: 4 }),
  scores: fc.dictionary(arbScoreId, fc.constantFrom(0, 1, 2), { maxKeys: 3 }),
  banked: fc.boolean(),
});
const arbTheorist: fc.Arbitrary<TheoristState> = fc.record({
  banked: arbBanked,
  day: arbDay,
  dayTouchedAt: fc.option(fc.integer({ min: 1, max: 1e12 }), { nil: undefined }),
  resetAt: fc.option(fc.constantFrom(0, 100, 200, 300), { nil: undefined }),
}) as fc.Arbitrary<TheoristState>;

/* A theorist with no reset epoch, for the union invariants that only hold at an equal epoch. */
const arbNoReset: fc.Arbitrary<TheoristState> = fc.record({
  banked: arbBanked,
  day: arbDay,
  dayTouchedAt: fc.option(fc.integer({ min: 1, max: 1e12 }), { nil: undefined }),
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
    expect(t.day).toEqual({ date: '', blocks: {}, scores: {}, banked: false });
    expect(t.banked['__carry']).toBe(100);
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
      banked: { [today]: 0, [yesterday]: 0, '__carry': 5000 },
      day: { date: today, blocks: { b1: true, b4: true }, scores: {}, banked: false }, // b1=20, b4=20
    };
    appState.set('theorist', pinned as unknown as Record<string, unknown>);
    syncTrackerFromStore();

    const s = trackerState.value;
    expect(s.cumXP).toBe(5000);
    expect(levelIndex(s.cumXP) + 1).toBe(3);        // 5000 → "Problem Solver" tier (idx 2)
    expect(s.logged.sort()).toEqual([yesterday, today].sort());
    expect(streakCount(s.logged)).toBe(2);
    expect(dayXP(s.day)).toBe(40);
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
