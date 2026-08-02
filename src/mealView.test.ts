import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { MealState } from './types.js';
import { selectMealView } from './mealSelectors.js';
import { renderMealHTML, MealViewController, type MealActions, type MealViewOptions } from './mealView.js';
import type { ViewHost } from './viewHost.js';

const RUNS = Number(process.env.FC_RUNS ?? 150);

const mealOpts: MealViewOptions = {
  dateLabel: (d) => `Label ${d}`,
  presets: [
    { label: 'Core Power Elite · 230 / 42g', name: 'Core Power Elite', cal: 230, protein: 42 },
    { label: 'Cook Unity · 900 / 40g', name: 'Cook Unity', cal: 900, protein: 40 },
  ],
};

class FakeHost implements ViewHost {
  html = ''; binds = 0; paints = 0;
  handlers: Record<string, (e: Event) => void> = {};
  container = {
    get innerHTML() { return hostRef.html; },
    set innerHTML(v: string) { hostRef.html = v; hostRef.paints++; },
    addEventListener: (t: string, h: (e: Event) => void) => { hostRef.handlers[t] = h; hostRef.binds++; },
    querySelector: () => null,
  };
  getActiveElementId = () => null;
  getSelectionStart = () => null;
  restoreFocus = () => {};
  getScrollY = () => 0;
  setScrollY = () => {};
  captureInputValues = () => ({});
  restoreInputValues = () => {};
  fire(dataset: Record<string, string>) { this.handlers.click?.({ target: { dataset } } as unknown as Event); }
}
let hostRef: FakeHost;

const arbState: fc.Arbitrary<MealState> = fc.record({
  settings: fc.record({ maintenance: fc.integer({ min: 1200, max: 4000 }), surplus: fc.integer({ min: 0, max: 900 }), proteinTarget: fc.integer({ min: 60, max: 220 }) }),
  days: fc.dictionary(fc.constant('2026-07-25'), fc.array(fc.record({
    id: fc.uuid(), name: fc.string({ maxLength: 24 }),
    cal: fc.integer({ min: 0, max: 1500 }), protein: fc.integer({ min: 0, max: 90 }), est: fc.boolean(),
  }), { maxLength: 6 }), { maxKeys: 1 }),
  tad: fc.dictionary(fc.constant('2026-07-25'), fc.integer({ min: 0, max: 4 }), { maxKeys: 1 }),
  _del: fc.constant({}),
}) as fc.Arbitrary<MealState>;

describe('meal view', () => {
  it('renders balanced markup and escapes meal names', () => {
    fc.assert(fc.property(arbState, (state) => {
      const vm = selectMealView(state, '2026-07-25', '2026-07-25');
      const html = renderMealHTML(vm, mealOpts, "", true);
      expect((html.match(/<div/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('NaN');
    }), { numRuns: RUNS });
  });

  it('escapes an XSS attempt in a meal name', () => {
    const state: MealState = {
      settings: {}, tad: {}, _del: {},
      days: { '2026-07-25': [{ id: 'x', name: '<img src=x onerror=alert(1)>', cal: 100, protein: 5 } as never] },
    };
    const html = renderMealHTML(selectMealView(state, "2026-07-25", "2026-07-25"), mealOpts, "", true);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('surfaces macro issues in the UI', () => {
    const state: MealState = {
      settings: {}, tad: {}, _del: {},
      days: { '2026-07-25': [{ id: 'bad', name: 'typo', cal: 10, protein: 40 } as never] },
    };
    const html = renderMealHTML(selectMealView(state, "2026-07-25", "2026-07-25"), mealOpts, "", true);
    expect(html).toContain('needs checking');
  });

  it('binds once and routes every action', () => {
    hostRef = new FakeHost();
    const actions: MealActions = {
      addMeal: vi.fn(), addPreset: vi.fn(), deleteMeal: vi.fn(), estimateWithAI: vi.fn(),
      changeDate: vi.fn(), editTargets: vi.fn(), adjustSupplement: vi.fn(),
    };
    const values: Record<string, string> = { 'meal-name': 'Steak', 'meal-cal': '700', 'meal-pro': '55', 'meal-desc': 'two eggs' };
    const ctrl = new MealViewController(hostRef, actions, (id) => values[id] ?? '', mealOpts);
    const vm = selectMealView({ settings: {}, days: {}, tad: {}, _del: {} }, '2026-07-25', '2026-07-25');
    for (let i = 0; i < 20; i++) ctrl.repaint(vm, '', true);
    expect(hostRef.binds).toBe(1);
    expect(hostRef.paints).toBe(1);            // identical repaints skipped

    hostRef.fire({ act: 'add-meal' });
    expect(actions.addMeal).toHaveBeenCalledWith('Steak', 700, 55);
    hostRef.fire({ act: 'preset', i: '1' });
    expect(actions.addPreset).toHaveBeenCalledWith('Cook Unity', 900, 40);
    hostRef.fire({ act: 'del-meal', id: 'abc' });
    expect(actions.deleteMeal).toHaveBeenCalledWith('abc');
    hostRef.fire({ act: 'supp', delta: '-1' });
    expect(actions.adjustSupplement).toHaveBeenCalledWith(-1);
    hostRef.fire({ act: 'estimate' });
    expect(actions.estimateWithAI).toHaveBeenCalledWith('two eggs');
    hostRef.fire({});                          // no data-act
    expect(actions.editTargets).not.toHaveBeenCalled();
  });
});
