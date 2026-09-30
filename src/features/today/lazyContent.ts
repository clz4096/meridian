/**
 * Shared plumbing for Today's lazily loaded blocks (reading, path cards).
 *
 * The papers, curriculum and algorithm catalogue live in other chunks (DECISIONS
 * D13), so Today imports them with import() after its first paint. Each block then
 * keeps a copy of what it last showed in localStorage: if a later launch can't load
 * the chunk (offline on a device whose cache was evicted), Today shows that copy
 * with "Saved h:mm a" instead of an error.
 */
import { signal, type Signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { sameLocalDay } from '@/core/util';

export interface LazyMod<M> {
  mod: Signal<M | null>;
  failed: Signal<boolean>;
  load(): Promise<void>;
}

/** A module loaded once per page, shared by every mount of the block that uses it. */
export function lazyMod<M>(importer: () => Promise<M>): LazyMod<M> {
  let inflight: Promise<void> | null = null;
  const v: LazyMod<M> = {
    mod: signal<M | null>(null),
    failed: signal(false),
    load() {
      inflight ??= importer().then(
        (m) => {
          v.mod.value = m;
          v.failed.value = false;
        },
        () => {
          inflight = null;
          v.failed.value = true;
        },
      );
      return inflight;
    },
  };
  return v;
}

/**
 * Recovery for a failed chunk. Chrome keeps a failed module fetch for the life of
 * the page, so calling import() again can't succeed; a reload can (DECISIONS D16).
 * An object so tests can replace it.
 */
export const page = {
  reload(): void {
    window.location.reload();
  },
};

const PREFIX = 'meridian.today.saved.';

export interface Saved<T> {
  at: number;
  value: T;
}

export function readSaved<T>(key: string): Saved<T> | null {
  try {
    const s = localStorage.getItem(PREFIX + key);
    if (!s) return null;
    const v = JSON.parse(s) as Saved<T>;
    return v && typeof v.at === 'number' && v.value !== undefined ? v : null;
  } catch {
    return null;
  }
}

export function writeSaved<T>(key: string, value: T, at: number): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at, value }));
  } catch {
    /* quota or private mode: the offline copy is best effort */
  }
}

/** Save `value` whenever what it shows changes (not on every render). */
export function useSaveOnChange<T>(key: string, value: T | null): void {
  const json = value === null ? '' : JSON.stringify(value);
  useEffect(() => {
    if (json) writeSaved(key, value, Date.now());
    // Keyed on `json`, not `value`: a fresh object each render would write every render.
  }, [key, json]);
}

/** "8:14 AM" in the device's time zone. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon Sep 28". */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${SHORT_DAYS[d.getDay()]} ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/**
 * When something was saved: "8:14 AM" today, "Mon Sep 28, 8:14 AM" otherwise. A bare
 * time on yesterday's copy would read as this morning.
 */
export function savedWhen(at: number, now: number): string {
  return sameLocalDay(at, now) ? clockTime(at) : `${shortDate(at)}, ${clockTime(at)}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** "Tuesday · 29 September". index.html prints the same format before the app loads. */
export function longDate(ms: number): string {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} · ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
