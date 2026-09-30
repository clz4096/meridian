/**
 * Computer Science path: the summary Today's CS card shows.
 *
 * This module pulls in studytracker/algorithms.ts (~88 KB), so it must only ever be
 * reached through a dynamic `import()` from anything in the main chunk.
 */
import type { PathSummary } from '@/features/paths/types';
import type { Course } from '@/content/courseTypes';
import { CS_COURSES, CS_CURRENT } from '@/content/cs';
import { curriculumChecks } from '@/features/studytracker/curriculum';
import { algoOfDay } from '@/features/studytracker/algorithms';
import { trackerState, todayISO } from '@/features/studytracker/trackerStore';

/** Rough time for one algorithm-of-the-day session: read, trace, one practice problem. */
export const ALGO_MINUTES = 20;

export interface CSState {
  /** Course completion by code (curriculumChecks). */
  checks: Record<string, boolean>;
  /** Today's algorithm (algoOfDay(now)). */
  algo: { name: string; oneLiner: string };
  /** Whether today's 'algo:studied' event is credited. */
  studiedToday?: boolean;
  /** Plan override; defaults to CS_COURSES. Tests pass their own. */
  courses?: readonly Course[];
  /** Current-course pointer; defaults to CS_CURRENT. */
  current?: string | null;
}

export function courseLabel(c: Course): string {
  return `${c.code} · ${c.name}`;
}

/** The current course: the pointer if set and not done, else the first not-done course in plan order. */
export function currentCourse(
  courses: readonly Course[],
  checks: Record<string, boolean>,
  pointer: string | null = CS_CURRENT,
): Course | undefined {
  if (pointer) {
    const p = courses.find((c) => c.code === pointer);
    if (p && !checks[p.code]) return p;
  }
  return courses.find((c) => !checks[c.code]);
}

/** Pure: everything it needs comes in through `state`; `now` is kept for the shared path signature. */
export function summarize(_now: Date, state: CSState): PathSummary {
  const courses = state.courses ?? CS_COURSES;
  const cur = currentCourse(courses, state.checks, state.current === undefined ? CS_CURRENT : state.current);
  const total = courses.length;
  const done = courses.filter((c) => state.checks[c.code]).length;
  const left = total - done;
  const caption = state.studiedToday
    ? 'algorithm studied today'
    : left === 0
      ? 'all courses done'
      : `${left} ${left === 1 ? 'course' : 'courses'} to go`;
  return {
    id: 'cs',
    title: 'Computer Science',
    course: cur ? courseLabel(cur) : '',
    next: { label: `Algorithm of the day: ${state.algo.name}`, detail: state.algo.oneLiner, minutes: ALGO_MINUTES },
    progress: { done, total, caption },
  };
}

/** Whether the tracker credited 'algo:studied' on `now`'s date (a stale, un-rolled day does not count). */
export function studiedOn(now: Date): boolean {
  const day = trackerState.value.day;
  return day.date === todayISO(now) && (day.events?.['algo:studied'] ?? 0) > 0;
}

/** Live summary for Today's card. Reads the signals, so a caller inside render subscribes to them. */
export function currentSummary(now: Date = new Date()): PathSummary {
  const a = algoOfDay(now);
  return summarize(now, {
    checks: curriculumChecks.value,
    algo: { name: a.name, oneLiner: a.oneLiner },
    studiedToday: studiedOn(now),
  });
}
