/**
 * Cambridge scheduling (contract section 4): offline sunset, the Sabbath
 * window, the 48-hour redo, the weekly supervision count, persistent
 * cold-attempt timers, and the item Today shows.
 *
 * Everything here runs on the owner's clock in Brooklyn: times are computed as
 * instants (ms) and read in America/New_York, whatever zone the device is in,
 * because the Sabbath and the study week are Brooklyn's.
 *
 * Lazy module: nothing in the main chunk imports it.
 */
import type { CamItem, CamQuestion, CambridgeState } from '@/features/cambridge/types';
import { readCambridge, updateItem } from '@/features/cambridge/store';

const NY = 'America/New_York';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ */
/* America/New_York calendar helpers                                   */
/* ------------------------------------------------------------------ */

let nyFmt: Intl.DateTimeFormat | null = null;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface NyParts { y: number; m: number; d: number; h: number; min: number; wd: number }

/** The Brooklyn wall-clock reading of an instant. `wd` is 0 = Sunday. */
export function nyParts(t: number): NyParts {
  nyFmt ??= new Intl.DateTimeFormat('en-US', {
    timeZone: NY, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const x of nyFmt.formatToParts(new Date(t))) p[x.type] = x.value;
  return {
    y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour! % 24, min: +p.minute!,
    wd: WEEKDAYS.indexOf(p.weekday as (typeof WEEKDAYS)[number]),
  };
}

/** The Brooklyn calendar date of an instant, as YYYY-MM-DD. */
export function nyDate(t: number): string {
  const p = nyParts(t);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** ISO 8601 week of the Brooklyn calendar date, e.g. 2026-W40 (weeks start Monday). */
export function isoWeek(t: number): string {
  const p = nyParts(t);
  const date = Date.UTC(p.y, p.m - 1, p.d);
  const dow = (new Date(date).getUTCDay() + 6) % 7; // Monday 0
  const thursday = date + (3 - dow) * DAY; // the week belongs to the year its Thursday is in
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** "Thu 6 PM" or "Thu 6:30 PM", read in Brooklyn. */
export function fmtDue(t: number): string {
  const p = nyParts(t);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const mm = p.min ? ':' + String(p.min).padStart(2, '0') : '';
  return `${WEEKDAYS[p.wd]} ${h12}${mm} ${p.h < 12 ? 'AM' : 'PM'}`;
}

/* ------------------------------------------------------------------ */
/* Sunset: the NOAA solar-position algorithm                            */
/* ------------------------------------------------------------------ */

// A port of the NOAA Global Monitoring Laboratory solar calculator
// (gml.noaa.gov/grad/solcalc, after Meeus, "Astronomical Algorithms").
// Accurate to about a minute at mid latitudes, which is well inside what a
// Sabbath boundary needs, and it needs no network.

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Julian centuries since J2000.0 for a Julian day. */
const julianCentury = (jd: number): number => (jd - 2451545.0) / 36525.0;

function julianDay(y: number, m: number, d: number): number {
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
}

function geomMeanLongSun(t: number): number {
  const l0 = 280.46646 + t * (36000.76983 + t * 0.0003032);
  return ((l0 % 360) + 360) % 360;
}
const geomMeanAnomalySun = (t: number): number => 357.52911 + t * (35999.05029 - 0.0001537 * t);
const eccentricityEarthOrbit = (t: number): number => 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

function sunEqOfCenter(t: number): number {
  const m = rad(geomMeanAnomalySun(t));
  return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m) * 0.000289;
}

function sunApparentLong(t: number): number {
  const trueLong = geomMeanLongSun(t) + sunEqOfCenter(t);
  const omega = 125.04 - 1934.136 * t;
  return trueLong - 0.00569 - 0.00478 * Math.sin(rad(omega));
}

function obliquityCorrection(t: number): number {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const e0 = 23 + (26 + seconds / 60) / 60;
  const omega = 125.04 - 1934.136 * t;
  return e0 + 0.00256 * Math.cos(rad(omega));
}

function sunDeclination(t: number): number {
  return deg(Math.asin(Math.sin(rad(obliquityCorrection(t))) * Math.sin(rad(sunApparentLong(t)))));
}

/** Equation of time, in minutes. */
function equationOfTime(t: number): number {
  const eps = obliquityCorrection(t);
  const l0 = rad(geomMeanLongSun(t));
  const e = eccentricityEarthOrbit(t);
  const m = rad(geomMeanAnomalySun(t));
  const y = Math.tan(rad(eps) / 2) ** 2;
  const et = y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m);
  return deg(et) * 4;
}

/** Hour angle of sunset in degrees: the sun's centre 0.833 deg below the horizon (refraction + radius). */
function sunsetHourAngle(lat: number, decl: number): number {
  const arg = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
  return deg(Math.acos(Math.max(-1, Math.min(1, arg))));
}

/** Sunset in minutes after 0h UTC of the given Julian day (0h), refined twice at the event time. */
function sunsetUtcMinutes(jd0: number, lat: number, lon: number): number {
  let minutes = 720; // start from noon
  for (let i = 0; i < 3; i++) {
    const t = julianCentury(jd0 + minutes / 1440);
    const ha = sunsetHourAngle(lat, sunDeclination(t));
    minutes = 720 - 4 * (lon - ha) - equationOfTime(t);
  }
  return minutes;
}

/**
 * Sunset on a Brooklyn calendar date, as an instant (read it with `nyParts` or
 * `fmtDue`). `date` is YYYY-MM-DD, or an instant whose Brooklyn date is used.
 * Longitude is east-positive, so Brooklyn's is negative.
 */
export function sunset(date: string | number | Date, lat = 40.6782, lon = -73.9442): Date {
  let y: number, m: number, d: number;
  if (typeof date === 'string') [y, m, d] = date.split('-').map(Number) as [number, number, number];
  else ({ y, m, d } = nyParts(+date));
  const minutes = sunsetUtcMinutes(julianDay(y, m, d), lat, lon);
  // A Brooklyn sunset is after midnight UTC for much of the year, so the
  // minutes can exceed 1440; adding them to the date's 0h UTC handles that.
  return new Date(Date.UTC(y, m - 1, d) + Math.round(minutes * MIN));
}

/* ------------------------------------------------------------------ */
/* Sabbath and the redo deadline                                        */
/* ------------------------------------------------------------------ */

/** Friday sunset to Saturday sunset in Brooklyn (DECISIONS C7). */
export function inSabbath(t: number | Date): boolean {
  const ms = +t;
  const p = nyParts(ms);
  if (p.wd === 5) return ms >= sunset(ms).getTime();
  if (p.wd === 6) return ms < sunset(ms).getTime();
  return false;
}

/** 48 hours; a supervision's redo is due this long after it. */
export const REDO_WINDOW_MS = 48 * HOUR;

/**
 * When a supervision's redo is due: 48 hours later, unless that lands in the
 * Sabbath, in which case Saturday sunset plus one hour.
 */
export function redoDue(supervisedAt: number): number {
  const due = supervisedAt + REDO_WINDOW_MS;
  if (!inSabbath(due)) return due;
  // Friday evening's Sabbath ends at the next day's sunset; Saturday's the same day.
  const saturday = nyParts(due).wd === 5 ? due + DAY : due;
  return sunset(saturday).getTime() + HOUR;
}

/* ------------------------------------------------------------------ */
/* Weekly supervisions                                                 */
/* ------------------------------------------------------------------ */

/** Matches data/cambridge/method.json cadence; kept here so this module needs no data file. */
export const SUPERVISION_TARGET = 2;
export const SUPERVISION_DAYS: readonly string[] = ['Mon', 'Wed'];

const live = (s: CambridgeState): CamItem[] => Object.values(s.items ?? {}).filter((i) => !i.deleted);

export function supervisionsThisWeek(
  state: CambridgeState,
  now: number,
): { held: number; target: number; suggested: string[] } {
  const week = isoWeek(now);
  const held = live(state).filter((i) => i.supervisedAt !== undefined && isoWeek(i.supervisedAt) === week).length;
  return { held, target: SUPERVISION_TARGET, suggested: [...SUPERVISION_DAYS] };
}

/* ------------------------------------------------------------------ */
/* Cold-attempt timers                                                 */
/* ------------------------------------------------------------------ */

// The running start is persisted and the elapsed time is read off the clock,
// so a timer keeps counting through a reload, a closed tab, or offline.

export function elapsedSec(q: CamQuestion, now: number): number {
  const running = q.runningSince !== undefined ? Math.max(0, Math.floor((now - q.runningSince) / 1000)) : 0;
  return Math.max(0, q.coldSec) + running;
}

export function startTimer(q: CamQuestion, now: number): CamQuestion {
  return q.runningSince !== undefined ? q : { ...q, runningSince: now };
}

export function stopTimer(q: CamQuestion, now: number): CamQuestion {
  if (q.runningSince === undefined) return q;
  const { runningSince: _drop, ...rest } = q;
  return { ...rest, coldSec: elapsedSec(q, now) };
}

const blankQ = (q: string): CamQuestion => ({ q, coldSec: 0 });

/** Start a question's cold timer in the store (the item moves to "attempting" if it had not started). */
export function startColdTimer(itemId: string, q: string, now: number = Date.now()): CamQuestion {
  const item = updateItem(itemId, (it) => ({
    ...it,
    stage: it.stage === 'not-started' ? 'attempting' : it.stage,
    questions: { ...it.questions, [q]: startTimer(it.questions[q] ?? blankQ(q), now) },
  }), now);
  return item.questions[q]!;
}

/** Stop a question's cold timer in the store, banking the elapsed seconds. */
export function stopColdTimer(itemId: string, q: string, now: number = Date.now()): CamQuestion {
  const item = updateItem(itemId, (it) => ({
    ...it,
    questions: { ...it.questions, [q]: stopTimer(it.questions[q] ?? blankQ(q), now) },
  }), now);
  return item.questions[q]!;
}

/** A question's cold seconds so far, read from the store. */
export function coldSeconds(itemId: string, q: string, now: number = Date.now()): number {
  const question = readCambridge().items[itemId]?.questions[q];
  return question ? elapsedSec(question, now) : 0;
}

/* ------------------------------------------------------------------ */
/* Phases and the current item                                         */
/* ------------------------------------------------------------------ */

/** 0, A, A+ (alongside B), B, C, D, then Part IA. */
export const PHASE_ORDER: readonly string[] = ['0', 'A', 'A+', 'B', 'C', 'D', 'IA'];

/** The gate each phase waits on. A+ and B both open with A; Part IA opens with B. */
const UNLOCKED_BY: Readonly<Record<string, string>> = { A: '0', 'A+': 'A', B: 'A', C: 'B', D: 'C', IA: 'B' };

export function phaseUnlocked(state: CambridgeState, phase: string): boolean {
  const prev = UNLOCKED_BY[phase];
  // Phase 0 and any phase this table does not know stay open, so a catalog
  // naming change never hides work.
  if (prev === undefined) return true;
  return !!state.gates?.[prev]?.passedAt;
}

/**
 * The fields `currentItem` needs from a step.json or courses.json entry.
 * Injected rather than imported, so this module does not pull the data files
 * into its chunk and tests can pass a small catalog.
 */
export interface CatalogEntry { id: string; title: string; phase: string }

export type LoopStep = 'read' | 'attempt' | 'writeup' | 'supervision' | 'redo';

export interface CurrentItem {
  itemId: string;
  title: string;
  phase: string;
  step: LoopStep;
  /** As Today shows it: "Assignment 7: attempt cold", "Supervision due", "Redo due by Thu 6 PM". */
  label: string;
  /** The redo deadline, for the redo step. */
  due?: number;
}

const redoPending = (i: CamItem): boolean =>
  i.supervisedAt !== undefined && (i.redoQs?.length ?? 0) > 0 && i.redoneAt === undefined && i.stage !== 'redo-done';

const isDone = (i: CamItem | undefined): boolean =>
  !!i && (i.stage === 'redo-done' || (i.stage === 'supervised' && !redoPending(i)));

/**
 * What Today shows, in priority order: a pending redo (it has a deadline), then
 * the first item in progress, then the first untouched item in an unlocked
 * phase. Catalog order is the study order. Null when everything is done.
 */
export function currentItem(
  state: CambridgeState,
  step: readonly CatalogEntry[],
  courses: readonly CatalogEntry[],
  _now: number,
): CurrentItem | null {
  const catalog = [...step, ...courses];
  const items = state.items ?? {};
  const alive = (id: string): CamItem | undefined => (items[id] && !items[id]!.deleted ? items[id] : undefined);

  let redo: { entry: CatalogEntry; due: number } | null = null;
  for (const entry of catalog) {
    const it = alive(entry.id);
    if (!it || !redoPending(it)) continue;
    const due = it.redoDue ?? redoDue(it.supervisedAt!);
    if (!redo || due < redo.due) redo = { entry, due };
  }
  if (redo) {
    const { entry, due } = redo;
    return { itemId: entry.id, title: entry.title, phase: entry.phase, step: 'redo', label: `Redo due by ${fmtDue(due)}`, due };
  }

  for (const entry of catalog) {
    const it = alive(entry.id);
    if (!it || it.stage === 'not-started' || isDone(it)) continue;
    const base = { itemId: entry.id, title: entry.title, phase: entry.phase };
    if (it.stage === 'written-up') return { ...base, step: 'supervision', label: 'Supervision due' };
    const qs = Object.values(it.questions ?? {});
    const attempted = qs.length > 0 && qs.every((q) => q.status !== undefined);
    return attempted
      ? { ...base, step: 'writeup', label: `${entry.title}: write up` }
      : { ...base, step: 'attempt', label: `${entry.title}: attempt cold` };
  }

  for (const entry of catalog) {
    if (!phaseUnlocked(state, entry.phase) || isDone(alive(entry.id))) continue;
    return { itemId: entry.id, title: entry.title, phase: entry.phase, step: 'attempt', label: `${entry.title}: attempt cold` };
  }
  return null;
}
