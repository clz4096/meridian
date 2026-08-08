/**
 * Knowledge tab — Progress (charts) → Questions → Gym, nested. Ports the knowledge
 * VM builder (app.ts) + renderKnowledgeHTML/Body/Card to JSX. The single top-left
 * back button walks up one level (handled by App's back-stack).
 */
import { useEffect } from 'preact/hooks';
import { DATA } from '@/core/data/index';
import type { KnowledgeViewModel, KnowledgeItem, GymLink } from '@/features/knowledge/types';
import { masterySeries, questionsSolvedSeries, xpSeries, studyDaysSeries, currentStreak } from '@/ui/charts/progress';
import { ProgControls, Carousel, Chart } from '@/ui/components/Charts';
import { SecHero } from '@/ui/components/SecHero';
import { kg, core, dueItems, allTargetItems, todayPathItems, knowledgeActions, loadKnowledge } from '@/ui/actions';
import { knowledgeGrowth } from '@/features/knowledge/knowledgeSelectors';
import { AscentSession } from '@/features/knowledge/AscentSession';
import { KnowledgeRail } from '@/features/knowledge/KnowledgeRail';
import { kgLoaded, kgProgressOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed, kgOverview, progPeriod, dataRev } from '@/ui/store';
import { dstr } from '@/app/bootstrap';
import type { Mastery } from '@/core/types';

/**
 * FSRS's four grades → the value passed to rate() (1 Again · 2 Hard · 3 Good ·
 * 4 Easy), plus the emotive framing for the reveal→grade moment: an emoji
 * (aria-hidden — the word carries the meaning) and a soft, qualitative pacing
 * hint. The hints are deliberately NOT literal day counts: FSRS owns the real
 * next-interval and it isn't surfaced in the VM, so we don't fake precise dates.
 */
const GRADE_META: ReadonlyArray<readonly [number, string, string, string, string]> = [
  [1, 'Again', '😵', 'start over', 'again'],
  [2, 'Hard', '😬', 'soon', 'hard'],
  [3, 'Good', '🙂', 'on track', 'good'],
  [4, 'Easy', '😎', 'you’ve got this', 'easy'],
];

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
  const retentionTxt = g.retention == null ? '—' : `${Math.round(g.retention * 100)}%`;
  return (
    <>
      <button class="backbtn" onClick={() => knowledgeActions.browseTopics()}>
        ‹ Topics
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
    </>
  );
}

/* ── Base Camp study view — icons ──────────────────────────────────────── */
const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
);

/**
 * The mastery bands used by the belonging bar. FSRS writes 1/3/4/5 (Again/Hard/
 * Good/Easy → 1/3/4/5), so band 2 is folded into "learning". Colour AND word
 * always travel together — never colour alone (a11y).
 */
interface MasteryBucket { key: string; word: string; count: number; color: string }
function masteryBuckets(topicId: string, mastery: KnowledgeViewModel['mastery']): MasteryBucket[] {
  const arr: KnowledgeItem[] = kgItems.value[topicId] || [];
  const c = { mastered: 0, solid: 0, learning: 0, shaky: 0, notstarted: 0 };
  for (const it of arr) {
    const m = mastery[it.id] ?? 0;
    if (m >= 5) c.mastered++;
    else if (m === 4) c.solid++;
    else if (m >= 2) c.learning++;
    else if (m === 1) c.shaky++;
    else c.notstarted++;
  }
  return [
    { key: 'mastered', word: 'Mastered', count: c.mastered, color: 'var(--ok)' },
    { key: 'solid', word: 'Solid', count: c.solid, color: 'var(--teal)' },
    { key: 'learning', word: 'Learning', count: c.learning, color: 'var(--fuel)' },
    { key: 'shaky', word: 'Shaky', count: c.shaky, color: 'var(--deficit)' },
    { key: 'notstarted', word: 'Not started', count: c.notstarted, color: 'var(--dim)' },
  ];
}

type CurTopic = KnowledgeViewModel['topics'][number];

/** Warm hero: greeting + topic name + a Switch-topic menu wired to selectTopic. */
function Hero({ vm, title }: { vm: KnowledgeViewModel; title: string }) {
  return (
    <section class="bc-hero">
      <div class="bc-greet">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M3 12h2m14 0h2M5.6 18.4l1.4-1.4m10-10l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /><circle cx="12" cy="12" r="3.4" stroke="currentColor" stroke-width="1.8" /></svg>
        Welcome back — pick up where you left off
      </div>
      <div class="bc-title-row">
        <h1 class="bc-h1">{title}</h1>
        <details class="bc-switch">
          <summary aria-label="Switch topic">
            Switch
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </summary>
          <div class="bc-switch-menu" role="menu">
            {vm.topics.map((t) => (
              <button class="bc-switch-item" role="menuitemradio" aria-checked={t.id === vm.topicId} onClick={() => knowledgeActions.selectTopic(t.id)}>
                <span class="bc-swd" style={`background:${DOMAIN_TINT[TOPIC_DOMAIN[t.id] ?? 'Systems']}`} aria-hidden="true" />
                <span class="bc-swd-name">{t.name}</span>
                <small>{t.total ? `${t.mastered}/${t.total}` : 'soon'}</small>
              </button>
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}

/** Belonging progress — "mastered X of Y" + a segmented, word-labelled bar. */
function Belonging({ vm, cur }: { vm: KnowledgeViewModel; cur: CurTopic }) {
  const buckets = masteryBuckets(vm.topicId, vm.mastery);
  const denom = cur.total || 1;
  const aria = buckets.map((b) => `${b.count} ${b.word.toLowerCase()}`).join(', ');
  const sub =
    cur.mastered >= cur.total && cur.total > 0
      ? 'You’ve mastered everything here — the Deep set is where you climb next.'
      : 'A good run today can lift a question from “learning” to “solid.” Keep the streak warm.';
  return (
    <div class="bc-prog">
      <div class="bc-prog-say">
        You’ve mastered <b>{cur.mastered} of {cur.total}</b> here — {cur.mastered ? 'you’re getting there.' : 'let’s begin.'}
        <span class="bc-prog-sub">{sub}</span>
      </div>
      <div class="bc-bar" role="img" aria-label={`Mastery: ${aria}`}>
        {buckets
          .filter((b) => b.count > 0 && b.key !== 'notstarted')
          .map((b) => (
            <i class="bc-seg" style={`width:${(100 * b.count) / denom}%;background:${b.color}`} />
          ))}
      </div>
      <div class="bc-legend">
        {buckets.map((b) => (
          <span>
            <i class="bc-dot" style={`background:${b.color}`} aria-hidden="true" />
            {b.word} {b.count}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Stage { key: string; badge: string; title: string; desc: string; state: 'done' | 'now' | 'locked' | 'frontier'; cnt?: string; locked?: boolean }

/**
 * The trail — a forward-looking climb derived HONESTLY from the topic's mastery
 * percent. Foundations clear at 40%, Core is the working band, the Deep set
 * unlocks at 60%, and the AI-forged Frontier is a *locked* affordance: question
 * generation isn't built yet, so it advertises the future without faking it.
 */
function trailStages(cur: CurTopic): Stage[] {
  const p = cur.percent;
  const masteredOf = `${cur.mastered} / ${cur.total} mastered`;
  return [
    { key: 'found', badge: p >= 40 ? '✓ Cleared' : '● You’re here', title: 'Foundations', desc: 'Complexity, invariants, the core toolbox.', state: p >= 40 ? 'done' : 'now', cnt: p >= 40 ? 'Base cleared' : masteredOf },
    { key: 'core', badge: p < 40 ? 'Next up' : p < 60 ? '● You’re here' : '✓ Cleared', title: 'Core patterns', desc: 'The workhorse techniques you reach for most.', state: p < 40 ? 'locked' : p < 60 ? 'now' : 'done', cnt: masteredOf },
    { key: 'deep', badge: p < 60 ? '🔒 Reach 60%' : p < 85 ? '● You’re here' : '✓ Cleared', title: 'Deep set', desc: 'Harder variants unlock as Core turns solid.', state: p < 60 ? 'locked' : p < 85 ? 'now' : 'done', locked: p < 60, cnt: p < 60 ? 'Opens at 60% mastered' : 'Unlocked — harder variants' },
    { key: 'frontier', badge: '✦ Frontier', title: 'AI-forged', desc: 'Meridian writes fresh, deeper questions from where you slip — as you climb.', state: 'frontier' },
  ];
}

/** Horizontal trail band (scrolls on phone; never scrolls the page sideways). */
function Trail({ cur }: { cur: CurTopic }) {
  const stages = trailStages(cur);
  return (
    <section class="bc-trail">
      <div class="bc-sec-h">
        <h2>Your trail up {cur.name}</h2>
        <span>the set grows as you climb</span>
      </div>
      <div class="bc-trail-scroll">
        <div class="bc-trail-track">
          {stages.map((s) => (
            <div class={'bc-stage ' + s.state}>
              <span class="bc-stage-badge">{s.badge}</span>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              {s.key === 'frontier' ? (
                <span class="bc-forge-locked"><SparkIcon /> Written as you climb</span>
              ) : (
                <div class="bc-stage-cnt">{s.cnt}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Filters({ vm }: { vm: KnowledgeViewModel }) {
  const isReal = vm.topicId !== '__review__' && vm.topicId !== '__target__';
  return (
    <section class="bc-filters">
      <div class="bc-frow">
        <span class="bc-flabel">Length</span>
        {['all', '5', '15', '30'].map((t) => (
          <button class="bc-chip" aria-pressed={t === vm.timeFilter} onClick={() => knowledgeActions.setTimeFilter(t)}>
            {TIME_LABEL[t]}
          </button>
        ))}
      </div>
      {isReal && (
        <div class="bc-frow">
          <span class="bc-flabel">Studying for</span>
          {vm.targets.map(([id, label]) => (
            <button class="bc-chip tag" aria-pressed={id === vm.target} onClick={() => knowledgeActions.setTarget(id)}>
              {label}
            </button>
          ))}
          {vm.target !== 'all' && (
            <button class="bc-chip" onClick={() => knowledgeActions.studyAllTagged()}>
              Study all {vm.targetCount} tagged
            </button>
          )}
        </div>
      )}
      {vm.sources.length > 0 && (
        <div class="bc-srcline">
          <span class="bc-src-lbl">Sources for this topic:</span>
          {vm.sources.map((s) => (
            <a href={s.url} target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5m0-15V21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              {s.title} ↗
            </a>
          ))}
        </div>
      )}
      {isReal && (
        <div class="bc-gym-entry">
          <button class="bc-gym-btn" onClick={() => knowledgeActions.toggleGym()}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.8" /><circle cx="18" cy="16" r="3" stroke="currentColor" stroke-width="1.8" /></svg>
            Gym session
          </button>
          <small>Swap questions for curated videos &amp; readings — warm up, then recall.</small>
        </div>
      )}
    </section>
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
    <article class="bc-qcard" id={'qc-' + it.id}>
      <div class="bc-qtop">
        <span class={'bc-qmeta' + (full ? '' : ' flip')}>
          {full ? (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 20h9M3 20l1-4L15 5l3 3L7 19l-4 1z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8l4-4v3h9a4 4 0 010 8H9m11 0l-4 4v-3H7a4 4 0 010-8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          )}
          {it.mins} min · {full ? 'attempt' : 'flip'}
        </span>
        {m > 0 && (
          <span class="bc-badge" style={`background:${MASTERY_COLOUR[m]}22;color:${MASTERY_COLOUR[m]}`}>
            <span class="bc-dot" style={`background:${MASTERY_COLOUR[m]}`} aria-hidden="true" />
            {MASTERY_TEXT[m]}
          </span>
        )}
      </div>
      <div class="bc-qprompt">{it.prompt}</div>
      <QSrc src={it.src} />
      {full && (
        <textarea class="ans dictxt bc-ans" id={'ans-' + it.id} aria-label="Your answer" placeholder="Write your answer here, then reveal to compare — active recall beats just reading." />
      )}
      <div class="bc-qactions">
        <button class="bc-btn primary" onClick={() => knowledgeActions.reveal(it.id)}>
          {full ? 'Reveal model answer' : 'Show answer'}
        </button>
        <button class="bc-btn ai" onClick={() => knowledgeActions.answerWithAI(it.id)}>
          <SparkIcon />AI answer
        </button>
        {full && (
          <button class="bc-btn ai" onClick={() => knowledgeActions.gradeWithAI(it.id)}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>AI grade
          </button>
        )}
      </div>
      <div id={'ai-' + it.id} class="note bc-ai" />
      <div class={'reveal bc-reveal' + (open ? ' on' : '')} id={'rv-' + it.id}>
        <div class="bc-reveal-inner">
          <div class="bc-answer">
            <div class="bc-answer-lbl">Model answer</div>
            <div class="bc-answer-body"><Reveal text={it.reveal} /></div>
          </div>
          <button class="bc-addq" onClick={() => knowledgeActions.queueForReview(it.id)}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
            Add to review queue
          </button>
          <div class="bc-grade">
            <div class="bc-grade-q">How did that land?</div>
            <div class="bc-grade-sub">Be honest with yourself — it’s how Meridian paces the next visit.</div>
            <div class="bc-grades" id={'rate-' + it.id}>
              {GRADE_META.map(([g, label, emoji, hint, cls]) => (
                <button class={'bc-g ' + cls} onClick={() => knowledgeActions.rate(it.id, g as Mastery)}>
                  <span class="bc-g-em" aria-hidden="true">{emoji}</span>
                  {label}
                  <small>{hint}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
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

/** Living-set end nudge: what today's set was + the forward (locked) Frontier. */
function EndNudge({ vm, cur }: { vm: KnowledgeViewModel; cur: CurTopic }) {
  return (
    <div class="bc-state frontier">
      <div class="bc-state-art" aria-hidden="true"><SparkIcon /></div>
      <h3>That’s your set for now.</h3>
      <p>
        You’re {cur.mastered} of {cur.total} mastered in {cur.name}. As Core turns solid, Meridian opens the <b>Deep set</b> — and forges fresh questions from wherever you slipped.
      </p>
      {vm.dueCount > 0 && (
        <button class="bc-go" onClick={() => knowledgeActions.startReview()}>
          Start review
        </button>
      )}
    </div>
  );
}

function KnowledgeBody({ vm }: { vm: KnowledgeViewModel }) {
  dataRev.value; // leaf-subscription: re-derive on any store mutation
  const isReal = vm.topicId !== '__review__' && vm.topicId !== '__target__';
  const cur = vm.topics.find((t) => t.id === vm.topicId);
  const title = cur ? cur.name : vm.topicId === '__today__' ? 'Today’s path' : vm.topicId === '__review__' ? 'Due for review' : vm.topicId === '__target__' ? 'Studying by target' : 'Questions';
  return (
    <div class="bc-study">
      <div class="bc-topbar">
        <button class="backbtn" onClick={() => (vm.gymMode ? knowledgeActions.toggleGym() : knowledgeActions.backToTopics())}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          {vm.gymMode ? 'Questions' : 'Topics'}
        </button>
      </div>
      <Hero vm={vm} title={vm.gymMode ? `Gym — ${title}` : title} />
      {cur && !vm.gymMode && <Belonging vm={vm} cur={cur} />}
      {vm.dueCount > 0 && vm.topicId !== '__review__' && vm.topicId !== '__today__' && !vm.gymMode && (
        <div class="bc-invite">
          <div class="bc-lantern" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 2c1 2.2.4 3.4-.6 4.6C10.2 8 9 9.3 9 11a3 3 0 006 0c0-1.2-.5-2.1-1-3 .2 1 .1 1.7-.4 2.3.9-2.3-.2-4.4-1.6-6.3z" fill="currentColor" /></svg>
          </div>
          <div class="bc-invite-txt">
            <b>{vm.dueCount} questions are due for review</b>
            <small>Interleaved recall across everything you’ve seen — the single highest-value thing today.</small>
          </div>
          <button class="bc-go" onClick={() => knowledgeActions.startReview()}>
            Start review
          </button>
        </div>
      )}
      {cur && !vm.gymMode && <Trail cur={cur} />}
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
          <div class="bc-state">
            <div class="bc-state-art" aria-hidden="true"><SparkIcon /></div>
            <h3>Questions land here next</h3>
            <p>This topic is scaffolded — Meridian is still writing its question set. Warm up with the Gym session’s videos and readings while it fills in.</p>
          </div>
        ) : (
          <div class="bc-state done">
            <div class="bc-state-art" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </div>
            <h3>All caught up 🎉</h3>
            <p>Nothing’s due right now — nice work. Pick a topic to get ahead.</p>
          </div>
        )
      ) : (
        <>
          <Filters vm={vm} />
          <section class="bc-qlist">
            {vm.items.map((it) => (
              <QuestionCard it={it} vm={vm} />
            ))}
            {cur && <EndNudge vm={vm} cur={cur} />}
          </section>
        </>
      )}
    </div>
  );
}

/* ── Browse all topics (Airbnb-style gallery) ──────────────────────────── */

type Domain = 'Theory' | 'Systems' | 'ML' | 'Career';

// topics.json carries no domain — the curriculum grouping is fixed content.
const TOPIC_DOMAIN: Record<string, Domain> = {
  algorithms: 'Theory', graph: 'Theory', probstats: 'Theory',
  cpp: 'Systems', concurrency: 'Systems', comparch: 'Systems', databases: 'Systems',
  sysdesign: 'Systems', networking: 'Systems', linux: 'Systems', distributed: 'Systems', compilers: 'Systems',
  mlfund: 'ML', gpu: 'ML',
  behavioral: 'Career',
};
// domain → tint (CSS var). Theory violet · Systems teal · ML amber · Career green.
const DOMAIN_TINT: Record<Domain, string> = { Theory: 'var(--protein)', Systems: 'var(--teal)', ML: 'var(--fuel)', Career: 'var(--ok)' };
// oversized ghost mono code stamped on each cover (no photos — CSP).
const TOPIC_CODE: Record<string, string> = {
  algorithms: 'ALG', graph: 'GRF', probstats: 'PRB', cpp: 'C++', concurrency: 'CNC',
  comparch: 'ARC', databases: 'DB', sysdesign: 'SYS', networking: 'NET', linux: 'LNX',
  distributed: 'DST', compilers: 'CMP', mlfund: 'ML', gpu: 'GPU', behavioral: 'BEH',
};

export interface OverviewTopic {
  id: string; name: string; domain: Domain; code: string;
  count: number; mastered: number; percent: number; due: number;
}

/** Derive the per-topic rows from the live stores (reads via callers under dataRev). Shared with the Rail. */
export function overviewTopics(): OverviewTopic[] {
  const K = kg();
  const dueByTopic: Record<string, number> = {};
  dueItems().forEach((it: Any) => { dueByTopic[it.topic] = (dueByTopic[it.topic] || 0) + 1; });
  return KG_TOPICS.map((tp: Any): OverviewTopic => {
    const arr: Any[] = kgItems.value[tp.id] || [];
    const mastered = arr.filter((it) => (K.mastery?.[it.id] || 0) >= 4).length;
    const domain = TOPIC_DOMAIN[tp.id] ?? 'Systems';
    return {
      id: tp.id, name: tp.name, domain, code: TOPIC_CODE[tp.id] ?? tp.id.slice(0, 3).toUpperCase(),
      count: arr.length, mastered, percent: arr.length ? Math.round((100 * mastered) / arr.length) : 0,
      due: dueByTopic[tp.id] || 0,
    };
  });
}

export function KnowledgeView() {
  useEffect(() => {
    if (!kgLoaded.value) void loadKnowledge();
  }, []);
  dataRev.value; // re-derive
  if (!kgLoaded.value) return <div class="empty">Loading…</div>;
  if (kgProgressOpen.value) return <KnowledgeProgress />; // secondary charts/trends
  if (!kgOverview.value && kgTopic.value === '__today__') return <AscentSession />; // guided daily session
  if (!kgOverview.value) return <KnowledgeBody vm={knowledgeVM()} />; // per-topic study
  return <KnowledgeRail />; // The Rail = default Knowledge landing
}
