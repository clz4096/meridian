import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { cambridgeIndex } from './scripts/cambridge/index-plugin.mjs';

// Meridian is a GitHub Pages *project* site served under /meridian/, so every
// asset URL is base-relative. Vite + vite-plugin-pwa replace the old hand-rolled
// build.mjs (esbuild + HTML splice) and sw.js (manual cache bumps): Rollup emits
// content-hashed chunks (the Three/graph landing splits off automatically from the
// dynamic import), and Workbox generates the precache manifest + service worker.
// `--mode demo` builds the public preview (VITE_DEMO=1 from .env.demo): demo data,
// no service worker, served under /meridian/preview/redesign/.
export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/meridian/preview/redesign/' : '/meridian/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Hand-edited and scraped study data (data/cambridge/*.json), imported as JSON.
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    // Three's landing chunk is ~500 KB; keep the warning threshold out of the way.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Name the on-demand intro (three.js + src/landing) so the service worker
        // can leave it out of the precache by file name (see globIgnores below).
        manualChunks: (id) => (/[\\/](node_modules[\\/]three|src[\\/]landing)[\\/]/.test(id) ? 'intro' : undefined),
      },
    },
  },
  plugins: [
    preact(),
    // Today's small catalog index, generated from the curriculum JSON (catalogIndex.ts).
    cambridgeIndex(),
    mode !== 'demo' && VitePWA({
      registerType: 'autoUpdate',
      // A deferred <script> instead of the default parser-blocking one in <head>.
      injectRegister: 'script-defer',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Meridian',
        short_name: 'Meridian',
        description: 'Personal tracker: workouts, meals, knowledge study.',
        start_url: './index.html',
        display: 'standalone',
        background_color: '#FBF7F1',
        theme_color: '#FBF7F1',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the shell + all static assets, including the questions bank
        // (better offline than the old network-first). Cross-origin sync/AI
        // (Supabase / Pantry) is never matched here, so it stays uncached —
        // preserving the old sw.js bypass.
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        navigateFallback: 'index.html',
        // The demo preview under /preview/ is its own page, never the app shell (DECISIONS D3).
        navigateFallbackDenylist: [/\/preview\//],
        // The intro (three.js, ~134 KB gzip) only plays from the Data tab, so it is not
        // worth downloading on every first visit. It is cached the first time it plays
        // (runtimeCaching below), and works offline from then on.
        globIgnores: ['preview/**', 'assets/intro-*'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/intro-[\w-]+\.(?:js|css)$/,
            handler: 'CacheFirst', // content-hashed names: a cached copy is never stale
            options: { cacheName: 'meridian-intro', expiration: { maxEntries: 4 } },
          },
          {
            // KaTeX's fonts load with the write-up preview; cache them the first time so
            // math renders offline afterwards without precaching ~60 font files for everyone.
            urlPattern: /\/assets\/KaTeX_[\w-]+\.(?:woff2|woff|ttf)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'meridian-katex-fonts', expiration: { maxEntries: 80 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
}));
