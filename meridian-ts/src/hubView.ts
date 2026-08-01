/**
 * Hub view — the table-of-contents screen shown after Enter. A calm index of the
 * four areas, each with one glanceable stat; tapping a row opens that section.
 * Pure renderer: it takes already-computed stats and returns markup. Navigation is
 * wired by the composition root via the `open-*` data-act on each row.
 */
import { esc } from './html.js';

export type HubKey = 'knowledge' | 'workout' | 'meal' | 'data';

export interface HubStat {
  key: HubKey;
  label: string;
  desc: string;
  /** The glanceable value, e.g. "72" or "Synced". */
  value: string;
  /** Small unit after the value, e.g. "%" or " kcal". Empty for none. */
  unit: string;
  /** Caption under the value, e.g. "mastery". */
  sub: string;
  /** Accent for the value; '' leaves it in the default ink. */
  tone: 'cyan' | 'kcal' | 'ok' | '';
  /** Show a leading status dot before the value (used by Data · Synced). */
  dot?: boolean;
}

const OPEN_ACT: Record<HubKey, string> = {
  knowledge: 'open-knowledge',
  workout: 'open-workout',
  meal: 'open-meal',
  data: 'open-data',
};

function row(s: HubStat): string {
  const toneStyle = s.tone === 'cyan' ? ' style="color:var(--teal)"' : s.tone === 'kcal' ? ' style="color:var(--fuel)"' : s.tone === 'ok' ? ' style="color:var(--ok)"' : '';
  return (
    `<button class="hubrow" data-act="${OPEN_ACT[s.key]}">` +
    `<div class="hb"><div class="hlabel">${esc(s.label)}</div><div class="hdesc">${esc(s.desc)}</div></div>` +
    `<div class="hstat"><div class="hval"${toneStyle}>${s.dot ? '<span class="hdot"></span>' : ''}${esc(s.value)}${s.unit ? `<span class="hu">${esc(s.unit)}</span>` : ''}</div>` +
    `<div class="hsub">${esc(s.sub)}</div></div>` +
    `<span class="hchev" aria-hidden="true">›</span>` +
    `</button>`
  );
}

export function renderHubHTML(stats: HubStat[]): string {
  return (
    `<div class="hubtag">A quiet place for the things you’re tracking.</div>` +
    `<div class="hub">${stats.map(row).join('')}</div>`
  );
}
