/**
 * TodayView: the five blocks in contract order, the due todos, the navigation tiles,
 * and every state of the path cards (loading, content, empty, error, offline).
 * Weather has its own test (WeatherBlock.test.tsx); here fetch is stubbed to hang so
 * it stays in its skeleton and nothing touches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { TodayView, PATH_MODS } from '@/features/today/TodayTab';
import { papersMod } from '@/features/today/ReadingBlock';
import { clockTime, page, writeSaved } from '@/features/today/lazyContent';
import * as actions from '@/ui/actions';
import { appState, dstr } from '@/app/bootstrap';
import { weather, currentTab } from '@/ui/store';
import type { PathSummary } from '@/features/paths/types';

const emptyCore = () => ({ schedule: {}, entries: [], todos: [], scratch: [], _del: {} });

const WGU: PathSummary = {
  id: 'wgu',
  title: 'WGU',
  course: 'C955 · Applied Probability & Statistics',
  next: { label: 'Finish practice test 2', minutes: 45 },
  progress: { done: 1, total: 4, caption: '25 days to Oct 25' },
};
const stub = (s: PathSummary) => ({ currentSummary: () => s });

/** Freeze every lazy block in its loading state; each test sets what it needs. */
function holdLazy(): void {
  for (const p of PATH_MODS) {
    vi.spyOn(p.mod, 'load').mockResolvedValue();
    p.mod.mod.value = null;
    p.mod.failed.value = false;
  }
  vi.spyOn(papersMod, 'load').mockResolvedValue();
  papersMod.mod.value = null;
  papersMod.failed.value = false;
}

beforeEach(() => {
  appState.set('core', emptyCore() as never);
  weather.value = null;
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  weather.value = null;
  currentTab.value = 'today';
  appState.set('core', emptyCore() as never);
  for (const p of PATH_MODS) {
    p.mod.mod.value = null;
    p.mod.failed.value = false;
  }
});

describe('TodayView layout', () => {
  it('renders the five blocks in contract order', () => {
    holdLazy();
    const { container } = render(<TodayView />);
    const heads = [...container.querySelectorAll('h1, h2')].map((h) => h.textContent);
    expect(heads[0]).toMatch(/^[A-Z][a-z]+day · \d{1,2} [A-Z][a-z]+$/);
    expect(heads.slice(1)).toEqual(["Today's reading", "Today's studies", 'Your day', 'Everything else']);
  });

  it('surfaces overdue + due-today todos (not future ones) and wires the checkbox', () => {
    holdLazy();
    const today = dstr();
    appState.set('core', {
      ...emptyCore(),
      todos: [
        { id: 'a', text: 'Overdue thing', done: false, created: 1, due: '2000-01-01' },
        { id: 'b', text: 'Due today thing', done: false, created: 2, due: today },
        { id: 'c', text: 'Future thing', done: false, created: 3, due: '2999-01-01' },
      ],
    } as never);
    const toggle = vi.spyOn(actions.todosActions, 'toggle').mockImplementation(() => {});
    const { getByText, queryByText, getByLabelText } = render(<TodayView />);
    expect(getByText('Overdue thing')).toBeTruthy();
    expect(getByText('Due today thing')).toBeTruthy();
    expect(queryByText('Future thing')).toBeNull();
    expect(getByText('2 due')).toBeTruthy();
    fireEvent.click(getByLabelText('Mark done: Overdue thing'));
    expect(toggle).toHaveBeenCalledWith('a');
  });

  it('keeps the two quick actions', () => {
    holdLazy();
    const spy = vi.spyOn(actions, 'openSection').mockImplementation(() => {});
    const { getByText } = render(<TodayView />);
    expect(getByText('Nothing due today.')).toBeTruthy();
    fireEvent.click(getByText('Add a todo'));
    fireEvent.click(getByText('Capture an idea'));
    expect(spy.mock.calls).toEqual([['todos'], ['scratch']]);
  });

  it('has a tile for every other screen, each opening its tab', () => {
    holdLazy();
    const spy = vi.spyOn(actions, 'openSection').mockImplementation(() => {});
    const { container } = render(<TodayView />);
    const tiles = [...container.querySelectorAll<HTMLButtonElement>('.td-tile')];
    expect(tiles.map((t) => t.dataset.route)).toEqual(['meal', 'workout', 'tracker', 'knowledge', 'data']);
    expect(tiles[0]!.textContent).toContain('Surplus');
    expect(tiles[0]!.textContent).toContain('kcal'); // its hubStats value
    // The tracker is The Cambridge Method now; no Massey or Princeton label on its tile.
    expect(tiles[2]!.textContent).toContain('The Cambridge Method');
    expect(tiles[2]!.textContent).not.toMatch(/Massey|Princeton/);
    tiles.forEach((t) => fireEvent.click(t));
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['meal', 'workout', 'tracker', 'knowledge', 'data']);
  });
});

describe('Today path cards', () => {
  it('loading: a same-size skeleton per path', () => {
    holdLazy();
    const { getByLabelText } = render(<TodayView />);
    for (const t of ['WGU', 'Math', 'Computer Science']) {
      expect(getByLabelText(`Loading ${t} path`).classList.contains('pc')).toBe(true);
    }
  });

  it('content: pins the user-facing numbers and opens the path', () => {
    holdLazy();
    PATH_MODS[0]!.mod.mod.value = stub(WGU);
    const spy = vi.spyOn(actions, 'openSection').mockImplementation(() => {});
    const { container, getByText } = render(<TodayView />);
    const card = container.querySelector<HTMLElement>('.pc[data-route="wgu"]')!;
    expect(card.textContent).toContain('1 of 4');
    expect(card.textContent).toContain('C955 · Applied Probability & Statistics');
    expect(card.textContent).toContain('Finish practice test 2');
    expect(card.textContent).toContain('~45 min');
    expect(getByText('25% · 25 days to Oct 25')).toBeTruthy();
    const bar = card.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuetext')).toBe('1 of 4 courses');
    expect((bar.firstElementChild as HTMLElement).style.getPropertyValue('--m-progress')).toBe('25%');
    fireEvent.click(card);
    expect(spy).toHaveBeenCalledWith('wgu');
  });

  it('empty: a finished path says so', () => {
    holdLazy();
    PATH_MODS[1]!.mod.mod.value = stub({
      ...WGU,
      id: 'math',
      title: 'Math',
      course: '',
      next: { label: 'Pick the next course' },
      progress: { done: 13, total: 13, caption: '' },
    });
    const { container } = render(<TodayView />);
    const card = container.querySelector('.pc[data-route="math"]')!;
    expect(card.textContent).toContain('All 13 courses done');
    expect(card.textContent).toContain('Pick the next course');
  });

  it('error: says what failed, and Try again reloads the page', () => {
    holdLazy();
    PATH_MODS[2]!.mod.failed.value = true;
    const reload = vi.spyOn(page, 'reload').mockImplementation(() => {});
    const { getByRole } = render(<TodayView />);
    const alert = getByRole('alert');
    expect(alert.textContent).toContain("The Computer Science path didn't load.");
    const btn = alert.querySelector('button')!;
    expect(btn.classList.contains('m-btn')).toBe(true); // 44px minimum via the primitive
    fireEvent.click(btn);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('offline: a failed load with a saved copy shows it and "Saved copy from h:mm a"', () => {
    holdLazy();
    const d = new Date();
    d.setHours(8, 14, 0, 0); // earlier today, so the note shows the time alone
    const at = d.getTime();
    writeSaved('path.wgu', WGU, at);
    PATH_MODS[0]!.mod.failed.value = true;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { container, getByText, queryByRole } = render(<TodayView />);
    expect(container.querySelector('.pc[data-route="wgu"]')!.textContent).toContain('1 of 4');
    expect(getByText(`Offline · Saved copy from ${clockTime(at)}`)).toBeTruthy();
    expect(clockTime(at)).toBe('8:14 AM');
    expect(queryByRole('alert')).toBeNull();
  });

  it('a summary that throws falls back to the saved copy, and the note says so', () => {
    holdLazy();
    const at = new Date(2026, 8, 28, 8, 14).getTime(); // Mon Sep 28, a previous day
    writeSaved('path.cam', { ...WGU, id: 'math', title: 'Math' }, at);
    PATH_MODS[1]!.mod.mod.value = {
      currentSummary: () => {
        throw new Error('bad content');
      },
    };
    const { container, getByText, queryByRole } = render(<TodayView />);
    expect(container.querySelector('.pc[data-route="math"]')!.textContent).toContain('1 of 4');
    expect(getByText('Saved copy from Mon Sep 28, 8:14 AM')).toBeTruthy();
    expect(queryByRole('alert')).toBeNull();
  });

  it("the Cambridge Math and CS cards save under their own keys and never touch the old build's", async () => {
    // The build before the Cambridge Method reads path.math / path.cs for its offline
    // fallback; a rollback must find its own copies there, exactly as it left them.
    const OLD_MATH = JSON.stringify({ at: 1, value: { id: 'math', title: 'Math', course: 'Old plan' } });
    const OLD_CS = JSON.stringify({ at: 1, value: { id: 'cs', title: 'Computer Science', course: 'COS 226' } });
    localStorage.setItem('meridian.today.saved.path.math', OLD_MATH);
    localStorage.setItem('meridian.today.saved.path.cs', OLD_CS);
    holdLazy();
    PATH_MODS[1]!.mod.mod.value = stub({ ...WGU, id: 'math', title: 'Math' });
    PATH_MODS[2]!.mod.mod.value = stub({ ...WGU, id: 'cs', title: 'Computer Science' });
    const { container } = render(<TodayView />);
    await waitFor(() => {
      expect(localStorage.getItem('meridian.today.saved.path.cam')).not.toBeNull();
      expect(localStorage.getItem('meridian.today.saved.path.cst')).not.toBeNull();
    });
    expect(JSON.parse(localStorage.getItem('meridian.today.saved.path.cam')!).value.id).toBe('math');
    expect(JSON.parse(localStorage.getItem('meridian.today.saved.path.cst')!).value.id).toBe('cs');
    expect(localStorage.getItem('meridian.today.saved.path.math')).toBe(OLD_MATH);
    expect(localStorage.getItem('meridian.today.saved.path.cs')).toBe(OLD_CS);
    // An old-shaped copy under the old key is never shown by this build either.
    expect(container.textContent).not.toContain('Old plan');
  });

  it('a failed Math card with only the old key saved shows the error, not the old copy', () => {
    holdLazy();
    localStorage.setItem('meridian.today.saved.path.math', JSON.stringify({ at: 1, value: { ...WGU, id: 'math', title: 'Math' } }));
    PATH_MODS[1]!.mod.failed.value = true;
    const { getByRole } = render(<TodayView />);
    expect(getByRole('alert').textContent).toContain("The Math path didn't load.");
    expect(localStorage.getItem('meridian.today.saved.path.math')).not.toBeNull();
  });

  it('loads the real path modules lazily and replaces the skeletons', async () => {
    const { container } = render(<TodayView />);
    await waitFor(() => expect(container.querySelectorAll('button.pc').length).toBe(3), { timeout: 10_000 });
    expect([...container.querySelectorAll<HTMLElement>('button.pc')].map((c) => c.dataset.route)).toEqual([
      'wgu',
      'math',
      'cs',
    ]);
  });
});
