/**
 * Meridian — workout view layer.
 *
 * The final strangler-fig step. This file contains *no* data derivation: it
 * receives a `WorkoutViewModel` produced by `selectWorkoutView` and turns it
 * into markup. Every number it prints was computed and property-tested in the
 * pure layer.
 *
 * Two structural changes replace the old god function:
 *
 *  1. **Event delegation.** One listener per event type lives on the container
 *     for the lifetime of the app. Repainting no longer rebinds anything, so
 *     handlers cannot go stale and `patchLift` is unnecessary.
 *
 *  2. **Focus-preserving repaint.** `applyView` captures focus, caret position,
 *     scroll offset and any uncommitted input values before swapping markup,
 *     then restores them — so a full repaint is invisible to the user.
 */

import type {
  ExercisePlan,
  IsoDate,
  SetType,
  Split,
  WorkoutViewModel,
} from './types.js';
import { esc, domId } from './html.js';
import { BaseViewController, type ViewHost } from './viewHost.js';

/* ================================================================== */
/* Ports — everything the view needs from the outside world           */
/* ================================================================== */

/** Commands the view can emit. The host wires these to state mutations. */
export interface WorkoutActions {
  logSet(exercise: string, type: SetType, weight: number, reps: number): void;
  deleteSet(date: string, setId: string): void;
  toggleExerciseDone(exercise: string): void;
  toggleSessionDone(): void;
  toggleDeload(exercise: string): void;
  editIncrement(exercise: string): void;
  startRest(exercise: string, type: SetType): void;
  undoLastSet(exercise: string): void;
  changeDate(date: string): void;
  changeSplit(split: Split | 'all'): void;
  logBodyweight(value: number): void;
  /** Progress-chart controls (optional — present once charts are wired). */
  setChartPeriod?(period: string): void;
  setChartLift?(exercise: string): void;
  setChartScale?(scale: string): void;
  /** Expand/collapse the logging section below the charts. */
  toggleLog?(): void;
  /** Expand/collapse one exercise dropdown in the detail screen. */
  toggleExercise?(exercise: string): void;
}

/** Presentation-only inputs that are not part of persisted state. */
export interface WorkoutViewOptions {
  /** Rest prescription per set type, precomputed by the pure layer. */
  restSeconds: Record<string, { warm: number; top: number; back: number }>;
  /** Increment per exercise, precomputed by the pure layer. */
  increments: Record<string, number>;
  /** Form-technique links. */
  videoUrl(exercise: string): string;
  /** Current bodyweight and goal, already derived. */
  bodyweight: { current: number | null; goal: number | null; toGoal: number | null };
  /** Human-readable date label, e.g. "Today · Fri, Jul 25". */
  dateLabel(date: string): string;
  /** Which split is highlighted as suggested. */
  isToday: boolean;
  /** Pre-rendered progress-charts block (+ the collapse toggle), shown above the workout. */
  charts?: string;
  /** Whether the logging section below the charts is expanded. */
  logOpen?: boolean;
  /** Exercises whose dropdown state is flipped from the default (open, or closed-when-done). */
  collapsed?: string[];
}

/* ================================================================== */
/* HTML helpers — pure                                                 */
/* ================================================================== */

/** Escape for use inside a data-* attribute value. */
function attr(value: unknown): string {
  return esc(value);
}

/* ================================================================== */
/* Pure renderers — WorkoutViewModel -> HTML string                    */
/* ================================================================== */

function renderBodyweight(o: WorkoutViewOptions): string {
  const { current, goal, toGoal } = o.bodyweight;
  const pct =
    current !== null && goal !== null && goal !== current
      ? Math.max(0, Math.min(100, Math.round((current / goal) * 100)))
      : 0;
  return (
    `<div class="panel"><p class="panel-t">Bodyweight</p>` +
    `<div class="mrow" style="justify-content:space-between">` +
    `<div><span style="font-family:var(--mono);font-size:24px">${current ?? '—'}</span>` +
    `<span style="color:var(--dim)"> lb${goal !== null ? ` → ${goal}` : ''}</span></div>` +
    `<div class="mrow"><input id="bw-in" type="number" placeholder="today" style="width:90px">` +
    `<button class="mbtn" data-act="log-bw">Log</button></div></div>` +
    (goal !== null && current !== null
      ? `<div class="bar" style="margin-top:10px"><div style="width:${pct}%"></div></div>` +
        `<div style="font-family:var(--mono);font-size:12px;color:var(--dim);margin-top:4px">${toGoal ?? '—'} lb to goal</div>`
      : '') +
    `</div>`
  );
}

function renderDateNav(vm: WorkoutViewModel, o: WorkoutViewOptions): string {
  return (
    `<div class="panel"><div class="mrow" style="justify-content:space-between">` +
    `<p class="panel-t" style="margin:0">Session</p><div class="mrow">` +
    `<button class="mbtn" data-act="date-prev">‹</button>` +
    `<span style="font-family:var(--mono);font-size:12px;min-width:150px;text-align:center">${esc(o.dateLabel(vm.date))}</span>` +
    `<button class="mbtn" data-act="date-next">›</button>` +
    (o.isToday ? '' : `<button class="mbtn" data-act="date-today">→ Today</button>`) +
    `</div></div></div>`
  );
}

function renderSplitPanel(vm: WorkoutViewModel): string {
  const s = vm.suggestion;
  const note = s.logged
    ? `You logged ${s.last} work on this date.`
    : s.lastDate
      ? `Last session was ${s.last} on ${s.lastDate.slice(5)} — alternate to ${s.due}.`
      : 'No history yet — start with upper.';
  const options: Array<[Split | 'all', string]> = [
    ['all', 'All'], ['lower', 'Lower'], ['upper', 'Upper'],
  ];
  return (
    `<div class="panel"><div class="mrow" style="justify-content:space-between">` +
    `<p class="panel-t" style="margin:0">Today’s split</p>` +
    `<span class="mchip" style="background:var(--tealSoft);color:var(--teal)">${s.due === 'lower' ? 'LOWER day' : 'UPPER day'}</span></div>` +
    `<div class="note" style="margin:6px 0 8px">${esc(note)} Cardio is shown every day.</div>` +
    `<div class="timebar">` +
    options
      .map(
        ([value, label]) =>
          `<button class="${vm.split === value ? 'on' : ''}" data-act="split" data-split="${attr(value)}">${label}${value === s.due ? ' ★' : ''}</button>`,
      )
      .join('') +
    `</div></div>`
  );
}

function renderSessionSummary(vm: WorkoutViewModel): string {
  const done = vm.exercises.filter((e) => vm.completed[e]).length;
  const pct = vm.exercises.length ? Math.round((100 * done) / vm.exercises.length) : 0;
  return (
    `<div class="panel"${vm.sessionComplete ? ' style="border-color:var(--ok)"' : ''}>` +
    `<div class="mrow" style="justify-content:space-between"><div>` +
    `<div style="font-family:var(--mono);font-size:20px">${vm.sessionComplete ? '✓ Session complete' : `${done} / ${vm.exercises.length} done`}</div>` +
    `<div class="note">~${vm.estimate.minutes} min · ${vm.estimate.workingSets} working sets planned</div></div>` +
    `<button class="mbtn${vm.sessionComplete ? '' : ' primary'}" data-act="session-done">${vm.sessionComplete ? 'Reopen' : 'Mark complete'}</button>` +
    `</div><div class="bar" style="margin-top:8px"><div style="width:${pct}%;background:var(--ok)"></div></div></div>`
  );
}

/**
 * A prescribed set.
 *
 * Only the set you are about to do gets inputs and a Log button. Finished sets
 * collapse to a single line, upcoming sets to a target preview. This is the
 * main lever against clutter: the old layout put two inputs and two buttons on
 * every row, so a six-exercise session rendered over a hundred tap targets.
 */
const CHEV_SVG =
  '<svg class="ex-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const CHECK_SVG =
  '<svg class="ex-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>';

/** Progression cue on the top set (bump / hold / at-minimum). */
function topCue(plan: ExercisePlan): string {
  if (plan.atMinimum) return `<span class="rx-cue muted">at minimum load</span>`;
  if (plan.bumped) return `<span class="rx-cue">↑ +${plan.incr} from ${plan.lastTopWeight}</span>`;
  if (plan.deload) return '';
  return `<span class="rx-cue muted">hold · +${plan.incr} at 8 reps</span>`;
}

function setTypeLabel(type: SetType): string {
  return type === 'warm' ? 'Warmup' : type === 'top' ? 'Top set' : type === 'back' ? 'Back-off' : 'Set';
}

/** The primary action: the prescription + big lb/reps fields + full-size Log button. */
function logInput(
  exercise: string,
  type: SetType,
  label: string,
  set: { weight: number; reps: number },
  index: number,
  cue: string,
  setNo: number,
  setTotal: number,
): string {
  const id = domId(exercise);
  const wid = `w-${id}-${type}${index}`;
  const rid = `r-${id}-${type}${index}`;
  return (
    `<div class="rx"><span class="rx-what">${esc(label)}${setTotal > 1 ? ` · set ${setNo} of ${setTotal}` : ''}</span>${cue}</div>` +
    `<div class="logrow">` +
    `<div class="field"><input class="fv" id="${wid}" type="number" inputmode="decimal" value="${set.weight}" aria-label="${attr(label)} weight (lb)"><div class="k">lb</div></div>` +
    `<span class="times" aria-hidden="true">×</span>` +
    `<div class="field"><input class="fv" id="${rid}" type="number" inputmode="numeric" value="${set.reps}" aria-label="${attr(label)} reps"><div class="k">reps</div></div>` +
    `<button class="logbtn" data-act="log" data-ex="${attr(exercise)}" data-type="${type}" data-w="${wid}" data-r="${rid}">Log set</button>` +
    `</div>`
  );
}

/** One line in the session checklist: done ✓ / now ● / upcoming ·. */
function setLine(state: 'done' | 'now' | 'up', label: string, val: string, trailing = ''): string {
  const mark = state === 'done' ? '✓' : state === 'now' ? '●' : '·';
  return (
    `<div class="set ${state}">` +
    `<span class="st" aria-hidden="true">${mark}</span><span class="nm">${esc(label)}</span><span class="vl">${val}</span>${trailing}` +
    `</div>`
  );
}

function renderExerciseCard(vm: WorkoutViewModel, o: WorkoutViewOptions, exercise: string): string {
  const id = domId(exercise);
  const plan = vm.plans[exercise] ?? null;
  const performed = vm.performed[exercise] ?? [];
  const complete = vm.completed[exercise] === true;
  const rest = o.restSeconds[exercise];
  // Every exercise is collapsed by default (calm screen); `o.collapsed` lists the expanded ones.
  const collapsed = !(o.collapsed?.includes(exercise) ?? false);

  // ---- collapsed row: name + a single status, one tap target, no checkbox ----
  const top = performed.find((s) => s.type === 'top') ?? performed[performed.length - 1];
  let sv = 'new';
  let sl = '';
  if (performed.length && top) {
    sv = `${esc(top.weight)} × ${esc(top.reps)}`;
    sl = complete ? 'done' : `${performed.length} set${performed.length > 1 ? 's' : ''}`;
  } else if (plan && !plan.cardio) {
    sv = `${plan.top.weight} × ${plan.top.reps}`;
    sl = 'top set';
  } else if (plan?.lastDate) {
    sv = `${plan.lastTopWeight} × ${plan.lastTopReps}`;
    sl = 'last';
  }

  const header =
    `<div class="ex${complete ? ' done' : ''}${collapsed ? '' : ' open'}" id="lift-${id}">` +
    `<button class="ex-top" data-act="ex-toggle" data-ex="${attr(exercise)}">` +
    (complete ? CHECK_SVG : '') +
    `<span class="ex-name">${esc(exercise)}${plan?.deload ? ' <span class="cue deload">deload</span>' : ''}</span>` +
    `<span class="ex-status">${sv}${sl ? `<span class="lbl">${sl}</span>` : ''}</span>` +
    CHEV_SVG +
    `</button>`;

  if (collapsed) return header + `</div>`;

  // ---- expanded: action first, then the session checklist, then quiet secondaries ----
  let b = `<div class="ex-body"><div class="ex-inner">`;

  if (vm.isPast && performed.length > 0) {
    b +=
      `<div class="sets">` +
      performed
        .map((s) =>
          setLine('done', setTypeLabel(s.type), `${esc(s.weight)} × ${esc(s.reps)}`, `<span class="undo" data-act="del-set" data-date="${attr(vm.date)}" data-id="${attr(s.id)}" title="Remove">×</span>`),
        )
        .join('') +
      `</div>`;
  } else if (!plan) {
    b += `<div class="rx"><span class="rx-what">First time — log your sets</span></div>` + logInput(exercise, 'top', 'Set', { weight: 0, reps: 0 }, 0, '', 1, 1);
  } else if (plan.cardio) {
    if (performed.length === 0) b += logInput(exercise, 'cardio', 'Cardio', plan.top, 0, '', 1, 1);
    else b += `<div class="sets">` + setLine('done', 'Cardio', `${esc(performed[0].weight)} × ${esc(performed[0].reps)}`) + `</div>`;
  } else {
    const rows: Array<[SetType, string, { weight: number; reps: number }]> = [
      ...plan.warms.map((w): [SetType, string, { weight: number; reps: number }] => ['warm', 'Warmup', w]),
      ['top', 'Top set', plan.top],
      ...plan.backs.map((bk): [SetType, string, { weight: number; reps: number }] => ['back', 'Back-off', bk]),
    ];
    const next = performed.length;
    const cur = rows[next];
    if (cur) b += logInput(exercise, cur[0], cur[1], cur[2], next, cur[0] === 'top' ? topCue(plan) : '', next + 1, rows.length);
    else b += `<div class="rx"><span class="rx-what all-done">✓ All sets logged</span></div>`;
    b +=
      `<div class="sets">` +
      rows
        .map(([, label, set], i) => {
          const state = i < next ? 'done' : i === next ? 'now' : 'up';
          const val = state === 'done' && performed[i] ? `${esc(performed[i].weight)} × ${esc(performed[i].reps)}` : `${set.weight} × ${set.reps}`;
          const undo = state === 'done' && i === next - 1 ? `<span class="undo" data-act="undo-set" data-ex="${attr(exercise)}" title="Undo">↩</span>` : '';
          return setLine(state, label, val, undo);
        })
        .join('') +
      `</div>`;
  }

  // secondary actions — one quiet line at the bottom
  b +=
    `<div class="more">` +
    `<a href="${attr(o.videoUrl(exercise))}" target="_blank" rel="noopener">▶ How&nbsp;to</a>` +
    (plan && !plan.cardio
      ? `<button type="button" data-act="deload" data-ex="${attr(exercise)}">${plan.deload ? '✓ Rebuilding' : 'Feel weak'}</button>` +
        `<button type="button" data-act="incr" data-ex="${attr(exercise)}">Stack&nbsp;step · ${o.increments[exercise] ?? plan.incr} lb</button>` +
        (rest ? `<span class="more-rest">rest ${rest.warm}/${rest.top}/${rest.back}s</span>` : '')
      : '') +
    `<button type="button" data-act="ex-done" data-ex="${attr(exercise)}" class="more-done">${complete ? 'Reopen' : 'Mark done'}</button>` +
    `</div>`;

  return header + b + `</div></div></div>`;
}

/**
 * The whole tab, as a string. Pure: same view model in, same markup out.
 * This is the only function that knows what the workout tab looks like.
 */
export function renderWorkoutHTML(vm: WorkoutViewModel, o: WorkoutViewOptions): string {
  // One screen: the charts carousel, then today's session inline (collapsed exercises).
  // Bodyweight / date / split / mark-complete tuck behind the ⚙ (o.logOpen === extras open).
  const done = vm.exercises.filter((e) => vm.completed[e]).length;
  const status = vm.sessionComplete ? '✓ complete' : `${done} / ${vm.exercises.length} logged`;
  const exhead =
    `<div class="exhead"><span class="exhead-t">Today’s session</span>` +
    `<span class="exhead-r"><span class="exhead-m">${status}</span>` +
    `<button class="ex-opts${o.logOpen ? ' on' : ''}" data-act="toggle-log" aria-label="Session options">⚙</button></span></div>`;
  const extras = o.logOpen
    ? `<div class="wk-extras">${renderBodyweight(o)}${renderDateNav(vm, o)}${renderSplitPanel(vm)}${renderSessionSummary(vm)}</div>`
    : '';
  let list = '';
  if (vm.isPast && vm.exercises.length === 0) {
    list += `<div class="placeholder">No workout logged on ${esc(o.dateLabel(vm.date))}.</div>`;
  }
  list += vm.exercises.map((ex) => renderExerciseCard(vm, o, ex)).join('');
  return (o.charts ?? '') + extras + exhead + list;
}

/* ================================================================== */
/* DOM binding — delegation + focus-preserving repaint                 */
/* ================================================================== */

/**
 * Owns the workout tab's DOM.
 *
 * Handlers are attached once in the constructor and never rebound. `repaint`
 * swaps `innerHTML` wholesale — safe because delegation survives the swap and
 * focus/caret/scroll/uncommitted-input state is preserved around it.
 */
export class WorkoutViewController extends BaseViewController {
  constructor(
    host: ViewHost,
    private readonly actions: WorkoutActions,
    private readonly readInput: (id: string) => number,
  ) {
    super(host);
  }

  protected onAction(act: string, ds: Record<string, string>): void {
    const ex = ds.ex ?? '';
    switch (act) {
      case 'log': {
        const type = (ds.type ?? 'top') as SetType;
        this.actions.logSet(ex, type, this.readInput(ds.w ?? ''), this.readInput(ds.r ?? ''));
        this.actions.startRest(ex, type);
        break;
      }
      case 'rest':
        this.actions.startRest(ex, (ds.type ?? 'top') as SetType);
        break;
      case 'undo-set':
        this.actions.undoLastSet(ex);
        break;
      case 'del-set':
        this.actions.deleteSet(ds.date ?? '', ds.id ?? '');
        break;
      case 'ex-done':
        this.actions.toggleExerciseDone(ex);
        break;
      case 'session-done':
        this.actions.toggleSessionDone();
        break;
      case 'deload':
        this.actions.toggleDeload(ex);
        break;
      case 'incr':
        this.actions.editIncrement(ex);
        break;
      case 'split':
        this.actions.changeSplit((ds.split ?? 'all') as Split | 'all');
        break;
      case 'date-prev':
        this.actions.changeDate('prev');
        break;
      case 'date-next':
        this.actions.changeDate('next');
        break;
      case 'date-today':
        this.actions.changeDate('today');
        break;
      case 'log-bw':
        this.actions.logBodyweight(this.readInput('bw-in'));
        break;
      case 'chart-period':
        this.actions.setChartPeriod?.(ds.period ?? 'week');
        break;
      case 'chart-lift':
        this.actions.setChartLift?.(ds.lift ?? '');
        break;
      case 'chart-scale':
        this.actions.setChartScale?.(ds.scale ?? 'lin');
        break;
      case 'toggle-log':
        this.actions.toggleLog?.();
        break;
      case 'ex-toggle':
        this.actions.toggleExercise?.(ex);
        break;
      default:
        break;
    }
  }

  repaint(vm: WorkoutViewModel, options: WorkoutViewOptions): boolean {
    return this.paint(renderWorkoutHTML(vm, options));
  }
}

export type { IsoDate };
