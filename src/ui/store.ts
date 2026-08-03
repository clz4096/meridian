/**
 * UI state as signals — the reactive replacement for app.ts's ~30 closure vars.
 * Data lives in appState (the 4 stores); components derive their ViewModel via
 * `useComputed(() => (dataRev.value, selectXView(...)))`, and every store mutation
 * calls `bump()` so those computeds re-run.
 */
import { signal } from '@preact/signals';
import type { KnowledgeItem } from '@/features/knowledge/types';
import type { Period } from '@/ui/charts/progress';
import type { Split } from '@/core/types';

export type Tab = 'workout' | 'meal' | 'knowledge' | 'data';

// ── navigation ──
export const currentTab = signal<Tab>('knowledge');
export const atHub = signal(true); // boot lands on the hub

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

// ── knowledge UI state ──
export const kgLoaded = signal(false);
export const kgTopic = signal('algorithms'); // or the sentinels '__review__' / '__target__'
export const kgTime = signal('all');
export const kgGym = signal(false);
export const kgTarget = signal('all');
export const kgRevealed = signal<Record<string, boolean>>({});
export const kgItems = signal<Record<string, KnowledgeItem[]>>({}); // fetched question bank
export const kgLogOpen = signal(false);

// ── meal UI state ──
export const sgLoaded = signal(false);
export const sgDate = signal<string | null>(null);
export const sgLogOpen = signal(false);
export const sgExtrasOpen = signal(false);

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
