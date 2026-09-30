/**
 * Checks every URL in data/cambridge/*.json and *.md and writes
 * data/cambridge/link-report.json:
 *   { checkedAt, counts, ok: [url], broken: [{ url, status, error?, file, path, expected }] }
 *
 *   node scripts/cambridge/verify-links.mjs            # report only
 *   node scripts/cambridge/verify-links.mjs --update   # also write the results into the data
 *
 * --update edits each data file in place: a link object (a string `url` plus a boolean
 * `verified`) that now fails gets `verified: false`, `lastCheckedStatus` and, if it has
 * none, a `reason`; one that answers again gets `verified: true` and its `reason` is
 * dropped. A file with a top-level `lastVerified` gets today's date. Everything else is
 * left as it was, and files are written as 2-space JSON, only when something changed.
 *
 * GET with a small Range (then without it on failure), redirects followed, 5 at a
 * time, one retry (see lib.mjs checkUrl). `expected: true` marks a broken link the
 * data already flags with `verified: false`. Always exits 0: this is a report.
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkUrl, pool, writeJson, today } from './lib.mjs';

const DIR = fileURLToPath(new URL('../../data/cambridge/', import.meta.url));
const REPORT = 'link-report.json';
const UPDATE = process.argv.includes('--update');
const URL_RE = /https?:\/\/[^\s"'<>\]]+/g;

/** URLs in free text. Parentheses are legal in URLs, so trim only an unbalanced tail. */
function urlsIn(text) {
  if (/^https?:\/\/\S+$/.test(text)) return [text];
  return (text.match(URL_RE) ?? []).map((u) => {
    let url = u.replace(/[.,;:!?]+$/, '');
    while (url.endsWith(')') && (url.match(/\(/g) ?? []).length < (url.match(/\)/g) ?? []).length) url = url.slice(0, -1);
    return url;
  });
}

/** [{ url, file, path, expected }] for every URL string in a JSON value. */
function walk(v, file, path, parent, out) {
  if (typeof v === 'string') {
    for (const url of urlsIn(v)) out.push({ url, file, path, expected: parent?.verified === false });
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => walk(x, file, `${path}[${i}]`, parent, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) if (k !== '$schema') walk(x, file, path ? `${path}.${k}` : k, v, out);
  }
  return out;
}

const files = (await readdir(DIR)).filter((f) => (f.endsWith('.json') || f.endsWith('.md')) && f !== REPORT).sort();
const refs = [];
for (const f of files) {
  const text = await readFile(join(DIR, f), 'utf8');
  if (f.endsWith('.json')) walk(JSON.parse(text), f, '', null, refs);
  else text.split('\n').forEach((line, i) => urlsIn(line).forEach((url) => refs.push({ url, file: f, path: `line ${i + 1}`, expected: false })));
}

const urls = [...new Set(refs.map((r) => r.url))].sort();
console.log(`Checking ${urls.length} unique URLs (${refs.length} references in ${files.length} files)...`);
const results = new Map();
let done = 0;
await pool(urls, 5, async (u) => {
  results.set(u, await checkUrl(u));
  if (++done % 100 === 0) console.log(`  ${done}/${urls.length}`);
});

const ok = urls.filter((u) => results.get(u).ok);
const broken = refs
  .filter((r) => !results.get(r.url).ok)
  .map((r) => {
    const res = results.get(r.url);
    return {
      url: r.url,
      status: res.status,
      ...(res.login || res.error ? { error: res.login ?? res.error } : {}),
      file: r.file,
      path: r.path,
      expected: r.expected,
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file) || a.url.localeCompare(b.url) || a.path.localeCompare(b.path));

const brokenUrls = new Set(broken.map((b) => b.url));
const unexpected = new Set(broken.filter((b) => !b.expected).map((b) => b.url));
await writeJson(join(DIR, REPORT), {
  checkedAt: new Date().toISOString(),
  counts: { urls: urls.length, references: refs.length, ok: ok.length, broken: brokenUrls.size, brokenUnexpected: unexpected.size },
  ok,
  broken,
});

console.log(`\nOK: ${ok.length}   Broken: ${brokenUrls.size} (${unexpected.size} not already flagged verified:false)`);
for (const u of [...brokenUrls].sort()) {
  const r = results.get(u);
  const where = [...new Set(broken.filter((b) => b.url === u).map((b) => b.file))].join(', ');
  console.log(`  ${unexpected.has(u) ? '!' : ' '} ${r.status || '---'} ${u}  [${where}]${r.login || r.error ? `  ${r.login ?? r.error}` : ''}`);
}
console.log(`\nWrote data/cambridge/${REPORT}`);

/** Write each check result onto its link object. Returns the number of objects changed. */
function applyResults(tree) {
  let changed = 0;
  const visit = (v) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      const r = typeof v.url === 'string' && typeof v.verified === 'boolean' ? results.get(v.url) : undefined;
      if (r && !r.ok && (v.verified !== false || v.lastCheckedStatus !== r.status)) {
        v.verified = false;
        v.lastCheckedStatus = r.status;
        v.reason ??= r.login ?? `HTTP ${r.status}${r.error ? ` (${r.error})` : ''} on ${today()}`;
        changed++;
      } else if (r?.ok && v.verified === false) {
        v.verified = true;
        v.lastCheckedStatus = r.status;
        delete v.reason;
        changed++;
      }
      Object.values(v).forEach(visit);
    }
  };
  visit(tree);
  return changed;
}

if (UPDATE) {
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const path = join(DIR, f);
    const data = JSON.parse(await readFile(path, 'utf8'));
    const changed = applyResults(data);
    const stamp = typeof data.lastVerified === 'string' && data.lastVerified !== today();
    if (stamp) data.lastVerified = today();
    if (changed || stamp) {
      await writeJson(path, data);
      console.log(`Updated ${f}: ${changed} link(s) changed${stamp ? ', lastVerified set' : ''}`);
    }
  }
}
