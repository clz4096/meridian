/**
 * Pure helpers for scrape.mjs: merge a fresh scrape into the owner's JSON, normalise a
 * file offline, seed per-question lists, block pirate links, and summarise a diff.
 * No network and no file access, so the tests can run all of it.
 *
 * The rule: the JSON files are the source of truth. A scrape refreshes only the
 * fields it owns (links, urls, site text, verified flags); every other field keeps the
 * owner's value. Lists merge by a stable key: matches are refreshed in place, new
 * entries are appended, and entries the site no longer lists stay, flagged
 * `upstreamMissing: true`. Nothing the owner wrote is ever deleted.
 */

// ------------------------------------------------------------------ small helpers

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Copy `keys` from `fresh` onto `out`; a key `fresh` lacks is removed (it is scraped, not owned). */
function refresh(out, fresh, keys) {
  for (const k of keys) {
    if (has(fresh, k)) out[k] = fresh[k];
    else delete out[k];
  }
  return out;
}

/** `old` with any field it lacks taken from `fresh` (the seed for owner fields). Keeps old key order. */
function seeded(old, fresh) {
  const out = { ...old };
  for (const [k, v] of Object.entries(fresh)) if (!has(out, k)) out[k] = v;
  return out;
}

/**
 * Merge two lists by `keyOf`. Old order is kept; matches go through `mergeOne` and lose
 * any `upstreamMissing` flag; old entries with no fresh match are flagged when
 * `scrapable(old)` (otherwise kept as they are); fresh entries with no old match are
 * appended.
 */
export function mergeList(oldList = [], freshList = [], keyOf, mergeOne, scrapable = () => true) {
  const fresh = new Map();
  for (const f of freshList) if (!fresh.has(keyOf(f))) fresh.set(keyOf(f), f);
  const matched = new Set();
  const out = oldList.map((o) => {
    const k = keyOf(o);
    const f = fresh.get(k);
    if (f) {
      matched.add(k);
      const { upstreamMissing: _gone, ...merged } = mergeOne(o, f);
      return merged;
    }
    return scrapable(o) ? { ...o, upstreamMissing: true } : o;
  });
  for (const [k, f] of fresh) if (!matched.has(k)) out.push(f);
  return out;
}

/** Link text that says nothing about the target. */
export const isGenericLabel = (label) =>
  !label || /^(here|pdf|html|link|this|click here|download|\.pdf|[a-z]?)$/i.test(label.trim());

const LINK_KEYS = ['kind', 'role', 'url', 'verified', 'reason', 'httpOnly', 'ravenOnly', 'updated', 'lastCheckedStatus'];

/** A link: scraped fields refreshed, the owner's label kept unless it is a bare "here"/"PDF". */
function mergeLink(old, fresh) {
  const out = refresh(seeded(old, fresh), fresh, LINK_KEYS);
  if (isGenericLabel(old.label) && fresh.label) out.label = fresh.label;
  return out;
}

const mergeLinks = (oldList, freshList) => mergeList(oldList, freshList, (l) => l.url, mergeLink);

/** Top-level key order: `$schema`, then `lastVerified`, then the rest as they were. */
function topFirst(doc) {
  const { $schema, lastVerified, ...rest } = doc;
  return { ...($schema !== undefined ? { $schema } : {}), ...(lastVerified !== undefined ? { lastVerified } : {}), ...rest };
}

// --------------------------------------------------------------- blocked links

const PIRACY_HOST = /(^|\.)(z-lib\.[a-z]+|zlibrary\.[a-z]+|z-library\.[a-z]+|zlib\.[a-z]+|libgen\.[a-z]+|library\.lol|annas-archive\.[a-z]+|sci-hub\.[a-z]+|pdfdrive\.com|1lib\.[a-z]+|b-ok\.[a-z]+|unidel\.edu\.ng)$/i;
const PIRACY_TEXT = /z-lib\.org|zlibrary|z-library|libgen|annas-archive|sci-hub|unidel\.edu\.ng\/focelibrary/i;

/**
 * Why a link must never be stored, or null. Course pages sometimes link a pirated
 * textbook, often through a Google redirect that hides the real host. Such links are
 * skipped (and logged), never stored.
 */
export function blockedReason(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'not a valid URL';
  }
  const host = u.hostname.toLowerCase();
  let decoded = url;
  try {
    decoded = decodeURIComponent(decodeURIComponent(url));
  } catch {
    // Keep the raw string; a bad escape is not a reason to block.
  }
  if (PIRACY_HOST.test(host) || PIRACY_TEXT.test(decoded)) return 'pirated copy (known piracy host)';
  if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === '/url') return 'Google redirect link that hides the real host';
  return null;
}

/** Remove every list entry whose `url` is blocked, anywhere in `tree`. Logs to `log`. */
export function dropBlocked(tree, log = [], path = '$') {
  if (Array.isArray(tree)) {
    for (let i = tree.length - 1; i >= 0; i--) {
      const x = tree[i];
      const why = x && typeof x === 'object' && typeof x.url === 'string' ? blockedReason(x.url) : null;
      if (why) {
        log.push(`skipped ${path}[${i}] (${x.label ?? x.url}): ${why}: ${x.url}`);
        tree.splice(i, 1);
      } else dropBlocked(x, log, `${path}[${i}]`);
    }
  } else if (tree && typeof tree === 'object') {
    for (const [k, v] of Object.entries(tree)) dropBlocked(v, log, `${path}.${k}`);
  }
  return tree;
}

/**
 * A readable label for a link whose text is a bare "here" or "PDF": the words just
 * before it on the page ("The lecture notes are here" -> "Lecture notes"), else the
 * file name; plus the materials year when known.
 */
export function contextLabel({ text, before, href }, year) {
  if (!isGenericLabel(text)) return text;
  let s = (before ?? '').split(/(?<=[.!?])\s+/).pop() ?? '';
  let prev;
  do {
    prev = s;
    s = s
      .replace(/[\s:;,(]+$/, '')
      .replace(/\b(is|are|was|were|can be found|available|here|at|such as|see|in|from)$/i, '')
      .trim();
  } while (s !== prev);
  s = s.replace(/^(the|a|an|some)\s+/i, '');
  if (!s) {
    try {
      s = decodeURIComponent(new URL(href).pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]+$/i, '');
    } catch {
      s = text || 'Link';
    }
  }
  if (s.length > 80) s = `${s.slice(0, 80).replace(/\s+\S*$/, '')}...`;
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return year ? `${s} (${year})` : s;
}

// ----------------------------------------------------------- per-question seeds

const ROMAN = { I: 1, II: 2, III: 3 };
const REF = String.raw`(\d{4}|\d{2}|SPECIMEN)\s?S\s?(III|II|I|[123])\s?Q\s?(\d{1,2})(?!\d)`;
const stepRef = (y, p, q) => {
  const year = /^\d{2}$/.test(y) ? `${Number(y) > 50 ? '19' : '20'}${y}` : /^specimen$/i.test(y) ? 'Specimen' : y;
  return `${year} STEP ${ROMAN[p] ?? Number(p)} Q${Number(q)}`;
};

/**
 * The questions in a module or set PDF, from its text:
 * - numbered STEP questions ("1 2005 S2 Q1 ..."), in order; else
 * - every distinct STEP reference, in order (the mixed STEP 3 set puts refs first); else
 * - the count of numbered acknowledgements (the matrices modules use old A-level questions).
 * Returns { refs: [..] } or { count } or null.
 */
export function pdfQuestions(text) {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ');
  const numbered = [];
  for (const m of flat.matchAll(new RegExp(String.raw`(?<![\d.])(\d{1,2}) ${REF}`, 'g'))) {
    if (Number(m[1]) === numbered.length + 1) numbered.push(stepRef(m[2], m[3], m[4]));
  }
  if (numbered.length >= 2) return { refs: numbered };
  const any = [...new Set([...flat.matchAll(new RegExp(String.raw`(?<!\w)${REF}`, 'g'))].map((m) => stepRef(m[1], m[2], m[3])))];
  if (any.length >= 2) return { refs: any };
  const ack = flat.lastIndexOf('Acknowledgements');
  if (ack >= 0) {
    let n = 0;
    for (const m of flat.slice(ack).matchAll(/(?<![\d.])(\d{1,2}) (?=[A-Z])/g)) if (Number(m[1]) === n + 1) n++;
    if (n >= 2) return { count: n };
  }
  return null;
}

/** The four parts every STEP Support assignment has, per the site: warm-up, preparation, the STEP question, warm-down. */
const PARTS = [
  { id: 'warm-up', label: 'Warm-up', re: /^warm[- ]?up$/i },
  { id: 'preparation', label: 'Preparation', re: /^preparation$/i },
  { id: 'main', label: 'The STEP question', re: /^the step question\b/i },
  { id: 'warm-down', label: 'Warm-down', re: /^warm[- ]?down$/i },
];

/** Section headings found in an assignment PDF's text, as part ids in PARTS order. */
export function assignmentParts(text) {
  if (!text) return [];
  const lines = text.split('\n').map((l) => l.trim());
  return PARTS.filter((p) => lines.some((l) => p.re.test(l))).map((p) => p.id);
}

/**
 * Per-question list for a step.json item, so each question can be timed and marked.
 * `pdf` is the text of the item's assignment or questions PDF, or null when offline.
 * Returns { questions, note? }; the note says what was assumed.
 */
export function seedQuestions(item, pdf = null) {
  if (item.kind === 'siklos') return { questions: [{ id: `P${item.n}` }] };
  if (item.kind === 'assignment') {
    const found = assignmentParts(pdf);
    const ok = found.includes('main') && found.length >= 3;
    const parts = ok ? PARTS.filter((p) => found.includes(p.id)) : PARTS;
    const refs = item.stepQuestions ?? [];
    const questions = [];
    for (const p of parts) {
      questions.push({ id: p.id, label: p.label, ...(p.id === 'main' && refs[0] ? { step: refs[0] } : {}) });
      if (p.id === 'main') refs.slice(1).forEach((r, i) => questions.push({ id: `step-${i + 2}`, label: 'Another STEP question', step: r }));
    }
    const missing = ok ? PARTS.filter((p) => !found.includes(p.id)).map((p) => p.label) : [];
    const note = !ok
      ? "Question parts not read from the assignment PDF; the site's standard four are assumed (warm-up, preparation, the STEP question, warm-down)."
      : missing.length
        ? `The assignment PDF has no ${missing.join(' or ')} section.`
        : undefined;
    return { questions, ...(note ? { note } : {}) };
  }
  // Modules and mixed sets: Q1..Qn.
  const stated = Number((item.siteTopics ?? '').match(/consists of (\d+) STEP(?: [123])? questions/i)?.[1]) || null;
  const fromPdf = pdfQuestions(pdf);
  const pdfCount = fromPdf?.refs?.length ?? fromPdf?.count ?? null;
  const count = stated ?? pdfCount ?? 4;
  const refs = fromPdf?.refs?.length === count ? fromPdf.refs : [];
  const questions = Array.from({ length: count }, (_, i) => ({ id: `Q${i + 1}`, ...(refs[i] ? { step: refs[i] } : {}) }));
  let note;
  if (!stated && !pdfCount) note = 'Question count not stated on the site or read from the questions PDF; 4 assumed. Edit to match the PDF.';
  else if (stated && pdfCount && stated !== pdfCount) note = `The site says ${stated} questions; the questions PDF lists ${pdfCount}. Check the PDF.`;
  else if (!stated && fromPdf?.count) note = 'Question count read from the questions PDF; these are old A-level questions, so there are no STEP references.';
  return { questions, ...(note ? { note } : {}) };
}

/** Give every item without a `questions` list one. `pdfFor(item)` returns its PDF text or null. */
export function seedAllQuestions(step, pdfFor = () => null, log = []) {
  const seededIds = [];
  for (const it of step.items) {
    if (Array.isArray(it.questions)) continue;
    const { questions, note } = seedQuestions(it, pdfFor(it));
    it.questions = questions;
    if (note) it.questionsNote = note;
    seededIds.push(it.id);
  }
  if (seededIds.length) log.push(`question lists seeded for ${seededIds.length} item(s): ${seededIds.join(', ')}`);
  return step;
}

// ----------------------------------------------------------------------- step

const STEP_ITEM_KEYS = ['siteTitle', 'url', 'siteTopics', 'stepQuestions'];

function mergeStepItem(old, fresh) {
  const out = refresh(seeded(old, fresh), fresh, STEP_ITEM_KEYS);
  out.links = mergeLinks(old.links, fresh.links);
  return out;
}

/**
 * Merge a fresh step.json scrape into the owner's file. `fresh` has `items` for the
 * pages that were fetched (assignments, sets, modules) and the scraped top-level
 * fields. Siklos items and anything without a step.maths.org url are never flagged.
 */
export function mergeStep(existing, fresh) {
  const out = refresh({ ...existing }, fresh, ['$schema', 'source', 'scrapedAt', 'lastVerified']);
  out.items = mergeList(existing.items, fresh.items, (i) => i.id, mergeStepItem, (i) => typeof i.url === 'string');
  out.phases = syncPhaseItems(existing.phases, out.items);
  return topFirst(out);
}

/** Append ids of items that no phase lists yet to their own phase. Never removes. */
function syncPhaseItems(phases = [], items = []) {
  const listed = new Set(phases.flatMap((p) => p.items ?? []));
  return phases.map((p) => {
    const add = items.filter((i) => i.phase === p.id && !listed.has(i.id)).map((i) => i.id);
    return add.length ? { ...p, items: [...(p.items ?? []), ...add] } : p;
  });
}

// -------------------------------------------------------------------- courses

const SHEET_KEYS = ['url', 'updated', 'verified', 'reason', 'httpOnly', 'lastCheckedStatus'];

function mergeCourse(old, fresh) {
  const out = refresh(seeded(old, fresh), fresh, ['sheetYear', 'siteNote']);
  // Sheets merge by number: "example sheet 2" is what the owner's questions hang on.
  out.sheets = mergeList(old.sheets, fresh.sheets, (s) => s.n, (o, f) => refresh(seeded(o, f), f, SHEET_KEYS));
  out.notes = mergeLinks(old.notes, fresh.notes);
  return out;
}

const mergeYear = (old, fresh) => {
  const out = refresh(seeded(old, fresh), fresh, ['url', 'verified', 'reason', 'lastCheckedStatus']);
  out.papers = mergeLinks(old.papers, fresh.papers);
  return out;
};

export function mergeCourses(existing, fresh) {
  const out = refresh({ ...existing }, fresh, ['$schema', 'scrapedAt', 'lastVerified']);
  out.courses = mergeList(existing.courses, fresh.courses, (c) => c.id, mergeCourse, () => false);
  out.partIB = mergeList(existing.partIB, fresh.partIB, (c) => c.id, mergeCourse, () => false);
  if (fresh.schedules) out.schedules = mergeLink(existing.schedules ?? {}, fresh.schedules);
  if (fresh.pastPapers?.partIA) {
    const o = existing.pastPapers?.partIA ?? {};
    const f = fresh.pastPapers.partIA;
    const partIA = refresh(seeded(o, f), f, ['url', 'verified', 'reason', 'lastCheckedStatus']);
    partIA.years = mergeList(o.years, f.years, (y) => y.year, mergeYear);
    out.pastPapers = { ...(existing.pastPapers ?? {}), partIA };
  }
  return topFirst(out);
}

// ------------------------------------------------------------------------- cs

const CS_COURSE_KEYS = ['code', 'url', 'terms', 'hours', 'available', 'recordingsPage', 'siteNote'];

/**
 * Part IA courses are scraped in full (materials, recordings, past papers); IB and II
 * only from the part's course list, so for those only the list fields are refreshed
 * and anything else on the course is left alone.
 */
function mergeCsCourse(old, fresh) {
  const full = Boolean(fresh.materials);
  const out = refresh(seeded(old, fresh), fresh, full ? CS_COURSE_KEYS : ['code', 'url', 'terms', 'hours']);
  if (full) {
    const o = old.materials ?? {};
    out.materials = refresh(seeded(o, fresh.materials), fresh.materials, ['year', 'page']);
    out.materials.links = mergeLinks(o.links, fresh.materials.links);
    if (fresh.pastPapers) out.pastPapers = mergeLink(old.pastPapers ?? {}, fresh.pastPapers);
    else delete out.pastPapers;
  }
  return out;
}

export function mergeCs(existing, fresh) {
  const out = refresh({ ...existing }, fresh, ['$schema', 'scrapedAt', 'lastVerified']);
  const o = existing.tripos ?? {};
  const f = fresh.tripos;
  const tripos = seeded(o, f);
  tripos.pastPapers = mergeLink(o.pastPapers ?? {}, f.pastPapers);
  tripos.parts = { ...(o.parts ?? {}) };
  for (const [key, part] of Object.entries(f.parts)) {
    const op = o.parts?.[key] ?? {};
    tripos.parts[key] = { ...seeded(op, part), url: part.url, courses: mergeList(op.courses, part.courses, (c) => c.id, mergeCsCourse) };
  }
  out.tripos = tripos;
  if (existing.track) out.track = mergeTrack(existing.track, fresh.track, tripos);
  return topFirst(out);
}

// ------------------------------------------------------------------- cs track

/**
 * Hosts a CS track link may point at: Cambridge itself, the TMUA's owners (UAT-UK and its
 * S3 bucket, Pearson VUE), and free editions hosted by their authors or the university that
 * recommends them. Anything else (mirrors, unofficial CSAT copies) stays out of the track.
 */
export const TRACK_HOSTS = [
  'cam.ac.uk',
  'uat-wp.s3.eu-west-2.amazonaws.com',
  'esat-tmua.ac.uk',
  'pearsonvue.com',
  'cs3110.github.io',
  'richardhammack.github.io',
  'isaacphysics.org',
  'ubuntu.com',
  'cs.cmu.edu',
];

/** True when `url` is https on one of TRACK_HOSTS (or a subdomain of one). */
export function isTrackUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return u.protocol === 'https:' && TRACK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const GONE = new Set([404, 410]);
const MATERIAL_KINDS = new Set(['notes', 'exercises', 'videos', 'pastPapers']);
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => has(o, k)).map((k) => [k, o[k]]));

/**
 * Links for a Part IA track item, read off its course in `tripos.parts`: the syllabus page,
 * the materials page, every notes, exercise and recording link on a track host, and the
 * past-paper topic page. Moodle (Raven-only) links and links that answered 404 or 410 are
 * left out; the rest keep their verified flags. Pure, so rerunning it on unchanged data
 * changes nothing.
 */
export function trackCourseLinks(course) {
  const out = [{ kind: 'course', label: `${course.name}: syllabus (2026-27)`, url: course.url, verified: true }];
  if (course.materials?.page && course.materials.page !== course.url) {
    out.push({ kind: 'materials', label: `Course materials page (${course.materials.year})`, url: course.materials.page, verified: true });
  }
  for (const l of course.materials?.links ?? []) {
    if (!MATERIAL_KINDS.has(l.kind) || l.ravenOnly || !isTrackUrl(l.url)) continue;
    if (l.verified === false && GONE.has(l.lastCheckedStatus)) continue;
    out.push({ kind: l.kind, label: l.label, url: l.url, ...pick(l, ['verified', 'reason', 'lastCheckedStatus', 'httpOnly']) });
  }
  if (course.pastPapers?.url && isTrackUrl(course.pastPapers.url)) {
    out.push({ kind: 'pastPapers', label: 'Past exam questions for this course, by year', url: course.pastPapers.url, ...pick(course.pastPapers, ['verified', 'reason', 'lastCheckedStatus']) });
  }
  const seen = new Set();
  return out.filter((l) => !seen.has(l.url) && seen.add(l.url));
}

/** Where a track item's links come from, for deciding whether its absence from a scrape means "gone". */
const trackSource = (it) => (it.course ? 'course' : /^bop-\d+$/.test(it.id) ? 'bop' : /^ocaml-\d+$/.test(it.id) ? 'ocaml' : 'fixed');

/**
 * Merge the CS track. The track is the owner's: phases, blocks, gates, order, titles, notes,
 * questions and every other field keep their values, and the scrape never adds an item.
 * Only links (and `siteTitle`) refresh:
 * - items with a `course` get their links from that course in the merged `tripos`;
 * - Book of Proof and CS3110 chapter items from `fresh.items`, read off the books' own pages;
 * - every other item from `fresh.items` too, which re-checks the same urls.
 * An item whose source page was read (`fresh.sources`) but no longer lists it is flagged
 * `upstreamMissing`. A link that dropped out because its course page now answers 404 takes
 * the course link's `verified: false` and reason.
 */
function mergeTrack(track, fresh, tripos) {
  if (!Array.isArray(track.items)) return track;
  const courses = new Map(Object.values(tripos?.parts ?? {}).flatMap((p) => p.courses ?? []).map((c) => [c.id, c]));
  const materialByUrl = new Map([...courses.values()].flatMap((c) => (c.materials?.links ?? []).map((l) => [l.url, l])));
  const listed = new Set(track.items.map((i) => i.id));
  const freshItems = (fresh?.items ?? []).filter((f) => listed.has(f.id));
  for (const it of track.items) {
    if (it.course && courses.has(it.course)) freshItems.push({ id: it.id, links: trackCourseLinks(courses.get(it.course)) });
  }
  const read = new Set(['course', ...(fresh?.sources ?? [])]);
  const mergeItem = (old, f) => {
    // Only the book chapter pages supply a siteTitle; elsewhere it is the owner's.
    const out = refresh(seeded(old, f), f, ['bop', 'ocaml'].includes(trackSource(old)) ? ['siteTitle'] : []);
    out.links = mergeLinks(old.links, f.links).map((l) => {
      const src = l.upstreamMissing ? materialByUrl.get(l.url) : undefined;
      return src?.verified === false ? { ...l, ...pick(src, ['verified', 'reason', 'lastCheckedStatus']) } : l;
    });
    return out;
  };
  const items = mergeList(track.items, freshItems, (i) => i.id, mergeItem, (i) => read.has(trackSource(i)));
  return { ...track, items, phases: syncPhaseItems(track.phases, items) };
}

// ------------------------------------------------------------------ normalise

/** Offline clean-up shared by every mode: key order, blocked links, question lists, phase lists. */
export function normalizeStep(doc, log = []) {
  dropBlocked(doc, log);
  seedAllQuestions(doc, () => null, log);
  doc.phases = syncPhaseItems(doc.phases, doc.items);
  return topFirst(doc);
}

export function normalizeCourses(doc, log = []) {
  dropBlocked(doc, log);
  for (const c of [...(doc.courses ?? []), ...(doc.partIB ?? [])]) {
    for (const s of c.sheets ?? []) if (!Array.isArray(s.questions)) s.questions = [];
  }
  return topFirst(doc);
}

export function normalizeCs(doc, log = []) {
  dropBlocked(doc, log);
  if (Array.isArray(doc.track?.items)) {
    for (const it of doc.track.items) if (!Array.isArray(it.questions)) it.questions = [];
    doc.track.phases = syncPhaseItems(doc.track.phases, doc.track.items);
  }
  return topFirst(doc);
}

// ----------------------------------------------------------------------- diff

/** A readable path step for an array element: its id, url, n or year when it has one. */
function stepName(x, i) {
  if (x && typeof x === 'object') {
    for (const k of ['id', 'n', 'year']) if (typeof x[k] === 'string' || typeof x[k] === 'number') return `[${k}=${x[k]}]`;
  }
  return `[${i}]`;
}

const show = (v) => {
  const s = JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 67)}...` : s;
};

/** Every leaf change between two JSON values, as "+ path", "- path" or "~ path: a -> b". */
export function diffJson(a, b, path = '', out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (v) => v && typeof v === 'object';
  if (Array.isArray(a) && Array.isArray(b)) {
    // Match object elements by url, else by name; fall back to position.
    // Match object elements by id, else url, else n/year; fall back to position.
    const keyOf = (x, i) => (x && typeof x === 'object' ? (x.id ?? x.url ?? stepName(x, i)) : `#${i}`);
    const nameOf = (x, i) => `${path}${x && typeof x === 'object' && x.id === undefined && x.url ? `[${x.label ?? x.url}]` : stepName(x, i)}`;
    const am = new Map(a.map((x, i) => [keyOf(x, i), x]));
    const bm = new Map(b.map((x, i) => [keyOf(x, i), x]));
    b.forEach((x, i) => {
      const k = keyOf(x, i);
      if (!am.has(k)) out.push(`+ ${nameOf(x, i)}${isObj(x) ? '' : `: ${show(x)}`}`);
      else diffJson(am.get(k), x, nameOf(x, i), out);
    });
    a.forEach((x, i) => {
      if (!bm.has(keyOf(x, i))) out.push(`- ${nameOf(x, i)}`);
    });
  } else if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k;
      if (!has(a, k)) out.push(`+ ${p}: ${show(b[k])}`);
      else if (!has(b, k)) out.push(`- ${p}`);
      else diffJson(a[k], b[k], p, out);
    }
  } else out.push(`~ ${path}: ${show(a)} -> ${show(b)}`);
  return out;
}
