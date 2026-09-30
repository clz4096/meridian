# Palette decision

Two light palettes were built for the brief: a researcher's instrument (Swiss grid, hairlines, tabular figures) warmed by the palette of *Her* (cream, coral red, salmon, peach, sand). Both live in `src/styles/tokens.css` and both are viewable on `#/styleguide` with a toggle. **Variant A, Cream and Coral, wins and is the default.**

All numbers below come from `scripts/contrastCore.mjs` (the same code the test suite runs). Full pair tables: `design/contrast.md`.

## The variants

| Token | A, Cream and Coral | B, Ember | Role |
|---|---|---|---|
| `--bg` | `#FAF6F0` | `#FBEEE4` | Page |
| `--surface` | `#FFFDFA` | `#FFF8F2` | Cards |
| `--surface-2` | `#F3ECE2` | `#F5E3D5` | Wells, pressed states |
| `--ink` | `#2A211C` | `#2E1F18` | Body text |
| `--ink-2` | `#584A40` | `#5C4336` | Secondary text |
| `--ink-3` | `#6F6054` | `#6E5446` | Faint meta text |
| `--rule` | `#E7DDD0` | `#EBD6C6` | Hairlines |
| `--rule-strong` | `#9C8A7A` | `#A0806C` | Control borders |
| `--track` | `#EDE3D6` | `#F1DCCB` | Progress track |
| `--accent` | `#C8432E` | `#D2452B` | Coral fills |
| `--accent-2` | `#EE9A82` | `#F19A7C` | Salmon, decorative only |
| `--accent-ink` | `#B03A26` | `#AE3219` | Coral as text |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` | Label on coral |
| `--accent-wash` | `#FBE9E2` | `#FADCCF` | Selected row |
| `--peach` | `#F9DCC8` | `#F7CDB2` | Chips |
| `--sand` | `#E9DAC4` | `#E6CFB3` | Tags |
| `--ok` | `#2F6B3E` | `#2E6A3A` | Success |
| `--warn` | `#8A5300` | `#8A4E00` | Warning |
| `--danger` | `#A3123A` | `#9E1030` | Error |
| `--focus` | `#2C5A8C` | `#27588F` | Focus ring |
| `--series-1..5` | coral, teal, light ochre `#B58100`, indigo, walnut | coral, teal, ochre `#A88400`, indigo, plum `#8A4F8A` | Charts |

**A** reads the brief as "warm paper under diffuse light": a low-chroma cream page so the coral accent and the data carry the warmth. Its fifth chart series is a walnut neutral, which echoes the wood tones.

**B** reads the brief as "the whole room is lit peach": a pinker page, a brighter coral, and a plum fifth series for more color in charts.

Both share the one cool hue in the system, a slate blue focus ring. Focus should never look like a brand accent or an error, and blue is the one hue neither palette uses elsewhere.

## Criteria and scores

Each criterion was stated before measuring. The better value per row wins the row.

| # | Criterion | Why it matters here | A | B | Winner |
|---|---|---|---|---|---|
| 1 | AA margin: lowest text ratio over 4.5 | Headroom against rendering, OLED gamma, and future tweaks | 4.89:1 (1.09x) | 4.54:1 (1.01x) | A |
| 2 | Body text contrast, `--ink` on `--bg` | Long reading of study material | 14.64:1 | 13.92:1 | A |
| 3 | Page chroma (Lab, lower is calmer) | Hours of reading; a tinted page tires the eye and shifts every other hue | 3.4 | 7.0 | A |
| 4 | Accent vs danger, delta E (normal / deuteranopia) | A coral button must never read as an error | 23.8 / 19.4 | 22.9 / 20.5 | Tie (both well past 20) |
| 5 | Chart series, smallest pairwise delta E under simulated deuteranopia (Machado 2009) | About 1 in 16 men; charts must work without red-green | 18.0 | 6.4 (teal vs plum) | A |
| 6 | Same, protanopia | Second most common deficiency | 25.6 | 18.4 | A |
| 7 | Bright daylight proxy: contrast with 0.2 ambient flare added to both luminances, weakest text pair | Reading on a phone outdoors | 3.01 (`--on-accent` on `--accent`) | 2.90 | A |
| 8 | Warmth, fidelity to *Her* | The mood half of the brief | Warm, restrained | Warmer, more literal | B |

A wins 6 criteria, B wins 1, 1 ties.

## Decision

**A, Cream and Coral.** The brief puts the instrument first and the palette second: the page is where data is read for hours, so it should be nearly neutral, and warmth should come from the accent, the peach and sand fills, and the soft brown shadows. B is the more faithful mood board, but its peach page costs AA headroom (its primary button sits at 4.54:1, right on the line) and its plum series collapses toward teal for deuteranopes (delta E 6.4; we require 15 so thin chart lines stay apart at a glance). A keeps every text pair at least 9% over 4.5:1, every non-text pair at least 3% over 3:1, and every chart series at delta E 18 or more under both simulations.

B stays in `tokens.css` under `:root[data-palette="b"]` so it can be compared on real screens during Stage 5.

## Guard rails

- `npm run test` fails if any declared pair drops below its threshold in either variant (`src/styles/contrast.test.ts`), or if variant A's deuteranopia series separation drops below 15.
- `node scripts/contrast.mjs` prints the full table and rewrites `design/contrast.md`.
- New text-on-background combinations must be added to `PAIRS` in `scripts/contrastCore.mjs` before use.
