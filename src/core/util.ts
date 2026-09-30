/**
 * Shared pure primitives — id coercion, safe numeric parsing, tombstone
 * bookkeeping and date math. Extracted from workoutSelectors so the
 * core/meal/data/knowledge modules depend on this small utility instead of
 * reaching into the workout file. No clock, no DOM, no mutable state.
 */
import {
  DEFAULT_CONFIG,
  type EntityId,
  type Numeric,
  type ProgressionConfig,
  type Tombstones,
  type WorkoutState,
} from '@/core/types';

/** Normalise any id to its string form. Legacy rows stored numbers. */
export function toId(value: unknown): EntityId {
  return String(value ?? '') as EntityId;
}

/** Structural id equality that survives the number→string migration. */
export function sameId(a: unknown, b: unknown): boolean {
  return toId(a) === toId(b);
}

/**
 * Parse a numeric field without the silent-zero trap.
 * Returns `fallback` for null/undefined/empty/NaN rather than pretending it is 0.
 */
export function toNum(value: Numeric | null | undefined, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** True when the value cannot be read as a number — lets the UI warn instead of logging 0. */
export function isUnparseableNumber(value: Numeric | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !Number.isFinite(typeof value === 'number' ? value : Number(value));
}

/**
 * Bound tombstone growth by BOTH age and count.
 *
 * The original pruned by age only, and only inside `cloudMerge`, so a device
 * that never synced accumulated deletions forever. Count-capping keeps the
 * payload bounded even if the clock is wrong or the device is offline for
 * months; the newest entries are the ones that still matter for convergence.
 */
export function pruneTombstones(
  tombs: Tombstones | undefined,
  now: number,
  config: ProgressionConfig = DEFAULT_CONFIG,
): Tombstones {
  if (!tombs) return {};
  const maxAge = config.tombstoneMaxAgeDays * 86_400_000;
  const fresh = Object.entries(tombs).filter(([, at]) => {
    const t = toNum(at, 0);
    // Future-dated entries indicate clock skew; keep them rather than drop data.
    return t > now - maxAge;
  });
  fresh.sort((a, b) => toNum(b[1], 0) - toNum(a[1], 0));
  // Object.fromEntries is safe for a '__proto__' key (it uses defineProperty),
  // unlike `out[k] = v` on an object literal, which silently discards it.
  return Object.fromEntries(fresh.slice(0, config.tombstoneMaxCount));
}

/** Ids removed on this device (from any store's `_del` map), as normalised strings. */
export function tombstoneIds(state: Pick<WorkoutState, '_del'>): Set<string> {
  return new Set(Object.keys(state._del ?? {}).map((k) => toId(k)));
}

/** Record a deletion. Returns a new map; never mutates the input. */
export function addTombstone(
  tombs: Tombstones | undefined,
  id: unknown,
  now: number,
): Tombstones {
  return { ...(tombs ?? {}), [toId(id)]: now };
}

/** Shift an ISO date (YYYY-MM-DD) by a number of days, UTC-safe. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map((p) => Number(p));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Days since 1970-01-01 in the LOCAL calendar. Daily and weekly rotations key on this so
 * they turn over at local midnight; a UTC day count flips at 8 pm in New York. Building a
 * UTC timestamp from the local Y/M/D keeps the count stable across DST changes.
 */
export function localEpochDay(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** True when both instants (ms) fall on the same local calendar day. */
export function sameLocalDay(a: number, b: number): boolean {
  return localEpochDay(new Date(a)) === localEpochDay(new Date(b));
}

/**
 * "1,234" for 1234, as toLocaleString('en-US') prints it (up to 3 decimals). Hand
 * rolled on purpose: the first toLocaleString call in a page loads ICU number data,
 * about 18 ms on a laptop and 70 ms on a throttled phone, and Today's first render
 * made that call, so it sat on the startup path.
 */
export function groupThousands(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const [int = '0', frac] = String(Math.abs(Math.round(n * 1000) / 1000)).split('.');
  const sign = n < 0 && (int !== '0' || frac) ? '-' : '';
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
}
