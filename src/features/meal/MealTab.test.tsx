/**
 * MealView component test. Replaces the meal coverage that lived in the deleted
 * string-renderer suite. Asserts the charts-first Progress screen and its
 * "View meal log" CTA, then flips the sgLogOpen signal to exercise the log
 * screen: the add-a-meal inputs (read by id), preset chips, and the date nav —
 * each wired to the matching mealActions method.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { MealView } from '@/features/meal/MealTab';
import { mealActions, MEAL_PRESETS } from '@/ui/actions';
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
