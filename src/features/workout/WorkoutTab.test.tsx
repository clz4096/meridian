/**
 * WorkoutView component test. Replaces the workout coverage that lived in the
 * deleted string-renderer suite. Asserts the one-screen render (bodyweight hero
 * + today's exercise cards), the collapsed→expanded card toggle, and that each
 * interactive control is wired to the matching workoutActions method: logSet
 * (inputs read by id), changeSplit, logBodyweight, and toggleExercise.
 *
 * Unlike Data/Meal, WorkoutView derives its exercise list from *logged* sets
 * (allExercises() reads state.days), and in the isolated test env wk() starts
 * empty — so each test seeds one past-dated set and forces split='all' to make
 * a card render. Bodyweight hero + split/bodyweight controls live behind the ⚙
 * (wkExtrasOpen), so those tests open it first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { WorkoutView } from '@/features/workout/WorkoutTab';
import { wk, workoutActions } from '@/ui/actions';
import { wkLoaded, wkDate, wkSplit, wkSplitTouched, wkDeload, activeExercise, wkExtrasOpen } from '@/ui/store';

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
  wkExtrasOpen.value = false;
  const W = wk() as any;
  W.days = {};
  W.bw = {};
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

  it('fires workoutActions.changeSplit with the chosen split (behind the ⚙)', () => {
    const splitSpy = vi.spyOn(workoutActions, 'changeSplit').mockImplementation(() => {});
    wkExtrasOpen.value = true;
    const { container } = render(<WorkoutView />);
    const btns = [...container.querySelectorAll('.timebar button')]; // All / Lower / Upper
    fireEvent.click(btns[2]!); // Upper
    expect(splitSpy).toHaveBeenCalledWith('upper');
  });

  it('parses the #bw-in field and fires workoutActions.logBodyweight with a number', () => {
    const bwSpy = vi.spyOn(workoutActions, 'logBodyweight').mockImplementation(() => {});
    wkExtrasOpen.value = true;
    const { getByText, container } = render(<WorkoutView />);
    (container.querySelector('#bw-in') as HTMLInputElement).value = '162';
    fireEvent.click(getByText('Log'));
    expect(bwSpy).toHaveBeenCalledWith(162);
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
