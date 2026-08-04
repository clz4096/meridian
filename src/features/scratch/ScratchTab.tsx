/**
 * Scratchpad tab — idea cards (title + body) with a cycling lifecycle status
 * (idea → trying → shipped → parked). Cards live nested in the core store; this
 * derives via organizeScratch and reads dataRev itself so edits re-render.
 */
import { organizeScratch, SCRATCH_STATUSES, STATUS_LABEL } from '@/features/scratch/scratchSelectors';
import type { ScratchCard, ScratchStatus } from '@/core/types';
import { SectionHead } from '@/ui/components/Charts';
import { dataRev, scratchFilter, scratchOpen } from '@/ui/store';
import { core, scratchActions } from '@/ui/actions';
import { host } from '@/ui/host';

const rv = (id: string): string => host.readValue(id);
const FILTERS: Array<ScratchStatus | 'all'> = ['all', ...SCRATCH_STATUSES];

function Card({ c }: { c: ScratchCard }) {
  const id = String(c.id);
  const open = scratchOpen.value === id;
  return (
    <div class="scard">
      <div class="scard-h">
        <button class={'sstatus ' + c.status} onClick={() => scratchActions.cycleStatus(id)} title="Cycle status">
          {STATUS_LABEL[c.status]}
        </button>
        <span class="scard-t" onClick={() => (scratchOpen.value = open ? null : id)}>
          {c.title}
        </span>
        <span class="scard-rm" onClick={() => scratchActions.remove(id)} title="Remove">
          ×
        </span>
      </div>
      {open ? (
        <div class="scard-edit">
          <input
            id={'sc-title-' + id}
            class="minp"
            defaultValue={c.title}
            key={'t' + id}
            onInput={() => scratchActions.edit(id, { title: rv('sc-title-' + id) })}
          />
          <textarea
            id={'sc-body-' + id}
            class="minp scard-body-edit"
            defaultValue={c.body}
            key={'b' + id}
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
  const cards = organizeScratch(core(), filter);

  return (
    <>
      <SectionHead name="Scratchpad" />

      <div class="addcard">
        <input id="scratch-title" class="minp" placeholder="Idea title" />
        <textarea id="scratch-body" class="minp scratch-body-new" placeholder="What's the idea? (optional notes)" />
        <div class="mrow" style="margin-top:8px">
          <button class="madd" onClick={() => scratchActions.add(rv('scratch-title'), rv('scratch-body'))}>
            Capture
          </button>
        </div>
      </div>

      <div class="mchips scratch-filters">
        {FILTERS.map((f) => (
          <button class={'mchip' + (filter === f ? ' on' : '')} onClick={() => (scratchFilter.value = f)}>
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>

      {cards.length === 0 ? (
        <div class="empty">{filter === 'all' ? 'No ideas yet. Capture one above.' : 'Nothing here.'}</div>
      ) : (
        cards.map((c) => <Card c={c} />)
      )}
    </>
  );
}
