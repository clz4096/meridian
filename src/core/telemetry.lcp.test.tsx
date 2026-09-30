/**
 * afterLargestPaint: runs once the target element is reported as the largest
 * paint, not on another element's entry; falls back to its timer, and to
 * afterPaint where the browser has no LCP entries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterLargestPaint } from '@/core/telemetry';

type Cb = (list: { getEntries(): PerformanceEntry[] }) => void;
let observers: Array<{ cb: Cb; disconnected: boolean }> = [];

/** A PerformanceObserver that supports LCP and lets the test deliver entries. */
class FakeObserver {
  static supportedEntryTypes = ['largest-contentful-paint'];
  private rec: { cb: Cb; disconnected: boolean };
  constructor(cb: Cb) {
    this.rec = { cb, disconnected: false };
    observers.push(this.rec);
  }
  observe(): void {}
  disconnect(): void {
    this.rec.disconnected = true;
  }
}

function paintOf(el: Element): void {
  const entry = { entryType: 'largest-contentful-paint', startTime: 1, element: el } as unknown as PerformanceEntry;
  for (const o of observers) if (!o.disconnected) o.cb({ getEntries: () => [entry] });
}

beforeEach(() => {
  observers = [];
  vi.useFakeTimers();
  document.body.innerHTML = '<h2 class="td-h2">Today\'s reading</h2><h3 class="td-read-title">Paxos Made Simple</h3>';
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('afterLargestPaint', () => {
  it('waits for the target element, not an earlier paint of another one', () => {
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    const fn = vi.fn();
    afterLargestPaint('.td-read-title', fn);
    paintOf(document.querySelector('.td-h2')!);
    expect(fn).not.toHaveBeenCalled();
    paintOf(document.querySelector('.td-read-title')!);
    expect(fn).toHaveBeenCalledTimes(1);
    // Runs once: a later entry or the timer does not run it again.
    paintOf(document.querySelector('.td-read-title')!);
    vi.advanceTimersByTime(5_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs after the timer when the element never becomes the largest paint', () => {
    vi.stubGlobal('PerformanceObserver', FakeObserver);
    const fn = vi.fn();
    afterLargestPaint('.td-read-title', fn, 1_000);
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it('does not wait for an LCP entry after the first input, which ends LCP reporting', () => {
    class AfterInput extends FakeObserver {
      static override supportedEntryTypes = ['largest-contentful-paint', 'first-input'];
    }
    vi.stubGlobal('PerformanceObserver', AfterInput);
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((t) => (t === 'first-input' ? [{} as PerformanceEntry] : []));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    const fn = vi.fn();
    afterLargestPaint('.td-read-title', fn);
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the next painted frame without LCP entries (Safari)', () => {
    vi.stubGlobal('PerformanceObserver', class { static supportedEntryTypes = ['paint']; });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16));
    const fn = vi.fn();
    afterLargestPaint('.td-read-title', fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
