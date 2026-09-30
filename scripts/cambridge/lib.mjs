/**
 * Shared helpers for the Cambridge data scripts (scrape.mjs, verify-links.mjs).
 * Plain Node ESM, no dependencies: global fetch, regex HTML scraping.
 *
 * Why browser-like headers: Open Book Publishers answers bare bot requests with 405,
 * and several university servers are slow or picky. A Range header keeps link checks
 * cheap on large PDFs (206 counts as OK).
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inflateSync } from 'node:zlib';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};
const TIMEOUT_MS = 45_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Some university servers (www.damtp.cam.ac.uk, www.dpmms.cam.ac.uk in 2026) send the
 * wrong intermediate certificate. Browsers and macOS curl fetch the right one from the
 * leaf's AIA "CA Issuers" URL; Node does not. Do the same here, once per host: download
 * the issuer, check its signature chains to a system root, then add it to the default
 * CA set so later fetches succeed. TLS still validates every handshake.
 */
const fixedHosts = new Map();
function leafCert(host) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const leaf = s.getPeerX509Certificate();
      s.end();
      resolve(leaf);
    });
    s.setTimeout(TIMEOUT_MS, () => s.destroy(new Error('timeout')));
    s.on('error', reject);
  });
}
const aiaIssuer = (cert) => cert.infoAccess?.match(/CA Issuers - URI:(\S+)/)?.[1];
async function addMissingIssuer(host) {
  if (!fixedHosts.has(host)) {
    fixedHosts.set(host, (async () => {
      const roots = tls.getCACertificates('default').map((p) => new X509Certificate(p));
      const found = [];
      let cur = await leafCert(host);
      // Follow AIA links upward; each hop must be the real signer of the one below.
      for (let depth = 0; depth < 4; depth++) {
        if (roots.some((r) => cur.checkIssued(r) && cur.verify(r.publicKey))) {
          if (found.length) tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...found.map((c) => c.toString())]);
          return found.length > 0;
        }
        const url = aiaIssuer(cur);
        if (!url) return false;
        const up = new X509Certificate(Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).arrayBuffer()));
        if (!cur.checkIssued(up) || !cur.verify(up.publicKey)) return false;
        found.push(up);
        cur = up;
      }
      return false;
    })().catch(() => false));
  }
  return fixedHosts.get(host);
}

/** fetch, repairing a missing intermediate certificate once per host. */
async function fetchFixed(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (!/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/.test(e?.cause?.code ?? '')) throw e;
    if (!(await addMissingIssuer(new URL(url).hostname))) throw e;
    return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  }
}

/**
 * GET a page as text. Retries once; throws on a non-2xx after the retry. The error
 * carries `status` (0 for a network error) so callers can tell "gone" (404/410) from
 * "unreachable right now".
 */
export async function fetchText(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFixed(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
      return { text: await res.text(), finalUrl: res.url };
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

/** GET a file as bytes (for PDFs). Same retry and error rules as fetchText. */
export async function fetchBytes(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFixed(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

/**
 * Rough text of a PDF: inflate every FlateDecode stream and join the strings of its
 * Tj/TJ operators, one line per operator. Good enough for the LaTeX-made STEP Support
 * PDFs (section headings, "2005 S2 Q1" references); not a general PDF reader. Returns
 * '' when nothing decodes, so callers fall back to their default.
 */
export function pdfText(buf) {
  const raw = buf.toString('latin1');
  const unescape = (s) =>
    s.replace(/\\([0-7]{1,3}|.)/g, (_, e) => (/^[0-7]+$/.test(e) ? String.fromCharCode(parseInt(e, 8)) : e === 'n' ? '\n' : e));
  let out = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let content;
    try {
      content = inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {
      continue;
    }
    for (const op of content.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^)\\]|\\.)*)\)\s*Tj/g)) {
      const body = op[1] ?? `(${op[2]})`;
      let line = '';
      // A large negative kern inside TJ is a word gap.
      for (const p of body.matchAll(/\(((?:[^)\\]|\\.)*)\)|(-?\d+\.?\d*)/g)) {
        if (p[1] !== undefined) line += unescape(p[1]);
        else if (Number(p[2]) < -200) line += ' ';
      }
      out += `${line}\n`;
    }
  }
  return out;
}

const YT_ID = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/;

/** Hosts that mean "you were sent to a sign-in page". */
const LOGIN = [
  [/raven\.cam\.ac\.uk|login\.microsoftonline\.com|shibboleth|vle\.cam\.ac\.uk\/login/i, 'Needs a Cambridge (Raven) login'],
  [/accounts\.google\.com|ServiceLogin/i, 'Needs a Google login'],
];

/**
 * Check one URL. GET with a small Range first (most servers answer 206, and large PDFs
 * stay cheap); on a network error or a 4xx, try once more without the Range header,
 * because some servers (Moodle's redirect, bot filters) reject it. Follows redirects.
 * Retries once on 429 or 5xx. YouTube watch pages return 200 even for removed videos,
 * so those are checked through YouTube's oEmbed endpoint instead.
 * Returns { ok, status, finalUrl?, error?, login? }.
 */
export async function checkUrl(url) {
  const yt = url.match(YT_ID);
  const target = yt
    ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt[1]}`)}`
    : url;
  const once = async (range) => {
    try {
      const res = await fetchFixed(target, {
        headers: range ? { ...HEADERS, Range: 'bytes=0-2047' } : HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      res.body?.cancel().catch(() => {});
      const finalUrl = yt ? url : res.url;
      const login = LOGIN.find(([re]) => re.test(finalUrl))?.[1];
      return { ok: (res.status === 200 || res.status === 206) && !login, status: res.status, finalUrl, ...(login ? { login } : {}) };
    } catch (e) {
      return { ok: false, status: 0, error: String(e?.cause?.code ?? e?.cause?.message ?? e?.message ?? e) };
    }
  };
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    last = await once(true);
    if (!last.ok && !last.login && (last.status === 0 || (last.status >= 400 && last.status < 500))) {
      const plain = await once(false);
      if (plain.ok || plain.login || plain.status) last = plain;
    }
    if (last.ok || last.login || (last.status && last.status !== 429 && last.status < 500)) return last;
    await sleep(2500);
  }
  return last;
}

/** Run `fn` over `items` with at most `n` in flight; results keep input order. */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-', hellip: '...' };

/** Decode entities, drop tags, collapse whitespace. En and em dashes become "-". */
export function cleanText(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove HTML comments: DPMMS hides not-yet-released sheets inside them. */
export const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/**
 * Every <a href> in `html` as { href (absolute), text, before }, in document order.
 * `before` is the text between the start of the enclosing line or block (or the
 * previous link) and this link: the context for a bare "here" or "PDF".
 */
export function links(html, base) {
  const out = [];
  const re = /<a\s[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  const BLOCK = /<(?:\/?(?:p|li|ul|ol|div|h\d|td|tr|dd|dt)|br)\b[^>]*>/gi;
  let prevEnd = 0;
  let m;
  while ((m = re.exec(html))) {
    let from = prevEnd;
    for (const b of html.slice(prevEnd, m.index).matchAll(BLOCK)) from = prevEnd + b.index + b[0].length;
    const before = cleanText(html.slice(from, m.index));
    prevEnd = m.index + m[0].length;
    const raw = cleanText(m[2]).replace(/ /g, '%20');
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('javascript:')) continue;
    let href;
    try {
      href = new URL(raw, base).href;
    } catch {
      continue;
    }
    out.push({ href, text: cleanText(m[3]), before });
  }
  return out;
}

/** The slice of `html` between the first match of `start` and the next match of `end`. */
export function between(html, start, end) {
  const i = html.search(start);
  if (i < 0) return '';
  const rest = html.slice(i);
  const j = rest.slice(1).search(end);
  return j < 0 ? rest : rest.slice(0, j + 1);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Local date, YYYY-MM-DD. */
export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
