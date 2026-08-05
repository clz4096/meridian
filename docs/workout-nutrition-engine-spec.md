# Workout + Nutrition Engine — Spec

Status: **draft / agreed design**, pre-implementation.
Owner: Albert. Author of record for decisions: this doc.

Plain-language companion (the gym cheat sheet) lives as an Artifact; this is the
technical version — parameters, formulas, data model, build order.

---

## 1. Purpose & mental model

Drive one number — **bodyweight, 118 → 150 lb** — using two levers the app reads
and reports on:

- **Food** moves the scale (surplus = building material). For a hardgainer this is
  the binding constraint.
- **Lifting** decides whether the gained weight is muscle, and is progressed for
  strength.

Roles per section:

| Section | Owns | Reads |
|---|---|---|
| **Today** | The scoreboard: "118 lb · +32 to go · on pace", today's focus | Meals body data, Workout split |
| **Meals → "Food & Body"** | Weigh-in, bodyweight trend, the goal + pace, calorie/protein targets, "eat more / on pace" verdict, calorie auto-adjust | `bw` readings, meal logs |
| **Workout** | Getting stronger: strength/volume/tonnage charts, today's session. Shows current weight only as *context* | `bw` (read-only context) |

This maps to: **Meals = weight lever, Workout = strength lever, Today = scoreboard.**

---

## 2. Section reorganization

### 2.1 Bodyweight moves to "Food & Body" (Meals)

The Meal store (`MealState`, key `surplus`) already has the fields:

```ts
MealSettings { current?; goal?; maintenance?; surplus?; proteinTarget? }
```

`current`/`goal` = bodyweight current/goal (lb); `maintenance` = estimated TDEE
(kcal); `surplus` = target daily surplus (kcal); `proteinTarget` = g/day. So the
schema is already shaped for this.

Weigh-in *readings* currently live in `WorkoutState.bw` (date→lb). Decision:
**leave the data in `WorkoutState.bw` for now; the Food & Body UI reads/writes it
there** (no migration, no sync/merge churn). Optional later phase migrates
`bw` → `MealState` if we want body data fully self-contained.

### 2.2 Workout keeps strength only

Remove the bodyweight *hero + goal* from Workout. Keep a small current-weight
readout for context (strength relative to bodyweight). Bodyweight *chart* moves to
Food & Body (it's a nutrition outcome); Workout charts = strength, volume, tonnage.

---

## 3. Workout tab — UI redesign

Single scroll (chosen over tabs), top → bottom:

1. **Context strip** — current bodyweight + today's strength headline (small).
2. **Your Week strip** — 7 day cells (Mon–Sun of the current week). Each cell shows
   what was actually trained that day (Upper / Lower) or **Rest** if nothing was
   logged; **today is highlighted** and shows the *suggested* split. Derived, not a
   fixed template (see 4.6).
3. **Today's card** — heading "Today · Upper day" (suggested split) + the exercises
   for that split, ready to log. A **"Show all exercises"** toggle expands to the
   full list (current behavior).
4. **Progress charts** — the existing carousel, below the fold.

No new data model for scheduling — the week strip is pure UI over `splitOfDate`
(history) + `suggestSplit` (today). Rest days = days with no logged sets.

---

## 4. Training algorithm

### 4.1 Progression currency: estimated 1-rep-max (e1RM)

Per top set: **Epley** `e1RM = w · (1 + reps/30)`. Used as the smoothed strength
signal for compounds — progression trigger, stall detection, and the strength
chart. Isolation lifts progress on plain rep-count double progression (e1RM at
high reps is noisy).

### 4.2 Exercise classes → rep ranges

Reuse the existing `compoundMuscles` config for classification — no new list:

- **Compound** = `exerciseMeta(ex).muscle ∈ compoundMuscles`
  (chest, back, quads, hamstrings, glutes) → **top set 3–6 (strength) + back-offs
  6–12 (hypertrophy volume)**.
- **Isolation** = everything else → **8–12 reps, hypertrophy double progression**.
- **Cardio** = `isCardio(ex)` → unchanged.

Albert's list under this rule:

| Exercise | Class | Range |
|---|---|---|
| Bench Press, Lat Pulldown / Dumbbell Row, Leg Press | compound | top 3–6 + back-offs 6–12 |
| Tricep Pushdown, Bicep Curl (DB/Pulley), Hammer Curl, Wrist Curl, Rev Wrist Curl, Leg Extension, Hip Abd/Add, Calf Raise | isolation | 8–12 |
| Treadmill | cardio | — |

Config change: `repHigh`/`repsAfterBump` become **per class** (see §8).

### 4.3 Progression rule (per exercise, on the top set)

Double progression, effort-modulated:

- `reps ≥ repHigh(class)` → `weight += increment`, reset reps to
  `repsAfterBump(class)`.
- else hold weight (add reps next time).
- Increment inference unchanged (`inferIncrement`: modal jump / override).
- **Effort accelerator:** ≥ 2 consecutive **Strong** sessions on a lift, *or* a new
  e1RM high → allow a double increment (or +1 back-off set) that session.
- **Effort brake:** a **Weak** session → hold (no bump even if reps hit).

### 4.4 Effort classification — Strong / Moderate / Weak (computed, no RIR)

No self-report. Per exercise, compare actual top set to what was prescribed, via
e1RM ratio:

```
r = e1RM(actual top) / e1RM(prescribed top or prior best)
```

| r | per-exercise score |
|---|---|
| ≥ 1.00 (met/beat) | strong (1.0) |
| 0.95 – 1.00 | moderate (0.6) |
| < 0.95, or scheduled-but-skipped | weak (0.2) |

**Session label** = working-set-weighted mean of per-exercise scores (compounds
carry more sets, so they weigh more). Map: `≥ 0.85 → Strong`, `≤ 0.50 → Weak`,
else `Moderate`. Shown post-session; stored per date (reuse `WorkoutState.rpe[date]`
to cache the 0–1 score, or a new `effort` map — TBD at build). Feeds 4.3 and the
"training contribution" read on Today.

### 4.5 Stall detection (replaces the manual "Feel weak")

- **Rep/set stall (per lift):** `e1RM` non-increasing across `K = 3` consecutive
  sessions of that lift → **auto-deload** `deloadFactor` (10%), reps reset to bottom
  of range, then rebuild. Manual deload still available.
- **Missed-days stall (per split):** gap since the split's last session
  `> G_repeat (10 d)` → repeat last prescription, expect no PR. `> G_deload (21 d)`
  → deload 10% (detraining).

### 4.6 Split scheduling — flexible alternate

Keep the existing `suggestSplit` (alternate away from the most recent prior
session; cardio every day). **No fixed weekday template.** The week strip renders
`splitOfDate` for past days and `suggestSplit(today)` for today.

### 4.7 Plate calculator (barbell lifts only)

For barbell exercises, show the plates to load per side alongside the target
weight, on the exercise card and the log input.

```
perSide = (targetWeight − barWeight) / 2
plates  = greedyDecompose(perSide, availablePlates)   // per end of the bar
```

- **Equipment tag per exercise** — `barbell { bar }` | `dumbbell` | `machine` |
  `bodyweight`. Only `barbell` gets the plate hint; `machine`/`dumbbell` show the
  number as-is (stack weight / per-hand). Store in `DATA.exEquip`.
- **Defaults:** `barWeight = 45 lb` (standard Olympic bar — confirmed for Bench),
  editable per exercise. `availablePlates = [45, 35, 25, 10, 5, 2.5]` lb, editable
  per gym. Greedy from largest.
- Albert's only barbell lift today is **Bench Press** (bar 45). Everything else is
  machine/dumbbell/cardio → no plate math.
- **Display:** e.g. `135 lb → 45 bar · 1×45/side`; `185 → 45 bar · 45 + 25/side`.
- **Edge cases:** `target ≤ bar` → "empty bar"; `target` not decomposable on the
  available plates → show the closest loadable weight + a note (rare — logged
  weights should sit on the increment).

---

## 5. Food & Body algorithm

### 5.1 Bodyweight trend

Smooth the noise (±2–3 lb/day water): **linear-regression slope over the trailing
`W_bw = 14 d`** of `bw` readings; require `≥ 4` points in-window or fall back to
"not enough data". Never react to a single reading.

### 5.2 Empirical maintenance (TDEE)

Once there's enough logging, learn maintenance from the data instead of a formula:

```
TDEE ≈ mean(daily kcal over window) − (ΔBW_lb over window × 3500 / days)
```

- Window `W_tdee = 14 d`; require `≥ 10` logged meal-days in-window AND a weigh-in
  near each end, else keep the current estimate.
- **Cold start** (Mifflin–St Jeor, his stats 118 lb / 5'7" / 38 / M):
  BMR ≈ 1,414; × 1.5 activity ≈ **~2,150 kcal** seed → `MealSettings.maintenance`.
- (Context: current in-app target is 2,700 / 147 g — already ~+550/day; the loop
  will confirm or trim this against reality.)

### 5.3 Rate target ("push")

- Target **+0.8 lb/wk**, band **[0.5, 1.0]**, hard cap **1.25**.
- `surplus_target = rate × 3500 / 7` → +0.8 lb/wk ≈ **+400 kcal/day**.
- Daily calorie target = `maintenance + surplus`.

### 5.4 Calorie auto-adjust (adherence-aware)

Runs on a `cadence = 14 d` cycle, off the smoothed slope:

1. **Adherence gate.** If mean intake over the window `< 90%` of the current target
   → verdict "hit your target"; **do not raise** it. (Prevents runaway inflation.)
2. If adherence `≥ 90%` and `slope < target − 0.25` → **raise** target by
   `round((target − slope) × 3500/7)`, capped `≤ +250 kcal/adjustment`.
3. If `slope > cap (1.25)` → **trim** target by the symmetric step (throttle fat).
4. Else hold.

Auto-applies (per Albert's choice) but **logs every change visibly**
("Calories → 2,650 · weight flat 2 wks"). Writes `MealSettings.surplus` (and thus
the derived daily target). Keep an append-only adjustment log for the UI.

### 5.5 Protein target

`proteinTarget ≈ 1.0 g/lb` current bodyweight (≈ 120 → 150 g as he grows). Held
independent of the calorie loop.

---

## 6. Away / home exercise swaps

Per exercise, an optional **dumbbell alternate** for weeks without Life Time, each
with a How-to video. An **"Away" toggle** (or auto-detected from the `group`
label / gym) swaps the prescription to the alternate while carrying progress.

Video: `exVideo(ex)` already returns a curated URL or a YouTube form-search
fallback, so any new alternate name gets a working "How-to" for free; curate
specific videos over time.

Mapping (Albert's program):

| Life Time / machine | Dumbbell alternate |
|---|---|
| Lat Pulldown *(building machine broken)* | One-arm dumbbell row (or pull-ups on the bar) |
| Leg Press | Goblet squat |
| Leg Extension | Bulgarian split squat |
| Hip Abduction | Standing side leg raise (band optional) |
| Hip Adduction | Sumo goblet squat |
| Calf Raise (machine) | Standing dumbbell calf raise |
| Bench Press | Dumbbell floor press |
| Treadmill | Brisk walk / jog / jump rope |

Data model: a `DATA.exSwap: Record<exercise, altName>` map (+ optionally curated
`DATA.exVideo` entries for the alternates). Progression treats an alt as the same
lift's continuation (same increment/e1RM history) unless we decide alternates
track separately — **open question (§9)**.

---

## 7. Data model changes (summary)

Mostly reuse. New/changed:

- **Reuse:** `MealSettings.{current,goal,maintenance,surplus,proteinTarget}`,
  `WorkoutState.{bw,rpe}` — all already exist.
- **Config:** per-class `repHigh`/`repsAfterBump`; stall params `K`, `G_repeat`,
  `G_deload`; body params (`W_bw`, `W_tdee`, rate target/band/cap, adjust cadence,
  step cap, adherence gate). See §8.
- **New maps:** `DATA.exSwap` (away/home), `DATA.exEquip` (barbell/dumbbell/
  machine/bodyweight + bar weight, for the plate calculator). Optional
  `WorkoutState.effort` (date→Strong/Moderate/Weak) if we cache instead of derive.
- **New (Food & Body):** append-only calorie-adjustment log for the UI.

---

## 8. Config additions (proposed values)

Training (extends `ProgressionConfig`):

| Param | Value | Note |
|---|---|---|
| `repHigh.compound` | 6 | top set 3–6 |
| `repsAfterBump.compound` | 3 | reset after a bump |
| `repHigh.isolation` | 12 | 8–12 |
| `repsAfterBump.isolation` | 8 | |
| back-off rep range (compound) | 6–12 | hypertrophy volume |
| `deloadFactor` | 0.9 | unchanged |
| `stallK` | 3 | e1RM-flat sessions → auto-deload |
| `gapRepeatDays` | 10 | repeat, no PR |
| `gapDeloadDays` | 21 | deload on return |
| effort thresholds | strong ≥1.00, mod 0.95, weak <0.95 | per-exercise r |
| session map | Strong ≥0.85, Weak ≤0.50 | weighted mean |

Body (new block):

| Param | Value |
|---|---|
| `bwWindowDays` | 14 |
| `tdeeWindowDays` | 14 |
| `tdeeMinLoggedDays` | 10 |
| `rateTarget` (lb/wk) | 0.8 |
| `rateBand` | [0.5, 1.0] |
| `rateCap` | 1.25 |
| `adjustCadenceDays` | 14 |
| `adjustStepCapKcal` | 250 |
| `adherenceGate` | 0.90 |
| `kcalPerLb` | 3500 |
| `proteinPerLb` | 1.0 |

---

## 9. Risks, assumptions, open questions

1. **Logging cadence is the whole loop's dependency.** Empirical TDEE + auto-adjust
   need ~near-daily weigh-ins and ≥10 meal-days/window. Sparse logging → fall back
   to advisory + the cold-start estimate; never auto-adjust on thin data (the
   `tdeeMinLoggedDays`/`≥4 points` gates enforce this).
2. **3500 kcal/lb and Epley are approximations.** Empirical TDEE self-corrects the
   former over time; e1RM is a *trend* signal, not a true max.
3. **e1RM invalid for isolation / very high reps** — hence class-split ranges and
   e1RM only driving compounds.
4. **Runaway calorie target** — mitigated by the adherence gate (§5.4.1) and step
   cap.
5. **Fat vs muscle** — no bodyfat/waist input, so "push" is guarded only by the
   `rateCap` and a periodic mini-cut suggestion. Acceptable for a hardgainer;
   revisit if we add waist tracking.
6. **Open:** do away/home alternates share one progression history with the machine
   lift, or track separately? (Lean: **share** — same movement pattern, keeps
   progress continuous. Decide at build.)
7. **Open:** cache the session effort label (`WorkoutState.effort`) or derive on
   read each time? (Lean: derive; cache only if perf demands.)

---

## 10. Build sequence

Phased, each independently shippable and browser-verifiable:

1. **Workout tab redesign (UI).** Single scroll: context strip → Your Week strip →
   Today's card (split-filtered + "Show all") → charts below. Pure UI over existing
   `suggestSplit`/`splitOfDate`. Includes the **plate calculator** (§4.7) — a pure
   display hint on barbell cards. Most visible; no algorithm risk.
2. **Section move.** Bodyweight hero/goal/weigh-in → Food & Body; Workout keeps a
   context readout; bodyweight chart → Food & Body. Today gets the scoreboard line.
3. **Training algorithm core.** e1RM, per-class ranges, effort labels, auto-deload
   on stall. Extend `ProgressionConfig`; property-test the selectors as today.
4. **Food & Body algorithm.** BW-slope regression, empirical TDEE, rate target,
   adherence-aware auto-adjust + visible adjustment log.
5. **Away/home swaps.** `DATA.exSwap` + the Away toggle + curated videos.

Spec is locked for §1–8; §9 open questions resolved at their build phase.
