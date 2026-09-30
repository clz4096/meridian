/**
 * One study path on Today: the current course, the ONE next action, and progress.
 * Renders a PathSummary and nothing else (docs/redesign-contract.md). The loading
 * skeleton and the error card share the card's fixed height, so swapping between
 * them never moves the content below (CLS stays 0).
 */
import { pct, type PathSummary } from '@/features/paths/types';
import './pathCard.css';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export function PathCard({ summary, onOpen }: { summary: PathSummary; onOpen?: () => void }) {
  const { title, course, next, progress } = summary;
  const p = pct(progress.done, progress.total);
  const count = `${progress.done} of ${progress.total}`;
  const finished = !course;
  const meta = [next.detail, next.minutes ? `~${next.minutes} min` : ''].filter(Boolean).join(' · ');
  return (
    <button type="button" class="m-card pc" data-route={summary.id} onClick={onOpen}>
      <span class="pc-top">
        <span class="m-label">{title}</span>
        <span class="m-num pc-count">{count}</span>
      </span>
      <span class="pc-course">
        {finished ? `All ${progress.total} ${plural(progress.total, 'course', 'courses')} done` : course}
      </span>
      <span class="pc-next">
        <span class="m-label pc-next-label">Next</span>
        <span class="pc-next-text">{next.label}</span>
      </span>
      <span class="pc-meta m-num">{meta}</span>
      <span
        class="m-progress"
        role="progressbar"
        aria-label={`${title} courses done`}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-valuetext={`${count} courses`}
      >
        <span class="m-progress-fill" style={{ '--m-progress': `${p}%` }} />
      </span>
      <span class="pc-caption m-num">
        {p}%{progress.caption ? ` · ${progress.caption}` : ''}
      </span>
    </button>
  );
}

/** Same box as PathCard while its module loads. */
export function PathCardSkeleton({ title }: { title: string }) {
  return (
    <div class="m-card pc pc-skel" aria-busy="true" aria-label={`Loading ${title} path`}>
      <span class="pc-top">
        <span class="m-label">{title}</span>
      </span>
      <span class="m-skel m-skel-line pc-w-80" />
      <span class="m-skel m-skel-line pc-w-60" />
      <span class="m-skel m-skel-line pc-w-40" />
      <span class="m-skel pc-skel-bar" />
      <span />
    </div>
  );
}

/** Same box as PathCard when the path couldn't load and nothing is saved. */
export function PathCardError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div class="m-state pc pc-error" data-kind="error" role="alert">
      <p class="m-state-title">The {title} path didn't load.</p>
      <p class="m-state-body">Check your connection, then try again.</p>
      <button type="button" class="m-btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
