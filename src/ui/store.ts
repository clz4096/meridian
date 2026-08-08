/**
 * UI state as signals — the reactive replacement for app.ts's ~30 closure vars.
 * Data lives in appState (the 4 stores); components derive their ViewModel via
 * `useComputed(() => (dataRev.value, selectXView(...)))`, and every store mutation
 * calls `bump()` so those computeds re-run.
 */
import { signal } from '@preact/signals';
import type { KnowledgeItem } from '@/features/knowledge/types';
import type { Period } from '@/ui/charts/progress';
import type { Split, ScratchStatus } from '@/core/types';
import type { Weather } from '@/services/weather';

export type Tab = 'today' | 'todos' | 'scratch' | 'workout' | 'meal' | 'knowledge' | 'data';

// ── navigation ──
export const currentTab = signal<Tab>('today'); // boot lands on Today (the home)

// ── Today home ──
export const clockNow = signal(Date.now()); // ticked each minute by the Today screen
export const weather = signal<Weather | null>(null);

// ── shared chart controls ──
export const progPeriod = signal<Period>('week');
export const progLift = signal('');
export const logScale = signal(false);
export const controlsOpen = signal(false);

// ── workout UI state ──
export const wkLoaded = signal(false);
export const wkDate = signal<string | null>(null);
export const wkSplit = signal<Split | 'all'>('all');
export const wkSplitTouched = signal(false);
export const wkDeload = signal<Record<string, boolean>>({});
export const expandedEx = signal<Set<string>>(new Set());
export const wkExtrasOpen = signal(false);
export const wkShowAll = signal(false); // Today's card: show the full exercise list vs just today's split
export const wkProgOpen = signal(false); // Progress charts collapsed by default to keep the tab calm
export const activeExercise = signal<string | null>(null); // full-screen exercise detail (null = the list)
export const awayMode = signal(false); // Away from the gym → show dumbbell alternates for machine lifts

// ── knowledge UI state ──
export const kgLoaded = signal(false);
export const kgTopic = signal('algorithms'); // or the sentinels '__review__' / '__target__'
export const kgTime = signal('all');
export const kgGym = signal(false);
export const kgTarget = signal('all');
export const kgRevealed = signal<Record<string, boolean>>({});
/** Topic-screen cards graded this visit (id → next-interval hint) — locks the card so re-tapping can't re-log. */
export const kgGraded = signal<Record<string, string>>({});
export const kgItems = signal<Record<string, KnowledgeItem[]>>({}); // fetched question bank
export const kgProgressOpen = signal(false); // secondary charts/trends view, opened on demand from the gallery
export const kgOverview = signal(true); // the card gallery is the default landing; false = a topic's study body

// ── meal UI state ──
export const sgLoaded = signal(false);
export const sgDate = signal<string | null>(null);
export const sgLogOpen = signal(false);
export const sgExtrasOpen = signal(false);

// ── todos UI state ── (todos live in the core store, loaded at boot — no lazy load)
export const todoView = signal<'due' | 'all' | 'done'>('all'); // segmented view
export const todoAdding = signal(false); // FAB-revealed add form

// ── scratchpad UI state ── (scratch lives in the core store, loaded at boot)
export const scratchFilter = signal<ScratchStatus | 'all'>('all');
export const scratchOpen = signal<string | null>(null); // id of the card being edited/expanded
export const scratchAdding = signal(false); // FAB-revealed capture form

// ── data UI state ──
export const dataMsg = signal<{ text: string; bad: boolean }>({ text: '', bad: false });

// ── reactivity trigger: bump after any data-store mutation ──
export const dataRev = signal(0);
export const bump = (): void => {
  dataRev.value++;
};

// ── chrome (save chip + rest bar) ──
export const saveState = signal<{ dirty: boolean; failed: boolean }>({ dirty: false, failed: false });
export const savedFlash = signal(false); // transient "saved ✓" pulse
export interface RestState {
  label: string;
  remaining: string;
  sub: string;
  fill: number;
  over: boolean;
}
export const restState = signal<RestState | null>(null);
