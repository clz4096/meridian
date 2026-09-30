/**
 * Princeton/MIT curriculum track — a proof-and-pset-driven path a theory
 * student would actually follow (COS + MAT + MIT OCW), ordered by prerequisite.
 * Static content; the only mutable state is a per-course "done" checkbox in
 * `meridian.curriculum.v1` (namespaced localStorage). A weekly rotation surfaces
 * one problem set as the "problem set of the week".
 */
import { signal } from '@preact/signals';
import { localEpochDay } from '@/core/util';

export type { PSet, Course } from '@/content/courseTypes';
import type { Course, PSet } from '@/content/courseTypes';
import { MATH_COURSES } from '@/content/math';
import { CS_COURSES } from '@/content/cs';

/** The Massey curriculum order (unchanged from before the path split). */
const ORDER = [
  'Stanford Stats',
  'Yale CS202',
  'Harvard STAT 110',
  'MIT 6.042J',
  'MIT 18.01',
  'MIT 18.02',
  'MIT 18.06',
  'MIT 6.041SC',
  'COS 226',
  'MIT 6.006',
  'MIT 18.100A',
  'MIT 6.046J',
  'MIT 18.404J',
  'COS 522',
] as const;

/**
 * Place `courses` in `order`. A code in `order` with no course (deleted from its content
 * file but not from ORDER) is skipped, so CURRICULUM never holds undefined. Courses not
 * yet placed in `order` go last, in file order.
 */
export function orderCourses(order: readonly string[], courses: readonly Course[]): Course[] {
  const byCode = new Map<string, Course>(courses.map((c) => [c.code, c]));
  const placed = order.flatMap((code) => byCode.get(code) ?? []);
  return [...placed, ...courses.filter((c) => !order.includes(c.code))];
}

export const CURRICULUM: readonly Course[] = orderCourses(ORDER, [...MATH_COURSES, ...CS_COURSES]);

/** All (course, pset) pairs, in curriculum order. */
function allPSets(): Array<{ course: Course; pset: PSet }> {
  const out: Array<{ course: Course; pset: PSet }> = [];
  for (const c of [...CURRICULUM].sort((a, b) => a.targetWeek - b.targetWeek))
    for (const p of c.psets) out.push({ course: c, pset: p });
  return out;
}

/**
 * Rotate one problem set per week (stable within the week). The week is counted in
 * local calendar days, like paperOfWeek, so it turns over at local midnight rather
 * than at a UTC instant that lands mid-evening in the Americas.
 */
export function psetOfWeek(d: Date = new Date()): { course: Course; pset: PSet } | undefined {
  const list = allPSets();
  if (!list.length) return undefined;
  const week = Math.floor(localEpochDay(d) / 7);
  const n = list.length;
  return list[((week % n) + n) % n];
}

/* ── per-course completion ── */
export type CurriculumChecks = Record<string, boolean>;
const KEY = 'meridian.curriculum.v1';

function load(): CurriculumChecks {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as CurriculumChecks;
  } catch {
    /* ignore */
  }
  return {};
}

export const curriculumChecks = signal<CurriculumChecks>(load());

export function toggleCourse(code: string): void {
  const next = { ...curriculumChecks.value, [code]: !curriculumChecks.value[code] };
  curriculumChecks.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function curriculumSummary(): { done: number; total: number } {
  const c = curriculumChecks.value;
  return { done: CURRICULUM.filter((x) => c[x.code]).length, total: CURRICULUM.length };
}
