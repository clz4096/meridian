/**
 * Food & Body — one screen. Budget-first dashboard (a ring of calories LEFT
 * today, protein + the body pace/weigh-in beside it) over a diary-style feed of
 * the day's meals (name left, macros right, running tally, a circled delete),
 * with an inline "+ Log food" composer. Charts behind a ▸ Progress toggle;
 * targets + supplement behind the ⚙. A hybrid of the B (dashboard) and C (feed)
 * layout explorations.
 */
import { useEffect, useState } from 'preact/hooks';
import { selectMealView } from '@/features/meal/mealSelectors';
import { calorieSeries, proteinSeries, calorieTarget, proteinTarget } from '@/ui/charts/progress';
import { ProgControls, Carousel, Chart } from '@/ui/components/Charts';
import { sgLoaded, sgExtrasOpen, sgDate, progPeriod, dataRev } from '@/ui/store';
import { sg, wk, mealActions, workoutActions, loadMeal, toggleMealExtras, MEAL_PRESETS } from '@/ui/actions';
import { dateLabel, dstr } from '@/app/bootstrap';
import { host } from '@/ui/host';
import { toNum } from '@/core/util';
import { currentWeight, bodyweightSlope, adherence, calorieAdjustment } from '@/features/meal/bodySelectors';

type VM = ReturnType<typeof selectMealView>;
const rv = (id: string): string => host.readValue(id);

/* ── The focal budget ring: calories LEFT in the middle, an arc of what's been
 *    eaten around it. Presentational — the parent owns the store subscription. ── */
function BudgetRing({ eaten, target, maintenance, color }: { eaten: number; target: number; maintenance: number; color: string }) {
  const R = 66;
  const SW = 14;
  const C = 2 * Math.PI * R;
  const frac = target > 0 ? Math.min(1, eaten / target) : 0;
  const off = C * (1 - frac);
  const left = target - eaten;
  const over = left < 0;
  // maintenance tick — a notch across the ring where the color flips to amber
  const mf = target > 0 ? Math.min(1, Math.max(0, maintenance / target)) : 0;
  const a = mf * 2 * Math.PI;
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  return (
    <div class="bud-focal">
      <svg class="bud-ring" viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--surface-2)" stroke-width={SW} />
        <circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          stroke={color}
          stroke-width={SW}
          stroke-linecap="round"
          stroke-dasharray={C}
          stroke-dashoffset={off}
          transform="rotate(-90 80 80)"
        />
        {maintenance > 0 && maintenance < target && (
          <line
            x1={80 + 57 * sin}
            y1={80 - 57 * cos}
            x2={80 + 75 * sin}
            y2={80 - 75 * cos}
            stroke="var(--text)"
            stroke-width="2.5"
            stroke-linecap="round"
            opacity="0.7"
          />
        )}
      </svg>
      <div class="bud-center">
        <div class="bud-num" style={`color:${color}`}>{Math.abs(left)}</div>
        <div class="bud-lbl">{over ? 'kcal over' : 'kcal left'}</div>
      </div>
    </div>
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
            <button class="mbtn" onClick={() => mealActions.adjustSupplement(-1)} aria-label="One fewer dose">−</button>
            <span style="font-family:var(--mono);font-size:20px;min-width:44px;text-align:center">{s.todayCount}×9mg</span>
            <button class="mbtn" onClick={() => mealActions.adjustSupplement(1)} aria-label="One more dose">+</button>
          </div>
        </div>
        <div class="note">
          {s.trailingCount} doses in the last {s.windowDays} days{s.steadyState ? ' · steady state' : ''}
        </div>
      </div>
    </div>
  );
}

/** The "+ Log food" composer: preset chips + name/kcal/protein + Add, plus the AI
 *  describe row. Gated behind the affordance so the feed stays diary-clean. */
function Composer() {
  return (
    <div class="jcomposer">
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
          <input id="meal-name" class="minp name" placeholder="Meal" aria-label="Meal name" />
          <input id="meal-cal" class="minp num" type="number" inputmode="numeric" placeholder="kcal" aria-label="Calories" />
          <input id="meal-pro" class="minp num" type="number" inputmode="numeric" placeholder="prot" aria-label="Protein (g)" />
          <button class="madd" onClick={() => mealActions.addMeal(rv('meal-name'), Number(rv('meal-cal')) || 0, Number(rv('meal-pro')) || 0)}>
            Add
          </button>
        </div>
        <div class="airow">
          <input id="meal-desc" class="minp" placeholder="or describe it — “2 eggs, oatmeal, banana”" aria-label="Describe a meal for AI estimation" />
          <button class="maibtn" onClick={() => mealActions.estimateWithAI(rv('meal-desc'))}>
            ✦ AI
          </button>
        </div>
        <div id="meal-status" class="note" style="margin-top:6px" />
        <div id="meal-eststatus" class="note" />
      </div>
    </div>
  );
}

export function MealView() {
  useEffect(() => {
    if (!sgLoaded.value) void loadMeal();
  }, []);
  const [composerOpen, setComposerOpen] = useState(false);
  const [progOpen, setProgOpen] = useState(false);
  dataRev.value; // leaf subscription — re-derive on any meal/body change
  if (!sgLoaded.value) return <div class="empty">Loading…</div>;

  const G = sg();
  const today = dstr();
  const date = sgDate.value ?? today;
  const vm = selectMealView(G, date, today);
  const t = vm.targets;
  const eaten = vm.totals.calories;
  const period = progPeriod.value;
  const extrasOpen = sgExtrasOpen.value;

  // Calorie zone. You're GAINING, so the meaning is inverted from a diet app:
  // under maintenance is the bad state, surplus is the goal.
  // red (under maintenance) → amber (at maintenance) → green (in surplus).
  const maintenance = toNum(G.settings.maintenance) || Math.round(t.dailyCalories * 0.81);
  const calZone = eaten < maintenance ? 'under' : eaten < t.dailyCalories ? 'at' : 'surplus';
  const calColor = calZone === 'under' ? 'var(--deficit)' : calZone === 'at' ? 'var(--fuel)' : 'var(--ok)';
  const calPill = calZone === 'under' ? 'under maintenance' : calZone === 'at' ? 'at maintenance' : 'in surplus';

  // Body: latest weigh-in, goal, smoothed pace, and the plain-language calorie call.
  const W = wk();
  const cur = currentWeight(W.bw, today);
  const goal = toNum(W.settings.bwGoal) || null;
  const slope = bodyweightSlope(W.bw, today);
  const toGoal = cur != null && goal != null ? Math.round((goal - cur) * 10) / 10 : null;
  const calT = calorieTarget(G);
  const proT = proteinTarget(G);
  const adh = calT ? adherence(G, calT, today) : 0;
  const adj = calorieAdjustment(slope, adh);
  const newTarget = calT != null ? calT + adj.deltaKcal : null;
  const advice =
    adj.verdict === 'hold'
      ? 'on pace — keep it steady'
      : adj.verdict === 'raise'
        ? `gaining slow — nudge to ${newTarget}`
        : adj.verdict === 'trim'
          ? `gaining fast — ease to ${newTarget}`
          : adj.verdict === 'hit-target'
            ? `hit ${calT} kcal first · eating ${Math.round(adh * 100)}%`
            : 'weigh in a few mornings for a pace read';
  const paceTxt = slope == null ? 'no trend yet' : `${slope >= 0 ? '+' : ''}${slope.toFixed(1)} lb/wk`;
  const paceClass = slope == null ? '' : slope > 0 ? 'up' : 'down';

  // Protein maintenance is based on your CURRENT bodyweight (~1 g/lb), so it rises
  // as you gain. Same red→amber→green language: under it / near it / at-or-above it.
  const pMaint = cur != null && cur > 0 ? Math.round(cur) : t.proteinTarget;
  const pFrac = pMaint > 0 ? vm.totals.protein / pMaint : 0;
  const proColor = pFrac < 0.7 ? 'var(--deficit)' : pFrac < 1 ? 'var(--fuel)' : 'var(--ok)';

  return (
    <>
      {/* Date scope + settings — kept compact so the budget stays the hero. */}
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
        <button class={'ex-opts' + (extrasOpen ? ' on' : '')} onClick={toggleMealExtras} aria-label="Targets and supplement" aria-pressed={extrasOpen}>
          ⚙
        </button>
      </div>

      {/* ── The focal budget: how much can I still eat today ── */}
      <div class="bud-card">
        <BudgetRing eaten={eaten} target={t.dailyCalories} maintenance={maintenance} color={calColor} />
        <div class="bud-eaten">
          {eaten} <span>/ {t.dailyCalories} kcal eaten</span>
          <div class={'bud-pill z-' + calZone}>{calPill}</div>
        </div>
        <div class="bud-meta">
          <MacroBar
            label="Protein"
            value={`${vm.totals.protein}g`}
            target={`${pMaint}g`}
            pct={pFrac * 100}
            colour={proColor}
            hit={pFrac >= 1}
          />
          <div class="bud-body">
            <div class="bud-body-top">
              <span class="bud-body-eyb">Body</span>
              <span class="bud-body-v">
                {cur != null ? cur : '—'}
                <small>lb</small>
              </span>
              <span class="bud-body-sub">{toGoal != null ? `${toGoal} to goal` : goal ? `goal ${goal}` : 'set a goal'}</span>
            </div>
            <div class="bud-pace">
              <span class={'bodypace ' + paceClass}>{paceTxt}</span> · {advice}
            </div>
            <div class="bodyweigh">
              <input id="bw-weigh" class="addslim-in" type="number" inputmode="decimal" placeholder="weigh in…" aria-label="Log today's weight" />
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
        </div>
      </div>

      {vm.issues.length > 0 && (
        <div class="note" style="margin-top:12px;color:var(--deficit)">
          ⚠ {vm.issues.length} entr{vm.issues.length === 1 ? 'y needs' : 'ies need'} checking
        </div>
      )}

      {extrasOpen && <MealExtras vm={vm} />}

      {/* ── The day's feed — name left, macros right, running tally, circled delete ── */}
      <div class="sec-h">
        {vm.isToday ? 'Today' : dateLabel(vm.date)} · {vm.meals.length} meal{vm.meals.length === 1 ? '' : 's'}
      </div>
      {vm.meals.length ? (
        <ul class="jfeed">
          {vm.meals.map((m) => (
            <li class="jentry" key={m.id}>
              <span class="jnode" aria-hidden="true" />
              <div class="jentry-row">
                <span class="jentry-nm">
                  {m.name}
                  {m.est && (
                    <>
                      {' '}
                      <span class="mealest">est</span>
                    </>
                  )}
                </span>
                <span class="jentry-mac">{m.cal} kcal · {m.protein}g</span>
              </div>
              <button class="jentry-rm" onClick={() => mealActions.deleteMeal(m.id)} aria-label={`Remove ${m.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div class="jempty">No meals logged yet today.</div>
      )}

      {/* ── Inline "+ Log food" composer (C's position) ── */}
      <button class={'jlog-add' + (composerOpen ? ' on' : '')} onClick={() => setComposerOpen((v) => !v)} aria-expanded={composerOpen}>
        <span class="jlog-plus" aria-hidden="true">{composerOpen ? '×' : '+'}</span>
        {composerOpen ? 'Close' : 'Log food'}
      </button>
      {composerOpen && <Composer />}

      {/* ── Charts behind a toggle ── */}
      <button class={'wk-progtoggle' + (progOpen ? ' on' : '')} onClick={() => setProgOpen(!progOpen)} aria-expanded={progOpen}>
        {progOpen ? '▾' : '▸'} Progress
      </button>
      {progOpen && (
        <div class="prog">
          <ProgControls />
          <Carousel keepKey="meal">
            <Chart opts={{ kind: 'line', title: 'Calories · avg/day', points: calorieSeries(G, period), reference: calT != null ? { value: calT, label: `target ${calT}` } : null, color: 'var(--fuel)' }} />
            <Chart opts={{ kind: 'line', title: 'Protein · avg/day', points: proteinSeries(G, period), unit: 'g', reference: proT != null ? { value: proT, label: `target ${proT}` } : null, color: 'var(--protein)' }} />
          </Carousel>
        </div>
      )}
    </>
  );
}
