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
  WorkoutSet,
  WorkoutViewModel,
} from './types.js';

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
}

/* ================================================================== */
/* HTML helpers — pure                                                 */
/* ================================================================== */

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

/** Escape text for interpolation into markup. Exercise names are user data. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Escape for use inside a data-* attribute value. */
function attr(value: unknown): string {
  return esc(value);
}

/** Stable DOM-safe id derived from an exercise name. */
export function domId(exercise: string): string {
  return exercise.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
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
function renderPlanRow(
  exercise: string,
  type: SetType,
  label: string,
  set: { weight: number; reps: number },
  index: number,
  state: 'done' | 'current' | 'upcoming',
  cue: string,
  performed?: WorkoutSet,
): string {
  const id = domId(exercise);

  if (state === 'done' && performed) {
    return (
      `<div class="setrow logged-line">` +
      `<span class="setlabel">✓ ${label}</span>` +
      `<span class="setval">${esc(performed.weight)} × ${esc(performed.reps)}</span>` +
      `<span class="rm" data-act="undo-set" data-ex="${attr(exercise)}" style="margin-left:auto;cursor:pointer;color:var(--dim);font-size:16px" title="Undo this set">↩</span></div>`
    );
  }
  if (state === 'upcoming') {
    return (
      `<div class="setrow next-line">` +
      `<span class="setlabel">${label}</span>` +
      `<span class="setval dim">${set.weight} × ${set.reps}</span></div>`
    );
  }

  const wid = `w-${id}-${type}${index}`;
  const rid = `r-${id}-${type}${index}`;
  return (
    `<div class="setrow cur">` +
    `<span class="setlabel cur">▶ ${label}</span>` +
    `<input id="${wid}" type="number" inputmode="decimal" value="${set.weight}" aria-label="${attr(label)} weight">` +
    `<span style="color:var(--dim)">×</span>` +
    `<input id="${rid}" type="number" inputmode="numeric" value="${set.reps}" aria-label="${attr(label)} reps">` +
    `<button class="mbtn primary" data-act="log" data-ex="${attr(exercise)}" data-type="${type}" data-w="${wid}" data-r="${rid}">Log</button>` +
    `</div>` +
    (cue ? `<div class="setcue">${cue}</div>` : '')
  );
}

/** A set that was actually performed — shown when reviewing a past date. */
function renderPerformedRow(date: string, set: WorkoutSet): string {
  const label =
    set.type === 'warm' ? 'Warmup' : set.type === 'top' ? 'Top set' : set.type === 'back' ? 'Back-off' : 'Set';
  return (
    `<div class="setrow done">` +
    `<span style="min-width:70px;color:var(--dim);font-family:var(--mono);font-size:12px">${label}</span>` +
    `<span style="font-family:var(--mono);font-size:15px">${esc(set.weight)} × ${esc(set.reps)}</span>` +
    `<span class="rm" data-act="del-set" data-date="${attr(date)}" data-id="${attr(set.id)}" style="margin-left:auto">×</span>` +
    `</div>`
  );
}

function renderTopCue(plan: ExercisePlan): string {
  if (plan.atMinimum) {
    return ` <span style="color:var(--dim);font-family:var(--mono);font-size:12px">at minimum load</span>`;
  }
  if (plan.bumped) {
    return ` <span style="color:var(--teal);font-family:var(--mono);font-size:12px">↑ +${plan.incr} from ${plan.lastTopWeight}</span>`;
  }
  if (plan.deload) return '';
  return ` <span style="color:var(--dim);font-family:var(--mono);font-size:12px">hold · +${plan.incr} at 8 reps</span>`;
}

function renderExerciseCard(
  vm: WorkoutViewModel,
  o: WorkoutViewOptions,
  exercise: string,
): string {
  const id = domId(exercise);
  const plan = vm.plans[exercise] ?? null;
  const performed = vm.performed[exercise] ?? [];
  const complete = vm.completed[exercise] === true;
  const rest = o.restSeconds[exercise];

  // A finished exercise collapses to one line. Tapping the check reopens it.
  if (complete && !vm.isPast) {
    const top = performed.find((s) => s.type === 'top') ?? performed[performed.length - 1];
    return (
      `<div class="lift exdone collapsed" id="lift-${id}"><div class="lift-h">` +
      `<span class="chk on" data-act="ex-done" data-ex="${attr(exercise)}">✓</span>` +
      `<span class="lift-name">${esc(exercise)}</span>` +
      `<span class="setval dim" style="margin-left:auto">${top ? `${esc(top.weight)} × ${esc(top.reps)}` : ''} · ${performed.length} sets</span>` +
      `</div></div>`
    );
  }

  let html =
    `<div class="lift${complete ? ' exdone' : ''}" id="lift-${id}"><div class="lift-h">` +
    `<span class="chk" data-act="ex-done" data-ex="${attr(exercise)}">${complete ? '✓' : ''}</span>` +
    `<span class="lift-name">${esc(exercise)}${plan?.deload ? ' <span class="cue deload">deload</span>' : ''}</span>` +
    // Secondary controls collapse behind one native disclosure rather than
    // sitting on the card permanently.
    `<details class="exmore"><summary aria-label="More options for ${attr(exercise)}">⋯</summary>` +
    `<div class="exmore-body">` +
    `<a href="${attr(o.videoUrl(exercise))}" target="_blank" rel="noopener" class="mbtn">▶ How to</a>` +
    (plan && !plan.cardio
      ? `<button class="mbtn" data-act="deload" data-ex="${attr(exercise)}">${plan.deload ? '✓ Rebuilding' : 'Feel weak today'}</button>` +
        `<button class="mbtn" data-act="incr" data-ex="${attr(exercise)}">Stack step: ${o.increments[exercise] ?? plan.incr} lb</button>` +
        (rest ? `<div class="note">rest · warm ${rest.warm}s · top ${rest.top}s · back-off ${rest.back}s</div>` : '')
      : '') +
    `</div></details></div>`;

  if (plan?.lastDate && !vm.isPast) {
    html += `<div class="lastline">last ${plan.lastTopWeight}×${plan.lastTopReps} · ${plan.lastDate.slice(5)}</div>`;
  }

  if (vm.isPast && performed.length > 0) {
    html += performed.map((s) => renderPerformedRow(vm.date, s)).join('');
  } else if (!plan) {
    html += `<div class="empty" style="margin-top:6px">First time — log your sets below.</div>`;
  } else if (plan.cardio) {
    html += renderPlanRow(exercise, 'cardio', 'Cardio', plan.top, 0, performed.length === 0 ? 'current' : 'done', '', performed[0]);
  } else {
    const next = performed.length;
    const rows: Array<[SetType, string, { weight: number; reps: number }]> = [
      ...plan.warms.map((w): [SetType, string, { weight: number; reps: number }] => ['warm', 'Warmup', w]),
      ['top', 'Top set', plan.top],
      ...plan.backs.map((b): [SetType, string, { weight: number; reps: number }] => ['back', 'Back-off', b]),
    ];
    rows.forEach(([type, label, set], i) => {
      const state = i < next ? 'done' : i === next ? 'current' : 'upcoming';
      const cue = type === 'top' && state === 'current' ? renderTopCue(plan) : '';
      html += renderPlanRow(exercise, type, label, set, i, state, cue, performed[i]);
    });
  }
  return html + `</div>`;
}

/**
 * The whole tab, as a string. Pure: same view model in, same markup out.
 * This is the only function that knows what the workout tab looks like.
 */
export function renderWorkoutHTML(vm: WorkoutViewModel, o: WorkoutViewOptions): string {
  let html = renderBodyweight(o) + renderDateNav(vm, o) + renderSplitPanel(vm) + renderSessionSummary(vm);
  if (vm.isPast && vm.exercises.length === 0) {
    html += `<div class="placeholder">No workout logged on ${esc(o.dateLabel(vm.date))}.</div>`;
  }
  html += vm.exercises.map((ex) => renderExerciseCard(vm, o, ex)).join('');
  return html;
}

/* ================================================================== */
/* DOM binding — delegation + focus-preserving repaint                 */
/* ================================================================== */

/** Minimal DOM surface, so the controller can be tested without a browser. */
export interface ViewHost {
  container: {
    innerHTML: string;
    addEventListener(type: string, handler: (e: Event) => void): void;
    querySelector(sel: string): { value?: string } | null;
  };
  getActiveElementId(): string | null;
  getSelectionStart(): number | null;
  restoreFocus(id: string, caret: number | null): void;
  getScrollY(): number;
  setScrollY(y: number): void;
  /** Values the user typed but has not logged, keyed by input id. */
  captureInputValues(): Record<string, string>;
  restoreInputValues(values: Record<string, string>): void;
}

interface DelegatedTarget {
  dataset: Record<string, string | undefined>;
}

/**
 * Owns the workout tab's DOM.
 *
 * Handlers are attached once in the constructor and never rebound. `repaint`
 * swaps `innerHTML` wholesale — safe because delegation survives the swap and
 * focus/caret/scroll/uncommitted-input state is preserved around it.
 */
export class WorkoutViewController {
  private lastHTML = '';

  constructor(
    private readonly host: ViewHost,
    private readonly actions: WorkoutActions,
    private readonly readInput: (id: string) => number,
  ) {
    // One listener for clicks, for the lifetime of the app.
    this.host.container.addEventListener('click', (e) => this.onClick(e));
  }

  private onClick(e: Event): void {
    const target = (e.target as unknown as DelegatedTarget | null);
    if (!target?.dataset) return;
    const act = target.dataset.act;
    if (!act) return;
    const ex = target.dataset.ex ?? '';

    switch (act) {
      case 'log': {
        const type = (target.dataset.type ?? 'top') as SetType;
        this.actions.logSet(ex, type, this.readInput(target.dataset.w ?? ''), this.readInput(target.dataset.r ?? ''));
        this.actions.startRest(ex, type);
        break;
      }
      case 'rest':
        this.actions.startRest(ex, (target.dataset.type ?? 'top') as SetType);
        break;
      case 'undo-set':
        this.actions.undoLastSet(ex);
        break;
      case 'del-set':
        this.actions.deleteSet(target.dataset.date ?? '', target.dataset.id ?? '');
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
        this.actions.changeSplit((target.dataset.split ?? 'all') as Split | 'all');
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
      default:
        break;
    }
  }

  /**
   * Repaint from a view model.
   *
   * Skips the DOM write entirely when the markup is unchanged, which is what
   * makes a full repaint cheaper than the old surgical `patchLift` path.
   */
  repaint(vm: WorkoutViewModel, options: WorkoutViewOptions): boolean {
    const html = renderWorkoutHTML(vm, options);
    if (html === this.lastHTML) return false;

    const focusId = this.host.getActiveElementId();
    const caret = this.host.getSelectionStart();
    const scroll = this.host.getScrollY();
    const typed = this.host.captureInputValues();

    this.host.container.innerHTML = html;
    this.lastHTML = html;

    this.host.restoreInputValues(typed);
    if (focusId) this.host.restoreFocus(focusId, caret);
    this.host.setScrollY(scroll);
    return true;
  }
}

export type { IsoDate };
