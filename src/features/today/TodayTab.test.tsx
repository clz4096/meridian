/**
 * TodayView component test — the home screen: clock + weather hero, the due
 * (overdue + today) todos, and the at-a-glance that drills into a tracker.
 * Weather/geolocation network calls are inert in jsdom (no navigator.geolocation,
 * saved city empty → no fetch), so we drive the weather signal directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { TodayView } from '@/features/today/TodayTab';
import * as actions from '@/ui/actions';
import { appState, dstr } from '@/app/bootstrap';
import { weather, currentTab } from '@/ui/store';

const emptyCore = () => ({ schedule: {}, entries: [], todos: [], scratch: [], _del: {} });

beforeEach(() => {
  appState.set('core', emptyCore() as never);
  weather.value = null;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  weather.value = null;
  currentTab.value = 'today';
  appState.set('core', emptyCore() as never);
});

describe('TodayView', () => {
  it('renders the clock + a set-location prompt when there is no weather', () => {
    const { container, getByText } = render(<TodayView />);
    expect(container.querySelector('.today-time')?.textContent).toMatch(/\d/);
    expect(getByText(/Set location/)).toBeTruthy();
  });

  it('shows the weather line when a reading is present', () => {
    weather.value = { tempF: 72, code: 0, city: 'Brooklyn', at: 0 };
    const { getByText } = render(<TodayView />);
    expect(getByText(/72°/)).toBeTruthy();
    expect(getByText(/Brooklyn/)).toBeTruthy();
  });

  it('surfaces overdue + due-today todos (not future ones) and wires the checkbox', () => {
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
    const { getByText, queryByText, container } = render(<TodayView />);
    expect(getByText('Overdue thing')).toBeTruthy();
    expect(getByText('Due today thing')).toBeTruthy();
    expect(queryByText('Future thing')).toBeNull();
    fireEvent.click(container.querySelector('.todo-chk')!);
    expect(toggle).toHaveBeenCalledWith('a');
  });

  it('drills into a tracker from the at-a-glance', () => {
    const spy = vi.spyOn(actions, 'openSection').mockImplementation(() => {});
    const { getByText } = render(<TodayView />);
    fireEvent.click(getByText('Food & Body').closest('.tile')!);
    expect(spy).toHaveBeenCalledWith('meal');
  });
});
