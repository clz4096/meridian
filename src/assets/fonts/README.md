# Fonts

Two families, one variable-weight file each, latin subset. Both are Adobe Source fonts under the SIL Open Font License 1.1 (full text: `LICENSE-OFL.txt`). The `@font-face` rules live in `src/styles/tokens.css`.

| File | Family | Weights | Size | SHA-256 |
|---|---|---|---:|---|
| `source-sans-3-latin-wght.woff2` | Source Sans 3 | 200 to 900 (variable) | 28,740 B | `7a19a7027e125257d310c6dbd78ae3a30b5ea1e3794d60b12bb28227a003bfda` |
| `source-code-pro-latin-wght.woff2` | Source Code Pro | 200 to 900 (variable) | 22,044 B | `8b774aaa5137a38ef40f4ac9d36db9a5eee152b2f66589dfdc82ff007fc87135` |

Total: 50,784 B (about 50 KB) in 2 files.

## Source

- https://cdn.jsdelivr.net/npm/@fontsource-variable/source-sans-3@5.3.0/files/source-sans-3-latin-wght-normal.woff2
- https://cdn.jsdelivr.net/npm/@fontsource-variable/source-code-pro@5.3.0/files/source-code-pro-latin-wght-normal.woff2
- Package license field: `OFL-1.1`. Copyright lines and license text from the upstream repos: https://github.com/adobe-fonts/source-sans and https://github.com/adobe-fonts/source-code-pro (`LICENSE.md` on the `release` branch).

The latin subset covers U+0000-00FF plus general punctuation (U+2000-206F), so `·`, `°`, `‹`, and curly quotes are included. Arrows and check marks are not; they fall back to the system font.

## Why these two

Candidates compared on the latin woff2 files from Fontsource 5.3.0:

| Family | Default figures | Small caps (smcp) in subset | Files for 400/500/600 + mono | Total |
|---|---|---|---:|---:|
| **Source Sans 3 + Source Code Pro** | tabular | no | 2 (variable) | **50 KB** |
| IBM Plex Sans + Plex Mono | tabular | no | 4 | 86 KB |
| Fira Sans + Fira Mono | proportional (tnum available) | no | 4 | 89 KB |
| Atkinson Hyperlegible + a mono | proportional | no | 3+ | 51 KB, but 400 and 700 only |

- **Legibility at 16px on iPhone:** all four distinguish `I`, `l`, and `1`. Source Sans is a humanist grotesque with open apertures. Its x-height is smaller (478/1000 vs Fira's 527), so body text is set at 17px (`--fs-3`) to match the apparent size of 16px in the others.
- **Tabular figures:** Source Sans 3 figures are tabular by default, so numbers line up even where `.m-num` is missing.
- **Small caps:** no candidate ships smcp glyphs in the Fontsource subset. `.m-label` uses `font-variant-caps: all-small-caps`, which the browser synthesizes; semibold weight and 0.06em tracking keep the synthesized caps from looking thin.
- **Weight range:** variable 200 to 900 in one file per family, so any weight costs nothing extra.
- **File size:** smallest total, fewest requests, well under the 120 KB and 4-file budget.
- **Pairing:** Source Code Pro was designed as Source Sans' companion, so x-heights (both 478) and stroke weights match in mixed lines like "p = 0.032".
