/**
 * TodosView component test — Due/All/Done segmented switch + FAB-revealed add.
 * Todos live nested in core, seeded via appState.set('core', …).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { TodosView } from '@/features/todos/TodosTab';
import { todosActions } from '@/ui/actions';
import { appState, dstr } from '@/app/bootstrap';
import { todoView, todoAdding } from '@/ui/store';

const emptyCore = () => ({ schedule: {}, entries: [], todos: [] as unknown[], scratch: [], _del: {} });
const seed = (todos: unknown[]) => appState.set('core', { ...emptyCore(), todos } as never);

beforeEach(() => {
  todoView.value = 'all';
  todoAdding.value = false;
  appState.set('core', emptyCore() as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  todoView.value = 'all';
  todoAdding.value = false;
  appState.set('core', emptyCore() as never);
});

describe('TodosView', () => {
  it('shows the empty state when there are no todos', () => {
    const { getByText } = render(<TodosView />);
    expect(getByText(/No todos yet/)).toBeTruthy();
  });

  it('reveals the add form via the FAB and wires Add to todosActions.add', () => {
    const spy = vi.spyOn(todosActions, 'add').mockImplementation(() => {});
    todoAdding.value = true;
    const { container, getByText } = render(<TodosView />);
    (container.querySelector('#todo-text') as HTMLInputElement).value = 'Call the vendor';
    fireEvent.click(getByText('Add'));
    expect(spy).toHaveBeenCalledWith('Call the vendor', '');
  });

  it('reactively renders a new todo in the list', async () => {
    const today = dstr();
    const { queryByText } = render(<TodosView />);
    expect(queryByText('Write worklog')).toBeNull();
    await act(async () => {
      todosActions.add('Write worklog', today);
    });
    expect(queryByText('Write worklog')).toBeTruthy();
  });

  it('wires the row checkbox and delete to toggle/remove', () => {
    const toggle = vi.spyOn(todosActions, 'toggle').mockImplementation(() => {});
    const remove = vi.spyOn(todosActions, 'remove').mockImplementation(() => {});
    seed([{ id: 't1', text: 'x', done: false, created: 1 }]);
    const { container, getByTitle } = render(<TodosView />);
    fireEvent.click(container.querySelector('.todo-chk')!);
    fireEvent.click(getByTitle('Remove'));
    expect(toggle).toHaveBeenCalledWith('t1');
    expect(remove).toHaveBeenCalledWith('t1');
  });
});
