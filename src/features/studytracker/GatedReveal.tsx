/**
 * GatedReveal — a recall-before-reveal / opt-in disclosure primitive used across
 * the Study Tracker. It renders a single trigger button; clicking it reveals
 * `children` in place (and keeps them open), firing `onReveal` exactly once. When
 * `lockUntil` is provided and false, the trigger is disabled and `lockedHint` is
 * shown — the caller uses this to force a retrieval attempt before the answer can
 * be seen. Dependency-light: local state only, styled with the .gr-* class set.
 */
import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export function GatedReveal({
  triggerLabel, revealedLabel, lockUntil, lockedHint, onReveal, children,
}: {
  triggerLabel: string;
  revealedLabel?: string;
  /** When provided and false, the trigger is locked (disabled). Omit for an always-open trigger. */
  lockUntil?: boolean;
  lockedHint?: string;
  onReveal?: () => void;
  children: ComponentChildren;
}) {
  const [revealed, setRevealed] = useState(false);
  const locked = lockUntil === false; // undefined or true → unlocked

  const reveal = (): void => {
    if (locked || revealed) return;
    setRevealed(true);
    onReveal?.(); // once — the button is disabled after reveal, so this cannot re-fire
  };

  return (
    <div class="gr">
      <button
        class="primary gr-trigger"
        type="button"
        disabled={locked || revealed}
        aria-expanded={revealed}
        onClick={reveal}
      >
        {revealed ? (revealedLabel ?? triggerLabel) : triggerLabel}
      </button>
      {locked && lockedHint && <span class="gr-locked-hint">{lockedHint}</span>}
      {revealed && <div class="gr-panel">{children}</div>}
    </div>
  );
}
