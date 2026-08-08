/**
 * The Rail — Knowledge's real landing.
 *
 * A near-verbatim port of the approved prototype (scratchpad/rail-proto.html):
 * same DOM, same `.rail-*` CSS (lifted from the proto's <style>), same minimal
 * motion — only the DATA underneath is real. A vertical spine threads three fixed
 * curriculum sections (Foundations · Systems · Frontier); tiles render as done
 * (behind the frontier), the ONE raised "you're here" current tile, or upcoming.
 *
 * State is derived, not toggled (the proto's demo switcher is dropped):
 *  - current = the FIRST topic in the fixed order whose mastery percent < 60 (the
 *    progress frontier); if every topic is ≥60, the last topic is current.
 *  - the Study-next card mirrors the current topic; when NOTHING is due across all
 *    topics it collapses to a calm "you're current" line (no shouting CTA).
 *  - header meter = "N of T topics solid" (N = topics ≥60), fill = N/T.
 *
 * Leaf-subscription: `dataRev.value` is read at the top so any store mutation
 * (a grade, a sync) re-derives the rail.
 */
import { dataRev } from '@/ui/store';
import { knowledgeActions } from '@/ui/actions';
import { overviewTopics, type OverviewTopic } from '@/features/knowledge/KnowledgeTab';

/** The fixed curriculum: three sections, exact top→bottom topic order. */
const SECTIONS: ReadonlyArray<{ name: string; ids: readonly string[] }> = [
  { name: 'Foundations', ids: ['algorithms', 'graph', 'probstats', 'cpp', 'comparch'] },
  { name: 'Systems', ids: ['concurrency', 'linux', 'databases', 'networking', 'distributed'] },
  { name: 'Frontier', ids: ['sysdesign', 'compilers', 'mlfund', 'gpu', 'behavioral'] },
];
const FIXED_IDS: ReadonlySet<string> = new Set(SECTIONS.flatMap((s) => s.ids));

/** Mastery word + colour from percent — colour and word ALWAYS travel together (a11y). */
interface Mastery { word: string; color: string }
function masteryOf(percent: number): Mastery {
  if (percent >= 90) return { word: 'mastered', color: 'var(--m-mastered)' };
  if (percent >= 60) return { word: 'solid', color: 'var(--m-solid)' };
  if (percent >= 25) return { word: 'learning', color: 'var(--m-learning)' };
  if (percent >= 1) return { word: 'shaky', color: 'var(--m-shaky)' };
  return { word: 'new', color: 'var(--m-new)' };
}

type TileState = 'done' | 'current' | 'upcoming';

/** Build the ordered rail: fixed sections in order, extra topic ids appended to Frontier. */
function buildSections(topics: OverviewTopic[]): Array<{ name: string; topics: OverviewTopic[] }> {
  const byId = new Map(topics.map((t) => [t.id, t]));
  const out = SECTIONS.map((s) => ({
    name: s.name,
    topics: s.ids.map((id) => byId.get(id)).filter((t): t is OverviewTopic => !!t),
  }));
  // Growing curriculum: any topic beyond the fixed 15 appends to Frontier as an upcoming tile.
  const extras = topics.filter((t) => !FIXED_IDS.has(t.id));
  if (extras.length) out[out.length - 1].topics.push(...extras);
  return out;
}

function Tile({ t, state, onSelect }: { t: OverviewTopic; state: TileState; onSelect: () => void }) {
  const m = masteryOf(t.percent);
  const dotColor = state === 'current' ? 'var(--hub)' : m.color;
  const aria =
    `${t.name}, ${m.word}` +
    (t.due ? `, ${t.due} due` : '') +
    (state === 'current' ? ', you are here' : state === 'done' ? ', done' : '');
  return (
    <button
      type="button"
      class={`rail-tile rail-${state}`}
      aria-label={aria}
      aria-current={state === 'current' ? 'step' : undefined}
      onClick={onSelect}
    >
      <span class="rail-dot" style={`background:${dotColor}`} />
      {state === 'done' && (
        <span class="rail-t-check" aria-hidden="true">
          ✓
        </span>
      )}
      <span class="rail-t-name">{t.name}</span>
      <span class="rail-t-mastery" style={`color:${m.color}`}>
        {m.word}
      </span>
      {state === 'current' ? (
        <span class="rail-here">you’re here</span>
      ) : (
        t.due > 0 && <span class="rail-t-due">{t.due} due</span>
      )}
    </button>
  );
}

export function KnowledgeRail() {
  dataRev.value; // leaf-subscription: re-derive on any store mutation

  const all = overviewTopics();
  const sections = buildSections(all);
  const ordered = sections.flatMap((s) => s.topics); // rail order, top→bottom

  const total = ordered.length;
  const solidN = ordered.filter((t) => t.percent >= 60).length;
  const totalDue = ordered.reduce((n, t) => n + t.due, 0);
  const fillPct = total ? Math.round((100 * solidN) / total) : 0;

  // Current = first topic not yet solid (<60); if all are solid, the deepest topic.
  let currentIndex = ordered.findIndex((t) => t.percent < 60);
  if (currentIndex === -1) currentIndex = Math.max(0, total - 1);
  const current = ordered[currentIndex];

  const stateAt = (idx: number): TileState => (idx < currentIndex ? 'done' : idx === currentIndex ? 'current' : 'upcoming');

  return (
    <div class="rail-root">
      <header class="rail-header">
        <div class="rail-h-title">Knowledge</div>
        <button class="rail-meter" type="button" aria-label={`${solidN} of ${total} topics solid — open progress`} onClick={() => knowledgeActions.openProgress()}>
          <span class="rail-meter-track">
            <span class="rail-meter-fill" style={`width:${fillPct}%`} />
          </span>
          <span class="rail-meter-label">
            {solidN} of {total} topics solid
          </span>
        </button>
      </header>

      <section class="rail-studynext" aria-label="Study next">
        <div class="rail-eyebrow">STUDY NEXT</div>
        {totalDue > 0 && current ? (
          <>
            <div class="rail-sn-topic">{current.name}</div>
            <div class="rail-sn-meta">
              <span class="rail-sn-mastery">
                <span class="rail-m-dot" style={`background:${masteryOf(current.percent).color}`} />
                {masteryOf(current.percent).word}
              </span>
              {current.due > 0 && <span class="rail-sn-due">{current.due} due</span>}
            </div>
            <div class="rail-sn-actions">
              <button type="button" class="rail-btn-study" onClick={() => knowledgeActions.selectTopic(current.id)}>
                Study
              </button>
              <button type="button" class="rail-path-link" onClick={() => knowledgeActions.startToday()}>
                Today’s path →
              </button>
            </div>
          </>
        ) : (
          <div class="rail-sn-clear">
            <span class="rail-m-dot" />
            <span>You’re current — nothing due</span>
          </div>
        )}
      </section>

      <div class="rail-list" aria-label="Curriculum rail">
        <div class="rail-spine" aria-hidden="true" />
        {(() => {
          let idx = 0;
          return sections.map((sec) => (
            <>
              <div class="rail-section-h">{sec.name}</div>
              {sec.topics.map((t) => {
                const state = stateAt(idx);
                idx += 1;
                return <Tile t={t} state={state} onSelect={() => knowledgeActions.selectTopic(t.id)} />;
              })}
            </>
          ));
        })()}
      </div>
    </div>
  );
}
