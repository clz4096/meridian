/**
 * AppHost — the app-shell DOM port.
 *
 * `ViewHost` already isolates the *view* DOM (one pane's innerHTML + focus/scroll
 * preservation). The remaining legacy glue in index.html touches a second, wider
 * band of the DOM: the four pane containers, the tab bar, the floating Save chip,
 * the rest-timer bar, uncommitted input values, and window lifecycle events.
 *
 * This port mirrors the `ViewHost` pattern for those app-shell concerns so the
 * orchestration (`app.ts`, `appState.ts`, `restTimer.ts`) can be pure control-flow
 * over an interface — unit-testable with a fake, with the only real DOM code
 * living in `browser/domAppHost.ts`.
 *
 * The interface grows one slice at a time as orchestration moves in. Slice 2
 * defines the core (panes, tabs, save chip, rest bar, field I/O, lifecycle);
 * slice 5 adds the per-view callback surface (status sinks, prompt/confirm,
 * clipboard, reload) as the view mounters migrate.
 */

export type Tab = 'workout' | 'meal' | 'knowledge' | 'data';

/** Colour intent for a transient status line. */
export type Tone = 'muted' | 'ok' | 'bad' | 'plain';

/** A transient in-view status line addressed by element id (meal-status, ai-<id>, d-diagout…). */
export interface StatusSink {
  /** Set the message (and optionally its colour). No-op if the element is absent. */
  set(text: string, tone?: Tone): void;
}

/** State of the floating Save chip and its companion Discard FAB. */
export interface SaveChipState {
  /** Any store dirty → show "unsaved" styling + the Discard button. */
  dirty: boolean;
  /** Optional status-line override (e.g. a sync result message). */
  text?: string;
  /** Force the dirty styling even when `text` reads as saved — the save-failed case. */
  failed?: boolean;
}

/**
 * The countdown bar shown between sets. It lives outside every tab pane, so it
 * is bound once and driven imperatively by the rest-timer state machine.
 */
export interface RestBarHost {
  /** Render the bar at `elapsed`/`target` seconds for `label` (the exercise). */
  paint(label: string, elapsedSec: number, targetSec: number, over: boolean): void;
  /** Hide the bar. */
  hide(): void;
  /** Bind the bar's Stop button once. */
  onStop(fn: () => void): void;
}

export interface AppHost {
  /* --- panes + tab routing --- */

  /** The mount container for a tab's view (passed to the `mount*View` factories). */
  pane(tab: Tab): HTMLElement;
  /** Show one tab's pane, hide the rest, and reflect the active tab-bar button. */
  showTab(tab: Tab): void;
  /** Register the tab-bar click handler; `fn` receives the newly selected tab. */
  onTabChange(fn: (tab: Tab) => void): void;

  /* --- uncommitted input values --- */

  /** Read an input's current value by id (''`` when the element is absent). */
  readValue(id: string): string;
  /** Set an input's value — used to clear the meal form after an add. */
  setValue(id: string, value: string): void;

  /* --- per-view status lines + dialogs (used by the view mounters) --- */

  /** A transient status line addressed by element id. */
  status(id: string): StatusSink;
  /** Blocking confirm dialog. */
  confirm(message: string): boolean;
  /** Blocking prompt dialog; null when cancelled. */
  prompt(message: string, def?: string): string | null;
  /** Copy text to the clipboard; resolves false on failure. */
  copy(text: string): Promise<boolean>;
  /** Reload the page, optionally after a delay (used after import/pull). */
  reload(delayMs?: number): void;
  /** Raw local key/value read (Supabase creds, legacy snapshot). Backed by localStorage. */
  getItem(key: string): string | null;
  /** Raw local key/value write. Backed by localStorage. */
  setItem(key: string, value: string): void;

  /* --- save chip / discard --- */

  /** Paint the dirty/saved FAB and toggle the Discard button. */
  paintSaveChip(state: SaveChipState): void;
  /** Flash the transient "saved ✓" confirmation. */
  flashSaved(): void;
  /** Bind the Save-chip click handler once. */
  onSave(fn: () => void): void;
  /** Bind the Discard-FAB click handler once. */
  onDiscard(fn: () => void): void;

  /* --- rest bar --- */

  readonly restBar: RestBarHost;

  /* --- window lifecycle --- */

  /**
   * Bind a lifecycle handler:
   *  - `hide`          → page backgrounded (visibilitychange→hidden, pagehide, beforeunload)
   *  - `visible`       → page foregrounded (visibilitychange→visible)
   *  - `save-shortcut` → ⌘S / Ctrl-S
   */
  onLifecycle(ev: 'hide' | 'visible' | 'save-shortcut', fn: () => void): void;
}
