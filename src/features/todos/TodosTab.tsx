/**
 * Todos tab — a personal checklist with optional due dates. Todos live nested in
 * the core store; this component derives its buckets via organizeTodos and reads
 * dataRev itself so add/toggle/delete re-render (the leaf-subscription rule).
 */
import { organizeTodos } from '@/features/todos/todosSelectors';
import type { TodoItem } from '@/core/types';
import { SectionHead } from '@/ui/components/Charts';
import { dataRev, todoShowDone } from '@/ui/store';
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
  return (
    <div class={'todo-row' + (t.done ? ' done' : '')}>
      <button class="todo-chk" onClick={() => todosActions.toggle(String(t.id))} aria-label={t.done ? 'Mark not done' : 'Mark done'}>
        {t.done ? '✓' : ''}
      </button>
      <span class="todo-text">{t.text}</span>
      {dueChip(t.due, today)}
      <span class="todo-rm" onClick={() => todosActions.remove(String(t.id))} title="Remove">
        ×
      </span>
    </div>
  );
}

function Group({ label, items, today }: { label: string; items: TodoItem[]; today: string }) {
  if (!items.length) return null;
  return (
    <>
      <div class="todo-grp">{label}</div>
      {items.map((t) => (
        <Row t={t} today={today} />
      ))}
    </>
  );
}

export function TodosView() {
  dataRev.value; // subscribe: re-derive on add/toggle/delete
  const today = dstr();
  const o = organizeTodos(core(), today);
  const showDone = todoShowDone.value;
  const openTotal = o.overdue.length + o.today.length + o.upcoming.length + o.noDate.length;

  return (
    <>
      <SectionHead name="Todos" />

      <div class="addcard">
        <div class="addrow">
          <input id="todo-text" class="minp name" placeholder="Something to do…" />
          <input id="todo-due" class="minp num" type="date" aria-label="Due date (optional)" />
          <button class="madd" onClick={() => todosActions.add(rv('todo-text'), rv('todo-due'))}>
            Add
          </button>
        </div>
      </div>

      {openTotal === 0 ? (
        <div class="empty">Nothing to do. Add a reminder above.</div>
      ) : (
        <>
          <Group label="Overdue" items={o.overdue} today={today} />
          <Group label="Today" items={o.today} today={today} />
          <Group label="Upcoming" items={o.upcoming} today={today} />
          <Group label="No date" items={o.noDate} today={today} />
        </>
      )}

      {o.done.length > 0 && (
        <>
          <button class="todo-donetoggle" onClick={() => (todoShowDone.value = !showDone)}>
            {showDone ? '▾' : '▸'} Completed · {o.done.length}
          </button>
          {showDone && o.done.map((t) => <Row t={t} today={today} />)}
        </>
      )}
    </>
  );
}
