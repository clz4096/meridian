/**
 * Hub — the table-of-contents screen. Full-height rounded cards, one per area,
 * each with a glanceable stat. Ports renderHubHTML/row to JSX.
 */
import { hubStats, openSection } from '@/ui/actions';
import { dataRev } from '@/ui/store';
import type { HubStat } from '@/ui/hubTypes';

const toneColor = (t: HubStat['tone']): string | undefined =>
  t === 'cyan' ? 'var(--teal)' : t === 'kcal' ? 'var(--fuel)' : t === 'ok' ? 'var(--ok)' : undefined;

export function Hub() {
  dataRev.value; // re-derive when a store mutates
  const stats = hubStats();
  return (
    <>
      <div class="hubtag">A quiet place for the things you’re tracking.</div>
      <div class="hub">
        {stats.map((s) => {
          const color = toneColor(s.tone);
          return (
            <button class="hubrow" onClick={() => openSection(s.key)}>
              <div class="hb">
                <div class="hlabel">{s.label}</div>
                <div class="hdesc">{s.desc}</div>
              </div>
              <div class="hstat">
                <div class="hval" style={color ? { color } : undefined}>
                  {s.dot && <span class="hdot" />}
                  {s.value}
                  {s.unit && <span class="hu">{s.unit}</span>}
                </div>
                <div class="hsub">{s.sub}</div>
              </div>
              <span class="hchev" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
