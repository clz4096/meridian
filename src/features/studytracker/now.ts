/**
 * Live "now" clock for the Study Tracker schedule. A coarse signal ticks every
 * ~45s so the view can highlight the block whose time window contains the
 * current Eastern-Time wall clock. All comparisons are done in
 * America/New_York (the schedule is authored in ET) via `Intl`, so the
 * highlight is correct regardless of the device's local zone.
 */
import { signal } from '@preact/signals';
import type { Block } from '@/features/studytracker/trackerStore';

/** Bumped every tick; read it to subscribe a component to the clock. */
export const nowTick = signal(Date.now());

let handle: ReturnType<typeof setInterval> | null = null;
let refs = 0;

/**
 * Start the ~45s clock (ref-counted; safe to call from every mount). Returns a
 * disposer that stops the interval once the last subscriber unmounts.
 */
export function startNowClock(): () => void {
  refs++;
  nowTick.value = Date.now();
  if (handle === null) {
    handle = setInterval(() => { nowTick.value = Date.now(); }, 45_000);
  }
  return () => {
    refs--;
    if (refs <= 0 && handle !== null) {
      clearInterval(handle);
      handle = null;
      refs = 0;
    }
  };
}

/** Minutes since midnight, on the America/New_York wall clock, for `d`. */
export function nowMinutesET(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value);
    else if (p.type === 'minute') m = Number(p.value);
  }
  if (h === 24) h = 0; // some engines emit "24" for midnight under hour12:false
  return h * 60 + m;
}

/** Parse a "h:MM AM/PM" label into minutes since midnight, or NaN if malformed. */
export function parseLabelMinutes(label: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!m) return NaN;
  let h = Number(m[1]) % 12; // 12 AM -> 0, 12 PM -> 12 (after the +12 below)
  if (/PM/i.test(m[3]!)) h += 12;
  return h * 60 + Number(m[2]);
}

/**
 * The id of the schedule block whose window [its time, next block's time)
 * contains the current ET wall clock, or null. Returns null before the first
 * block's time and once past the last block's start (the final block has no
 * successor to bound its window, per the contract), so an idle early-morning or
 * post-lights-out clock highlights nothing.
 */
export function currentBlockId(schedule: readonly Block[], now: Date = new Date()): string | null {
  const mins = nowMinutesET(now);
  const times = schedule.map((b) => parseLabelMinutes(b.time));
  for (let i = 0; i < schedule.length - 1; i++) {
    const start = times[i]!;
    const end = times[i + 1]!;
    if (Number.isFinite(start) && Number.isFinite(end) && mins >= start && mins < end) {
      return schedule[i]!.id;
    }
  }
  return null;
}
