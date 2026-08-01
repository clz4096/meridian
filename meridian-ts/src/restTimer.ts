/**
 * Rest-timer state machine.
 *
 * A self-contained countdown between sets: it owns the interval handle, the
 * start time, which exercise/set it is counting for, and the target seconds,
 * and drives the {@link RestBarHost} (the fixed bar outside every tab pane).
 *
 * Clock and scheduler are injected so the machine is unit-testable without real
 * time — the browser passes `Date.now`/`window.setInterval`; tests pass fakes.
 */

import type { RestBarHost } from './appHost.js';

export interface RestTimerHooks {
  bar: RestBarHost;
  /** Injected clock — `Date.now` in the browser, a fake in tests. */
  now(): number;
  /** Injected scheduler — `window.setInterval` in the browser. */
  setInterval(fn: () => void, ms: number): number;
  clearInterval(handle: number): void;
  /** Called when the timer stops *non-silently* (user pressed Done) so the workout can re-render. */
  onVisibleStop?(): void;
}

export class RestTimer {
  private handle: number | null = null;
  private startedAt = 0;
  /** "exercise|type", or '' when idle. */
  private forKey = '';
  private targetSec = 0;

  constructor(private readonly h: RestTimerHooks) {
    // The bar's Stop ("Done") button belongs to the timer; bound once.
    h.bar.onStop(() => this.stop(false));
  }

  /** Which exercise the timer is currently counting for, or '' when idle. */
  get activeExercise(): string {
    return this.forKey ? this.forKey.split('|')[0] : '';
  }

  /** Start (or restart) the countdown for one set, targeting `targetSec`. */
  start(exercise: string, type: string, targetSec: number): void {
    this.forKey = exercise + '|' + type;
    this.startedAt = this.h.now();
    this.targetSec = targetSec;
    if (this.handle !== null) this.h.clearInterval(this.handle);
    this.handle = this.h.setInterval(() => this.paint(), 250);
    this.paint();
  }

  /** Stop the countdown and hide the bar. `silent` skips the workout re-render. */
  stop(silent: boolean): void {
    if (this.handle !== null) this.h.clearInterval(this.handle);
    this.handle = null;
    this.forKey = '';
    this.h.bar.hide();
    if (!silent) this.h.onVisibleStop?.();
  }

  /** Cancel the timer if it belongs to `exercise` — that set just got marked done. */
  dismissFor(exercise: string): void {
    if (this.forKey && this.forKey.split('|')[0] === exercise) this.stop(true);
  }

  private paint(): void {
    const elapsed = Math.floor((this.h.now() - this.startedAt) / 1000);
    const over = elapsed >= this.targetSec;
    this.h.bar.paint(this.activeExercise, elapsed, this.targetSec, over);
  }
}
