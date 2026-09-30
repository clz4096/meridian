/**
 * Per-route vitals, bytes and screenshots. Serves the built dist/ (run `npx vite build`
 * first), opens every screen at iPhone width with 4x CPU throttle, and records:
 *   - initial load: LCP, CLS, FCP (PerformanceObserver, lab values)
 *   - per route: open time (click -> two frames), INP proxy (longest Event Timing
 *     duration of the opening tap), CLS added during the route, JS/CSS bytes first
 *     fetched for that route (encoded transfer size)
 *   - a full-page screenshot per route, empty and seeded, into --shots <dir>
 *
 *   node perf/routes.mjs --shots design/before --out perf/results/routes-before.json
 *   node perf/routes.mjs --legacy --dir ../meridian-base   the pre-redesign build (e7ff8d2)
 *
 * Every off-origin request is blocked, so nothing leaves the machine and no real data
 * is touched. Selectors come from ROUTES below; update them when the shell changes.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { makeSeed } from './seed.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SHOTS = opt('--shots', null);
const OUT = opt('--out', null);
const PORT = Number(opt('--port', 4319));
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = `http://localhost:${PORT}/meridian/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Optional pre-app gate (the old landing). Clicked if present, ignored if not.
const GATE = '#enter';
// [name, how to open from home]. 'tile:<name>' matches a home element by its tile label
// (.tile-l, the pre-Stage-4 home) or its data-route attribute (the Stage 4 Today: path
// cards and navigation tiles carry data-route=<tab>); anything else is a CSS selector.
// The shell may rename these; routes that can't be found are reported as missing
// rather than failing the run.
// --legacy: the pre-redesign shell (the Enter gate plus the old hub), so the baseline
// stays reproducible. Its home renders button.tile with a .tile-l label, the Todos and
// Scratchpad openers are .today-qbtn, and it has no Math, CS or Teach screens.
const LEGACY = args.includes('--legacy');
const LEGACY_ROUTES = [
  ['todos', '.today-qbtn:not(.scratch)'],
  ['scratch', '.today-qbtn.scratch'],
  ['wgu', 'tile:WGU Roadmap'],
  ['knowledge', 'tile:Knowledge'],
  ['tracker', 'tile:Princeton Roadmap'],
  ['workout', 'tile:Workout'],
  ['meal', 'tile:Food & Body'],
  ['data', 'tile:Data'],
];
const ROUTES = JSON.parse(opt('--routes', 'null')) ?? (LEGACY ? LEGACY_ROUTES : null) ?? [
  ['todos', '.td-add'],
  ['scratch', '.td-idea'],
  ['wgu', 'tile:wgu'],
  ['math', 'tile:math'],
  ['cs', 'tile:cs'],
  ['knowledge', 'tile:knowledge'],
  ['tracker', 'tile:tracker'],
  ['workout', 'tile:workout'],
  ['meal', 'tile:meal'],
  ['data', 'tile:data'],
];
// Rendered by Preact only (index.html's static frame stops above it), so it marks
// the app, not the prerendered shell, as ready.
const WEATHER_FIXTURE = JSON.stringify({
  current: { time: '2026-09-29T08:00', temperature_2m: 63.7, weather_code: 3 },
  daily: { time: ['2026-09-29'], temperature_2m_max: [68.2], temperature_2m_min: [55.1], precipitation_probability_max: [40], precipitation_sum: [0.12] },
});
const HOME_READY = opt('--home-ready', LEGACY ? 'button.tile' : 'button.td-tile');

// --dir serves another checkout's dist/ (e.g. a worktree of the baseline commit).
const DIR = opt('--dir', '.');
function serve() {
  const p = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', cwd: DIR });
  return p;
}

const PRELUDE = (seed) => {
  if (seed) for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  window.__v = { lcp: 0, cls: 0, clsAll: 0, fcp: 0, ev: [], seen: {} };
  // First time each watched selector is on screen, relative to navigation start.
  const watch = () => {
    for (const sel of window.__watch ?? []) if (!window.__v.seen[sel] && document.querySelector(sel)) window.__v.seen[sel] = performance.now();
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
  // The open time of a route starts at the trusted tap's own event timestamp.
  document.addEventListener('click', (e) => { window.__tap = e.timeStamp; }, true);
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; })
    .observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__v.clsAll += e.value; if (!e.hadRecentInput) window.__v.cls += e.value; } })
    .observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__v.fcp = e.startTime; })
    .observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.ev.push({ t: e.startTime, d: e.duration, n: e.name }); })
    .observe({ type: 'event', buffered: true, durationThreshold: 16 });
  window.__frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
};

async function run(label, seed) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  // Same device profile as perf/run.mjs. The service worker is bypassed so every
  // request shows up in the page's own network log (a worker-served fetch doesn't).
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.setBypassServiceWorker(true);
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  let bytes = { js: 0, css: 0, font: 0, other: 0 };
  const seen = new Set();
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (!r || seen.has(r.url)) return;
    seen.add(r.url);
    const k = r.type === 'Script' ? 'js' : r.type === 'Stylesheet' ? 'css' : r.type === 'Font' ? 'font' : 'other';
    bytes[k] += e.encodedDataLength;
  });
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type }));
  await page.setRequestInterception(true);
  // Off-origin requests are blocked, except the weather forecast, which gets a fixed
  // local answer so screenshots show the real weather layout (no network involved).
  page.on('request', (r) => {
    if (r.url().startsWith(`http://localhost:${PORT}/`)) return r.continue();
    if (/api\.open-meteo\.com\/v1\/forecast/.test(r.url())) return r.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: WEATHER_FIXTURE });
    return r.abort();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument(PRELUDE, seed);
  await page.evaluateOnNewDocument((g, h) => { window.__watch = [g, h]; }, GATE, HOME_READY);

  const out = { label, load: {}, routes: {}, errors };
  await page.goto(BASE, { waitUntil: 'load' });
  // Time to a usable home screen. With a gate (the old landing), that is time to the
  // gate being tappable plus Enter -> home; the pause before the tap is excluded.
  let gateMs = 0;
  if (await page.$(GATE)) {
    await page.waitForSelector(GATE, { visible: true });
    gateMs = await page.evaluate((g) => window.__v.seen[g] ?? performance.now(), GATE);
    await sleep(1200);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-00-gate.png` });
    const t0 = await page.evaluate(() => performance.now());
    await page.click(GATE);
    await page.waitForSelector(HOME_READY, { timeout: 60_000 });
    gateMs += (await page.evaluate(() => window.__frame())) - t0;
  } else {
    await page.waitForSelector(HOME_READY, { timeout: 60_000 });
    gateMs = await page.evaluate((h) => window.__v.seen[h] ?? performance.now(), HOME_READY);
  }
  out.homeReadyMs = gateMs;
  await sleep(2500); // deferred work (cloud pull aborts offline, idle prefetch)
  const v0 = await page.evaluate(() => ({ lcp: window.__v.lcp, cls: window.__v.cls, fcp: window.__v.fcp }));
  out.load = { ...v0, bytes: { ...bytes } };
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-01-home.png`, fullPage: true });
  bytes = { js: 0, css: 0, font: 0, other: 0 };

  let i = 2;
  for (const [name, how] of ROUTES) {
    // Path cards render after the home screen is ready (their summaries load lazily),
    // so give a route's own element a moment to appear before calling it missing.
    if (!how.startsWith('tile:')) await page.waitForSelector(how, { timeout: 10_000 }).catch(() => {});
    const handle = await page.evaluateHandle((h) => {
      const el = h.startsWith('tile:')
        ? [...document.querySelectorAll('button.tile, [data-route]')].find((b) =>
          (b.querySelector('.tile-l')?.textContent ?? b.getAttribute('data-route')) === h.slice(5))
        : document.querySelector(h);
      if (el) el.scrollIntoView({ block: 'center' });
      return el ?? null;
    }, how);
    if (!(await handle.evaluate((el) => !!el))) { out.routes[name] = { missing: true }; continue; }
    await sleep(150);
    await page.evaluate(() => { window.__cls0 = window.__v.clsAll; window.__ev0 = window.__v.ev.length; window.__tap = 0; });
    await handle.click(); // a real (trusted) tap, so Event Timing records it
    await page.waitForSelector('[id^="pane-"]:not(#pane-today):not(:has(.pane-loading))', { timeout: 60_000 });
    const t1 = await page.evaluate(() => window.__frame());
    // Event Timing entries arrive after the next paint through an async observer, and
    // the whole route transition counts for CLS (a tap marks shifts as "recent input",
    // so the load-style CLS would always read 0 here). Wait, then read both.
    await sleep(800);
    const r = await page.evaluate((t) => {
      const ev = window.__v.ev.slice(window.__ev0);
      return { ms: t - window.__tap, inp: ev.reduce((m, e) => Math.max(m, e.d), 0), cls: window.__v.clsAll - window.__cls0 };
    }, t1);
    out.routes[name] = { ...r, bytes: { ...bytes } };
    bytes = { js: 0, css: 0, font: 0, other: 0 };
    await page.evaluate(() => window.scrollTo(0, 0)); // the section opens wherever home was scrolled
    await sleep(200);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${label}-${String(i++).padStart(2, '0')}-${name}.png`, fullPage: true });
    await page.evaluate(() => history.back());
    await page.waitForSelector(HOME_READY, { timeout: 60_000 });
    await sleep(400);
  }
  await browser.close();
  return out;
}

const server = serve();
try {
  for (let k = 0; k < 40; k++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    await sleep(250);
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const result = { at: new Date().toISOString(), empty: await run('empty', null), seeded: await run('seeded', makeSeed({ days: 90 })) };
  const kb = (b) => (b / 1024).toFixed(1);
  for (const s of ['empty', 'seeded']) {
    const r = result[s];
    console.log(`\n${s}: home usable ${r.homeReadyMs.toFixed(0)} ms, load LCP ${r.load.lcp.toFixed(0)} ms, FCP ${r.load.fcp.toFixed(0)} ms, CLS ${r.load.cls.toFixed(3)}, JS ${kb(r.load.bytes.js)} KB, CSS ${kb(r.load.bytes.css)} KB, fonts ${kb(r.load.bytes.font)} KB`);
    for (const [n, x] of Object.entries(r.routes)) {
      console.log(x.missing ? `  ${n}: missing` : `  ${n}: open ${x.ms.toFixed(0)} ms, INP~ ${x.inp.toFixed(0)} ms, CLS ${x.cls.toFixed(3)}, +JS ${kb(x.bytes.js)} KB, +CSS ${kb(x.bytes.css)} KB`);
    }
    if (r.errors.length) console.log('  page errors:', r.errors);
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
} finally {
  server.kill();
}
