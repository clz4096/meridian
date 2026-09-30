/**
 * Builds the public demo preview of the redesign branch and its /progress/ page.
 *
 *   node scripts/preview.mjs            build dist-demo/ (demo app + progress page)
 *   node scripts/preview.mjs --publish  also copy it into a `main` worktree at
 *                                       public/preview/redesign/, commit only that
 *                                       folder, and push (GitHub Pages deploys main)
 *
 * The preview runs on demo data with storage isolated from the live app (src/app/demo.ts,
 * DECISIONS D1 to D3). The progress page is static HTML generated from
 * meridian-checkpoint.md (stage log), DECISIONS.md, design/scoreboard.json, and the
 * before/after screenshots (downscaled to JPEG with macOS `sips`).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'dist-demo');
const WT = resolve(ROOT, '..', 'meridian-pages'); // a `main` worktree, created on first publish
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const out = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');

/* ── 1. demo build ── */
// --no-build regenerates only the progress page (e.g. mid-stage, when the tree may not build).
if (!process.argv.includes('--no-build')) {
  rmSync(OUT, { recursive: true, force: true });
  run('npx', ['vite', 'build', '--mode', 'demo', '--outDir', 'dist-demo']);
}

/* ── 2. progress page ── */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
/** Small Markdown subset: headings, lists, checkboxes, tables, paragraphs, quotes. */
function md(src) {
  const lines = src.split('\n');
  const html = [];
  let list = null;
  const close = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { close(); const n = Math.min(m[1].length + 1, 4); html.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if (/^\|/.test(l)) {
      close();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.split('|').slice(1, -1).map((c) => inline(c.trim()));
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      html.push('<div class="tw"><table>' + body.map((r, k) =>
        `<tr>${cells(r).map((c) => (k === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('') + '</table></div>');
      continue;
    }
    if ((m = /^\s*[-*]\s+\[( |x)\]\s+(.*)/.exec(l))) {
      if (list !== 'ul') { close(); html.push('<ul class="check">'); list = 'ul'; }
      html.push(`<li class="${m[1] === 'x' ? 'done' : 'todo'}">${inline(m[2])}</li>`); continue;
    }
    if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== 'ul') { close(); html.push('<ul>'); list = 'ul'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+\.\s+(.*)/.exec(l))) { if (list !== 'ol') { close(); html.push('<ol>'); list = 'ol'; } html.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^>\s?(.*)/.exec(l))) { close(); html.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if (/^---+$/.test(l)) { close(); html.push('<hr>'); continue; }
    if (!l.trim()) { close(); continue; }
    close();
    html.push(`<p>${inline(l)}</p>`);
  }
  close();
  return html.join('\n');
}

// Stage log: the "Redesign log" section of the checkpoint.
const ck = read('meridian-checkpoint.md');
const log = (/## Redesign log\n([\s\S]*?)\n---/.exec(ck) ?? [, ''])[1];
const current = (/- \[ \] (Stage \d[^\n(]*)/.exec(log) ?? [, 'All stages done'])[1].trim();

// Screenshots: downscale PNGs to 390 px wide JPEGs.
const shotsOut = join(OUT, 'progress', 'shots');
mkdirSync(shotsOut, { recursive: true });
const shots = {};
for (const phase of ['before', 'after']) {
  const dir = join(ROOT, 'design', phase);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
    const dst = `${phase}-${f.replace(/\.png$/, '.jpg')}`;
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '45', '--resampleWidth', '300', join(dir, f), '--out', join(shotsOut, dst)], { stdio: 'ignore' });
    const key = f.replace(/\.png$/, '');
    (shots[key] ??= {})[phase] = dst;
  }
}
const shotHtml = Object.entries(shots).map(([k, v]) => `
  <figure class="pair"><figcaption>${esc(k)}</figcaption><div class="row">
    ${['before', 'after'].map((p) => (v[p] ? `<a href="shots/${v[p]}"><img loading="lazy" src="shots/${v[p]}" alt="${p}: ${esc(k)}"><span>${p}</span></a>` : `<div class="none">${p}: not yet</div>`)).join('')}
  </div></figure>`).join('');

const score = existsSync(join(ROOT, 'design', 'scoreboard.json')) ? JSON.parse(read('design/scoreboard.json')) : [];
const scoreHtml = score.length
  ? `<dl class="score">${score.map((s) => `<div><dt>${esc(s.label)}</dt><dd><span class="b">${esc(String(s.before))}</span> → <b>${esc(String(s.after ?? '…'))}</b>${s.target ? ` <small>target ${esc(String(s.target))}</small>` : ''}</dd></div>`).join('')}</dl>`
  : '<p>Scoreboard appears after Stage 2.</p>';

const sha = out('git', ['rev-parse', '--short', 'HEAD']);
const at = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
writeFileSync(join(OUT, 'progress', 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Redesign progress</title>
<style>
:root{--bg:#FBF7F1;--ink:#2A2320;--mute:#6B5F57;--rule:#E4D9CC;--accent:#B8432F;--ok:#2F6B4F;--card:#FFFDF9}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,system-ui,sans-serif;padding:max(16px,env(safe-area-inset-top)) 16px max(24px,env(safe-area-inset-bottom))}
main{max-width:720px;margin:0 auto}h1{font-size:26px;margin:.2em 0}h2{font-size:20px;margin:1.6em 0 .4em;border-top:1px solid var(--rule);padding-top:.8em}h3,h4{font-size:17px;margin:1.2em 0 .3em}
.eyebrow{font:600 12px/1 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.now{background:var(--card);border:1px solid var(--rule);border-radius:12px;padding:12px 14px;margin:12px 0}
.now b{color:var(--accent)}a{color:var(--accent)}code{font:14px ui-monospace,monospace;background:#F1E8DC;padding:1px 4px;border-radius:4px}
ul.check{list-style:none;padding-left:0}ul.check li{padding:6px 0;border-bottom:1px solid var(--rule)}ul.check li.done::before{content:"✓ ";color:var(--ok);font-weight:700}ul.check li.todo::before{content:"○ ";color:var(--mute)}
.score{display:grid;gap:8px;margin:0}.score div{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:10px 12px}.score dt{font-size:13px;color:var(--mute)}.score dd{margin:2px 0 0;font-variant-numeric:tabular-nums;font-size:18px}.score .b{color:var(--mute)}
.pair{margin:14px 0}.pair figcaption{font:600 13px ui-monospace,monospace;color:var(--mute);margin-bottom:6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}.row a{position:relative;display:block}.row img{width:100%;border:1px solid var(--rule);border-radius:8px;display:block;max-height:420px;object-fit:cover;object-position:top}.row span{position:absolute;left:6px;top:6px;background:#fffd;border-radius:6px;padding:0 6px;font-size:12px}.none{border:1px dashed var(--rule);border-radius:8px;display:grid;place-items:center;min-height:120px;color:var(--mute);font-size:13px}
.tw{overflow-x:auto}table{border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid var(--rule);padding:4px 8px;text-align:left}blockquote{margin:8px 0;padding-left:10px;border-left:3px solid var(--rule);color:var(--mute)}
details{margin:8px 0}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}
</style></head><body><main>
<div class="eyebrow">Meridian redesign · ${esc(sha)} · updated ${esc(at)} ET</div>
<h1>Progress</h1>
<div class="now">Current: <b>${esc(current)}</b><br><a href="../">Open the preview app →</a> · <a href="../#/styleguide">Style guide →</a></div>
<h2>Stages</h2>${md(log)}
<h2>Scoreboard</h2>${scoreHtml}
<h2>Screens</h2>${shotHtml || '<p>No screenshots yet.</p>'}
<h2>Decisions</h2><details open><summary>DECISIONS.md</summary>${md(read('DECISIONS.md'))}</details>
</main></body></html>`);
// A self-contained copy (screenshots inlined) that can be sent as a single file.
const page = readFileSync(join(OUT, 'progress', 'index.html'), 'utf8')
  .replace(/(src|href)="shots\/([^"]+)"/g, (_, attr, f) =>
    attr === 'src' ? `src="data:image/jpeg;base64,${readFileSync(join(shotsOut, f)).toString('base64')}"` : 'href="#"')
  .replace(/<a href="\.\.\/[^"]*">[^<]*<\/a>( · )?/g, '');
writeFileSync(join(ROOT, 'design', 'progress.html'), page);
console.log(`preview built: ${OUT} (current: ${current})`);

/* ── 3. publish ── */
if (process.argv.includes('--publish')) {
  if (!existsSync(WT)) run('git', ['worktree', 'add', WT, 'main']);
  run('git', ['pull', '--ff-only'], WT);
  const dest = join(WT, 'public', 'preview', 'redesign');
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(OUT, dest, { recursive: true });
  run('git', ['add', '--', 'public/preview/redesign'], WT);
  const staged = out('git', ['diff', '--cached', '--name-only'], WT);
  if (!staged) { console.log('nothing new to publish'); process.exit(0); }
  run('git', ['commit', '-m', `preview: redesign progress (${current}, ${sha})`, '--', 'public/preview/redesign'], WT);
  run('git', ['push', 'origin', 'main'], WT);
  console.log('published: https://clz4096.github.io/meridian/preview/redesign/');
}
