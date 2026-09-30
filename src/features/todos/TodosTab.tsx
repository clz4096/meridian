/**
 * Todos tab — a personal checklist with optional due dates. Todos live nested in
 * the core store; derives buckets via organizeTodos and reads dataRev so
 * add/toggle/delete re-render (the leaf-subscription rule).
 *
 * Layout: a Due / All / Done segmented switch (full-width) over one flat list,
 * with add tucked behind a floating + (FAB).
 */
import { organizeTodos } from '@/features/todos/todosSelectors';
import type { TodoItem } from '@/core/types';
import { dataRev, todoView, todoAdding, editingTodo, notPending } from '@/ui/store';
import { core, todosActions } from '@/ui/actions';
import { dstr } from '@/app/bootstrap';
import { host } from '@/ui/host';
import { PageHead } from '@/ui/components/PageHead';
import { IconPencil, IconPlus } from '@/ui/components/Icons';

const rv = (id: string): string => host.readValue(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dueChip(due: string | undefined, today: string) {
  if (!due) return null;
  if (due < today) return <span class="todo-due overdue">overdue</span>;
  if (due === today) return <span class="todo-due today">today</span>;
  // "Sep 29", as toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) prints
  // it. Hand rolled like groupThousands: that call built a new date formatter per row,
  // about 65 ms for 60 todos at 4x CPU when Todos opened.
  const [, m, d] = due.split('-').map(Number);
  return <span class="todo-due">{`${MONTHS[(m ?? 1) - 1]} ${d}`}</span>;
}

function Row({ t, today }: { t: TodoItem; today: string }) {
  const id = String(t.id);
  const editing = editingTodo.value === id;

  if (editing) {
    const save = () => {
      todosActions.editText(id, rv('edit-todo-text'));
      todosActions.setDue(id, rv('edit-todo-due'));
      editingTodo.value = null;
    };
    return (
      <div class="todo-row editing">
        {/* key on the id so switching rows remounts the inputs with the new defaults */}
        <input
          key={'et-' + id}
          id="edit-todo-text"
          class="minp name"
          defaultValue={t.text}
          aria-label="Edit todo"
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') editingTodo.value = null; }}
        />
        <input key={'ed-' + id} id="edit-todo-due" class="minp date" type="date" defaultValue={t.due || ''} aria-label="Due date (optional)" />
        <button class="madd" onClick={save}>Save</button>
        <button type="button" class="todo-rm" onClick={() => (editingTodo.value = null)} title="Cancel edit" aria-label="Cancel edit">×</button>
      </div>
    );
  }

  return (
    <div class={'todo-row' + (t.done ? ' done' : '')}>
      <button class="todo-chk" onClick={() => todosActions.toggle(id)} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
        {t.done ? '✓' : ''}
      </button>
      <span class="todo-text" onClick={() => (editingTodo.value = id)} title="Tap to edit">{t.text}</span>
      {dueChip(t.due, today)}
      <button type="button" class="todo-edit" onClick={() => (editingTodo.value = id)} title="Edit" aria-label={`Edit ${t.text}`}><IconPencil /></button>
      <button type="button" class="todo-rm" onClick={() => todosActions.remove(id)} title="Remove" aria-label={`Remove ${t.text}`}>
        ×
      </button>
    </div>
  );
}

export function TodosView() {
  dataRev.value; // subscribe: re-derive on add/toggle/delete
  const today = dstr();
  const o = organizeTodos(core(), today);
  const view = todoView.value;
  const adding = todoAdding.value;

  const dueList = [...o.overdue, ...o.today];
  const openList = [...o.overdue, ...o.today, ...o.upcoming, ...o.noDate];
  const list = view === 'due' ? dueList : view === 'done' ? o.done : openList;
  const dueCount = dueList.length;
  const openTotal = openList.length;
  const emptyMsg =
    view === 'due' ? 'Nothing due — you’re clear.' : view === 'done' ? 'Nothing completed yet.' : 'No todos yet. Tap + to add one.';

  return (
    <>

      <PageHead
        title="Todos"
        note={`${openTotal} open · ${dueCount ? `${dueCount} due today` : openTotal ? 'nothing due' : 'all clear'}`}
      />

      <div class="segw">
        <button class={view === 'due' ? 'on' : ''} aria-pressed={view === 'due'} onClick={() => (todoView.value = 'due')}>
          Due{dueCount ? ` · ${dueCount}` : ''}
        </button>
        <button class={view === 'all' ? 'on' : ''} aria-pressed={view === 'all'} onClick={() => (todoView.value = 'all')}>
          All{openTotal ? ` · ${openTotal}` : ''}
        </button>
        <button class={view === 'done' ? 'on' : ''} aria-pressed={view === 'done'} onClick={() => (todoView.value = 'done')}>
          Done{o.done.length ? ` · ${o.done.length}` : ''}
        </button>
      </div>

      {adding && (
        <div class="addcard">
          <div class="addrow">
            <input
              id="todo-text"
              class="minp name"
              placeholder="Something to do…"
              aria-label="New todo"
              enterKeyHint="done"
              onKeyDown={(e) => {
                // keyCode 229: iOS commits an IME candidate with Enter while isComposing is false.
                if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !rv('todo-text').trim()) return;
                todosActions.add(rv('todo-text'), rv('todo-due'));
                todoView.value = 'all';
              }}
            />
            <input id="todo-due" class="minp date" type="date" aria-label="Due date (optional)" />
            <button
              class="madd"
              onClick={() => {
                todosActions.add(rv('todo-text'), rv('todo-due'));
                todoView.value = 'all';
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div class="todo-list">
        {list.filter(notPending).length ? list.filter(notPending).map((t) => <Row t={t} today={today} />) : <div class="empty">{emptyMsg}</div>}
      </div>

      <button class={'fab' + (adding ? ' on' : '')} onClick={() => (todoAdding.value = !adding)} aria-label={adding ? 'Close' : 'Add a todo'}>
        {adding ? '×' : <IconPlus size="24px" />}
      </button>
    </>
  );
}
