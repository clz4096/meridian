/**
 * Browser adapter for the workout view.
 *
 * `WorkoutViewController` is written against the narrow `ViewHost` port so it
 * can be unit-tested without a DOM. This file is the only place that touches
 * real browser APIs, and it is deliberately thin — everything interesting was
 * already proven in the pure layer.
 *
 * The subtle part is `captureInputValues`. A naive implementation would
 * snapshot every input and restore it after a repaint, which would resurrect
 * stale prescriptions whenever the plan legitimately changed. Instead we track
 * which inputs the *user* actually typed into (via a delegated `input`
 * listener) and restore only those.
 */

import type { ViewHost } from '../workoutView.js';

export class DomViewHost implements ViewHost {
  /** Ids of inputs the user has edited since the last repaint. */
  private userEdited = new Set<string>();

  constructor(
    private readonly el: HTMLElement,
    private readonly scroller: { scrollY: number; scrollTo(x: number, y: number): void } = window,
  ) {
    // Delegated once: any typing inside the pane flags that input as user-owned.
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement | null;
      if (t && t.id) this.userEdited.add(t.id);
    });
  }

  get container(): HTMLElement {
    return this.el;
  }

  getActiveElementId(): string | null {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !active.id) return null;
    return this.el.contains(active) ? active.id : null;
  }

  getSelectionStart(): number | null {
    const active = document.activeElement as HTMLInputElement | null;
    if (!active || typeof active.selectionStart !== 'number') return null;
    try {
      return active.selectionStart;
    } catch {
      return null; // number inputs throw on selectionStart in some engines
    }
  }

  restoreFocus(id: string, caret: number | null): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (caret !== null && typeof el.setSelectionRange === 'function') {
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* number inputs disallow selection ranges; focus alone is enough */
      }
    }
  }

  getScrollY(): number {
    return this.scroller.scrollY;
  }

  setScrollY(y: number): void {
    this.scroller.scrollTo(0, y);
  }

  /** Only values the user typed — never the prescriptions we just computed. */
  captureInputValues(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const id of this.userEdited) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && el.value !== '') out[id] = el.value;
    }
    return out;
  }

  restoreInputValues(values: Record<string, string>): void {
    for (const [id, value] of Object.entries(values)) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = value;
    }
  }

  /** Call after a set is logged so its box reverts to the fresh prescription. */
  clearUserEdits(prefix?: string): void {
    if (!prefix) {
      this.userEdited.clear();
      return;
    }
    for (const id of [...this.userEdited]) {
      if (id.includes(prefix)) this.userEdited.delete(id);
    }
  }

  readNumber(id: string): number {
    const el = document.getElementById(id) as HTMLInputElement | null;
    const n = Number(el?.value ?? '');
    return Number.isFinite(n) ? n : 0;
  }
}
