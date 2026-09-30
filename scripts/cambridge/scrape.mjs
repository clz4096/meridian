/**
 * Refreshes data/cambridge/step.json, courses.json and cs.json from the live sites.
 *
 *   node scripts/cambridge/scrape.mjs              # all three, online
 *   node scripts/cambridge/scrape.mjs step cs      # a subset
 *   node scripts/cambridge/scrape.mjs --offline    # normalise the existing JSON only, no network
 *
 * The JSON files are the source of truth, and the owner edits them by hand. A run reads
 * each file, scrapes, and merges (see merge.mjs): links, urls, site text and verified
 * flags are refreshed; everything else (phases, gates, pace, exam facts, blocks, topics,
 * titles, notes, questions, order, terms) keeps the owner's value. New pages are
 * appended; pages the site dropped stay, flagged `upstreamMissing: true`. Every run
 * prints a diff summary and writes only files that changed.
 *
 * cs.json's `track` (the CS study path) is the owner's too. The scrape never adds a track
 * item; it refreshes the links of the listed ones: Part IA course items from the tripos
 * scrape, Book of Proof and CS3110 chapters from the books' own pages, and a re-check of
 * every other item's urls (merge.mjs mergeTrack).
 *
 * Every URL written is an href scraped from a fetched page (or the fetched page itself),
 * then checked: link objects get `verified: true`, or `verified: false` plus a `reason`.
 * An http:// href is upgraded to https:// only when the https copy answers. Links to
 * pirated copies or hidden redirects are skipped and logged (merge.mjs blockedReason).
 *
 * The data files must exist (they are committed); there is no built-in seed.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fetchText, fetchBytes, pdfText, checkUrl, pool, links, cleanText, stripComments, between, readJson, writeJson, today } from './lib.mjs';
import {
  mergeStep,
  mergeCourses,
  mergeCs,
  normalizeStep,
  normalizeCourses,
  normalizeCs,
  dropBlocked,
  blockedReason,
  contextLabel,
  seedQuestions,
  diffJson,
} from './merge.mjs';

export * from './merge.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'data/cambridge');
const STEP = 'https://step.maths.org';
const log = (...a) => console.log(...a);
/** Problems found while scraping; printed at the end for BUGS.md. */
const problems = [];

const link = (kind, label, url, extra = {}) => ({ kind, label, url, ...extra, verified: null });
/** True when a fetch error means the page is gone, not just unreachable right now. */
const gone = (e) => e?.status === 404 || e?.status === 410;

// -------------------------------------------------------------------------- STEP

/** Teasers from a STEP list page: [{ slug, title, teaser }] in page order. */
function teasers(html) {
  const out = [];
  const re = /<article[^>]*data-view-mode="teaser"[\s\S]*?<\/article>/g;
  for (const m of html.match(re) ?? []) {
    const a = m.match(/<h2>\s*<a href="\/assignments\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const body = m.match(/field--name-body[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
    out.push({ slug: a[1], title: cleanText(a[2]), teaser: body ? cleanText(body[1]) : '' });
  }
  return out;
}

/** The three list pages: { foundation, step2, step3 }, each [{ slug, title, teaser }]. */
async function listPages() {
  const first = (await fetchText(`${STEP}/assignments/foundation`)).text;
  const pages = [...new Set([...first.matchAll(/href="\?page=(\d+)"/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const foundation = teasers(first);
  for (const p of pages.filter((p) => p > 0)) foundation.push(...teasers((await fetchText(`${STEP}/assignments/foundation?page=${p}`)).text));
  const step2 = teasers((await fetchText(`${STEP}/assignments/step-2`)).text);
  const step3 = teasers((await fetchText(`${STEP}/assignments/step-3`)).text);
  return { foundation, step2, step3 };
}

const LABEL_KIND = {
  'Assignment PDF': 'questions',
  'Hints file': 'hints',
  'Solutions file': 'solutions',
  'Topic notes': 'topicNotes',
};

const qRef = (y, p, q) => `${y} STEP ${p} Q${q}`;

/** Parse one assignment or module page into links, STEP question refs and notes. */
async function stepPage(slug, { foundation }) {
  const url = `${STEP}/assignments/${slug}`;
  const { text } = await fetchText(url);
  const body = between(text, /class="page-title"/, /<h2>Useful links<\/h2>/);
  const title = cleanText(body.match(/page-title">([\s\S]*?)<\/h1>/)?.[1] ?? slug);
  const out = [];
  const notes = [];

  // Labelled file fields, in page order.
  for (const chunk of body.split('<div class="field__label">').slice(1)) {
    const label = cleanText(chunk.slice(0, chunk.indexOf('</div>')));
    if (label === 'Video worked solution') {
      for (const m of chunk.matchAll(/title="([^"]*)"\s+data-src="[^"]*?url=([^&"]+)/g)) {
        const yt = decodeURIComponent(m[2]);
        out.push(link('video', cleanText(m[1]), yt, { role: 'worked-solution' }));
      }
      continue;
    }
    let kind = LABEL_KIND[label];
    if (!kind) {
      problems.push({ where: url, what: `unknown field label "${label}"` });
      continue;
    }
    if (foundation && kind === 'questions') kind = 'assignment';
    // File entities only: the text fields between labels also contain links.
    const pdfs = [...chunk.matchAll(/<span class="file[^"]*">\s*<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)]
      .map((m) => ({ href: new URL(m[1], url).href, text: cleanText(m[2]) }));
    for (const p of pdfs) out.push(link(kind, `${label}: ${p.text}`, p.href));
  }

  // Videos linked from the text (further reading), not the worked solution.
  for (const l of links(body, url)) {
    if (/youtube\.com\/watch\?v=|youtu\.be\//.test(l.href) && !out.some((o) => o.url === l.href)) {
      out.push(link('video', l.text || 'Video', l.href, { role: 'further' }));
    }
  }

  // Dead-domain hrefs: keep the step.maths.org same-path copy only if it answers.
  for (const l of links(body, url).filter((l) => /step-support\.org/.test(l.href))) {
    const alt = STEP + new URL(l.href).pathname;
    const r = await checkUrl(alt);
    problems.push({ where: url, what: `href to ${l.href}`, fix: r.ok ? `stored ${alt}` : 'dropped (no working copy)' });
    if (r.ok) out.push(link('questions', l.text, alt));
  }

  // STEP question references on the page vs in video titles.
  const pageRefs = [...body.matchAll(/<strong>[^<]*STEP question \((\d{4}) STEP (\d) Question (\d+)\)<\/strong>/g)].map((m) => qRef(m[1], m[2], m[3]));
  for (const v of out.filter((o) => o.kind === 'video' && o.role === 'worked-solution')) {
    const m = v.label.match(/\((\d{4}) STEP (\d) Q(?:uestion)? ?(\d+)\)/);
    if (m && pageRefs.length && !pageRefs.includes(qRef(m[1], m[2], m[3]))) {
      notes.push(`Question reference conflict: the page says ${pageRefs.join(' and ')}; the video title says ${qRef(m[1], m[2], m[3])}. Check the assignment PDF.`);
    }
  }
  return { url, title, links: out, stepQuestions: [...new Set(pageRefs)], notes };
}

/** Text of an item's assignment or questions PDF, or null if it cannot be read. */
async function itemPdf(item) {
  const pdf = item.links?.find((l) => l.kind === 'assignment' || l.kind === 'questions');
  if (!pdf) return null;
  try {
    return pdfText(await fetchBytes(pdf.url)) || null;
  } catch (e) {
    problems.push({ where: pdf.url, what: `PDF not read: ${e.message}` });
    return null;
  }
}

/**
 * Scrape every step.maths.org page the owner's step.json lists, plus pages the list
 * pages show that it does not list yet. Items keep their ids; new ones get an id from
 * their slug. A page that answers 404 or 410 is left out (the merge flags it); any
 * other failure aborts the run so a network blip never flags half the file.
 */
async function scrapeStep(existing) {
  log('STEP: list pages');
  const lists = await listPages();
  const teaser = new Map([...lists.foundation, ...lists.step2, ...lists.step3].map((t) => [t.slug, t]));
  const byUrl = new Map(existing.items.filter((i) => i.url).map((i) => [i.url, i]));
  const slugOf = (url) => url.replace(`${STEP}/assignments/`, '');

  // [{ slug, phase, kind, id, title, n }]: the owner's pages first, then new ones.
  const targets = existing.items.filter((i) => i.url?.startsWith(`${STEP}/assignments/`)).map((i) => ({ slug: slugOf(i.url), old: i }));
  const nextN = (phase) => Math.max(0, ...existing.items.filter((i) => i.phase === phase).map((i) => i.n)) + 1 + targets.filter((t) => !t.old && t.phase === phase).length;
  const addNew = (slug, phase, kind, id, title, n) => {
    if (byUrl.has(`${STEP}/assignments/${slug}`)) return;
    if (existing.items.some((i) => i.id === id)) id = `${id}-new`;
    targets.push({ slug, phase, kind, id, title, n: n ?? nextN(phase) });
  };
  for (const t of lists.foundation) {
    const a = t.slug.match(/^step-support-assignment-(\d+)$/);
    if (a) addNew(t.slug, 'A', 'assignment', `found-${a[1].padStart(2, '0')}`, `Assignment ${a[1]}`, Number(a[1]));
    else if (/^mixed-.*-step-1-questions$/.test(t.slug)) addNew(t.slug, 'A+', 'set', `extra-${t.slug.replace(/^mixed-|-step-1-questions$/g, '')}`, t.title);
  }
  for (const t of lists.step2) addNew(t.slug, 'B', 'module', `s2-${t.slug.replace(/^step-2-/, '')}`, t.title.replace(/^STEP 2 /, ''));
  for (const t of lists.step3) addNew(t.slug, 'C', 'module', `s3-${t.slug.replace(/^step-3-/, '')}`, t.title.replace(/^STEP 3 /, ''));
  for (const t of targets) if (t.old && !teaser.has(t.slug)) problems.push({ where: 'step.maths.org lists', what: `${t.slug} not listed` });

  log(`STEP: ${targets.length} pages`);
  const items = (
    await pool(targets, 4, async (t) => {
      let p;
      try {
        p = await stepPage(t.slug, { foundation: (t.old?.kind ?? t.kind) === 'assignment' });
      } catch (e) {
        if (gone(e)) {
          problems.push({ where: `${STEP}/assignments/${t.slug}`, what: `gone (HTTP ${e.status}); kept, flagged upstreamMissing` });
          return null;
        }
        throw e;
      }
      const base = t.old ?? { id: t.id, phase: t.phase, kind: t.kind, n: t.n, title: t.title, ...(t.kind === 'assignment' ? { topics: [] } : {}) };
      return {
        id: base.id,
        phase: base.phase,
        kind: base.kind,
        n: base.n,
        title: base.title,
        ...(base.topics ? { topics: base.topics } : {}),
        siteTitle: p.title,
        url: p.url,
        siteTopics: teaser.get(t.slug)?.teaser ?? t.old?.siteTopics ?? '',
        ...(p.stepQuestions.length ? { stepQuestions: p.stepQuestions } : {}),
        links: p.links,
        ...(p.notes.length ? { notes: p.notes } : {}),
      };
    })
  ).filter(Boolean);

  // Question lists for items that have none yet, read from their PDFs.
  const need = items.filter((i) => !Array.isArray(byUrl.get(i.url)?.questions));
  if (need.length) log(`STEP: reading ${need.length} PDFs for question lists`);
  await pool(need, 4, async (it) => {
    const { questions, note } = seedQuestions(it, await itemPdf(it));
    it.questions = questions;
    if (note) it.questionsNote = note;
  });

  return { $schema: './schema/step.schema.json', source: `${STEP}/`, scrapedAt: today(), items };
}

// ----------------------------------------------------------------------- courses

const DPMMS = 'https://www.dpmms.cam.ac.uk/study/';
const DAMTP = 'https://www.damtp.cam.ac.uk/user/examples/';

/** PDF sheets on a DPMMS page (comments stripped), grouped by year folder, page order. */
function dpmmsYears(html, base) {
  const years = new Map();
  for (const l of links(stripComments(html), base)) {
    const m = l.href.match(/\/(\d{4}-\d{4})\/[^/]+\.pdf$/i);
    if (!m || !l.href.startsWith(base)) continue;
    if (!years.has(m[1])) years.set(m[1], []);
    if (!years.get(m[1]).some((x) => x.href === l.href)) years.get(m[1]).push(l);
  }
  return years;
}

async function dpmmsSheets(page) {
  const { text } = await fetchText(page);
  const years = dpmmsYears(text, page);
  const prev = links(stripComments(text), page).find((l) => /(previous|archive)\.html$/.test(l.href));
  if (prev) for (const [y, ls] of dpmmsYears((await fetchText(prev.href)).text, page)) if (!years.has(y)) years.set(y, ls);
  const newest = [...years.keys()].sort().at(-1);
  if (!newest) return { page, sheets: [], sheetYear: null };
  const onMain = dpmmsYears(text, page).has(newest);
  return {
    page,
    sheetYear: newest,
    sheetSource: onMain ? page : prev.href,
    sheets: years.get(newest).map((l, i) => ({ n: i + 1, label: l.text || `Example sheet ${i + 1}`, url: l.href, verified: null })),
  };
}

async function damtpIndex() {
  const { text } = await fetchText(DAMTP);
  const rows = [];
  for (const m of text.matchAll(/<tr><td><b>([A-Z]\d+[A-Za-z]*)<\/b><\/td><td>([\s\S]*?)<\/td><td><a href="([^"]+\.pdf)"[\s\S]*?<td>([^<]*)<\/td><\/tr>/g)) {
    rows.push({ code: m[1], title: cleanText(m[2]), url: new URL(m[3], DAMTP).href, updated: cleanText(m[4]) });
  }
  const codes = new Map();
  for (const m of (await fetchText(`${DAMTP}codes.html`)).text.matchAll(/<td>\s*([A-D]\d+)\s*<\/td>\s*<td>([^<]+)<\/td>/g)) {
    codes.set(m[1], cleanText(m[2]));
  }
  return { rows, codes };
}

function damtpSheets(idx, code, name) {
  const listed = idx.codes.get(code);
  if (!listed || listed.toLowerCase() !== name.toLowerCase()) {
    problems.push({ where: `${DAMTP}codes.html`, what: `code ${code} is "${listed}", expected "${name}"` });
  }
  const mine = idx.rows.filter((r) => new RegExp(`^${code}L?[a-z]$`).test(r.code));
  const isSheet = (r) => /^[A-Z]\d+[a-z]$/.test(r.code) && !/study sheet/i.test(r.title);
  return {
    page: DAMTP,
    damtpCode: code,
    sheets: mine.filter(isSheet).map((r, i) => ({ n: i + 1, label: r.title, url: r.url, updated: r.updated, verified: null })),
    extras: mine.filter((r) => !isSheet(r)).map((r) => ({ label: `${r.title} (DAMTP ${r.code})`, url: r.url, verified: null })),
  };
}

/** Dexter Chua's notes: course heading -> full-version PDF. */
async function dec41() {
  const base = 'https://dec41.user.srcf.net/notes/';
  const { text } = await fetchText(base);
  const map = new Map();
  for (const m of text.matchAll(/<h4 class='course'>([^<]+?)\s*<span[\s\S]*?href='([^']+)' title='Full version'/g)) {
    if (!map.has(m[1].trim())) map.set(m[1].trim(), new URL(m[2], base).href);
  }
  return map;
}

/** Notes Hub page: course paragraph -> lecturer's notes links. */
async function hub(url) {
  const { text } = await fetchText(url);
  const map = new Map();
  for (const para of text.split(/<p>/).slice(1)) {
    const name = cleanText(para.split(/<br|\n/)[0]);
    const lect = [...para.matchAll(/<a href="([^"]+)">([^<]+)<\/a>\s*\(Lecturers notes\)/g)].map((m) => ({ who: cleanText(m[2]), href: m[1] }));
    if (name) map.set(name, lect);
  }
  return map;
}

async function pastPapers() {
  const index = 'https://www.maths.cam.ac.uk/undergrad/pastpapers';
  const { text, finalUrl } = await fetchText(index);
  const years = [];
  for (const row of text.split(/<tr>/).slice(1)) {
    const y = cleanText(row.match(/<th>([\s\S]*?)<\/th>/)?.[1] ?? '');
    if (!/^\d{4}$/.test(y)) continue;
    const ia = links(row, finalUrl).find((l) => l.text === 'Part IA');
    if (ia) years.push({ year: Number(y), url: ia.href });
  }
  years.sort((a, b) => b.year - a.year);
  const withPapers = await pool(years, 4, async (y) => {
    try {
      const { text: t } = await fetchText(y.url);
      const pdfs = [...new Set(links(t, y.url).filter((l) => /\.pdf$/i.test(l.href) && /\/pastpapers\/files\//.test(l.href)).map((l) => l.href))];
      const papers = pdfs.map((u) => {
        const f = decodeURIComponent(u.split('/').pop());
        const n = f.match(/paper_?ia_?(\d)/i)?.[1];
        const label = n ? `Paper ${n}` : /^list_/i.test(f) ? 'All questions (one PDF)' : f.replace(/\.pdf$/i, '');
        return { label, url: u, verified: null };
      });
      return { year: y.year, url: y.url, verified: null, papers };
    } catch (e) {
      problems.push({ where: y.url, what: `past-paper year page failed: ${e.message}` });
      return { year: y.year, url: y.url, verified: null, papers: [] };
    }
  });
  return { url: finalUrl, verified: null, years: withPapers };
}

/**
 * Sheets and notes for every course in the owner's courses.json. A course with a
 * `damtpCode` reads the DAMTP examples index; one whose `page` is on DPMMS reads that
 * page. `name` is the heading looked up on the student-notes pages.
 */
async function scrapeCourses(existing) {
  log('Courses: DAMTP index, notes, past papers');
  const idx = await damtpIndex();
  const chua = await dec41();
  const hubIA = await hub('https://at2027.user.srcf.net/IA.html');
  const hubIB = await hub('https://at2027.user.srcf.net/IB.html');
  const papers = await pastPapers();
  const { text: courseHtml } = await fetchText('https://www.maths.cam.ac.uk/undergrad/course');
  const schedHref = links(courseHtml, 'https://www.maths.cam.ac.uk/undergrad/course').find((l) => /schedules\.pdf$/.test(l.href))?.href;
  if (!schedHref) problems.push({ where: 'https://www.maths.cam.ac.uk/undergrad/course', what: 'no schedules.pdf link' });
  const perCourse = existing.cadence?.sheetsPerCourse;

  const notesFor = (name, hubMap, hubUrl) => {
    const out = [];
    if (chua.has(name)) out.push({ label: 'Dexter Chua, student notes (PDF)', kind: 'student', url: chua.get(name), verified: null });
    for (const l of hubMap.get(name) ?? []) out.push({ label: `${l.who}, lecturer's notes`, kind: 'lecturer', url: l.href, verified: null });
    if (hubMap.has(name)) out.push({ label: 'Notes Hub: more student notes for this course', kind: 'hub', url: hubUrl, verified: null });
    return out;
  };

  const build = async (c, hubMap, hubUrl) => {
    let src;
    if (c.damtpCode) src = damtpSheets(idx, c.damtpCode, c.name);
    else if (c.page?.startsWith(DPMMS)) src = await dpmmsSheets(c.page);
    else {
      problems.push({ where: c.id, what: 'no damtpCode and no DPMMS page; not scraped' });
      return null;
    }
    const siteNote = [];
    if (src.sheetSource && src.sheetSource !== src.page) {
      siteNote.push(`This year's sheets are not posted yet; the ${src.sheetYear} sheets come from the previous-years page.`);
    }
    if (!c.damtpCode && perCourse && src.sheets.length !== perCourse) siteNote.push(`${src.sheets.length} example sheets found for ${src.sheetYear}.`);
    return {
      id: c.id,
      ...(src.sheetYear ? { sheetYear: src.sheetYear } : {}),
      sheets: src.sheets.map((s) => ({ ...s, questions: [] })),
      notes: [...notesFor(c.name, hubMap, hubUrl), ...(src.extras ?? [])],
      ...(siteNote.length ? { siteNote: siteNote.join(' ') } : {}),
    };
  };

  log('Courses: Part IA');
  const courses = [];
  for (const c of existing.courses ?? []) courses.push(await build(c, hubIA, 'https://at2027.user.srcf.net/IA.html'));
  log('Courses: Part IB');
  const partIB = [];
  for (const c of existing.partIB ?? []) partIB.push(await build(c, hubIB, 'https://at2027.user.srcf.net/IB.html'));
  return {
    $schema: './schema/courses.schema.json',
    scrapedAt: today(),
    courses: courses.filter(Boolean),
    partIB: partIB.filter(Boolean),
    schedules: { url: schedHref, verified: null },
    pastPapers: { partIA: papers },
  };
}

// ---------------------------------------------------------------------------- CS

const CL = 'https://www.cl.cam.ac.uk/teaching/';

/** Course list of one CL part page: [{ code, name, url, terms, hours }]. */
function clCourses(html, base) {
  const byCode = new Map();
  for (const sec of html.split(/<h2 id="/).slice(1)) {
    const term = cleanText(sec.slice(sec.indexOf('>') + 1, sec.indexOf('</h2>')));
    const ul = sec.slice(0, sec.search(/<\/ul>/));
    for (const li of ul.split(/<li[ >]/).slice(1)) {
      const a = li.match(/<b><a href="([^"]+)">([\s\S]*?)<\/a><\/b>/);
      if (!a) continue;
      const url = new URL(a[1], base).href;
      const code = url.match(/teaching\/\d{4}\/([^/]+)\//)?.[1];
      if (!code) continue;
      const hours = Number(li.match(/(\d+)(?:&#160;|\s)h/)?.[1] ?? 0) || undefined;
      const c = byCode.get(code) ?? { code, name: cleanText(a[2]), url, terms: [], ...(hours ? { hours } : {}) };
      if (!c.terms.includes(term)) c.terms.push(term);
      byCode.set(code, c);
    }
  }
  return [...byCode.values()];
}

/** The page body under the Syllabus / materials / recordings tab strip. */
function clBody(html) {
  const ends = ['Information for supervisors</a>', 'Recordings</a>'].map((t) => html.indexOf(t)).filter((i) => i >= 0);
  if (!ends.length) return '';
  const j = html.indexOf('campl-local-footer');
  return html.slice(Math.min(...ends), j < 0 ? undefined : j);
}
/** The tab strip itself (Syllabus, Course materials, Recordings). */
const clTabs = (html, base) => links(html.slice(0, html.indexOf(clBody(html)) + 40), base);

const CL_SKIP = /zoom\.us\/|\/~|instructions\.html|lecturers\.html|part1[ab]\.html|part2\.html|\/timetables|Last year|edit page|Information for supervisors|Recordings/i;

function classify(l) {
  const s = `${l.href} ${l.text}`;
  if (/vle\.cam\.ac\.uk|moodle|panopto/i.test(s)) return { kind: 'moodle', ravenOnly: true };
  if (/\/exams\/pastpapers\//.test(l.href)) return { kind: 'pastPapers' };
  if (/youtube|youtu\.be|\/video\/|recording/i.test(s)) return { kind: 'videos' };
  if (/exercise|examples? paper|sheet|tick|problem|question|supervision|SupExs|worksheet|practical|assignment/i.test(`${s} ${l.before}`)) return { kind: 'exercises' };
  return { kind: 'notes' };
}

/** Content links of a materials page, blocked hosts skipped, bare "here"/"PDF" labels given context. */
const contentLinks = (body, base, year) => {
  const out = [];
  for (const l of links(body, base)) {
    if (CL_SKIP.test(`${l.href} ${l.text}`) || out.some((o) => o.url === l.href)) continue;
    const why = blockedReason(l.href);
    if (why) {
      problems.push({ where: base, what: `skipped "${l.text}" -> ${l.href}: ${why}` });
      continue;
    }
    const c = classify(l);
    out.push({ kind: c.kind, label: contextLabel(l, year) || l.href, url: l.href, ...(c.ravenOnly ? { ravenOnly: true } : {}), verified: null });
  }
  return out;
};

/**
 * Materials for one course. Start from the 2026-27 "Course materials" tab (which is the
 * course page itself for practical classes). If that page has no content links and
 * points to last year's materials, use last year's page and say so.
 */
async function clMaterials(courseUrl, courseHtml) {
  const tab = clTabs(courseHtml, courseUrl).find((l) => /^Course materials$/i.test(l.text));
  let page = tab?.href ?? courseUrl;
  let html = page === courseUrl ? courseHtml : (await fetchText(page)).text;
  let year = '2026-27';
  let found = contentLinks(clBody(html), page, year);
  const last = links(clBody(html), page).find((l) => /Last year/i.test(l.text));
  if (last && (found.length === 0 || /no extra material has yet been\s+placed/i.test(html))) {
    page = last.href;
    html = (await fetchText(page)).text;
    const yy = page.match(/teaching\/(\d{2})(\d{2})\//);
    year = yy ? `20${yy[1]}-${yy[2]}` : 'last year';
    found = contentLinks(clBody(html), page, year);
  }
  const vid = clTabs(html, page).find((l) => /^Recordings$/i.test(l.text));
  let videos = [];
  if (vid) {
    try {
      const vb = clBody((await fetchText(vid.href)).text);
      if (!/No recordings available/i.test(vb)) videos = contentLinks(vb, vid.href, year).map((l) => (l.kind === 'moodle' ? l : { ...l, kind: 'videos' }));
    } catch (e) {
      problems.push({ where: vid.href, what: `recordings page failed: ${e.message}` });
    }
  }
  return { year, page, links: found, recordingsPage: vid?.href, videos };
}

const BOP = 'https://richardhammack.github.io/BookOfProof/';
const CS3110 = 'https://cs3110.github.io/textbook/';

/** Book of Proof chapters from the author's page: n -> { url, title }. The url is the free PDF at the chapter's page. */
async function bopChapters() {
  const { text, finalUrl } = await fetchText(BOP);
  const out = new Map();
  for (const l of links(text, finalUrl)) {
    const m = l.text.match(/^(\d+)\.\s+(.+?)\s+\1\.1\s/);
    if (m && /Main\.pdf#page=\d+$/.test(l.href) && !out.has(Number(m[1]))) out.set(Number(m[1]), { url: l.href, title: m[2] });
  }
  return out;
}

/** CS3110 (OCaml Programming) chapters from the book's cover page: n -> { url, title, exercises }. */
async function cs3110Chapters() {
  const { text, finalUrl } = await fetchText(`${CS3110}cover.html`);
  const all = links(text, finalUrl);
  const out = new Map();
  for (const l of all) {
    const m = l.text.match(/^(\d+)\.\s+(\S.*)$/);
    if (!m || !/\/chapters\/[^/]+\/intro\.html$/.test(l.href) || out.has(Number(m[1]))) continue;
    const ex = l.href.replace(/intro\.html$/, 'exercises.html');
    out.set(Number(m[1]), { url: l.href, title: m[2], exercises: all.some((x) => x.href === ex) ? ex : null });
  }
  return out;
}

/**
 * Fresh links for the CS track items the owner lists (the scrape never adds an item).
 * Book of Proof and CS3110 chapter items are read off the books' pages; every other item
 * that is not a Part IA course (those come from the tripos scrape, in merge.mjs) gets its
 * own urls back unchecked, so verify() re-checks them. `sources` names what was read, so
 * the merge only flags an item as gone when its source page was actually read.
 */
async function scrapeCsTrack(track) {
  const items = track?.items ?? [];
  const out = [];
  const sources = ['fixed'];
  const numbered = (prefix) => items.filter((i) => new RegExp(`^${prefix}-\\d+$`).test(i.id)).map((i) => [Number(i.id.split('-')[1]), i]);

  const bop = numbered('bop');
  if (bop.length) {
    const ch = await bopChapters();
    sources.push('bop');
    for (const [n, it] of bop) {
      const c = ch.get(n);
      if (!c) continue;
      out.push({ id: it.id, siteTitle: `Chapter ${n}: ${c.title}`, links: [link('notes', `Book of Proof, chapter ${n}: ${c.title} (PDF)`, c.url), link('book', 'Book of Proof (free edition, on the author\'s site)', BOP)] });
    }
    for (const [n, c] of ch) if (!bop.some(([m]) => m === n)) problems.push({ where: BOP, what: `chapter ${n} (${c.title}) is not in the CS track; add a bop-${String(n).padStart(2, '0')} item to use it` });
  }

  const ocaml = numbered('ocaml');
  if (ocaml.length) {
    const ch = await cs3110Chapters();
    sources.push('ocaml');
    for (const [n, it] of ocaml) {
      const c = ch.get(n);
      if (!c) continue;
      out.push({
        id: it.id,
        siteTitle: `${n}. ${c.title}`,
        links: [link('notes', `OCaml Programming, chapter ${n}: ${c.title}`, c.url), ...(c.exercises ? [link('exercises', `Chapter ${n} exercises`, c.exercises)] : [])],
      });
    }
    for (const [n, c] of ch) if (!ocaml.some(([m]) => m === n)) problems.push({ where: `${CS3110}cover.html`, what: `chapter ${n} (${c.title}) is not in the CS track` });
  }

  const LINK_FIELDS = ['kind', 'label', 'url', 'role'];
  for (const it of items) {
    if (it.course || /^(bop|ocaml)-\d+$/.test(it.id)) continue;
    out.push({ id: it.id, links: (it.links ?? []).map((l) => ({ ...Object.fromEntries(LINK_FIELDS.filter((k) => k in l).map((k) => [k, l[k]])), verified: null })) });
  }
  return { sources, items: out };
}

async function scrapeCs(existing) {
  const parts = {};
  for (const [key, file] of [['IA', 'part1a.html'], ['IB', 'part1b.html'], ['II', 'part2.html']]) {
    const url = `${CL}2627/${file}`;
    parts[key] = { url, courses: clCourses((await fetchText(url)).text, url) };
  }
  log(`CS: Part IA materials (${parts.IA.courses.length} courses)`);
  const ia = await pool(parts.IA.courses, 3, async (c) => {
    const html = (await fetchText(c.url)).text;
    const pp = links(clBody(html), c.url).find((l) => /\/exams\/pastpapers\/t-[^/]+\.html$/.test(l.href));
    const m = await clMaterials(c.url, html);
    const all = [...m.links, ...m.videos];
    const hasKind = (k) => all.some((l) => l.kind === k);
    const noteBits = [];
    if (m.year !== '2026-27') noteBits.push(`The 2026-27 materials page is empty; materials are from ${m.year}.`);
    if (all.some((l) => l.ravenOnly)) noteBits.push('Some materials are on Moodle, which needs a Cambridge (Raven) login.');
    if (!m.videos.some((l) => l.kind === 'videos')) noteBits.push('No public recordings; the recordings page points to Panopto via Moodle (Raven login).');
    return {
      id: `cs-ia-${c.code.toLowerCase()}`,
      ...c,
      available: { notes: hasKind('notes'), exercises: hasKind('exercises'), videos: m.videos.some((l) => l.kind === 'videos'), pastPapers: Boolean(pp) },
      materials: { year: m.year, page: m.page, links: all },
      ...(m.recordingsPage ? { recordingsPage: m.recordingsPage } : {}),
      ...(pp ? { pastPapers: { url: pp.href, verified: null } } : {}),
      ...(noteBits.length ? { siteNote: noteBits.join(' ') } : {}),
    };
  });
  const simple = (key) => parts[key].courses.map((c) => ({ id: `cs-${key.toLowerCase()}-${c.code.toLowerCase()}`, ...c }));
  log('CS: track (Book of Proof, CS3110, foundation links)');
  const track = await scrapeCsTrack(existing?.track);
  return {
    $schema: './schema/cs.schema.json',
    scrapedAt: today(),
    track,
    tripos: {
      name: 'Computer Science Tripos',
      year: '2026-27',
      pastPapers: { url: `${CL}exams/pastpapers/`, verified: null },
      parts: {
        IA: { url: parts.IA.url, courses: ia },
        IB: { url: parts.IB.url, courses: simple('IB') },
        II: { url: parts.II.url, courses: simple('II') },
      },
    },
  };
}

// ------------------------------------------------------------------ verification

/** Every object in `tree` that has a string `url` and a `verified` key. */
function linkObjects(tree, out = []) {
  if (Array.isArray(tree)) tree.forEach((t) => linkObjects(t, out));
  else if (tree && typeof tree === 'object') {
    if (typeof tree.url === 'string' && 'verified' in tree) out.push(tree);
    for (const v of Object.values(tree)) linkObjects(v, out);
  }
  return out;
}

async function verify(tree) {
  const objs = linkObjects(tree);
  const urls = [...new Set(objs.map((o) => o.url))];
  log(`Checking ${urls.length} URLs`);
  const results = new Map();
  await pool(urls, 5, async (u) => {
    let r;
    let final = u;
    if (u.startsWith('http://')) {
      const https = `https://${u.slice(7)}`;
      const rs = await checkUrl(https);
      if (rs.ok) {
        final = https;
        r = rs;
      }
    }
    r ??= await checkUrl(u);
    results.set(u, { ...r, final });
  });
  for (const o of objs) {
    const r = results.get(o.url);
    o.url = r.final;
    o.verified = r.ok;
    if (r.ok && r.final.startsWith('http://')) o.httpOnly = true;
    if (!r.ok) {
      o.reason = r.login ?? `HTTP ${r.status}${r.error ? ` (${r.error})` : ''} on ${today()}`;
      o.lastCheckedStatus = r.status;
      if (/Raven/.test(r.login ?? '')) o.ravenOnly = true;
      problems.push({ where: o.url, what: o.reason });
    }
  }
  tree.lastVerified = today();
  return tree;
}

// -------------------------------------------------------------------------- main

const FILES = {
  step: { file: 'step.json', scrape: scrapeStep, merge: mergeStep, normalize: normalizeStep },
  courses: { file: 'courses.json', scrape: scrapeCourses, merge: mergeCourses, normalize: normalizeCourses },
  cs: { file: 'cs.json', scrape: scrapeCs, merge: mergeCs, normalize: normalizeCs },
};

async function main(argv) {
  const offline = argv.includes('--offline');
  const want = new Set(argv.filter((a) => !a.startsWith('--')));
  for (const k of want) if (!FILES[k]) throw new Error(`unknown file "${k}"; use step, courses or cs`);
  for (const [key, f] of Object.entries(FILES)) {
    if (want.size && !want.has(key)) continue;
    const path = join(OUT, f.file);
    if (!existsSync(path)) throw new Error(`${f.file} is missing. It is the source of truth; restore it from git, then rerun.`);
    const before = await readJson(path);
    const notes = [];
    let next = structuredClone(before);
    if (!offline) {
      const fresh = dropBlocked(await f.scrape(structuredClone(before)), notes);
      await verify(fresh);
      next = f.merge(next, fresh);
    }
    next = f.normalize(next, notes);
    const changes = diffJson(before, next);
    log(`\n${f.file}: ${changes.length ? `${changes.length} change(s)` : 'no changes'}`);
    for (const c of changes.slice(0, 60)) log(`  ${c}`);
    if (changes.length > 60) log(`  ... and ${changes.length - 60} more`);
    for (const n of notes) log(`  note: ${n}`);
    if (changes.length) await writeJson(path, next);
  }
  if (problems.length) {
    log(`\n${problems.length} problem(s):`);
    for (const p of problems) log(`- ${p.where}: ${p.what}${p.fix ? ` -> ${p.fix}` : ''}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
