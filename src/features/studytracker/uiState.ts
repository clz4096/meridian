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

/**
 * Active sub-tab (Today / Library / Playbook). Kept in its OWN key rather than
 * the OpenMap above, whose `load()` blind-casts values to booleans — a tab is a
 * string enum, not a boolean. Local-only, ORDINARY tier.
 */
export type TrackerTab = 'today' | 'library' | 'playbook';
const TAB_KEY = 'meridian.tracker.tab.v1';

function loadTab(): TrackerTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === 'today' || v === 'library' || v === 'playbook') return v;
  } catch {
    /* ignore */
  }
  return 'today';
}

export const activeTab = signal<TrackerTab>(loadTab());

export function setTab(t: TrackerTab): void {
  activeTab.value = t;
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    /* ignore */
  }
}
