/**
 * Workout feature — view-facing types shared by the actions layer and the
 * WorkoutView component. The `WorkoutViewModel` itself lives in `@/core/types`
 * (produced by `selectWorkoutView`); these are the presentation-only inputs and
 * the command surface the view emits.
 */
import type { SetType, Split } from '@/core/types';

/** Commands the view can emit. The host wires these to state mutations. */
export interface WorkoutActions {
  viewExercise(exercise: string): void;
  logSet(exercise: string, type: SetType, weight: number, reps: number): void;
  deleteSet(date: string, setId: string): void;
  toggleExerciseDone(exercise: string): void;
  toggleSessionDone(): void;
  toggleDeload(exercise: string): void;
  editIncrement(exercise: string): void;
  startRest(exercise: string, type: SetType): void;
  undoLastSet(exercise: string): void;
  changeDate(date: string): void;
  changeSplit(split: Split | 'all'): void;
  logBodyweight(value: number): void;
  /** Toggle Sunday between a rest day (default) and a full-body day. */
  setSundayFullBody(on: boolean): void;
  /** Progress-chart controls (optional — present once charts are wired). */
  setChartPeriod?(period: string): void;
  setChartLift?(exercise: string): void;
  setChartScale?(scale: string): void;
  /** Expand/collapse the logging section below the charts. */
  toggleLog?(): void;
  /** Expand/collapse one exercise dropdown in the detail screen. */
  toggleExercise?(exercise: string): void;
}

/** Presentation-only inputs that are not part of persisted state. */
export interface WorkoutViewOptions {
  /** Rest prescription per set type, precomputed by the pure layer. */
  restSeconds: Record<string, { warm: number; top: number; back: number }>;
  /** Increment per exercise, precomputed by the pure layer. */
  increments: Record<string, number>;
  /** Form-technique links. */
  videoUrl(exercise: string): string;
  /** Current bodyweight and goal, already derived. */
  bodyweight: { current: number | null; goal: number | null; toGoal: number | null };
  /** Human-readable date label, e.g. "Today · Fri, Jul 25". */
  dateLabel(date: string): string;
  /** Which split is highlighted as suggested. */
  isToday: boolean;
}
