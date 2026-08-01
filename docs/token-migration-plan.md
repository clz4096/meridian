# Token migration plan — adopting the canonical palette app-wide

The canonical Meridian palette now lives in **one source of truth**: the `:root` custom
properties in `index.html` (mirrored, typed, in `meridian-ts/src/tokens.ts`).

```
--void #070B14   --core #BFE9FF   --hub #F2B25C (lone warm accent, used sparingly)
--edge rgba(120,170,220,.18)   --ring rgba(150,200,255,.28)
--text #DCE6F2   --muted #8FA3BE   --faint #5C7291
```

The **graph landing already consumes these**. The rest of the app still uses its existing
surface/accent variables (`--bg #0E1116`, `--surface-1/2/3`, `--teal`, `--fuel`, `--ok`, …).
This doc is the plan to migrate the app onto the canonical palette **incrementally, one
reviewed step at a time** — not a big-bang restyle.

## Guiding rules
- `--hub` amber is the *only* warm accent — reserve it for active states and primary CTAs.
  Everything structural stays cool. Today the app uses `--fuel` (amber) and `--teal` fairly
  liberally in charts/toggles; the migration tightens that.
- Change values behind existing variable *names* where possible so components don't churn.
- Verify light **and** dark parity and WCAG contrast (4.5:1 text / 3:1 large) after each step.

## Proposed order (each step = its own PR, my review + commit)
1. **Foundations already shared** — `--text`/`--muted` are already the canonical values;
   `tokens.ts` is the typed mirror. No visual change. (done as part of the landing work.)
2. **Deep field** — point the app background at `--void` (`--bg → #070B14`, or alias
   `--bg: var(--void)`). Re-check surface elevation steps (`--surface-1/2/3`) read correctly
   against the darker base.
3. **Cool primary** — introduce `--core` as the primary cool accent for non-warm affordances
   (links, selected states, primary chart series that aren't "the one thing"), replacing ad-hoc
   `--teal` usage.
4. **Warm restraint** — audit every `--fuel`/`--hub` use; keep amber only on active toggles and
   primary CTAs (e.g. the `.seg .on`, `.cta-log`), demote the rest to `--core`/neutral.
5. **Web/rings in-app** — adopt `--edge`/`--ring` for any in-app hairline/graph accents so the
   app and the landing share one visual language.
6. **Semantic colors** — keep `--ok`/`--deficit` reserved for good/bad; verify they still read
   as semantic (not decorative) against the new field.

## Non-goals for this task
- No app-wide restyle now. Only the landing consumes the new tokens; the steps above land later,
  individually, with approval.
