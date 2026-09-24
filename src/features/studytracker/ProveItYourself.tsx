/**
 * "Prove it yourself" — the interactive proof step inside Algorithm of the Day.
 * Renders inline (expand-in-place on the raised elevation tier), never a modal.
 *
 * Tier A — autogradable flaw-spotting (only for algorithms with an ALGO_FLAW entry):
 *   pick the genuine defect; a correct pick credits a small practice event.
 * Tier C — self-graded reconstruction: write the correctness argument from memory,
 *   then reveal-and-compare against the authored proof. Scores the ATTEMPT only
 *   (retrieval is the top payout), never correctness.
 *
 * (Tier B, the predict-then-reveal trace, is a deliberate open item — deferred, not
 * folded into Tier C — see the Massey Standard spec.)
 */
import { useState } from 'preact/hooks';
import { ALGO_FLAW } from '@/features/studytracker/algoProveIt';
import { ALGO_PROOFS } from '@/features/studytracker/algoProofs';
import { GatedReveal } from '@/features/studytracker/GatedReveal';
import { addEntry } from '@/features/studytracker/proofJournalStore';
import { trackerState, creditEvent, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';

export function ProveItYourself(
  { algoId, algoName, invariant, correctness }: {
    algoId: string; algoName: string; invariant: string; correctness: string;
  },
) {
  const events = trackerState.value.day.events ?? {}; // subscribe: credited state resets daily
  // All hooks are called BEFORE the early return so the hook order is stable even
  // if a future caller flips algoId across a null/non-null algorithm without a key.
  const [picked, setPicked] = useState<number | null>(null);
  const [attempt, setAttempt] = useState('');
  const flaw = ALGO_FLAW[algoId];
  const proof = ALGO_PROOFS[algoId];
  if (!flaw && !proof) return null;

  const flawSolved = (events['algo:flaw:' + algoId] ?? 0) > 0;
  const reconLogged = (events['algo:proveit:' + algoId] ?? 0) > 0;

  const pick = (i: number): void => {
    setPicked(i);
    if (flaw && i === flaw.correct) creditEvent('algo:flaw:' + algoId, EVENT_WEIGHTS.algoStudied);
  };

  // algoStudied-class (not the top retrieval payout): Tier C credits the ATTEMPT,
  // is unverified, and would otherwise be farmable across all 14 algorithms.
  // The attempt itself goes to the proof journal; it used to live only in this
  // component's state and vanished on reload.
  const creditRecon = (): void => {
    addEntry(`Proof attempt: ${algoName}`, attempt, true);
    creditEvent('algo:proveit:' + algoId, EVENT_WEIGHTS.algoStudied);
  };

  return (
    <div class="algo-pi">
      <div class="algo-sub">Prove it yourself</div>

      {flaw && (
        <div class="algo-pi-tier">
          <div class="algo-pi-lbl">Spot the flaw{flawSolved && <span class="algo-pi-done">✓ solved</span>}</div>
          <p class="algo-pi-q">{flaw.question}</p>
          <div class="algo-pi-opts" role="radiogroup" aria-label="Spot the flaw">
            {flaw.options.map((opt, i) => {
              const isPicked = picked === i;
              const isCorrect = i === flaw.correct;
              const cls =
                'algo-pi-opt' +
                (picked !== null && isCorrect ? ' correct' : '') +
                (picked !== null && isPicked && !isCorrect ? ' wrong' : '');
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  class={cls}
                  onClick={() => pick(i)}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <p class={'algo-pi-explain' + (picked === flaw.correct ? ' ok' : '')}>
              <b>{picked === flaw.correct ? 'Correct. ' : 'Not quite. '}</b>
              {flaw.explain}
            </p>
          )}
        </div>
      )}

      {proof && (
        <div class="algo-pi-tier">
          <div class="algo-pi-lbl">
            Reconstruct it{reconLogged && <span class="algo-pi-done">✓ attempt logged</span>}
          </div>
          <p class="algo-pi-q">
            From memory, reconstruct why <b>{algoName}</b> is correct — state the invariant and the argument,
            and attempt the challenge. Then reveal and compare. (Scored for the attempt, never for a grade.)
          </p>
          <textarea
            class="algo-pi-input"
            rows={4}
            placeholder="State the invariant, then the correctness argument…"
            value={attempt}
            onInput={(e) => setAttempt((e.target as HTMLTextAreaElement).value)}
          />
          <GatedReveal
            triggerLabel="Reveal & compare"
            revealedLabel="Revealed — compare below"
            lockUntil={!!attempt.trim()}
            lockedHint="Write your attempt first"
            onReveal={creditRecon}
          >
            <div class="algo-pi-model">
              <div class="algo-pi-model-h">Authored proof / challenge</div>
              <p class="algo-p algo-proof">{proof}</p>
              <p class="algo-p algo-pi-reveal-item"><b>Invariant. </b>{invariant}</p>
              <p class="algo-p algo-pi-reveal-item"><b>Correctness. </b>{correctness}</p>
            </div>
          </GatedReveal>
        </div>
      )}
    </div>
  );
}
