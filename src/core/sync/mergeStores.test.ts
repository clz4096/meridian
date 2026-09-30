import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { MealState, WorkoutState } from '@/core/types';
import {
  mergeCambridge, mergeCore, mergeKnowledge, mergeMeals, mergeScalarMap, mergeStore, mergeWorkout, sanitizeStore, unionById,
} from '@/core/sync/mergeStores';
import { emptyCambridge, type CamItem, type CambridgeState } from '@/features/cambridge/types';
import { DEFAULT_CONFIG } from '@/core/types';
import { shiftDate } from '@/core/util';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;
const arbDate = fc.integer({ min: 0, max: 60 }).map((o) => shiftDate('2026-01-01', o));
const arbId = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f');

const arbWK: fc.Arbitrary<WorkoutState> = fc.record({
  settings: fc.constant({}),
  days: fc.dictionary(arbDate, fc.array(fc.record({
    id: arbId, ex: fc.constantFrom('Bench', 'Squat'), type: fc.constantFrom('warm', 'top', 'back'),
    weight: fc.integer({ min: 1, max: 300 }), reps: fc.integer({ min: 1, max: 12 }),
  }), { maxLength: 4 }), { maxKeys: 4 }),
  bw: fc.dictionary(arbDate, fc.integer({ min: 100, max: 200 }), { maxKeys: 3 }),
  rpe: fc.constant({}),
  done: fc.dictionary(arbDate, fc.array(fc.constantFrom('Bench', 'Squat'), { maxLength: 2 }), { maxKeys: 3 }),
  sessionDone: fc.dictionary(arbDate, fc.boolean(), { maxKeys: 3 }),
  incr: fc.constant({}),
  _del: fc.dictionary(arbId, fc.integer({ min: 1, max: 1e12 }), { maxKeys: 3 }),
}) as fc.Arbitrary<WorkoutState>;

const ids = (s: WorkoutState): string[] =>
  Object.values(s.days).flat().map((x) => String(x.id)).sort();

describe('merge algebra on the real store shapes', () => {
  it('is idempotent', () => {
    fc.assert(fc.property(arbWK, (a) => {
      expect(ids(mergeWorkout(a, a, true))).toEqual(ids(mergeWorkout(mergeWorkout(a, a, true), a, true)));
    }), opts);
  });

  it('is commutative on surviving ids', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      expect(ids(mergeWorkout(a, b, true))).toEqual(ids(mergeWorkout(b, a, false)));
    }), opts);
  });

  it('is associative on surviving ids', () => {
    fc.assert(fc.property(arbWK, arbWK, arbWK, (a, b, c) => {
      const l = mergeWorkout(mergeWorkout(a, b, true), c, true);
      const r = mergeWorkout(a, mergeWorkout(b, c, true), true);
      expect(ids(l)).toEqual(ids(r));
    }), opts);
  });

  it('never resurrects a tombstoned row', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
      for (const id of ids(mergeWorkout(a, b, true))) expect(dead.has(id)).toBe(false);
    }), opts);
  });

  it('never drops a live row present on either side', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
      const live = new Set([...ids(a), ...ids(b)].filter((i) => !dead.has(i)));
      const out = new Set(ids(mergeWorkout(a, b, true)));
      for (const id of live) expect(out.has(id)).toBe(true);
    }), opts);
  });

  it('unions completion flags rather than picking a side', () => {
    fc.assert(fc.property(arbWK, arbWK, arbDate, (a, b, d) => {
      const merged = mergeWorkout(a, b, true);
      for (const ex of [...(a.done[d] ?? []), ...(b.done[d] ?? [])]) {
        expect(merged.done[d]).toContain(ex);
      }
    }), opts);
  });

  it('keeps disjoint scalar keys from both sides', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), fc.integer(), { maxKeys: 5 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), fc.integer(), { maxKeys: 5 }),
      fc.boolean(),
      (a, b, aWins) => {
        const out = mergeScalarMap(a, b, aWins);
        for (const k of [...Object.keys(a), ...Object.keys(b)]) expect(out).toHaveProperty(k);
        for (const k of Object.keys(a)) if (!(k in b)) expect(out[k]).toBe(a[k]);
        for (const k of Object.keys(b)) if (!(k in a)) expect(out[k]).toBe(b[k]);
      },
    ), opts);
  });

  it('unionById is stable and never yields duplicates', () => {
    fc.assert(fc.property(
      fc.array(fc.record({ id: arbId }), { maxLength: 8 }),
      fc.array(fc.record({ id: arbId }), { maxLength: 8 }),
      (a, b) => {
        const out = unionById(a, b, new Set());
        expect(new Set(out.map((x) => String(x.id))).size).toBe(out.length);
      },
    ), opts);
  });

  it('two devices converge regardless of sync order', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const deviceA = mergeWorkout(mergeWorkout(a, b, true), b, true);
      const deviceB = mergeWorkout(mergeWorkout(b, a, true), a, true);
      expect(ids(deviceA)).toEqual(ids(deviceB));
    }), opts);
  });

  it('meals merge with the same guarantees', () => {
    const arbSG: fc.Arbitrary<MealState> = fc.record({
      settings: fc.constant({}),
      days: fc.dictionary(arbDate, fc.array(fc.record({
        id: arbId, name: fc.string({ maxLength: 6 }),
        cal: fc.integer({ min: 0, max: 900 }), protein: fc.integer({ min: 0, max: 60 }),
      }), { maxLength: 4 }), { maxKeys: 4 }),
      tad: fc.dictionary(arbDate, fc.integer({ min: 0, max: 4 }), { maxKeys: 3 }),
      _del: fc.dictionary(arbId, fc.integer({ min: 1 }), { maxKeys: 2 }),
    }) as fc.Arbitrary<MealState>;
    const mids = (s: MealState): string[] => Object.values(s.days).flat().map((m) => String(m.id)).sort();
    fc.assert(fc.property(arbSG, arbSG, (a, b) => {
      expect(mids(mergeMeals(a, b, true))).toEqual(mids(mergeMeals(b, a, false)));
      const dead = new Set([...Object.keys(a._del ?? {}), ...Object.keys(b._del ?? {})]);
      for (const id of mids(mergeMeals(a, b, true))) expect(dead.has(id)).toBe(false);
    }), opts);
  });

  it('mergeStore dispatches without losing rows', () => {
    fc.assert(fc.property(arbWK, arbWK, (a, b) => {
      const viaDispatch = mergeStore('overload', a as never, b as never, true) as unknown as WorkoutState;
      expect(ids(viaDispatch)).toEqual(ids(mergeWorkout(a, b, true)));
    }), opts);
  });
});

describe('sanitize bounds tombstones on every save', () => {
  it('never exceeds the cap, regardless of how large the input is', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 2e12 }), { maxKeys: 900 }),
      fc.integer({ min: 1.6e12, max: 2e12 }),
      (del, now) => {
        const out = sanitizeStore('overload', { _del: del } as never, now) as { _del: Record<string, number> };
        expect(Object.keys(out._del).length).toBeLessThanOrEqual(DEFAULT_CONFIG.tombstoneMaxCount);
      },
    ), opts);
  });

  it('is a no-op when there is nothing to prune (preserves identity)', () => {
    const data = { _del: {}, days: {} } as never;
    expect(sanitizeStore('overload', data, Date.now())).toBe(data);
  });

  it('never mutates its input', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), fc.integer({ min: 1, max: 2e12 }), { maxKeys: 700 }),
      (del) => {
        const input = { _del: { ...del } } as never;
        const before = JSON.stringify(input);
        sanitizeStore('overload', input, 2e12);
        expect(JSON.stringify(input)).toBe(before);
      },
    ), { numRuns: Math.min(RUNS, 2000) });
  });

  it('leaves the knowledge store untouched (it has no tombstones)', () => {
    const kg = { mastery: { a: 5 } } as never;
    expect(sanitizeStore('csgraph', kg, Date.now())).toBe(kg);
  });
});

describe('mergeCore unions the nested todos + scratch', () => {
  const base = { schedule: {}, entries: [] };

  it('unions todos and scratch by id across both sides', () => {
    const local = {
      ...base,
      todos: [{ id: 't1', text: 'a', done: false, created: 1 }],
      scratch: [{ id: 's1', title: 'A', body: '', status: 'idea', created: 1, updated: 1 }],
    };
    const remote = {
      ...base,
      todos: [{ id: 't2', text: 'b', done: false, created: 2 }],
      scratch: [],
    };
    const m = mergeCore(local as never, remote as never, true);
    expect((m.todos ?? []).map((t) => String(t.id)).sort()).toEqual(['t1', 't2']);
    expect((m.scratch ?? []).map((c) => String(c.id))).toEqual(['s1']);
  });

  it('a tombstone on either side suppresses the todo and survives the merge', () => {
    const local = { ...base, todos: [{ id: 't1', text: 'a', done: false, created: 1 }], _del: { t1: 999 } };
    const remote = { ...base, todos: [{ id: 't1', text: 'a', done: false, created: 1 }] };
    const m = mergeCore(local as never, remote as never, true);
    expect(m.todos ?? []).toEqual([]);
    expect(m._del?.t1).toBe(999);
  });
});

describe('mergeKnowledge reset epoch propagates a wipe across devices', () => {
  const polluted = { mastery: { q1: 4, q2: 5 }, srs: { q1: { due: 'x' } }, log: [{ id: 'l1', qid: 'q1', at: 1, rating: 4 }], gymDone: { g: true } };
  const wiped = (at: number) => ({ mastery: {}, srs: {}, log: [], gymDone: {}, resetAt: at });

  it('a higher reset epoch (empty) discards the other side’s stale entries', () => {
    const m1 = mergeKnowledge(wiped(1000) as never, polluted as never, true);
    expect(m1.mastery).toEqual({});
    expect(m1.srs).toEqual({});
    expect(m1.log).toEqual([]);
    expect(m1.resetAt).toBe(1000);
    // order-independent: polluted on the other side is still wiped
    const m2 = mergeKnowledge(polluted as never, wiped(1000) as never, false);
    expect(m2.mastery).toEqual({});
    expect(m2.log).toEqual([]);
    expect(m2.resetAt).toBe(1000);
  });

  it('sides at the same epoch union normally (a fresh answer after the reset survives)', () => {
    const a = { mastery: { q9: 4 }, srs: {}, log: [{ id: 'l9', qid: 'q9', at: 5, rating: 4 }], gymDone: {}, resetAt: 1000 };
    const b = { mastery: { q8: 5 }, srs: {}, log: [{ id: 'l8', qid: 'q8', at: 6, rating: 5 }], gymDone: {}, resetAt: 1000 };
    const m = mergeKnowledge(a as never, b as never, true);
    expect(m.mastery).toEqual({ q9: 4, q8: 5 });
    expect(m.log.map((e) => String(e.id)).sort()).toEqual(['l8', 'l9']);
    expect(m.resetAt).toBe(1000);
  });

  it('two never-reset sides union as before (backward compatible)', () => {
    const a = { mastery: { q1: 4 }, srs: {}, log: [], gymDone: {} };
    const b = { mastery: { q2: 5 }, srs: {}, log: [], gymDone: {} };
    const m = mergeKnowledge(a as never, b as never, true);
    expect(m.mastery).toEqual({ q1: 4, q2: 5 });
    expect(m.resetAt).toBeUndefined();
  });

  it('unions the AI-generated card pool by id per topic (not dropped by merge)', () => {
    const card = (id: string) => ({ id, prompt: 'p' + id, reveal: 'r', mins: 5, flow: 'flip', src: { book: '', ref: 'AI' }, tags: ['cpp'], ai: true });
    const a = { mastery: {}, srs: {}, log: [], gymDone: {}, generated: { cpp: [card('ai-1')] } };
    const b = { mastery: {}, srs: {}, log: [], gymDone: {}, generated: { cpp: [card('ai-2')], gpu: [card('g-1')] } };
    const m = mergeKnowledge(a as never, b as never, true) as never as { generated: Record<string, Array<{ id: string }>> };
    expect(m.generated.cpp.map((c) => c.id).sort()).toEqual(['ai-1', 'ai-2']); // both survive
    expect(m.generated.gpu.map((c) => c.id)).toEqual(['g-1']);
  });

  it('a discarded generated card (tombstone) does NOT resurrect on sync — card, progress, and log all stay gone', () => {
    const card = (id: string) => ({ id, prompt: 'p' + id, reveal: 'r', mins: 5, flow: 'flip', src: { book: '', ref: 'AI' }, tags: ['cpp'], ai: true });
    // Device A discarded ai-1 (tombstoned; card/mastery/srs/log removed locally).
    const a = { mastery: {}, srs: {}, log: [], gymDone: {}, generated: {}, genDiscarded: ['ai-1'] };
    // Device B still holds ai-1 with its progress + a study-log entry.
    const b = { mastery: { 'ai-1': 5 }, srs: { 'ai-1': { due: 'x', ivl: 1, ease: 2.5, n: 1 } }, log: [{ id: 'l1', qid: 'ai-1', at: 1, rating: 5 }], gymDone: {}, generated: { cpp: [card('ai-1')] } };
    const m = mergeKnowledge(a as never, b as never, true) as never as { generated: Record<string, unknown[]>; mastery: Record<string, number>; srs: Record<string, unknown>; log: unknown[]; genDiscarded: string[] };
    expect(m.generated.cpp).toBeUndefined(); // card not resurrected (empty topic dropped)
    expect(m.mastery['ai-1']).toBeUndefined(); // progress stripped
    expect(m.srs['ai-1']).toBeUndefined();
    expect(m.log.length).toBe(0); // log entry stripped
    expect(m.genDiscarded).toContain('ai-1'); // tombstone carried forward
  });
});

/* ------------------------------------------------------------------ */
/* Cambridge: per-record LWW, tombstones, timer max                     */
/* ------------------------------------------------------------------ */

describe('mergeCambridge', () => {
  const DAY = 86_400_000;
  const item = (id: string, updatedAt: number, over: Partial<CamItem> = {}): CamItem =>
    ({ id, stage: 'attempting', questions: {}, updatedAt, ...over });
  const cam = (over: Partial<CambridgeState> = {}): CambridgeState => ({ ...emptyCambridge(), ...over });

  it('the newer record wins, per record, whichever side is local', () => {
    const a = cam({ items: { x: item('x', 10, { writeup: 'old' }), y: item('y', 30, { writeup: 'mine' }) } });
    const b = cam({ items: { x: item('x', 20, { writeup: 'edited elsewhere' }), y: item('y', 5, { writeup: 'stale' }) } });
    for (const m of [mergeCambridge(a, b, true), mergeCambridge(b, a, false)]) {
      expect(m.items.x!.writeup).toBe('edited elsewhere'); // an edit reaches the device that already had the item
      expect(m.items.y!.writeup).toBe('mine');
    }
  });

  it('errors, gates and weeks are LWW per record too', () => {
    const err = (fix: string, updatedAt: number) => ({ id: 'e', itemId: 'x', q: '1', cause: 'concept' as const, topic: 't', fix, at: 1, updatedAt });
    const a = cam({
      errors: { e: err('old', 1) },
      gates: { A: { phase: 'A', passedAt: 5, evidence: { a: 'old' }, updatedAt: 5 } },
      weeks: { '2026-W40': { week: '2026-W40', scores: { cold: 2, writeup: 2, supervisions: 2, redo: 2, pace: 2 }, updatedAt: 9 } },
    });
    const b = cam({
      errors: { e: err('new', 2) },
      gates: { A: { phase: 'A', passedAt: 5, evidence: { a: 'new' }, updatedAt: 6 } },
      weeks: { '2026-W40': { week: '2026-W40', scores: { cold: 0, writeup: 0, supervisions: 0, redo: 0, pace: 0 }, updatedAt: 8 } },
    });
    const m = mergeCambridge(a, b, true);
    expect(m.errors.e!.fix).toBe('new');
    expect(m.gates.A!.evidence).toEqual({ a: 'new' });
    expect(m.weeks['2026-W40']!.scores.cold).toBe(2);
  });

  it('a newer tombstone deletes; a newer live copy re-creates', () => {
    const live = cam({ items: { x: item('x', 10, { writeup: 'w' }) } });
    const dead = cam({ items: { x: { ...item('x', 20), deleted: true } } });
    expect(mergeCambridge(live, dead, true).items.x!.deleted).toBe(true);
    expect(mergeCambridge(dead, live, true).items.x!.deleted).toBe(true);
    const revived = cam({ items: { x: item('x', 30, { writeup: 'again' }) } });
    expect(mergeCambridge(dead, revived, true).items.x).toMatchObject({ writeup: 'again' });
    expect(mergeCambridge(dead, revived, true).items.x!.deleted).toBeUndefined();
  });

  it('a timestamp tie still converges: the tombstone wins on both devices', () => {
    const live = cam({ items: { x: item('x', 10) } });
    const dead = cam({ items: { x: { ...item('x', 10), deleted: true } } });
    expect(mergeCambridge(live, dead, true)).toEqual(mergeCambridge(dead, live, true));
    expect(mergeCambridge(live, dead, true).items.x!.deleted).toBe(true);
  });

  it('cold-attempt time takes the per-question max, even from the older copy', () => {
    const longer = cam({ items: { x: item('x', 10, { questions: { 1: { q: '1', coldSec: 4000 }, 2: { q: '2', coldSec: 50 } } }) } });
    const newer = cam({ items: { x: item('x', 20, { writeup: 'w', questions: { 1: { q: '1', coldSec: 1200, status: 'partial' } } }) } });
    const m = mergeCambridge(newer, longer, true);
    expect(m.items.x!.writeup).toBe('w');
    expect(m.items.x!.questions['1']).toEqual({ q: '1', coldSec: 4000, status: 'partial' });
    expect(m.items.x!.questions['2']).toEqual({ q: '2', coldSec: 50 }); // started only on the older copy: kept
  });

  it('awarded is a union that keeps the first payout time; migratedAt keeps the earliest', () => {
    const a = cam({ awarded: { 'cam:writeup:x': 5, 'cam:redo:x': 9 }, migratedAt: 100 });
    const b = cam({ awarded: { 'cam:writeup:x': 3, 'cam:gatePassed:A': 7 }, migratedAt: 50 });
    const m = mergeCambridge(a, b, true);
    expect(m.awarded).toEqual({ 'cam:writeup:x': 3, 'cam:redo:x': 9, 'cam:gatePassed:A': 7 });
    expect(m.migratedAt).toBe(50);
  });

  it('is dispatched from mergeStore', () => {
    const a = cam({ items: { x: item('x', 1) } });
    const b = cam({ items: { y: item('y', 1) } });
    expect(Object.keys((mergeStore('cambridge', a as never, b as never, true) as never as CambridgeState).items).sort()).toEqual(['x', 'y']);
  });

  // Few distinct values on purpose: timestamp ties and field clashes are the hard cases.
  const arbItem: fc.Arbitrary<CamItem> = fc.record({
    id: fc.constant('x'),
    stage: fc.constantFrom<CamItem['stage']>('attempting', 'written-up', 'supervised'),
    questions: fc.dictionary(
      fc.constantFrom('1', '2', '3'),
      fc.record({ q: fc.constant('q'), coldSec: fc.integer({ min: 0, max: 9000 }), status: fc.constantFrom<'solved' | 'stuck'>('solved', 'stuck') }),
      { maxKeys: 3 },
    ),
    updatedAt: fc.integer({ min: 1, max: 3 }),
    writeup: fc.constantFrom('a', 'b'),
  }).chain((it) => fc.boolean().map((deleted): CamItem => (deleted ? { ...it, deleted: true } : it)));
  const arbCam: fc.Arbitrary<CambridgeState> = fc.record({
    items: fc.dictionary(fc.constantFrom('x', 'y', 'z'), arbItem, { maxKeys: 3 }),
    awarded: fc.dictionary(fc.constantFrom('k1', 'k2', 'k3'), fc.integer({ min: 1, max: 100 }), { maxKeys: 3 }),
  }).map((p) => cam(p));

  it('is commutative, idempotent and associative (devices converge in any sync order)', () => {
    fc.assert(fc.property(arbCam, arbCam, arbCam, (a, b, c) => {
      const m = mergeCambridge(a, b, true);
      expect(m).toEqual(mergeCambridge(b, a, false));
      expect(mergeCambridge(m, m, true)).toEqual(m);
      expect(mergeCambridge(m, a, true)).toEqual(m);
      expect(mergeCambridge(m, b, true)).toEqual(m);
      expect(mergeCambridge(m, c, true)).toEqual(mergeCambridge(a, mergeCambridge(b, c, true), true));
    }), { numRuns: Math.max(RUNS, 1000) });
  });

  it('never lowers a live question\'s cold time', () => {
    fc.assert(fc.property(arbCam, arbCam, (a, b) => {
      const m = mergeCambridge(a, b, true);
      for (const side of [a, b]) {
        for (const [id, it] of Object.entries(side.items)) {
          const out = m.items[id]!;
          if (it.deleted || out.deleted) continue;
          for (const [q, x] of Object.entries(it.questions)) expect(out.questions[q]!.coldSec).toBeGreaterThanOrEqual(x.coldSec);
        }
      }
    }), opts);
  });

  it('sanitizeStore prunes Cambridge tombstones after 30 days and keeps everything else', () => {
    const now = 100 * DAY;
    const s = cam({
      items: {
        old: { ...item('old', now - 31 * DAY), deleted: true },
        fresh: { ...item('fresh', now - 2 * DAY), deleted: true },
        live: item('live', now - 90 * DAY),
      },
      errors: { e: { id: 'e', itemId: 'x', q: '1', cause: 'concept', topic: '', fix: '', at: 1, updatedAt: now - 40 * DAY, deleted: true } },
    });
    const out = sanitizeStore('cambridge', s as never, now) as never as CambridgeState;
    expect(Object.keys(out.items).sort()).toEqual(['fresh', 'live']);
    expect(out.errors).toEqual({});
    // Nothing to prune: the same object comes back.
    expect(sanitizeStore('cambridge', out as never, now)).toBe(out);
  });
});
