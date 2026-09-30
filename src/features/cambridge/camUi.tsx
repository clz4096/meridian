/**
 * Pieces the Cambridge path and study-item screens share: the ready gate, the
 * per-block error guard, the "Saved h:mm" note, and Brooklyn time formatting.
 */
import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { bump, currentTab } from '@/ui/store';
import { FLUSH_EVENT, reloadInto } from '@/ui/reopen';
import { handleHide } from '@/app/bootstrap';
import { nyParts } from '@/features/cambridge/schedule';
import type { CambridgeState } from '@/features/cambridge/types';

/** Every Cambridge write goes through here, so views reading dataRev re-render. */
export function write<T>(fn: () => T): T {
  const out = fn();
  bump();
  return out;
}

/** How long a screen waits for the store before it shows its error state. */
export const READY_TIMEOUT_MS = 8000;

/**
 * Whether the store has loaded (and, on a first run, the Massey backup is
 * taken). Screens render their skeleton until then and never write before it.
 *
 * A store that has not loaded after READY_TIMEOUT_MS (a stuck IndexedDB open,
 * say) reports 'failed', so the screen offers a retry instead of a skeleton
 * forever. If it does load later, the screen recovers on its own.
 */
export function useReady(ready: Promise<void>, timeoutMs: number = READY_TIMEOUT_MS): 'loading' | 'ready' | 'failed' {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => live && setState((s) => (s === 'loading' ? 'failed' : s)), timeoutMs);
    ready.then(
      () => {
        window.clearTimeout(timer);
        if (live) setState('ready');
      },
      () => {
        window.clearTimeout(timer);
        if (live) setState('failed');
      },
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [ready, timeoutMs]);
  return state;
}

/**
 * "Try again" for a load failure: a fresh page, landing back on this screen.
 * A second import() of a failed chunk, or a second wait on the same stuck
 * promise, would fail the same way (DECISIONS D16).
 */
export const retryScreen = (): void => reloadInto(currentTab.peek());

/**
 * A field showing a stored value that can change underneath it while it is
 * open: a sync pull brings another device's newer write.
 *
 * The field tracks whether the owner has edited it since it last matched the
 * store (`dirty`). Until they do, a store change is adopted, so the field shows
 * the newer text and nothing stale is ever written back. Once they have typed,
 * their text stays: it is a real conflict, and the owner's visible edit wins
 * when it is saved.
 *
 * `key` identifies the stored value, so arrays compare by content.
 */
export function useAdopting<T>(saved: T, key: string = String(saved)): {
  value: T;
  edit: (v: T) => void;
  dirty: { current: boolean };
} {
  const [value, setValue] = useState(saved);
  const dirty = useRef(false);
  const latest = useRef(saved);
  latest.current = saved;
  useEffect(() => {
    if (!dirty.current) setValue(latest.current);
  }, [key]);
  const edit = (v: T): void => {
    dirty.current = true;
    setValue(v);
  };
  return { value, edit, dirty };
}

/**
 * A text field that saves itself: `commit` runs 500 ms after the last
 * keystroke, and when the screen closes, the page hides, or a reload is about
 * to start, so leaving never drops an edit.
 *
 * It commits only what the owner typed. A field nobody touched never writes on
 * close, so it cannot put back an older copy over a newer one another device
 * synced in while the screen was open.
 */
export function useAutosave(saved: string, commit: (v: string) => void, delayMs = 500): [string, (v: string) => void] {
  const { value, edit, dirty } = useAdopting(saved);
  const latest = useRef({ value, saved, commit });
  latest.current = { value, saved, commit };
  const flush = useRef((): boolean => {
    if (!dirty.current) return false;
    dirty.current = false;
    const l = latest.current;
    if (l.value === l.saved) return false;
    l.commit(l.value);
    return true;
  }).current;
  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(flush, delayMs);
    return () => window.clearTimeout(t);
  }, [value]);
  useEffect(() => {
    // The app saves the stores on hide before this listener runs, so an edit
    // committed here is saved again straight after.
    const onHide = (): void => {
      if (flush()) handleHide();
    };
    const onVisibility = (): void => {
      if (document.hidden) onHide();
    };
    window.addEventListener('pagehide', onHide);
    window.addEventListener(FLUSH_EVENT, onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener(FLUSH_EVENT, onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);
  return [value, edit];
}

/** Re-render every `ms` while `on`. The timer and the hints countdown read the clock this way. */
export function useTick(ms: number, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, on]);
  return on ? now : Date.now();
}

/**
 * Keeps a failure in one block from blanking the screen: the rest still works,
 * and this block offers a retry.
 */
export function Guard({ what, children }: { what: string; children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary();
  if (error)
    return (
      <div class="m-state" data-kind="error" role="alert">
        <p class="m-state-title">{what} didn't load.</p>
        <p class="m-state-body">{error instanceof Error ? error.message : String(error)}</p>
        <button class="m-btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "9:14 PM", read in Brooklyn (the owner's clock, wherever the device is). */
export function hm(ms: number): string {
  const p = nyParts(ms);
  return `${p.h % 12 || 12}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
}

/** "Thu 2 Oct", read in Brooklyn. */
export function dayMonth(ms: number): string {
  const p = nyParts(ms);
  return `${DAYS[p.wd]} ${p.d} ${MONTHS[p.m - 1]}`;
}

/** "14 Sep", read in Brooklyn. */
export const shortDay = (ms: number): string => {
  const p = nyParts(ms);
  return `${p.d} ${MONTHS[p.m - 1]}`;
};

/** mm:ss, then h:mm:ss past 99:59. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const two = (n: number): string => String(n).padStart(2, '0');
  if (s > 99 * 60 + 59) return `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  return `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

/** The last local Cambridge write: the newest record stamp. */
export function lastSaved(s: CambridgeState): number {
  let t = 0;
  for (const group of [s.items, s.errors, s.gates, s.weeks] as Record<string, { updatedAt?: number }>[]) {
    for (const r of Object.values(group ?? {})) t = Math.max(t, r.updatedAt ?? 0);
  }
  return t;
}

export const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A section head's right-hand note. Offline, it says so and when the work was
 * last saved on this device; the content below still renders from local state.
 */
export function Note({ state, children }: { state: CambridgeState; children?: ComponentChildren }) {
  if (isOffline()) {
    const at = lastSaved(state);
    return (
      <span class="m-state m-num" data-kind="offline">
        Offline{at ? ` · Saved ${hm(at)}` : ''}
      </span>
    );
  }
  return children == null ? null : <span class="m-label m-num">{children}</span>;
}
