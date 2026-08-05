/**
 * Workout tab — one screen: the Progress charts carousel, then today's session
 * inline (collapsed exercise cards). Bodyweight / date / split / mark-complete
 * tuck behind the ⚙. Ports workoutCharts (app.ts) + renderWorkoutHTML to JSX.
 */
import { useEffect } from 'preact/hooks';
import { selectWorkoutView, restSeconds, inferIncrement, splitOfDate } from '@/features/workout/workoutSelectors';
import type { WorkoutViewOptions } from '@/features/workout/types';
import { bodyweightGoal, trackedLifts, bodyweightSeries, strengthSeries, volumeSeries, tonnageSeries } from '@/ui/charts/progress';
import { DEFAULT_CONFIG, type SetType, type ExercisePlan, type Split, type WorkoutState } from '@/core/types';
import { shiftDate } from '@/core/util';
import { domId } from '@/ui/html';
import { ProgControls, Carousel, Chart, LiftPicker } from '@/ui/components/Charts';
import { wk, currentBW, exVideo, workoutActions, discard, loadWorkout, goHome } from '@/ui/actions';
import { wkLoaded, wkDate, wkSplit, wkSplitTouched, wkDeload, wkExtrasOpen, wkShowAll, wkProgOpen, activeExercise, progPeriod, progLift, dataRev } from '@/ui/store';
import { dstr, dateLabel } from '@/app/bootstrap';
import { host } from '@/ui/host';

/* ── plate calculator (barbell lifts only) ── */
const BAR_LB: Record<string, number> = { 'Bench Press': 45 };
const PLATES = [45, 35, 25, 10, 5, 2.5];
interface PlateSpec {
  weight: number; // the target total
  bar: number;
  perSide: number;
  plates: number[]; // one side, largest first
  empty: boolean; // weight == bar → no plates, just the bar
  loadable: boolean; // decomposes cleanly on the available plates
}
/** Plates to load on EACH side for a target total, or null if not a barbell lift. */
function platesFor(exercise: string, weight: number): PlateSpec | null {
  const bar = BAR_LB[exercise];
  if (bar == null || !(weight > 0)) return null;
  if (weight <= bar) return { weight, bar, perSide: 0, plates: [], empty: true, loadable: true };
  let rem = (weight - bar) / 2;
  const perSide = rem;
  const plates: number[] = [];
  for (const p of PLATES) {
    while (rem >= p - 1e-9) {
      rem -= p;
      plates.push(p);
    }
  }
  return { weight, bar, perSide, plates, empty: false, loadable: rem <= 1e-6 };
}

/** A loaded barbell (plates mirrored on both ends). `mini` renders a small silhouette for card faces. */
function Barbell({ spec, mini }: { spec: PlateSpec; mini?: boolean }) {
  const left = [...spec.plates].reverse(); // small → large toward the bar
  return (
    <div class={'barbell' + (mini ? ' mini' : '')} aria-hidden="true">
      <div class="bb-side">
        {left.map((w) => (
          <span class="plate" data-w={String(w)}>
            {w}
          </span>
        ))}
      </div>
      <div class="bb-bar" />
      <div class="bb-side">
        {spec.plates.map((w) => (
          <span class="plate" data-w={String(w)}>
            {w}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The centered plate diagram + label shown inside an open exercise card. */
function PlateBar({ spec }: { spec: PlateSpec }) {
  if (!spec.loadable) return null;
  return (
    <div class="platebox">
      <Barbell spec={spec} />
      <span class="platelbl">
        <b>{spec.weight}</b> lb · {spec.empty ? 'just the bar' : `${spec.perSide} per side`}
      </span>
    </div>
  );
}

/* ── "Your week" strip — mirrors what was actually trained, today highlighted ── */
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function WeekStrip({ state, today, suggestion }: { state: WorkoutState; today: string; suggestion: Split }) {
  const dow = (new Date(today + 'T00:00:00').getDay() + 6) % 7; // 0 = Mon
  const monday = shiftDate(today, -dow);
  return (
    <div class="wkweek">
      {DOW.map((label, i) => {
        const date = shiftDate(monday, i);
        const isToday = date === today;
        const done = splitOfDate(state, date, DEFAULT_CONFIG); // 'lower' | 'upper' | null
        const split = done ?? (isToday ? suggestion : null);
        const cls = split === 'upper' ? ' up' : split === 'lower' ? ' lo' : '';
        return (
          <div class={'wkday' + cls + (isToday ? ' today' : '')}>
            <span class="wkday-l">{label}</span>
            <span class="wkday-dot" />
          </div>
        );
      })}
    </div>
  );
}

type Any = any;
type VM = ReturnType<typeof selectWorkoutView>;

/* ── options (ported from entry.ts buildOptions) ── */
function uniqueExercises(state: Any): string[] {
  const seen = new Set<string>();
  for (const sets of Object.values(state.days ?? {}) as Any[]) for (const s of sets) seen.add(s.ex);
  return [...seen];
}
function buildOptions(state: Any, date: string, today: string, bw: { current: number | null; goal: number | null }): WorkoutViewOptions {
  const rest: WorkoutViewOptions['restSeconds'] = {};
  const increments: Record<string, number> = {};
  for (const ex of Object.keys(state.days ?? {}).length ? uniqueExercises(state) : []) {
    rest[ex] = { warm: restSeconds(state, ex, 'warm', DEFAULT_CONFIG), top: restSeconds(state, ex, 'top', DEFAULT_CONFIG), back: restSeconds(state, ex, 'back', DEFAULT_CONFIG) };
    increments[ex] = inferIncrement(state, ex, DEFAULT_CONFIG);
  }
  const toGoal = bw.current !== null && bw.goal !== null ? Math.round((bw.goal - bw.current) * 10) / 10 : null;
  return { restSeconds: rest, increments, videoUrl: exVideo, bodyweight: { ...bw, toGoal }, dateLabel, isToday: date === today };
}

/* ── Progress charts (collapsed by default, below the session) ── */
function WorkoutCharts() {
  const W = wk();
  const period = progPeriod.value;
  const lifts = trackedLifts(W);
  useEffect(() => {
    if (lifts.length && !lifts.includes(progLift.value)) progLift.value = lifts[0]!;
  }, [lifts.join('|')]);
  const lift = lifts.includes(progLift.value) ? progLift.value : lifts[0] ?? '';
  const goal = bodyweightGoal(W);
  return (
    <div class="prog">
      <ProgControls />
      <Carousel keepKey="workout">
        <Chart opts={{ kind: 'line', title: 'Body growth', points: bodyweightSeries(W, period), unit: 'lb', format: (v) => v.toFixed(1), reference: goal != null ? { value: goal, label: `goal ${goal}` } : null, color: 'var(--fuel)' }} />
        {lift ? (
          <div>
            <LiftPicker lifts={lifts} />
            <Chart opts={{ kind: 'line', title: 'Strength', points: strengthSeries(W, lift, period), unit: 'lb', color: 'var(--teal)' }} />
          </div>
        ) : null}
        <Chart opts={{ kind: 'bar', title: 'Volume · working sets', points: volumeSeries(W, period), summary: 'sum', color: 'var(--fuel)' }} />
        <Chart opts={{ kind: 'bar', title: 'Tonnage', points: tonnageSeries(W, period), unit: 'lb', summary: 'sum', color: 'var(--teal)' }} />
      </Carousel>
    </div>
  );
}

/* ── session extras (behind the ⚙) ── */
function Extras({ vm, o }: { vm: VM; o: WorkoutViewOptions }) {
  const s = vm.suggestion;
  const { current, goal, toGoal } = o.bodyweight;
  const bwPct = current !== null && goal !== null && goal !== current ? Math.max(0, Math.min(100, Math.round((current / goal) * 100))) : 0;
  const done = vm.exercises.filter((e) => vm.completed[e]).length;
  const pct = vm.exercises.length ? Math.round((100 * done) / vm.exercises.length) : 0;
  const note = s.logged ? `You logged ${s.last} work on this date.` : s.lastDate ? `Last session was ${s.last} on ${s.lastDate.slice(5)} — alternate to ${s.due}.` : 'No history yet — start with upper.';
  const splits: Array<['all' | 'lower' | 'upper', string]> = [['all', 'All'], ['lower', 'Lower'], ['upper', 'Upper']];
  return (
    <div class="wk-extras">
      {/* bodyweight */}
      <div class="panel">
        <p class="panel-t">Bodyweight</p>
        <div class="mrow" style="justify-content:space-between">
          <div>
            <span style="font-family:var(--mono);font-size:24px">{current ?? '—'}</span>
            <span style="color:var(--dim)"> lb{goal !== null ? ` → ${goal}` : ''}</span>
          </div>
          <div class="mrow">
            <input id="bw-in" type="number" placeholder="today" style="width:90px" />
            <button class="mbtn" onClick={() => workoutActions.logBodyweight(Number(host.readValue('bw-in')) || 0)}>Log</button>
          </div>
        </div>
        {goal !== null && current !== null && (
          <>
            <div class="bar" style="margin-top:10px"><div style={`width:${bwPct}%`} /></div>
            <div style="font-family:var(--mono);font-size:12px;color:var(--dim);margin-top:4px">{toGoal ?? '—'} lb to goal</div>
          </>
        )}
      </div>
      {/* date */}
      <div class="panel">
        <div class="mrow" style="justify-content:space-between">
          <p class="panel-t" style="margin:0">Session</p>
          <div class="mrow">
            <button class="mbtn" onClick={() => workoutActions.changeDate('prev')}>‹</button>
            <span style="font-family:var(--mono);font-size:12px;min-width:150px;text-align:center">{o.dateLabel(vm.date)}</span>
            <button class="mbtn" onClick={() => workoutActions.changeDate('next')}>›</button>
            {!o.isToday && <button class="mbtn" onClick={() => workoutActions.changeDate('today')}>→ Today</button>}
          </div>
        </div>
      </div>
      {/* split */}
      <div class="panel">
        <div class="mrow" style="justify-content:space-between">
          <p class="panel-t" style="margin:0">Today’s split</p>
          <span class="mchip" style="background:var(--tealSoft);color:var(--teal)">{s.due === 'lower' ? 'LOWER day' : 'UPPER day'}</span>
        </div>
        <div class="note" style="margin:6px 0 8px">{note} Cardio is shown every day.</div>
        <div class="timebar">
          {splits.map(([value, label]) => (
            <button class={vm.split === value ? 'on' : ''} onClick={() => workoutActions.changeSplit(value)}>
              {label}{value === s.due ? ' ★' : ''}
            </button>
          ))}
        </div>
      </div>
      {/* summary */}
      <div class="panel" style={vm.sessionComplete ? 'border-color:var(--ok)' : undefined}>
        <div class="mrow" style="justify-content:space-between">
          <div>
            <div style="font-family:var(--mono);font-size:20px">{vm.sessionComplete ? '✓ Session complete' : `${done} / ${vm.exercises.length} done`}</div>
            <div class="note">~{vm.estimate.minutes} min · {vm.estimate.workingSets} working sets planned</div>
          </div>
          <button class={'mbtn wk-complete' + (vm.sessionComplete ? ' on' : '')} onClick={() => workoutActions.toggleSessionDone()}>
            {vm.sessionComplete ? 'Reopen' : 'Mark complete'}
          </button>
        </div>
        <div class="bar" style="margin-top:8px"><div style={`width:${pct}%;background:var(--ok)`} /></div>
      </div>
      <button class="mbtn wk-discard" onClick={discard}>↺ Discard unsaved changes</button>
    </div>
  );
}

/* ── set rows ── */
function topCue(plan: ExercisePlan): preact.JSX.Element | null {
  if (plan.atMinimum) return <span class="rx-cue muted">at minimum load</span>;
  if (plan.bumped) return <span class="rx-cue">↑ +{plan.incr} from {plan.lastTopWeight}</span>;
  if (plan.deload) return null;
  return <span class="rx-cue muted">hold · +{plan.incr} at 8 reps</span>;
}
const setTypeLabel = (type: SetType): string => (type === 'warm' ? 'Warmup' : type === 'top' ? 'Top set' : type === 'back' ? 'Back-off' : 'Set');

function LogInput({ exercise, type, label, set, index, cue, setNo, setTotal }: { exercise: string; type: SetType; label: string; set: { weight: number; reps: number }; index: number; cue?: preact.JSX.Element | null; setNo: number; setTotal: number }) {
  const id = domId(exercise);
  const wid = `w-${id}-${type}${index}`;
  const rid = `r-${id}-${type}${index}`;
  return (
    <>
      <div class="rx">
        <span class="rx-what">{label}{setTotal > 1 ? ` · set ${setNo} of ${setTotal}` : ''}</span>
        {cue}
      </div>
      <div class="logrow">
        <div class="field">
          <input class="fv" key={wid} id={wid} type="number" inputmode="decimal" defaultValue={String(set.weight)} aria-label={`${label} weight (lb)`} />
          <div class="k">lb</div>
        </div>
        <span class="times" aria-hidden="true">×</span>
        <div class="field">
          <input class="fv" key={rid} id={rid} type="number" inputmode="numeric" defaultValue={String(set.reps)} aria-label={`${label} reps`} />
          <div class="k">reps</div>
        </div>
        <button class="logbtn" onClick={() => workoutActions.logSet(exercise, type, Number(host.readValue(wid)) || 0, Number(host.readValue(rid)) || 0)}>
          Log set
        </button>
      </div>
    </>
  );
}

function SetLine({ state, label, val, trailing }: { state: 'done' | 'now' | 'up'; label: string; val: string; trailing?: preact.JSX.Element | null }) {
  const mark = state === 'done' ? '✓' : state === 'now' ? '●' : '·';
  return (
    <div class={'set ' + state}>
      <span class="st" aria-hidden="true">{mark}</span>
      <span class="nm">{label}</span>
      <span class="vl">{val}</span>
      {trailing}
    </div>
  );
}

/** A tappable exercise card in the list/grid. Tapping opens the full-screen detail. */
function ExerciseCardFace({ vm, exercise }: { vm: VM; exercise: string }) {
  const plan: Any = vm.plans[exercise] ?? null;
  const performed: Any[] = vm.performed[exercise] ?? [];
  const complete = vm.completed[exercise] === true;

  const top = performed.find((s) => s.type === 'top') ?? performed[performed.length - 1];
  let sv = 'new';
  let sl = '';
  if (performed.length && top) {
    sv = `${top.weight} × ${top.reps}`;
    sl = complete ? 'done' : `${performed.length} set${performed.length > 1 ? 's' : ''}`;
  } else if (plan && !plan.cardio) {
    sv = `${plan.top.weight} × ${plan.top.reps}`;
    sl = 'top set';
  } else if (plan?.lastDate) {
    sv = `${plan.lastTopWeight} × ${plan.lastTopReps}`;
    sl = 'last';
  }
  const setCount = plan && !plan.cardio ? plan.warms.length + 1 + plan.backs.length : null;
  const showCount = !!plan && !plan.cardio && performed.length === 0;
  const topSpec = plan && !plan.cardio ? platesFor(exercise, plan.top.weight) : null;

  return (
    <div class={'ex' + (complete ? ' done' : '')}>
      <button class="ex-top" onClick={() => (activeExercise.value = exercise)}>
        {complete && (
          <svg class="ex-check" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">
            <path d="M5 12l4 4 10-10" />
          </svg>
        )}
        <div class="excard-main">
          <div class="excard-name">
            {exercise}
            {plan?.deload ? <> <span class="cue deload">deload</span></> : null}
          </div>
          <div class="excard-meta">
            <span class="excard-v">{sv}</span>
            {showCount ? <span class="excard-tag">· {setCount} sets</span> : sl ? <span class="excard-tag">· {sl}</span> : null}
          </div>
        </div>
        {topSpec?.loadable ? <Barbell spec={topSpec} mini /> : null}
        <svg class="ex-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

/** The full-screen logging view for one exercise, with a back link and a switcher to the others. */
function ExerciseDetail({ vm, o, exercise, exercises }: { vm: VM; o: WorkoutViewOptions; exercise: string; exercises: string[] }) {
  const plan: Any = vm.plans[exercise] ?? null;
  const performed: Any[] = vm.performed[exercise] ?? [];
  const complete = vm.completed[exercise] === true;
  const rest = o.restSeconds[exercise];
  // Plate glyph follows the *current* set being logged (warmup vs top), not the top set.
  const setWeights: number[] =
    plan && !plan.cardio
      ? [...(plan.warms ?? []).map((w: Any) => w.weight), plan.top.weight, ...(plan.backs ?? []).map((b: Any) => b.weight)]
      : [];
  const curWeight = setWeights[performed.length] ?? plan?.top?.weight ?? 0;
  const ph = platesFor(exercise, curWeight);

  let body: preact.JSX.Element;
  if (vm.isPast && performed.length > 0) {
    body = (
      <div class="sets">
        {performed.map((s) => (
          <SetLine
            state="done"
            label={setTypeLabel(s.type)}
            val={`${s.weight} × ${s.reps}`}
            trailing={
              <button class="setundo" onClick={() => workoutActions.deleteSet(vm.date, s.id)}>
                ✕ Remove
              </button>
            }
          />
        ))}
      </div>
    );
  } else if (!plan) {
    body = (
      <>
        <div class="rx"><span class="rx-what">First time — log your sets</span></div>
        <LogInput exercise={exercise} type="top" label="Set" set={{ weight: 0, reps: 0 }} index={0} setNo={1} setTotal={1} />
      </>
    );
  } else if (plan.cardio) {
    body =
      performed.length === 0 ? (
        <LogInput exercise={exercise} type="cardio" label="Cardio" set={plan.top} index={0} setNo={1} setTotal={1} />
      ) : (
        <div class="sets"><SetLine state="done" label="Cardio" val={`${performed[0].weight} × ${performed[0].reps}`} /></div>
      );
  } else {
    const rows: Array<[SetType, string, { weight: number; reps: number }]> = [
      ...plan.warms.map((w: Any): [SetType, string, { weight: number; reps: number }] => ['warm', 'Warmup', w]),
      ['top', 'Top set', plan.top],
      ...plan.backs.map((bk: Any): [SetType, string, { weight: number; reps: number }] => ['back', 'Back-off', bk]),
    ];
    const next = performed.length;
    const cur = rows[next];
    body = (
      <>
        {cur ? (
          <LogInput exercise={exercise} type={cur[0]} label={cur[1]} set={cur[2]} index={next} cue={cur[0] === 'top' ? topCue(plan) : null} setNo={next + 1} setTotal={rows.length} />
        ) : (
          <div class="rx"><span class="rx-what all-done">✓ All sets logged</span></div>
        )}
        <div class="sets">
          {rows.map(([, label, set], i) => {
            const state = i < next ? 'done' : i === next ? 'now' : 'up';
            const val = state === 'done' && performed[i] ? `${performed[i].weight} × ${performed[i].reps}` : `${set.weight} × ${set.reps}`;
            const undo =
              state === 'done' && i === next - 1 ? (
                <button class="setundo" onClick={() => workoutActions.undoLastSet(exercise)}>
                  ↩ Undo
                </button>
              ) : null;
            return <SetLine state={state} label={label} val={val} trailing={undo} />;
          })}
        </div>
      </>
    );
  }

  const idx = exercises.indexOf(exercise);
  const next = idx >= 0 && idx < exercises.length - 1 ? exercises[idx + 1] : null;
  return (
    <div class="exdetail" key={exercise}>
      <div class="exdetail-top">
        <button class="backbtn" onClick={() => (activeExercise.value = null)}>
          ‹ Exercises
        </button>
        {next ? (
          <button class="exnext" onClick={() => (activeExercise.value = next)}>
            Next · {next} ›
          </button>
        ) : (
          <button class="exnext" onClick={() => (activeExercise.value = null)}>
            Done ✓
          </button>
        )}
      </div>
      <div class="exdetail-body">
        <h2 class="exdetail-name">
          {exercise}
          {plan?.deload ? <> <span class="cue deload">deload</span></> : null}
        </h2>
        {ph && <PlateBar spec={ph} />}
        {body}
        <div class="more">
        <a href={o.videoUrl(exercise)} target="_blank" rel="noopener">▶ How&nbsp;to</a>
        {plan && !plan.cardio && (
          <>
            <button type="button" onClick={() => workoutActions.toggleDeload(exercise)}>{plan.deload ? '✓ Rebuilding' : 'Feel weak'}</button>
            <button type="button" onClick={() => workoutActions.editIncrement(exercise)}>Stack&nbsp;step · {o.increments[exercise] ?? plan.incr} lb</button>
            {rest && <span class="more-rest">rest {rest.warm}/{rest.top}/{rest.back}s</span>}
          </>
        )}
        <button type="button" class="more-done" onClick={() => workoutActions.toggleExerciseDone(exercise)}>{complete ? 'Reopen' : 'Mark done'}</button>
        </div>
      </div>
    </div>
  );
}

export function WorkoutView() {
  useEffect(() => {
    if (!wkLoaded.value) void loadWorkout();
  }, []);
  dataRev.value;
  if (!wkLoaded.value) return <div class="empty">Loading…</div>;
  const W = wk();
  const today = dstr();
  const date = wkDate.value ?? today;
  const vm = selectWorkoutView(W, date, today, { deload: wkDeload.value, split: wkSplitTouched.value ? wkSplit.value : undefined }, DEFAULT_CONFIG);
  const o = buildOptions(W, date, today, { current: currentBW() as number | null, goal: +W.settings.bwGoal || null });
  const showAll = wkShowAll.value;
  // "Show all" re-derives the full list; otherwise the cards follow today's split.
  const cardVm = showAll ? selectWorkoutView(W, date, today, { deload: wkDeload.value, split: 'all' }, DEFAULT_CONFIG) : vm;
  const done = vm.exercises.filter((e) => vm.completed[e]).length;
  const status = vm.sessionComplete ? '✓ complete' : `${done} / ${vm.exercises.length} logged`;
  const splitLabel = vm.split === 'upper' ? 'Upper' : vm.split === 'lower' ? 'Lower' : vm.split === 'all' ? 'Full body' : 'Session';
  const progOpen = wkProgOpen.value;

  // Master–detail: an active exercise takes over the whole screen.
  const active = activeExercise.value;
  if (active && cardVm.exercises.includes(active)) {
    return <ExerciseDetail vm={cardVm} o={o} exercise={active} exercises={cardVm.exercises} />;
  }
  return (
    <>
      <button class="backbtn" onClick={goHome}>
        ‹ Back
      </button>

      <WeekStrip state={W} today={today} suggestion={vm.suggestion.due} />

      <div class="todayhd">
        <div class="todayhd-split">{vm.isPast ? o.dateLabel(vm.date) : `${splitLabel} day`}</div>
        <span class="exhead-r">
          <span class="exhead-m">{status}</span>
          <button class={'ex-opts' + (wkExtrasOpen.value ? ' on' : '')} onClick={() => workoutActions.toggleLog?.()} aria-label="Session options">⚙</button>
        </span>
      </div>
      {wkExtrasOpen.value && <Extras vm={vm} o={o} />}
      {vm.isPast && vm.exercises.length === 0 && <div class="placeholder">No workout logged on {o.dateLabel(vm.date)}.</div>}
      <div class="exgrid">
        {cardVm.exercises.map((ex) => (
          <ExerciseCardFace vm={cardVm} exercise={ex} />
        ))}
      </div>
      {!vm.isPast && (
        <button class="wk-showall" onClick={() => (wkShowAll.value = !showAll)}>
          {showAll ? 'Show today only' : 'Show all exercises'}
        </button>
      )}

      <button class={'wk-progtoggle' + (progOpen ? ' on' : '')} onClick={() => (wkProgOpen.value = !progOpen)}>
        {progOpen ? '▾' : '▸'} Progress
      </button>
      {progOpen && <WorkoutCharts />}
    </>
  );
}
