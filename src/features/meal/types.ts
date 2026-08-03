/**
 * Meal feature — view-facing types shared by the actions layer and the MealView
 * component. The `MealViewModel` lives in `@/features/meal/mealSelectors`.
 */
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

export interface MealPreset {
  label: string;
  name: string;
  cal: number;
  protein: number;
}
