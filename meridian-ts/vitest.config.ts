import { defineConfig } from 'vitest/config';

/**
 * Fast by default, deep on demand.
 *
 * Property tests default to 100 iterations so the suite returns in seconds
 * during development. CI and pre-release runs set FC_RUNS=10000 for the full
 * mathematical sweep. Same tests either way — only the sample size changes.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Perf assertions are timing-sensitive; keep worker count modest so a
    // saturated CPU cannot produce a false failure.
    maxConcurrency: 4,
    reporters: process.env.CI ? ['default'] : ['dot'],
    testTimeout: 60_000,
  },
});
