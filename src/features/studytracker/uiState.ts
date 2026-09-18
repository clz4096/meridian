/**
 * Study Tracker UI state — which collapsible sections are open. Persisted to
 * `meridian.tracker.ui.v1` so the layout the user leaves is the layout they
 * return to. ORDINARY tier, local only.
 */
import { signal } from '@preact/signals';

type OpenMap = Record<string, boolean>;
const KEY = 'meridian.tracker.ui.v1';

function load(): OpenMap {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as OpenMap;
  } catch {
    /* ignore */
  }
  return {};
}

export const sectionOpen = signal<OpenMap>(load());

/** Open state for a section, falling back to its default when never toggled. */
export function isOpen(id: string, def: boolean): boolean {
  const v = sectionOpen.value[id];
  return v === undefined ? def : v;
}

export function toggleSection(id: string, def: boolean): void {
  const next = { ...sectionOpen.value, [id]: !isOpen(id, def) };
  sectionOpen.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
