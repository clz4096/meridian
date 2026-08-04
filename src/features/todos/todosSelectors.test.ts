import { describe, it, expect } from 'vitest';
import { organizeTodos, dueTodos, openCount } from '@/features/todos/todosSelectors';

// Loosely-typed fixtures (ids are branded EntityIds in the real store).
const core = (todos: unknown[]): never => ({ todos }) as never;
const TODAY = '2026-08-04';

const FIXTURE = core([
  { id: 'a', text: 'a', done: false, created: 1, due: '2026-08-01' }, // overdue
  { id: 'b', text: 'b', done: false, created: 2, due: '2026-08-04' }, // today
  { id: 'c', text: 'c', done: false, created: 3, due: '2026-08-10' }, // upcoming
  { id: 'd', text: 'd', done: false, created: 4 }, // no date
  { id: 'e', text: 'e', done: true, created: 5, due: '2026-08-01' }, // done (excluded from open buckets)
]);

describe('organizeTodos', () => {
  it('buckets open todos by due date relative to today', () => {
    const o = organizeTodos(FIXTURE, TODAY);
    expect(o.overdue.map((t) => t.id)).toEqual(['a']);
    expect(o.today.map((t) => t.id)).toEqual(['b']);
    expect(o.upcoming.map((t) => t.id)).toEqual(['c']);
    expect(o.noDate.map((t) => t.id)).toEqual(['d']);
    expect(o.done.map((t) => t.id)).toEqual(['e']);
  });

  it('dueTodos = overdue + due-today, overdue first', () => {
    expect(dueTodos(FIXTURE, TODAY).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('openCount excludes done', () => {
    expect(openCount(FIXTURE)).toBe(4);
  });

  it('tolerates a missing todos field', () => {
    expect(organizeTodos({} as never, TODAY).overdue).toEqual([]);
    expect(openCount({} as never)).toBe(0);
  });
});
