/**
 * Today, the home. Five blocks in contract order (docs/redesign-contract.md):
 * 1 date and weather, 2 today's reading, 3 today's studies (WGU, Math, Computer
 * Science), 4 your day (due todos and the two quick actions), 5 every other screen.
 *
 * Blocks 2 and 3 read modules that live in other chunks, so they load with import()
 * after the first paint, each behind a skeleton of its final size. index.html carries
 * a static copy of this layout so the first paint already has the frame (DECISIONS D15).
 */
import { useEffect } from 'preact/hooks';
import { dstr } from '@/app/bootstrap';
import { dataRev, clockMinute, notPending, type Tab } from '@/ui/store';
import type { HubKey, HubStat } from '@/ui/hubTypes';
import { core, hubStats, openSection, todosActions, tickClock } from '@/ui/actions';
import { dueTodos } from '@/features/todos/todosSelectors';
import type { PathId, PathSummary } from '@/features/paths/types';
import { PathCard, PathCardError, PathCardSkeleton } from '@/features/paths/PathCard';
import { WeatherBlock } from './WeatherBlock';
import { ReadingBlock } from './ReadingBlock';
import { lazyMod, page, readSaved, savedWhen, useSaveOnChange, type LazyMod } from './lazyContent';
import './today.css';

interface PathModule {
  currentSummary(now?: Date): PathSummary;
}

/** Each path's summary module, in card order. Never imported statically: see D13. */
export const PATH_MODS: ReadonlyArray<{ id: PathId; title: string; mod: LazyMod<PathModule> }> = [
  { id: 'wgu', title: 'WGU', mod: lazyMod<PathModule>(() => import('@/features/paths/wgu')) },
  { id: 'math', title: 'Math', mod: lazyMod<PathModule>(() => import('@/features/paths/math')) },
  { id: 'cs', title: 'Computer Science', mod: lazyMod<PathModule>(() => import('@/features/paths/cs')) },
];

/** Every screen other than the paths. `stat` is the hubStats() entry shown on the tile. */
const NAV: ReadonlyArray<{ tab: Tab; name: string; kind: string; stat?: HubKey; sub?: string }> = [
  { tab: 'meal', name: 'Surplus', kind: 'Food & Body', stat: 'meal' },
  { tab: 'workout', name: 'Overload', kind: 'Workout', stat: 'workout' },
  { tab: 'tracker', name: 'Massey Standard', kind: 'Princeton tracker', stat: 'tracker' },
  { tab: 'teach', name: 'Learn by Teaching', kind: 'Teach it, then defend it', sub: "Teach today's algorithm" },
  { tab: 'knowledge', name: 'Knowledge', kind: 'Spaced review', stat: 'knowledge' },
  { tab: 'data', name: 'Data', kind: 'Sync and storage', stat: 'data' },
];

export function TodayView() {
  dataRev.value; // subscribe: re-derive on store mutations

  useEffect(() => {
    tickClock();
    // Today shows the date and minute-level data only, so a slow tick is enough.
    const id = window.setInterval(tickClock, 15_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div class="td-root">
      <WeatherBlock />
      <ReadingBlock />
      <Studies />
      <YourDay />
      <Elsewhere />
    </div>
  );
}

/** What one path card can show: its live summary, or that the module failed or threw. */
interface SlotState {
  summary: PathSummary | null;
  failed: boolean;
}

function readSlot(mod: LazyMod<PathModule>, now: Date): SlotState {
  const m = mod.mod.value;
  if (!m) return { summary: null, failed: mod.failed.value };
  try {
    // Reads the path's own signals, so ticking a course re-renders this card.
    return { summary: m.currentSummary(now), failed: false };
  } catch {
    // The module loaded but its summary threw (bad content, corrupt checks): treat it
    // like a failed load so the saved copy or the error card shows.
    return { summary: null, failed: true };
  }
}

function PathSlot({ id, title, slot }: { id: PathId; title: string; slot: SlotState }) {
  const { summary, failed } = slot;
  useSaveOnChange(`path.${id}`, summary);
  const open = (): void => openSection(id);
  if (summary) return <PathCard summary={summary} onOpen={open} />;
  if (!failed) return <PathCardSkeleton title={title} />;
  const saved = readSaved<PathSummary>(`path.${id}`);
  return saved ? <PathCard summary={saved.value} onOpen={open} /> : <PathCardError title={title} onRetry={() => page.reload()} />;
}

function Studies() {
  const nowMs = clockMinute.value; // the summaries depend on the date
  useEffect(() => {
    for (const p of PATH_MODS) void p.mod.load();
  }, []);
  const now = new Date(nowMs);
  const slots = PATH_MODS.map((p) => readSlot(p.mod, now));
  // One quiet note for the section when any card is showing its saved copy, whether
  // its chunk failed to load or its summary threw.
  let savedAt = 0;
  PATH_MODS.forEach((p, i) => {
    if (slots[i]!.failed) savedAt = Math.max(savedAt, readSaved(`path.${p.id}`)?.at ?? 0);
  });
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <section class="td-block" aria-labelledby="td-studies-h">
      <div class="m-section">
        <h2 class="td-h2" id="td-studies-h">
          Today's studies
        </h2>
        {savedAt ? (
          <span class="m-state m-num" data-kind="offline">
            {offline ? 'Offline · ' : ''}Saved copy from {savedWhen(savedAt, nowMs)}
          </span>
        ) : (
          <span class="m-label">Next step on each path</span>
        )}
      </div>
      <div class="td-paths">
        {PATH_MODS.map((p, i) => (
          <PathSlot key={p.id} id={p.id} title={p.title} slot={slots[i]!} />
        ))}
      </div>
    </section>
  );
}

function YourDay() {
  const today = dstr();
  const due = dueTodos(core(), today).filter(notPending);
  return (
    <section class="td-block" aria-labelledby="td-day-h">
      <div class="m-section">
        <h2 class="td-h2" id="td-day-h">
          Your day
        </h2>
        <span class="m-label m-num">{due.length ? `${due.length} due` : 'Clear'}</span>
      </div>
      {due.length ? (
        <ul class="td-todos">
          {due.map((t) => (
            <li class="m-row td-todo" key={String(t.id)}>
              <button
                type="button"
                class="td-check"
                onClick={() => todosActions.toggle(String(t.id))}
                aria-label={`Mark done: ${t.text}`}
              />
              <span class="td-todo-text">{t.text}</span>
              <span class={`m-row-meta${t.due && t.due < today ? ' td-overdue' : ''}`}>
                {t.due && t.due < today ? 'Overdue' : 'Today'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="td-clear">Nothing due today.</p>
      )}
      <div class="td-actions">
        <button type="button" class="m-btn td-add" onClick={() => openSection('todos')}>
          Add a todo
        </button>
        <button type="button" class="m-btn td-idea" onClick={() => openSection('scratch')}>
          Capture an idea
        </button>
      </div>
    </section>
  );
}

function Elsewhere() {
  const stats = new Map<HubKey, HubStat>(hubStats().map((s) => [s.key, s]));
  return (
    <nav class="td-block" aria-labelledby="td-nav-h">
      <div class="m-section">
        <h2 class="td-h2" id="td-nav-h">
          Everything else
        </h2>
      </div>
      <ul class="td-tiles">
        {NAV.map((n) => {
          const s = n.stat ? stats.get(n.stat) : undefined;
          return (
            <li key={n.tab}>
              <button type="button" class="m-card td-tile" data-route={n.tab} onClick={() => openSection(n.tab)}>
                <span class="td-tile-name">{n.name}</span>
                <span class="td-tile-kind">{n.kind}</span>
                <span class="td-tile-value m-num">
                  {s ? (
                    <>
                      {s.value}
                      {s.unit && <span class="td-tile-unit">{s.unit}</span>}
                    </>
                  ) : (
                    <span class="td-tile-unit">Open</span>
                  )}
                </span>
                <span class="td-tile-sub m-num">{s?.sub ?? n.sub}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
