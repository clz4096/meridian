#!/usr/bin/env node
/**
 * Meridian build — TypeScript core -> minified IIFE -> injected into index.html.
 *
 * Meridian ships as a single offline-capable HTML file, so external <script>
 * tags are not an option. This script compiles the typed core, minifies it, and
 * splices the result between two markers in the HTML. The markers make the
 * operation idempotent: running the build repeatedly replaces the same region
 * rather than appending, so the file never drifts.
 *
 *   node build.mjs            # build + inject
 *   node build.mjs --check    # verify only; fails if output would change
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const HTML = path.resolve(ROOT, '../index.html');
const ENTRY = path.resolve(ROOT, 'src/browser/entry.ts');

const START = '<!-- MERIDIAN:CORE:START -->';
const END = '<!-- MERIDIAN:CORE:END -->';

const checkOnly = process.argv.includes('--check');

/* ------------------------------------------------------------------ */
/* 1. Compile + minify                                                 */
/* ------------------------------------------------------------------ */

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022'],
  platform: 'browser',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});

const js = result.outputFiles[0].text.trim();
const hash = createHash('sha256').update(js).digest('hex').slice(0, 8);
const sizeKB = (Buffer.byteLength(js) / 1024).toFixed(1);

/* ------------------------------------------------------------------ */
/* 2. Inject between markers                                           */
/* ------------------------------------------------------------------ */

if (!existsSync(HTML)) {
  console.error(`✗ ${HTML} not found`);
  process.exit(1);
}
let html = readFileSync(HTML, 'utf8');

const block =
  `${START}\n` +
  `<script data-meridian-core="${hash}">\n${js}\n</script>\n` +
  `${END}`;

if (html.includes(START) && html.includes(END)) {
  const before = html.slice(0, html.indexOf(START));
  const after = html.slice(html.indexOf(END) + END.length);
  html = before + block + after;
} else {
  // First run: insert immediately before the first existing <script> so the
  // typed core is defined before any legacy code that calls into it.
  const anchor = html.indexOf('<script>');
  if (anchor < 0) {
    console.error('✗ no <script> tag found to anchor the core bundle');
    process.exit(1);
  }
  html = html.slice(0, anchor) + block + '\n' + html.slice(anchor);
  console.log('  (first run: inserted markers before the legacy script)');
}

/* ------------------------------------------------------------------ */
/* 3. Verify the result still parses                                   */
/* ------------------------------------------------------------------ */

const blocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let broken = 0;
for (const b of blocks) {
  if (!b.trim()) continue;
  try {
    new Function(b);
  } catch (e) {
    broken++;
    console.error('✗ script block failed to parse:', e.message);
  }
}
if (broken > 0) {
  console.error(`✗ ${broken} script block(s) invalid — refusing to write`);
  process.exit(1);
}

const current = readFileSync(HTML, 'utf8');
if (checkOnly) {
  if (current !== html) {
    console.error('✗ index.html is out of date — run `node build.mjs`');
    process.exit(1);
  }
  console.log(`✓ index.html is up to date (core ${hash}, ${sizeKB}KB)`);
  process.exit(0);
}

if (current === html) {
  console.log(`✓ no change (core ${hash}, ${sizeKB}KB)`);
} else {
  copyFileSync(HTML, HTML + '.bak');          // one-step undo
  writeFileSync(HTML, html);
  console.log(`✓ injected core ${hash} — ${sizeKB}KB minified`);
  console.log(`  html: ${(Buffer.byteLength(html) / 1024).toFixed(1)}KB  (backup at index.html.bak)`);
}

/* ------------------------------------------------------------------ */
/* 4. Report the surface the legacy code may call                      */
/* ------------------------------------------------------------------ */

const api = [...js.matchAll(/mountWorkoutView|selectWorkoutView|MeridianCore/g)];
console.log(`  global: window.MeridianCore  (${new Set(api.map((m) => m[0])).size} entry symbols present)`);
