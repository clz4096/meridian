/**
 * Meals tab — charts-first Progress screen, drilling into the log form (datenav,
 * macros, add-a-meal, today's list) with targets + supplement behind the ⚙.
 * Ports mealCharts (app.ts) + renderMealHTML to JSX.
 */
import { useEffect } from 'preact/hooks';
import { selectMealView } from '@/features/meal/mealSelectors';
import { calorieSeries, proteinSeries, calorieTarget, proteinTarget } from '@/ui/charts/progress';
import { ProgControls, Carousel, Chart, ViewLogCta } from '@/ui/components/Charts';
import { SecHero } from '@/ui/components/SecHero';
import { sgLoaded, sgLogOpen, sgExtrasOpen, sgDate, progPeriod, dataRev } from '@/ui/store';
import { sg, wk, mealActions, workoutActions, loadMeal, toggleMealExtras, MEAL_PRESETS, goHome } from '@/ui/actions';
import { dateLabel, dstr } from '@/app/bootstrap';
import { host } from '@/ui/host';
import { toNum } from '@/core/util';
import { currentWeight, bodyweightSlope, adherence, calorieAdjustment } from '@/features/meal/bodySelectors';

type VM = ReturnType<typeof selectMealView>;
const rv = (id: string): string => host.readValue(id);

/** Bodyweight goal + pace + plain-language calorie guidance (spec §5 surfaced). */
function BodyPanel() {
  dataRev.value;
  const W = wk();
  const today = dstr();
  const cur = currentWeight(W.bw, today);
  const goal = toNum(W.settings.bwGoal) || null;
  const slope = bodyweightSlope(W.bw, today);
  const toGoal = cur != null && goal != null ? Math.round((goal - cur) * 10) / 10 : null;
  const calT = calorieTarget(sg());
  const adh = calT ? adherence(sg(), calT, today) : 0;
  const adj = calorieAdjustment(slope, adh);
  const newTarget = calT != null ? calT + adj.deltaKcal : null;
  const advice =
    adj.verdict === 'hold'
      ? 'On pace — keep it steady.'
      : adj.verdict === 'raise'
        ? `Gaining slow — nudge calories to ${newTarget}.`
        : adj.verdict === 'trim'
          ? `Gaining fast — ease calories to ${newTarget}.`
          : adj.verdict === 'hit-target'
            ? `Hit your ${calT} kcal target first — you're eating ${Math.round(adh * 100)}%.`
            : 'Weigh in a few more mornings for a pace read.';
  const paceTxt = slope == null ? 'no trend yet' : `${slope >= 0 ? '+' : ''}${slope.toFixed(1)} lb/wk`;
  const paceClass = slope == null ? '' : slope > 0 ? 'up' : 'down';
  return (
    <>
      <SecHero
        eyebrow="Food & Body"
        value={cur != null ? cur : '—'}
        unit="lb"
        sub={toGoal != null ? `${toGoal} to goal` : goal ? `goal ${goal}` : 'set a goal'}
        subClass={toGoal != null ? (toGoal > 0 ? 'up' : 'down') : ''}
        tone="teal"
      />
      <div class="bodyrow">
        <span class={'bodypace ' + paceClass}>{paceTxt}</span>
        <div class="addslim bodyweigh">
          <input id="bw-weigh" class="addslim-in" type="number" inputmode="decimal" placeholder="weigh in…" />
          <button
            class="addslim-btn"
            onClick={() => {
              const v = Number(rv('bw-weigh'));
              if (v > 0) workoutActions.logBodyweight(v);
            }}
            aria-label="Log weight"
          >
            ＋
          </button>
        </div>
      </div>
      <div class={'bodyadvice v-' + adj.verdict}>{advice}</div>
    </>
  );
}

function MealProgress() {
  dataRev.value; // subscribe here (not just the MealView parent) so a logged/removed meal re-derives
  const G = sg();
  const period = progPeriod.value;
  const calT = calorieTarget(G);
  const proT = proteinTarget(G);
  const todayCal = (G.days?.[dstr()] ?? []).reduce((a: number, m: { cal?: number }) => a + (+(m.cal ?? 0) || 0), 0);
  const calDelta = calT ? todayCal - calT : null;
  const sub =
    todayCal === 0 ? 'not logged yet' : calDelta != null ? `${calDelta >= 0 ? '+' : ''}${calDelta} vs target` : `${todayCal} today`;
  const subClass = todayCal === 0 || calDelta == null ? '' : calDelta >= 0 ? 'up' : 'down';
  return (
    <>
      <button class="backbtn" onClick={goHome}>
        ‹ Back
      </button>
      <SecHero eyebrow="Meals" value={todayCal} unit="kcal today" sub={sub} subClass={subClass} tone="fuel" />
      <BodyPanel />
      <div class="prog">
        <ProgControls />
        <Carousel keepKey="meal">
          <Chart opts={{ kind: 'line', title: 'Calories · avg/day', points: calorieSeries(G, period), reference: calT != null ? { value: calT, label: `target ${calT}` } : null, color: 'var(--fuel)' }} />
          <Chart opts={{ kind: 'line', title: 'Protein · avg/day', points: proteinSeries(G, period), unit: 'g', reference: proT != null ? { value: proT, label: `target ${proT}` } : null, color: 'var(--protein)' }} />
        </Carousel>
      </div>
      <ViewLogCta label="View meal log" onClick={() => mealActions.toggleLog?.()} />
    </>
  );
}

function MacroBar({ label, value, target, pct, colour, hit }: { label: string; value: string; target: string; pct: number; colour: string; hit: boolean }) {
  const w = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div class="macro">
      <div class="macro-t">
        <span class="macro-l">{label}</span>
        <span class="macro-v">
          {value} <small>/ {target}{hit ? ' ✓' : ''}</small>
        </span>
      </div>
      <div class="macro-track">
        <div class="macro-fill" style={`width:${w}%;background:${colour}`} />
      </div>
    </div>
  );
}

function MealExtras({ vm }: { vm: VM }) {
  const t = vm.targets;
  const s = vm.supplement;
  return (
    <div class="meal-extras">
      <div class="panel">
        <p class="panel-t">Targets</p>
        <div class="statgrid">
          <div class="stat"><div class="v">{t.current ?? '—'}</div><div class="k">current lb</div></div>
          <div class="stat"><div class="v" style="color:var(--teal)">{t.goal ?? '—'}</div><div class="k">goal lb</div></div>
          <div class="stat"><div class="v">{t.dailyCalories}</div><div class="k">daily kcal</div></div>
          <div class="stat"><div class="v" style="color:var(--protein)">{t.proteinTarget}g</div><div class="k">protein</div></div>
        </div>
        <div class="mrow" style="margin-top:10px">
          <button class="mbtn" onClick={mealActions.editTargets}>Edit targets</button>
        </div>
      </div>
      <div class="panel">
        <div class="mrow" style="justify-content:space-between">
          <p class="panel-t" style="margin:0">Tadalafil</p>
          <div class="mrow">
            <button class="mbtn" onClick={() => mealActions.adjustSupplement(-1)}>−</button>
            <span style="font-family:var(--mono);font-size:20px;min-width:44px;text-align:center">{s.todayCount}×9mg</span>
            <button class="mbtn" onClick={() => mealActions.adjustSupplement(1)}>+</button>
          </div>
        </div>
        <div class="note">
          {s.trailingCount} doses in the last {s.windowDays} days{s.steadyState ? ' · steady state' : ''}
        </div>
      </div>
    </div>
  );
}

function MealLog() {
  dataRev.value; // subscribe here (not just the MealView parent) so a logged/removed meal re-derives
  const today = dstr();
  const vm = selectMealView(sg(), sgDate.value ?? today, today);
  const t = vm.targets;
  const calLeft = t.dailyCalories - vm.totals.calories;
  const over = vm.totals.calories >= t.dailyCalories;
  const extrasOpen = sgExtrasOpen.value;
  return (
    <>
      <button class="backbtn" onClick={() => mealActions.toggleLog?.()}>
        ‹ Progress
      </button>
      <div class="log-h">
        <div class="datenav">
          <button class="mbtn" onClick={() => mealActions.changeDate('prev')} aria-label="Previous day">‹</button>
          <span class="dlabel">{dateLabel(vm.date)}</span>
          <button class="mbtn" onClick={() => mealActions.changeDate('next')} aria-label="Next day">›</button>
          {!vm.isToday && (
            <button class="mbtn" onClick={() => mealActions.changeDate('today')}>
              → Today
            </button>
          )}
        </div>
        <button class={'ex-opts' + (extrasOpen ? ' on' : '')} onClick={toggleMealExtras} aria-label="Targets and supplement">
          ⚙
        </button>
      </div>
      <SecHero
        eyebrow="Calories"
        value={vm.totals.calories}
        unit={`/ ${t.dailyCalories} kcal`}
        sub={calLeft >= 0 ? `${calLeft} left` : `${Math.abs(calLeft)} over`}
        subClass={over ? 'up' : ''}
        tone="fuel"
      />
      <div class="macros">
        <MacroBar label="Calories" value={String(vm.totals.calories)} target={`${t.dailyCalories} kcal`} pct={vm.calorieProgress} colour="var(--fuel)" hit={over} />
        <MacroBar label="Protein" value={`${vm.totals.protein}g`} target={`${t.proteinTarget}g`} pct={vm.proteinProgress} colour="var(--protein)" hit={vm.totals.protein >= t.proteinTarget} />
      </div>
      {vm.issues.length > 0 && (
        <div class="note" style="margin-top:10px;color:var(--deficit)">
          ⚠ {vm.issues.length} entr{vm.issues.length === 1 ? 'y needs' : 'ies need'} checking
        </div>
      )}
      {extrasOpen && <MealExtras vm={vm} />}
      <div class="sec-h">Add a meal</div>
      <div class="addcard">
        {MEAL_PRESETS.length > 0 && (
          <div class="mchips">
            {MEAL_PRESETS.map((p) => (
              <button class="mchip" onClick={() => mealActions.addPreset(p.name, p.cal, p.protein)}>
                {p.name}
                <span class="k">
                  {p.cal} · {p.protein}g
                </span>
              </button>
            ))}
          </div>
        )}
        <div class="addrow">
          <input id="meal-name" class="minp name" placeholder="Meal" />
          <input id="meal-cal" class="minp num" type="number" inputmode="numeric" placeholder="kcal" />
          <input id="meal-pro" class="minp num" type="number" inputmode="numeric" placeholder="prot" />
          <button class="madd" onClick={() => mealActions.addMeal(rv('meal-name'), Number(rv('meal-cal')) || 0, Number(rv('meal-pro')) || 0)}>
            Add
          </button>
        </div>
        <div class="airow">
          <input id="meal-desc" class="minp" placeholder="or describe it — “2 eggs, oatmeal, banana”" />
          <button class="maibtn" onClick={() => mealActions.estimateWithAI(rv('meal-desc'))}>
            ✦ AI
          </button>
        </div>
        <div id="meal-status" class="note" style="margin-top:6px" />
        <div id="meal-eststatus" class="note" />
      </div>
      <div class="sec-h">
        Today · {vm.meals.length} meal{vm.meals.length === 1 ? '' : 's'}
      </div>
      <div class="meallist">
        {vm.meals.length ? (
          vm.meals.map((m) => (
            <div class="mealrow">
              <span class="mealnm">
                {m.name}
                {m.est && (
                  <>
                    {' '}
                    <span class="mealest">est</span>
                  </>
                )}
              </span>
              <span class="mealmac">
                {m.cal} kcal · {m.protein}g
              </span>
              <span class="mealrm" onClick={() => mealActions.deleteMeal(m.id)} title="Remove">
                ×
              </span>
            </div>
          ))
        ) : (
          <div class="empty">No meals logged yet.</div>
        )}
      </div>
    </>
  );
}

export function MealView() {
  useEffect(() => {
    if (!sgLoaded.value) void loadMeal();
  }, []);
  dataRev.value; // re-derive
  if (!sgLoaded.value) return <div class="empty">Loading…</div>;
  return sgLogOpen.value ? <MealLog /> : <MealProgress />;
}
