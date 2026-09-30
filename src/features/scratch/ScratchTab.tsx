/**
 * Scratchpad tab — idea cards (title + body) with a cycling lifecycle status
 * (idea → trying → shipped → parked). Cards live nested in the core store; this
 * derives via organizeScratch and reads dataRev itself so edits re-render.
 */
import { organizeScratch, SCRATCH_STATUSES, STATUS_LABEL } from '@/features/scratch/scratchSelectors';
import type { ScratchCard, ScratchStatus } from '@/core/types';
import { dataRev, scratchFilter, scratchOpen, scratchAdding, notPending } from '@/ui/store';
import { core, scratchActions } from '@/ui/actions';
import { host } from '@/ui/host';
import { PageHead } from '@/ui/components/PageHead';
import { IconPlus } from '@/ui/components/Icons';

const rv = (id: string): string => host.readValue(id);
const FILTERS: Array<ScratchStatus | 'all'> = ['all', ...SCRATCH_STATUSES];

function Card({ c }: { c: ScratchCard }) {
  const id = String(c.id);
  const open = scratchOpen.value === id;
  return (
    <div class="scard">
      <div class="scard-h">
        <select
          class={'sstatus ' + c.status}
          value={c.status}
          onChange={(e) => scratchActions.setStatus(id, (e.currentTarget as HTMLSelectElement).value)}
          title="Set status"
          aria-label={`Status of ${c.title}`}
        >
          {SCRATCH_STATUSES.map((s) => (
            <option value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button type="button" class="scard-t" aria-expanded={open} onClick={() => (scratchOpen.value = open ? null : id)}>
          {c.title}
        </button>
        <button type="button" class="scard-rm" onClick={() => scratchActions.remove(id)} title="Remove" aria-label={`Remove ${c.title}`}>
          ×
        </button>
      </div>
      {open ? (
        <div class="scard-edit">
          <input
            id={'sc-title-' + id}
            class="minp"
            defaultValue={c.title}
            key={'t' + id}
            aria-label="Idea title"
            onInput={() => scratchActions.edit(id, { title: rv('sc-title-' + id) })}
          />
          <textarea
            id={'sc-body-' + id}
            class="minp scard-body-edit"
            defaultValue={c.body}
            key={'b' + id}
            aria-label="Idea notes"
            onInput={() => scratchActions.edit(id, { body: rv('sc-body-' + id) })}
            placeholder="Notes, links, next step…"
          />
        </div>
      ) : (
        c.body && (
          <div class="scard-body" onClick={() => (scratchOpen.value = id)}>
            {c.body}
          </div>
        )
      )}
    </div>
  );
}

export function ScratchView() {
  dataRev.value; // subscribe: re-derive on add/edit/status/delete
  const filter = scratchFilter.value;
  const cards = organizeScratch(core(), filter).filter(notPending);
  const all = core().scratch ?? [];
  const total = all.length;
  const trying = all.filter((c: ScratchCard) => c.status === 'trying').length;
  const note = total === 0 ? 'Nothing yet' : `${total} ${total === 1 ? 'idea' : 'ideas'}` + (trying ? ` · ${trying} in progress` : '');
  const adding = scratchAdding.value;

  return (
    <>

      <PageHead title="Scratchpad" note={note} />

      {adding && (
        <div class="addcard">
          <input id="scratch-title" class="minp" placeholder="Idea title" aria-label="Idea title" />
          <textarea id="scratch-body" class="minp scratch-body-new" placeholder="What's the idea? (optional notes)" aria-label="Idea notes" />
          <div class="mrow" style="margin-top:8px">
            <button class="madd" onClick={() => scratchActions.add(rv('scratch-title'), rv('scratch-body'))}>
              Capture
            </button>
          </div>
        </div>
      )}

      <div class="mchips scratch-filters">
        {FILTERS.map((f) => (
          <button class={'mchip' + (filter === f ? ' on' : '')} aria-pressed={filter === f} onClick={() => (scratchFilter.value = f)}>
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {cards.length === 0 ? (
        <div class="empty">{filter === 'all' ? 'No ideas yet. Tap + to capture one.' : 'Nothing here.'}</div>
      ) : (
        cards.map((c) => <Card c={c} />)
      )}

      <button
        class={'fab scratch' + (adding ? ' on' : '')}
        onClick={() => (scratchAdding.value = !adding)}
        aria-label={adding ? 'Close' : 'Capture an idea'}
      >
        {adding ? '×' : <IconPlus size="24px" />}
      </button>
    </>
  );
}
