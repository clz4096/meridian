/**
 * progress — pure time-series aggregation for the progress charts.
 *
 * Every store is keyed by ISO date (or a millisecond timestamp), so each metric
 * reduces to: map events to (date, value), bucket the dates into the chosen
 * period, and aggregate each bucket. Levels (bodyweight, calories, mastery%) use
 * an average or a snapshot; counts (volume, tonnage, XP, questions) use a sum;
 * strength uses the best (max) top set. No DOM, no clock — `new Date(ms)` is a
 * pure conversion of a stored timestamp.
 */
import { toId, toNum, tombstoneIds } from '@/core/util';
import { studyStreak } from '@/features/knowledge/knowledgeSelectors';
import type { CoreState, KnowledgeState, MealState, WorkoutState } from '@/core/types';

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const PERIODS: Period[] = ['day', 'week', 'month', 'quarter', 'year'];
export const PERIOD_LABEL: Record<Period, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
};

/** One plotted point: a sortable bucket key, a human axis label, and the value. */
export interface Point {
  key: string;
  label: string;
  value: number;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday of the ISO week containing `date` (UTC-safe), as YYYY-MM-DD. */
function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7; // days since Monday (0=Sun..6=Sat)
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

/** Shift an ISO date by `n` days (UTC-safe), as YYYY-MM-DD. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Sortable bucket key for a date within a period. */
export function bucketKey(date: string, period: Period): string {
  const [y, m] = date.split('-');
  switch (period) {
    case 'day':
      return date;
    case 'week':
      return mondayOf(date);
    case 'month':
      return `${y}-${m}`;
    case 'quarter':
      return `${y}-Q${Math.floor((Number(m) - 1) / 3) + 1}`;
    case 'year':
      return y;
  }
}

/** Short human label for a bucket key on the x-axis — distinct per period. */
export function bucketLabel(key: string, period: Period): string {
  switch (period) {
    case 'day': {
      const [, m, d] = key.split('-');
      return `${MON[Number(m) - 1]} ${Number(d)}`; // e.g. "Jul 15"
    }
    case 'week': {
      // A range makes a week unmistakable next to a single day: "Jul 13–19",
      // or "Jul 27 – Aug 2" across a month boundary.
      const [, sm, sd] = key.split('-');
      const end = addDays(key, 6);
      const [, em, ed] = end.split('-');
      const sMon = MON[Number(sm) - 1];
      const eMon = MON[Number(em) - 1];
      return sm === em ? `${sMon} ${Number(sd)}–${Number(ed)}` : `${sMon} ${Number(sd)} – ${eMon} ${Number(ed)}`;
    }
    case 'month': {
      const [y, m] = key.split('-');
      return `${MON[Number(m) - 1]} '${y.slice(2)}`;
    }
    case 'quarter': {
      const [y, q] = key.split('-');
      return `${q} '${y.slice(2)}`;
    }
    case 'year':
      return key;
  }
}

/** ISO date (UTC) of a stored millisecond timestamp. */
function dateOfMillis(ms: unknown): string {
  return new Date(toNum(ms as any, 0)).toISOString().slice(0, 10);
}

const SUM = (v: number[]): number => v.reduce((a, b) => a + b, 0);
const AVG = (v: number[]): number => (v.length ? SUM(v) / v.length : 0);
const MAX = (v: number[]): number => (v.length ? Math.max(...v) : 0);

/** Bucket (date,value) events by period, then aggregate each bucket, sorted ascending. */
function aggregate(
  events: Array<{ date: string; value: number }>,
  period: Period,
  reduce: (vals: number[]) => number,
): Point[] {
  const buckets = new Map<string, number[]>();
  for (const { date, value } of events) {
    const k = bucketKey(date, period);
    const arr = buckets.get(k);
    if (arr) arr.push(value);
    else buckets.set(k, [value]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, vals]) => ({ key, label: bucketLabel(key, period), value: reduce(vals) }));
}

/* ================= WORKOUT ================= */

/** Average bodyweight per period (daily = each reading). */
export function bodyweightSeries(wk: WorkoutState, period: Period): Point[] {
  const events = Object.entries(wk.bw ?? {})
    .map(([date, w]) => ({ date, value: toNum(w, 0) }))
    .filter((e) => e.value > 0);
  return aggregate(events, period, AVG);
}

/** The bodyweight goal, if set. */
export function bodyweightGoal(wk: WorkoutState): number | null {
  const g = toNum(wk.settings?.bwGoal as any, 0);
  return g > 0 ? g : null;
}

/** Best (max) top-set weight for one exercise per period. */
export function strengthSeries(wk: WorkoutState, exercise: string, period: Period): Point[] {
  const dead = tombstoneIds(wk);
  const events: Array<{ date: string; value: number }> = [];
  for (const [date, sets] of Object.entries(wk.days ?? {})) {
    const tops = (sets ?? [])
      .filter((s) => !dead.has(toId(s.id)) && s.ex === exercise && s.type === 'top')
      .map((s) => toNum(s.weight, 0));
    if (tops.length) events.push({ date, value: Math.max(...tops) });
  }
  return aggregate(events, period, MAX);
}

/** Working sets (top + back) performed per period. */
export function volumeSeries(wk: WorkoutState, period: Period): Point[] {
  const dead = tombstoneIds(wk);
  const events: Array<{ date: string; value: number }> = [];
  for (const [date, sets] of Object.entries(wk.days ?? {})) {
    let n = 0;
    for (const s of sets ?? []) if (!dead.has(toId(s.id)) && (s.type === 'top' || s.type === 'back')) n++;
    if (n) events.push({ date, value: n });
  }
  return aggregate(events, period, SUM);
}

/** Total weight moved (Σ weight × reps over working sets) per period. */
export function tonnageSeries(wk: WorkoutState, period: Period): Point[] {
  const dead = tombstoneIds(wk);
  const events: Array<{ date: string; value: number }> = [];
  for (const [date, sets] of Object.entries(wk.days ?? {})) {
    let t = 0;
    for (const s of sets ?? []) {
      if (dead.has(toId(s.id)) || (s.type !== 'top' && s.type !== 'back')) continue;
      t += toNum(s.weight, 0) * toNum(s.reps, 0);
    }
    if (t) events.push({ date, value: t });
  }
  return aggregate(events, period, SUM);
}

/** Exercises that have at least one logged top set (for the strength lift picker). */
export function trackedLifts(wk: WorkoutState): string[] {
  const dead = tombstoneIds(wk);
  const seen = new Set<string>();
  for (const sets of Object.values(wk.days ?? {})) {
    for (const s of sets ?? []) if (!dead.has(toId(s.id)) && s.type === 'top') seen.add(s.ex);
  }
  return [...seen].sort();
}

/* ================= MEAL ================= */

/** Average daily calories per period (daily = the day's total). */
export function calorieSeries(sg: MealState, period: Period): Point[] {
  const events = Object.entries(sg.days ?? {}).map(([date, meals]) => ({
    date,
    value: (meals ?? []).reduce((a, m) => a + toNum(m.cal, 0), 0),
  }));
  return aggregate(events, period, AVG);
}

/** Average daily protein per period. */
export function proteinSeries(sg: MealState, period: Period): Point[] {
  const events = Object.entries(sg.days ?? {}).map(([date, meals]) => ({
    date,
    value: (meals ?? []).reduce((a, m) => a + toNum(m.protein, 0), 0),
  }));
  return aggregate(events, period, AVG);
}

/** Daily calorie target (maintenance + surplus), if configured. */
export function calorieTarget(sg: MealState): number | null {
  const maint = toNum(sg.settings?.maintenance as any, 0);
  const surplus = toNum(sg.settings?.surplus as any, 0);
  return maint > 0 ? maint + surplus : null;
}

/** Daily protein target, if configured. */
export function proteinTarget(sg: MealState): number | null {
  const p = toNum(sg.settings?.proteinTarget as any, 0);
  return p > 0 ? p : null;
}

/* ================= STUDY ================= */

/** XP earned per period (optionally filtered to one stream). */
export function xpSeries(core: CoreState, period: Period, stream?: string): Point[] {
  const events = (core.entries ?? [])
    .filter((e) => (stream ? e.stream === stream : true))
    .map((e) => ({ date: e.date, value: toNum(e.xp, 0) }));
  return aggregate(events, period, SUM);
}

/** Questions solved (self-rated ≥ 4) per period, from the knowledge log. */
export function questionsSolvedSeries(kg: KnowledgeState, period: Period): Point[] {
  const events = (kg.log ?? [])
    .filter((l) => toNum(l.rating, 0) >= 4)
    .map((l) => ({ date: dateOfMillis(l.at), value: 1 }));
  return aggregate(events, period, SUM);
}

/**
 * Mastery % over time: replaying the log, the share of the *whole curriculum*
 * (`total` questions) at recall ≥ 4 as of the end of each active bucket (a
 * cumulative snapshot). Dividing by attempted-count instead read ~99% after a
 * few well-rated answers; `total` is the honest denominator. Falls back to the
 * attempted count if `total` is unknown (0), preserving the old behaviour.
 */
export function masterySeries(kg: KnowledgeState, period: Period, total = 0): Point[] {
  const log = [...(kg.log ?? [])].sort((a, b) => toNum(a.at, 0) - toNum(b.at, 0));
  const latest = new Map<string, number>();
  const byBucket = new Map<string, number>();
  for (const l of log) {
    latest.set(l.qid, toNum(l.rating, 0));
    const mastered = [...latest.values()].filter((r) => r >= 4).length;
    const denom = total > 0 ? total : latest.size;
    byBucket.set(bucketKey(dateOfMillis(l.at), period), Math.round((100 * mastered) / denom));
  }
  return [...byBucket.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ({ key, label: bucketLabel(key, period), value }));
}

/** Distinct study days per period. */
export function studyDaysSeries(kg: KnowledgeState, period: Period): Point[] {
  const perBucket = new Map<string, Set<string>>();
  for (const l of kg.log ?? []) {
    const d = dateOfMillis(l.at);
    const k = bucketKey(d, period);
    const set = perBucket.get(k);
    if (set) set.add(d);
    else perBucket.set(k, new Set([d]));
  }
  return [...perBucket.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, days]) => ({ key, label: bucketLabel(key, period), value: days.size }));
}

/** Current consecutive-day study streak (a headline stat, not a series). */
export function currentStreak(kg: KnowledgeState, today: string): number {
  return studyStreak(kg, today);
}
