/**
 * Learn by Teaching — the PhD teaching simulator's per-day loop state.
 *
 * ORDINARY-tier, local-only: the loop persists to the namespaced key
 * `meridian.teach.v1` (NOT routed through the sync kernel). XP is the one thing
 * that flows into the synced instrument — banked via the tracker's
 * `creditEvent` (day-scoped, idempotent, max-merged), so re-firing a stage never
 * double-pays and the credit resets with the day like every other event.
 *
 * The store is deliberately decoupled from `src/services/ai.ts`: the view maps
 * the AI's return shapes onto the plain data model here, which keeps this module
 * (and its tests) free of any network transport. See
 * docs/learn-by-teaching-2026-09-20.md.
 */
import { signal } from '@preact/signals';
import type {
  LessonPlan, LectureEvaluation, OfficeHoursSession, OfficeHoursQuestion, TeachingLoopResult,
} from '@/features/teaching/teachingTypes';
import { algoOfDay, type AlgoEntry } from '@/features/studytracker/algorithms';
import { todayISO, creditEvent, trackerState, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';

export type TeachStage = 'design' | 'present' | 'evaluate' | 'office' | 'scorecard';

/** The whole per-day loop, persisted verbatim. */
export interface TeachLoop {
  date: string; // ISO yyyy-mm-dd
  stage: TeachStage;
  plan: LessonPlan;
  transcript: string;
  evaluation: LectureEvaluation | null;
  session: OfficeHoursSession | null;
  reflection: string;
}

const KEY = 'meridian.teach.v1';

/** The default target audience the Lesson Designer seeds (editable). */
export const DEFAULT_AUDIENCE = 'a Princeton CS freshman who can code but is new to this topic';

/**
 * Seed a fresh LessonPlan for the given algorithm entry. The structural scaffold
 * is preserved (topicId/topicName/targetAudience) but the generative fields are
 * left BLANK on purpose: the user fills objectives/arc/definitions/examples and
 * the anticipated hard question FROM MEMORY (generate-then-check), with an opt-in
 * "Peek at your notes" reveal if they get stuck. Pre-supplying the entry's own
 * material here would defeat the retrieval practice. Nothing here is sent to the
 * grader; the plan is the user's own scaffold (the AI grades the transcript).
 */
export function defaultLessonPlan(entry: AlgoEntry): LessonPlan {
  return {
    topicId: entry.id,
    topicName: entry.name,
    targetAudience: DEFAULT_AUDIENCE,
    objectives: [],
    arc: [],
    definitions: [],
    examples: [],
    anticipatedHardQuestion: '',
  };
}

/** A brand-new loop for `date` (defaults to today), seeded from the algo of the day. */
export function freshLoop(date: string = todayISO()): TeachLoop {
  return {
    date,
    stage: 'design',
    plan: defaultLessonPlan(algoOfDay()),
    transcript: '',
    evaluation: null,
    session: null,
    reflection: '',
  };
}

/** Load today's persisted loop, or seed a fresh one. `seeded` is true when a new loop was created. */
function loadOrSeed(): { loop: TeachLoop; seeded: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as TeachLoop;
      if (v && typeof v === 'object' && v.plan && v.date === todayISO()) return { loop: v, seeded: false };
    }
  } catch {
    /* ignore corrupt / unavailable storage */
  }
  return { loop: freshLoop(), seeded: true };
}

export const teachLoop = signal<TeachLoop>(loadOrSeed().loop);

function persist(next: TeachLoop): void {
  teachLoop.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Rehydrate the loop on mount and roll it over on a new day. Re-reads storage so
 * a return visit shows the persisted loop; when a fresh loop is seeded (rollover
 * or first use) it is stamped to storage so the seed is durable.
 */
export function ensureTeachToday(): void {
  const { loop, seeded } = loadOrSeed();
  teachLoop.value = loop;
  if (seeded) persist(loop);
}

/* ── actions (persist on every mutation) ── */

/** Patch the lesson plan (audience, objectives, arc, definitions, examples, anticipated question). */
export function updatePlan(patch: Partial<LessonPlan>): void {
  persist({ ...teachLoop.value, plan: { ...teachLoop.value.plan, ...patch } });
}

/**
 * Manual topic override: replace the topic with a custom one and clear the
 * entry-seeded fields for a blank plan. `topicId` becomes `custom:<slug>`. The
 * target audience (not an entry-seeded field) is kept.
 */
/**
 * Switch the topic to a catalogue algorithm, reseeding a blank-but-structured
 * plan (see defaultLessonPlan). Used by the Design-stage topic pills.
 */
export function setTopicFromAlgo(entry: AlgoEntry): void {
  persist({ ...teachLoop.value, plan: defaultLessonPlan(entry) });
}

export function setManualTopic(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const plan: LessonPlan = {
    topicId: 'custom:' + slug,
    topicName: trimmed,
    targetAudience: teachLoop.value.plan.targetAudience || DEFAULT_AUDIENCE,
    objectives: [],
    arc: [],
    definitions: [],
    examples: [],
    anticipatedHardQuestion: '',
  };
  persist({ ...teachLoop.value, plan });
}

export function setTranscript(transcript: string): void {
  persist({ ...teachLoop.value, transcript });
}

export function setStage(stage: TeachStage): void {
  persist({ ...teachLoop.value, stage });
}

export function setEvaluation(evaluation: LectureEvaluation): void {
  persist({ ...teachLoop.value, evaluation });
}

/**
 * Record the four office-hours questions and open a fresh session. Banks the
 * lecture XP: entering office hours only happens after a successful lecture
 * grade, so the credit is guarded on a non-null evaluation and (being
 * `creditEvent`) is idempotent per day.
 */
export function setQuestions(questions: OfficeHoursQuestion[]): void {
  const session: OfficeHoursSession = {
    questions,
    answers: questions.map(() => ''),
    answerScores: [],
    perAnswerFeedback: [],
  };
  const next: TeachLoop = { ...teachLoop.value, session };
  if (next.evaluation) creditEvent('teach:lecture', EVENT_WEIGHTS.algoStudied);
  persist(next);
}

export function setAnswer(i: number, text: string): void {
  const s = teachLoop.value.session;
  if (!s || i < 0 || i >= s.answers.length) return;
  const answers = s.answers.slice();
  answers[i] = text;
  persist({ ...teachLoop.value, session: { ...s, answers } });
}

/**
 * Record the defense grade and advance to the scorecard. Banks the defense XP as
 * a retrieval event (the top payout — this is retrieval under pressure).
 */
export function setDefenseGrade(grade: { scores: number[]; feedback: string[] }): void {
  const s = teachLoop.value.session;
  if (!s) return;
  const session: OfficeHoursSession = { ...s, answerScores: grade.scores, perAnswerFeedback: grade.feedback };
  creditEvent('teach:defense', EVENT_WEIGHTS.retrieval);
  persist({ ...teachLoop.value, session, stage: 'scorecard' });
}

export function setReflection(reflection: string): void {
  persist({ ...teachLoop.value, reflection });
}

/**
 * Complete the loop: bank the reflection XP (only when the reflection is
 * non-empty) and return the banked result. Returns null if the reflection is
 * blank so the caller can keep the prompt open.
 */
export function completeLoop(): TeachingLoopResult | null {
  if (!teachLoop.value.reflection.trim()) return null;
  creditEvent('teach:reflection', EVENT_WEIGHTS.journalSave);
  return loopResult();
}

export function resetLoop(): void {
  persist(freshLoop());
}

/* ── derivations ── */

/** Total XP banked by this loop today (sums the three day-scoped teach events). */
export function teachXpEarned(): number {
  const ev = trackerState.value.day.events ?? {};
  return (ev['teach:lecture'] ?? 0) + (ev['teach:defense'] ?? 0) + (ev['teach:reflection'] ?? 0);
}

/** The current loop's outcome (teaching /12, defense /8, XP, reflection). */
export function loopResult(): TeachingLoopResult {
  const l = teachLoop.value;
  const defenseScore = (l.session?.answerScores ?? []).reduce((a, b) => a + b, 0);
  return {
    date: l.date,
    teachingScore: l.evaluation?.total ?? 0,
    defenseScore,
    xpEarned: teachXpEarned(),
    reflection: l.reflection,
  };
}
