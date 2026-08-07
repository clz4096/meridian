import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Self-contained single-file build for shareable interactive previews (Artifacts).
// No PWA/SW, relative base, everything (JS+CSS+dynamic chunks) inlined into one HTML.
export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { target: 'es2022', outDir: 'dist-preview', chunkSizeWarningLimit: 4000, emptyOutDir: true },
  plugins: [preact(), viteSingleFile()],
});
