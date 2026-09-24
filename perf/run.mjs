/**
 * Meridian perf harness: build sizes, Lighthouse load metrics, and per-tab
 * runtime cost on empty and seeded (synthetic history) stores.
 *
 *   npm run perf                      full run (build + load + runtime), n=5
 *   npm run perf -- --against HEAD    A/B: interleave runs of HEAD and the working tree
 *   npm run perf -- --runs 3          fewer runs
 *   npm run perf -- --no-build        reuse dist/ (single mode only)
 *   npm run perf -- --only runtime    skip Lighthouse (or --only load)
 *   npm run perf -- --seed-days 365   longer synthetic history (default 90)
 *   npm run perf -- --save-baseline   also write perf/baseline.json (single mode)
 *
 * Use --against to judge a change. A laptop's background load moves these
 * timings by several times between minutes, so two separate runs compare
 * noise; alternating A, B, A, B puts both builds under the same conditions.
 *
 * Everything runs locally against `vite preview`; every off-origin request is
 * aborted, so nothing leaves the machine and weather/HN/Supabase can't add noise.
 * Results land in perf/results/ (gitignored). Medians throughout, with min..max.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';
import { makeSeed } from './seed.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const RUNS = Number(opt('--runs', 5));
const ONLY = opt('--only', 'all');
const AGAINST = opt('--against', null);
// 90 days ~ the owner's real workout history today; longer seeds hit the quadratic
// weekStrength path and take minutes per run (see meridian-checkpoint.md).
const SEED_DAYS = Number(opt('--seed-days', 90));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const stat = (xs) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
const round = (x, p = 0) => Math.round(x * 10 ** p) / 10 ** p;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, cwd = '.') => execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

/* ── build sizes ── */
function buildSizes(dir, build) {
  if (build) execSync('npx vite build', { cwd: dir, stdio: 'ignore' });
  const sizes = {};
  for (const f of readdirSync(`${dir}/dist/assets`)) {
    if (!/\.(js|css)$/.test(f)) continue;
    const buf = readFileSync(`${dir}/dist/assets/${f}`);
    // Entry chunks are index-*; lazy chunks keep their module name (e.g. StudyTracker-*).
    const name = f.replace(/-[\w-]{8}\.(js|css)$/, '');
    const ext = f.endsWith('.css') ? 'css' : 'js';
    const kind = name === 'index'
      ? (ext === 'css' ? 'css' : buf.includes('WebGLRenderer') ? 'jsLanding' : 'jsMain')
      : `lazy:${name}:${ext}`;
    sizes[kind] = {
      file: f, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length,
      brotli: brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length,
    };
  }
  sizes.precacheEntries = (readFileSync(`${dir}/dist/sw.js`, 'utf8').match(/url:"/g) ?? []).length;
  return sizes;
}

/* ── Lighthouse (default mobile profile: 4x CPU, slow 4G, simulated) ── */
async function launch() {
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--enable-precise-memory-info'], protocolTimeout: 300_000 });
}

async function loadRun(t) {
  const browser = await launch();
  try {
    const port = Number(new URL(browser.wsEndpoint()).port);
    const res = await lighthouse(t.url, {
      port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices'],
    });
    const a = res.lhr.audits;
    const c = res.lhr.categories;
    return {
      perf: c.performance.score * 100, a11y: c.accessibility.score * 100, bp: c['best-practices'].score * 100,
      fcp: a['first-contentful-paint'].numericValue, lcp: a['largest-contentful-paint'].numericValue,
      tbt: a['total-blocking-time'].numericValue, cls: a['cumulative-layout-shift'].numericValue,
      tti: a.interactive.numericValue, bootup: a['bootup-time'].numericValue,
      bytes: a['total-byte-weight'].numericValue,
      failing: Object.entries(a).filter(([, x]) => x.score === 0 && x.scoreDisplayMode === 'binary').map(([k]) => k),
    };
  } finally {
    await browser.close();
  }
}

/* ── runtime: Enter -> Today, then open/close every section ── */
// Label -> how to open it from Today. Tiles are matched by label; Todos/Scratch are quick buttons.
const SECTIONS = [
  ['Todos', '.today-qbtn:not(.scratch)'],
  ['Scratchpad', '.today-qbtn.scratch'],
  ['Knowledge', 'tile'], ['Princeton Roadmap', 'tile'], ['WGU Roadmap', 'tile'],
  ['Workout', 'tile'], ['Food & Body', 'tile'], ['Data', 'tile'],
];

const PRELUDE = (seed) => {
  if (seed) for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); })
    .observe({ type: 'longtask', buffered: true });
  // Two frames after the work: the pane has been laid out and painted.
  window.__frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
};

async function runtimeRun(t, seed) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().startsWith(`http://localhost:${t.port}/`) ? r.continue() : r.abort()));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    // Tab switches are same-document (pushState), so the seed is written once per browser.
    await page.evaluateOnNewDocument(PRELUDE, seed);

    await page.goto(t.url, { waitUntil: 'load' });
    await page.waitForSelector('#enter');
    await sleep(1500); // landing chunk settles

    const measure = async (act, readySel) => {
      const n = await page.evaluate(() => window.__lt.length);
      const t0 = await page.evaluate(() => performance.now());
      await act();
      await page.waitForSelector(readySel, { timeout: 120_000 });
      const t1 = await page.evaluate(() => window.__frame());
      const lts = await page.evaluate((k) => window.__lt.slice(k), n);
      return { ms: t1 - t0, longMs: lts.reduce((s, d) => s + d, 0) };
    };

    const out = { enter: await measure(() => page.click('#enter'), 'button.tile'), sections: {}, errors };
    await sleep(2500); // past the deferred 2 s cloud pull (aborted offline)

    for (const [label, how] of SECTIONS) {
      const open = () => page.evaluate((l, h) => {
        const el = h === 'tile'
          ? [...document.querySelectorAll('button.tile')].find((b) => b.querySelector('.tile-l')?.textContent === l)
          : document.querySelector(h);
        el?.click();
      }, label, how);
      // A lazy pane shows .pane-loading until its chunk arrives; ready means real content.
    const o = await measure(open, '[id^="pane-"]:not(#pane-today):not(:has(.pane-loading))');
      const b = await measure(() => page.evaluate(() => history.back()), 'button.tile');
      out.sections[label] = { ms: o.ms, longMs: o.longMs, backMs: b.ms };
      await sleep(400);
    }
    out.heapMB = await page.evaluate(() => performance.memory.usedJSHeapSize / 1048576);
    return out;
  } finally {
    await browser.close();
  }
}

function summariseRuntime(runs) {
  const s = {
    enterMs: stat(runs.map((r) => r.enter.ms)), enterLongMs: stat(runs.map((r) => r.enter.longMs)),
    heapMB: stat(runs.map((r) => r.heapMB)), sections: {},
    errors: [...new Set(runs.flatMap((r) => r.errors))],
  };
  for (const [label] of SECTIONS) {
    s.sections[label] = {
      ms: stat(runs.map((r) => r.sections[label].ms)),
      longMs: stat(runs.map((r) => r.sections[label].longMs)),
      backMs: stat(runs.map((r) => r.sections[label].backMs)),
    };
  }
  return s;
}

/* ── targets: the working tree, plus a git ref in a throwaway worktree for A/B ── */
const cwd = process.cwd();
const targets = [{ name: 'current', dir: cwd, port: 4317 }];
let worktree = null;
if (AGAINST) {
  worktree = resolve(tmpdir(), `meridian-perf-${Date.now()}`);
  execSync(`git worktree add -q --detach ${worktree} ${AGAINST}`, { stdio: 'ignore' });
  symlinkSync(resolve(cwd, 'node_modules'), `${worktree}/node_modules`);
  targets.unshift({ name: AGAINST, dir: worktree, port: 4318 });
}
for (const t of targets) t.url = `http://localhost:${t.port}/meridian/`;

const result = {
  at: new Date().toISOString(), sha: sh('git rev-parse --short HEAD'), runs: RUNS, seedDays: SEED_DAYS,
  dirty: sh('git status --porcelain -- src index.html vite.config.ts') !== '',
  loadavgStart: loadavg().map((x) => round(x, 2)), targets: {},
};
const servers = [];
try {
  for (const t of targets) {
    result.targets[t.name] = { build: buildSizes(t.dir, AGAINST || !flag('--no-build')) };
    servers.push(await preview({ root: t.dir, preview: { port: t.port, strictPort: true }, logLevel: 'silent' }));
  }
  // Interleave: every round runs each target once, so background load hits both alike.
  if (ONLY !== 'runtime') {
    const load = Object.fromEntries(targets.map((t) => [t.name, []]));
    for (let i = 0; i < RUNS; i++) for (const t of targets) load[t.name].push(await loadRun(t));
    for (const t of targets) {
      const L = load[t.name];
      result.targets[t.name].load = Object.fromEntries(
        ['perf', 'a11y', 'bp', 'fcp', 'lcp', 'tbt', 'cls', 'tti', 'bootup', 'bytes'].map((k) => [k, stat(L.map((x) => x[k]))]));
      result.targets[t.name].load.failing = [...new Set(L.flatMap((x) => x.failing))];
    }
  }
  if (ONLY !== 'load') {
    const seed = makeSeed({ days: SEED_DAYS });
    result.seedKB = Object.values(seed).reduce((s, v) => s + v.length, 0) / 1024;
    for (const [name, s] of [['empty', null], ['seeded', seed]]) {
      const runs = Object.fromEntries(targets.map((t) => [t.name, []]));
      for (let i = 0; i < RUNS; i++) for (const t of targets) runs[t.name].push(await runtimeRun(t, s));
      for (const t of targets) result.targets[t.name][`runtime_${name}`] = summariseRuntime(runs[t.name]);
    }
  }
} finally {
  for (const s of servers) s.httpServer.close();
  if (worktree) {
    try { execSync(`git worktree remove --force ${worktree}`, { stdio: 'ignore' }); } catch { rmSync(worktree, { recursive: true, force: true }); }
  }
}
result.loadavgEnd = loadavg().map((x) => round(x, 2));

mkdirSync('perf/results', { recursive: true });
const file = `perf/results/${result.at.replace(/[:.]/g, '-')}-${result.sha}${AGAINST ? '-ab' : ''}.json`;
writeFileSync(file, JSON.stringify(result, null, 2));
if (flag('--save-baseline') && !AGAINST) writeFileSync('perf/baseline.json', JSON.stringify(result, null, 2));

/* ── report: current vs the A/B reference, or vs perf/baseline.json ── */
let refName = AGAINST;
let ref = AGAINST ? result.targets[AGAINST] : null;
if (!ref && existsSync('perf/baseline.json') && !flag('--save-baseline')) {
  const b = JSON.parse(readFileSync('perf/baseline.json', 'utf8'));
  ref = b.targets?.current ?? null;
  refName = `baseline ${b.sha}`;
}
const cur = result.targets.current;
const get = (o, path) => path.split('.').reduce((x, k) => x?.[k], o);
const val = (o, path) => { const v = get(o, path); return typeof v === 'object' && v !== null ? v : v === undefined ? undefined : { median: v }; };
const fmt = (s, unit, p) => `${round(s.median, p)}${unit}` + (s.min !== undefined && s.min !== s.max ? ` [${round(s.min, p)}..${round(s.max, p)}]` : '');
const line = (label, path, unit = '', p = 0) => {
  const v = val(cur, path);
  if (!v) return;
  const b = ref ? val(ref, path) : undefined;
  let tail = '';
  if (b) {
    const d = v.median - b.median;
    const pct = b.median ? ` ${d >= 0 ? '+' : ''}${round((100 * d) / b.median)}%` : '';
    tail = `   ${refName}: ${fmt(b, unit, p)}   delta ${d >= 0 ? '+' : ''}${round(d, p)}${unit}${pct}`;
  }
  console.log(`${label.padEnd(26)}${fmt(v, unit, p).padStart(24)}${tail}`);
};
console.log(`\nMeridian perf  ${result.sha}${result.dirty ? ' +uncommitted' : ''}  n=${RUNS}${AGAINST ? `  A/B vs ${AGAINST} (interleaved)` : ''}`);
console.log(`load avg ${result.loadavgStart.join(' ')} -> ${result.loadavgEnd.join(' ')}   ${file}\n`);
console.log('median [min..max]');
line('main JS gzip (B)', 'build.jsMain.gzip');
line('landing JS gzip (B)', 'build.jsLanding.gzip');
line('CSS gzip (B)', 'build.css.gzip');
for (const k of Object.keys(cur.build).filter((k) => k.startsWith('lazy:'))) line(`${k.slice(5)} gzip (B)`, `build.${k}.gzip`);
line('Lighthouse perf', 'load.perf');
line('Lighthouse a11y', 'load.a11y');
line('FCP', 'load.fcp', ' ms');
line('LCP', 'load.lcp', ' ms');
line('TBT', 'load.tbt', ' ms');
line('CLS', 'load.cls', '', 3);
line('TTI', 'load.tti', ' ms');
for (const name of ['empty', 'seeded']) {
  if (!cur[`runtime_${name}`]) continue;
  console.log(`\nruntime (${name}${name === 'seeded' ? `, ${SEED_DAYS} days, ${round(result.seedKB)} KB of state` : ''})`);
  line('  Enter -> Today', `runtime_${name}.enterMs`, ' ms');
  line('  Enter long tasks', `runtime_${name}.enterLongMs`, ' ms');
  for (const [label] of SECTIONS) {
    line(`  ${label}`, `runtime_${name}.sections.${label}.ms`, ' ms');
    line('    long tasks', `runtime_${name}.sections.${label}.longMs`, ' ms');
  }
  line('  back to Today (Data)', `runtime_${name}.sections.Data.backMs`, ' ms');
  line('  JS heap', `runtime_${name}.heapMB`, ' MB', 1);
  const errs = cur[`runtime_${name}`].errors;
  if (errs.length) console.log('  PAGE ERRORS:', errs);
}
if (cur.load?.failing?.length) console.log('\nfailing binary audits:', cur.load.failing.join(', '));
