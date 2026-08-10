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
import { kg, core, dueItems, allTargetItems, todayPathItems, allKGItems, knowledgeActions, loadKnowledge } from '@/ui/actions';
import { knowledgeGrowth } from '@/features/knowledge/knowledgeSelectors';
import { AscentSession } from '@/features/knowledge/AscentSession';
import { srcHref, practiceLinks, seeLinks } from '@/features/knowledge/source';
import { KnowledgeRail } from '@/features/knowledge/KnowledgeRail';
import { kgLoaded, kgProgressOpen, kgGym, kgTopic, kgTime, kgTarget, kgItems, kgRevealed, kgGraded, kgOverview, progPeriod, dataRev } from '@/ui/store';
import { dstr } from '@/app/bootstrap';
import { previewIntervals, readFsrs, type Grade } from '@/features/knowledge/fsrs';

type Any = any;
const KG_BOOKS: Any = DATA.books;
const KG_TOPICS: Any = DATA.topics;
const KG_GYM: Any = DATA.gym;
const KG_TARGETS = DATA.targets as unknown as ReadonlyArray<readonly [string, string]>;

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
      // url override-first: a per-question `src.url` (chapter-PDF / sub-page) must
      // survive the book-title merge — `?? b.u` reproduces today's url otherwise.
      return { ...it, src: { ...it.src, title: b.t, url: it.src.url ?? b.u } };
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
  // Mastery % is share of the WHOLE curriculum mastered — not of the handful
  // attempted (dividing by g.seen read ~99% after a few well-rated answers).
  const total = allKGItems().length;
  const masteryPct = total ? Math.round((100 * g.solid) / total) : 0;
  const sub = streak > 0 ? `🔥 ${streak}-day streak` : g.seen ? `${g.solid} of ${total} mastered` : 'nothing yet';
  const retentionTxt = g.retention == null ? '—' : `${Math.round(g.retention * 100)}%`;
  return (
    <>
      <SecHero eyebrow="Knowledge" value={masteryPct} unit="% mastery" sub={sub} tone="ok" />
      <div class="kgrowth">
        <div class="kg-stat"><div class="kg-v">{retentionTxt}</div><div class="kg-k">retention</div></div>
        <div class="kg-stat"><div class="kg-v">{g.solid}</div><div class="kg-k">solid</div></div>
        <div class="kg-stat"><div class="kg-v">{g.seen}</div><div class="kg-k">seen</div></div>
      </div>
      <div class="prog">
        <ProgControls />
        <Carousel keepKey="knowledge">
          <Chart opts={{ kind: 'line', title: 'Mastery %', points: masterySeries(K, period, total), unit: '%', color: 'var(--ok)' }} />
          <Chart opts={{ kind: 'bar', title: 'Questions solved', points: questionsSolvedSeries(K, period), summary: 'sum', color: 'var(--teal)' }} />
          <Chart opts={{ kind: 'bar', title: 'XP earned', points: xpSeries(C, period, 'kg'), summary: 'sum', color: 'var(--fuel)' }} />
          <Chart opts={{ kind: 'bar', title: 'Study days', points: studyDaysSeries(K, period), summary: 'sum', color: 'var(--protein)' }} />
        </Carousel>
      </div>
    </>
  );
}

/* ── Topic screen — the simplified per-topic study column ─────────────────── */

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
);

/** Small clock glyph for the effort chip (honest length, never a difficulty badge). */
const EffortClock = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 13V9" /><path d="M9 2h6" /></svg>
);

/** Mastery number (0–5) → proto word + `--m-*` colour token — colour AND word always travel together (a11y). */
const M_WORD: readonly string[] = ['new', 'shaky', 'learning', 'learning', 'solid', 'mastered'];
const M_VAR: readonly string[] = ['var(--m-new)', 'var(--m-shaky)', 'var(--m-learning)', 'var(--m-learning)', 'var(--m-solid)', 'var(--m-mastered)'];

/** Topic mastery percent → word + `--m-*` colour (same bands as the Rail). */
function masteryOfPct(percent: number): { word: string; color: string } {
  if (percent >= 90) return { word: 'mastered', color: 'var(--m-mastered)' };
  if (percent >= 60) return { word: 'solid', color: 'var(--m-solid)' };
  if (percent >= 25) return { word: 'learning', color: 'var(--m-learning)' };
  if (percent >= 1) return { word: 'shaky', color: 'var(--m-shaky)' };
  return { word: 'new', color: 'var(--m-new)' };
}

const now = (): Date => new Date(dstr() + 'T00:00:00Z');

/** The four FSRS grades — proto `data-g` ids colour the border/label. Keys 1–4. */
const TPC_GRADES: ReadonlyArray<{ g: Grade; id: string; label: string }> = [
  { g: 1, id: 'again', label: 'Again' },
  { g: 2, id: 'hard', label: 'Hard' },
  { g: 3, id: 'good', label: 'Good' },
  { g: 4, id: 'easy', label: 'Easy' },
];

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
  // In the VM, src.url is already resolved to `it.src.url ?? book.u`, so passing it
  // as the bookUrl arg keeps `base = src.url ?? bookUrl` equal to that value.
  const href = srcHref(src, src.url);
  if (!href) return <div class="qsrc">{label}</div>;
  return (
    <div class="qsrc">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label} ↗
      </a>
    </div>
  );
}

/** Quiet `Practice ›` chip row + "Also: …" secondary line under the source line. */
function SourceExtras({ it }: { it: KnowledgeItem }) {
  const practice = practiceLinks(it);
  const see = seeLinks(it);
  return (
    <>
      {practice.length > 0 && (
        <div class="qpractice">
          <span class="qpractice-lead">Practice ›</span>
          {practice.map((p) => (
            <a class="qpractice-link" href={p.url} target="_blank" rel="noopener noreferrer">
              {p.label} ↗
            </a>
          ))}
        </div>
      )}
      {see.length > 0 && (
        <div class="qsee">
          Also:{' '}
          {see.map((s, i) => (
            <>
              {i > 0 && ' · '}
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.label}
              </a>
            </>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * One card in the calm topic stack (proto's `.qcard` form): a mastery pill
 * (word+dot), an honest effort chip (`{mins} min`), the prompt, the source line,
 * an answer textarea for full-flow attempts, Reveal → the model answer →
 * self-grade (Again/Hard/Good/Easy). The ✦AI answer / ✦AI grade helpers survive
 * as understated per-card actions. The `ans-`/`ai-`/`rv-`/`rate-` id contracts
 * the actions depend on are preserved.
 */
function TopicCard({ it, vm }: { it: KnowledgeItem; vm: KnowledgeViewModel }) {
  const K = kg();
  const m = (vm.mastery[it.id] ?? 0) as number;
  const full = it.flow !== 'flip';
  const open = vm.revealed[it.id] === true;
  const graded = kgGraded.value[it.id];
  const preview = previewIntervals(readFsrs(K.srs?.[it.id]), now());
  return (
    <article class={'tpc-card' + (graded ? ' reviewed' : '')} id={'qc-' + it.id}>
      <div class="tpc-qc-top">
        <span class="tpc-mchip">
          <span class="dot2" style={`background:${M_VAR[m]}`} aria-hidden="true" />
          <span class="tpc-mword" style={`color:${M_VAR[m]}`}>
            {M_WORD[m]}
          </span>
        </span>
        <span class="tpc-echip">
          <EffortClock />
          {it.mins} min
        </span>
      </div>
      <p class="tpc-prompt">{it.prompt}</p>
      <QSrc src={it.src} />
      <SourceExtras it={it} />
      {full && (
        <textarea class="ans dictxt" id={'ans-' + it.id} aria-label="Your answer" placeholder="Write your answer, then reveal to compare — active recall beats rereading." />
      )}
      <div class={'tpc-answer-wrap' + (open ? ' open' : '')} id={'rv-' + it.id}>
        <div class="tpc-answer-inner">
          <div class="tpc-answer">
            <div class="bar" />
            <div>
              <div class="label">Model answer</div>
              <div class="body">
                <Reveal text={it.reveal} />
              </div>
            </div>
          </div>
        </div>
      </div>
      {graded ? (
        <div class="tpc-reviewed" aria-live="polite">
          <span class="tpc-rv-check" aria-hidden="true">✓</span> reviewed · back in {graded}
        </div>
      ) : (
        <>
          {open ? (
            <div class="tpc-grades" id={'rate-' + it.id}>
              {TPC_GRADES.map((gr) => (
                <button
                  class="tpc-grade"
                  data-g={gr.id}
                  aria-label={gr.label}
                  onClick={() => {
                    knowledgeActions.rate(it.id, gr.g);
                    kgGraded.value = { ...kgGraded.value, [it.id]: preview[gr.g].hint }; // lock this card (no re-log)
                  }}
                >
                  <span class="g">{gr.label}</span>
                  <span class="hint">{preview[gr.g].hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <button class="tpc-reveal" onClick={() => knowledgeActions.reveal(it.id)}>
              Reveal <span class="k" aria-hidden="true">R</span>
            </button>
          )}
          <div class="tpc-ai-row">
            <button class="tpc-ai" onClick={() => knowledgeActions.answerWithAI(it.id)}>
              <SparkIcon />AI answer
            </button>
            {full && (
              <button class="tpc-ai" onClick={() => knowledgeActions.gradeWithAI(it.id)}>
                <SparkIcon />AI grade
              </button>
            )}
          </div>
          <div id={'ai-' + it.id} class="tpc-ai-note" />
        </>
      )}
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

/** The Gym as a separate tucked screen (concepts / practice / reading), reached
 *  from the topic screen's "🎧 Gym" entry — NOT an inline mode. */
function GymScreen({ vm, title }: { vm: KnowledgeViewModel; title: string }) {
  return (
    <div class="tpc-root">
      <div class="tpc-gym-head">
        <span class="tpc-th-name">🎧 Gym — {title}</span>
      </div>
      {vm.gym ? (
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
      ) : (
        <div class="tpc-empty">No gym set for this topic yet.</div>
      )}
    </div>
  );
}

/** The effort filter's segments: honest length (5/15/30 min), All by default. */
const EFFORTS: ReadonlyArray<readonly [string, string]> = [
  ['all', 'All'],
  ['5', '5m'],
  ['15', '15m'],
  ['30', '30m'],
];

/**
 * The Topic screen — one calm column (proto's Topic screen): header (‹ back ·
 * topic · mastery% · N due), a quiet "Review N due →" row that launches the
 * focused review, two tucked affordances (Effort filter + 🎧 Gym), then the card
 * stack. Cuts the old topic-switcher, studying-for filter, sources-as-filter and
 * inline gym; no difficulty label anywhere.
 */
function KnowledgeBody({ vm }: { vm: KnowledgeViewModel }) {
  dataRev.value; // leaf-subscription: re-derive on any store mutation
  const cur = vm.topics.find((t) => t.id === vm.topicId);
  const title = cur ? cur.name : 'Questions';
  if (vm.gymMode) return <GymScreen vm={vm} title={title} />;

  const pct = cur ? cur.percent : 0;
  const mst = masteryOfPct(pct);
  const topicDue = dueItems().filter((it: Any) => it.topic === vm.topicId).length;

  return (
    <div class="tpc-root">
      <header class="tpc-head">
        <div class="tpc-th-line">
          <span class="tpc-th-name">{title}</span>
          <span class="tpc-th-mastery">
            <span class="tpc-m-dot" style={`background:${mst.color}`} aria-hidden="true" />
            {pct}%
          </span>
          <span class="tpc-th-due">{topicDue} due</span>
        </div>
      </header>

      {topicDue > 0 && (
        <button class="tpc-review" onClick={() => knowledgeActions.startReview(vm.topicId)} aria-label={`Review ${topicDue} due`}>
          <span class="tpc-rr-label">Review</span>
          <span class="tpc-rr-count">{topicDue} due</span>
          <span class="tpc-rr-arrow" aria-hidden="true">→</span>
        </button>
      )}

      <div class="tpc-tucked">
        <div class="tpc-effort">
          <span class="tpc-ef-label" id={'ef-' + vm.topicId}>
            Effort
          </span>
          <div class="tpc-seg" role="group" aria-labelledby={'ef-' + vm.topicId}>
            {EFFORTS.map(([val, label]) => (
              <button type="button" aria-pressed={val === vm.timeFilter} onClick={() => knowledgeActions.setTimeFilter(val)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button class="tpc-gym" onClick={() => knowledgeActions.toggleGym()}>
          🎧 Gym
        </button>
      </div>

      <div aria-label="Cards">
        {vm.items.length ? (
          vm.items.map((it) => <TopicCard it={it} vm={vm} />)
        ) : (
          <div class="tpc-empty">
            {vm.timeFilter === 'all' ? 'Questions for this topic are still being written.' : `No ${vm.timeFilter}m cards in this topic.`}
          </div>
        )}
      </div>
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
  // One session engine: Today's path AND a topic's focused review both run in AscentSession.
  if (!kgOverview.value && (kgTopic.value === '__today__' || kgTopic.value.startsWith('__review__:'))) return <AscentSession />;
  if (!kgOverview.value) return <KnowledgeBody vm={knowledgeVM()} />; // per-topic study
  return <KnowledgeRail />; // The Rail = default Knowledge landing
}
