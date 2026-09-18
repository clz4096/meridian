/**
 * Proof / Derivation Journal — a section in the Study Tracker for logging
 * proofs and derivations (write it, reconstruct it, date it). State lives in
 * proofJournal.ts (namespaced localStorage).
 */
import { useState } from 'preact/hooks';
import { journalEntries, addEntry, deleteEntry } from '@/features/studytracker/proofJournalStore';
import { host } from '@/ui/host';

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function ProofJournal() {
  const entries = journalEntries.value; // subscribe
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const save = (): void => {
    if (addEntry(title, body)) {
      setTitle('');
      setBody('');
    }
  };

  return (
    <section class="pj">
      <div class="sec-h">
        <span class="eyebrow">Write</span>
        <span class="n">Proof &amp; derivation journal</span>
      </div>
      <p class="hint">Reconstruct a proof from memory, derive a bound, or write up a problem you fought. Dated and saved in this browser.</p>

      <div class="pj-form">
        <input
          class="pj-title"
          type="text"
          placeholder="Title (e.g. Ω(n log n) sorting lower bound)"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
        <textarea
          class="pj-body"
          rows={4}
          placeholder="State the claim, then prove it. Reconstruct before you look it up."
          value={body}
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
        />
        <div class="pj-actions">
          <button class="primary" type="button" onClick={save} disabled={!title.trim() && !body.trim()}>Save entry</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p class="pj-empty">No entries yet. The first proof you reconstruct from memory goes here.</p>
      ) : (
        <div class="pj-list">
          {entries.map((e) => (
            <div class="pj-entry" key={e.id}>
              <div class="pj-entry-head">
                <span class="pj-entry-title">{e.title}</span>
                <span class="pj-entry-date">{fmtDate(e.at)}</span>
                <button
                  class="pj-del"
                  type="button"
                  aria-label="Delete entry"
                  onClick={() => {
                    if (host.confirm('Delete this journal entry?')) deleteEntry(e.id);
                  }}
                >
                  ×
                </button>
              </div>
              {e.body && <div class="pj-entry-body">{e.body}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
