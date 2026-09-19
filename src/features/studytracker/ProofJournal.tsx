/**
 * Proof / Derivation Journal — a section in the Study Tracker for logging
 * proofs and derivations (write it, reconstruct it, date it). State lives in
 * proofJournal.ts (namespaced localStorage).
 */
import { useState } from 'preact/hooks';
import { journalEntries, addEntry, deleteEntry } from '@/features/studytracker/proofJournalStore';
import { creditEvent, EVENT_WEIGHTS } from '@/features/studytracker/trackerStore';
import { host } from '@/ui/host';
import { Collapsible } from '@/features/studytracker/Collapsible';

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function ProofJournal() {
  const entries = journalEntries.value; // subscribe
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [recon, setRecon] = useState(false);

  const save = (): void => {
    if (addEntry(title, body, recon)) {
      // Saving a journal entry is a small credit; a reconstructed (cold-recall)
      // entry additionally pays the top retrieval payout. The retrieval credit is
      // keyed by the new entry's id (newest is first) so a second distinct
      // reconstruction the same day still pays, while a repeat of the same entry
      // can't double-pay (max per id). journal:save stays a fixed once-a-day id.
      creditEvent('journal:save', EVENT_WEIGHTS.journalSave);
      if (recon) {
        const id = journalEntries.value[0]?.id;
        if (id) creditEvent('journal:retrieval:' + id, EVENT_WEIGHTS.retrieval);
      }
      setTitle('');
      setBody('');
      setRecon(false);
    }
  };

  return (
    <Collapsible id="journal" eyebrow="Write" title="Proof & derivation journal" defaultOpen={false}>
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
        <label class="pj-recon">
          <input type="checkbox" checked={recon} onInput={(e) => setRecon((e.target as HTMLInputElement).checked)} />
          <span>Reconstructed from memory (retrieval)</span>
        </label>
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
                {e.reconstructed && <span class="pj-recon-badge">retrieval</span>}
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
    </Collapsible>
  );
}
