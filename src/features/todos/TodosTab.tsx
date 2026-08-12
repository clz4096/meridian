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
import { dataRev, todoView, todoAdding, editingTodo } from '@/ui/store';
import { core, todosActions } from '@/ui/actions';
import { dstr } from '@/app/bootstrap';
import { host } from '@/ui/host';

const rv = (id: string): string => host.readValue(id);

function dueChip(due: string | undefined, today: string) {
  if (!due) return null;
  if (due < today) return <span class="todo-due overdue">overdue</span>;
  if (due === today) return <span class="todo-due today">today</span>;
  const [y, m, d] = due.split('-').map(Number);
  const label = new Date(y!, (m ?? 1) - 1, d!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return <span class="todo-due">{label}</span>;
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
        <input key={'ed-' + id} id="edit-todo-due" class="minp num" type="date" defaultValue={t.due || ''} aria-label="Due date (optional)" />
        <button class="madd" onClick={save}>Save</button>
        <span class="todo-rm" onClick={() => (editingTodo.value = null)} title="Cancel edit">×</span>
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
      <span class="todo-edit" onClick={() => (editingTodo.value = id)} title="Edit">✎</span>
      <span class="todo-rm" onClick={() => todosActions.remove(id)} title="Remove">
        ×
      </span>
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
  const tone = dueCount ? 'dirty' : 'teal';
  const emptyMsg =
    view === 'due' ? 'Nothing due — you’re clear.' : view === 'done' ? 'Nothing completed yet.' : 'No todos yet. Tap ＋ to add one.';

  return (
    <>

      <div class="sechero">
        <div class="sechero-wash" data-tone={tone} />
        <div class="sechero-in">
          <div class="sechero-eyb">Todos</div>
          <div class="sechero-row">
            <div class={'sechero-v tone-' + tone}>
              {openTotal}
              <span class="sechero-u">open</span>
            </div>
            <div class="sechero-sub">{dueCount ? `${dueCount} due today` : openTotal ? 'nothing due' : 'all clear'}</div>
          </div>
        </div>
      </div>

      <div class="segw">
        <button class={view === 'due' ? 'on' : ''} onClick={() => (todoView.value = 'due')}>
          Due{dueCount ? ` · ${dueCount}` : ''}
        </button>
        <button class={view === 'all' ? 'on' : ''} onClick={() => (todoView.value = 'all')}>
          All{openTotal ? ` · ${openTotal}` : ''}
        </button>
        <button class={view === 'done' ? 'on' : ''} onClick={() => (todoView.value = 'done')}>
          Done{o.done.length ? ` · ${o.done.length}` : ''}
        </button>
      </div>

      {adding && (
        <div class="addcard">
          <div class="addrow">
            <input id="todo-text" class="minp name" placeholder="Something to do…" />
            <input id="todo-due" class="minp num" type="date" aria-label="Due date (optional)" />
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
        {list.length ? list.map((t) => <Row t={t} today={today} />) : <div class="empty">{emptyMsg}</div>}
      </div>

      <button class={'fab' + (adding ? ' on' : '')} onClick={() => (todoAdding.value = !adding)} aria-label={adding ? 'Close' : 'Add a todo'}>
        {adding ? '×' : '＋'}
      </button>
    </>
  );
}
