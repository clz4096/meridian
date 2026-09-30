/**
 * WGU path summary for Today's path card and the roadmap's Today header.
 * Contract: docs/redesign-contract.md (Path model, WGU). Reads only the roadmap
 * content and its checklist store, so it stays out of the tracker chunk.
 */
import { WEEKS, PROGRESS, TOTAL_COURSES, TERM_END, type Course } from '@/features/wgu/roadmapData';
import { roadmapChecks } from '@/features/wgu/roadmapStore';
import type { PathSummary } from '@/features/paths/types';

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A card line longer than this gets split so the next action stays scannable. */
const LABEL_MAX = 90;

/** Local YYYY-MM-DD, the same device-local calendar day dstr() in bootstrap.ts uses. */
function localKey(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). UTC math so DST shifts can't eat an hour. */
function daysBetween(from: string, to: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

function shortDate(key: string): string {
  const [, m, d] = key.split('-').map(Number);
  return MO[m! - 1] + ' ' + d;
}

/** Split long doText at its first clause so the card shows one action and the rest goes to detail. */
function splitAction(text: string): { label: string; detail?: string } {
  if (text.length <= LABEL_MAX) return { label: text };
  const semi = text.indexOf('; ');
  if (semi > 0 && semi <= LABEL_MAX) {
    const rest = text.slice(semi + 2);
    return { label: text.slice(0, semi), detail: rest.charAt(0).toUpperCase() + rest.slice(1) };
  }
  // No usable clause break: cut at the last word boundary that fits.
  const space = text.lastIndexOf(' ', LABEL_MAX - 1);
  const cut = space > 0 ? space : LABEL_MAX - 1;
  return { label: text.slice(0, cut) + '…', detail: text.slice(cut).trim() };
}

function daysCaption(today: string): string {
  const left = daysBetween(today, TERM_END);
  const target = shortDate(TERM_END);
  if (left < 0) return 'past target (' + target + ')';
  if (left === 0) return 'target is today, ' + target;
  return left + (left === 1 ? ' day' : ' days') + ' to ' + target;
}

/**
 * Pure WGU summary at `now` given the course checklist. The current course is the first
 * not-done course in the week containing today; failing that (week all done, before the
 * plan, between or after its weeks) the first not-done course in plan order.
 */
export function summarize(now: Date, checks: Record<string, boolean>): PathSummary {
  const today = localKey(now);
  // Count only real course codes so a stray stored key can't push the bar past total.
  const done = PROGRESS.filter(([code]) => checks[code]).length;
  const notDone = (c: Course) => !checks[c.code];

  const week = WEEKS.find((w) => w.start <= today && today <= w.end);
  const course =
    week?.courses.find(notDone) ?? WEEKS.flatMap((w) => w.courses).find(notDone);

  if (!course) {
    return {
      id: 'wgu',
      title: 'WGU',
      course: '',
      next: { label: 'Term complete', detail: 'All ' + TOTAL_COURSES + ' courses are done.' },
      progress: { done, total: TOTAL_COURSES, caption: 'all courses done' },
    };
  }

  return {
    id: 'wgu',
    title: 'WGU',
    course: course.code + ' · ' + course.name,
    next: splitAction(course.doText),
    progress: { done, total: TOTAL_COURSES, caption: daysCaption(today) },
  };
}

/** Today's entry point: the live checklist at `now`. */
export function currentSummary(now: Date = new Date()): PathSummary {
  return summarize(now, roadmapChecks.value);
}
