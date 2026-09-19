/**
 * ReadingNote — the production field on the two reading surfaces (#1 community,
 * #2 Princeton theory). Learning-science requires an active output paired with
 * passive intake (Dunlosky 2013): one short, optional "what stuck / why it
 * matters" line that earns check-in credit once filled. Deferrable (fill any time
 * that day); day-scoped and idempotent via creditEvent's max-merge, so it can't
 * double-pay. Kept to ONE line per surface rather than one per item, so the
 * commute read stays low-friction.
 */
import { useState } from 'preact/hooks';
import { trackerState, creditEvent, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';

export function ReadingNote({ id, prompt }: { id: string; prompt: string }) {
  const events = trackerState.value.day.events ?? {}; // subscribe: resets daily
  const done = (events['read:' + id] ?? 0) > 0;
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);

  const save = (): void => {
    if (!text.trim()) return;
    creditEvent('read:' + id, EVENT_WEIGHTS.journalSave);
    setSaved(true);
  };

  return (
    <div class="read-note">
      <label class="read-note-lbl" htmlFor={'rn-' + id}>
        {prompt}
        {(done || saved) && <span class="read-note-done">✓ logged</span>}
      </label>
      <div class="read-note-row">
        <input
          id={'rn-' + id}
          class="read-note-input"
          type="text"
          placeholder="One line — what stuck, or why it matters…"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <button class="primary" type="button" disabled={!text.trim() || saved} onClick={save}>
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
