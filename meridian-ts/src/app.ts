/**
 * app — the view-mounting + rendering orchestration.
 *
 * Owns the four tab views (workout / meal / knowledge / data): their view-only
 * state (selected date, split, topic, filters, reveal flags), the rest-timer,
 * and the `render*` functions that build each view-model and repaint through the
 * typed view controllers. Everything that touches the DOM goes through the
 * {@link AppHost} port; store reads/writes go through {@link AppState}; and the
 * derivations (workout plan, SRS, meal totals, export) stay in the proven core
 * behind `ctx.MC`.
 *
 * This is a faithful move of the inline view code from index.html — glue, not
 * logic — so the store/item shapes are loosely typed on purpose.
 */

import { RestTimer } from './restTimer.js';
import { domId } from './html.js';
import type { AppHost } from './appHost.js';
import type { AppState, StoreKey } from './appState.js';

/* The MeridianCore api surface consumed here; loosely typed (the pieces it calls
   are individually typed + tested in their own modules). */
type Core = any;
type Any = any;

export interface AppCtx {
  MC: Core;
  appState: AppState;
  keys: Record<StoreKey, string>;
  uid(): string;
  today(): string;
  now(): number;
  dateLabel(ds: string): string;
  cloudEnabled(): boolean;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

export interface AppController {
  renderWorkout(): void;
  renderKnowledge(): void;
  renderWeight(): void;
  renderData(): void;
  renderAll(): void;
}

export function createApp(host: AppHost, ctx: AppCtx): AppController {
  const MC = ctx.MC;
  const S = ctx.appState;
  const uid = ctx.uid;
  const dstr = ctx.today;
  const dLabel = ctx.dateLabel;

  // Live store objects — safe to mutate in place (same reference the engine sees).
  const core = (): Any => S.get('core');
  const wk = (): Any => S.get('overload');
  const sg = (): Any => S.get('surplus');
  const kg = (): Any => S.get('csgraph');

  /* ---------------- static build-time content ---------------- */
  const KG_BOOKS = MC.data.books;
  const KG_TOPICS = MC.data.topics;
  const KG_GYM = MC.data.gym;
  const KG_TARGETS = MC.data.targets;
  const EX_VIDEO = MC.data.exVideo;

  /* ---------------- rest timer ---------------- */
  const restTimer = new RestTimer({
    bar: host.restBar,
    now: ctx.now,
    setInterval: ctx.setInterval,
    clearInterval: ctx.clearInterval,
    onVisibleStop: () => renderWorkout(),
  });

  /* ================= WORKOUT ================= */
  let wkView: Any = null;
  let wkLoaded = false;
  let wkDate: string | null = null;
  let wkSplit = 'all';
  let wkSplitTouched = false;
  const wkDeload: Record<string, boolean> = {};

  const yt = (q: string): string =>
    'https://www.youtube.com/results?search_query=' + encodeURIComponent(q + ' proper form technique');
  const exVideo = (ex: string): string => EX_VIDEO[ex] || yt(ex);
  const daysSorted = (): string[] => Object.keys(wk().days).sort();
  const exSessions = (ex: string): string[] =>
    daysSorted().filter((d) => (wk().days[d] || []).some((s: Any) => s.ex === ex));
  function exMeta(ex: string): { muscle: string; group: string } {
    const ds = exSessions(ex);
    for (let i = ds.length - 1; i >= 0; i--) {
      const s = (wk().days[ds[i]] || []).find((x: Any) => x.ex === ex);
      if (s) return { muscle: s.muscle || '', group: s.group || '' };
    }
    return { muscle: '', group: '' };
  }
  const currentBW = (): Any => {
    const ds = Object.keys(wk().bw || {}).sort();
    return ds.length ? wk().bw[ds[ds.length - 1]] : wk().settings.bwCurrent || null;
  };
  const restSecs = (ex: string, type: string): number => MC.restSeconds(wk(), ex, type);

  async function wkLoad(): Promise<void> {
    S.set('overload', await S.loadWorkout());
    wkLoaded = true;
    if (!wkDate) wkDate = dstr();
  }

  function ensureWorkoutView(): Any {
    if (wkView) return wkView;
    wkView = MC.mountWorkoutView({
      container: host.pane('workout'),
      videoUrl: exVideo,
      dateLabel: dLabel,
      actions: {
        logSet(ex: string, type: string, weight: Any, reps: Any) {
          if (!ex || !weight || !reps) return;
          const W = wk();
          const td = wkDate || dstr();
          if (!W.days[td]) W.days[td] = [];
          const m = exMeta(ex);
          W.days[td].push({ id: uid(), ex, muscle: m.muscle || '', group: m.group || '', type, weight, reps });
          S.markWorkoutDirty();
          // auto-complete: tick the exercise once every prescribed set is in
          const planned = MC.selectWorkoutView(W, td, dstr(), { deload: wkDeload }).plans[ex];
          const need = planned && !planned.cardio ? planned.warms.length + 1 + planned.backs.length : 1;
          if (W.days[td].filter((s: Any) => s.ex === ex).length >= need) {
            if (!W.done) W.done = {};
            if (!W.done[td]) W.done[td] = [];
            if (W.done[td].indexOf(ex) < 0) W.done[td].push(ex);
            restTimer.dismissFor(ex);
          }
          wkView.clearEdits(domId(ex));
          renderWorkout();
        },
        deleteSet(date: string, id: Any) {
          const W = wk();
          S.tomb(W, id);
          W.days[date] = (W.days[date] || []).filter((s: Any) => String(s.id) !== String(id));
          S.markWorkoutDirty();
          renderWorkout();
        },
        toggleExerciseDone(ex: string) {
          const W = wk();
          const k = wkDate || dstr();
          if (!W.done) W.done = {};
          if (!W.done[k]) W.done[k] = [];
          const i = W.done[k].indexOf(ex);
          if (i >= 0) W.done[k].splice(i, 1);
          else {
            W.done[k].push(ex);
            restTimer.dismissFor(ex);
          }
          S.markWorkoutDirty();
          renderWorkout();
        },
        toggleSessionDone() {
          const W = wk();
          const k = wkDate || dstr();
          if (!W.sessionDone) W.sessionDone = {};
          W.sessionDone[k] = !W.sessionDone[k];
          if (W.sessionDone[k]) restTimer.stop(true);
          S.markWorkoutDirty();
          renderWorkout();
          void S.save();
        },
        toggleDeload(ex: string) {
          wkDeload[ex] = !wkDeload[ex];
          renderWorkout();
        },
        editIncrement(ex: string) {
          const W = wk();
          const cur = MC.inferIncrement(W, ex);
          const v = host.prompt(
            'Smallest weight step for ' +
              ex +
              ' at your gym (lb).\n\nPlate-loaded: 5 or 10. Selectorized stack: often 10, 12.5, 15 or 20.',
            String(cur),
          );
          if (v === null || v === '') return;
          if (!W.incr) W.incr = {};
          W.incr[ex] = Math.max(1, +v || 5);
          S.markWorkoutDirty();
          renderWorkout();
        },
        startRest(ex: string, type: string) {
          restTimer.start(ex, type, restSecs(ex, type));
        },
        undoLastSet(ex: string) {
          const W = wk();
          const td = wkDate || dstr();
          if (!W.days[td]) return;
          const sets = W.days[td];
          for (let i = sets.length - 1; i >= 0; i--) {
            if (sets[i].ex === ex) {
              sets.splice(i, 1);
              S.markWorkoutDirty();
              if (W.done && W.done[td]) W.done[td] = W.done[td].filter((e: Any) => e !== ex);
              renderWorkout();
              return;
            }
          }
        },
        changeDate(which: string) {
          wkDate = which === 'today' ? dstr() : MC.shiftDate(wkDate || dstr(), which === 'next' ? 1 : -1);
          wkSplitTouched = false;
          renderWorkout();
        },
        changeSplit(split: string) {
          wkSplit = split;
          wkSplitTouched = true;
          renderWorkout();
        },
        logBodyweight(v: Any) {
          if (!v) return;
          const W = wk();
          W.bw[wkDate || dstr()] = v;
          if (!W.settings.bwCurrent) W.settings.bwCurrent = v;
          S.markWorkoutDirty();
          renderWorkout();
        },
      },
    });
    return wkView;
  }

  function renderWorkout(): void {
    if (!wkLoaded) {
      host.pane('workout').innerHTML = '<div class="empty">Loading…</div>';
      void wkLoad().then(() => renderWorkout());
      return;
    }
    const W = wk();
    const today = dstr();
    ensureWorkoutView().repaint(
      W,
      wkDate || today,
      today,
      { deload: wkDeload, split: wkSplitTouched ? wkSplit : undefined },
      { current: currentBW(), goal: +W.settings.bwGoal || null },
    );
  }

  /* ================= KNOWLEDGE ================= */
  let kgView: Any = null;
  let kgLoaded = false;
  let kgTopic = 'algorithms';
  let kgTime = 'all';
  let kgGym = false;
  let kgTarget = 'all';
  let kgRevealed: Record<string, boolean> = {};
  let KG_ITEMS: Record<string, Any[]> = {};

  async function loadQuestionBank(): Promise<boolean> {
    const bank = await MC.fetchQuestionBank();
    if (!bank) return false;
    KG_ITEMS = bank.items;
    return true;
  }
  async function kgLoad(): Promise<void> {
    await loadQuestionBank();
    S.set('csgraph', await S.loadKnowledge(kg()));
    kgLoaded = true;
  }

  const itemMatchesTarget = (it: Any): boolean =>
    kgTarget === 'all' ? true : (it.tags || []).includes(kgTarget);
  function allTargetItems(): Any[] {
    const out: Any[] = [];
    Object.keys(KG_ITEMS).forEach((t) => (KG_ITEMS[t] || []).forEach((it) => itemMatchesTarget(it) && out.push(it)));
    return out;
  }
  function allKGItems(): Any[] {
    const out: Any[] = [];
    Object.keys(KG_ITEMS).forEach((tp) => (KG_ITEMS[tp] || []).forEach((it) => out.push(Object.assign({ topic: tp }, it))));
    return out;
  }
  function dueItems(): Any[] {
    const byId: Record<string, Any> = {};
    allKGItems().forEach((it) => (byId[it.id] = it));
    return MC.dueCards(Object.keys(byId), kg(), dstr())
      .map((c: Any) => byId[c.id])
      .filter(Boolean);
  }
  function schedule(id: string, rating: number): Any {
    const K = kg();
    if (!K.srs) K.srs = {};
    const next = MC.schedule(K.srs[id], rating, dstr());
    K.srs[id] = next;
    return next;
  }

  function ensureKnowledgeView(): Any {
    if (kgView) return kgView;
    kgView = MC.mountKnowledgeView(host.pane('knowledge'), {
      selectTopic(id: string) {
        kgTopic = id;
        kgGym = false;
        kgRevealed = {};
        renderKnowledge();
      },
      setTimeFilter(v: string) {
        kgTime = v;
        renderKnowledge();
      },
      setTarget(v: string) {
        kgTarget = v;
        renderKnowledge();
      },
      studyAllTagged() {
        kgTopic = '__target__';
        kgGym = false;
        renderKnowledge();
      },
      startReview() {
        kgTopic = '__review__';
        kgTime = 'all';
        kgGym = false;
        renderKnowledge();
      },
      toggleGym() {
        kgGym = !kgGym;
        renderKnowledge();
      },
      toggleGymDone(key: string) {
        const K = kg();
        K.gymDone[key] = !K.gymDone[key];
        S.markKnowledgeDirty();
        renderKnowledge();
      },
      reveal(id: string) {
        kgRevealed[id] = !kgRevealed[id];
        renderKnowledge();
      },
      queueForReview(id: string) {
        kg().srs[id] = { due: MC.shiftDate(dstr(), 1), ivl: 1, ease: 2.3, n: 0 };
        S.markKnowledgeDirty();
        renderKnowledge();
      },
      rate(id: string, score: number) {
        const K = kg();
        K.mastery[id] = score;
        schedule(id, score);
        const it = allKGItems().find((x) => x.id === id);
        K.log.push({ id: uid(), qid: id, at: ctx.now(), rating: score, date: dstr(), topic: kgTopic });
        S.markKnowledgeDirty();
        core().entries.push({
          id: uid(),
          date: dstr(),
          stream: 'kg',
          problem: it ? it.prompt.slice(0, 42) + '…' : id,
          topic: kgTopic,
          status: score >= 4 ? 'solved' : 'attempted',
          score,
          xp: score * 4,
        });
        S.markDirty();
        renderKnowledge();
      },
      async gradeWithAI(id: string) {
        const it = allKGItems().find((x) => x.id === id);
        const ans = host.readValue('ans-' + id) || '';
        const out = host.status('ai-' + id);
        if (!it) return;
        if (!ans.trim()) {
          out.set('Write an answer first.', 'bad');
          return;
        }
        out.set('Grading…', 'muted');
        const res = await MC.aiCall({
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
        kgRevealed[id] = true;
        if (m) body += '  → AI suggests recall ' + m[1] + '/5.';
        out.set(body, 'plain');
        renderKnowledge();
      },
      async answerWithAI(id: string) {
        const it = allKGItems().find((x) => x.id === id);
        const out = host.status('ai-' + id);
        if (!it) return;
        out.set('Answering…', 'muted');
        const res = await MC.aiCall({
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
    });
    return kgView;
  }

  function renderKnowledge(): void {
    if (!kgLoaded) {
      host.pane('knowledge').innerHTML = '<div class="empty">Loading…</div>';
      void kgLoad().then(renderKnowledge);
      return;
    }
    const K = kg();
    const items =
      kgTopic === '__review__' ? dueItems() : kgTopic === '__target__' ? allTargetItems() : KG_ITEMS[kgTopic] || [];
    const shown = items.filter(
      (it: Any) => (kgTime === 'all' || String(it.mins) === kgTime) && itemMatchesTarget(it),
    );
    const topic = KG_TOPICS.find((t: Any) => t.id === kgTopic);
    const gm = kgGym && KG_GYM[kgTopic] ? KG_GYM[kgTopic] : null;
    const link = (pair: Any, kind: string, i: number) => ({
      label: pair[0],
      url: pair[1],
      key: kgTopic + '|' + kind + '|' + i,
      done: !!K.gymDone[kgTopic + '|' + kind + '|' + i],
    });

    ensureKnowledgeView().repaint({
      topicId: kgTopic,
      topics: KG_TOPICS.map((tp: Any) => {
        const arr = KG_ITEMS[tp.id] || [];
        const mastered = arr.filter((it: Any) => (K.mastery[it.id] || 0) >= 4).length;
        return {
          id: tp.id,
          name: tp.name,
          books: tp.books,
          total: arr.length,
          mastered,
          percent: arr.length ? Math.round((100 * mastered) / arr.length) : 0,
        };
      }),
      items: shown.map((it: Any) => {
        const b = KG_BOOKS[it.src.book] || {};
        return { ...it, src: { ...it.src, title: b.t, url: b.u } };
      }),
      mastery: K.mastery,
      dueCount: dueItems().length,
      timeFilter: kgTime,
      target: kgTarget,
      targets: KG_TARGETS,
      targetCount: allTargetItems().length,
      gymMode: !!gm,
      gym: gm
        ? {
            concepts: (gm.concepts || []).map((v: Any, i: number) => link(v, 'c', i)),
            practice: (gm.practice || []).map((v: Any, i: number) => link(v, 'p', i)),
            reading: (gm.reading || []).map((r: Any, i: number) => {
              const b = KG_BOOKS[r[0]];
              return { label: r[1], url: b ? b.u : '#', key: kgTopic + '|r|' + i, done: !!K.gymDone[kgTopic + '|r|' + i] };
            }),
          }
        : null,
      sources: (topic && topic.books ? topic.books : [])
        .map((bk: Any) => {
          const b = KG_BOOKS[bk];
          return b ? { title: b.t, url: b.u } : null;
        })
        .filter(Boolean),
      revealed: kgRevealed,
    });
  }

  /* ================= MEAL (weight-gain) ================= */
  let mealView: Any = null;
  let sgLoaded = false;
  let sgDate: string | null = null;

  async function sgLoad(): Promise<void> {
    S.set('surplus', await S.loadMeal());
    sgLoaded = true;
    if (!sgDate) sgDate = dstr();
  }

  function ensureMealView(): Any {
    if (mealView) return mealView;
    mealView = MC.mountMealView(
      host.pane('meal'),
      {
        addMeal(name: string, cal: Any, protein: Any) {
          if (!name && !cal && !protein) {
            host.status('meal-status').set('Enter a meal name, or calories/protein.', 'bad');
            return;
          }
          if (!sgDate) sgDate = dstr();
          const G = sg();
          (G.days[sgDate] = G.days[sgDate] || []).push({
            id: uid(),
            name: name || 'Meal',
            cal: +cal || 0,
            protein: +protein || 0,
            est: false,
          });
          S.markMealDirty();
          renderWeight();
          ['meal-name', 'meal-cal', 'meal-pro'].forEach((k) => host.setValue(k, ''));
        },
        addPreset(name: string, cal: Any, protein: Any) {
          if (!sgDate) sgDate = dstr();
          const G = sg();
          (G.days[sgDate] = G.days[sgDate] || []).push({ id: uid(), name, cal, protein, est: false });
          S.markMealDirty();
          renderWeight();
        },
        deleteMeal(id: Any) {
          const G = sg();
          S.tomb(G, id);
          G.days[sgDate!] = (G.days[sgDate!] || []).filter((m: Any) => String(m.id) !== String(id));
          S.markMealDirty();
          renderWeight();
        },
        async estimateWithAI(desc: string) {
          if (!desc) return;
          const st = host.status('meal-eststatus');
          st.set('Asking DeepSeek…', 'muted');
          const res = await MC.estimateMacros(desc);
          if (res.error) {
            st.set(
              res.error === 'no proxy'
                ? 'Set up cloud sync (Data → Cloud backend) to enable AI estimation.'
                : 'Estimate failed: ' + res.error + ' — enter macros manually.',
              'bad',
            );
            return;
          }
          if (!sgDate) sgDate = dstr();
          const G = sg();
          (G.days[sgDate] = G.days[sgDate] || []).push({
            id: uid(),
            name: res.name,
            cal: res.cal,
            protein: res.protein,
            est: true,
          });
          S.markMealDirty();
          renderWeight();
          st.set('✓ ' + res.cal + ' kcal · ' + res.protein + 'g', 'ok');
        },
        changeDate(which: string) {
          sgDate = which === 'today' ? dstr() : MC.shiftDate(sgDate || dstr(), which === 'next' ? 1 : -1);
          renderWeight();
        },
        editTargets() {
          const G = sg();
          const ask = (label: string, cur: Any) => {
            const v = host.prompt(label, String(cur ?? ''));
            return v === null || v === '' ? null : +v;
          };
          const c = ask('Current weight (lb):', G.settings.current);
          if (c !== null) G.settings.current = c;
          const g = ask('Goal weight (lb):', G.settings.goal);
          if (g !== null) G.settings.goal = g;
          const m = ask('Maintenance calories:', G.settings.maintenance);
          if (m !== null) G.settings.maintenance = m;
          const s = ask('Daily surplus (kcal):', G.settings.surplus);
          if (s !== null) G.settings.surplus = s;
          const p = ask('Protein target (g):', G.settings.proteinTarget);
          if (p !== null) G.settings.proteinTarget = p;
          S.markMealDirty();
          renderWeight();
        },
        adjustSupplement(delta: number) {
          const G = sg();
          const k = sgDate || dstr();
          if (!G.tad) G.tad = {};
          G.tad[k] = Math.max(0, (+G.tad[k] || 0) + delta);
          S.markMealDirty();
          renderWeight();
        },
      },
      {
        dateLabel: dLabel,
        presets: [
          { label: 'Core Power Elite · 230 / 42g', name: 'Core Power Elite', cal: 230, protein: 42 },
          { label: 'Cook Unity · 900 / 40g', name: 'Cook Unity', cal: 900, protein: 40 },
        ],
      },
    );
    return mealView;
  }

  function renderWeight(): void {
    if (!sgLoaded) {
      host.pane('meal').innerHTML = '<div class="empty">Loading…</div>';
      void sgLoad().then(renderWeight);
      return;
    }
    if (!sgDate) sgDate = dstr();
    ensureMealView().repaint(sg(), sgDate, dstr());
  }

  /* ================= DATA ================= */
  let dataView: Any = null;
  let dataMsg = { text: '', bad: false };
  function dmsg(text: string, bad?: boolean): void {
    dataMsg = { text, bad: !!bad };
    renderData();
  }

  function ensureDataView(): Any {
    if (dataView) return dataView;
    dataView = MC.mountDataView(host.pane('data'), {
      savePantryId(url: string, key: string) {
        host.setItem('meridian_supabase_url', url);
        host.setItem('meridian_supabase_key', key);
        dmsg(url ? 'Saved. Cloud sync is ON — tap Test connection.' : 'Cleared. Cloud sync is OFF.');
      },
      async testConnection() {
        if (!ctx.cloudEnabled()) return dmsg('Add a Pantry ID first.', true);
        dmsg('Testing…');
        const r = await MC.sync.save();
        dmsg(
          r.cloud === 'synced' || r.cloud === 'noop'
            ? '✓ Connection works. Cloud sync is live.'
            : 'Could not reach cloud: ' + ((r.cloudError && r.cloudError.message) || r.cloud),
          r.cloud === 'failed',
        );
      },
      async push() {
        dmsg('Pushing…');
        const r = await MC.sync.save();
        dmsg(
          r.cloud === 'synced' ? '✓ Pushed.' : r.cloud === 'noop' ? 'Already in sync.' : 'Push: ' + r.cloud,
          r.cloud === 'failed',
        );
      },
      async pull() {
        dmsg('Pulling…');
        const applied = await MC.sync.pull();
        dmsg(applied ? '✓ Pulled. Reloading…' : 'Already up to date.');
        if (applied) host.reload(700);
      },
      exportAll() {
        const bundle = MC.exportBundle({ core: core(), overload: wk(), surplus: sg(), csgraph: kg() }, dstr());
        const text = MC.serialise(bundle);
        // dmsg re-renders the pane (fresh, empty textarea); populate it AFTER so the
        // export text survives the repaint. (Legacy set the value first, so the very
        // first export — which changes the status message — wiped it. BUG-3.)
        dmsg('Exported all 4 stores.');
        host.setValue('d-io', text);
      },
      importPasted(text: string) {
        const r = MC.importBundle(text);
        if (!r.ok) return dmsg('Import failed: ' + r.errors.join('; '), true);
        S.set('core', r.state.core);
        S.set('overload', r.state.overload);
        S.set('surplus', r.state.surplus);
        S.set('csgraph', r.state.csgraph);
        S.markDirty();
        S.markWorkoutDirty();
        S.markMealDirty();
        void MC.sync.save().then(() => {
          dmsg(
            '✓ Imported' +
              (r.warnings.length ? ' (' + r.warnings.length + ' warning' + (r.warnings.length > 1 ? 's' : '') + ')' : '') +
              '. Reloading…',
          );
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
      importSingle(store: StoreKey, text: string) {
        if (!text.trim()) return dmsg('Paste a backup first.', true);
        let parsed: Any;
        try {
          parsed = JSON.parse(text);
        } catch (e: Any) {
          return dmsg('Invalid JSON: ' + e.message, true);
        }
        if (store === 'overload') S.set('overload', MC.normaliseState({ overload: parsed }).overload);
        if (store === 'surplus') S.set('surplus', MC.normaliseState({ surplus: parsed }).surplus);
        if (store === 'core') S.set('core', MC.normaliseState({ core: parsed }).core);
        if (store === 'csgraph') S.set('csgraph', MC.normaliseState({ csgraph: parsed }).csgraph);
        S.markDirty();
        S.markWorkoutDirty();
        S.markMealDirty();
        void MC.sync.save().then(() => {
          dmsg('✓ Imported into ' + store + '. Reloading…');
          host.reload(800);
        });
      },
      restoreSnapshot() {
        // The snapshot writer was removed in an earlier cleanup, so this key is never
        // set; report gracefully instead of throwing (legacy called an undefined lsGet).
        const raw = host.getItem('meridian_prev_snapshot');
        if (!raw) return dmsg('No snapshot found on this device.', true);
        try {
          const s = JSON.parse(raw);
          if (!host.confirm('Restore the snapshot taken ' + new Date(s.at).toLocaleString() + '?')) return;
          (['core', 'overload', 'surplus', 'csgraph'] as StoreKey[]).forEach((k) => {
            if (s[k]) host.setItem(ctx.keys[k], s[k]);
          });
          dmsg('✓ Restored. Reloading…');
          host.reload(700);
        } catch {
          dmsg('Snapshot unreadable.', true);
        }
      },
      showDiagnostics() {
        const out = host.status('d-diagout');
        out.set('Checking…');
        const metrics = MC.storageMetrics(MC.normaliseState({ core: core(), overload: wk(), surplus: sg(), csgraph: kg() }));
        const dirtyList = (['core', 'overload', 'surplus', 'csgraph'] as StoreKey[]).filter((k) =>
          MC.sync.isDirtyCloud(k),
        );
        out.set(
          'cloud: ' +
            (ctx.cloudEnabled() ? 'configured' : 'not configured') +
            '\n' +
            'payload: ' +
            metrics.kilobytes +
            'KB\n' +
            'revision: ' +
            MC.sync.baseRev() +
            '\n' +
            'unsynced stores: ' +
            (dirtyList.length ? dirtyList.join(', ') : 'none') +
            '\n' +
            'tombstones: ' +
            metrics.counts.tombstones +
            ' (cap 500)',
        );
      },
    });
    return dataView;
  }

  function renderData(): void {
    const state = MC.normaliseState({ core: core(), overload: wk(), surplus: sg(), csgraph: kg() });
    ensureDataView().repaint({
      metrics: MC.storageMetrics(state),
      payloadKb: Math.round(JSON.stringify(state).length / 102.4) / 10,
      sync: {
        cloudConfigured: ctx.cloudEnabled(),
        pantryId: (() => {
          const u = host.getItem('meridian_supabase_url');
          return u ? u.split('//')[1]?.split('.')[0] + '...' : '';
        })(),
        baseRev: MC.sync.baseRev(),
        dirtyStores: (['core', 'overload', 'surplus', 'csgraph'] as StoreKey[]).filter((k) => MC.sync.isDirtyCloud(k)),
        lastMessage: dataMsg.text,
        lastMessageBad: dataMsg.bad,
      },
      model: {
        configured: ctx.cloudEnabled(),
        model: 'DeepSeek v4 Pro',
        keyPreview: '',
      },
    });
  }

  /* Repaint every tab (after a cloud pull merges new data). Each isolated so one
     failing render can't abort the rest. */
  function renderAll(): void {
    try {
      renderKnowledge();
    } catch {
      /* isolated */
    }
    try {
      renderWorkout();
    } catch {
      /* isolated */
    }
    try {
      renderWeight();
    } catch {
      /* isolated */
    }
    try {
      renderData();
    } catch {
      /* isolated */
    }
  }

  return { renderWorkout, renderKnowledge, renderWeight, renderData, renderAll };
}
