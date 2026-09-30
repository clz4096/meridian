/**
 * Test setup. jsdom 30 ships no Web Storage implementation, but `host.ts` /
 * `appState` read `localStorage` directly — so component tests need a working
 * one. Install a minimal in-memory Storage on the global (and window). Harmless
 * for the node logic tests, which inject their own storage fakes and never touch
 * this global.
 */
import { vi } from 'vitest';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
  }
  getItem(key: string): string | null {
    return this.m.has(key) ? this.m.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.m.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.m.delete(key);
  }
  setItem(key: string, value: string): void {
    this.m.set(key, String(value));
  }
}

const store = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: store, configurable: true, writable: true });
}

// jsdom defines window.scrollTo but only logs "Not implemented" to the virtual
// console, which buries real warnings in the test output. Views call it on route
// change, so a silent no-op is enough for tests.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', { value: () => {}, configurable: true, writable: true });
}

// Component tests import the app singletons from bootstrap but never boot sync, so
// the 1 s autosave that an edit arms would call sync.save and reject with "sync not
// initialised", often after the test file has finished (an unhandled rejection that
// fails the run). Replace save with a local-only success on the real `sync` object,
// which appState holds by reference. Tests that care still spy on sync.save, and
// restoring that spy lands back on this stub. The factory only runs for test files
// that import bootstrap, so logic tests are unaffected.
vi.mock('@/app/bootstrap', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/app/bootstrap')>();
  mod.sync.save = async () => ({ localOk: true, localFailed: [], cloud: 'skipped' });
  return mod;
});
