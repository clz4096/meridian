/**
 * Rest-timer state machine. Clock + scheduler are injected, so the countdown is
 * driven deterministically without real time.
 */
import { describe, expect, it, vi } from 'vitest';
import { RestTimer } from '@/ui/restTimer';
import type { RestBarHost } from '@/core/appHost';

function harness() {
  const clock = { t: 1000 };
  let ticker: (() => void) | null = null;
  let stopHandler: (() => void) | null = null;
  const bar = {
    paint: vi.fn(),
    hide: vi.fn(),
    onStop: vi.fn((fn: () => void) => {
      stopHandler = fn;
    }),
  } satisfies RestBarHost;
  const setInterval = vi.fn((fn: () => void) => {
    ticker = fn;
    return 42;
  });
  const clearInterval = vi.fn();
  const onVisibleStop = vi.fn();
  const timer = new RestTimer({ bar, now: () => clock.t, setInterval, clearInterval, onVisibleStop });
  return {
    timer,
    bar,
    clock,
    onVisibleStop,
    clearInterval,
    setInterval,
    tick: () => ticker?.(),
    pressStop: () => stopHandler?.(),
  };
}

describe('RestTimer', () => {
  it('binds the bar Stop button once in the constructor', () => {
    const h = harness();
    expect(h.bar.onStop).toHaveBeenCalledTimes(1);
  });

  it('paints immediately on start with zero elapsed and not-over', () => {
    const h = harness();
    h.timer.start('Bench Press', 'top', 180);
    expect(h.bar.paint).toHaveBeenLastCalledWith('Bench Press', 0, 180, false);
    expect(h.timer.activeExercise).toBe('Bench Press');
    expect(h.setInterval).toHaveBeenCalledTimes(1);
  });

  it('counts up as the clock advances and flips to over at the target', () => {
    const h = harness();
    h.timer.start('Squat', 'top', 5);
    h.clock.t += 3000; // 3s
    h.tick();
    expect(h.bar.paint).toHaveBeenLastCalledWith('Squat', 3, 5, false);
    h.clock.t += 2000; // now 5s elapsed → over
    h.tick();
    expect(h.bar.paint).toHaveBeenLastCalledWith('Squat', 5, 5, true);
  });

  it('restart clears the previous interval', () => {
    const h = harness();
    h.timer.start('A', 'top', 60);
    h.timer.start('B', 'warm', 30);
    expect(h.clearInterval).toHaveBeenCalledWith(42);
    expect(h.timer.activeExercise).toBe('B');
  });

  it('stop(true) hides the bar and does not re-render', () => {
    const h = harness();
    h.timer.start('A', 'top', 60);
    h.timer.stop(true);
    expect(h.bar.hide).toHaveBeenCalled();
    expect(h.clearInterval).toHaveBeenCalledWith(42);
    expect(h.onVisibleStop).not.toHaveBeenCalled();
    expect(h.timer.activeExercise).toBe('');
  });

  it('stop(false) hides the bar and triggers the visible-stop re-render', () => {
    const h = harness();
    h.timer.start('A', 'top', 60);
    h.timer.stop(false);
    expect(h.onVisibleStop).toHaveBeenCalledTimes(1);
  });

  it('the bound Stop button stops non-silently', () => {
    const h = harness();
    h.timer.start('A', 'top', 60);
    h.pressStop();
    expect(h.bar.hide).toHaveBeenCalled();
    expect(h.onVisibleStop).toHaveBeenCalledTimes(1);
  });

  it('dismissFor stops only when the exercise matches', () => {
    const h = harness();
    h.timer.start('Deadlift', 'top', 60);
    h.timer.dismissFor('Bench Press'); // different exercise → no-op
    expect(h.bar.hide).not.toHaveBeenCalled();
    h.timer.dismissFor('Deadlift'); // matches → silent stop
    expect(h.bar.hide).toHaveBeenCalled();
    expect(h.onVisibleStop).not.toHaveBeenCalled(); // silent
  });

  it('is idle (empty activeExercise) before any start', () => {
    const h = harness();
    expect(h.timer.activeExercise).toBe('');
  });
});
