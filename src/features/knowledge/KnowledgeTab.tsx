/**
 * Knowledge tab — Progress (charts) → Questions → Gym, nested. Ports the knowledge
 * VM builder (app.ts) + renderKnowledgeHTML/Body/Card to JSX. The single top-left
 * back button walks up one level (handled by App's back-stack).
 */
import { useEffect } from 'preact/hooks';
import { DATA } from '@/core/data/index';
import type { KnowledgeViewModel, KnowledgeItem, GymLink } from '@/features/knowledge/types';
import { masterySeries, questionsSolvedSeries, xpSeries, studyDaysSeries, currentStreak } from '@/ui/charts/progress';
import { ProgControls, Carousel, Chart, ViewLogCta } from '@/ui/components/Charts';
import { SecHero } from '@/ui/components/SecHero';
import { kg, core, dueItems, allTargetItems, todayPathItems, knowledgeActions, loadKnowledge, goHome } from '@/ui/actions';
import { knowledgeGrowth } from '@/features/knowledge/knowledgeSelectors';
import { kgLoaded, kgLogOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed, progPeriod, dataRev } from '@/ui/store';
import { dstr } from '@/app/bootstrap';
import type { Mastery } from '@/core/types';

/** FSRS's four grades → the value passed to rate() (1 Again · 2 Hard · 3 Good · 4 Easy). */
const GRADES: ReadonlyArray<readonly [number, string]> = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']];

type Any = any;
const KG_BOOKS: Any = DATA.books;
const KG_TOPICS: Any = DATA.topics;
const KG_GYM: Any = DATA.gym;
const KG_TARGETS = DATA.targets as unknown as ReadonlyArray<readonly [string, string]>;

const MASTERY_COLOUR: Record<number, string> = { 0: '#5C6678', 1: '#D8654F', 2: '#E0A64B', 3: '#E0A64B', 4: '#6BBF73', 5: '#4FB0A5' };
const MASTERY_TEXT: Record<number, string> = { 0: 'new', 1: 'shaky', 2: 'learning', 3: 'learning', 4: 'solid', 5: 'mastered' };
const TIME_LABEL: Record<string, string> = { all: 'All', '5': 'Quick · 5m', '15': 'Standard · 15m', '30': 'Deep · 30m' };

function knowledgeVM(): KnowledgeViewModel {
  const K = kg();
  const topicId = kgTopic.value;
  const items: Any[] =
    topicId === '__today__' ? todayPathItems() : topicId === '__review__' ? dueItems() : topicId === '__target__' ? allTargetItems() : kgItems.value[topicId] || [];
  const time = kgTime.value;
  const target = kgTarget.value;
  const matchesTarget = (it: Any): boolean => (target === 'all' ? true : (it.tags || []).includes(target));
  const shown = items.filter((it) => (time === 'all' || String(it.mins) === time) && matchesTarget(it));
  const topic = KG_TOPICS.find((t: Any) => t.id === topicId);
  const gm = kgGym.value && KG_GYM[topicId] ? KG_GYM[topicId] : null;
  const link = (pair: Any, kind: string, i: number): GymLink => ({
    label: pair[0],
    url: pair[1],
    key: topicId + '|' + kind + '|' + i,
    done: !!K.gymDone[topicId + '|' + kind + '|' + i],
  });
  return {
    topicId,
    topics: KG_TOPICS.map((tp: Any) => {
      const arr: Any[] = kgItems.value[tp.id] || [];
      const mastered = arr.filter((it) => (K.mastery[it.id] || 0) >= 4).length;
      return { id: tp.id, name: tp.name, books: tp.books, total: arr.length, mastered, percent: arr.length ? Math.round((100 * mastered) / arr.length) : 0 };
    }),
    items: shown.map((it) => {
      const b = KG_BOOKS[it.src.book] || {};
      return { ...it, src: { ...it.src, title: b.t, url: b.u } };
    }),
    mastery: K.mastery,
    dueCount: dueItems().length,
    timeFilter: time,
    target,
    targets: KG_TARGETS,
    targetCount: allTargetItems().length,
    gymMode: !!gm,
    gym: gm
      ? {
          concepts: (gm.concepts || []).map((v: Any, i: number) => link(v, 'c', i)),
          practice: (gm.practice || []).map((v: Any, i: number) => link(v, 'p', i)),
          reading: (gm.reading || []).map((r: Any, i: number) => {
            const b = KG_BOOKS[r[0]];
            return { label: r[1], url: b ? b.u : '#', key: topicId + '|r|' + i, done: !!K.gymDone[topicId + '|r|' + i] };
          }),
        }
      : null,
    sources: (topic && topic.books ? topic.books : [])
      .map((bk: Any) => {
        const b = KG_BOOKS[bk];
        return b ? { title: b.t, url: b.u } : null;
      })
      .filter(Boolean) as Array<{ title: string; url: string }>,
    revealed: kgRevealed.value,
  };
}

function KnowledgeProgress() {
  const K = kg();
  const C = core();
  const period = progPeriod.value;
  const today = dstr();
  const streak = currentStreak(K, today);
  const g = knowledgeGrowth(K, today);
  const masteryPct = g.seen ? Math.round((100 * g.solid) / g.seen) : 0;
  const sub = streak > 0 ? `🔥 ${streak}-day streak` : g.seen ? `${g.solid} solid` : 'nothing yet';
  const dueN = dueItems().length;
  const newN = Math.max(0, todayPathItems().length - dueN);
  const retentionTxt = g.retention == null ? '—' : `${Math.round(g.retention * 100)}%`;
  return (
    <>
      <button class="backbtn" onClick={goHome}>
        ‹ Back
      </button>
      {/* Today's path — the primary study action, FSRS-driven */}
      <button class="kpath" onClick={() => knowledgeActions.startToday()}>
        <div class="kpath-l">
          <div class="kpath-t">Today’s path</div>
          <div class="kpath-s">{dueN + newN > 0 ? `${dueN} to review · ${newN} new` : 'all caught up 🎉'}</div>
        </div>
        <span class="kpath-go">Study →</span>
      </button>
      <SecHero eyebrow="Knowledge" value={masteryPct} unit="% mastery" sub={sub} tone="ok" />
      <div class="kgrowth">
        <div class="kg-stat"><div class="kg-v">{retentionTxt}</div><div class="kg-k">retention</div></div>
        <div class="kg-stat"><div class="kg-v">{g.solid}</div><div class="kg-k">solid</div></div>
        <div class="kg-stat"><div class="kg-v">{g.seen}</div><div class="kg-k">seen</div></div>
      </div>
      <div class="prog">
        <ProgControls />
        <Carousel keepKey="knowledge">
          <Chart opts={{ kind: 'line', title: 'Mastery %', points: masterySeries(K, period), unit: '%', color: 'var(--ok)' }} />
          <Chart opts={{ kind: 'bar', title: 'Questions solved', points: questionsSolvedSeries(K, period), summary: 'sum', color: 'var(--teal)' }} />
          <Chart opts={{ kind: 'bar', title: 'XP earned', points: xpSeries(C, period, 'kg'), summary: 'sum', color: 'var(--fuel)' }} />
          <Chart opts={{ kind: 'bar', title: 'Study days', points: studyDaysSeries(K, period), summary: 'sum', color: 'var(--protein)' }} />
        </Carousel>
      </div>
      <ViewLogCta label="Browse all topics" onClick={() => knowledgeActions.toggleLog?.()} />
    </>
  );
}

function TopicHead({ vm }: { vm: KnowledgeViewModel }) {
  const cur = vm.topics.find((t) => t.id === vm.topicId);
  const title = cur ? cur.name : vm.topicId === '__today__' ? "Today’s path" : vm.topicId === '__review__' ? 'Due for review' : vm.topicId === '__target__' ? 'Studying by target' : 'Questions';
  return (
    <div class="khead">
      <details class="ktopic-d">
        <summary class="ktopic">
          {title} <span class="kchev">▾</span>
        </summary>
        <div class="ktopic-list">
          {vm.topics.map((t) => (
            <button class={'klist-item' + (t.id === vm.topicId ? ' on' : '')} onClick={() => knowledgeActions.selectTopic(t.id)}>
              <span class="kli-name">{t.name}</span>
              {t.total ? <span class="kli-cnt">{t.mastered}/{t.total}</span> : <span class="kli-cnt soon">soon</span>}
            </button>
          ))}
        </div>
      </details>
      <div class="kprog">{cur ? `${cur.mastered} / ${cur.total} mastered` : ''}</div>
    </div>
  );
}

function Filters({ vm }: { vm: KnowledgeViewModel }) {
  const isReal = vm.topicId !== '__review__' && vm.topicId !== '__target__';
  const lenSummary = vm.timeFilter === 'all' ? 'All lengths' : TIME_LABEL[vm.timeFilter];
  const targetSummary = !isReal || vm.target === 'all' ? 'everything' : vm.target;
  return (
    <details class="kfilters">
      <summary>
        <span class="fgear">⚙</span>
        <span class="fsum">
          {lenSummary} · studying {targetSummary}
        </span>
        <span class="fcta">Filters</span>
      </summary>
      <div class="kfilters-b">
        <div class="fgrp">
          <div class="fgrp-l">Question length</div>
          <div class="timebar">
            {['all', '5', '15', '30'].map((t) => (
              <button class={t === vm.timeFilter ? 'on' : ''} onClick={() => knowledgeActions.setTimeFilter(t)}>
                {TIME_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        {isReal && (
          <div class="fgrp">
            <div class="fgrp-l">Studying for</div>
            <div class="timebar" style="flex-wrap:wrap">
              {vm.targets.map(([id, label]) => (
                <button class={id === vm.target ? 'on' : ''} onClick={() => knowledgeActions.setTarget(id)}>
                  {label}
                </button>
              ))}
            </div>
            {vm.target !== 'all' && (
              <div class="note" style="margin-top:6px">
                {vm.targetCount} questions tagged {vm.target} ·{' '}
                <button class="mbtn" style="padding:3px 8px;font-size:11px" onClick={() => knowledgeActions.studyAllTagged()}>
                  Study them all
                </button>
              </div>
            )}
          </div>
        )}
        {vm.sources.length > 0 && (
          <div class="fgrp">
            <div class="fgrp-l">Sources</div>
            <div class="klink">
              {vm.sources.map((s, i) => (
                <>
                  {i > 0 ? ' · ' : ''}
                  <a href={s.url} target="_blank" rel="noopener">
                    {s.title}
                  </a>
                </>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function Reveal({ text }: { text: string }) {
  if (!text) return null;
  const m = /^(.*?[.!?])(\s+)([\s\S]*)$/.exec(text);
  if (!m) return <b>{text}</b>;
  return (
    <>
      <b style="color:var(--text)">{m[1]}</b>
      <div style="margin-top:7px">{m[3]}</div>
    </>
  );
}

function QSrc({ src }: { src: KnowledgeItem['src'] }) {
  const label = src.title ? `${src.ref} — ${src.title}` : src.ref;
  if (!src.url) return <div class="qsrc">{label}</div>;
  const href = /\.pdf$/i.test(src.url) && src.page ? `${src.url}#page=${src.page}` : src.url;
  return (
    <div class="qsrc">
      <a href={href} target="_blank" rel="noopener">
        {label} ↗
      </a>
    </div>
  );
}

function QuestionCard({ it, vm }: { it: KnowledgeItem; vm: KnowledgeViewModel }) {
  const m = vm.mastery[it.id] ?? 0;
  const full = it.flow !== 'flip';
  const open = vm.revealed[it.id] === true;
  return (
    <div class="qcard" id={'qc-' + it.id}>
      <div class="qtop">
        <span class="qtime">
          {it.mins} min · {full ? 'attempt' : 'flip'}
        </span>
        {m > 0 && (
          <span class="masterbadge" style={`background:${MASTERY_COLOUR[m]}22;color:${MASTERY_COLOUR[m]}`}>
            {MASTERY_TEXT[m]}
          </span>
        )}
      </div>
      <div class="qprompt">{it.prompt}</div>
      <QSrc src={it.src} />
      {full && (
        <textarea class="ans dictxt" id={'ans-' + it.id} style="min-height:80px;margin-top:10px" placeholder="Write your answer here, then reveal to compare — active recall beats just reading." />
      )}
      <div class="qactions">
        <button class="mbtn primary" onClick={() => knowledgeActions.reveal(it.id)}>
          {full ? 'Reveal model answer' : 'Show answer'}
        </button>
        <button class="mbtn" onClick={() => knowledgeActions.answerWithAI(it.id)}>
          ✦ AI answer
        </button>
        {full && (
          <button class="mbtn" onClick={() => knowledgeActions.gradeWithAI(it.id)}>
            ✦ AI grade
          </button>
        )}
      </div>
      <div id={'ai-' + it.id} class="note" style="margin-top:6px" />
      <div class={'reveal' + (open ? ' on' : '')} id={'rv-' + it.id}>
        <Reveal text={it.reveal} />
        <button class="qmeta-add" onClick={() => knowledgeActions.queueForReview(it.id)}>
          + Add to review queue
        </button>
        <div class="rate grade4" id={'rate-' + it.id}>
          <span class="rl">How well?</span>
          {GRADES.map(([g, label]) => (
            <button class={'g' + g} onClick={() => knowledgeActions.rate(it.id, g as Mastery)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GymRow({ l }: { l: GymLink }) {
  return (
    <div class="goalrow">
      <span class="chk" style="width:20px;height:20px" onClick={() => knowledgeActions.toggleGymDone(l.key)}>
        {l.done ? '✓' : ''}
      </span>
      <span style={'flex:1' + (l.done ? ';opacity:.5;text-decoration:line-through' : '')}>{l.label}</span>
      <a href={l.url} target="_blank" rel="noopener" style="color:var(--teal)">
        open ↗
      </a>
    </div>
  );
}

function KnowledgeBody({ vm }: { vm: KnowledgeViewModel }) {
  const isReal = vm.topicId !== '__review__' && vm.topicId !== '__target__';
  return (
    <>
      <button class="backbtn" onClick={() => (vm.gymMode ? knowledgeActions.toggleGym() : knowledgeActions.toggleLog?.())}>
        {vm.gymMode ? '‹ Questions' : '‹ Progress'}
      </button>
      <TopicHead vm={vm} />
      {vm.dueCount > 0 && vm.topicId !== '__review__' && vm.topicId !== '__today__' && !vm.gymMode && (
        <div class="kdue">
          <div class="kdue-t">
            <b>{vm.dueCount} due for review</b>
            <small>Interleaved recall — the highest-value thing today.</small>
          </div>
          <button class="kdue-b" onClick={() => knowledgeActions.startReview()}>
            Start review
          </button>
        </div>
      )}
      {isReal && !vm.gymMode && (
        <div class="kgymrow">
          <button class="mbtn" onClick={() => knowledgeActions.toggleGym()}>
            🎧 Gym session
          </button>
          <span class="note">Videos + readings — recall practice</span>
        </div>
      )}
      {vm.gymMode && vm.gym ? (
        <>
          <div class="panel">
            <p class="panel-t">Understand — what these ideas actually are</p>
            {vm.gym.concepts.map((l) => (
              <GymRow l={l} />
            ))}
          </div>
          {vm.gym.practice.length > 0 && (
            <div class="panel">
              <p class="panel-t">Apply — worked problems &amp; implementation</p>
              {vm.gym.practice.map((l) => (
                <GymRow l={l} />
              ))}
            </div>
          )}
          <div class="panel">
            <p class="panel-t">Read — sections for this topic</p>
            {vm.gym.reading.map((l) => (
              <GymRow l={l} />
            ))}
          </div>
        </>
      ) : !vm.items.length ? (
        isReal ? (
          <div class="stub">This topic is scaffolded — questions land here next. Tap “Gym session” above for videos and readings while it fills in.</div>
        ) : (
          <div class="stub">You’re all caught up 🎉 — nothing due right now. Pick a topic to get ahead.</div>
        )
      ) : (
        <>
          <Filters vm={vm} />
          {vm.items.map((it) => (
            <QuestionCard it={it} vm={vm} />
          ))}
        </>
      )}
    </>
  );
}

export function KnowledgeView() {
  useEffect(() => {
    if (!kgLoaded.value) void loadKnowledge();
  }, []);
  dataRev.value; // re-derive
  if (!kgLoaded.value) return <div class="empty">Loading…</div>;
  if (!kgLogOpen.value) return <KnowledgeProgress />;
  return <KnowledgeBody vm={knowledgeVM()} />;
}
