#!/usr/bin/env node
/**
 * Render + derivation benchmark, run in isolation so the numbers mean something.
 *   npm run bench
 * Fails the process if any operation exceeds one 60fps frame (16ms).
 */
import fs from 'node:fs';
import * as S from './dist/workoutSelectors.js';
import * as V from './dist/workoutView.js';
import * as M from './dist/mealSelectors.js';
import * as K from './dist/knowledgeSelectors.js';
import * as D from './dist/dataSelectors.js';
import * as G from './dist/mergeStores.js';

const html = fs.readFileSync('../site/index.html', 'utf8');
const WK = JSON.parse(html.match(/const DEFAULT_WK = (\{.*?\});\n/s)[1]);
Object.assign(WK, { done: WK.done ?? {}, sessionDone: WK.sessionDone ?? {}, incr: WK.incr ?? {}, _del: WK._del ?? {} });
const SG = { settings: { maintenance: 2200, surplus: 500, proteinTarget: 147 },
  days: { '2026-07-25': Array.from({ length: 10 }, (_, i) => ({ id: 'm'+i, name: 'Meal '+i, cal: 300, protein: 25 })) },
  tad: {}, _del: {} };
const state = { core: { schedule: {}, entries: [], _del: {} }, overload: WK, surplus: SG,
  csgraph: { mastery: {}, srs: {}, gymDone: {}, log: [] } };
const opts = { restSeconds: new Proxy({}, { get: () => ({ warm:60, top:180, back:120 }) }),
  increments: new Proxy({}, { get: () => 5 }), videoUrl: () => '#',
  bodyweight: { current: 120, goal: 150, toGoal: 30 }, dateLabel: (d) => d, isToday: true };

const BUDGET = 16;
let worst = 0, failed = 0;
function bench(label, fn, n) {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  const ms = (performance.now() - t0) / n;
  worst = Math.max(worst, ms);
  const ok = ms < BUDGET;
  if (!ok) failed++;
  console.log('  ' + label.padEnd(36) + ms.toFixed(3).padStart(8) + ' ms  ' + (ok ? '✓' : '✗ OVER 16ms'));
}

const sets = Object.values(WK.days).flat().length;
console.log(`\nMeridian benchmark — ${Object.keys(WK.days).length} workout days, ${sets} sets\n`);
bench('selectWorkoutView', () => S.selectWorkoutView(WK, '2026-07-25', '2026-07-25'), 500);
bench('renderWorkoutHTML', () => V.renderWorkoutHTML(S.selectWorkoutView(WK,'2026-07-25','2026-07-25'), opts), 300);
bench('selectMealView', () => M.selectMealView(SG, '2026-07-25', '2026-07-25'), 3000);
bench('SRS schedule transition', () => K.schedule({ due:'2026-01-01', ivl:10, ease:2.5, n:4 }, 4, '2026-07-25'), 20000);
bench('normaliseState + metrics', () => D.storageMetrics(D.normaliseState(state)), 200);
bench('roundTrip (export + import)', () => D.roundTrip(D.normaliseState(state)), 100);
bench('mergeStore (full workout)', () => G.mergeStore('overload', WK, WK, true), 300);
bench('pruneTombstones (1200)', () => S.pruneTombstones(Object.fromEntries(Array.from({length:1200},(_,i)=>['t'+i, Date.now()-i*1000])), Date.now()), 300);

console.log(`\n  worst case: ${worst.toFixed(3)} ms  (budget ${BUDGET} ms — ${(BUDGET/worst).toFixed(0)}x headroom)`);
console.log(failed ? `\n✗ ${failed} operation(s) over budget\n` : '\n✓ all operations within one 60fps frame\n');
process.exit(failed ? 1 : 0);
