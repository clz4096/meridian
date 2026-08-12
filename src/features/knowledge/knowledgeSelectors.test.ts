import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { KnowledgeState, Mastery, SrsEntry } from '@/core/types';
import {
  DEFAULT_SRS, daysBetween, dueCards, isDue, normaliseEntry,
  schedule, selectStudyView, studyStreak, toCard,
  INTERVIEW_PRESETS, interviewPreset, interviewRelevant, interviewDeck, normalizeGenerated, knowledgeGrowth,
} from '@/features/knowledge/knowledgeSelectors';
import { shiftDate } from '@/core/util';

const RUNS = Number(process.env.FC_RUNS ?? 150);
const opts = { numRuns: RUNS } as const;
const C = DEFAULT_SRS;

const arbDate = fc.integer({ min: 0, max: 400 }).map((o) => shiftDate('2025-01-01', o));
const arbRating = fc.constantFrom<Mastery>(1, 2, 3, 4, 5);
const arbEntry: fc.Arbitrary<SrsEntry> = fc.record({
  due: arbDate,
  ivl: fc.integer({ min: 0, max: 400 }),
  ease: fc.double({ min: 1.0, max: 3.5, noNaN: true }),
  n: fc.integer({ min: 0, max: 40 }),
});
/** Deliberately hostile inputs: legacy field names, strings, nulls, NaN. */
const arbMessyEntry = fc.oneof(
  arbEntry,
  fc.record({ interval: fc.integer({ min: -50, max: 500 }), ease: fc.constantFrom(0, -1, NaN, 99), reps: fc.integer({ min: -5, max: 50 }) }),
  fc.record({ ivl: fc.constantFrom('7', 'abc', null, undefined), ease: fc.constantFrom('2.5', ''), n: fc.constantFrom('3', null) }),
  fc.constant(undefined), fc.constant(null), fc.constant({}),
);

describe('normalisation is total', () => {
  it('always yields a finite, in-range entry from any input', () => {
    fc.assert(
      fc.property(arbMessyEntry, (raw) => {
        const e = normaliseEntry(raw as never);
        expect(Number.isFinite(e.ivl)).toBe(true);
        expect(Number.isFinite(e.ease)).toBe(true);
        expect(Number.isFinite(e.n)).toBe(true);
        expect(e.ivl).toBeGreaterThanOrEqual(0);
        expect(e.ivl).toBeLessThanOrEqual(C.maxInterval);
        expect(e.ease).toBeGreaterThanOrEqual(C.minEase);
        expect(e.ease).toBeLessThanOrEqual(C.maxEase);
        expect(e.n).toBeGreaterThanOrEqual(0);
      }),
      opts,
    );
  });

  it('accepts the legacy `interval`/`reps` field names', () => {
    const e = normaliseEntry({ interval: 12, reps: 4, ease: 2.2, due: '2026-01-01' } as never);
    expect(e.ivl).toBe(12);
    expect(e.n).toBe(4);
  });
});

describe('a pass advances the schedule', () => {
  it('never decreases the interval, and never exceeds the ceiling', () => {
    fc.assert(
      fc.property(arbMessyEntry, fc.constantFrom<Mastery>(2, 3, 4, 5), arbDate, (raw, rating, today) => {
        const prev = normaliseEntry(raw as never);
        const next = schedule(prev, rating, today);
        expect(next.ivl).toBeGreaterThanOrEqual(1);
        expect(next.ivl).toBeLessThanOrEqual(C.maxInterval);
        if (prev.n >= 2 && prev.ivl >= 1) {
          expect(next.ivl).toBeGreaterThanOrEqual(prev.ivl); // ease >= 1.3 so it grows
        }
      }),
      opts,
    );
  });

  it('increments the repetition count on every pass', () => {
    fc.assert(
      fc.property(arbMessyEntry, fc.constantFrom<Mastery>(2, 3, 4, 5), arbDate, (raw, rating, today) => {
        const prev = normaliseEntry(raw as never);
        expect(schedule(prev, rating, today).n).toBe(prev.n + 1);
      }),
      opts,
    );
  });

  it('follows the 1 -> 3 -> interval x ease ladder', () => {
    fc.assert(
      fc.property(fc.constantFrom<Mastery>(3, 4, 5), arbDate, (rating, today) => {
        const first = schedule(undefined, rating, today);
        expect(first.ivl).toBe(C.firstInterval);
        const second = schedule(first, rating, today);
        expect(second.ivl).toBe(C.secondInterval);
        const third = schedule(second, rating, today);
        expect(third.ivl).toBe(Math.min(C.maxInterval, Math.round(second.ivl * second.ease)));
      }),
      opts,
    );
  });

  it('a higher rating never schedules sooner than a lower one', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbDate, (raw, today) => {
        const prev = normaliseEntry(raw as never);
        const lo = schedule(prev, 2, today);
        const hi = schedule(prev, 5, today);
        expect(hi.ivl).toBeGreaterThanOrEqual(lo.ivl);
        expect(hi.ease).toBeGreaterThanOrEqual(lo.ease);
      }),
      opts,
    );
  });
});

describe('a fail resets to the floor', () => {
  it('drops the interval to the lapse value and zeroes the streak', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbDate, (raw, today) => {
        const prev = normaliseEntry(raw as never);
        const next = schedule(prev, 1, today);
        expect(next.ivl).toBe(C.lapseInterval);
        expect(next.n).toBe(0);
        expect(next.due).toBe(shiftDate(today, C.lapseInterval));
        if (prev.ivl > C.lapseInterval) expect(next.ivl).toBeLessThan(prev.ivl); // strictly decreases
      }),
      opts,
    );
  });

  it('a lapse never pushes ease outside its bounds', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbDate, (raw, today) => {
        const next = schedule(normaliseEntry(raw as never), 1, today);
        expect(next.ease).toBeGreaterThanOrEqual(C.minEase);
        expect(next.ease).toBeLessThanOrEqual(C.maxEase);
      }),
      opts,
    );
  });

  it('repeated failures cannot drive the interval below the floor', () => {
    fc.assert(
      fc.property(arbEntry, arbDate, (start, today) => {
        let e = start;
        for (let i = 0; i < 20; i++) e = schedule(e, 1, today);
        expect(e.ivl).toBe(C.lapseInterval);
        expect(e.ivl).toBeGreaterThan(0);
      }),
      opts,
    );
  });
});

describe('intervals are always sane', () => {
  it('never negative, never NaN, never beyond the ceiling — over long histories', () => {
    fc.assert(
      fc.property(fc.array(arbRating, { minLength: 1, maxLength: 60 }), arbDate, (ratings, today) => {
        let e: SrsEntry | undefined;
        let day = today;
        for (const r of ratings) {
          e = schedule(e, r, day);
          expect(Number.isFinite(e.ivl)).toBe(true);
          expect(Number.isNaN(e.ivl)).toBe(false);
          expect(e.ivl).toBeGreaterThan(0);
          expect(e.ivl).toBeLessThanOrEqual(C.maxInterval);
          expect(e.ease).toBeGreaterThanOrEqual(C.minEase);
          expect(e.due > day).toBe(true);        // always scheduled in the future
          day = e.due;
        }
      }),
      opts,
    );
  });

  it('the due date is exactly today + interval', () => {
    fc.assert(
      fc.property(arbMessyEntry, arbRating, arbDate, (raw, rating, today) => {
        const next = schedule(normaliseEntry(raw as never), rating, today);
        expect(next.due).toBe(shiftDate(today, next.ivl));
        expect(daysBetween(today, next.due)).toBe(next.ivl);
      }),
      opts,
    );
  });

  it('scheduling is deterministic and does not mutate the previous entry', () => {
    fc.assert(
      fc.property(arbEntry, arbRating, arbDate, (prev, rating, today) => {
        const frozen = Object.freeze({ ...prev });
        const a = schedule(frozen, rating, today);
        const b = schedule(frozen, rating, today);
        expect(a).toEqual(b);
        expect(frozen).toEqual(prev);
      }),
      opts,
    );
  });
});

describe('due queue and view model', () => {
  const arbKG = fc.record({
    mastery: fc.dictionary(fc.hexaString({ minLength: 1, maxLength: 4 }), arbRating, { maxKeys: 12 }),
    srs: fc.dictionary(fc.hexaString({ minLength: 1, maxLength: 4 }), arbEntry, { maxKeys: 12 }),
    gymDone: fc.constant({}),
    log: fc.array(fc.record({ id: fc.uuid(), qid: fc.hexaString({ maxLength: 4 }), at: fc.integer({ min: 0 }), rating: arbRating, date: arbDate }), { maxLength: 20 }) as never,
  }) as unknown as fc.Arbitrary<KnowledgeState>;

  it('every due card is actually due, sorted most-overdue first', () => {
    fc.assert(
      fc.property(arbKG, arbDate, (kg, today) => {
        const ids = Object.keys(kg.srs);
        const due = dueCards(ids, kg, today);
        for (const c of due) {
          expect(c.due <= today).toBe(true);
          expect(isDue(kg.srs[c.id], today)).toBe(true);
        }
        for (let i = 1; i < due.length; i++) {
          expect(due[i - 1]!.overdueDays).toBeGreaterThanOrEqual(due[i]!.overdueDays);
        }
      }),
      opts,
    );
  });

  it('the view model partitions ids without loss or overlap', () => {
    fc.assert(
      fc.property(arbKG, arbDate, (kg, today) => {
        const ids = [...new Set([...Object.keys(kg.srs), ...Object.keys(kg.mastery), 'never-seen'])];
        const vm = selectStudyView(ids, kg, today);
        const covered = new Set([...vm.due.map((c) => c.id), ...vm.upcoming.map((c) => c.id), ...vm.unseen]);
        expect(covered.size).toBeLessThanOrEqual(ids.length);
        expect(vm.unseen).toContain('never-seen');
        for (const c of vm.due) expect(vm.upcoming.find((u) => u.id === c.id)).toBeUndefined();
        expect(vm.streakDays).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(vm.streakDays)).toBe(true);
      }),
      opts,
    );
  });

  it('toCard never produces NaN', () => {
    fc.assert(
      fc.property(arbKG, arbDate, (kg, today) => {
        for (const id of Object.keys(kg.srs)) {
          const c = toCard(id, kg, today);
          expect(Number.isNaN(c.interval)).toBe(false);
          expect(Number.isNaN(c.ease)).toBe(false);
          expect(Number.isNaN(c.reps)).toBe(false);
        }
        expect(studyStreak(kg, today)).toBeGreaterThanOrEqual(0);
      }),
      opts,
    );
  });
});

describe('interview decks — relevance-first, capped, unified progress', () => {
  type Card = { id: string; tags?: string[]; topic?: string };
  const T = '2025-06-01';
  const K = (mastery: Record<string, Mastery> = {}, srs: Record<string, unknown> = {}): KnowledgeState =>
    ({ mastery, srs, log: [], gymDone: {} } as unknown as KnowledgeState);

  const bank: Card[] = [
    { id: 'a1', topic: 'algorithms', tags: ['algorithms', 'dsa'] }, // SWE-relevant
    { id: 'c1', topic: 'cpp', tags: ['cpp', 'hft'] },               // HFT-relevant
    { id: 'm1', topic: 'mlfund', tags: ['ml', 'mlfund'] },          // ML-relevant
    { id: 'x1', topic: 'behavioral', tags: ['behavioral'] },        // SWE-only
    { id: 'z1', topic: 'gpu', tags: ['gpu', 'ml-systems'] },        // ML-relevant
  ];

  it('exposes the three presets and resolves them by id', () => {
    expect(INTERVIEW_PRESETS.map((p) => p.id)).toEqual(['swe', 'hft', 'ml']);
    expect(interviewPreset('hft')?.name).toContain('HFT');
    expect(interviewPreset('nope')).toBeUndefined();
  });

  it('only serves cards relevant to the chosen interview (tag intersection)', () => {
    const hft = interviewPreset('hft')!;
    const deck = interviewDeck(bank, K(), hft.tags, T);
    const ids = deck.map((c) => c.id);
    expect(ids).toContain('c1'); // cpp/hft
    expect(ids).not.toContain('m1'); // ml — not HFT
    expect(ids).not.toContain('x1'); // behavioral — not HFT
  });

  it('ranks the weaker / more-overdue relevant card first (relevance-first need)', () => {
    const swe = interviewPreset('swe')!;
    // a1 mastered (mastery 5), x1 unseen (mastery 0) → x1 needs study more
    const deck = interviewDeck(bank, K({ a1: 5 as Mastery }), swe.tags, T);
    expect(deck[0]!.id).toBe('x1');
    // give a1 an overdue review and x1 none → an overdue card outranks a merely-new one only via score;
    // here x1 weakness(5)*3=15 still beats a1 weakness(0)*3 + overdue; check x1 stays ahead of mastered a1
    expect(deck.map((c) => c.id).indexOf('x1')).toBeLessThan(deck.map((c) => c.id).indexOf('a1'));
  });

  it('caps the deck and reports it deterministically', () => {
    const swe = interviewPreset('swe')!;
    const many: Card[] = Array.from({ length: 40 }, (_, i) => ({ id: 's' + i, topic: 'algorithms', tags: ['dsa'] }));
    const deck = interviewDeck(many, K(), swe.tags, T, 20);
    expect(deck.length).toBe(20);
    // deterministic: same inputs → same order
    expect(interviewDeck(many, K(), swe.tags, T, 20).map((c) => c.id)).toEqual(deck.map((c) => c.id));
  });

  it('spreads the deck across the interview topics (round-robin, not alphabetically-first ids)', () => {
    const swe = interviewPreset('swe')!;
    // Many unseen cards across several SWE topics — the failure mode was the whole
    // deck collapsing onto the 2 topics whose ids sort first. Round-robin must span them.
    const topics = ['algorithms', 'databases', 'graph', 'sysdesign', 'networking', 'linux', 'behavioral'];
    const many: Card[] = [];
    topics.forEach((tp) => {
      for (let i = 0; i < 6; i++) many.push({ id: `${tp}-${i}`, topic: tp, tags: [tp === 'graph' ? 'graphs' : tp] });
    });
    const deck = interviewDeck(many, K(), swe.tags, T, 20);
    expect(deck.length).toBe(20);
    expect(new Set(deck.map((c) => c.topic)).size).toBe(topics.length); // every topic represented
  });

  it('interviewRelevant counts all relevant cards (for the overflow tally)', () => {
    const ml = interviewPreset('ml')!;
    // ml pulls in a1 too (its tag set includes 'algorithms' — ML interviews test DS&A).
    expect(interviewRelevant(bank, ml.tags).map((c) => c.id).sort()).toEqual(['a1', 'm1', 'z1']);
    // hft, by contrast, excludes the pure-ML and behavioral cards
    expect(interviewRelevant(bank, interviewPreset('hft')!.tags).map((c) => c.id).sort()).toEqual(['a1', 'c1']);
  });

  it('uses the SAME card ids as the bank so grading updates unified progress', () => {
    const swe = interviewPreset('swe')!;
    const deck = interviewDeck(bank, K(), swe.tags, T);
    for (const c of deck) expect(bank.some((b) => b.id === c.id)).toBe(true);
  });
});

describe('normalizeGenerated — AI card validation into a real card shape', () => {
  it('drops cards missing prompt/reveal, clamps mins/flow, tags the topic, flags ai + honest src', () => {
    const raw = [
      { prompt: 'What is a mutex?', reveal: 'A lock ensuring mutual exclusion.', mins: 5, flow: 'flip', tags: ['Concurrency'] },
      { prompt: 'Explain false sharing', reveal: 'Two cores thrash one cache line.', mins: 99, flow: 'nonsense' }, // bad mins/flow → 15/full
      { prompt: 'no reveal here', reveal: '' },      // dropped
      { reveal: 'no prompt' },                        // dropped
    ];
    const out = normalizeGenerated(raw, 'concurrency', 'ai-concurrency-x', []);
    expect(out.length).toBe(2);
    // card 1
    expect(out[0]!.prompt).toBe('What is a mutex?');
    expect(out[0]!.mins).toBe(5);
    expect(out[0]!.flow).toBe('flip');
    expect(out[0]!.tags).toContain('concurrency'); // topic always present, lowercased
    expect(out[0]!.ai).toBe(true);
    expect(out[0]!.src.book).toBe(''); // honest: no book → renders as plain text, never a fake link
    expect(out[0]!.src.ref.toLowerCase()).toContain('ai-generated');
    expect(out[0]!.id).toBe('ai-concurrency-x-0'); // deterministic, prefix + index
    // card 2 — invalid mins/flow coerced
    expect(out[1]!.mins).toBe(15);
    expect(out[1]!.flow).toBe('full');
  });

  it('de-dupes against existing prompts and within the batch (case-insensitive)', () => {
    const raw = [
      { prompt: 'What is RAII?', reveal: 'Tie resource lifetime to an object.', mins: 5, flow: 'flip' },
      { prompt: 'what is raii?', reveal: 'dup within batch', mins: 5, flow: 'flip' }, // dup of card 1
      { prompt: 'Define move semantics', reveal: 'Steal resources from an rvalue.', mins: 15, flow: 'full' },
    ];
    const out = normalizeGenerated(raw, 'cpp', 'ai-cpp-y', ['Define move semantics']); // one already exists
    expect(out.map((c) => c.prompt)).toEqual(['What is RAII?']); // batch-dup and existing-dup both removed
  });

  it('forces flip cards to 5 minutes (flow/mins stay consistent)', () => {
    const out = normalizeGenerated([{ prompt: 'q', reveal: 'a', mins: 30, flow: 'flip' }], 't', 'ai-t-z', []);
    expect(out[0]!.flow).toBe('flip');
    expect(out[0]!.mins).toBe(5);
  });
});

describe('knowledgeGrowth scopes solid/seen to the curated bank (AI pool excluded)', () => {
  it('a mastered AI card does not inflate solid/seen when a valid-id set is given', () => {
    const state = { mastery: { q1: 5, 'ai-1': 5 }, srs: {}, log: [], gymDone: {} } as unknown as KnowledgeState;
    const curated = new Set(['q1']); // ai-1 is not in the curated bank
    const g = knowledgeGrowth(state, '2025-06-01', 30, curated);
    expect(g.solid).toBe(1); // only q1, not ai-1
    expect(g.seen).toBe(1);
    // without a valid-id set (back-compat), both count
    const gAll = knowledgeGrowth(state, '2025-06-01');
    expect(gAll.solid).toBe(2);
  });
});
