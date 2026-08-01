/**
 * Meal tab view. Same contract as the workout view: a pure renderer over a
 * `MealViewModel`, plus a controller that binds once via event delegation.
 */
import type { MealViewModel } from './mealSelectors.js';
import { esc } from './html.js';
import { BaseViewController, type ViewHost } from './viewHost.js';

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

function bar(pct: number, colour: string): string {
  return `<div class="bar"><div style="width:${pct}%;background:${colour}"></div></div>`;
}

export function renderMealHTML(vm: MealViewModel, o: MealViewOptions, charts = '', logOpen = false): string {
  const t = vm.targets;
  let h =
    `<div class="panel"><p class="panel-t">Bulk target</p><div class="statgrid">` +
    `<div class="stat"><div class="v">${t.current ?? '—'}</div><div class="k">current lb</div></div>` +
    `<div class="stat"><div class="v" style="color:var(--teal)">${t.goal ?? '—'}</div><div class="k">goal lb</div></div>` +
    `<div class="stat"><div class="v">${t.dailyCalories}</div><div class="k">daily kcal</div></div>` +
    `<div class="stat"><div class="v" style="color:var(--protein)">${t.proteinTarget}g</div><div class="k">protein</div></div>` +
    `</div><div class="mrow" style="margin-top:10px"><button class="mbtn" data-act="targets">Edit targets</button></div></div>`;

  h +=
    `<div class="panel"><div class="mrow" style="justify-content:space-between">` +
    `<p class="panel-t" style="margin:0">Intake</p><div class="mrow">` +
    `<button class="mbtn" data-act="date-prev">‹</button>` +
    `<span style="font-family:var(--mono);font-size:12px;min-width:150px;text-align:center">${esc(o.dateLabel(vm.date))}</span>` +
    `<button class="mbtn" data-act="date-next">›</button>` +
    (vm.isToday ? '' : `<button class="mbtn" data-act="date-today">→ Today</button>`) +
    `</div></div>` +
    `<div class="slabel">Calories ${vm.totals.calories} / ${t.dailyCalories}</div>${bar(vm.calorieProgress, 'var(--fuel)')}` +
    `<div class="slabel">Protein ${vm.totals.protein}g / ${t.proteinTarget}g</div>${bar(vm.proteinProgress, 'var(--protein)')}` +
    `<div class="note" style="margin-top:6px">${vm.totals.surplus >= 0 ? '+' + vm.totals.surplus : vm.totals.surplus} vs maintenance` +
    `${vm.totals.calories >= t.dailyCalories ? ' · target hit ✓' : ''}</div>`;

  if (vm.issues.length > 0) {
    h +=
      `<div class="note" style="margin-top:8px;color:var(--deficit)">⚠ ${vm.issues.length} entr${vm.issues.length === 1 ? 'y needs' : 'ies need'} checking:<br>` +
      vm.issues.map((i) => `· ${esc(i.name || i.mealId)} — ${esc(i.detail)}`).join('<br>') +
      `</div>`;
  }

  h +=
    `<div style="margin-top:10px">` +
    (vm.meals.length
      ? vm.meals
          .map(
            (m) =>
              `<div class="sentry"><span style="flex:1">${esc(m.name)}` +
              (m.est ? ' <span class="mchip" style="background:var(--panel2);color:var(--teal)">est</span>' : '') +
              `</span><span style="font-family:var(--mono);color:var(--muted);font-size:12px">${esc(m.cal)} kcal · ${esc(m.protein)}g</span>` +
              `<span class="rm" data-act="del-meal" data-id="${esc(m.id)}">×</span></div>`,
          )
          .join('')
      : '<div class="empty">No meals logged.</div>') +
    `</div></div>`;

  const s = vm.supplement;
  h +=
    `<div class="panel"><div class="mrow" style="justify-content:space-between">` +
    `<p class="panel-t" style="margin:0">Tadalafil</p><div class="mrow">` +
    `<button class="mbtn" data-act="supp" data-delta="-1">−</button>` +
    `<span style="font-family:var(--mono);font-size:20px;min-width:44px;text-align:center">${s.todayCount}×9mg</span>` +
    `<button class="mbtn" data-act="supp" data-delta="1">+</button></div></div>` +
    `<div class="note">${s.trailingCount} doses in the last ${s.windowDays} days${s.steadyState ? ' · steady state' : ''}</div></div>`;

  h +=
    `<div class="panel mpanel"><p class="panel-t">Quick add</p><div class="mrow" style="flex-wrap:wrap;gap:8px">` +
    o.presets
      .map(
        (p, i) =>
          `<button class="mbtn" data-act="preset" data-i="${i}">+ ${esc(p.label)}</button>`,
      )
      .join('') +
    `</div></div>`;

  h +=
    `<div class="panel mpanel"><p class="panel-t">Add meal</p><div class="mrow">` +
    `<input id="meal-name" placeholder="meal" style="flex:1;min-width:120px">` +
    `<input id="meal-cal" type="number" placeholder="kcal" style="width:80px">` +
    `<input id="meal-pro" type="number" placeholder="protein" style="width:90px">` +
    `<button class="mbtn primary" data-act="add-meal">Add</button></div>` +
    `<div id="meal-status" class="note" style="margin-top:6px"></div>` +
    `<div style="margin-top:10px"><p class="slabel" style="margin-bottom:6px">Or estimate from a description</p>` +
    `<div class="mrow"><input id="meal-desc" placeholder="e.g. 2 eggs, oatmeal, banana" style="flex:1;min-width:160px">` +
    `<button class="mbtn" data-act="estimate">Estimate with AI</button></div>` +
    `<div id="meal-eststatus" class="note" style="margin-top:6px"></div></div></div>`;
  // Two screens: Progress (charts + CTA) by default, Detail (back + logging) once drilled in.
  return logOpen ? '<button class="backbtn" data-act="toggle-log">← Progress</button>' + h : charts;
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

  repaint(vm: MealViewModel, charts = '', logOpen = false): boolean {
    return this.paint(renderMealHTML(vm, this.options, charts, logOpen));
  }
}
