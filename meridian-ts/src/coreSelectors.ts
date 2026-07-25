/**
 * Meridian — pure Today / Study selectors.
 *
 * The last derivation still living in the legacy layer: the day's schedule,
 * XP aggregation, and the at-a-glance chips. As everywhere else, `today` is a
 * parameter and nothing here touches the DOM.
 */

import type { CoreState, LogEntry, ScheduleItem } from './types.js';
import { shiftDate, toId, toNum } from './workoutSelectors.js';

export interface ScheduleBlock extends ScheduleItem {
  /** true when `nowMinutes` falls inside [start, end) */
  current: boolean;
  startMinutes: number | null;
  endMinutes: number | null;
}

export interface StreamTotals {
  stream: string;
  xp: number;
  count: number;
  solved: number;
  attempted: number;
}

export interface TodayViewModel {
  date: string;
  isToday: boolean;
  schedule: ScheduleBlock[];
  currentBlock: ScheduleBlock | null;
  nextBlock: ScheduleBlock | null;
  completedBlocks: number;
  totalBlocks: number;
  xpToday: number;
  solvedToday: number;
  attemptedToday: number;
  streams: StreamTotals[];
  streakDays: number;
}

/** "14:30" -> 870. Returns null for anything unparseable. */
export function parseClock(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function scheduleFor(state: CoreState, date: string): ScheduleItem[] {
  const dead = new Set(Object.keys(state._del ?? {}).map((k) => toId(k)));
  return (state.schedule?.[date] ?? []).filter((b) => b && !dead.has(toId(b.id)));
}

/**
 * Annotate each block with its clock range and whether it is the current one.
 * Blocks without a parseable start are kept but can never be "current".
 */
export function scheduleBlocks(
  state: CoreState,
  date: string,
  nowMinutes: number | null,
): ScheduleBlock[] {
  return scheduleFor(state, date)
    .map((b) => {
      const startMinutes = parseClock(b.start);
      const endMinutes = parseClock(b.end);
      const current =
        nowMinutes !== null &&
        startMinutes !== null &&
        nowMinutes >= startMinutes &&
        (endMinutes === null ? nowMinutes < startMinutes + 60 : nowMinutes < endMinutes);
      return { ...b, startMinutes, endMinutes, current };
    })
    .sort((a, b) => (a.startMinutes ?? 1e9) - (b.startMinutes ?? 1e9));
}

export function entriesOn(state: CoreState, date: string): LogEntry[] {
  const dead = new Set(Object.keys(state._del ?? {}).map((k) => toId(k)));
  return (state.entries ?? []).filter((e) => e && e.date === date && !dead.has(toId(e.id)));
}

/** XP and solved/attempted counts per stream for one day. */
export function streamTotals(state: CoreState, date: string): StreamTotals[] {
  const map = new Map<string, StreamTotals>();
  for (const e of entriesOn(state, date)) {
    const stream = String(e.stream ?? 'other');
    const row = map.get(stream) ?? { stream, xp: 0, count: 0, solved: 0, attempted: 0 };
    row.xp += toNum(e.xp, 0);
    row.count += 1;
    const status = String((e as { status?: string }).status ?? '');
    if (status === 'solved') row.solved += 1;
    else if (status === 'attempted') row.attempted += 1;
    map.set(stream, row);
  }
  return [...map.values()].sort((a, b) => b.xp - a.xp);
}

/** Consecutive days ending at `today` with at least one entry. */
export function entryStreak(state: CoreState, today: string, maxLookback = 400): number {
  const dates = new Set((state.entries ?? []).map((e) => String(e.date ?? '')));
  let streak = 0;
  for (let i = 0; i < maxLookback; i++) {
    if (!dates.has(shiftDate(today, -i))) break;
    streak++;
  }
  return streak;
}

export function selectTodayView(
  state: CoreState,
  date: string,
  today: string,
  nowMinutes: number | null,
): TodayViewModel {
  const blocks = scheduleBlocks(state, date, date === today ? nowMinutes : null);
  const streams = streamTotals(state, date);
  const currentIdx = blocks.findIndex((b) => b.current);
  const nextIdx = blocks.findIndex(
    (b) => nowMinutes !== null && b.startMinutes !== null && b.startMinutes > nowMinutes,
  );
  return {
    date,
    isToday: date === today,
    schedule: blocks,
    currentBlock: currentIdx >= 0 ? blocks[currentIdx]! : null,
    nextBlock: nextIdx >= 0 ? blocks[nextIdx]! : null,
    completedBlocks: blocks.filter((b) => b.done).length,
    totalBlocks: blocks.length,
    xpToday: streams.reduce((a, s) => a + s.xp, 0),
    solvedToday: streams.reduce((a, s) => a + s.solved, 0),
    attemptedToday: streams.reduce((a, s) => a + s.attempted, 0),
    streams,
    streakDays: entryStreak(state, today),
  };
}
