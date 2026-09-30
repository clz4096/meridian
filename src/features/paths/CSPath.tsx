/**
 * Computer Science path screen: where the plan stands, today's algorithm, then the
 * course plan with done checkboxes. Lazy-loaded by Today's router (it pulls in
 * algorithms.ts through AlgoOfDay, which must stay out of the main chunk).
 */
import { useEffect } from 'preact/hooks';
import { CS_COURSES } from '@/content/cs';
import { curriculumChecks, toggleCourse } from '@/features/studytracker/curriculum';
import { ensureToday } from '@/features/studytracker/trackerStore';
import { AlgoOfDay } from '@/features/studytracker/AlgoOfDay';
import { currentSummary, currentCourse } from '@/features/paths/cs';
import { pct } from '@/features/paths/types';
import { PageHead } from '@/ui/components/PageHead';
// AlgoOfDay's classes are all scoped under .pt-root, so the tracker sheet is needed here
// too; it is already in the tracker chunk, so this adds no new CSS weight.
import '@/features/studytracker/studytracker.css';
import '@/features/paths/csPath.css';

export function CSPathView() {
  const checks = curriculumChecks.value; // subscribe: toggles re-render the header and list
  // AlgoOfDay reads today's events without a date check; roll the tracker day over
  // first so a screen left open past midnight neither shows nor credits yesterday.
  useEffect(() => {
    ensureToday();
  }, []);

  const s = currentSummary(); // reads trackerState too, so the caption follows "Studied"
  const cur = currentCourse(CS_COURSES, checks);
  const { done, total, caption } = s.progress;
  const p = pct(done, total);

  return (
    <div class="cs-path">
      <PageHead title="Computer Science" note={`${done} of ${total} courses`} />
      <div class="cs-head">
        <p class="cs-course">{s.course || 'Every course in the plan is done.'}</p>
        <p class="cs-prog-cap">{caption}</p>
        <div
          class="m-progress"
          role="progressbar"
          aria-label="Computer Science progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${total} courses`}
        >
          <div class="m-progress-fill" style={{ '--m-progress': `${p}%` }} />
        </div>
      </div>

      {/* .pt-root carries the tracker palette and scoping; .wrap gives it the tracker's gutters. */}
      <div class="pt-root cs-algo">
        <div class="wrap">
          <AlgoOfDay />
        </div>
      </div>

      <div class="m-section">
        <h2 class="m-title">Course plan</h2>
        <span class="m-label m-num">
          {done} of {total}
        </span>
      </div>
      <ol class="cs-plan">
        {CS_COURSES.map((c) => {
          const isDone = !!checks[c.code];
          const id = `cs-done-${c.code.replace(/[^A-Za-z0-9]+/g, '-')}`;
          return (
            <li class={'cs-item' + (isDone ? ' done' : '')} key={c.code} aria-current={c === cur ? 'step' : undefined}>
              <div class="cs-item-head">
                <span class="m-check">
                  <input
                    id={id}
                    class="cs-check"
                    type="checkbox"
                    checked={isDone}
                    onChange={() => toggleCourse(c.code)}
                  />
                  <span class="m-check-mark" aria-hidden="true" />
                </span>
                <label class="cs-item-label" for={id}>
                  <span class="cs-code m-mono">{c.code}</span>
                  <span class="cs-name">{c.name}</span>
                </label>
                {c === cur && <span class="m-chip cs-now">Current</span>}
              </div>
              <p class="cs-topics">{c.topics}</p>
              <p class="cs-meta">
                {c.school} · {c.track} · {c.text}
              </p>
              <div class="cs-links">
                <a class="cs-link" href={c.url} target="_blank" rel="noopener noreferrer">
                  Course page
                </a>
                {c.psets.map((ps) => (
                  <a class="cs-link" key={ps.url} href={ps.url} target="_blank" rel="noopener noreferrer">
                    {ps.name}
                  </a>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
