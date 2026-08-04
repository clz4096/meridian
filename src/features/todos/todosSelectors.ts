/**
 * Todos read-model. Todos live nested in the core store; these pure helpers
 * bucket them by due date (relative to a local "YYYY-MM-DD" today) and expose
 * the counts the Today screen + hub need. No DOM, no signals — unit-tested.
 */
import type { CoreState, TodoItem } from '@/core/types';

export interface OrganizedTodos {
  overdue: TodoItem[];
  today: TodoItem[];
  upcoming: TodoItem[];
  noDate: TodoItem[];
  done: TodoItem[];
}

type CoreTodos = Pick<CoreState, 'todos'>;

const byDueThenCreated = (a: TodoItem, b: TodoItem): number =>
  (a.due ?? '').localeCompare(b.due ?? '') || a.created - b.created;

/** Split todos into due-buckets + done, each sorted. `todayStr` is local YYYY-MM-DD. */
export function organizeTodos(core: CoreTodos, todayStr: string): OrganizedTodos {
  const all = core.todos ?? [];
  const open = all.filter((t) => !t.done);
  return {
    overdue: open.filter((t) => t.due && t.due < todayStr).sort(byDueThenCreated),
    today: open.filter((t) => t.due === todayStr).sort(byDueThenCreated),
    upcoming: open.filter((t) => t.due && t.due > todayStr).sort(byDueThenCreated),
    noDate: open.filter((t) => !t.due).sort((a, b) => b.created - a.created),
    done: all.filter((t) => t.done).sort((a, b) => b.created - a.created),
  };
}

/** What needs attention today = overdue + due-today. Used by the Today screen. */
export function dueTodos(core: CoreTodos, todayStr: string): TodoItem[] {
  const o = organizeTodos(core, todayStr);
  return [...o.overdue, ...o.today];
}

/** Count of not-done todos. */
export function openCount(core: CoreTodos): number {
  return (core.todos ?? []).filter((t) => !t.done).length;
}
