/**
 * Meal tab view. Same contract as the workout view: a pure renderer over a
 * `MealViewModel`, plus a controller that binds once via event delegation.
 */
import type { MealViewModel } from '@/features/meal/mealSelectors';
import { esc } from '@/ui/html';
import { BaseViewController, type ViewHost } from '@/ui/viewHost';

export interface MealActions {
  addMeal(name: string, cal: number, protein: number): void;
  addPreset(name: string, cal: number, protein: number): void;
  deleteMeal(id: string): void;
  estimateWithAI(description: string): void;
  changeDate(which: 'prev' | 'next' | 'today'): void;
  editTargets(): void;
  adjustSupplement(delta: number): void;
  /** Progress-chart controls (optional — present once charts are wired). */
  setChartPeriod?(period: string): void;
  setChartScale?(scale: string): void;
  /** Expand/collapse the logging section below the charts. */
  toggleLog?(): void;
}

export interface MealPreset { label: string; name: string; cal: number; protein: number }

export interface MealViewOptions {
  dateLabel(date: string): string;
  presets: readonly MealPreset[];
}

function macroBar(label: string, value: string, target: string, pct: number, colour: string, hit: boolean): string {
  return (
    `<div class="macro"><div class="macro-t"><span class="macro-l">${label}</span>` +
    `<span class="macro-v">${value} <small>/ ${target}${hit ? ' ✓' : ''}</small></span></div>` +
    `<div class="macro-track"><div class="macro-fill" style="width:${Math.min(100, Math.max(0, Math.round(pct)))}%;background:${colour}"></div></div></div>`
  );
}

/**
 * Meals stays charts-first (Progress screen = the passed `charts`). This renders the
 * streamlined LOG screen once drilled in: today's macros → add-a-meal → today's list,
 * with targets + the supplement tucked behind the ⚙ (`extrasOpen`).
 */
export function renderMealHTML(vm: MealViewModel, o: MealViewOptions, charts = '', logOpen = false, extrasOpen = false): string {
  if (!logOpen) return charts;
  const t = vm.targets;
  const calLeft = t.dailyCalories - vm.totals.calories;
  const s = vm.supplement;

  const extras = extrasOpen
    ? `<div class="meal-extras">` +
      `<div class="panel"><p class="panel-t">Targets</p><div class="statgrid">` +
      `<div class="stat"><div class="v">${t.current ?? '—'}</div><div class="k">current lb</div></div>` +
      `<div class="stat"><div class="v" style="color:var(--teal)">${t.goal ?? '—'}</div><div class="k">goal lb</div></div>` +
      `<div class="stat"><div class="v">${t.dailyCalories}</div><div class="k">daily kcal</div></div>` +
      `<div class="stat"><div class="v" style="color:var(--protein)">${t.proteinTarget}g</div><div class="k">protein</div></div>` +
      `</div><div class="mrow" style="margin-top:10px"><button class="mbtn" data-act="targets">Edit targets</button></div></div>` +
      `<div class="panel"><div class="mrow" style="justify-content:space-between">` +
      `<p class="panel-t" style="margin:0">Tadalafil</p><div class="mrow">` +
      `<button class="mbtn" data-act="supp" data-delta="-1">−</button>` +
      `<span style="font-family:var(--mono);font-size:20px;min-width:44px;text-align:center">${s.todayCount}×9mg</span>` +
      `<button class="mbtn" data-act="supp" data-delta="1">+</button></div></div>` +
      `<div class="note">${s.trailingCount} doses in the last ${s.windowDays} days${s.steadyState ? ' · steady state' : ''}</div></div>` +
      `</div>`
    : '';

  return (
    `<button class="backbtn" data-act="toggle-log">‹ Progress</button>` +
    `<div class="log-h"><div class="datenav">` +
    `<button class="mbtn" data-act="date-prev" aria-label="Previous day">‹</button>` +
    `<span class="dlabel">${esc(o.dateLabel(vm.date))}</span>` +
    `<button class="mbtn" data-act="date-next" aria-label="Next day">›</button>` +
    (vm.isToday ? '' : `<button class="mbtn" data-act="date-today">→ Today</button>`) +
    `</div><button class="ex-opts${extrasOpen ? ' on' : ''}" data-act="meal-extras" aria-label="Targets and supplement">⚙</button></div>` +
    `<div class="hero"><div class="hero-v" style="color:var(--fuel)">${vm.totals.calories}<span class="hero-u"> / ${t.dailyCalories} kcal</span></div>` +
    `<div class="hero-d ${vm.totals.calories >= t.dailyCalories ? 'up' : ''}">${calLeft >= 0 ? calLeft + ' left' : Math.abs(calLeft) + ' over'}</div></div>` +
    `<div class="macros">` +
    macroBar('Calories', String(vm.totals.calories), `${t.dailyCalories} kcal`, vm.calorieProgress, 'var(--fuel)', vm.totals.calories >= t.dailyCalories) +
    macroBar('Protein', `${vm.totals.protein}g`, `${t.proteinTarget}g`, vm.proteinProgress, 'var(--protein)', vm.totals.protein >= t.proteinTarget) +
    `</div>` +
    (vm.issues.length
      ? `<div class="note" style="margin-top:10px;color:var(--deficit)">⚠ ${vm.issues.length} entr${vm.issues.length === 1 ? 'y needs' : 'ies need'} checking</div>`
      : '') +
    extras +
    `<div class="sec-h">Add a meal</div>` +
    `<div class="addcard">` +
    (o.presets.length
      ? `<div class="mchips">` +
        o.presets.map((p, i) => `<button class="mchip" data-act="preset" data-i="${i}">${esc(p.name)}<span class="k">${esc(p.cal)} · ${esc(p.protein)}g</span></button>`).join('') +
        `</div>`
      : '') +
    `<div class="addrow"><input id="meal-name" class="minp name" placeholder="Meal"><input id="meal-cal" class="minp num" type="number" inputmode="numeric" placeholder="kcal"><input id="meal-pro" class="minp num" type="number" inputmode="numeric" placeholder="prot"><button class="madd" data-act="add-meal">Add</button></div>` +
    `<div class="airow"><input id="meal-desc" class="minp" placeholder="or describe it — “2 eggs, oatmeal, banana”"><button class="maibtn" data-act="estimate">✦ AI</button></div>` +
    `<div id="meal-status" class="note" style="margin-top:6px"></div><div id="meal-eststatus" class="note"></div>` +
    `</div>` +
    `<div class="sec-h">Today · ${vm.meals.length} meal${vm.meals.length === 1 ? '' : 's'}</div>` +
    `<div class="meallist">` +
    (vm.meals.length
      ? vm.meals
          .map(
            (m) =>
              `<div class="mealrow"><span class="mealnm">${esc(m.name)}${m.est ? ' <span class="mealest">est</span>' : ''}</span>` +
              `<span class="mealmac">${esc(m.cal)} kcal · ${esc(m.protein)}g</span>` +
              `<span class="mealrm" data-act="del-meal" data-id="${esc(m.id)}" title="Remove">×</span></div>`,
          )
          .join('')
      : `<div class="empty">No meals logged yet.</div>`) +
    `</div>`
  );
}

export class MealViewController extends BaseViewController {
  constructor(
    host: ViewHost,
    private readonly actions: MealActions,
    private readonly readValue: (id: string) => string,
    private readonly options: MealViewOptions,
  ) {
    super(host);
  }

  protected onAction(act: string, ds: Record<string, string>): void {
    switch (act) {
      case 'add-meal':
        this.actions.addMeal(
          this.readValue('meal-name'),
          Number(this.readValue('meal-cal')) || 0,
          Number(this.readValue('meal-pro')) || 0,
        );
        break;
      case 'preset': {
        const p = this.options.presets[Number(ds.i)];
        if (p) this.actions.addPreset(p.name, p.cal, p.protein);
        break;
      }
      case 'del-meal': this.actions.deleteMeal(ds.id ?? ''); break;
      case 'estimate': this.actions.estimateWithAI(this.readValue('meal-desc')); break;
      case 'date-prev': this.actions.changeDate('prev'); break;
      case 'date-next': this.actions.changeDate('next'); break;
      case 'date-today': this.actions.changeDate('today'); break;
      case 'targets': this.actions.editTargets(); break;
      case 'supp': this.actions.adjustSupplement(Number(ds.delta) || 0); break;
      case 'chart-period': this.actions.setChartPeriod?.(ds.period ?? 'week'); break;
      case 'chart-scale': this.actions.setChartScale?.(ds.scale ?? 'lin'); break;
      case 'toggle-log': this.actions.toggleLog?.(); break;
      default: break;
    }
  }

  repaint(vm: MealViewModel, charts = '', logOpen = false, extrasOpen = false): boolean {
    return this.paint(renderMealHTML(vm, this.options, charts, logOpen, extrasOpen));
  }
}
