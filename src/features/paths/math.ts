/**
 * Math path: today's problem or proof, and the summary Today's Math card shows.
 *
 * This module pulls in studytracker/curriculum.ts (tracker chunk), so anything in the
 * main chunk must reach it through a dynamic `import()`.
 */
import type { PathSummary } from '@/features/paths/types';
import type { Course } from '@/content/courseTypes';
import { MATH_COURSES, MATH_DAILY, type MathDailyItem } from '@/content/math';
import { curriculumChecks } from '@/features/studytracker/curriculum';

/** Time for one attempt plus checking it. Proofs take longer to write out than numeric problems. */
export const MINUTES: Record<MathDailyItem['kind'], number> = { problem: 15, proof: 20 };

/** The course the owner is taking now (Stanford Stats), or undefined if none is flagged. */
export const FEATURED_CODE: string | undefined = MATH_COURSES.find((c) => c.featured)?.code;

/**
 * Days since 1970-01-01 in the LOCAL calendar. A UTC day count would flip
 * the item at 8 pm in New York; building a UTC timestamp from the local Y/M/D keeps the
 * item stable from local midnight to local midnight, DST included.
 */
export function localDayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * The featured course code while it is still in progress. Once it is marked done it
 * stops taking every other day, and the daily item rotates evenly through all items.
 * Null, not undefined, means "none": undefined would pick up todaysMathItem's default.
 */
export function activeFeaturedCode(
  checks: Record<string, boolean>,
  courses: readonly Course[] = MATH_COURSES,
): string | null {
  const featured = courses.find((c) => c.featured);
  return featured && !checks[featured.code] ? featured.code : null;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * Today's item. Rule: even local days draw from the featured course's items, odd days
 * from everything else, each list rotating in its own array order. So the featured
 * course appears at least every other day (the owner's current class gets half the
 * days) while the other courses still cycle. If either list is empty, the other one
 * covers every day. Deterministic: depends only on the local date and the item list.
 */
export function todaysMathItem(
  now: Date,
  items: readonly MathDailyItem[] = MATH_DAILY,
  featuredCode: string | null = FEATURED_CODE ?? null,
): MathDailyItem | undefined {
  if (!items.length) return undefined;
  const day = localDayNumber(now);
  const featured = items.filter((i) => i.courseCode === featuredCode);
  const rest = items.filter((i) => i.courseCode !== featuredCode);
  if (!featured.length || !rest.length) return items[mod(day, items.length)];
  const half = Math.floor(day / 2);
  return mod(day, 2) === 0 ? featured[mod(half, featured.length)] : rest[mod(half, rest.length)];
}

/** 'Proof: √2 is irrational' / 'Problem: 95% confidence interval'. */
export function itemLabel(item: MathDailyItem): string {
  return `${item.kind === 'proof' ? 'Proof' : 'Problem'}: ${item.title}`;
}

export function courseLabel(c: Course): string {
  return `${c.code} · ${c.name}`;
}

/** Pure: course completion comes in through `checks`; codes outside the Math plan are ignored. */
export function summarize(
  now: Date,
  checks: Record<string, boolean>,
  courses: readonly Course[] = MATH_COURSES,
  items: readonly MathDailyItem[] = MATH_DAILY,
): PathSummary {
  const total = courses.length;
  const done = courses.filter((c) => checks[c.code]).length;
  const current = courses.find((c) => !checks[c.code]);
  const featured = courses.find((c) => c.featured);
  const left = total - done;
  const caption =
    total === 0
      ? 'no courses planned'
      : left === 0
        ? 'all courses done'
        : featured && !checks[featured.code]
          ? `${featured.code} featured`
          : `${left} ${left === 1 ? 'course' : 'courses'} to go`;

  const item = todaysMathItem(now, items, activeFeaturedCode(checks, courses));
  const next: PathSummary['next'] = item
    ? { label: itemLabel(item), detail: item.source, minutes: MINUTES[item.kind] }
    : { label: total === 0 ? 'Add a course to the Math plan' : 'Review a finished course' };
  // Finished plan: keep the daily item as upkeep practice, but say so.
  if (item && total > 0 && left === 0) next.detail = `Plan complete; keep sharp. ${item.source}`;

  return {
    id: 'math',
    title: 'Math',
    course: current ? courseLabel(current) : '',
    next,
    progress: { done, total, caption },
  };
}

/** Live summary for Today's card. Reads the signal, so a caller inside render subscribes to it. */
export function currentSummary(now: Date = new Date()): PathSummary {
  return summarize(now, curriculumChecks.value);
}
