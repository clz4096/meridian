/**
 * Demo mode for the public preview build (`vite build --mode demo`, VITE_DEMO=1).
 *
 * The preview is served from the same origin as the live app, so without this it
 * would read and write the owner's real localStorage, IndexedDB, and Supabase
 * credentials. Imported first by main.tsx so it runs before any store loads:
 *   - every localStorage key is prefixed, so real keys are invisible and untouched;
 *   - every IndexedDB database name is prefixed, for the same reason;
 *   - with no credentials visible, cloud sync and the AI proxy stay off;
 *   - synthetic data is written on first open.
 * In normal builds the whole body is dead code and Rollup drops it.
 */
import { demoSeed } from '@/app/demoSeed';

const PREFIX = 'meridian_demo::';

function prefixedStorage(real: Storage): Storage {
  const own = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < real.length; i++) {
      const k = real.key(i);
      if (k?.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  };
  return {
    get length() { return own().length; },
    key: (i: number) => own()[i] ?? null,
    getItem: (k: string) => real.getItem(PREFIX + k),
    setItem: (k: string, v: string) => real.setItem(PREFIX + k, String(v)),
    removeItem: (k: string) => real.removeItem(PREFIX + k),
    clear: () => { for (const k of own()) real.removeItem(PREFIX + k); },
  };
}

if (import.meta.env.VITE_DEMO === '1') {
  const real = window.localStorage;
  const demo = prefixedStorage(real);
  Object.defineProperty(window, 'localStorage', { value: demo, configurable: true });

  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (name: string, version?: number) {
    return open.call(this, 'meridian_demo_' + name, version);
  };

  if (!demo.getItem('demo.seeded')) {
    for (const [k, v] of Object.entries(demoSeed(Date.now()))) demo.setItem(k, v);
    demo.setItem('demo.seeded', '1');
  }
  document.documentElement.dataset.demo = '1';
}
