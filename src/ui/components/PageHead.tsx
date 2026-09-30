/**
 * PageHead: a screen's title in the section-header language Today uses (heading,
 * hairline, small-caps note). The note carries the screen's key figures as plain
 * tabular data, so no screen needs a decorative hero number.
 */
import type { ComponentChildren } from 'preact';

export function PageHead({ title, note, id }: { title: ComponentChildren; note?: ComponentChildren; id?: string }) {
  return (
    <header class="m-section m-pagehead">
      <h1 class="m-title" id={id}>
        {title}
      </h1>
      {note != null && note !== '' && <span class="m-label m-num">{note}</span>}
    </header>
  );
}
