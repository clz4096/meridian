/**
 * Learn by Teaching — the PhD teaching simulator's data model + shared constants.
 * See docs/learn-by-teaching-2026-09-20.md. The default topic is the Massey
 * Standard algorithm-of-the-day; teaching it is the day's mastery check.
 */

/** The structured plan the user designs before presenting. */
export interface LessonPlan {
  /** FK to the algo-of-day id (or 'custom:<slug>' for a manual override). */
  topicId: string;
  topicName: string;
  targetAudience: string;
  objectives: string[];
  arc: string[];
  definitions: string[];
  examples: string[];
  /** The hardest question the user anticipates and pre-plans for. */
  anticipatedHardQuestion: string;
}

/** The delivered lecture. Typed for the MVP; audio+transcript in v2. */
export interface LecturePresentation {
  transcript: string;
}

/** The AI's grade of the lecture transcript (6 dimensions, each 0/1/2, total /12). */
export interface LectureEvaluation {
  rubricScores: number[]; // length 6
  perDimensionFeedback: string[]; // length 6; non-empty when its score < 2
  total: number; // 0..12
}

export type PersonaKey = 'maya' | 'devin' | 'priya' | 'chen';

export interface OfficeHoursQuestion {
  persona: PersonaKey;
  text: string;
  /** True for a question aimed at something the lecture did NOT cover (Priya's is mandatory). */
  targetsUncovered: boolean;
}

/** One full office-hours defense: 4 escalating questions, the user's answers, and their grades. */
export interface OfficeHoursSession {
  questions: OfficeHoursQuestion[]; // length 4, order maya→devin→priya→chen
  answers: string[]; // length 4
  answerScores: number[]; // length 4, each 0/1/2
  perAnswerFeedback: string[]; // length 4; states what a full answer would include
}

/** The banked outcome of a completed loop. */
export interface TeachingLoopResult {
  date: string; // ISO yyyy-mm-dd
  teachingScore: number; // /12
  defenseScore: number; // /8
  xpEarned: number;
  reflection: string;
}

/** The six lecture-grading dimensions, in fixed order (index = rubricScores index). */
export const RUBRIC_DIMENSIONS: ReadonlyArray<{ key: string; label: string; blurb: string }> = [
  { key: 'correctness', label: 'Correctness', blurb: 'Definitions, claims, proofs and code precise and error-free.' },
  { key: 'why', label: 'Explains the why', blurb: 'Every key rule justified from a definition or first principle.' },
  { key: 'clarity', label: 'Clarity for the audience', blurb: 'The target-level person could follow it; terms glossed on first use.' },
  { key: 'structure', label: 'Structure / arc', blurb: 'Intuition → formal → application; motivation precedes formalism.' },
  { key: 'examples', label: 'Use of examples', blurb: 'A concrete worked example illustrates the abstract idea.' },
  { key: 'pacing', label: 'Pacing / compression', blurb: 'Fits the target length; no bloat, no critical omission.' },
];

export const LECTURE_MAX = 12; // 6 dimensions × 2
export const DEFENSE_MAX = 8; // 4 answers × 2

/** Band for a lecture total /12. */
export function lectureBand(total: number): { word: string; cls: string } {
  if (total >= 11) return { word: 'Excellent', cls: 'green' };
  if (total >= 8) return { word: 'Solid', cls: 'green' };
  if (total >= 5) return { word: 'Developing', cls: 'amber' };
  return { word: 'Rework', cls: 'red' };
}

/** The four office-hours personas, in escalating order. */
export const PERSONAS: ReadonlyArray<{ key: PersonaKey; name: string; role: string; blurb: string }> = [
  { key: 'maya', name: 'Maya', role: 'Confused beginner', blurb: 'Targets a step you moved through too fast — the mechanics of something you assumed was obvious.' },
  { key: 'devin', name: 'Devin', role: 'Sharp student', blurb: 'Probes the limits of a claim you made: "does this still hold if…?"' },
  { key: 'priya', name: 'Priya', role: 'Edge-case skeptic', blurb: 'Targets something you did NOT cover — an edge case, boundary, or counterexample.' },
  { key: 'chen', name: 'Professor Chen', role: 'Deep questioner', blurb: 'Asks why it is defined this way at all — the generative root, and what a different choice would break.' },
];
