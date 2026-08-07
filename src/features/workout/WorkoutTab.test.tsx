/**
 * WorkoutView component test. Replaces the workout coverage that lived in the
 * deleted string-renderer suite. Asserts the one-screen render (week strip +
 * today's exercise cards), the collapsed→expanded card toggle, and that each
 * interactive control is wired to the matching workoutActions method: logSet
 * (inputs read by id), toggleExercise, and toggleSessionDone (the one primary
 * "Mark session complete" action).
 *
 * Unlike Data/Meal, WorkoutView derives its exercise list from *logged* sets
 * (allExercises() reads state.days), and in the isolated test env wk() starts
 * empty — so each test seeds one past-dated set and forces split='all' to make
 * a card render (which also bypasses the rest-day schedule).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { WorkoutView } from '@/features/workout/WorkoutTab';
import { wk, workoutActions } from '@/ui/actions';
import { wkLoaded, wkDate, wkSplit, wkSplitTouched, wkDeload, activeExercise, awayMode } from '@/ui/store';

beforeEach(() => {
  // The view shows "Loading…" and kicks off a real async loadWorkout() in an
  // effect until this is true. Pre-seed it.
  wkLoaded.value = true;
  // Seed one lift on a past date so it surfaces as today's card; split='all'
  // bypasses the upper/lower filter so the seed always shows.
  const W = wk() as any;
  W.days['2020-01-01'] = [
    { id: 's1', ex: 'Leg Press', muscle: 'quads', group: 'legs', type: 'top', weight: 200, reps: 8 },
  ];
  W.bw['2026-08-01'] = '150';
  wkSplit.value = 'all';
  wkSplitTouched.value = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  wkLoaded.value = false;
  wkDate.value = null;
  wkSplit.value = 'all';
  wkSplitTouched.value = false;
  wkDeload.value = {};
  activeExercise.value = null;
  awayMode.value = false;
  const W = wk() as any;
  W.days = {};
  W.bw = {};
  W.done = {};
});

describe('WorkoutView', () => {
  it('renders the workout screen: week strip + today header + the seeded exercise card', () => {
    const { container } = render(<WorkoutView />);
    expect(container.querySelector('.wkweek')).toBeTruthy(); // your-week strip
    expect(container.querySelector('.todayhd-split')).toBeTruthy(); // today's split header (the lead)
    const names = [...container.querySelectorAll('.excard-name')].map((e) => e.textContent);
    expect(names.some((n) => n?.includes('Leg Press'))).toBe(true);
  });

  it('shows the list of cards, not the log inputs, until an exercise is opened', () => {
    const { queryByText, container } = render(<WorkoutView />);
    // the grid: a card face shows, no Log set / no weight input
    expect(queryByText('Log set')).toBeNull();
    expect(container.querySelector('#w-leg-press-top0')).toBeNull();

    cleanup();
    activeExercise.value = 'Leg Press'; // open the full-screen detail
    const r = render(<WorkoutView />);
    expect(r.queryByText('Log set')).toBeTruthy();
    expect(r.container.querySelector('#w-leg-press-top0')).toBeTruthy();
    expect(r.container.querySelector('#r-leg-press-top0')).toBeTruthy();
  });

  it('reads the weight/reps inputs by id and passes them to workoutActions.logSet', () => {
    const logSpy = vi.spyOn(workoutActions, 'logSet').mockImplementation(() => {});
    activeExercise.value = 'Leg Press';
    const { getByText, container } = render(<WorkoutView />);
    (container.querySelector('#w-leg-press-top0') as HTMLInputElement).value = '185';
    (container.querySelector('#r-leg-press-top0') as HTMLInputElement).value = '10';
    fireEvent.click(getByText('Log set'));
    expect(logSpy).toHaveBeenCalledWith('Leg Press', 'top', 185, 10);
  });

  it('fires toggleSessionDone when the Mark-session-complete button is tapped', () => {
    const spy = vi.spyOn(workoutActions, 'toggleSessionDone').mockImplementation(() => {});
    const { getByText } = render(<WorkoutView />);
    fireEvent.click(getByText('Mark workout session complete'));
    expect(spy).toHaveBeenCalledOnce();
  });

  it('in Away mode logSet records under the substitute name (not the machine) and auto-completes at its seeded set count', () => {
    awayMode.value = true;
    const today = new Date().toISOString().slice(0, 10);
    wkDate.value = today; // a non-past date: completion needs the full prescribed plan
    const W = wk() as any;
    // Leg Press → Goblet Squat. WorkoutTab passes the ACTIVE (sub) name; simulate that.
    workoutActions.logSet('Goblet Squat', 'top', 30, 10);
    const day = (W.days[today] ?? []) as any[];
    expect(day.some((s) => s.ex === 'Goblet Squat')).toBe(true); // logged under the sub
    expect(day.some((s) => s.ex === 'Leg Press')).toBe(false); // machine lift untouched
    // muscle seeded from the approved start map (no prior sub history to read it from)
    expect(day.find((s) => s.ex === 'Goblet Squat')?.muscle).toBe('quads');
    // seeded plan is a full 4-set session (top + 3 back-offs) → one set is NOT complete yet
    expect(((W.done ?? {})[today] ?? []).includes('Goblet Squat')).toBe(false);
    // log the three back-offs → the seeded set count is met and the sub auto-completes
    workoutActions.logSet('Goblet Squat', 'back', 30, 10);
    workoutActions.logSet('Goblet Squat', 'back', 30, 10);
    workoutActions.logSet('Goblet Squat', 'back', 30, 10);
    expect(((W.done ?? {})[today] ?? []).includes('Goblet Squat')).toBe(true);
  });

  it('tapping an exercise card opens its full-screen detail', () => {
    const { container } = render(<WorkoutView />);
    expect(activeExercise.value).toBeNull();
    fireEvent.click(container.querySelector('.ex-top')!);
    expect(activeExercise.value).toBe('Leg Press');
    // re-render reflects the detail (the switcher + log inputs)
    cleanup();
    const r = render(<WorkoutView />);
    expect(r.container.querySelector('.exdetail')).toBeTruthy();
    expect(r.getByText('Log set')).toBeTruthy();
  });
});
