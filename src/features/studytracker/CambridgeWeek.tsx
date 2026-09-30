/**
 * The weekly Cambridge scorecard (docs/cambridge-screens.md section f): the
 * daily scorecard's sibling, with the same row and segmented-control markup.
 * Five lines scored Missed / Partial / Met, total 10, auto-computed by
 * cambridge/scorecard.ts and overridable by the owner.
 *
 * The parent computes the card once, because the Focus and Progress meters read
 * the same card; this component only draws it.
 */
import { Collapsible } from '@/features/studytracker/Collapsible';
import { gloss } from '@/features/cambridge/Gloss';
import { hm, isOffline, retryScreen } from '@/features/cambridge/camUi';
import type { WeekScorecard } from '@/features/cambridge/scorecard';
import type { CamWeekItem } from '@/features/cambridge/types';

const SCORE_LABELS = ['Missed', 'Partial', 'Met'] as const;

export const CAM_WEEK_ROWS: ReadonlyArray<readonly [CamWeekItem, string]> = [
  ['cold', 'Cold attempts of 60 min or more'],
  ['writeup', 'Write-ups before supervision'],
  ['supervisions', 'Both supervisions held'],
  ['redo', 'Misses redone within 48 hours'],
  ['pace', 'Phase pace target hit'],
];

export type WeekStatus = 'loading' | 'ready' | 'failed';

export function CambridgeWeek({
  status,
  card,
  savedAt,
  onSet,
  onReset,
}: {
  status: WeekStatus;
  card: WeekScorecard | null;
  /** The newest local Cambridge write, for the offline note. */
  savedAt: number;
  onSet: (item: CamWeekItem, value: 0 | 1 | 2) => void;
  onReset: (item: CamWeekItem) => void;
}) {
  return (
    <Collapsible id="cam-week" eyebrow="This week" title="Cambridge: missed, partial, met" defaultOpen={true}>
      <p class="hint">
        {gloss(
          'Scored from your Cambridge records for the week; tap a line to set it yourself. Once you log Cambridge work, the week counts as one more line in the Focus and Progress meters.',
        )}
      </p>
      {status === 'failed' || (status === 'ready' && !card) ? (
        <div class="m-state" data-kind="error" role="alert">
          <p class="m-state-title">This week's Cambridge scorecard didn't load.</p>
          <p class="m-state-body">The study store could not be read on this device.</p>
          <button class="m-btn" type="button" onClick={retryScreen}>
            Try again
          </button>
        </div>
      ) : status === 'loading' || !card ? (
        <div class="sc" aria-busy="true" aria-label="Loading this week's Cambridge scorecard">
          {CAM_WEEK_ROWS.map(([id]) => (
            <div key={id} class="scrow pt-camskel">
              <span class="m-skel m-skel-line" />
            </div>
          ))}
        </div>
      ) : (
        <Rows card={card} savedAt={savedAt} onSet={onSet} onReset={onReset} />
      )}
    </Collapsible>
  );
}

function Rows({
  card,
  savedAt,
  onSet,
  onReset,
}: {
  card: WeekScorecard;
  savedAt: number;
  onSet: (item: CamWeekItem, value: 0 | 1 | 2) => void;
  onReset: (item: CamWeekItem) => void;
}) {
  // Before any Cambridge work the rows stay unrated, like an unrated daily line,
  // so an empty week never reads as five misses.
  const empty = !card.hasData;
  return (
    <>
      <div class="sc">
        {CAM_WEEK_ROWS.map(([id, label]) => {
          const value = card.scores[id];
          // The override freezes the whole week (scorecard.ts); a line reads as set
          // by the owner only where it now differs from what the records say.
          const setByYou = card.overridden && value !== card.auto[id];
          return (
            <div key={id} class="scrow">
              <div class="txt">
                <b>{gloss(label)}</b>
                <span class="pt-camwhy m-num">{empty ? 'No Cambridge work logged this week' : card.why[id]}</span>
                {setByYou && (
                  <span class="pt-camset">
                    Set by you ·{' '}
                    <button type="button" class="pt-camreset" onClick={() => onReset(id)} aria-label={`Reset ${label} to the auto score`}>
                      Reset
                    </button>
                  </span>
                )}
              </div>
              <div class="seg" role="group" aria-label={label}>
                {SCORE_LABELS.map((lbl, n) => {
                  const on = !empty && value === n;
                  return (
                    <button key={n} class={on ? 'on' : ''} aria-pressed={on} aria-label={lbl} onClick={() => onSet(id, n as 0 | 1 | 2)}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div class="scfoot">
        <span class="tot m-num">{empty ? 'Not rated' : `${card.total} / 10`}</span>
        <span class="pt-camweek m-num">
          {isOffline() ? `Offline${savedAt ? ` · Saved ${hm(savedAt)}` : ''} · ` : ''}
          {card.week}
        </span>
      </div>
    </>
  );
}
