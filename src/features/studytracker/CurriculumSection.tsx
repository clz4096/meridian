/**
 * Curriculum — the Princeton/MIT proof-and-pset track. Shows the problem set of
 * the week, then the course ladder grouped by track with completion checkboxes
 * and links to real problem sets. Content in curriculum.ts; checks persisted.
 */
import { CURRICULUM, curriculumChecks, toggleCourse, curriculumSummary, psetOfWeek, type Course } from '@/features/studytracker/curriculum';
import { Collapsible } from '@/features/studytracker/Collapsible';

const TRACK_ORDER: Course['track'][] = ['Math', 'Algorithms', 'Theory', 'Systems'];

export function CurriculumSection() {
  const checks = curriculumChecks.value; // subscribe
  const { done, total } = curriculumSummary();
  const pw = psetOfWeek();
  const byWeek = [...CURRICULUM].sort((a, b) => a.targetWeek - b.targetWeek);

  return (
    <Collapsible id="curriculum" eyebrow="Curriculum" title="The theory track" defaultOpen={false}>
      <p class="hint">A proof-and-pset path a Princeton theory student actually walks: discrete math and analysis, then algorithms, then computation and complexity. {done} of {total} courses done.</p>

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
            {courses.map((c) => (
              <div class={'cur-course' + (checks[c.code] ? ' done' : '')} key={c.code}>
                <button
                  class="cur-chk"
                  type="button"
                  role="checkbox"
                  aria-checked={!!checks[c.code]}
                  aria-label={`${c.code} done`}
                  onClick={() => toggleCourse(c.code)}
                >
                  {checks[c.code] ? '✓' : ''}
                </button>
                <div class="cur-body">
                  <div class="cur-title">
                    <span class="cur-code">{c.code}</span>
                    <span class="cur-name">{c.name}</span>
                    <span class="cur-wk">Wk {c.targetWeek}</span>
                  </div>
                  <div class="cur-topics">{c.topics}</div>
                  <div class="cur-meta">{c.school} · {c.text}</div>
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
            ))}
          </div>
        );
      })}
    </Collapsible>
  );
}
