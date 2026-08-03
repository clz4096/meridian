/**
 * Test setup. jsdom 30 ships no Web Storage implementation, but `host.ts` /
 * `appState` read `localStorage` directly — so component tests need a working
 * one. Install a minimal in-memory Storage on the global (and window). Harmless
 * for the node logic tests, which inject their own storage fakes and never touch
 * this global.
 */
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
