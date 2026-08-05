/**
 * Todos tab — a personal checklist with optional due dates. Todos live nested in
 * the core store; derives buckets via organizeTodos and reads dataRev so
 * add/toggle/delete re-render (the leaf-subscription rule).
 *
 * TEMPORARY: two candidate layouts, switched by a `?todos=b|c` URL flag so both
 * can be compared live (default C). Once one is chosen, the other + this flag go.
 *   B — Due/All/Done segmented switch + FAB-revealed add.
 *   C — content-first: a slim always-there add bar + one scroll with a "later" divider.
 */
import { organizeTodos } from '@/features/todos/todosSelectors';
import type { TodoItem } from '@/core/types';
import { dataRev, todoShowDone, todoView, todoAdding } from '@/ui/store';
import { core, todosActions, goHome } from '@/ui/actions';
import { dstr } from '@/app/bootstrap';
import { host } from '@/ui/host';

const rv = (id: string): string => host.readValue(id);
const LAYOUT: 'b' | 'c' =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('todos') === 'b' ? 'b' : 'c';

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

function Hero({ openTotal, dueCount, tone }: { openTotal: number; dueCount: number; tone: string }) {
  return (
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
  );
}

/* ── B: segmented views + FAB-revealed add ── */
function TodosB() {
  dataRev.value;
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
      <button class="backbtn" onClick={goHome}>
        ‹ Back
      </button>
      <Hero openTotal={openTotal} dueCount={dueCount} tone={tone} />

      <div class="seg">
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

/* ── C: content-first — slim always-there add + one scroll with a "later" divider ── */
function TodosC() {
  dataRev.value;
  const today = dstr();
  const o = organizeTodos(core(), today);
  const showDone = todoShowDone.value;
  const dueList = [...o.overdue, ...o.today];
  const laterList = [...o.upcoming, ...o.noDate];
  const openTotal = dueList.length + laterList.length;
  const dueCount = dueList.length;
  const tone = dueCount ? 'dirty' : 'teal';

  return (
    <>
      <button class="backbtn" onClick={goHome}>
        ‹ Back
      </button>
      <Hero openTotal={openTotal} dueCount={dueCount} tone={tone} />

      <div class="addslim">
        <input id="todo-text" class="addslim-in" placeholder="Add a todo…" />
        <input id="todo-due" class="addslim-date" type="date" aria-label="Due date (optional)" />
        <button class="addslim-btn" onClick={() => todosActions.add(rv('todo-text'), rv('todo-due'))} aria-label="Add">
          ＋
        </button>
      </div>

      {openTotal === 0 ? (
        <div class="empty">Nothing to do yet.</div>
      ) : (
        <div class="todo-list">
          {dueList.map((t) => (
            <Row t={t} today={today} />
          ))}
          {dueList.length > 0 && laterList.length > 0 && <div class="todo-div">later</div>}
          {laterList.map((t) => (
            <Row t={t} today={today} />
          ))}
        </div>
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

export function TodosView() {
  return LAYOUT === 'b' ? <TodosB /> : <TodosC />;
}
