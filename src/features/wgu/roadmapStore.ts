/**
 * WGU Roadmap — ORDINARY-tier checklist state. A map of course code → done,
 * persisted to the namespaced key `meridian.roadmap.v1`. Not routed through the
 * CRDT/sync kernel (out of scope per the build spec).
 */
import { signal } from '@preact/signals';
import { TOTAL_COURSES } from '@/features/wgu/roadmapData';

const KEY = 'meridian.roadmap.v1';

function load(): Record<string, boolean> {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    if (s && typeof s === 'object' && !Array.isArray(s)) return s as Record<string, boolean>;
  } catch {
    /* ignore */
  }
  return {};
}

export const roadmapChecks = signal<Record<string, boolean>>(load());

export function toggleCourse(code: string): void {
  const next = { ...roadmapChecks.value, [code]: !roadmapChecks.value[code] };
  roadmapChecks.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function isDone(code: string): boolean {
  return !!roadmapChecks.value[code];
}

/** Glanceable summary for Today's at-a-glance tile. */
export function roadmapSummary(): { done: number; total: number } {
  const checks = roadmapChecks.value;
  const done = Object.keys(checks).filter((k) => checks[k]).length;
  return { done, total: TOTAL_COURSES };
}
