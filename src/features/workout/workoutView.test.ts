/**
 * View-layer tests.
 *
 * The renderer is a pure function, so it can be property-tested like any other
 * data transform: same view model in, same markup out, no DOM required.
 * The controller is tested against a fake host to prove delegation survives a
 * repaint and that focus/caret/scroll/typed values are preserved.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { selectWorkoutView } from '@/features/workout/workoutSelectors';
import { shiftDate } from '@/core/util';
import type { WorkoutSet, WorkoutState, WorkoutViewModel } from '@/core/types';
import { domId, esc } from '@/ui/html';
import type { ViewHost } from '@/ui/viewHost';
import {
  renderWorkoutHTML,
  WorkoutViewController,
  type WorkoutActions,
  type WorkoutViewOptions,
} from '@/features/workout/workoutView';

const RUNS = Number(process.env.FC_RUNS ?? 150);

const options: WorkoutViewOptions = {
  restSeconds: new Proxy({}, { get: () => ({ warm: 60, top: 180, back: 120 }) }) as WorkoutViewOptions['restSeconds'],
  increments: new Proxy({}, { get: () => 5 }) as Record<string, number>,
  videoUrl: (ex) => `https://example.test/${encodeURIComponent(ex)}`,
  bodyweight: { current: 120, goal: 150, toGoal: 30 },
  dateLabel: (d) => `Label ${d}`,
  isToday: true,
  logOpen: true, // render the logging content expanded for these content assertions
};

function stateWith(sets: WorkoutSet[], date = '2026-07-20'): WorkoutState {
  return {
    settings: {}, days: { [date]: sets }, bw: {}, rpe: {},
    done: {}, sessionDone: {}, incr: {}, _del: {},
  };
}

const baseState = stateWith([
  { id: 's1' as never, ex: 'Bench Press', type: 'warm', weight: 95, reps: 8, muscle: 'chest' },
  { id: 's2' as never, ex: 'Bench Press', type: 'top', weight: 135, reps: 5, muscle: 'chest' },
  { id: 's3' as never, ex: 'Bench Press', type: 'back', weight: 120, reps: 8, muscle: 'chest' },
]);

/* ================================================================== */
/* Purity + escaping                                                   */
/* ================================================================== */

describe('renderer purity', () => {
  it('contains no data derivation — only the pure layer computes numbers', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./workoutView.ts', import.meta.url), 'utf8'),
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    for (const banned of ['buildPlan', 'inferIncrement', 'setTemplate', 'suggestSplit', 'estimateSession', 'roundTo']) {
      expect(code).not.toContain(banned);
    }
  });

  it('is deterministic for a given view model', () => {
    const vm = selectWorkoutView(baseState, '2026-07-25', '2026-07-25');
    expect(renderWorkoutHTML(vm, options)).toBe(renderWorkoutHTML(vm, options));
  });

  it('escapes user-controlled exercise names', () => {
    const nasty = '<img src=x onerror=alert(1)>';
    const vm = selectWorkoutView(
      stateWith([{ id: 'x' as never, ex: nasty, type: 'top', weight: 10, reps: 5, muscle: 'chest' }]),
      '2026-07-25',
      '2026-07-25',
      { split: 'all' },
    );
    const html = renderWorkoutHTML(vm, options);
    expect(vm.exercises).toContain(nasty);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('esc neutralises every HTML metacharacter', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const out = esc(s);
        expect(out).not.toMatch(/[<>]/);
        if (s.includes('&')) expect(out).toContain('&amp;');
      }),
      { numRuns: RUNS },
    );
  });

  it('produces well-formed markup for arbitrary state', () => {
    const arbState = fc
      .array(
        fc.record({
          ex: fc.constantFrom('Bench Press', 'Leg Press', 'Treadmill', 'Wrist Curl (Dumbbell)'),
          type: fc.constantFrom('warm', 'top', 'back'),
          weight: fc.integer({ min: 1, max: 400 }),
          reps: fc.integer({ min: 1, max: 20 }),
          muscle: fc.constantFrom('chest', 'quads', 'cardio', 'forearms'),
        }),
        { minLength: 1, maxLength: 8 },
      )
      .map((rows) =>
        stateWith(rows.map((r, i) => ({ ...r, id: `id-${i}` }) as unknown as WorkoutSet)),
      );

    fc.assert(
      fc.property(arbState, fc.integer({ min: -5, max: 20 }), (state, offset) => {
        const date = shiftDate('2026-07-20', offset);
        const vm = selectWorkoutView(state, date, '2026-07-25');
        const html = renderWorkoutHTML(vm, options);
        const open = (html.match(/<div/g) ?? []).length;
        const close = (html.match(/<\/div>/g) ?? []).length;
        expect(open).toBe(close);
        expect(html).not.toContain('undefined');
        expect(html).not.toContain('NaN');
      }),
      { numRuns: Math.min(RUNS, 1000) },
    );
  });
});

/* ================================================================== */
/* Controller: delegation + repaint                                    */
/* ================================================================== */

class FakeHost implements ViewHost {
  handlers: Record<string, (e: Event) => void> = {};
  html = '';
  focusId: string | null = null;
  caret: number | null = null;
  scroll = 0;
  typed: Record<string, string> = {};
  restoredFocus: Array<[string, number | null]> = [];
  restoredValues = 0;

  container = {
    get innerHTML() {
      return hostRef.html;
    },
    set innerHTML(v: string) {
      hostRef.html = v;
      hostRef.paints++;
    },
    addEventListener: (type: string, handler: (e: Event) => void) => {
      this.handlers[type] = handler;
      this.bindCount++;
    },
    querySelector: () => null,
  };
  paints = 0;
  bindCount = 0;

  getActiveElementId = () => this.focusId;
  getSelectionStart = () => this.caret;
  restoreFocus = (id: string, caret: number | null) => {
    this.restoredFocus.push([id, caret]);
  };
  getScrollY = () => this.scroll;
  setScrollY = (y: number) => {
    this.scroll = y;
  };
  captureInputValues = () => ({ ...this.typed });
  restoreInputValues = () => {
    this.restoredValues++;
  };

  fire(type: string, dataset: Record<string, string>): void {
    this.handlers[type]?.({ target: { dataset } } as unknown as Event);
  }
}
// eslint-disable-next-line prefer-const
let hostRef: FakeHost;

function makeController() {
  hostRef = new FakeHost();
  const actions: WorkoutActions = {
    logSet: vi.fn(), deleteSet: vi.fn(), toggleExerciseDone: vi.fn(),
    toggleSessionDone: vi.fn(), toggleDeload: vi.fn(), editIncrement: vi.fn(),
    startRest: vi.fn(), changeDate: vi.fn(), changeSplit: vi.fn(), logBodyweight: vi.fn(),
    undoLastSet: vi.fn(),
  };
  const ctrl = new WorkoutViewController(hostRef, actions, () => 100);
  return { ctrl, host: hostRef, actions };
}

describe('event delegation', () => {
  it('binds exactly once, regardless of how many repaints happen', () => {
    const { ctrl, host } = makeController();
    const vmA = selectWorkoutView(baseState, '2026-07-25', '2026-07-25');
    const vmB = selectWorkoutView(baseState, '2026-07-24', '2026-07-25');
    for (let i = 0; i < 50; i++) ctrl.repaint(i % 2 ? vmA : vmB, options);
    expect(host.bindCount).toBe(1);          // patchLift is unnecessary
  });

  it('routes each action from the delegated listener', () => {
    const { host, actions } = makeController();
    host.fire('click', { act: 'log', ex: 'Bench Press', type: 'top', w: 'w1', r: 'r1' });
    expect(actions.logSet).toHaveBeenCalledWith('Bench Press', 'top', 100, 100);
    expect(actions.startRest).toHaveBeenCalledWith('Bench Press', 'top');

    host.fire('click', { act: 'ex-done', ex: 'Leg Press' });
    expect(actions.toggleExerciseDone).toHaveBeenCalledWith('Leg Press');

    host.fire('click', { act: 'session-done' });
    expect(actions.toggleSessionDone).toHaveBeenCalled();

    host.fire('click', { act: 'del-set', date: '2026-07-20', id: 's2' });
    expect(actions.deleteSet).toHaveBeenCalledWith('2026-07-20', 's2');

    host.fire('click', { act: 'split', split: 'lower' });
    expect(actions.changeSplit).toHaveBeenCalledWith('lower');

    host.fire('click', { act: 'incr', ex: 'Leg Extension' });
    expect(actions.editIncrement).toHaveBeenCalledWith('Leg Extension');
  });

  it('ignores clicks on elements without a data-act', () => {
    const { host, actions } = makeController();
    host.fire('click', {});
    host.fire('click', { ex: 'Bench Press' });
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('repaint behaviour', () => {
  it('skips the DOM write when markup is unchanged', () => {
    const { ctrl, host } = makeController();
    const vm = selectWorkoutView(baseState, '2026-07-25', '2026-07-25');
    expect(ctrl.repaint(vm, options)).toBe(true);
    const paints = host.paints;
    for (let i = 0; i < 20; i++) expect(ctrl.repaint(vm, options)).toBe(false);
    expect(host.paints).toBe(paints);
  });

  it('preserves focus, caret, scroll and uncommitted input across a repaint', () => {
    const { ctrl, host } = makeController();
    host.focusId = 'w-bench-press-top1';
    host.caret = 2;
    host.scroll = 480;
    host.typed = { 'w-bench-press-top1': '142' };

    ctrl.repaint(selectWorkoutView(baseState, '2026-07-25', '2026-07-25'), options);
    ctrl.repaint(selectWorkoutView(baseState, '2026-07-24', '2026-07-25'), options);

    expect(host.restoredFocus.length).toBeGreaterThan(0);
    expect(host.scroll).toBe(480);
    expect(host.restoredValues).toBeGreaterThan(0);
  });

  // Render performance is measured by `npm run bench`, not here. A timing
  // assertion inside a parallel test runner fails on CPU contention rather
  // than on a real regression, which trains people to ignore red builds.

});

describe('view model contract', () => {
  it('every rendered card corresponds to an exercise in the view model', () => {
    const vm: WorkoutViewModel = selectWorkoutView(baseState, '2026-07-25', '2026-07-25');
    const html = renderWorkoutHTML(vm, options);
    for (const ex of vm.exercises) expect(html).toContain(`id="lift-${domId(ex)}"`);
    const cards = (html.match(/class="lift[^"]*" id="lift-/g) ?? []).length;
    expect(cards).toBe(vm.exercises.length);
  });
});
