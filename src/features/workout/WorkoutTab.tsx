/**
 * Workout tab — one screen: the Progress charts carousel, then today's session
 * inline (collapsed exercise cards). Bodyweight / date / split / mark-complete
 * tuck behind the ⚙. Ports workoutCharts (app.ts) + renderWorkoutHTML to JSX.
 */
import { useEffect } from 'preact/hooks';
import { selectWorkoutView, restSeconds, inferIncrement } from '@/features/workout/workoutSelectors';
import type { WorkoutViewOptions } from '@/features/workout/types';
import { bodyweightGoal, trackedLifts, bodyweightSeries, strengthSeries, volumeSeries, tonnageSeries } from '@/ui/charts/progress';
import { DEFAULT_CONFIG, type SetType, type ExercisePlan } from '@/core/types';
import { domId } from '@/ui/html';
import { SectionHead, Hero, ProgControls, Carousel, Chart, LiftPicker, type Delta } from '@/ui/components/Charts';
import { wk, currentBW, exVideo, workoutActions, discard, loadWorkout } from '@/ui/actions';
import { wkLoaded, wkDate, wkSplit, wkSplitTouched, wkDeload, wkExtrasOpen, expandedEx, progPeriod, progLift, dataRev } from '@/ui/store';
import { dstr, dateLabel } from '@/app/bootstrap';
import { host } from '@/ui/host';

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

/* ── Progress charts ── */
function WorkoutCharts() {
  const W = wk();
  const period = progPeriod.value;
  const lifts = trackedLifts(W);
  useEffect(() => {
    if (lifts.length && !lifts.includes(progLift.value)) progLift.value = lifts[0]!;
  }, [lifts.join('|')]);
  const lift = lifts.includes(progLift.value) ? progLift.value : lifts[0] ?? '';
  const goal = bodyweightGoal(W);
  const cur = currentBW() as number | null;
  const dToGoal = cur != null && goal != null ? Math.round((goal - Number(cur)) * 10) / 10 : null;
  const delta: Delta | undefined = dToGoal != null ? { text: `${dToGoal > 0 ? '+' : ''}${dToGoal} to goal`, dir: dToGoal > 0 ? 'up' : dToGoal < 0 ? 'down' : '' } : undefined;
  return (
    <>
      <SectionHead name="Workout" />
      <div class="prog">
        {cur != null && <Hero value={String(cur)} unit="lb" label="Bodyweight" delta={delta} />}
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
    </>
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

function ExerciseCard({ vm, o, exercise, expanded }: { vm: VM; o: WorkoutViewOptions; exercise: string; expanded: boolean }) {
  const id = domId(exercise);
  const plan: Any = vm.plans[exercise] ?? null;
  const performed: Any[] = vm.performed[exercise] ?? [];
  const complete = vm.completed[exercise] === true;
  const rest = o.restSeconds[exercise];

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

  const header = (
    <button class="ex-top" onClick={() => workoutActions.toggleExercise?.(exercise)}>
      {complete && (
        <svg class="ex-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">
          <path d="M5 12l4 4 10-10" />
        </svg>
      )}
      <span class="ex-name">
        {exercise}
        {plan?.deload ? <> <span class="cue deload">deload</span></> : null}
      </span>
      <span class="ex-status">
        {sv}
        {sl && <span class="lbl">{sl}</span>}
      </span>
      <svg class="ex-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );

  if (!expanded) {
    return (
      <div class={'ex' + (complete ? ' done' : '')} id={'lift-' + id}>
        {header}
      </div>
    );
  }

  // expanded body
  let body: preact.JSX.Element;
  if (vm.isPast && performed.length > 0) {
    body = (
      <div class="sets">
        {performed.map((s) => (
          <SetLine state="done" label={setTypeLabel(s.type)} val={`${s.weight} × ${s.reps}`} trailing={<span class="undo" onClick={() => workoutActions.deleteSet(vm.date, s.id)} title="Remove">×</span>} />
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
            const undo = state === 'done' && i === next - 1 ? <span class="undo" onClick={() => workoutActions.undoLastSet(exercise)} title="Undo">↩</span> : null;
            return <SetLine state={state} label={label} val={val} trailing={undo} />;
          })}
        </div>
      </>
    );
  }

  return (
    <div class={'ex open' + (complete ? ' done' : '')} id={'lift-' + id}>
      {header}
      <div class="ex-body">
        <div class="ex-inner">
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
  const done = vm.exercises.filter((e) => vm.completed[e]).length;
  const status = vm.sessionComplete ? '✓ complete' : `${done} / ${vm.exercises.length} logged`;
  const exp = expandedEx.value;
  return (
    <>
      <WorkoutCharts />
      {wkExtrasOpen.value && <Extras vm={vm} o={o} />}
      <div class="exhead">
        <span class="exhead-t">Today’s session</span>
        <span class="exhead-r">
          <span class="exhead-m">{status}</span>
          <button class={'ex-opts' + (wkExtrasOpen.value ? ' on' : '')} onClick={() => workoutActions.toggleLog?.()} aria-label="Session options">⚙</button>
        </span>
      </div>
      {vm.isPast && vm.exercises.length === 0 && <div class="placeholder">No workout logged on {o.dateLabel(vm.date)}.</div>}
      {vm.exercises.map((ex) => (
        <ExerciseCard vm={vm} o={o} exercise={ex} expanded={exp.has(ex)} />
      ))}
    </>
  );
}
