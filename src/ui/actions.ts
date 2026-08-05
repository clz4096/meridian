/**
 * Actions — ported from app.ts. Each body keeps its in-place store mutation +
 * appState.markXDirty() + restTimer calls verbatim; the only changes are:
 *   renderX()      → bump()            (reactive re-derive)
 *   closure vars   → signal.value      (UI state lives in @/ui/store)
 *   MC.foo         → direct imports
 * The mounted-view `clearEdits` calls are gone — input clearing is handled in the
 * components (Preact keeps DOM identity across renders).
 */
import { RestTimer } from '@/ui/restTimer';
import { selectWorkoutView, inferIncrement, restSeconds } from '@/features/workout/workoutSelectors';
import type { WorkoutActions } from '@/features/workout/types';
import { shiftDate } from '@/core/util';
import type { SetType, Mastery } from '@/core/types';
import { schedule as srsSchedule, dueCards } from '@/features/knowledge/knowledgeSelectors';
import type { KnowledgeActions } from '@/features/knowledge/types';
import { fetchQuestionBank } from '@/features/knowledge/questionBank';
import { aiCall, estimateMacros } from '@/services/ai';
import type { MealActions, MealPreset } from '@/features/meal/types';
import { exportBundle, serialise, importBundle, normaliseState, storageMetrics } from '@/features/data/dataSelectors';
import type { DataActions } from '@/features/data/types';
import type { StoreKey } from '@/core/storage/appState';
import type { HubStat } from '@/ui/hubTypes';
import { openCount as todoOpenCount, dueTodos } from '@/features/todos/todosSelectors';
import { nextStatus, cardCount as scratchCardCount } from '@/features/scratch/scratchSelectors';
import { loadWeather, savedCity, setSavedCity } from '@/services/weather';
import { DATA } from '@/core/data/index';
import { appState, stores, uid, dstr, sync, cloudEnabled, STORAGE_KEYS } from '@/app/bootstrap';
import { host } from '@/ui/host';
import * as st from '@/ui/store';

// Stores are dynamically-shaped legacy blobs; the typed selectors own the real
// schemas (same rationale as app.ts's `Any`). Loosely typed here on purpose.
type Store = any;
export const wk = (): Store => appState.get('overload');
export const sg = (): Store => appState.get('surplus');
export const kg = (): Store => appState.get('csgraph');
export const core = (): Store => appState.get('core');
const pushState = (): void => window.history.pushState({ meridianDetail: 1 }, '');

/* ── rest timer (drives the RestBar via host.restBar → restState signal) ── */
export const restTimer = new RestTimer({
  bar: host.restBar,
  now: () => Date.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h),
  onVisibleStop: () => st.bump(),
});

/* ── static build-time content ── */
const EX_VIDEO: Record<string, string> = DATA.exVideo;
const EX_SWAP: Record<string, string> = DATA.exSwap;

/* ── workout helpers ── */
const yt = (q: string): string =>
  'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' proper form technique');
/** The dumbbell alternate for an exercise when away from the gym, or null if none. */
export const exSwap = (ex: string): string | null => EX_SWAP[ex] ?? null;
/** Exercise name to show: the dumbbell alternate when Away mode is on and one exists. */
export const displayExercise = (ex: string): string => (st.awayMode.value && EX_SWAP[ex]) || ex;
export const exVideo = (ex: string): string => EX_VIDEO[displayExercise(ex)] || yt(displayExercise(ex));
const daysSorted = (): string[] => Object.keys(wk().days).sort();
const exSessions = (ex: string): string[] =>
  daysSorted().filter((d) => (wk().days[d] || []).some((s: Store) => s.ex === ex));
function exMeta(ex: string): { muscle: string; group: string } {
  const ds = exSessions(ex);
  for (let i = ds.length - 1; i >= 0; i--) {
    const s = (wk().days[ds[i]!] || []).find((x: Store) => x.ex === ex);
    if (s) return { muscle: s.muscle || '', group: s.group || '' };
  }
  return { muscle: '', group: '' };
}
export const currentBW = (): unknown => {
  const ds = Object.keys(wk().bw || {}).sort();
  return ds.length ? wk().bw[ds[ds.length - 1]!] : wk().settings.bwCurrent || null;
};
const restSecs = (ex: string, type: SetType): number => restSeconds(wk(), ex, type);

/* ── lazy load (triggered by the WorkoutView component on first open) ── */
export async function loadWorkout(): Promise<void> {
  stores.overload = await appState.loadWorkout();
  st.wkLoaded.value = true;
  if (!st.wkDate.value) st.wkDate.value = dstr();
  st.bump();
}

/* ── workout actions ── */
export const workoutActions: WorkoutActions = {
  logSet(ex, type, weight, reps) {
    if (!ex || !weight || !reps) return;
    const W = wk();
    const td = st.wkDate.value ?? dstr();
    if (!W.days[td]) W.days[td] = [];
    const m = exMeta(ex);
    W.days[td].push({ id: uid(), ex, muscle: m.muscle || '', group: m.group || '', type, weight, reps });
    appState.markWorkoutDirty();
    // auto-complete: tick the exercise once every prescribed set is in
    const planned = selectWorkoutView(W, td, dstr(), { deload: st.wkDeload.value }).plans[ex];
    const need = planned && !planned.cardio ? planned.warms.length + 1 + planned.backs.length : 1;
    if (W.days[td].filter((s: Store) => s.ex === ex).length >= need) {
      if (!W.done) W.done = {};
      if (!W.done[td]) W.done[td] = [];
      if (W.done[td].indexOf(ex) < 0) W.done[td].push(ex);
      restTimer.dismissFor(ex); // last prescribed set logged → exercise done, no rest to time
    } else {
      restTimer.start(ex, type, restSecs(ex, type)); // more sets to go → start the rest countdown
    }
    st.bump();
  },
  deleteSet(date, id) {
    const W = wk();
    appState.tomb(W, id);
    W.days[date] = (W.days[date] || []).filter((s: Store) => String(s.id) !== String(id));
    appState.markWorkoutDirty();
    st.bump();
  },
  toggleExerciseDone(ex) {
    const W = wk();
    const k = st.wkDate.value ?? dstr();
    if (!W.done) W.done = {};
    if (!W.done[k]) W.done[k] = [];
    const i = W.done[k].indexOf(ex);
    if (i >= 0) W.done[k].splice(i, 1);
    else {
      W.done[k].push(ex);
      restTimer.dismissFor(ex);
    }
    appState.markWorkoutDirty();
    st.bump();
  },
  toggleSessionDone() {
    const W = wk();
    const k = st.wkDate.value ?? dstr();
    if (!W.sessionDone) W.sessionDone = {};
    W.sessionDone[k] = !W.sessionDone[k];
    if (W.sessionDone[k]) restTimer.stop(true);
    appState.markWorkoutDirty();
    st.bump();
    void appState.save();
  },
  toggleDeload(ex) {
    st.wkDeload.value = { ...st.wkDeload.value, [ex]: !st.wkDeload.value[ex] };
    st.bump();
  },
  editIncrement(ex) {
    const W = wk();
    const cur = inferIncrement(W, ex);
    const v = host.prompt(
      'Smallest weight step for ' +
        ex +
        ' at your gym (lb).\n\nPlate-loaded: 5 or 10. Selectorized stack: often 10, 12.5, 15 or 20.',
      String(cur),
    );
    if (v === null || v === '') return;
    if (!W.incr) W.incr = {};
    W.incr[ex] = Math.max(1, +v || 5);
    appState.markWorkoutDirty();
    st.bump();
  },
  startRest(ex, type) {
    restTimer.start(ex, type, restSecs(ex, type));
  },
  undoLastSet(ex) {
    const W = wk();
    const td = st.wkDate.value ?? dstr();
    if (!W.days[td]) return;
    const sets = W.days[td];
    for (let i = sets.length - 1; i >= 0; i--) {
      if (sets[i].ex === ex) {
        sets.splice(i, 1);
        appState.markWorkoutDirty();
        if (W.done && W.done[td]) W.done[td] = W.done[td].filter((e: string) => e !== ex);
        st.bump();
        return;
      }
    }
  },
  changeDate(which) {
    st.wkDate.value = which === 'today' ? dstr() : shiftDate(st.wkDate.value ?? dstr(), which === 'next' ? 1 : -1);
    st.wkSplitTouched.value = false;
    st.bump();
  },
  changeSplit(split) {
    st.wkSplit.value = split;
    st.wkSplitTouched.value = true;
    st.bump();
  },
  logBodyweight(v) {
    if (!v) return;
    const W = wk();
    W.bw[st.wkDate.value ?? dstr()] = v;
    if (!W.settings.bwCurrent) W.settings.bwCurrent = v;
    appState.markWorkoutDirty();
    st.bump();
  },
  setChartPeriod(p) {
    st.progPeriod.value = p as import("@/ui/charts/progress").Period;
    st.bump();
  },
  setChartLift(exercise) {
    st.progLift.value = exercise;
    st.bump();
  },
  setChartScale(s) {
    st.logScale.value = s === 'log';
    st.bump();
  },
  toggleLog() {
    st.wkExtrasOpen.value = !st.wkExtrasOpen.value;
    st.bump();
  },
  toggleExercise(ex) {
    const next = new Set(st.expandedEx.value);
    if (next.has(ex)) next.delete(ex);
    else next.add(ex);
    st.expandedEx.value = next;
    st.bump();
  },
};

/* ── knowledge helpers ── */
async function loadQuestionBank(): Promise<boolean> {
  const bank = await fetchQuestionBank();
  if (!bank) return false;
  st.kgItems.value = bank.items as typeof st.kgItems.value;
  return true;
}
export async function loadKnowledge(): Promise<void> {
  await loadQuestionBank();
  appState.set('csgraph', await appState.loadKnowledge(kg()));
  st.kgLoaded.value = true;
  st.bump();
}
const itemMatchesTarget = (it: Store): boolean =>
  st.kgTarget.value === 'all' ? true : (it.tags || []).includes(st.kgTarget.value);
export function allTargetItems(): Store[] {
  const out: Store[] = [];
  const items = st.kgItems.value;
  Object.keys(items).forEach((t) => (items[t] || []).forEach((it: Store) => itemMatchesTarget(it) && out.push(it)));
  return out;
}
export function allKGItems(): Store[] {
  const out: Store[] = [];
  const items = st.kgItems.value;
  Object.keys(items).forEach((tp) => (items[tp] || []).forEach((it: Store) => out.push(Object.assign({ topic: tp }, it))));
  return out;
}
export function dueItems(): Store[] {
  const byId: Record<string, Store> = {};
  allKGItems().forEach((it) => (byId[it.id] = it));
  return dueCards(Object.keys(byId), kg(), dstr())
    .map((c: Store) => byId[c.id])
    .filter(Boolean);
}
function scheduleCard(id: string, rating: Mastery): void {
  const K = kg();
  if (!K.srs) K.srs = {};
  K.srs[id] = srsSchedule(K.srs[id], rating, dstr());
}

/* ── knowledge actions ── */
export const knowledgeActions: KnowledgeActions = {
  selectTopic(id) {
    st.kgTopic.value = id;
    st.kgGym.value = false;
    st.kgRevealed.value = {};
    st.bump();
  },
  setTimeFilter(v) {
    st.kgTime.value = v;
    st.bump();
  },
  setTarget(v) {
    st.kgTarget.value = v;
    st.bump();
  },
  studyAllTagged() {
    st.kgTopic.value = '__target__';
    st.kgGym.value = false;
    st.bump();
  },
  startReview() {
    st.kgTopic.value = '__review__';
    st.kgTime.value = 'all';
    st.kgGym.value = false;
    st.bump();
  },
  toggleGym() {
    st.kgGym.value = !st.kgGym.value;
    if (st.kgGym.value) pushState(); // gym is a level deeper than questions
    st.bump();
  },
  toggleGymDone(key) {
    const K = kg();
    K.gymDone[key] = !K.gymDone[key];
    appState.markKnowledgeDirty();
    st.bump();
  },
  reveal(id) {
    st.kgRevealed.value = { ...st.kgRevealed.value, [id]: !st.kgRevealed.value[id] };
    st.bump();
  },
  queueForReview(id) {
    kg().srs[id] = { due: shiftDate(dstr(), 1), ivl: 1, ease: 2.3, n: 0 };
    appState.markKnowledgeDirty();
    st.bump();
  },
  rate(id, score) {
    const K = kg();
    K.mastery[id] = score;
    scheduleCard(id, score);
    const it = allKGItems().find((x) => x.id === id);
    K.log.push({ id: uid(), qid: id, at: Date.now(), rating: score, date: dstr(), topic: st.kgTopic.value });
    appState.markKnowledgeDirty();
    core().entries.push({
      id: uid(),
      date: dstr(),
      stream: 'kg',
      problem: it ? it.prompt.slice(0, 42) + '…' : id,
      topic: st.kgTopic.value,
      status: score >= 4 ? 'solved' : 'attempted',
      score,
      xp: score * 4,
    });
    appState.markDirty();
    st.bump();
  },
  async gradeWithAI(id) {
    const it = allKGItems().find((x) => x.id === id);
    const ans = host.readValue('ans-' + id) || '';
    const out = host.status('ai-' + id);
    if (!it) return;
    if (!ans.trim()) {
      out.set('Write an answer first.', 'bad');
      return;
    }
    out.set('Grading…', 'muted');
    const res = await aiCall({
      maxTokens: 1024,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content:
            'You are grading a technical interview answer. Question: ' +
            it.prompt +
            '\n\nModel answer: ' +
            it.reveal +
            '\n\nCandidate answer: ' +
            ans +
            '\n\nGive a 1-2 sentence assessment of what was right and what was missed, then on a new line output exactly: SCORE: N (where N is 1-5 recall quality). Be concise and honest.',
        },
      ],
    });
    if (!res.ok) {
      out.set(
        res.error === 'no proxy'
          ? 'Set up cloud sync (Data → Cloud backend) to enable AI grading.'
          : 'Grading failed: ' + res.error + ' — rate yourself after revealing.',
        'bad',
      );
      return;
    }
    const txt = res.text;
    const m = txt.match(/SCORE:\s*([1-5])/);
    let body = txt.replace(/SCORE:\s*[1-5]/, '').trim();
    st.kgRevealed.value = { ...st.kgRevealed.value, [id]: true };
    if (m) body += '  → AI suggests recall ' + m[1] + '/5.';
    out.set(body, 'plain');
    st.bump();
  },
  async answerWithAI(id) {
    const it = allKGItems().find((x) => x.id === id);
    const out = host.status('ai-' + id);
    if (!it) return;
    out.set('Answering…', 'muted');
    const res = await aiCall({
      maxTokens: 1024,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content:
            'Answer this technical interview question clearly and correctly, at the depth an interviewer would expect. Be concise.\n\nQuestion: ' +
            it.prompt,
        },
      ],
    });
    if (!res.ok) {
      out.set(
        res.error === 'no proxy'
          ? 'Set up cloud sync (Data → Cloud backend) to enable AI answers.'
          : 'AI answer failed: ' + res.error + '.',
        'bad',
      );
      return;
    }
    out.set(res.text.trim(), 'plain');
  },
  setChartPeriod(p) {
    st.progPeriod.value = p as import("@/ui/charts/progress").Period;
    st.bump();
  },
  setChartScale(s) {
    st.logScale.value = s === 'log';
    st.bump();
  },
  toggleLog() {
    st.kgLogOpen.value = !st.kgLogOpen.value;
    if (st.kgLogOpen.value) pushState();
    else st.kgGym.value = false;
    st.bump();
  },
};

/* ── meal ── */
export const MEAL_PRESETS: readonly MealPreset[] = [
  { label: 'Core Power Elite · 230 / 42g', name: 'Core Power Elite', cal: 230, protein: 42 },
  { label: 'Cook Unity · 900 / 40g', name: 'Cook Unity', cal: 900, protein: 40 },
];
export async function loadMeal(): Promise<void> {
  stores.surplus = await appState.loadMeal();
  st.sgLoaded.value = true;
  if (!st.sgDate.value) st.sgDate.value = dstr();
  st.bump();
}
export const mealActions: MealActions = {
  addMeal(name, cal, protein) {
    if (!name && !cal && !protein) {
      host.status('meal-status').set('Enter a meal name, or calories/protein.', 'bad');
      return;
    }
    const d = st.sgDate.value ?? dstr();
    st.sgDate.value = d;
    const G = sg();
    (G.days[d] = G.days[d] || []).push({ id: uid(), name: name || 'Meal', cal: +cal || 0, protein: +protein || 0, est: false });
    appState.markMealDirty();
    st.bump();
    ['meal-name', 'meal-cal', 'meal-pro'].forEach((k) => host.setValue(k, ''));
  },
  addPreset(name, cal, protein) {
    const d = st.sgDate.value ?? dstr();
    st.sgDate.value = d;
    const G = sg();
    (G.days[d] = G.days[d] || []).push({ id: uid(), name, cal, protein, est: false });
    appState.markMealDirty();
    st.bump();
  },
  deleteMeal(id) {
    const G = sg();
    const d = st.sgDate.value ?? dstr();
    appState.tomb(G, id);
    G.days[d] = (G.days[d] || []).filter((m: Store) => String(m.id) !== String(id));
    appState.markMealDirty();
    st.bump();
  },
  async estimateWithAI(desc) {
    if (!desc) return;
    const out = host.status('meal-eststatus');
    out.set('Asking DeepSeek…', 'muted');
    const res = await estimateMacros(desc);
    if ('error' in res) {
      out.set(res.error === 'no proxy' ? 'Set up cloud sync (Data → Cloud backend) to enable AI estimation.' : 'Estimate failed: ' + res.error + ' — enter macros manually.', 'bad');
      return;
    }
    const d = st.sgDate.value ?? dstr();
    st.sgDate.value = d;
    const G = sg();
    (G.days[d] = G.days[d] || []).push({ id: uid(), name: res.name, cal: res.cal, protein: res.protein, est: true });
    appState.markMealDirty();
    st.bump();
    out.set('✓ ' + res.cal + ' kcal · ' + res.protein + 'g', 'ok');
  },
  changeDate(which) {
    st.sgDate.value = which === 'today' ? dstr() : shiftDate(st.sgDate.value ?? dstr(), which === 'next' ? 1 : -1);
    st.bump();
  },
  editTargets() {
    const G = sg();
    const ask = (label: string, cur: Store) => {
      const v = host.prompt(label, String(cur ?? ''));
      return v === null || v === '' ? null : +v;
    };
    const c = ask('Current weight (lb):', G.settings.current); if (c !== null) G.settings.current = c;
    const g = ask('Goal weight (lb):', G.settings.goal); if (g !== null) G.settings.goal = g;
    const m = ask('Maintenance calories:', G.settings.maintenance); if (m !== null) G.settings.maintenance = m;
    const s = ask('Daily surplus (kcal):', G.settings.surplus); if (s !== null) G.settings.surplus = s;
    const p = ask('Protein target (g):', G.settings.proteinTarget); if (p !== null) G.settings.proteinTarget = p;
    appState.markMealDirty();
    st.bump();
  },
  adjustSupplement(delta) {
    const G = sg();
    const k = st.sgDate.value ?? dstr();
    if (!G.tad) G.tad = {};
    G.tad[k] = Math.max(0, (+G.tad[k] || 0) + delta);
    appState.markMealDirty();
    st.bump();
  },
  setChartPeriod(p) { st.progPeriod.value = p as import("@/ui/charts/progress").Period; st.bump(); },
  setChartScale(s) { st.logScale.value = s === 'log'; st.bump(); },
  toggleLog() { st.sgLogOpen.value = !st.sgLogOpen.value; if (st.sgLogOpen.value) pushState(); st.bump(); },
};

/* ── data ── */
function dmsg(text: string, bad?: boolean): void {
  st.dataMsg.value = { text, bad: !!bad };
  st.bump();
}
export const dataActions: DataActions = {
  savePantryId(url, key) {
    host.setItem('meridian_supabase_url', url);
    host.setItem('meridian_supabase_key', key);
    dmsg(url ? 'Saved. Cloud sync is ON — tap Test connection.' : 'Cleared. Cloud sync is OFF.');
  },
  async testConnection() {
    if (!cloudEnabled()) return dmsg('Add a Pantry ID first.', true);
    dmsg('Testing…');
    const r = await sync.save();
    dmsg(r.cloud === 'synced' || r.cloud === 'noop' ? '✓ Connection works. Cloud sync is live.' : 'Could not reach cloud: ' + ((r.cloudError && r.cloudError.message) || r.cloud), r.cloud === 'failed');
  },
  async push() {
    dmsg('Pushing…');
    const r = await sync.save();
    dmsg(r.cloud === 'synced' ? '✓ Pushed.' : r.cloud === 'noop' ? 'Already in sync.' : 'Push: ' + r.cloud, r.cloud === 'failed');
  },
  async pull() {
    dmsg('Pulling…');
    const applied = await sync.pull();
    dmsg(applied ? '✓ Pulled. Reloading…' : 'Already up to date.');
    if (applied) host.reload(700);
  },
  exportAll() {
    const bundle = exportBundle({ core: core(), overload: wk(), surplus: sg(), csgraph: kg() }, dstr());
    const text = serialise(bundle);
    dmsg('Exported all 4 stores.');
    host.setValue('d-io', text);
  },
  importPasted(text) {
    const r = importBundle(text);
    if (!r.ok) return dmsg('Import failed: ' + r.errors.join('; '), true);
    appState.set('core', r.state.core);
    appState.set('overload', r.state.overload);
    appState.set('surplus', r.state.surplus);
    appState.set('csgraph', r.state.csgraph);
    appState.markDirty();
    appState.markWorkoutDirty();
    appState.markMealDirty();
    void sync.save().then(() => {
      dmsg('✓ Imported' + (r.warnings.length ? ' (' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + ')' : '') + '. Reloading…');
      host.reload(800);
    });
  },
  async copyToClipboard() {
    const io = host.readValue('d-io');
    if (io) {
      const ok = await host.copy(io);
      dmsg(ok ? 'Copied.' : 'Copy failed — select and copy manually.', !ok);
    } else dmsg('Export first.', true);
  },
  importSingle(store, text) {
    if (!text.trim()) return dmsg('Paste a backup first.', true);
    let parsed: Store;
    try { parsed = JSON.parse(text); } catch (e: Store) { return dmsg('Invalid JSON: ' + e.message, true); }
    const key = store as StoreKey;
    if (key === 'overload') appState.set('overload', normaliseState({ overload: parsed }).overload);
    if (key === 'surplus') appState.set('surplus', normaliseState({ surplus: parsed }).surplus);
    if (key === 'core') appState.set('core', normaliseState({ core: parsed }).core);
    if (key === 'csgraph') appState.set('csgraph', normaliseState({ csgraph: parsed }).csgraph);
    appState.markDirty();
    appState.markWorkoutDirty();
    appState.markMealDirty();
    void sync.save().then(() => { dmsg('✓ Imported into ' + store + '. Reloading…'); host.reload(800); });
  },
  restoreSnapshot() {
    const raw = host.getItem('meridian_prev_snapshot');
    if (!raw) return dmsg('No snapshot found on this device.', true);
    try {
      const s = JSON.parse(raw);
      if (!host.confirm('Restore the snapshot taken ' + new Date(s.at).toLocaleString() + '?')) return;
      (['core', 'overload', 'surplus', 'csgraph'] as StoreKey[]).forEach((k) => { if (s[k]) host.setItem(STORAGE_KEYS[k], s[k]); });
      dmsg('✓ Restored. Reloading…');
      host.reload(700);
    } catch {
      dmsg('Snapshot unreadable.', true);
    }
  },
  showDiagnostics() {
    const out = host.status('d-diagout');
    out.set('Checking…');
    const metrics = storageMetrics(normaliseState({ core: core(), overload: wk(), surplus: sg(), csgraph: kg() }));
    const dirtyList = (['core', 'overload', 'surplus', 'csgraph'] as StoreKey[]).filter((k) => sync.isDirtyCloud(k));
    out.set('cloud: ' + (cloudEnabled() ? 'configured' : 'not configured') + '\n' + 'payload: ' + metrics.kilobytes + 'KB\n' + 'revision: ' + sync.baseRev() + '\n' + 'unsynced stores: ' + (dirtyList.length ? dirtyList.join(', ') : 'none') + '\n' + 'tombstones: ' + metrics.counts.tombstones + ' (cap 500)');
  },
};

/* ── todos (nested in the core store) ── */
export const todosActions = {
  add(text: string, due?: string): void {
    const t = text.trim();
    if (!t) return;
    const C = core();
    if (!C.todos) C.todos = [];
    C.todos.push({ id: uid(), text: t, done: false, due: due || undefined, created: Date.now() });
    appState.markDirty();
    st.bump();
    host.setValue('todo-text', '');
    host.setValue('todo-due', '');
  },
  toggle(id: string): void {
    const it = (core().todos || []).find((x: Store) => String(x.id) === String(id));
    if (it) { it.done = !it.done; appState.markDirty(); st.bump(); }
  },
  setDue(id: string, due: string): void {
    const it = (core().todos || []).find((x: Store) => String(x.id) === String(id));
    if (it) { it.due = due || undefined; appState.markDirty(); st.bump(); }
  },
  editText(id: string, text: string): void {
    const t = text.trim();
    if (!t) return;
    const it = (core().todos || []).find((x: Store) => String(x.id) === String(id));
    if (it) { it.text = t; appState.markDirty(); st.bump(); }
  },
  remove(id: string): void {
    const C = core();
    appState.tomb(C, id);
    C.todos = (C.todos || []).filter((x: Store) => String(x.id) !== String(id));
    appState.markDirty();
    st.bump();
  },
};

/* ── scratchpad idea cards (nested in the core store) ── */
export const scratchActions = {
  add(title: string, body: string): void {
    const t = title.trim();
    const b = body.trim();
    if (!t && !b) return;
    const C = core();
    if (!C.scratch) C.scratch = [];
    const now = Date.now();
    C.scratch.push({ id: uid(), title: t || 'Untitled', body: b, status: 'idea', created: now, updated: now });
    appState.markDirty();
    st.bump();
    host.setValue('scratch-title', '');
    host.setValue('scratch-body', '');
  },
  edit(id: string, patch: { title?: string; body?: string }): void {
    const c = (core().scratch || []).find((x: Store) => String(x.id) === String(id));
    if (!c) return;
    if (patch.title !== undefined) c.title = patch.title.trim() || 'Untitled';
    if (patch.body !== undefined) c.body = patch.body;
    c.updated = Date.now();
    appState.markDirty();
    st.bump();
  },
  cycleStatus(id: string): void {
    const c = (core().scratch || []).find((x: Store) => String(x.id) === String(id));
    if (!c) return;
    c.status = nextStatus(c.status);
    // Deliberately do NOT touch `updated`: the list sorts by newest-updated, so
    // bumping it here would jump the card to the top on every tap.
    appState.markDirty();
    st.bump();
  },
  /** Set a card's status directly (upgrade or downgrade on the fly) — no cycling. */
  setStatus(id: string, status: string): void {
    const c = (core().scratch || []).find((x: Store) => String(x.id) === String(id));
    if (!c) return;
    c.status = status;
    appState.markDirty();
    st.bump();
  },
  remove(id: string): void {
    const C = core();
    appState.tomb(C, id);
    C.scratch = (C.scratch || []).filter((x: Store) => String(x.id) !== String(id));
    appState.markDirty();
    st.bump();
  },
};

/* ── hub + navigation ── */
export function hubStats(): HubStat[] {
  const today = dstr();
  const K = kg();
  const attempted = Object.keys(K.mastery ?? {}).length;
  const mastered = Object.values(K.mastery ?? {}).filter((r: Store) => Number(r) >= 4).length;
  const masteryPct = attempted ? Math.round((100 * mastered) / attempted) : 0;
  const W = wk();
  const wkd = (W.days ?? {}) as Record<string, Store[]>;
  const [ty, tm, td] = today.split('-').map(Number);
  const base = new Date(ty!, (tm ?? 1) - 1, td!);
  base.setDate(base.getDate() - 6);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const weekAgo = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  const wkDays = Object.keys(wkd).filter((d) => d >= weekAgo && d <= today && (wkd[d]?.length ?? 0) > 0).length;
  const G = sg();
  const todayCal = ((G.days?.[today] ?? []) as Store[]).reduce((a: number, m: Store) => a + (+m.cal || 0), 0);
  const dirty = (['core', 'overload', 'surplus', 'csgraph'] as StoreKey[]).some((k) => sync.isDirtyCloud(k));
  const state = normaliseState({ core: core(), overload: W, surplus: G, csgraph: K });
  const kb = Math.round(JSON.stringify(state).length / 102.4) / 10;
  const C = core();
  const openTodos = todoOpenCount(C);
  const dueToday = dueTodos(C, today).length;
  const notes = scratchCardCount(C);
  return [
    { key: 'todos', label: 'Todos', desc: 'Reminders & tasks', value: String(openTodos), unit: openTodos === 1 ? ' open' : ' open', sub: dueToday ? `${dueToday} due today` : openTodos ? 'to do' : 'all clear', tone: dueToday ? 'kcal' : '' },
    { key: 'scratch', label: 'Scratchpad', desc: 'Ideas & experiments', value: String(notes), unit: notes === 1 ? ' note' : ' notes', sub: 'captured', tone: '' },
    { key: 'knowledge', label: 'Knowledge', desc: 'Study & spaced review', value: String(masteryPct), unit: '%', sub: 'mastery', tone: 'cyan' },
    { key: 'workout', label: 'Workout', desc: 'Training log & progression', value: String(wkDays), unit: wkDays === 1 ? ' day' : ' days', sub: 'this week', tone: '' },
    { key: 'meal', label: 'Food & Body', desc: 'Calories & bodyweight', value: todayCal.toLocaleString('en-US'), unit: ' kcal', sub: todayCal ? 'today' : 'not logged', tone: 'kcal' },
    { key: 'data', label: 'Data', desc: 'Sync, storage & export', value: cloudEnabled() ? (dirty ? 'Unsaved' : 'Synced') : 'Local', unit: '', sub: `${kb} KB`, tone: !cloudEnabled() || dirty ? '' : 'ok', dot: cloudEnabled() && !dirty },
  ];
}

/** Ensure a tab's store is loaded (called by the tab component on mount). */
export function ensureLoaded(tab: st.Tab): void {
  if (tab === 'today') loadForHome();
  else if (tab === 'workout' && !st.wkLoaded.value) void loadWorkout();
  else if (tab === 'knowledge' && !st.kgLoaded.value) void loadKnowledge();
  else if (tab === 'meal' && !st.sgLoaded.value) void loadMeal();
}

/** Return to the Today home (the pill-Back target for trackers). */
export function goHome(): void {
  st.currentTab.value = 'today';
  loadForHome();
}

/** Drill into a tracker section (from Today's at-a-glance); pushes history for back. */
export function openSection(tab: st.Tab): void {
  st.currentTab.value = tab;
  ensureLoaded(tab);
  pushState();
}


export function toggleControls(): void {
  st.controlsOpen.value = !st.controlsOpen.value;
  st.bump();
}
export function toggleMealExtras(): void {
  st.sgExtrasOpen.value = !st.sgExtrasOpen.value;
  st.bump();
}
export function discarded(): void {
  restTimer.stop(true);
  st.bump();
}
export function discard(): void {
  if (appState.anyDirty() && host.confirm('Discard all unsaved changes and return to the last saved state?')) {
    void appState.discard().then((ok) => {
      if (ok) {
        discarded();
        host.flashSaved();
      }
    });
  }
}
export function handleBack(): boolean {
  if (st.currentTab.value === 'meal' && st.sgLogOpen.value) { st.sgLogOpen.value = false; st.bump(); return true; }
  if (st.currentTab.value === 'knowledge' && st.kgGym.value) { st.kgGym.value = false; st.bump(); return true; }
  if (st.currentTab.value === 'knowledge' && st.kgLogOpen.value) { st.kgLogOpen.value = false; st.bump(); return true; }
  if (st.currentTab.value !== 'today') { goHome(); return true; }
  return false;
}

/** Load every tracker store (Today's at-a-glance needs all three). Called on mount. */
export function loadForHome(): void {
  const pending: Array<Promise<void>> = [];
  if (!st.wkLoaded.value) pending.push(loadWorkout());
  if (!st.kgLoaded.value) pending.push(loadKnowledge());
  if (!st.sgLoaded.value) pending.push(loadMeal());
  if (pending.length) void Promise.all(pending.map((p) => p.catch(() => undefined))).then(() => st.bump());
}

/* ── Today: clock + weather ── */
export function tickClock(): void {
  st.clockNow.value = Date.now();
}
export async function refreshWeather(): Promise<void> {
  const w = await loadWeather(Date.now());
  if (w) st.weather.value = w;
}
export function setWeatherCity(): void {
  const c = host.prompt('City for weather (leave blank to use my location)', savedCity());
  if (c === null) return;
  setSavedCity(c.trim());
  void refreshWeather();
}
