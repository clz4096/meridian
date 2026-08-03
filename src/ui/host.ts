/**
 * Host adapter for the Preact layer — the lean DOM/side-effect surface that
 * appState, the actions, and RestTimer call. Replaces DomAppHost: navigation and
 * tab routing are now signal/component-driven, so this only implements the real
 * side effects (localStorage, dialogs, transient status lines by id, and the save
 * chip + rest bar bridged to signals).
 */
import type { SaveChipState, StatusSink, RestBarHost, Tone } from '@/core/appHost';
import { saveState, savedFlash, restState } from '@/ui/store';

const TONE_COLOR: Record<Tone, string> = {
  muted: 'var(--muted)',
  ok: 'var(--ok)',
  bad: 'var(--deficit)',
  plain: 'var(--text)',
};

const byId = (id: string): HTMLElement | null => document.getElementById(id);

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let flashTimer: number | undefined;
let restStopFn: (() => void) | null = null;
/** Invoked by the RestBar component's Skip button. */
export const stopRest = (): void => restStopFn?.();

export const host = {
  getItem: (k: string): string | null => localStorage.getItem(k),
  setItem: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* quota / private mode — best effort */
    }
  },

  readValue: (id: string): string => (byId(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '',
  setValue: (id: string, v: string): void => {
    const e = byId(id) as HTMLInputElement | HTMLTextAreaElement | null;
    if (e) e.value = v;
  },

  status: (id: string): StatusSink => ({
    set(text: string, tone: Tone = 'muted') {
      const e = byId(id);
      if (e) {
        e.textContent = text;
        e.style.color = TONE_COLOR[tone];
      }
    },
  }),

  confirm: (message: string): boolean => window.confirm(message),
  prompt: (message: string, def?: string): string | null => window.prompt(message, def),
  copy: async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
  reload: (delayMs = 0): void => {
    window.setTimeout(() => window.location.reload(), delayMs);
  },

  // save chip → signal
  paintSaveChip: (state: SaveChipState): void => {
    saveState.value = { dirty: state.dirty || !!state.failed, failed: !!state.failed };
  },
  flashSaved: (): void => {
    savedFlash.value = true;
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => {
      savedFlash.value = false;
    }, 1200);
  },

  // rest bar → signal
  restBar: {
    paint(label: string, elapsedSec: number, targetSec: number, over: boolean): void {
      restState.value = {
        label: over ? 'Rest complete' : 'Rest',
        remaining: over ? 'Ready' : mmss(targetSec - elapsedSec),
        sub: label,
        fill: targetSec ? Math.min(100, (elapsedSec / targetSec) * 100) : 0,
        over,
      };
    },
    hide(): void {
      restState.value = null;
    },
    onStop(fn: () => void): void {
      restStopFn = fn;
    },
  } satisfies RestBarHost,
};

export type Host = typeof host;
