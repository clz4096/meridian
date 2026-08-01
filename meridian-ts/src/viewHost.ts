/**
 * View-layer infrastructure: the DOM host port every controller renders
 * through, and the base controller that owns the focus/scroll/input-preserving
 * repaint plus click delegation shared by all four views.
 */

/** The DOM surface a view controller renders into (mocked in tests). */
export interface ViewHost {
  container: {
    innerHTML: string;
    addEventListener(type: string, handler: (e: Event) => void): void;
    querySelector(sel: string): { value?: string } | null;
  };
  getActiveElementId(): string | null;
  getSelectionStart(): number | null;
  restoreFocus(id: string, caret: number | null): void;
  getScrollY(): number;
  setScrollY(y: number): void;
  /** Values the user typed but has not logged, keyed by input id. */
  captureInputValues(): Record<string, string>;
  restoreInputValues(values: Record<string, string>): void;
  /** Horizontal scroll of `[data-keepx]` rows (e.g. the lift picker), so a repaint doesn't snap them back. */
  captureScrollX?(): Record<string, number>;
  restoreScrollX?(values: Record<string, number>): void;
}

/**
 * Shared controller base. Wires a single click listener that delegates on
 * `data-act`, and provides `paint(html)` — the focus/caret/scroll/typed-value
 * preserving DOM swap that skips the write when the markup is unchanged.
 * Subclasses implement `onAction` and expose their own typed `repaint(vm, …)`
 * that renders and calls `paint()`.
 */
export abstract class BaseViewController {
  private lastHTML = '';

  constructor(protected readonly host: ViewHost) {
    this.host.container.addEventListener('click', (e) => {
      const ds = (e.target as unknown as { dataset?: Record<string, string> } | null)?.dataset;
      if (ds?.act) this.onAction(ds.act, ds);
    });
  }

  /** Route a delegated click identified by its `data-act`. */
  protected abstract onAction(act: string, ds: Record<string, string>): void;

  /** Repaint from pre-rendered markup, preserving focus, caret, scroll and typed input. */
  protected paint(html: string): boolean {
    if (html === this.lastHTML) return false;
    const focusId = this.host.getActiveElementId();
    const caret = this.host.getSelectionStart();
    const scroll = this.host.getScrollY();
    const typed = this.host.captureInputValues();
    const scrollX = this.host.captureScrollX?.() ?? {};
    this.host.container.innerHTML = html;
    this.lastHTML = html;
    this.host.restoreInputValues(typed);
    this.host.restoreScrollX?.(scrollX);
    if (focusId) this.host.restoreFocus(focusId, caret);
    this.host.setScrollY(scroll);
    return true;
  }
}
