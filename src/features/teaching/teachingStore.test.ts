// @vitest-environment jsdom
/**
 * Learn by Teaching store tests — pure store/seed/band logic only. No aiCall is
 * ever invoked (no network): the view maps AI shapes onto the data model, so
 * these exercise seeding, the manual override, band thresholds, day-scoped XP
 * banking (idempotent via `creditEvent`), and localStorage round-tripping.
 *
 * jsdom is required: the store persists to localStorage and XP banking drives
 * the real `appState` singleton through the tracker's `creditEvent`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TheoristState } from '@/core/types';
import { appState } from '@/app/bootstrap';
import { syncTrackerFromStore, trackerState, todayISO, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';
import { algoOfDay } from '@/features/studytracker/algorithms';
import { lectureBand, type LessonPlan } from '@/features/teaching/teachingTypes';
import {
  DEFAULT_AUDIENCE, defaultLessonPlan, freshLoop, ensureTeachToday, teachLoop,
  updatePlan, setManualTopic, setTopicFromAlgo, setTranscript, setStage, setEvaluation, setQuestions,
  setAnswer, setDefenseGrade, setReflection, completeLoop, resetLoop, teachXpEarned, loopResult,
} from '@/features/teaching/teachingStore';

const KEY = 'meridian.teach.v1';

/** Reset the synced tracker to a clean today so day-scoped events start empty. */
function freshToday(): void {
  const t: TheoristState = { banked: {}, day: { date: todayISO(), blocks: {}, scores: {}, banked: false, events: {} } };
  appState.set('theorist', t as unknown as Record<string, unknown>);
  syncTrackerFromStore();
}

beforeEach(() => {
  localStorage.clear();
  freshToday();
  resetLoop();
});
afterEach(() => localStorage.clear());

describe('defaultLessonPlan seeds a blank-but-structured plan (generate-from-memory)', () => {
  it('carries the entry id/name/audience but leaves the generative fields blank', () => {
    const entry = algoOfDay();
    const plan = defaultLessonPlan(entry);
    // structural scaffold is preserved
    expect(plan.topicId).toBe(entry.id);
    expect(plan.topicName).toBe(entry.name);
    expect(plan.targetAudience).toBe(DEFAULT_AUDIENCE);
    // generative fields are blank on purpose — the user fills them from memory
    expect(plan.objectives).toEqual([]);
    expect(plan.arc).toEqual([]);
    expect(plan.definitions).toEqual([]);
    expect(plan.examples).toEqual([]);
    expect(plan.anticipatedHardQuestion).toBe('');
  });

  it('freshLoop starts in design with a blank-but-structured plan and empty work', () => {
    const l = freshLoop();
    expect(l.stage).toBe('design');
    expect(l.date).toBe(todayISO());
    expect(l.transcript).toBe('');
    expect(l.evaluation).toBeNull();
    expect(l.session).toBeNull();
    expect(l.plan.topicId).toBe(algoOfDay().id);
    expect(l.plan.objectives).toEqual([]);
  });
});

describe('setTopicFromAlgo switches topic to a catalogue entry', () => {
  it('reseeds a blank-but-structured plan for the chosen entry', () => {
    // seed some content, then switch — the new plan is blank but carries the entry.
    updatePlan({ objectives: ['x'], anticipatedHardQuestion: 'y' });
    const entry = algoOfDay();
    setTopicFromAlgo(entry);
    const p = teachLoop.value.plan;
    expect(p.topicId).toBe(entry.id);
    expect(p.topicName).toBe(entry.name);
    expect(p.targetAudience).toBe(DEFAULT_AUDIENCE);
    expect(p.objectives).toEqual([]);
    expect(p.arc).toEqual([]);
    expect(p.definitions).toEqual([]);
    expect(p.examples).toEqual([]);
    expect(p.anticipatedHardQuestion).toBe('');
  });
});

describe('manual topic override', () => {
  it('sets topicId "custom:<slug>", replaces the name, and clears the seeded fields', () => {
    setManualTopic('Big-O Notation & Asymptotics!');
    const p = teachLoop.value.plan;
    expect(p.topicId).toBe('custom:big-o-notation-asymptotics');
    expect(p.topicName).toBe('Big-O Notation & Asymptotics!');
    expect(p.objectives).toEqual([]);
    expect(p.arc).toEqual([]);
    expect(p.definitions).toEqual([]);
    expect(p.examples).toEqual([]);
    expect(p.anticipatedHardQuestion).toBe('');
    // the (non-entry-seeded) audience is preserved
    expect(p.targetAudience).toBe(DEFAULT_AUDIENCE);
  });

  it('ignores a blank topic name', () => {
    const before = teachLoop.value.plan.topicId;
    setManualTopic('   ');
    expect(teachLoop.value.plan.topicId).toBe(before);
  });
});

describe('lectureBand thresholds', () => {
  it('maps totals to the documented bands (11-12 Excellent, 8-10 Solid, 5-7 Developing, <5 Rework)', () => {
    expect(lectureBand(12)).toEqual({ word: 'Excellent', cls: 'green' });
    expect(lectureBand(11)).toEqual({ word: 'Excellent', cls: 'green' });
    expect(lectureBand(10)).toEqual({ word: 'Solid', cls: 'green' });
    expect(lectureBand(8)).toEqual({ word: 'Solid', cls: 'green' });
    expect(lectureBand(7)).toEqual({ word: 'Developing', cls: 'amber' });
    expect(lectureBand(5)).toEqual({ word: 'Developing', cls: 'amber' });
    expect(lectureBand(4)).toEqual({ word: 'Rework', cls: 'red' });
    expect(lectureBand(0)).toEqual({ word: 'Rework', cls: 'red' });
  });
});

describe('XP banking is idempotent + day-scoped (creditEvent semantics)', () => {
  const evalOk = { rubricScores: [2, 2, 2, 2, 2, 2], perDimensionFeedback: ['', '', '', '', '', ''], total: 12 };
  const questions = [
    { persona: 'maya' as const, text: 'q1', targetsUncovered: false },
    { persona: 'devin' as const, text: 'q2', targetsUncovered: false },
    { persona: 'priya' as const, text: 'q3', targetsUncovered: true },
    { persona: 'chen' as const, text: 'q4', targetsUncovered: false },
  ];

  it('banks lecture (20) only once even if office hours is (re-)entered twice', () => {
    setEvaluation(evalOk);
    setQuestions(questions);
    setQuestions(questions); // re-fire — must not double-pay
    expect(trackerState.value.day.events?.['teach:lecture']).toBe(EVENT_WEIGHTS.algoStudied);
    expect(teachXpEarned()).toBe(EVENT_WEIGHTS.algoStudied);
  });

  it('does NOT bank the lecture when there is no evaluation yet (entering office prematurely)', () => {
    setQuestions(questions); // no evaluation set
    expect(trackerState.value.day.events?.['teach:lecture'] ?? 0).toBe(0);
  });

  it('banks defense (retrieval 50) once and reflection (10) once; a re-fire never doubles', () => {
    setEvaluation(evalOk);
    setQuestions(questions);
    for (let i = 0; i < 4; i++) setAnswer(i, `answer ${i}`);
    setDefenseGrade({ scores: [2, 2, 1, 2], feedback: ['a', 'b', 'c', 'd'] });
    setDefenseGrade({ scores: [2, 2, 1, 2], feedback: ['a', 'b', 'c', 'd'] }); // re-fire
    expect(trackerState.value.day.events?.['teach:defense']).toBe(EVENT_WEIGHTS.retrieval);

    setReflection('Priya exposed the n0 gap.');
    expect(completeLoop()).not.toBeNull();
    completeLoop(); // re-fire
    expect(trackerState.value.day.events?.['teach:reflection']).toBe(EVENT_WEIGHTS.journalSave);

    // total banked = 20 + 50 + 10 = 80
    expect(teachXpEarned()).toBe(EVENT_WEIGHTS.algoStudied + EVENT_WEIGHTS.retrieval + EVENT_WEIGHTS.journalSave);
  });

  it('completeLoop refuses to bank a blank reflection', () => {
    setReflection('   ');
    expect(completeLoop()).toBeNull();
    expect(trackerState.value.day.events?.['teach:reflection'] ?? 0).toBe(0);
  });

  it('loopResult reports the teaching total, summed defense, and banked XP', () => {
    setEvaluation(evalOk);
    setQuestions(questions);
    setDefenseGrade({ scores: [2, 1, 0, 2], feedback: ['', '', '', ''] });
    setReflection('done');
    completeLoop();
    const r = loopResult();
    expect(r.teachingScore).toBe(12);
    expect(r.defenseScore).toBe(5); // 2+1+0+2
    expect(r.reflection).toBe('done');
    expect(r.xpEarned).toBe(EVENT_WEIGHTS.algoStudied + EVENT_WEIGHTS.retrieval + EVENT_WEIGHTS.journalSave);
  });
});

describe('persistence round-trips through localStorage', () => {
  it('every mutation writes the full loop; the stored blob equals the signal', () => {
    setStage('present');
    setTranscript('a lecture body');
    updatePlan({ targetAudience: 'a curious teammate' });
    const stored = JSON.parse(localStorage.getItem(KEY) as string);
    expect(stored).toEqual(teachLoop.value);
    expect(stored.transcript).toBe('a lecture body');
    expect(stored.plan.targetAudience).toBe('a curious teammate');
  });

  it('ensureTeachToday rehydrates a persisted today-loop verbatim', () => {
    const saved: LessonPlan = { ...freshLoop().plan, topicName: 'Persisted Topic', targetAudience: 'X' };
    const loop = { ...freshLoop(), stage: 'office' as const, transcript: 'kept', plan: saved };
    localStorage.setItem(KEY, JSON.stringify(loop));
    ensureTeachToday();
    expect(teachLoop.value).toEqual(loop);
    expect(teachLoop.value.transcript).toBe('kept');
    expect(teachLoop.value.plan.topicName).toBe('Persisted Topic');
  });

  it('ensureTeachToday seeds a fresh loop when storage holds a stale (non-today) date', () => {
    localStorage.setItem(KEY, JSON.stringify({ ...freshLoop('2000-01-01'), transcript: 'old' }));
    ensureTeachToday();
    expect(teachLoop.value.date).toBe(todayISO());
    expect(teachLoop.value.transcript).toBe('');
    // the fresh seed is stamped durably
    expect(JSON.parse(localStorage.getItem(KEY) as string).date).toBe(todayISO());
  });
});
