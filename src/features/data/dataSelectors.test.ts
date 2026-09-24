import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  type AppState, BUNDLE_VERSION, canonicalise, csvCell, exportBundle,
  importBundle, mealCsv, normaliseState, roundTrip, serialise,
  storageMetrics, toCsv, workoutCsv,
} from '@/features/data/dataSelectors';
import { shiftDate } from '@/core/util';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;

const arbDate = fc.integer({ min: 0, max: 400 }).map((o) => shiftDate('2025-01-01', o));
const arbId = fc.uuid();

/** A deliberately complex, highly randomised application state. */
const arbAppState: fc.Arbitrary<AppState> = fc.record({
  core: fc.record({
    schedule: fc.dictionary(
      arbDate,
      fc.array(fc.record({ id: arbId, label: fc.string({ maxLength: 30 }), start: fc.string({ maxLength: 5 }), end: fc.string({ maxLength: 5 }), done: fc.boolean() }), { maxLength: 5 }),
      { maxKeys: 6 },
    ),
    entries: fc.array(fc.record({ id: arbId, date: arbDate, stream: fc.string({ maxLength: 8 }), source: fc.string({ maxLength: 8 }), xp: fc.integer({ min: 0, max: 500 }) }), { maxLength: 12 }),
    todos: fc.array(fc.record({ id: arbId, text: fc.string({ maxLength: 30 }), done: fc.boolean(), created: fc.integer({ min: 0 }), due: fc.option(arbDate, { nil: undefined }) }, { requiredKeys: ['id', 'text', 'done', 'created'] }), { maxLength: 6 }),
    scratch: fc.array(fc.record({ id: arbId, title: fc.string({ maxLength: 20 }), body: fc.string({ maxLength: 60 }), status: fc.constantFrom('idea', 'trying', 'shipped', 'parked'), created: fc.integer({ min: 0 }), updated: fc.integer({ min: 0 }) }), { maxLength: 6 }),
    _del: fc.dictionary(arbId, fc.integer({ min: 0 }), { maxKeys: 4 }),
  }),
  overload: fc.record({
    settings: fc.record({ bwGoal: fc.integer({ min: 100, max: 300 }), benchGoal: fc.integer({ min: 100, max: 400 }) }),
    days: fc.dictionary(
      arbDate,
      fc.array(fc.record({
        id: arbId,
        ex: fc.string({ minLength: 1, maxLength: 24 }),
        type: fc.constantFrom('warm', 'top', 'back', 'cardio'),
        weight: fc.integer({ min: 0, max: 600 }),
        reps: fc.integer({ min: 0, max: 40 }),
        muscle: fc.constantFrom('chest', 'quads', 'cardio', 'forearms'),
        group: fc.string({ maxLength: 20 }),
      }), { maxLength: 8 }),
      { maxKeys: 8 },
    ),
    bw: fc.dictionary(arbDate, fc.integer({ min: 80, max: 320 }), { maxKeys: 6 }),
    rpe: fc.dictionary(arbDate, fc.integer({ min: 1, max: 10 }), { maxKeys: 4 }),
    done: fc.dictionary(arbDate, fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }), { maxKeys: 4 }),
    sessionDone: fc.dictionary(arbDate, fc.boolean(), { maxKeys: 4 }),
    incr: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.constantFrom(2.5, 5, 10, 12.5), { maxKeys: 4 }),
    _del: fc.dictionary(arbId, fc.integer({ min: 0 }), { maxKeys: 4 }),
  }),
  surplus: fc.record({
    settings: fc.record({ maintenance: fc.integer({ min: 1000, max: 4000 }), surplus: fc.integer({ min: -500, max: 1000 }), proteinTarget: fc.integer({ min: 40, max: 250 }) }),
    days: fc.dictionary(
      arbDate,
      fc.array(fc.record({ id: arbId, name: fc.string({ maxLength: 40 }), cal: fc.integer({ min: 0, max: 2500 }), protein: fc.integer({ min: 0, max: 150 }), est: fc.boolean() }), { maxLength: 8 }),
      { maxKeys: 8 },
    ),
    tad: fc.dictionary(arbDate, fc.integer({ min: 0, max: 6 }), { maxKeys: 5 }),
    _del: fc.dictionary(arbId, fc.integer({ min: 0 }), { maxKeys: 3 }),
  }),
  csgraph: fc.record({
    mastery: fc.dictionary(fc.hexaString({ minLength: 1, maxLength: 6 }), fc.constantFrom(1, 2, 3, 4, 5), { maxKeys: 15 }),
    srs: fc.dictionary(fc.hexaString({ minLength: 1, maxLength: 6 }), fc.record({ due: arbDate, ivl: fc.integer({ min: 0, max: 365 }), ease: fc.double({ min: 1.3, max: 3, noNaN: true }), n: fc.integer({ min: 0, max: 30 }) }), { maxKeys: 15 }),
    gymDone: fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.boolean(), { maxKeys: 8 }),
    log: fc.array(fc.record({ id: arbId, qid: fc.hexaString({ maxLength: 6 }), at: fc.integer({ min: 0 }), rating: fc.constantFrom(1, 2, 3, 4, 5) }), { maxLength: 15 }),
  }),
}) as fc.Arbitrary<AppState>;

/* ================================================================== */
/* THE headline property                                               */
/* ================================================================== */

describe('workout field preservation (regression)', () => {
  it('cardio mins/dist and reopened survive normalise + an export→import round-trip', () => {
    const state = normaliseState({
      overload: {
        settings: {},
        days: { '2025-01-02': [{ id: 'c1', ex: 'Treadmill', type: 'cardio', weight: 0, reps: 0, mins: 22, dist: 2.4, muscle: 'cardio' }] },
        bw: {}, rpe: {}, done: {}, reopened: { '2025-01-02': ['Bench Press'] }, sessionDone: {}, incr: {},
      },
    } as unknown as AppState);
    const set0 = state.overload.days['2025-01-02']![0]!;
    expect(set0.mins).toBe(22);
    expect(set0.dist).toBe(2.4);
    expect(state.overload.reopened!['2025-01-02']).toEqual(['Bench Press']);
    const r = roundTrip(state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rset = r.state.overload.days['2025-01-02']![0]!;
    expect(rset.mins).toBe(22);
    expect(rset.dist).toBe(2.4);
    expect(r.state.overload.reopened!['2025-01-02']).toEqual(['Bench Press']);
  });

  it('AI-generated cards survive a normalise + export→import round-trip', () => {
    const state = normaliseState({
      csgraph: {
        mastery: {}, srs: {}, gymDone: {}, log: [],
        generated: { cpp: [{ id: 'ai-cpp-1', prompt: 'What is RAII?', reveal: 'Tie lifetime to scope.', mins: 5, flow: 'flip', src: { book: '', ref: 'AI-generated · verify' }, tags: ['cpp'], ai: true }] },
      },
    } as unknown as AppState);
    expect(state.csgraph.generated!.cpp![0]!.prompt).toBe('What is RAII?');
    const r = roundTrip(state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.state.csgraph.generated!.cpp![0]!;
    expect(c.id).toBe('ai-cpp-1');
    expect(c.reveal).toBe('Tie lifetime to scope.');
    expect(c.ai).toBe(true);
  });

  it('knowledge resetAt reset-epoch survives normalise + an export→import round-trip', () => {
    const state = normaliseState({
      csgraph: { mastery: {}, srs: {}, gymDone: {}, log: [], resetAt: 1734300000000 },
    } as unknown as AppState);
    expect(state.csgraph.resetAt).toBe(1734300000000);
    const r = roundTrip(state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.csgraph.resetAt).toBe(1734300000000);
  });

  it('theorist day.events, day.dayType, and top-level mastery survive normalise + an export→import round-trip', () => {
    const state = normaliseState({
      theorist: {
        banked: { '2026-01-01': 120 },
        day: { date: '2026-01-01', blocks: { b1: true }, scores: { s2: 2 }, banked: false, events: { 'algo:studied': 20, retrieval: 50 }, dayType: 'light' },
        mastery: { 'COS 226': { level: 0.75, reviewedAt: 1734300000000 }, 'MIT 6.006': { level: 0, reviewedAt: 1734300000001 } },
      },
    } as unknown as AppState);
    // normalise keeps them
    expect(state.theorist.day.events).toEqual({ 'algo:studied': 20, retrieval: 50 });
    expect(state.theorist.day.dayType).toBe('light');
    expect(state.theorist.mastery).toEqual({
      'COS 226': { level: 0.75, reviewedAt: 1734300000000 },
      'MIT 6.006': { level: 0, reviewedAt: 1734300000001 },
    });
    // and they survive a full export → import round-trip
    const r = roundTrip(state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.theorist.day.events).toEqual({ 'algo:studied': 20, retrieval: 50 });
    expect(r.state.theorist.day.dayType).toBe('light');
    expect(r.state.theorist.mastery).toEqual({
      'COS 226': { level: 0.75, reviewedAt: 1734300000000 },
      'MIT 6.006': { level: 0, reviewedAt: 1734300000001 },
    });
  });

  it('theorist normalise drops malformed mastery entries and clamps level to [0,1]', () => {
    const state = normaliseState({
      theorist: {
        banked: {},
        day: { date: '', blocks: {}, scores: {}, banked: false },
        mastery: {
          good: { level: 1.7, reviewedAt: 100 },       // level clamped to 1
          noAt: { level: 0.5 },                          // missing reviewedAt → dropped
          badAt: { level: 0.5, reviewedAt: 'nope' },     // non-finite reviewedAt → dropped
          badLvl: { level: 'x', reviewedAt: 100 },       // non-finite level → dropped
        },
      },
    } as unknown as AppState);
    expect(state.theorist.mastery).toEqual({ good: { level: 1, reviewedAt: 100 } });
  });

});

describe('round-trip serialisation', () => {
  it('export -> import is the identity for any state', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const original = normaliseState(state);
        const result = roundTrip(original);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.state).toEqual(original);              // deepEqual
        expect(serialise(exportBundle(result.state, '1970-01-01')))
          .toBe(serialise(exportBundle(original, '1970-01-01')));
      }),
      opts,
    );
  });

  it('is stable under repeated round trips', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        let s = normaliseState(state);
        for (let i = 0; i < 3; i++) {
          const r = roundTrip(s);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.state).toEqual(s);
          s = r.state;
        }
      }),
      opts,
    );
  });

  it('normalisation is idempotent', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const once = normaliseState(state);
        expect(normaliseState(once)).toEqual(once);
      }),
      opts,
    );
  });

  /** Rebuild an object with every key order reversed, recursively. */
  const reverseKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reverseKeys);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).reverse()) {
        out[k] = reverseKeys((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };

  it('canonicalise makes key order irrelevant', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const shuffled = reverseKeys(JSON.parse(JSON.stringify(state)));
        expect(JSON.stringify(canonicalise(normaliseState(state))))
          .toBe(JSON.stringify(canonicalise(normaliseState(shuffled))));
      }),
      opts,
    );
  });

  it('no data is lost: every set, meal and card survives', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const before = storageMetrics(normaliseState(state)).counts;
        const r = roundTrip(normaliseState(state));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(storageMetrics(r.state).counts).toEqual(before);
      }),
      opts,
    );
  });
});

describe('import validation', () => {
  it('rejects malformed input with reasons, never throws', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const r = importBundle(text);
        if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
      }),
      opts,
    );
  });

  it('rejects non-object JSON', () => {
    for (const text of ['[]', '"hi"', '42', 'null', 'true']) {
      const r = importBundle(text);
      expect(r.ok).toBe(false);
    }
  });

  it('accepts a bare state object with a warning', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const r = importBundle(JSON.stringify(normaliseState(state)));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.warnings.some((w) => w.includes('bare state'))).toBe(true);
        expect(r.state).toEqual(normaliseState(state));
      }),
      { numRuns: Math.min(RUNS, 2000) },
    );
  });

  it('warns on a version mismatch but still imports', () => {
    const bundle = { meridian: 1, exportedAt: '2020-01-01', data: {} };
    const r = importBundle(JSON.stringify(bundle));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.includes('version'))).toBe(true);
  });

  it('survives partial files, filling missing stores', () => {
    fc.assert(
      fc.property(arbAppState, fc.constantFrom('core', 'overload', 'surplus', 'csgraph'), (state, drop) => {
        const partial: Record<string, unknown> = { ...normaliseState(state) };
        delete partial[drop];
        const r = importBundle(JSON.stringify({ meridian: BUNDLE_VERSION, exportedAt: 'x', data: partial }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.warnings.some((w) => w.includes(drop))).toBe(true);
        expect(r.state[drop as keyof AppState]).toBeDefined();
      }),
      { numRuns: Math.min(RUNS, 2000) },
    );
  });

  it('coerces hostile values instead of propagating them', () => {
    const hostile = {
      meridian: BUNDLE_VERSION, exportedAt: 'x',
      data: {
        overload: { days: { '2026-01-01': [{ id: 1, ex: null, type: 'bogus', weight: 'abc', reps: undefined }] } },
        surplus: { days: { '2026-01-01': [{ id: 2, name: 5, cal: 'x', protein: null }] } },
        csgraph: { mastery: { a: 99, b: 3 }, srs: { a: { interval: '7', reps: '2' } } },
      },
    };
    const r = importBundle(JSON.stringify(hostile));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const set = r.state.overload.days['2026-01-01']![0]!;
    expect(set.type).toBe('top');                 // invalid enum coerced
    expect(set.weight).toBe(0);                   // 'abc' -> 0, not NaN
    expect(Number.isNaN(set.reps as number)).toBe(false);
    expect(r.state.csgraph.mastery.a).toBeUndefined();  // 99 is out of range
    expect(r.state.csgraph.mastery.b).toBe(3);
    expect(r.state.csgraph.srs.a?.ivl).toBe(7);   // legacy field name accepted
  });
});

describe('metrics and CSV', () => {
  it('metrics are finite and consistent with the state', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const s = normaliseState(state);
        const m = storageMetrics(s);
        expect(Number.isFinite(m.bytes)).toBe(true);
        expect(m.bytes).toBeGreaterThan(0);
        expect(m.counts.workoutSets).toBe(
          Object.values(s.overload.days).reduce((a, x) => a + x.length, 0),
        );
        expect(m.counts.meals).toBe(
          Object.values(s.surplus.days).reduce((a, x) => a + x.length, 0),
        );
      }),
      opts,
    );
  });

  it('CSV quoting is RFC 4180 safe for any string', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const cell = csvCell(s);
        if (/[",\r\n]/.test(s)) {
          expect(cell.startsWith('"')).toBe(true);
          expect(cell.endsWith('"')).toBe(true);
          expect(cell.slice(1, -1).replace(/""/g, '')).not.toContain('"');
        } else {
          expect(cell).toBe(s);
        }
      }),
      opts,
    );
  });

  it('CSV rows always have a header and one line per record', () => {
    fc.assert(
      fc.property(arbAppState, (state) => {
        const s = normaliseState(state);
        const sets = Object.values(s.overload.days).reduce((a, x) => a + x.length, 0);
        const meals = Object.values(s.surplus.days).reduce((a, x) => a + x.length, 0);
        expect(workoutCsv(s.overload).split('\r\n').length).toBe(sets + 1);
        expect(mealCsv(s.surplus).split('\r\n').length).toBe(meals + 1);
      }),
      opts,
    );
  });

  it('toCsv never emits an unescaped newline inside a field', () => {
    fc.assert(
      fc.property(fc.array(fc.array(fc.string(), { maxLength: 4 }), { maxLength: 5 }), (rows) => {
        const csv = toCsv(rows);
        expect(csv.split('\r\n').length).toBe(Math.max(rows.length, 1));
      }),
      { numRuns: Math.min(RUNS, 3000) },
    );
  });
});

describe('core todos + scratch survive a backup (regression: normaliseCore dropped them)', () => {
  it('normalise keeps every todo and scratch card field', () => {
    const core = {
      schedule: {}, entries: [],
      todos: [{ id: 't1', text: 'Call the bank', done: false, created: 5, due: '2026-09-30' }, { id: 't2', text: 'x', done: true, created: 6 }],
      scratch: [{ id: 's1', title: 'Idea', body: 'Long notes', status: 'trying', created: 1, updated: 2 }],
      _del: {},
    };
    const n = normaliseState({ core } as unknown as AppState).core;
    expect(n.todos).toEqual(core.todos);
    expect(n.scratch).toEqual(core.scratch);
  });

  it('an export -> import round-trip returns them unchanged', () => {
    fc.assert(
      fc.property(arbAppState, (raw) => {
        const state = normaliseState(raw);
        const r = roundTrip(state);
        if (!r.ok) throw new Error('import failed: ' + r.errors.join('; '));
        expect(r.state.core.todos).toEqual(state.core.todos);
        expect(r.state.core.scratch).toEqual(state.core.scratch);
        expect(state.core.todos).toHaveLength((raw.core as { todos: unknown[] }).todos.length);
      }),
      opts,
    );
  });
});

describe('knowledge FSRS state survives a backup (regression: rebuilt as legacy SM-2)', () => {
  it('keeps stability, difficulty, lapses, state, and lastReview through export -> import', () => {
    const fsrsRow = { due: '2026-11-20', stability: 61.2, difficulty: 4.3, reps: 7, lapses: 1, state: 2, lastReview: '2026-09-20' };
    const state = normaliseState({ csgraph: { mastery: { q1: 4 }, srs: { q1: fsrsRow, q2: { due: '2025-02-01', ivl: 10, ease: 2.5, n: 3 } }, log: [], gymDone: {} } } as unknown as AppState);
    expect(state.csgraph.srs.q1).toEqual(fsrsRow);
    const r = roundTrip(state);
    if (!r.ok) throw new Error(r.errors.join('; '));
    expect(r.state.csgraph.srs.q1).toEqual(fsrsRow);
    expect(r.state.csgraph.srs.q2).toEqual({ due: '2025-02-01', ivl: 10, ease: 2.5, n: 3 }); // legacy rows unchanged
  });
});

describe('normaliseCore drops rows that cannot be merged', () => {
  it('drops non-objects and empty ids, keeps the first of a duplicate id', () => {
    const core = {
      schedule: {}, entries: [],
      todos: [null, 'x', { id: '', text: 'no id', done: false, created: 1 }, { id: 't1', text: 'first', done: false, created: 1 }, { id: 't1', text: 'dup', done: true, created: 2 }],
      scratch: [{ id: 's1', title: 'A', body: '', status: 'bogus', created: 1, updated: 1 }],
      _del: {},
    };
    const n = normaliseState({ core } as unknown as AppState).core;
    expect(n.todos!.map((t) => t.text)).toEqual(['first']);
    expect(n.scratch![0]!.status).toBe('idea'); // unknown status falls back
  });
});
