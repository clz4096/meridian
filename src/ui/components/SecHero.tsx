/**
 * SecHero — the shared section hero: a rounded panel with a tone-tinted glow
 * wash, a mono eyebrow, and a big value (+ unit) with an optional right-aligned
 * sub-line. This is the design-language hero used across Todos/Scratch/Data and
 * the tracker Progress/Log screens, so every section reads the same.
 *
 * tone drives both the glow (`.sechero-wash[data-tone]`) and the value color
 * (`.tone-<tone>`): ok | dirty | off | teal | fuel. subClass ('up' | 'down')
 * optionally colors the sub-line like a delta.
 */
import type { ComponentChildren } from 'preact';

export function SecHero({
  eyebrow,
  value,
  unit,
  sub,
  subClass,
  tone,
}: {
  eyebrow: string;
  value: ComponentChildren;
  unit?: string;
  sub?: ComponentChildren;
  subClass?: string;
  tone: 'ok' | 'dirty' | 'off' | 'teal' | 'fuel';
}) {
  return (
    <div class="sechero">
      <div class="sechero-wash" data-tone={tone} />
      <div class="sechero-in">
        <div class="sechero-eyb">{eyebrow}</div>
        <div class="sechero-row">
          <div class={'sechero-v tone-' + tone}>
            {value}
            {unit ? <span class="sechero-u">{unit}</span> : null}
          </div>
          {sub != null && sub !== '' ? <div class={'sechero-sub' + (subClass ? ' ' + subClass : '')}>{sub}</div> : null}
        </div>
      </div>
    </div>
  );
}
