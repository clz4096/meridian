/**
 * Curriculum — the Princeton/MIT proof-and-pset track. Shows the problem set of
 * the week, then the course ladder grouped by track. Each course now carries a
 * DECAYING mastery meter (Phase 3) instead of a one-way done checkbox: reviewing
 * a course sets it fully reconstructable, and it fades toward "going stale" over
 * a ~30-day half-life so retrieval, not a permanent tick, is what's rewarded.
 * Content in curriculum.ts; mastery is nested in the synced theorist store.
 */
import { CURRICULUM, psetOfWeek, type Course } from '@/features/studytracker/curriculum';
import { trackerState, currentMastery, reviewTopic } from '@/features/studytracker/trackerStore';
import { Collapsible } from '@/features/studytracker/Collapsible';

const TRACK_ORDER: Course['track'][] = ['Math', 'Algorithms', 'Theory', 'Systems'];

/** Map a decayed [0,1] mastery to a short state word. */
function masteryWord(level: number): string {
  if (level >= 0.5) return 'reconstructable';
  if (level > 0) return 'going stale';
  return 'new';
}

export function CurriculumSection() {
  trackerState.value; // subscribe: reviewTopic commits through the theorist store
  const now = Date.now();
  const levels = new Map<string, number>(CURRICULUM.map((c) => [c.code, currentMastery(c.code, now)]));
  const reconstructable = CURRICULUM.filter((c) => (levels.get(c.code) ?? 0) >= 0.5).length;
  const pw = psetOfWeek();
  const byWeek = [...CURRICULUM].sort((a, b) => a.targetWeek - b.targetWeek);

  return (
    <Collapsible id="curriculum" eyebrow="Curriculum" title="The theory track" defaultOpen={false}>
      <p class="hint">A proof-and-pset path a Princeton theory student actually walks: discrete math and analysis, then algorithms, then computation and complexity. {reconstructable} of {CURRICULUM.length} reconstructable — mastery fades, so re-derive to keep it.</p>

      {pw && (
        <div class="cur-pow">
          <div class="cur-pow-lbl">Problem set of the week</div>
          <a class="cur-pow-link" href={pw.pset.url} target="_blank" rel="noopener noreferrer">
            <span class="cur-pow-code">{pw.course.code}</span> {pw.pset.name}
          </a>
          <div class="cur-pow-sub">{pw.course.name} · {pw.course.text}</div>
        </div>
      )}

      {TRACK_ORDER.map((track) => {
        const courses = byWeek.filter((c) => c.track === track);
        if (!courses.length) return null;
        return (
          <div class="cur-track" key={track}>
            <div class="cur-track-h">{track}</div>
            {courses.map((c) => {
              const level = levels.get(c.code) ?? 0;
              const pct = Math.round(level * 100);
              const word = masteryWord(level);
              return (
                <div class={'cur-course' + (level >= 0.5 ? ' done' : '')} key={c.code}>
                  <div class="cur-body">
                    <div class="cur-title">
                      <span class="cur-code">{c.code}</span>
                      <span class="cur-name">{c.name}</span>
                      <span class="cur-wk">Wk {c.targetWeek}</span>
                    </div>
                    <div class="cur-topics">{c.topics}</div>
                    <div class="cur-meta">{c.school} · {c.text}</div>
                    <div class="cur-mastery">
                      <div class="cur-mbar"><span style={{ width: `${pct}%` }} /></div>
                      <span class="cur-mword">{word}</span>
                      <button
                        class="cur-review"
                        type="button"
                        aria-label={`Mark ${c.code} reviewed or re-derived`}
                        onClick={() => reviewTopic(c.code)}
                      >
                        Reviewed / re-derived ✓
                      </button>
                    </div>
                    <div class="cur-links">
                      <a href={c.url} target="_blank" rel="noopener noreferrer">course</a>
                      {c.psets.map((p) => (
                        <span key={p.url}>
                          {' · '}
                          <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </Collapsible>
  );
}
