# Archived study data

This folder keeps study content that the app no longer shows, so nothing is lost when a plan changes. Nothing in the app imports these files. `src/features/studytracker/archive.test.ts` checks that each of the three study files still holds exactly what the app shipped before the retirement.

The three study files were retired from the UI on 2026-09-30, in favor of the Cambridge Method (`data/cambridge/`): STEP preparation, then Cambridge Part IA, and the Computer Science Tripos track.

## princeton-curriculum.json

The Massey Standard's curriculum: 14 Princeton, MIT, Yale, Harvard, and Stanford courses (proofs, algorithms, theory, and math), each with its topics, text, course link, problem sets, and target week.

- **Source:** `CURRICULUM` in the removed `src/features/studytracker/curriculum.ts`, which combined `MATH_COURSES` (`src/content/math.ts`, the 9 courses with `track: "Math"`) and `CS_COURSES` (`src/content/cs.ts`, the other 5) in the Massey order. It also fed the problem set of the week.
- **Check:** the courses equal `src/features/studytracker/curriculum.fixture.json`, the fixture that pinned `CURRICULUM` while it was live.

## math-daily.json

The Math path's 21 daily exercises (`MATH_DAILY`), each with its course, prompt, hint, answer, and source.

- **Source:** the removed `src/content/math.ts`.
- **Check:** a SHA-256 of the items, taken from the live module just before it was removed.

## princeton-theory.json

The Princeton theory group reading from the tracker's reading section: the group's home page, Theory Lunch, faculty, and 6 representative papers.

- **Source:** the removed `src/features/studytracker/princetonTheory.ts`.
- **Check:** a SHA-256, taken the same way.

## wgu-plan-2026-09.json

The WGU finish plan as it stood before 2026-09-30: all 13 remaining courses over six weeks (Sep 17 to Oct 28), with its header, Day 1 list, weeks, reasoning, progress list, caveats, footer and target date. The app now plans only the 4 enrolled courses (DECISIONS C20).

- **Source:** every export of `src/features/wgu/roadmapData.ts` (`HEADER`, `DAY1`, `WEEKS`, `WHY_ORDER`, `PROGRESS`, `CAVEATS`, `FOOTER`, `TERM_END`), serialized from the live module just before the change.
- **Check:** none in `archive.test.ts`; the file is a verbatim JSON dump of those exports. Course ticks stay in `meridian.roadmap.v1`, old codes included.

## Progress is not here

Per-course checkboxes live in the `meridian.curriculum.v1` localStorage key, mastery lives in the `meridian-theorist` store, and proof journal entries live in `meridian.proofjournal.v1` (still readable as the error log's Archived journal). The app no longer writes the first two, but never deletes them, and the Cambridge migration backs all three up (see `docs/cambridge-contract.md`, section 2).
