/**
 * Knowledge tab — Progress (charts) → Questions → Gym, nested. Ports the knowledge
 * VM builder (app.ts) + renderKnowledgeHTML/Body/Card to JSX. The single top-left
 * back button walks up one level (handled by App's back-stack).
 */
import { useEffect, useState } from 'preact/hooks';
import { DATA } from '@/core/data/index';
import type { KnowledgeViewModel, KnowledgeItem, GymLink } from '@/features/knowledge/types';
import { masterySeries, questionsSolvedSeries, xpSeries, studyDaysSeries, currentStreak } from '@/ui/charts/progress';
import { ProgControls, Carousel, Chart, ViewLogCta } from '@/ui/components/Charts';
import { SecHero } from '@/ui/components/SecHero';
import { kg, core, dueItems, allTargetItems, todayPathItems, knowledgeActions, loadKnowledge, goHome } from '@/ui/actions';
import { knowledgeGrowth } from '@/features/knowledge/knowledgeSelectors';
import { kgLoaded, kgLogOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed, kgOverview, progPeriod, dataRev } from '@/ui/store';
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
      <ViewLogCta label="Browse all topics" onClick={() => knowledgeActions.browseTopics()} />
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
      <button class="backbtn" onClick={() => (vm.gymMode ? knowledgeActions.toggleGym() : knowledgeActions.backToTopics())}>
        {vm.gymMode ? '‹ Questions' : '‹ Topics'}
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
const DOMAIN_ORDER: Domain[] = ['Theory', 'Systems', 'ML', 'Career'];
// oversized ghost mono code stamped on each cover (no photos — CSP).
const TOPIC_CODE: Record<string, string> = {
  algorithms: 'ALG', graph: 'GRF', probstats: 'PRB', cpp: 'C++', concurrency: 'CNC',
  comparch: 'ARC', databases: 'DB', sysdesign: 'SYS', networking: 'NET', linux: 'LNX',
  distributed: 'DST', compilers: 'CMP', mlfund: 'ML', gpu: 'GPU', behavioral: 'BEH',
};

/** Mastery ramp — never colour-only: always a colour AND a word. */
function masteryTone(pct: number): { color: string; word: string; aria: string } {
  if (pct >= 60) return { color: 'var(--ok)', word: 'Solid', aria: 'solid grasp' };
  if (pct >= 25) return { color: 'var(--fuel)', word: 'Building', aria: 'building fluency' };
  return { color: 'var(--deficit)', word: 'Early', aria: 'just getting started' };
}

interface OverviewTopic {
  id: string; name: string; domain: Domain; code: string;
  count: number; mastered: number; percent: number; due: number;
}

/** Derive the per-topic gallery rows from the live stores (reads via callers under dataRev). */
function overviewTopics(): OverviewTopic[] {
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

/** Compact mastery ring: SVG arc + % inside (status word lives beside it). */
function MasteryRing({ pct }: { pct: number }) {
  const r = 28;
  const C = 2 * Math.PI * r;
  const off = C * (1 - pct / 100);
  const tone = masteryTone(pct);
  return (
    <svg class="tov-ring" viewBox="0 0 68 68" aria-hidden="true">
      <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,.10)" stroke-width="6" />
      <circle
        cx="34" cy="34" r={r} fill="none" stroke={tone.color} stroke-width="6" stroke-linecap="round"
        stroke-dasharray={C.toFixed(1)} stroke-dashoffset={off.toFixed(1)} transform="rotate(-90 34 34)"
      />
      <text class="tov-ring-pct" x="34" y="35" text-anchor="middle" dominant-baseline="middle" font-size="19" fill="var(--text)">{pct}</text>
    </svg>
  );
}

/**
 * Living-curriculum cue, compact — a spark on mastered topics (deeper questions
 * ready), a subtle up-tick on climbers. Kept to one glyph so tiles stay dense.
 */
function FrontierMark({ pct }: { pct: number }) {
  if (pct >= 60)
    return (
      <span class="tov-fmark ready" title="Deeper questions ready to generate" aria-label="deeper questions ready to generate">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
      </span>
    );
  if (pct >= 40)
    return (
      <span class="tov-fmark near" title="Nearing a deeper question set" aria-label="nearing a deeper question set">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </span>
    );
  return null;
}

/** Dense, equal-height listing tile: whole card is the drill-in button. */
function TopicCard({ t }: { t: OverviewTopic }) {
  const tint = DOMAIN_TINT[t.domain];
  const tone = masteryTone(t.percent);
  const dueLabel = t.due > 0 ? `${t.due} due for review` : 'all caught up';
  return (
    <article class="tov-card">
      <button
        class="tov-cardlink"
        style={`--tint:${tint}`}
        onClick={() => knowledgeActions.selectTopic(t.id)}
        aria-label={`${t.name}, ${t.domain}. ${t.count} questions, ${dueLabel}. Mastery ${t.percent} percent, ${tone.aria}.`}
      >
        <span class="tov-top">
          <span class="tov-dom" style={`color:${tint}`}><span class="tov-swatch" style={`background:${tint}`} aria-hidden="true" />{t.domain}</span>
          <FrontierMark pct={t.percent} />
          <span class="tov-spacer" />
          {t.due > 0 ? (
            <span class="tov-badge" aria-hidden="true"><span class="tov-pulse" />{t.due}</span>
          ) : (
            <span class="tov-badge clear" aria-hidden="true">✓</span>
          )}
        </span>
        <span class="tov-mid">
          <MasteryRing pct={t.percent} />
          <span class="tov-nameblock">
            <span class="tov-name">{t.name}</span>
            <span class="tov-meta">{t.count} q<span class="tov-open"> · growing</span></span>
          </span>
        </span>
        <span class="tov-mastery">
          <span class="tov-track"><span style={`width:${t.percent}%;background:${tone.color}`} /></span>
          <span class="tov-word" style={`color:${tone.color}`}>{tone.word}</span>
        </span>
      </button>
    </article>
  );
}

type SortKey = 'recommended' | 'due' | 'mlow' | 'mhigh' | 'alpha' | 'qty';

function sortTopics(a: OverviewTopic, b: OverviewTopic, key: SortKey): number {
  switch (key) {
    case 'due': return b.due - a.due || a.percent - b.percent;
    case 'mlow': return a.percent - b.percent;
    case 'mhigh': return b.percent - a.percent;
    case 'alpha': return a.name.localeCompare(b.name);
    case 'qty': return b.count - a.count;
    default: // review priority: due first, then weakest, then most questions
      return Number(b.due > 0) - Number(a.due > 0) || b.due - a.due || a.percent - b.percent || b.count - a.count;
  }
}

function TopicsOverview() {
  dataRev.value; // leaf-subscription: re-derive on any store mutation
  const [domain, setDomain] = useState<'all' | Domain>('all');
  const [dueOnly, setDueOnly] = useState(false);
  const [weakOnly, setWeakOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recommended');

  const all = overviewTopics();
  const totalQ = all.reduce((n, t) => n + t.count, 0);
  const totalDue = all.reduce((n, t) => n + t.due, 0);
  const totalMastered = all.reduce((n, t) => n + t.mastered, 0);
  const overallPct = totalQ ? Math.round((100 * totalMastered) / totalQ) : 0;
  const domainCount: Record<Domain, number> = { Theory: 0, Systems: 0, ML: 0, Career: 0 };
  all.forEach((t) => { domainCount[t.domain]++; });

  const q = query.trim().toLowerCase();
  const list = all
    .filter((t) => {
      if (domain !== 'all' && t.domain !== domain) return false;
      if (dueOnly && t.due === 0) return false;
      if (weakOnly && t.percent >= 25) return false;
      if (q && !(t.name + ' ' + t.domain).toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => sortTopics(a, b, sort));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div class="ktopics">
      <div class="tov-barrow">
        <button class="backbtn" onClick={() => knowledgeActions.toggleLog?.()}>‹ Progress</button>
        <form class="tov-search" role="search" onSubmit={(e) => e.preventDefault()}>
          <svg class="tov-mag" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" /><path d="m20 20-3.2-3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          <label class="tov-sr" for="tov-q">Search topics</label>
          <input id="tov-q" type="search" placeholder="Search topics…" autocomplete="off"
            value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </form>
        <label class="tov-sr" for="tov-sort">Sort topics</label>
        <select class="tov-sort" id="tov-sort" aria-label="Sort topics" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
          <option value="recommended">Review priority</option>
          <option value="due">Most due</option>
          <option value="mlow">Mastery ↑</option>
          <option value="mhigh">Mastery ↓</option>
          <option value="alpha">Name A–Z</option>
          <option value="qty">Most questions</option>
        </select>
      </div>

      <header class="tov-hero">
        <h1 class="tov-title">{greeting}, Albert. Where to <span class="tov-warm">next?</span></h1>
        <p class="tov-lede">
          <b>{totalDue} due</b> across {all.length} topics · {totalQ} questions and growing · <b>{overallPct}% mastery</b>
        </p>
      </header>

      <div class="tov-chips" role="group" aria-label="Filter topics">
        <button class="tov-chip" aria-pressed={domain === 'all'} onClick={() => setDomain('all')}>All <span class="tov-cnt">{all.length}</span></button>
        {DOMAIN_ORDER.map((d) => (
          <button class="tov-chip" aria-pressed={domain === d} onClick={() => setDomain(d)}>
            <span class="tov-swatch" style={`background:${DOMAIN_TINT[d]}`} aria-hidden="true" />{d} <span class="tov-cnt">{domainCount[d]}</span>
          </button>
        ))}
        <button class="tov-chip toggle" aria-pressed={dueOnly} onClick={() => setDueOnly((v) => !v)}>Due now</button>
        <button class="tov-chip toggle" aria-pressed={weakOnly} onClick={() => setWeakOnly((v) => !v)}>Needs work</button>
      </div>

      {list.length ? (
        <>
          <div class="tov-grid">
            {list.map((t) => <TopicCard t={t} />)}
          </div>
          <div class="tov-horizon" role="note" aria-label="Your curriculum keeps growing">
            <svg class="tov-hspark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8L12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
            <span><b>Your curriculum keeps growing.</b> Master a topic and Meridian writes deeper questions — new concepts surface as you climb.</span>
          </div>
        </>
      ) : (
        <div class="tov-empty"><b>No topics match.</b> Try clearing a filter or searching something broader.</div>
      )}
    </div>
  );
}

export function KnowledgeView() {
  useEffect(() => {
    if (!kgLoaded.value) void loadKnowledge();
  }, []);
  dataRev.value; // re-derive
  if (!kgLoaded.value) return <div class="empty">Loading…</div>;
  if (!kgLogOpen.value) return <KnowledgeProgress />;
  if (kgOverview.value) return <TopicsOverview />;
  return <KnowledgeBody vm={knowledgeVM()} />;
}
