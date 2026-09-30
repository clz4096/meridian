/**
 * The weekly Cambridge scorecard (contract section 3): five lines scored
 * Missed 0 / Partial 1 / Met 2, total 10, for the ISO week in Brooklyn.
 *
 * Auto-computed from the week's records; the owner can override it, which
 * stores the whole card in `weeks[week].scores` (the override then wins).
 *
 * The auto rules, each against the method's cadence of two supervisions a week:
 *  1. cold:          cold attempts of 60+ min paid this week. 2+ Met, 1 Partial.
 *  2. writeup:       of this week's supervisions, how many had the write-up paid
 *                    at or before the supervision. All Met, some Partial. With
 *                    no supervision yet, any write-up this week is Partial.
 *  3. supervisions:  supervisions held this week, capped at 2.
 *  4. redo:          of the redos due by now this week, how many were done by
 *                    their deadline. All Met, some Partial. With none due, Met
 *                    if a supervision was held (nothing was missed), else Missed.
 *  5. pace:          items finished this week (redo done, or supervised with no
 *                    misses) against the phase pace, 2 a week unless given.
 *
 * Lazy module: the main chunk only sees the meter input it produces.
 */
import { CAM_WEEK_ITEMS, type CamItem, type CamWeek, type CamWeekItem, type CambridgeState } from '@/features/cambridge/types';
import { isoWeek, redoDue, supervisionsThisWeek } from '@/features/cambridge/schedule';
import { readCambridge, putWeek } from '@/features/cambridge/store';

type Score = 0 | 1 | 2;

export interface WeekScorecard {
  week: string;
  auto: Record<CamWeekItem, Score>;
  /** What counts: the owner's override when there is one, else `auto`. */
  scores: Record<CamWeekItem, Score>;
  overridden: boolean;
  /** The auto value's reason, shown under each line: "1 of 2 held". */
  why: Record<CamWeekItem, string>;
  total: number;
  /** Any Cambridge activity (or an override) this week. Without it the meters ignore the card. */
  hasData: boolean;
}

export const COLD_TARGET = 2;
export const PACE_TARGET = 2;

const ratio = (good: number, of: number): Score => (of > 0 && good === of ? 2 : good > 0 ? 1 : 0);
const count = (n: number, target: number): Score => (n >= target ? 2 : n > 0 ? 1 : 0);

function finishedAt(i: CamItem): number | undefined {
  if (i.redoneAt !== undefined) return i.redoneAt;
  if (i.supervisedAt !== undefined && !(i.redoQs?.length)) return i.supervisedAt;
  return undefined;
}

export function weekScorecard(
  state: CambridgeState,
  now: number,
  opts: { paceTarget?: number } = {},
): WeekScorecard {
  const week = isoWeek(now);
  const inWeek = (t: number | undefined): boolean => t !== undefined && isoWeek(t) === week;
  const items = Object.values(state.items ?? {}).filter((i) => !i.deleted);
  const awarded = Object.entries(state.awarded ?? {}).filter(([, t]) => inWeek(t));
  const paidThisWeek = (kind: string): number => awarded.filter(([id]) => id.startsWith(`cam:${kind}:`)).length;

  const sups = items.filter((i) => inWeek(i.supervisedAt));
  const held = supervisionsThisWeek(state, now).held;

  const coldPaid = paidThisWeek('coldAttempt');
  const cold = count(coldPaid, COLD_TARGET);

  const writtenFirst = sups.filter((i) => {
    const paid = state.awarded?.[`cam:writeup:${i.id}`];
    return paid !== undefined && paid <= i.supervisedAt!;
  }).length;
  const writeup: Score = sups.length ? ratio(writtenFirst, sups.length) : paidThisWeek('writeup') > 0 ? 1 : 0;

  const dues = items
    .filter((i) => i.supervisedAt !== undefined && (i.redoQs?.length ?? 0) > 0)
    .map((i) => ({ i, due: i.redoDue ?? redoDue(i.supervisedAt!) }))
    .filter(({ i, due }) => inWeek(due) && (due <= now || i.redoneAt !== undefined));
  const onTime = dues.filter(({ i, due }) => i.redoneAt !== undefined && i.redoneAt <= due).length;
  const redo: Score = dues.length ? ratio(onTime, dues.length) : held > 0 ? 2 : 0;

  const paceTarget = opts.paceTarget ?? PACE_TARGET;
  const finished = items.filter((i) => inWeek(finishedAt(i))).length;
  const pace = count(finished, paceTarget);
  const writeups = paidThisWeek('writeup');
  const why: Record<CamWeekItem, string> = {
    cold: `${coldPaid} logged, target ${COLD_TARGET}`,
    writeup: sups.length
      ? `${writtenFirst} of ${sups.length} written up first`
      : `${writeups} ${writeups === 1 ? 'write-up' : 'write-ups'}, no supervision yet`,
    supervisions: `${held} of 2 held`,
    redo: dues.length ? `${onTime} of ${dues.length} on time` : held > 0 ? 'None due yet' : 'No supervision yet',
    pace: `${finished} of ${paceTarget} items finished`,
  };

  const auto: Record<CamWeekItem, Score> = { cold, writeup, supervisions: count(held, 2), redo, pace };
  const override = state.weeks?.[week];
  const scores = override ? { ...auto, ...override.scores } : auto;
  const total = CAM_WEEK_ITEMS.reduce((t, k) => t + scores[k], 0);
  const hasData = !!override || awarded.length > 0 || sups.length > 0 || dues.length > 0
    || items.some((i) => inWeek(i.updatedAt));
  return { week, auto, scores, overridden: !!override, why, total, hasData };
}

/**
 * The input to `meterPct` for the Focus and Progress meters: the week's total
 * as a fraction of 10, or null when the week has no Cambridge data (so the
 * meters read exactly as they did before the Cambridge Method).
 */
export function cambridgeMeterInput(card: WeekScorecard): number | null {
  return card.hasData ? card.total / 10 : null;
}

/**
 * The owner sets one line. The stored card is the whole week as it reads now
 * with that line changed, so the other lines stop moving with later records:
 * an override is the owner signing the week off.
 */
export function overrideWeekScore(item: CamWeekItem, value: Score, now: number = Date.now()): CamWeek {
  const card = weekScorecard(readCambridge(), now);
  return putWeek({ week: card.week, scores: { ...card.scores, [item]: value } }, now);
}
