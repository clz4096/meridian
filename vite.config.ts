import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Meridian is a GitHub Pages *project* site served under /meridian/, so every
// asset URL is base-relative. Vite + vite-plugin-pwa replace the old hand-rolled
// build.mjs (esbuild + HTML splice) and sw.js (manual cache bumps): Rollup emits
// content-hashed chunks (the Three/graph landing splits off automatically from the
// dynamic import), and Workbox generates the precache manifest + service worker.
export default defineConfig({
  base: '/meridian/',
  build: {
    target: 'es2022',
    // Three's landing chunk is ~500 KB; keep the warning threshold out of the way.
    chunkSizeWarningLimit: 1200,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Meridian',
        short_name: 'Meridian',
        description: 'Personal tracker: workouts, meals, knowledge study.',
        start_url: './index.html',
        display: 'standalone',
        background_color: '#070B14',
        theme_color: '#070B14',
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
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
});
