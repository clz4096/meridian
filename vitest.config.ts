import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Fast by default, deep on demand.
 *
 * Property tests default to 100 iterations so the suite returns in seconds
 * during development. CI and pre-release runs set FC_RUNS=10000 for the full
 * mathematical sweep. Same tests either way — only the sample size changes.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Component tests (.tsx) need a DOM; the pure logic tests (.ts) stay on the
    // fast node default so the perf-sensitive suites aren't slowed by jsdom.
    // .tsx component tests + the actions test (its bodies call host DOM helpers)
    // run in jsdom; the pure logic .test.ts files stay on fast node.
    environmentMatchGlobs: [
      ['**/*.test.tsx', 'jsdom'],
      ['**/actions.test.ts', 'jsdom'],
    ],
    // jsdom has no Web Storage; install an in-memory localStorage for the
    // component tests (host.ts / appState read it directly).
    setupFiles: ['./src/test/setup.ts'],
    // Perf assertions are timing-sensitive; keep worker count modest so a
    // saturated CPU cannot produce a false failure.
    maxConcurrency: 4,
    reporters: process.env.CI ? ['default'] : ['dot'],
    testTimeout: 60_000,
  },
});
