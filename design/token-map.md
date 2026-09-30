# Token map: old to new

For the Stage 5 restyle. Left column is every color, type, space, radius, and motion token defined today; right column is its replacement in `src/styles/tokens.css`. The old app is dark only and the new system is light only, so this maps **roles**, not values: a dark "raised surface" becomes a light "card", not the nearest hex.

Rules for the restyle:

- Replace the name, don't redefine it. When a feature file is restyled, delete its local palette block (`.pt-root`, `.wgu-root`, and the mastery tokens) and use the global tokens.
- If a role has no row here, it is decoration and should go (the brief allows no decoration that doesn't carry information).
- Any new text-on-background pair must be added to `PAIRS` in `scripts/contrastCore.mjs`.

**Name collisions to watch.** `tokens.css` and `src/styles/app.css :root` both define `--bg`, `--surface-2`, and `--ok`, and `.wgu-root` also defines `--bg`, `--surface`, `--surface-2`, `--ink`, `--accent`, `--accent-ink`, `--accent-wash`. Whichever stylesheet loads last wins on `:root`. Until `app.css :root` is retired, load `tokens.css` only on screens that are fully restyled, or retire the old `:root` block in the same change.

## `src/styles/app.css` `:root`

| Old | Old value | New | Notes |
|---|---|---|---|
| `--void` | `#070B14` | `--bg` | Page field |
| `--bg` | `var(--void)` | `--bg` | Same name, new value |
| `--surface-0` | `#0B1220` | `--bg` | Sunken areas are the page |
| `--surface-1`, `--panel` | `#101826` | `--surface` | Cards |
| `--surface-2`, `--panel2` | `#16202F` | `--surface-2` | Wells, hover |
| `--surface-3` | `#1E2A3B` | `--surface-2` | Pressed or selected: prefer `--accent-wash` when it marks selection |
| `--core` | `#BFE9FF` | `--accent` | Primary accent is coral now; no cool accent |
| `--hub` | `#F2B25C` | `--accent` (fills), `--accent-ink` (text) | |
| `--edge` | `rgba(120,170,220,.18)` | `--rule` | |
| `--ring` | `rgba(150,200,255,.28)` | `--focus` (focus), `--rule` (decorative rings) | |
| `--line` | `rgba(150,190,240,.09)` | `--rule` | |
| `--line-2` | `rgba(150,190,240,.16)` | `--rule-strong` if it bounds a control, else `--rule` | |
| `--text` | `#DCE6F2` | `--ink` | |
| `--muted` | `#8FA3BE` | `--ink-2` | |
| `--faint` | `#7A93B2` | `--ink-3` | |
| `--dim` | `#727D8E` | `--ink-3` | Was below AA on some surfaces |
| `--track` | `#232A33` | `--track` | |
| `--teal` | `#7CC9EC` | `--accent-ink` (links), `--series-2` (charts) | |
| `--tealSoft` | `#0d1c2b` | `--accent-wash` | |
| `--fuel` | `#E0A64B` | `--series-3` (kcal charts), `--warn` (warning text) | |
| `--ok` | `#3BB98C` | `--ok` | Same name, new value |
| `--deficit` | `#D8654F` | `--danger` | |
| `--protein` | `#A78BEA` | `--series-4` | |
| `--interview` | `#D8654F` | `--series-1` | |
| `--sp1` to `--sp7` | 4 to 48px | `--sp-1` to `--sp-7` | Same values; `--sp-8` (64px) is new |
| `--r-sm`, `--r-md`, `--r-lg`, `--r-pill` | 8, 12, 16, 999px | `--r-2`, `--r-3`, `--r-4`, `--r-pill` | `--r-1` (4px) is new |
| `--fs-micro` | 11px | `--fs-1` (14px) | Nothing a user reads is under 14px now |
| `--fs-caption` | 12px | `--fs-1` | |
| `--fs-body` | 14px | `--fs-body` (`--fs-3`, 17px) | |
| `--fs-h3` | 15px | `--fs-4` | |
| `--fs-h2` | 19px | `--fs-5` | |
| `--fs-h1` | 26px | `--fs-6` | |
| `--fs-hero` | 40px | `--fs-7` | |
| `--ease`, `--ease-standard` | `cubic-bezier(.2,.8,.2,1)` | `--ease-standard` | New curve is calmer |
| `--ease-emphasized` | `cubic-bezier(.22,.61,.36,1)` | `--ease-calm` | |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | `--ease-exit` | Same |
| `--dur-fast` | .12s | `--dur-1` | |
| `--dur` | .22s | `--dur-2` | |
| `--dur-slow` | .4s | `--dur-3` | |
| `--dur-wash` | .7s | `--dur-3` | Long washes go |
| `--stagger` | 40ms | none | Drop staggered entrances |
| `--sans` | system stack | `--font-sans` | |
| `--mono` | system mono | `--font-mono` | |
| `--disp` | SF Pro Display | `--font-sans` at `--fs-7` | One sans family |
| Hard-coded `z-index: 30, 39, 45, 60` | | `--z-sticky`, `--z-overlay`, `--z-toast` | |
| `env(safe-area-inset-*)` inline | | `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left`, `--pad-left`, `--pad-right` | |

### Mastery palette (`.asc-app`, `.rail-root`, `.tpc-root`)

| Old | Old value | New |
|---|---|---|
| `--m-new` | `#5C6678` | `--ink-3` |
| `--m-shaky` | `#D8654F` | `--danger` |
| `--m-learning` | `#E0A64B` | `--warn` |
| `--m-solid` | `#6BBF73` | `--ok` |
| `--m-mastered` | `#4FB0A5` | `--series-2` |
| `--r-8`, `--r-10`, `--r-12`, `--r-16`, `--r-999` | | `--r-2`, `--r-2`, `--r-3`, `--r-4`, `--r-pill` |
| local `--ease` | `cubic-bezier(.22,.61,.36,1)` | `--ease-calm` |

A mastery level must also be shown in text (the word or a number), not by dot color alone.

## `src/ui/tokens.ts` (`TOKENS`, used by the graph landing)

| Old | New CSS token | Notes |
|---|---|---|
| `void` | `--bg` | |
| `core` | `--accent` | |
| `hub` | `--accent-ink` | |
| `edge`, `EDGE_SOLID` | `--rule` | |
| `ring`, `RING_SOLID` | `--rule-strong` | |
| `text` | `--ink` | |
| `muted` | `--ink-2` | |
| `faint` | `--ink-3` | |

`readToken(name)` keeps working; point it at the new names. Three.js materials can't read CSS variables, so the landing must call `readToken` at mount rather than keep hex copies.

## `.pt-root` in `src/features/studytracker/studytracker.css` (Massey Standard)

| Old | Old value | New |
|---|---|---|
| `--paper` | `#14110D` | `--bg` |
| `--card` | `#211B14` | `--surface` |
| `--header` | `#0C0A07` | `--surface-2` |
| `--ink` | `#F4ECE0` | `--ink` |
| `--crest` | `#FBF3E8` | `--ink` |
| `--muted` | `#B7AB98` | `--ink-2` |
| `--accent` | `#F58A2E` | `--accent` |
| `--accent2` | `#FFB067` | `--accent-2` |
| `--accent-text` | `#FBB069` | `--accent-ink` |
| `--on-accent` | `#1A1209` | `--on-accent` |
| `--good` | `#5FBE86` | `--ok` |
| `--danger` | `#E7897B` | `--danger` |
| `--danger-border` | `#8F3B30` | `--danger` |
| `--border` | `#3A3025` | `--rule` |
| `--track` | `#2E2619` | `--track` |
| `--shadow` | two black layers | `--shadow-1` |
| `--shadow-raised` | | `--shadow-2` |
| `--shadow-overlay` | | `--shadow-3` |
| `--serif` | Iowan Old Style stack | `--font-sans` | The system has one sans; the Princeton crest carries the identity |
| `--sans` | system stack | `--font-sans` |
| `h1 { color: #fff }` | | `--ink` |
| `.eyebrow` (uppercase, tracked) | | `.m-label` |

## `.wgu-root` in `src/features/wgu/wgu.css` (WGU Roadmap)

| Old | Old value | New |
|---|---|---|
| `--bg` | `#16171a` | `--bg` |
| `--surface` | `#1d1f23` | `--surface` |
| `--surface-2` | `#23262b` | `--surface-2` |
| `--ink` | `#eae8e3` | `--ink` |
| `--ink-soft` | `#b2afa8` | `--ink-2` |
| `--ink-faint` | `#95928b` | `--ink-3` |
| `--line` | `#2c2f35` | `--rule` |
| `--line-strong` | `#3a3e45` | `--rule-strong` |
| `--accent` | `#87a2ff` | `--accent` |
| `--accent-ink` | `#9db3ff` | `--accent-ink` |
| `--accent-wash` | `#87a2ff14` | `--accent-wash` |
| `--oa`, `--oa-bg` | blue | `--series-4`, `--surface-2` | Objective assessment |
| `--cert`, `--cert-bg` | amber | `--series-3`, `--surface-2` | Certification |
| `--pa`, `--pa-bg` | green | `--series-2`, `--surface-2` | Performance assessment |
| `--cap`, `--cap-bg` | pink | `--series-1`, `--surface-2` | Capstone |
| `--shadow` | | `--shadow-1` |
| `--radius` | 14px | `--r-3` |
| `--serif` | | `--font-sans` |
| `--sans` | | `--font-sans` |
| `--mono` | | `--font-mono` |

Assessment kinds must also carry a text label ("OA", "PA"), since the series colors are for charts and don't meet 4.5:1 as text in every case (`--series-3` is 3.2:1).

## Forbidden pairs (fail AA; not used today, keep it that way)

Found by the Stage 3 review. None of these is used today, and the contrast gate only checks the pairs it lists, so treat these as off-limits:

| Text | On | Ratio | Variant |
|---|---|---|---|
| `--accent-ink` | `--sand` | 4.39 (A), 4.26 (B) | both |
| `--accent-ink` | `--peach` | 4.38 | B |
| `--ink-3` | `--sand` | 4.40 | A |

Use `--ink` or `--ink-2` on sand and peach fills. There is no input primitive yet; when one is added, add its placeholder color to the checked pairs.
