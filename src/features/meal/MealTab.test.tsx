/**
 * MealView component test — the single-screen Food & Body (budget dashboard over
 * a diary feed). Asserts the calories-left ring + Body block, the "+ Log food"
 * composer (opened on demand: add-a-meal inputs read by id, preset chips), the
 * date nav, the weigh-in, and that a logged meal appears in the feed and a
 * deleted one disappears — each wired to the matching action.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { MealView } from '@/features/meal/MealTab';
import { mealActions, workoutActions, sg, MEAL_PRESETS } from '@/ui/actions';
import { appState, dstr } from '@/app/bootstrap';
import { sgLoaded, sgDate } from '@/ui/store';

/** Reveal the "+ Log food" composer so the add-a-meal controls are in the DOM. */
function openComposer(getByText: (t: string) => HTMLElement) {
  fireEvent.click(getByText('Log food'));
}

beforeEach(() => {
  // The component shows "Loading…" until the store is marked loaded, and its
  // effect kicks off a real async loadMeal() when this is false. Pre-seed it.
  sgLoaded.value = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sgLoaded.value = false;
  sgDate.value = null;
});

describe('MealView', () => {
  it('renders the budget dashboard: the calories-left ring + the Body block', () => {
    const { container, getByText } = render(<MealView />);
    expect(container.querySelector('.bud-num')).toBeTruthy(); // calories-left ring center
    expect(getByText('Body')).toBeTruthy();
  });

  it('shows a clear empty state when nothing is logged for the day', () => {
    appState.set('surplus', { settings: {}, days: {}, tad: {} });
    const { getByText } = render(<MealView />);
    expect(getByText('No meals logged yet today.')).toBeTruthy();
  });

  it('reveals the add-a-meal inputs only after "+ Log food" is tapped', () => {
    const { container, getByText } = render(<MealView />);
    expect(container.querySelector('#meal-name')).toBeNull();
    openComposer(getByText);
    expect(container.querySelector('#meal-name')).toBeTruthy();
    expect(container.querySelector('#meal-cal')).toBeTruthy();
    expect(container.querySelector('#meal-pro')).toBeTruthy();
  });

  it('passes the parsed name/calories/protein to mealActions.addMeal', () => {
    const addSpy = vi.spyOn(mealActions, 'addMeal').mockImplementation(() => {});
    const { getByText, container } = render(<MealView />);
    openComposer(getByText);
    (container.querySelector('#meal-name') as HTMLInputElement).value = 'Oatmeal';
    (container.querySelector('#meal-cal') as HTMLInputElement).value = '300';
    (container.querySelector('#meal-pro') as HTMLInputElement).value = '12';
    fireEvent.click(getByText('Add'));
    expect(addSpy).toHaveBeenCalledWith('Oatmeal', 300, 12);
  });

  it('fires mealActions.addPreset with the chip\'s args when a preset is tapped', () => {
    const presetSpy = vi.spyOn(mealActions, 'addPreset').mockImplementation(() => {});
    const p = MEAL_PRESETS[0];
    const { getByText } = render(<MealView />);
    openComposer(getByText);
    fireEvent.click(getByText(p.name));
    expect(presetSpy).toHaveBeenCalledWith(p.name, p.cal, p.protein);
  });

  it('fires workoutActions.logBodyweight from the weigh-in', () => {
    const bwSpy = vi.spyOn(workoutActions, 'logBodyweight').mockImplementation(() => {});
    const { getByLabelText } = render(<MealView />);
    (getByLabelText("Log today's weight") as HTMLInputElement).value = '182';
    fireEvent.click(getByLabelText('Log weight'));
    expect(bwSpy).toHaveBeenCalledWith(182);
  });

  it('fires mealActions.changeDate for prev / next / today nav', () => {
    // A non-today date makes the "→ Today" button render.
    sgDate.value = '2020-01-01';
    const dateSpy = vi.spyOn(mealActions, 'changeDate').mockImplementation(() => {});
    const { getByLabelText, getByText } = render(<MealView />);
    fireEvent.click(getByLabelText('Previous day'));
    fireEvent.click(getByLabelText('Next day'));
    fireEvent.click(getByText('→ Today'));
    expect(dateSpy).toHaveBeenNthCalledWith(1, 'prev');
    expect(dateSpy).toHaveBeenNthCalledWith(2, 'next');
    expect(dateSpy).toHaveBeenNthCalledWith(3, 'today');
  });
});

/**
 * Regression: the budget must sum the day's meals by the *local* calendar day
 * (dstr()), the same key meals are stored under — not the UTC day. These pin a
 * fixed timezone + clock so the local date and the UTC date fall on different
 * calendar days; the old code keyed the total off the UTC day and read an empty
 * bucket, showing 0 while the log view (local day) showed the real sum.
 */
describe('MealView · budget uses the local calendar day', () => {
  const realTZ = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/New_York'; // UTC-4/5
  });
  afterAll(() => {
    process.env.TZ = realTZ;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // 02:00 UTC on Mar 10 = 22:00 on Mar 9 in New York → local day != UTC day.
    vi.setSystemTime(new Date('2026-03-10T02:00:00Z'));
    sgLoaded.value = true;
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sgLoaded.value = false;
    appState.set('surplus', { settings: {}, days: {}, tad: {} });
  });

  it('sums meals stored under the local day, not the (different) UTC day', () => {
    // precondition: we really are in a cross-midnight window, else the test is moot
    const localDay = dstr();
    const utcDay = new Date().toISOString().slice(0, 10);
    expect(localDay).not.toBe(utcDay);

    appState.set('surplus', {
      settings: {},
      days: { [localDay]: [{ id: 'm1', name: 'Lunch', cal: 230, protein: 20 }] },
      tad: {},
    });

    const { container } = render(<MealView />);
    const eaten = container.querySelector('.bud-eaten');
    expect(eaten?.textContent).toContain('230'); // not '0' — reads the local-day bucket
  });
});

/**
 * Regression: the feed must re-render when a meal is added or removed. The
 * store-deriving work lives in MealView, which subscribes to dataRev itself — a
 * subscription only on a parent would not re-render, so logged/deleted meals
 * would silently not appear in the feed.
 */
describe('MealView · feed reacts to add/remove', () => {
  beforeEach(() => {
    sgLoaded.value = true;
    sgDate.value = null;
    appState.set('surplus', { settings: {}, days: {}, tad: {} });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sgLoaded.value = false;
    sgDate.value = null;
    appState.set('surplus', { settings: {}, days: {}, tad: {} });
  });

  it('shows a meal after it is logged and hides it after it is deleted', async () => {
    // A name that is NOT one of the preset chips, so the query only hits the feed.
    const NAME = 'Grilled Halibut';
    const { queryByText } = render(<MealView />);
    expect(queryByText(NAME)).toBeNull();

    await act(async () => {
      mealActions.addMeal(NAME, 321, 44);
    });
    expect(queryByText(NAME)).toBeTruthy();

    const id = sg().days[dstr()][0].id as string;
    await act(async () => {
      mealActions.deleteMeal(id);
    });
    expect(queryByText(NAME)).toBeNull();
  });
});
