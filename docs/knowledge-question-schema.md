# Phase 1 schema spec — source deep-linking + practice links

Scope: additive, optional fields on the knowledge-question schema
(`public/questions/*.json`). All existing questions must keep validating and
rendering unchanged (backward-compat verified sound — §7). This is a spec — no code
here, just exactly what to add and where.

> **Revision note (adversarial review):** the original draft wired only the
> secondary per-topic browse screen (`TopicCard`). The **main** study surface is
> `AscentSession` — `KnowledgeTab.tsx:443` routes both Today's-path (`__today__`)
> and every focused review (`__review__:*`) to `<AscentSession/>`, which has its own
> plain-text source render and never runs the VM merge. The fix below extracts the
> link/normalize logic into **shared pure helpers** consumed by BOTH surfaces. See
> §2.5–§2.6.

---

## 0. Current mechanism (as-built, for reference)

A question is:

```jsonc
{ "id", "mins", "flow", "prompt", "src": { "book", "ref", "page?" }, "reveal", "tags" }
```

- `src.book` keys into `src/core/data/books.json` → `{ t: title, u: url }`.

**Two independent source renderers exist today — both must be updated:**

**(A) `KnowledgeTab.tsx` — `TopicCard` via `QSrc`** (secondary per-topic browse).
The VM (`knowledgeVM`, the `items.map`) pre-resolves the book:
`src: { ...it.src, title: b.t, url: b.u }` — **`b.u` is spread last, so the book url
overwrites any per-question `src.url`** (load-bearing — see §2.3). `QSrc`
(`KnowledgeTab.tsx:161`):
- `label = src.title ? `${src.ref} — ${src.title}` : src.ref`
- `href  = /\.pdf$/i.test(src.url) && src.page ? `${src.url}#page=${src.page}` : src.url`
- no url → plain text, no link. `rel="noopener"` only.

**(B) `AscentSession.tsx` — `Card`** (the PRIMARY study surface: Today's path +
every review). Reads **raw** `item.src` — **it never runs the VM merge**:
- `const book = BOOKS[item.src.book]` (`AscentSession.tsx:331`)
- `srcLabel = book && book.t ? `${item.src.ref} · ${book.t}` : item.src.ref` (note
  `·` separator, vs QSrc's `—`)
- `<div class="asc-src">{srcLabel}</div>` (`:351`) — **plain text, no `<a>`, no
  href, no page/anchor, no practice.**

Consequence of the original spec: deep-links + practice would have appeared ONLY on
(A), never where Albert actually studies. This revision fixes that.

- **Already true today (safe):** a `page` on a non-`.pdf` url is ignored by (A) and
  never consulted by (B). Adding `page` to a web resource is harmless but useless —
  web resources need a real anchor (§1.2).

`src.ref` is a free-text human locator the author already writes, e.g.
`"§8.1 Two pointers"`. It stays the "§section" text in the rendered line.

---

## 1. Source deep-linking — the two cases

Albert's rule: full-text PDFs open to the exact **page**; non-paginated web
resources get a section **anchor**. Anything not a real PDF cannot take a page —
enumerated in §1.3.

### 1.1 Paginated PDF book → `src.page` (unchanged, confirmed)

- **Field:** `src.page` — integer, 1-based, the *PDF-viewer page index* (not the
  printed folio; they differ by the front-matter offset — author uses the number the
  viewer shows).
- **Applies when:** the effective base url (§2.1) ends in `.pdf` (case-insensitive,
  matching the existing `/\.pdf$/i` test).
- **Link format:** `<base>#page=N` — standard PDF Open Parameters fragment. See the
  iOS/attachment limitation in §6.
- **Real-PDF books today** (the only `book` keys where `page` does anything):
  `cses, skiena, clrs, csapp, tanenbaum, cia, hp, cod, unp, tlpi`.

### 1.2 Non-paginated web resource → `src.anchor` (new)

For HTML resources that scroll rather than paginate — cpu.land, the Fortnow blog,
inferenceengineering.tech, C++ Core Guidelines, cs231n, craftinginterpreters, the
JAX scaling book, bare-metal C++, etc.

- **Field:** `src.anchor` — string, a URL fragment **without** the leading `#`
  (e.g. `"the-fetch-execute-cycle"`, `"S-cache"`, `"speculative-decoding"`).
- **Link format:** `<base>#<anchor>` after stripping any existing fragment on the
  base (§2.2).
- **Encoding caveat:** `anchor` is inserted **raw** (author-owned). Fragment ids are
  overwhelmingly `[A-Za-z0-9-_]` and need no escaping; if a target's id ever contains
  a space or non-ASCII, the author pre-`encodeURIComponent`s that piece themselves.
  No runtime encoding — keeps existing `#page=N` output byte-identical.
- **Applies to:** any non-PDF base. If the base *is* a `.pdf`, `anchor` is ignored in
  favor of `page` (§2.2).
- **Validity:** an anchor only works if the target page exposes that fragment id.
  Author verifies (`open url#anchor`, confirm the jump). No runtime validation.

### 1.3 Books that CANNOT take a `page` (flag)

Not real full-text PDFs → use `anchor` (or a per-question `.pdf` override, §2.3).
Every current `book` key **not** in the §1.1 list:

`dbsys, crafting, kurose, sysdesign, star, micrograd, cs231n, attention, roofline,
brrr, scaling, 3b1b, ddia, ostep, mathcs, pmpp, cornell, hwint, baremetal, cpuland,
coreg, fortnow, infereng, skycak, playlist`

Author notes:
- **`ostep`** — landing is HTML, but each chapter is its own PDF
  (`.../vm-intro.pdf`). Use a per-question `src.url` override (§2.3) to the chapter
  PDF **plus** `src.page`.
- **`attention`** — book url is the arXiv *abstract* page (`/abs/1706.03762`).
  Override `src.url` to the `/pdf/…` and add `page` to hit a page.
- **`pmpp`, YouTube (`playlist`, `3b1b`), GitHub (`sysdesign`)** — no stable
  in-page anchors / not text; leave as a plain book link.

---

## 2. Field definitions, precedence & shared helpers

### 2.1 Effective base url

```
base = src.url (per-question override, §2.3)  ??  books.json[src.book].u
```

### 2.2 Fragment precedence (page vs anchor vs none) — with fragment-strip

Let `stripFrag(u) = u without any trailing "#…"`. Resolve in order, first wins:

1. `src.page` set **and** `base` ends in `.pdf` → `stripFrag(base) + "#page=" + page`
2. `src.anchor` set                            → `stripFrag(base) + "#" + anchor`
3. otherwise                                    → `base` (unchanged)

**Strip in BOTH rules 1 and 2.** A `.pdf` override carrying its own `#frag`
(`…/x.pdf#section` + `page:5`) would otherwise yield `…#section#page=5`; likewise an
anchor on a base that already has a fragment would double up. Rule 3 leaves `base`
untouched (no existing question relies on a stripped tail).

`page` on a non-PDF base fails rule 1 and falls through — matches today. `page` and
`anchor` are expected mutually exclusive per question; if both set, PDF+page wins.

### 2.3 Per-question url override → `src.url` (new raw field) — REQUIRES a VM fix

Purpose: a source that is a specific chapter-PDF / sub-page differing from the book's
landing url (the `ostep` / `attention` cases).

- **Field:** `src.url` — absolute url string. Optional.
- **Blocker:** the (A) VM merge `{ ...it.src, title: b.t, url: b.u }` **clobbers** a
  raw `src.url` with the book url. Change the merge to resolve url override-first:
  `url: it.src.url ?? b.u` (keep `title: b.t` — the book title still labels the
  line). Surface (B) resolves the same base inside the shared helper (§2.5), so no
  merge is needed there.
- Backward compatible: no existing question sets a raw `src.url`, so `?? b.u`
  reproduces today's output.

### 2.4 Security: href scheme guard + rel (defense-in-depth)

`href` is set verbatim from author JSON in both surfaces. **Trust assumption:** the
question bank is author-controlled static content in-repo (not user input), so this
is low risk — but guard it anyway:

- **Scheme allow-list:** the shared `srcHref`/`practiceLinks` helpers return a link
  ONLY when the resolved url matches `^https?:` (case-insensitive). Any other scheme
  (`javascript:`, `data:`, `vbscript:`, protocol-relative `//`, or unparseable) →
  treat as "no link": the source line renders as plain text, the practice entry is
  dropped. This neutralizes a `javascript:`/`data:` payload that would otherwise
  execute on click.
- **`rel`:** every external `<a>` (source AND practice, both surfaces) uses
  `target="_blank" rel="noopener noreferrer"` — upgrade from today's `noopener`-only.

### 2.5 Shared helpers (single source of truth) — NEW module

Both renderers must produce identical link behavior, so extract pure helpers into a
small shared module (proposed `src/features/knowledge/source.ts`):

```
// signatures (spec, not implementation)
srcHref(src: KnowledgeItem['src'], bookUrl: string | undefined): string | null
   // base = src.url ?? bookUrl; apply §2.2 precedence + §2.4 scheme guard;
   // returns the href, or null when there is no safe/linkable url.

practiceLinks(it: { practice?: PracticeLink | PracticeLink[] }): PracticeLink[]
   // normalize the object|array union (§3) to an array; drop entries whose url
   // fails the §2.4 scheme guard or lack a label; returns [] when absent.
```

- `srcHref` takes `bookUrl` explicitly so surface (B) can pass
  `BOOKS[item.src.book]?.u` (no VM), while surface (A) passes the already-merged
  `src.url` — both resolve `base = src.url ?? bookUrl` to the same value.
- Both helpers are pure and idempotent → callable from the VM and directly from a
  card without divergence.

### 2.6 Rendering — BOTH surfaces

**(A) `QSrc` in `TopicCard`:**
- Label unchanged: `src.title ? `${src.ref} — ${src.title}` : src.ref`.
- Replace the inline href expression with `srcHref(src, src.url)`; when it returns a
  string, render the `<a … rel="noopener noreferrer">{label} ↗</a>`, else plain
  text (today's no-url path).
- After `<QSrc/>`, render the practice row (§3.2) from `practiceLinks(it)`.

**(B) `Card` in `AscentSession.tsx` — THE MAIN SURFACE (new work):**
- Keep the existing `srcLabel` (the `·` form) — do not homogenize separators.
- Compute `const href = srcHref(item.src, BOOKS[item.src.book]?.u)`.
- Wrap `asc-src`: when `href` is non-null, render
  `<a class="asc-src" href={href} target="_blank" rel="noopener noreferrer">{srcLabel} ↗</a>`;
  otherwise keep the existing plain `<div class="asc-src">{srcLabel}</div>`. (Style
  the `<a>.asc-src` to match — see §4.)
- Render the practice row from `practiceLinks(item)` directly beneath `asc-src`
  (§3.2), before the answer textarea.

---

## 3. Practice link (algorithms, but topic-agnostic)

Attach an external practice problem (LeetCode or comparable) to a question.

### 3.1 Field → `practice` (new, optional)

- **Shape:** accept **either** a single object **or** an array; the JSON author may
  write either. `PracticeLink = { label: string; url: string }`.
  ```jsonc
  "practice": { "label": "LC 15 · 3Sum", "url": "https://leetcode.com/problems/3sum/" }
  // or
  "practice": [
    { "label": "LC 15 · 3Sum",        "url": "https://leetcode.com/problems/3sum/" },
    { "label": "LC 167 · Two Sum II", "url": "https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/" }
  ]
  ```
- **Normalize ONCE** to a guaranteed array. The single `practiceLinks(it)` helper
  (§2.5) is the normalization point BOTH surfaces call — so neither `TopicCard` nor
  Ascent's `Card` ever `.map`s a raw union (mapping a bare object would throw at
  render). Surface (A)'s VM MAY pre-normalize too, but the helper is idempotent and
  is the actual guarantee (Ascent bypasses the VM).
- **Naming note:** harmless overlap with the existing `vm.gym.practice` (the Gym's
  "Apply" links). Different field, different type, different render site — no
  collision, just be aware when reading `KnowledgeTab.tsx`.
- Optional and topic-agnostic: primarily on `algorithms`/`graph`, valid anywhere.
  Absent on all current questions → nothing renders.

### 3.2 Where it renders

A quiet chip row **directly beneath the source line** on BOTH surfaces (after
`<QSrc/>` in `TopicCard`; after `asc-src` in Ascent's `Card`), **before** the answer
textarea — you want the practice link available *while attempting*, not only after
reveal.

- Reuse the external-link affordance: each entry a small chip/link `‹label› ↗`,
  `target="_blank" rel="noopener noreferrer"`, teal accent (`var(--teal)`, matching
  `GymRow`/sources).
- Prefix the row with a quiet `Practice ›` so it reads as an action, not a citation:
  `Practice ›  LC 15 · 3Sum ↗   LC 167 · Two Sum II ↗`. Entries wrap on one row.
- `practiceLinks(it)` returns `[]` → render nothing (no empty row).

(Alternative considered: inside the revealed answer area. Rejected — practice belongs
in the attempt phase, and the source external-link pattern already lives here.)

---

## 4. Renderer / type changes to make (spec only — no code written)

1. **`src/features/knowledge/types.ts`:**
   - `KnowledgeItem.src` gains `anchor?: string`. (`page?`, `url?`, `title?` already
     declared.)
   - Add and **export** `PracticeLink = { label: string; url: string }` (cards
     import it).
   - `KnowledgeItem` gains `practice?: PracticeLink | PracticeLink[]`.
2. **NEW `src/features/knowledge/source.ts`:** the pure `srcHref(src, bookUrl)` and
   `practiceLinks(it)` helpers (§2.5) incl. the §2.2 precedence, fragment-strip, and
   §2.4 `^https?:` scheme guard.
3. **`src/features/knowledge/KnowledgeTab.tsx`:**
   - `knowledgeVM` `items.map`: change the src merge to `url: it.src.url ?? b.u`
     (keep `title: b.t`); ensure `anchor` survives the spread. Optionally
     pre-normalize `practice`.
   - `QSrc`: use `srcHref(src, src.url)`; `<a>` gets `rel="noopener noreferrer"`.
   - `TopicCard`: render the practice row from `practiceLinks(it)` after `<QSrc/>`.
4. **`src/features/knowledge/AscentSession.tsx` — `Card` (MAIN surface):**
   - Compute `srcHref(item.src, BOOKS[item.src.book]?.u)`; wrap `asc-src` in an `<a
     … rel="noopener noreferrer">…{srcLabel} ↗</a>` when a href exists, else keep the
     plain `<div>`.
   - Render the practice row from `practiceLinks(item)` beneath `asc-src`.
5. **Styling:**
   - Add `a.asc-src` rules (link color/underline) so the linked variant matches the
     plain `.asc-src`; add the small `.asc-practice` (Ascent) row.
   - One small practice-chip class for `TopicCard` (mirror `GymRow`'s teal link at
     the `.qsrc` scale).
6. **No manifest/loader change** — `questionBank.ts` passes objects through verbatim;
   new keys ride along automatically.

---

## 5. Summary of exact additions

| field | on | type | link/render |
|---|---|---|---|
| `src.page` | question `src` | int (PDF-viewer page) | `stripFrag(base)#page=N`, only if base ends `.pdf` *(exists)* |
| `src.anchor` | question `src` | string (fragment, no `#`) | `stripFrag(base)#anchor` for non-PDF web resources *(new)* |
| `src.url` | question `src` | absolute url | per-question base override; VM merge fix `url = src.url ?? book.u` *(new)* |
| `practice` | question | `PracticeLink` or `PracticeLink[]` | quiet `Practice ›` chip row under the source, pre-reveal, teal `↗`; normalized once via `practiceLinks()` *(new)* |

Shared: `srcHref(src, bookUrl)` + `practiceLinks(it)` in `source.ts`, consumed by
BOTH `QSrc`/`TopicCard` **and** Ascent's `Card`; both apply the `^https?:` guard and
emit `rel="noopener noreferrer"`.

---

## 6. Known limitation — `#page=N` on mobile

`#page=N` is a viewer hint, not universally honored. It **degrades to page 1** on:
- **iOS Safari's** built-in PDF preview (ignores the fragment), and
- any host that serves the PDF with `Content-Disposition: attachment` (forces a
  download rather than an in-browser viewer).

Meridian is a mobile-first PWA, so a meaningful share of taps (iOS) land on page 1
rather than the cited page. Accepted for now — the citation label (`ref`) still tells
the reader where to look, and desktop/Android Chrome honor the fragment. No
mitigation planned; documented so it isn't mistaken for a bug.

---

## 7. Backward-compatibility (verified sound — retained)

- No existing question sets `anchor`, a raw `src.url`, or `practice`.
- The VM fix `url = it.src.url ?? b.u` reproduces today's url for every current
  question (all have `src.url` undefined).
- A `page` on a non-`.pdf` base still no-ops (rule 1 fails).
- `stripFrag` only affects rules 1–2, which no current question reaches with a
  fragment-bearing base.
- Net: 339 existing questions render byte-identical; no test breaks.

---

## Addendum — Secondary resources (`see`) [approved: primary + secondary sourcing]

Per the owner: a question keeps its PRIMARY `src` (the page-linked PDF that "counts") AND may carry SECONDARY "further reading" links.

- **Field:** `see?: Array<{ label: string; url: string }>` on `KnowledgeItem` (export the row type). OPTIONAL, backward-compatible (0 existing questions set it).
- **Use:** the 12 complexity questions cite **Sipser** as primary (`src.book:'sipser'` + `src.page`) and keep the relevant **Fortnow blog lesson** as a `see` entry (its permalink). General: any question may carry secondaries (later: cpu.land / inference-engineering web resources).
- **Render:** a quiet "Also: <label> · <label>" line directly under the primary source line, on BOTH `TopicCard` (after `QSrc`) and the Ascent `Card` (after `asc-src`). Each link is `http(s)`-guarded and `target="_blank" rel="noopener noreferrer"`.
- **Helpers:** add `seeLinks(it)` to the shared `source.ts` alongside `srcHref`/`practiceLinks`; both cards consume it. Same normalization + scheme-guard rules.
