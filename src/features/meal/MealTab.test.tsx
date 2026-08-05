/**
 * MealView component test. Replaces the meal coverage that lived in the deleted
 * string-renderer suite. Asserts the charts-first Progress screen and its
 * "View meal log" CTA, then flips the sgLogOpen signal to exercise the log
 * screen: the add-a-meal inputs (read by id), preset chips, and the date nav —
 * each wired to the matching mealActions method.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { MealView } from '@/features/meal/MealTab';
import { mealActions, sg, MEAL_PRESETS } from '@/ui/actions';
import { appState, dstr } from '@/app/bootstrap';
import { sgLoaded, sgLogOpen, sgDate } from '@/ui/store';

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
  sgLogOpen.value = false;
  sgDate.value = null;
});

describe('MealView', () => {
  it('renders the Progress screen with a "View meal log" CTA by default', () => {
    const { getByText } = render(<MealView />);
    expect(getByText('Meals')).toBeTruthy();
    expect(getByText('View meal log')).toBeTruthy();
  });

  it('fires mealActions.toggleLog when the "View meal log" CTA is tapped', () => {
    const toggleSpy = vi.spyOn(mealActions as Required<typeof mealActions>, 'toggleLog').mockImplementation(() => {});
    const { getByText } = render(<MealView />);
    fireEvent.click(getByText('View meal log'));
    expect(toggleSpy).toHaveBeenCalledOnce();
  });

  it('renders the add-a-meal inputs on the log screen', () => {
    sgLogOpen.value = true;
    const { container } = render(<MealView />);
    expect(container.querySelector('#meal-name')).toBeTruthy();
    expect(container.querySelector('#meal-cal')).toBeTruthy();
    expect(container.querySelector('#meal-pro')).toBeTruthy();
  });

  it('passes the parsed name/calories/protein to mealActions.addMeal', () => {
    sgLogOpen.value = true;
    const addSpy = vi.spyOn(mealActions, 'addMeal').mockImplementation(() => {});
    const { getByText, container } = render(<MealView />);
    (container.querySelector('#meal-name') as HTMLInputElement).value = 'Oatmeal';
    (container.querySelector('#meal-cal') as HTMLInputElement).value = '300';
    (container.querySelector('#meal-pro') as HTMLInputElement).value = '12';
    fireEvent.click(getByText('Add'));
    expect(addSpy).toHaveBeenCalledWith('Oatmeal', 300, 12);
  });

  it('fires mealActions.addPreset with the chip\'s args when a preset is tapped', () => {
    sgLogOpen.value = true;
    const presetSpy = vi.spyOn(mealActions, 'addPreset').mockImplementation(() => {});
    const p = MEAL_PRESETS[0];
    const { getByText } = render(<MealView />);
    fireEvent.click(getByText(p.name));
    expect(presetSpy).toHaveBeenCalledWith(p.name, p.cal, p.protein);
  });

  it('fires mealActions.changeDate for prev / next / today nav', () => {
    // A non-today date makes the "→ Today" button render.
    sgDate.value = '2020-01-01';
    sgLogOpen.value = true;
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
 * Regression: the Progress-screen hero must sum today's meals by the *local*
 * calendar day (dstr()), the same key meals are stored under — not the UTC day.
 * These pin a fixed timezone + clock so the local date and the UTC date fall on
 * different calendar days; the old code keyed the hero off the UTC day and read
 * an empty bucket, showing 0 while the log view (local day) showed the real sum.
 */
describe('MealView · Progress hero uses the local calendar day', () => {
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
    sgLogOpen.value = false;
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
    const hero = container.querySelector('.sechero-v');
    expect(hero?.textContent).toContain('230'); // not '0' — reads the local-day bucket
  });
});

/**
 * Regression: the log screen must re-render when a meal is added or removed. The
 * store-deriving work lives in the MealLog child, so it must subscribe to
 * dataRev itself — a subscription on the MealView parent alone did not re-render
 * the child, so logged/deleted meals silently didn't appear.
 */
describe('MealView · log list reacts to add/remove', () => {
  beforeEach(() => {
    sgLoaded.value = true;
    sgLogOpen.value = true;
    sgDate.value = null;
    appState.set('surplus', { settings: {}, days: {}, tad: {} });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
    sgLoaded.value = false;
    sgLogOpen.value = false;
    sgDate.value = null;
    appState.set('surplus', { settings: {}, days: {}, tad: {} });
  });

  it('shows a meal after it is logged and hides it after it is deleted', async () => {
    // A name that is NOT one of the preset chips, so the query only hits the list.
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
