/**
 * DomAppHost — the real-DOM implementation of the {@link AppHost} port.
 *
 * This is the only new untyped DOM surface introduced by the app.ts migration.
 * Everything here is a faithful move of DOM access that used to sit inline in
 * index.html; the interesting control flow lives in the typed orchestration that
 * drives this adapter.
 *
 * Note the meal tab's DOM identity is historical: its pane is `pane-weight` and
 * its tab-bar button is `data-t="weight"`, even though the typed {@link Tab} is
 * `'meal'`. The maps below are the single place that translation happens.
 */

import type { AppHost, RestBarHost, SaveChipState, StatusSink, Tab, Tone } from '../appHost.js';

/** Status-line tone → CSS custom property (matches the legacy inline colours). */
const TONE_COLOUR: Record<Tone, string> = {
  muted: 'var(--muted)',
  ok: 'var(--ok)',
  bad: 'var(--deficit)',
  plain: 'var(--text)',
};

/** Typed tab → the pane element id it mounts into. */
const PANE_ID: Record<Tab, string> = {
  workout: 'pane-workout',
  meal: 'pane-weight',
  knowledge: 'pane-knowledge',
  data: 'pane-data',
};

/** Typed tab → the tab-bar button's `data-t` value. */
const DATA_T: Record<Tab, string> = {
  workout: 'workout',
  meal: 'weight',
  knowledge: 'knowledge',
  data: 'data',
};

/** Reverse of {@link DATA_T} for translating a clicked button back to a Tab. */
const TAB_BY_DATA_T: Record<string, Tab> = { workout: 'workout', weight: 'meal', knowledge: 'knowledge', data: 'data' };

function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

class DomRestBar implements RestBarHost {
  constructor(private readonly doc: Document) {}

  paint(label: string, elapsedSec: number, targetSec: number, over: boolean): void {
    const el = this.doc.getElementById('restbar');
    if (!el) return;
    el.style.display = 'block';
    this.doc.body.classList.add('resting'); // lifts the save status above the bar
    el.classList.toggle('over', over);
    const remaining = Math.max(0, targetSec - elapsedSec);
    const time = this.doc.getElementById('resttime');
    if (time) time.textContent = over ? 'Ready' : fmtClock(remaining);
    const l = this.doc.getElementById('restl');
    if (l) l.textContent = over ? 'Rest complete' : 'Rest';
    const e = this.doc.getElementById('reste');
    if (e) e.textContent = label;
    const fill = this.doc.getElementById('restfill');
    if (fill && !over) fill.style.width = Math.min(100, Math.round((100 * elapsedSec) / targetSec)) + '%';
  }

  hide(): void {
    const el = this.doc.getElementById('restbar');
    if (el) el.style.display = 'none';
    this.doc.body.classList.remove('resting');
  }

  onStop(fn: () => void): void {
    const stop = this.doc.getElementById('rest-stop');
    if (stop) stop.addEventListener('click', () => fn());
  }
}

export class DomAppHost implements AppHost {
  readonly restBar: RestBarHost;

  constructor(private readonly doc: Document = document) {
    this.restBar = new DomRestBar(doc);
  }

  private win(): Window {
    return this.doc.defaultView ?? window;
  }

  /* --- panes + tab routing --- */

  pane(tab: Tab): HTMLElement {
    const el = this.doc.getElementById(PANE_ID[tab]);
    if (!el) throw new Error(`pane element ${PANE_ID[tab]} missing`);
    return el;
  }

  showTab(tab: Tab): void {
    const dataT = DATA_T[tab];
    this.doc.querySelectorAll('#tabbar button').forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-t') === dataT);
    });
    this.doc.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('on'));
    this.doc.getElementById(PANE_ID[tab])?.classList.add('on');
    this.doc.body.classList.remove('at-hub');
  }

  hubPane(): HTMLElement {
    const el = this.doc.getElementById('pane-hub');
    if (!el) throw new Error('pane element pane-hub missing');
    return el;
  }

  showHub(): void {
    this.doc.querySelectorAll('.tabpane').forEach((p) => p.classList.remove('on'));
    this.doc.getElementById('pane-hub')?.classList.add('on');
    this.doc.body.classList.add('at-hub');
  }

  onTabChange(fn: (tab: Tab) => void): void {
    this.doc.querySelectorAll('#tabbar button').forEach((b) => {
      b.addEventListener('click', () => {
        const dataT = b.getAttribute('data-t') ?? '';
        const tab = TAB_BY_DATA_T[dataT];
        if (tab) fn(tab);
      });
    });
  }

  /* --- uncommitted input values --- */

  readValue(id: string): string {
    const el = this.doc.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    return el?.value ?? '';
  }

  setValue(id: string, value: string): void {
    const el = this.doc.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = value;
  }

  /* --- per-view status lines + dialogs --- */

  status(id: string): StatusSink {
    const doc = this.doc;
    return {
      set(text: string, tone?: Tone): void {
        const el = doc.getElementById(id);
        if (!el) return;
        if (tone) el.style.color = TONE_COLOUR[tone];
        el.textContent = text;
      },
    };
  }

  confirm(message: string): boolean {
    return this.win().confirm(message);
  }

  prompt(message: string, def?: string): string | null {
    return this.win().prompt(message, def);
  }

  async copy(text: string): Promise<boolean> {
    try {
      await this.win().navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  reload(delayMs?: number): void {
    const go = () => this.win().location.reload();
    if (delayMs && delayMs > 0) this.win().setTimeout(go, delayMs);
    else go();
  }

  getItem(key: string): string | null {
    try {
      return this.win().localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      this.win().localStorage.setItem(key, value);
    } catch {
      /* private-mode / quota — non-fatal */
    }
  }

  /* --- save chip / discard --- */

  paintSaveChip(state: SaveChipState): void {
    const chip = this.doc.getElementById('savechip');
    const txt = this.doc.getElementById('savetxt');
    if (!chip) return;
    // Quiet status: only visible while there's something to reflect (saving / failed).
    // A clean state hides it — autosave does the work; the transient flash confirms a save.
    if (state.failed) {
      chip.style.display = 'inline-flex';
      chip.className = 'savestat failed';
      if (txt) txt.textContent = 'Save failed';
    } else if (state.dirty) {
      chip.style.display = 'inline-flex';
      chip.className = 'savestat dirty';
      if (txt) txt.textContent = 'Unsaved';
    } else {
      chip.style.display = 'none';
    }
  }

  flashSaved(): void {
    const f = this.doc.getElementById('savedflash');
    if (!f) return;
    f.classList.add('show');
    this.win().setTimeout(() => f.classList.remove('show'), 1200);
  }

  onSave(fn: () => void): void {
    this.doc.getElementById('savechip')?.addEventListener('click', () => fn());
  }

  onDiscard(fn: () => void): void {
    this.doc.getElementById('discardfab')?.addEventListener('click', () => fn());
  }

  /* --- window lifecycle --- */

  onLifecycle(ev: 'hide' | 'visible' | 'save-shortcut', fn: () => void): void {
    if (ev === 'hide') {
      this.doc.addEventListener('visibilitychange', () => {
        if (this.doc.visibilityState === 'hidden') fn();
      });
      this.win().addEventListener('pagehide', () => fn());
      this.win().addEventListener('beforeunload', () => fn());
      return;
    }
    if (ev === 'visible') {
      this.doc.addEventListener('visibilitychange', () => {
        if (this.doc.visibilityState === 'visible') fn();
      });
      return;
    }
    // save-shortcut: ⌘S / Ctrl-S
    this.doc.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if ((ke.metaKey || ke.ctrlKey) && ke.key === 's') {
        e.preventDefault();
        fn();
      }
    });
  }
}
