/**
 * Computer Science path: the summary Today's CS card shows. The course line and
 * progress follow the Computer Science Tripos track (DECISIONS C11); the next
 * action stays the algorithm of the day. The retired COS/MIT course plan is in
 * data/archive/princeton-curriculum.json.
 *
 * This module pulls in studytracker/algorithms.ts (~88 KB), so it must only
 * ever be reached through a dynamic `import()` from anything in the main chunk.
 * It reads the small Cambridge catalog index, not the full catalog.
 */
import type { PathSummary } from '@/features/paths/types';
import { algoOfDay } from '@/features/studytracker/algorithms';
import { trackerState, todayISO } from '@/features/studytracker/trackerStore';
import { catalogIndex, currentFor, itemDone, liveItem, pathPhases, phaseState, type IndexPhase } from '@/features/cambridge/catalogIndex';
import { readCambridge } from '@/features/cambridge/store';
import type { CambridgeState } from '@/features/cambridge/types';
import { dataRev } from '@/ui/store';

/** Rough time for one algorithm-of-the-day session: read, trace, one practice problem. */
export const ALGO_MINUTES = 20;

export interface CSState {
  /** The Cambridge store: the CST track's progress lives there. */
  cam: CambridgeState;
  /** Today's algorithm (algoOfDay(now)). */
  algo: { name: string; oneLiner: string };
  /** Whether today's 'algo:studied' event is credited. */
  studiedToday?: boolean;
}

/** Where the CST track stands: the phase in progress, its current item, and items done in it. */
export function cstProgress(cam: CambridgeState, now: number): { phase?: IndexPhase; itemTitle?: string; done: number; total: number } {
  const cur = currentFor(cam, 'cst', now);
  const phases = pathPhases('cst');
  const phase = (cur ? catalogIndex().phases.get(cur.phase) : undefined) ?? phases.find((p) => phaseState(cam, p) === 'current');
  const total = phase?.items.length ?? 0;
  const done = phase ? phase.items.filter((id) => itemDone(liveItem(cam, id))).length : 0;
  return { phase, itemTitle: cur?.title, done, total };
}

/** Pure: everything it needs comes in through `state`. */
export function summarize(now: Date, state: CSState): PathSummary {
  const { phase, itemTitle, done, total } = cstProgress(state.cam, now.getTime());
  const left = total - done;
  const caption = state.studiedToday
    ? 'algorithm studied today'
    : !phase
      ? 'every CST phase done'
      : `${left} ${left === 1 ? 'item' : 'items'} left in ${phase.name}`;
  return {
    id: 'cs',
    title: 'Computer Science',
    course: phase && itemTitle ? `${phase.name} · ${itemTitle}` : '',
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
  dataRev.value; // re-derive on Cambridge writes and sync pulls
  const a = algoOfDay(now);
  return summarize(now, {
    cam: readCambridge(),
    algo: { name: a.name, oneLiner: a.oneLiner },
    studiedToday: studiedOn(now),
  });
}
