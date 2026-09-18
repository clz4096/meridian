/**
 * Collapsible — a Study Tracker section with a tappable header that shows/hides
 * its body. Open state persists per id (uiState.ts). The header reuses the
 * eyebrow + section-name styling so collapsed and expanded sections read the
 * same. Keeps the page short: only the daily-loop sections default open.
 */
import type { ComponentChildren } from 'preact';
import { sectionOpen, isOpen, toggleSection } from '@/features/studytracker/uiState';

export function Collapsible(props: {
  id: string;
  eyebrow: string;
  title: string;
  defaultOpen?: boolean;
  children: ComponentChildren;
}) {
  sectionOpen.value; // subscribe so a toggle re-renders
  const def = props.defaultOpen ?? false;
  const open = isOpen(props.id, def);
  return (
    <section class={'collap' + (open ? ' open' : '')}>
      <button
        class="collap-head"
        type="button"
        aria-expanded={open}
        onClick={() => toggleSection(props.id, def)}
      >
        <span class="eyebrow">{props.eyebrow}</span>
        <span class="n">{props.title}</span>
        <span class="collap-chev" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <div class="collap-body">{props.children}</div>}
    </section>
  );
}
