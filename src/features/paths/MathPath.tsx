/**
 * Math path screen: where the plan stands, today's problem or proof with a
 * write-then-check loop, and the ordered course plan with done checkboxes.
 * Lazy-loaded by the router; `MathPathSkeleton` is the matching loading state.
 */
import { useErrorBoundary, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { MATH_COURSES, type MathDailyItem } from '@/content/math';
import { curriculumChecks, toggleCourse } from '@/features/studytracker/curriculum';
import { GatedReveal } from '@/features/studytracker/GatedReveal';
import { pct } from '@/features/paths/types';
import { PageHead } from '@/ui/components/PageHead';
import { MINUTES, activeFeaturedCode, itemLabel, summarize, todaysMathItem } from '@/features/paths/math';
import './mathPath.css';

/** Same outline as the loaded screen so swapping it in causes no layout shift. */
export function MathPathSkeleton() {
  return (
    <div class="mp-root" aria-busy="true" aria-label="Loading the Math path">
      <span class="m-skel m-skel-line mp-skel-eyebrow" />
      <span class="m-skel m-skel-line mp-skel-title" />
      <span class="m-skel mp-skel-bar" />
      <span class="m-skel mp-skel-card" />
    </div>
  );
}

/**
 * Keeps a render failure in the daily item from blanking the whole screen: the plan
 * below still works, and the owner gets a retry.
 */
function Guard({ what, children }: { what: string; children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary();
  if (error)
    return (
      <div class="m-state" data-kind="error" role="alert">
        <p class="m-state-title">Couldn't show {what}</p>
        <p class="m-state-body">{error instanceof Error ? error.message : String(error)}</p>
        <button class="m-btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}

function DailyItem({ item }: { item: MathDailyItem }) {
  const [attempt, setAttempt] = useState('');
  const attemptId = `mp-attempt-${item.id}`;
  return (
    <article class="m-card mp-item" aria-labelledby="mp-item-title">
      <p class="mp-item-meta">
        <span class="m-chip">{item.kind === 'proof' ? 'Proof' : 'Problem'}</span>
        <span class="m-num mp-muted">~{MINUTES[item.kind]} min</span>
      </p>
      <h3 id="mp-item-title" class="mp-item-title">
        {item.title}
      </h3>
      <p class="mp-pre">{item.prompt}</p>
      <p class="mp-source">{item.source}</p>

      <label class="m-label mp-attempt-label" for={attemptId}>
        Your attempt
      </label>
      <textarea
        id={attemptId}
        class="mp-attempt"
        rows={6}
        value={attempt}
        placeholder="Work it out here before you check."
        onInput={(e) => setAttempt((e.currentTarget as HTMLTextAreaElement).value)}
      />

      <div class="mp-reveals">
        {item.hint && (
          <GatedReveal triggerLabel="Show hint" revealedLabel="Hint">
            <p class="mp-pre">{item.hint}</p>
          </GatedReveal>
        )}
        {/* Recall before reveal: the answer only opens once something has been attempted. */}
        <GatedReveal
          triggerLabel="Check answer"
          revealedLabel="Answer"
          lockUntil={attempt.trim().length > 0}
          lockedHint="Write an attempt first."
        >
          <p class="mp-pre">{item.answer}</p>
        </GatedReveal>
      </div>
    </article>
  );
}

export function MathPathView({ now }: { now?: Date } = {}) {
  // Read the signal here so checkbox toggles re-render this screen.
  const checks = curriculumChecks.value;
  const today = now ?? new Date();
  const s = summarize(today, checks);
  const item = todaysMathItem(today, undefined, activeFeaturedCode(checks));
  const percent = pct(s.progress.done, s.progress.total);

  if (MATH_COURSES.length === 0)
    return (
      <div class="mp-root">
        <p class="m-label">Math path</p>
        <div class="m-state" data-kind="empty">
          <p class="m-state-title">No Math courses planned</p>
          <p class="m-state-body">Add courses to src/content/math.ts to build the plan.</p>
        </div>
      </div>
    );

  return (
    <div class="mp-root">
      <PageHead title={s.course || 'Plan complete'} note="Math" />
      <div class="mp-head">
        <div
          class="m-progress"
          role="progressbar"
          aria-label="Math courses done"
          aria-valuemin={0}
          aria-valuemax={s.progress.total}
          aria-valuenow={s.progress.done}
          aria-valuetext={`${s.progress.done} of ${s.progress.total} courses`}
        >
          <div class="m-progress-fill" style={{ '--m-progress': `${percent}%` }} />
        </div>
        <p class="m-num mp-muted mp-progress-text">
          {s.progress.done} of {s.progress.total} courses · {s.progress.caption}
        </p>
      </div>

      <section aria-labelledby="mp-today">
        <div class="m-section">
          <h2 id="mp-today" class="m-title">
            Today
          </h2>
          {item && <span class="mp-muted">{itemLabel(item)}</span>}
        </div>
        {item ? (
          <Guard what="today's problem">
            <DailyItem key={item.id} item={item} />
          </Guard>
        ) : (
          <div class="m-state" data-kind="empty">
            <p class="m-state-title">No daily problems yet</p>
            <p class="m-state-body">Add items to MATH_DAILY in src/content/math.ts.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="mp-plan">
        <div class="m-section">
          <h2 id="mp-plan" class="m-title">
            Course plan
          </h2>
          <span class="m-num mp-muted">{percent}%</span>
        </div>
        <ol class="mp-plan">
          {MATH_COURSES.map((c) => {
            const done = !!checks[c.code];
            const id = `mp-done-${c.code.replace(/\W+/g, '-')}`;
            return (
              <li class="mp-course" key={c.code} aria-current={s.course.startsWith(`${c.code} ·`) ? 'step' : undefined}>
                <div class="m-row mp-course-row">
                  <span class="m-check">
                    <input
                      id={id}
                      class="mp-check"
                      type="checkbox"
                      checked={done}
                      onChange={() => toggleCourse(c.code)}
                    />
                    <span class="m-check-mark" aria-hidden="true" />
                  </span>
                  <label class="mp-course-name" for={id} data-done={done ? 'true' : undefined}>
                    <span class="mp-course-code m-num">{c.code}</span> <span class="mp-course-title">{c.name}</span>
                  </label>
                  {c.featured && <span class="m-chip mp-featured">Featured</span>}
                </div>
                <p class="mp-course-text">{c.text}</p>
                <p class="mp-links">
                  <a class="m-btn m-btn-quiet" href={c.url} target="_blank" rel="noopener noreferrer">
                    Course
                  </a>
                  {c.psets.map((p) => (
                    <a class="m-btn m-btn-quiet" key={p.url + p.name} href={p.url} target="_blank" rel="noopener noreferrer">
                      {p.name}
                    </a>
                  ))}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
