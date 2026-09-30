/**
 * Computer Science path screen: where the CST track stands, today's algorithm,
 * the paper of the week, then the CST track itself. The retired COS/MIT course
 * plan is archived in data/archive/princeton-curriculum.json; its checkboxes stay
 * in `meridian.curriculum.v1`, untouched. Lazy-loaded by Today's router (it pulls
 * in algorithms.ts through AlgoOfDay, which must stay out of the main chunk).
 */
import { useEffect, useMemo } from 'preact/hooks';
import { ensureToday } from '@/features/studytracker/trackerStore';
import { AlgoOfDay } from '@/features/studytracker/AlgoOfDay';
import { PapersSection } from '@/features/studytracker/PapersSection';
import { currentSummary } from '@/features/paths/cs';
import { pct } from '@/features/paths/types';
import { PageHead } from '@/ui/components/PageHead';
import { dataRev } from '@/ui/store';
import { CamTrack, CambridgePathSkeleton } from '@/features/cambridge/CambridgePath';
import { loadPath } from '@/features/cambridge/catalog';
import { cambridgeReady, readCambridge } from '@/features/cambridge/store';
import { Guard, retryScreen, useReady } from '@/features/cambridge/camUi';
// AlgoOfDay's classes are all scoped under .pt-root, so the tracker sheet is needed here
// too; it is already in the tracker chunk, so this adds no new CSS weight.
import '@/features/studytracker/studytracker.css';
import '@/features/paths/csPath.css';

/**
 * Resolves once the page has painted and the main thread is idle (or after
 * IDLE_CAP_MS at the latest), so the screen above the track reaches the owner
 * first.
 */
const IDLE_CAP_MS = 500;
const afterPaintIdle = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') return void setTimeout(resolve, 0);
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_CAP_MS });
        else resolve();
      }, 0),
    );
  });

/**
 * The Computer Science Tripos track (DECISIONS C11), drawn with the Cambridge
 * path's own phase map and item list, so the two tracks work the same way.
 * Only this part waits for the CST catalog track; the header, the algorithm of
 * the day and the paper above it render at once, and a skeleton of the same
 * outline holds the track's place until it arrives. The track draws once the
 * page has painted and gone idle, even when its chunk is already in: it starts
 * several screens down (below the paper of the week) and doubles the pane's
 * DOM, so drawing it with the rest would hold back the part the owner sees first.
 */
function CstTrack({ ready }: { ready: Promise<void> }) {
  void dataRev.value; // re-render on every Cambridge write and sync pull
  const both = useMemo(() => Promise.all([ready, loadPath('cst')]).then(afterPaintIdle), [ready]);
  const status = useReady(both);
  if (status === 'loading') return <CambridgePathSkeleton rows={5} head={false} />;
  if (status === 'failed')
    return (
      <div class="m-state" data-kind="error" role="alert">
        <p class="m-state-title">The CST track didn't load.</p>
        <p class="m-state-body">The study store could not be read on this device.</p>
        <button class="m-btn" type="button" onClick={retryScreen}>Try again</button>
      </div>
    );
  return <CamTrack which="cst" state={readCambridge()} now={Date.now()} title="CST track" />;
}

export function CSPathView({ camReady = cambridgeReady }: { camReady?: Promise<void> } = {}) {
  // AlgoOfDay reads today's events without a date check; roll the tracker day over
  // first so a screen left open past midnight neither shows nor credits yesterday.
  useEffect(() => {
    ensureToday();
  }, []);

  const s = currentSummary(); // reads trackerState and dataRev, so the header follows both
  const { done, total, caption } = s.progress;
  const p = pct(done, total);

  return (
    <div class="cs-path">
      <PageHead title="Computer Science" note={`${done} of ${total} items`} />
      <div class="cs-head">
        <p class="cs-course">{s.course || 'Every CST phase is done.'}</p>
        <p class="cs-prog-cap">{caption}</p>
        <div
          class="m-progress"
          role="progressbar"
          aria-label="Computer Science progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={`${done} of ${total} items`}
        >
          <div class="m-progress-fill" style={{ '--m-progress': `${p}%` }} />
        </div>
      </div>

      {/* .pt-root carries the tracker palette and scoping; .wrap gives it the tracker's gutters. */}
      <div class="pt-root cs-algo">
        <div class="wrap">
          <AlgoOfDay />
          <PapersSection />
        </div>
      </div>

      <Guard what="The CST track">
        <CstTrack ready={camReady} />
      </Guard>
    </div>
  );
}
