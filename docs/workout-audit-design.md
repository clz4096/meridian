# Workout section: audit and redesign

Status: design for owner review, 2026-10-21. Nothing is built yet.

This document has four parts:

1. Glossary of every term the app uses.
2. Audit of what the Workout section does today, replayed against your real logs.
3. Design of the new section, with each rule and the reason for it.
4. Build plan and the decisions only you can make.

Your exercise list stays the same. Only how each lift is prescribed, tracked, judged, and explained changes.

## 1. Glossary

| Term | What it means | Example |
|---|---|---|
| Set | One unbroken run of reps. | 125 lb for 5 reps is one set. |
| Rep | One full movement, down and up. | |
| Working set | A set hard enough to make you stronger. Warm-ups are not working sets. | |
| Warm-up set | A light set that gets your muscles and joints ready. It should feel easy. | 65 lb × 5 before benching 125. |
| Top set | Your single heaviest working set of the day for a lift. | |
| Back-off set | A slightly lighter working set done after the top set. It adds practice and growth without the strain of another top set. | 115 × 7 after a top set of 125 × 5. |
| Rep range | The low and high rep counts the app aims for, such as 5 to 8. | |
| RIR (reps in reserve) | How many more reps you could have done when you stopped. RIR 2 means you had 2 left. | |
| Failure | RIR 0: you could not do another rep with good form. | |
| e1RM (estimated one-rep max) | The heaviest weight you could probably lift once, worked out from a set of several reps. It lets you compare 125 × 5 with 135 × 3. | 125 × 5 ≈ 146 lb. |
| True level | What the app thinks you can really do right now: your recent e1RM, smoothed so one good or bad day does not swing it. | |
| Double progression | Keep the weight the same and add reps until you reach the top of the rep range, then add weight and start again at the bottom. | 100 × 8, 9, 10, 11, 12, then 105 × 8. |
| Increment | The smallest weight step a machine or bar allows. | One plate on a stack, or 5 lb on a barbell. |
| Plateau or stall | Several sessions in a row with no gain in reps or weight. | |
| Regression | Getting weaker: your e1RM is falling, not just flat. | |
| Reset | Dropping one lift's weight by about 10% and climbing back up. It fixes one stuck lift. | |
| Deload | A planned easy week for the whole body: half the sets, a little less weight, more reps left in the tank. It clears built-up tiredness. | |
| Volume | How much work a muscle gets, counted as hard sets per week. | |
| Surplus | Eating more calories than you burn, which you need to gain weight. | |

## 2. Audit: what happens today

The audit agent ran the app's own code on your synced log from 2026-09-01 to 2026-10-19.

### The headline

The app's signals do not track whether you are getting stronger.

- **"Strong" means you followed the plan, not that you improved.** Bench stayed flat for 9 weeks (e1RM between 145 and 153), yet most of those days graded Strong.
- **"Weak" weeks come from attendance.** Every week since 2026-09-28 graded Weak (0.46, 0.42, 0.54), but on the lifts you actually did, execution scored 0.9 to 1.0.
- **Deloads fire on the wrong things.** The app deloaded 8 times in 7 weeks. Each time it was because you repeated the exact same numbers, not because you got weaker. When you really did get weaker (Leg Press e1RM fell 163, 148, 144, 136), the app kept showing "↑ +5".

### Defects, most damaging first

1. **Getting weaker never triggers help.** The stall rule only counts a perfectly flat run. Any drop is read as "recovering". A second rule switches deloads off whenever you are below your best. A lift on the way down therefore shows an up arrow.
2. **The day's plan includes every lift you have ever logged for that half.** Lat Pulldown is listed on every upper day, so it scored 0 on 14 of 17 upper days. One calf set on an upper day turns it into a mixed day, and the whole lower half averages in as zeros.
3. **Reps never move forward.** When the app holds your weight, it asks you to repeat last time's reps exactly, not beat them by one. After a deload it resets reps to 8 and keeps asking for 8. Repeating 8 trips the stall rule, which deloads again. Calves, curls and triceps have been stuck in this loop: calf went from 200 × 10 to 200 × 8 and stayed there.
4. **Going under the target can still grade Strong.** Load counts as met at 97% of target, and reps above the target earn nothing extra. On 2026-09-06 you benched 125 against a 140 target and still scored 0.90.
5. **Your heaviest set is often labeled a warm-up.** The app labels sets by their position in the list, not by what you lifted. Your third warm-up became heavy (125 × 6), so the app learned it as a "warm-up" and now prescribes it. Warm-ups are excluded from every chart and grade. On 5 days your "warm-up" beat your top set: on 2026-09-24, warm-up 125 × 7 (e1RM 154) against top set 135 × 3 (e1RM 148.5).
6. **No true level is shown.** The Strength chart plots your heaviest top-set weight, ignoring reps. So 125 × 5 (e1RM 146) looks weaker than 135 × 3 (e1RM 148.5) even though they are about the same. e1RM is computed but never displayed.
7. **Leg Extension is treated as a big compound lift** because it works the quads. It gets 3 to 6 rep prescriptions, which the research does not support for a single-joint machine.
8. **The Leg Extension stack is wrong.** The app assumes 15 lb plates (180, 195, 210), but the Life Time Hoist has 20 lb plates (145, 165, 185), which is what your logs show. The app prescribed weights the machine cannot be set to, and those days graded Weak.
9. **Past grades change when the rules change.** Every grade is recomputed with today's rules each time you open the app, so any rule change rewrites September.
10. **The app cannot tell a hard set from an easy one.** No effort rating (RIR) is recorded, and 23 of 105 sessions match the prefilled numbers exactly, which suggests you sometimes tap through without editing. No term is explained anywhere in the app.

### Data quality issues in your log

- 0-rep sets: Bicep DB 2026-07-05, Bench warm-ups 2026-07-12 and 2026-07-14.
- A back-off beat the top set at the same weight on 2026-10-15: Bench 125 × 3 then 125 × 6, and Tricep 35 × 8 then 35 × 10. One of those numbers is probably mistyped.
- Bicep Curl (Dumbbell) is often logged as a warm-up only (6 days), so those sessions grade 0.
- Location labels ("Apartment" and "Life Time") are copied from old sets, not recorded per session.

### The cause outside the app

Bodyweight is 118 to 124 lb since July, and food logs average about 1,220 calories a day over the last 30 days against a 2,700 target. Either logging is incomplete or you are in a real deficit. A deficit alone is enough to stall every lift. The new design reports this alongside your lifts instead of hiding it.

## 3. Design

Each rule below cites where it comes from. **Evidence** means studies or position stands. **Common practice** means most good apps do it this way. **Judgment** means no study covers it, so the number is a sensible default you can change.

### 3.0 How your sessions actually run

The app assumes 2 upper days and 2 lower days a week. You actually train **full body in one trip with two stops**:

| Stop | Lifts, in your usual order |
|---|---|
| Home gym (downstairs) | Bench Press, Tricep Pushdown (Rope), Bicep Curl (Pulley) (sometimes alternated with pushdowns), Bicep Curl (Dumbbell) |
| Life Time | Treadmill, then Calf Raise, Leg Extension, Hip Abduction, Hip Adduction, Leg Press in whatever order the machines allow, then Lat Pulldown |

Since 2026-09-01: 14 sessions with both stops, 5 home only, 6 Life Time only, 2 to 5 sessions a week.

This explains several audit findings. Calf and Bench appear on the same day because that is a normal full-body session, not a "mixed day". Leg Press (4 of 25 sessions) and Lat Pulldown (3 of 25) are the two lifts done **last**, so they are the ones that get dropped when time or energy runs out.

Design changes:

- **One full-body session with two blocks**, Home and Life Time, replacing the upper and lower split. The week target becomes sessions per week instead of 2 + 2.
- **Each lift belongs to one gym and one machine**, so the location label is fixed per lift instead of copied from old sets.
- **Life Time order is free.** The app lists the Life Time block but lets you do it in any order. Order never affects grades.
- **A session with only one stop** is graded on that stop's lifts. Skipping the other stop is shown as "Home only" or "Life Time only", not scored as zeros.
- **Suggested Life Time order** (a suggestion; the app does not enforce it): Lat Pulldown and Leg Press first, because they are your biggest muscles and the lifts you skip most. Then Leg Extension, Calf Raise and the hip machines. Treadmill last.
- **Treadmill:** 15 minutes, done last. You average 33 minutes (median 29 since September) at about 1.8 miles, and it is done before legs, which tires them before your lifts. A 120 lb person walking 1.8 miles burns roughly 100 to 150 calories, which is a small cost, so the main reason to move it is fresher legs.

### 3.0a The weekly routine (agreed 2026-10-21)

**4 trips a week: Sunday, Monday, Wednesday, Thursday,** alternating Day A and Day B (A, B, A, B). Everything is clear of the Sabbath (Friday sundown to Saturday sundown). Target: about 2 hours per trip, including the 30 minutes of walking, down from about 3 hours.

| | Day A | Day B |
|---|---|---|
| Bench Press | Heavy: top set 5 to 8, then 2 back-offs | Light: 3 sets of 8 to 10, 2 to 3 reps left |
| Treadmill | Jog intervals (3.0c) | Incline walk |
| Everything else | Same on both days | Same on both days |

**Home gym (about 35 minutes)**

| Lift | Sets |
|---|---|
| Bench Press | Day A or Day B above, with warm-ups |
| Superset: Tricep Pushdown (Rope) + Bicep Curl (Pulley) | 3 rounds |
| Bicep Curl (Dumbbell) | 1 to 2 sets |

A **superset** means one set of each lift back to back, then one rest, repeated. It saves about 10 minutes and you already do it.

**Life Time (about 55 minutes).** Any order the machines allow; Lat Pulldown and Leg Press first when possible.

| Lift | Sets |
|---|---|
| Lat Pulldown | 1 light set, then 3 × 8 to 12 |
| Leg Press | 2 warm-ups, then top set 8 to 12, plus 2 back-offs |
| Leg Extension | 1 light set, then 2 to 3 × 8 to 14 with a 2-second hold |
| Calf Raise (Machine) | 3 × 10 to 15 |
| Superset: Hip Abduction + Hip Adduction | 2 rounds of 12 to 20 |
| Treadmill | Last; see 3.0c |

**Rest:** 2 to 3 minutes for Bench and Leg Press, 60 to 90 seconds for everything else.

### 3.0b Warm-up and light-day weights, explained

A percentage means **a share of today's top-set weight**. The app always shows the actual pounds, rounded to real plates, with a one-line reason; you never calculate anything. Worked example with a 125 lb top set:

| Set | Percent | Math | Shown in the app | Why |
|---|---|---|---|---|
| Warm-up 1 | empty bar | 45 | 45 × 5 | Practice the movement |
| Warm-up 2 | 50% | 125 × 0.5 = 62.5 | 65 × 5 | Very easy, warms the muscles |
| Warm-up 3 | 70% | 125 × 0.7 = 87.5 | 85 × 3 | Light |
| Warm-up 4 | 85% | 125 × 0.85 = 106 | 105 × 1 | Feel the weight without tiring |
| Top set | 100% | 125 | 125 × 5 to 8 | The one hard set |
| Back-offs | 90% | 125 × 0.9 = 112.5 | 110 × 2 sets | Extra work, a little lighter |
| Day B sets | 85% | 125 × 0.85 = 106 | 105 × 8 to 10, 3 sets | Practice and growth without heavy strain |

Each prescribed set shows a line like "Warm-up 2: 65 lb × 5 (about half your top set: easy)". Tapping it opens the glossary. When the top set goes up, every other weight follows automatically.

### 3.0c Cardio: walking plus a jog progression

Your current routine is good: 5 minutes at 2.5 mph and 4% incline to warm up, then 3.5 mph at 6% incline. That is a brisk incline walk, which counts as moderate cardio. It stays as the **Day B** treadmill session.

**Day A** adds jogging, because no other part of your training builds running fitness. Moderate cardio barely slows muscle gain.

- **Warm-up:** your usual 5 minutes at 2.5 mph, 4% incline.
- **Intervals:** jog at about 4.5 to 5.0 mph, 1% incline. Walk breaks at 3.5 mph, 1% incline.
- **Pace check:** you should be able to talk in short sentences. If you can't, slow down.

| Stage | Jogs | Walk between each jog |
|---|---|---|
| 1 | 6 jogs of 1 min | 1 min |
| 2 | 6 jogs of 1.5 min | 1 min |
| 3 | 5 jogs of 2 min | 1 min |
| 4 | 4 jogs of 3 min | 1 min |
| 5 | Jog 5 to 15 min continuous | |

Move to the next stage after two comfortable sessions at the current one; repeat a stage as often as needed. Add about 100 calories on jog days.

**Fitness signal:** total jog minutes per session, and, once you jog continuously, the speed you hold for 10 minutes. Both are shown as a trend, the same way lifts show true level.

### 3.0c-2 Norwegian 4x4 (owner, 2026-10-26; replaces the jog stages above)

Every treadmill session uses the 4x4 layout (Helgerud et al. 2007): 4-minute blocks with a 3-minute recovery walk between them.

- **Hard day (bench Day B), about 38 min, the real 4x4:** 10 min warm-up (5 at 2.5 mph, 4%, then 5 at 3.5 mph, 4%), 4 blocks held at 85 to 95% of max heart rate, 3 recovery walks (3.0 mph, 1%, falling to about 70%), 3 min cool-down (2.5 mph, 0%). Until a full 4-minute jog, the walk minutes inside each block are steep (3.5 mph, 10%, up to 15%) so heart rate stays in the hard zone. Do it after the leg machines.
- **Easy day (bench Day A), about 26 min:** warm-up, 3 blocks one stage easier (never below stage 1), 2 recovery walks, cool-down. Every session jogs; easy means a slower jog at full-sentence effort.
- **Inside each block** (jog 4.5 mph at 1%; walk 3.5 mph, 10% on hard days and 1% on easy days): stage 1 is jog 1, walk 1, jog 1, walk 1; stage 2 is jog 2, walk 1, jog 1; stage 3 is jog 3, walk 1; stage 4 is a full 4-minute jog; each stage after that adds 0.2 mph.
- **Moving up:** two hard days with all 4 blocks finished at a stage. A short hard day repeats it.
- **Heart rate at 38** (max 211 - 0.64 x age, Nes et al. 2013, about 187): easy 112 to 140 bpm, hard 159 to 178 bpm on every hard day, recovery about 131. The Oura average and peak are optional fields.
- **Logged** as segments plus the session's kind, stage, blocks finished and heart rate. "Log a different session" keeps the three-block entry for anything else.

### 3.0d Treadmill logging

Today the treadmill logs only total minutes and miles. That cannot tell a 2.5 mph flat walk from a 6% incline walk or a jog.

**New logging: three blocks.** A session is entered the way you run it, in three blocks. Each block has minutes, with its speed (mph) and incline (%) tucked under a tap-to-change line.

1. **Warm-up:** 5 min at 2.5 mph, 4%.
2. **Jogs:** how many jogs, minutes per jog, and the walk break between each. Six jogs means five walk breaks.
3. **Incline walk:** minutes at 3.5 mph, 6%. Day A starts this at 0; Day B starts it at 10.

- **Machine check:** an optional box for the total time on the treadmill screen. If the blocks don't add up to it, the app says so before you log. (The first version was a free list of segments with presets; on 2026-10-21 it saved an unedited pre-fill as 31 minutes for a 17-minute session.)
- **Set any block to 0** to skip it.
- **Distance is calculated** as speed × time, so you no longer type miles.
- **Calories are estimated** with the standard ACSM walking and running equations, which account for your bodyweight, speed and incline. Example: 5 minutes of warm-up plus 10 minutes at 3.5 mph and 6% is about 80 calories at 120 lb. The estimate feeds the bodyweight and food panel (3.9).
- **Old entries** keep their total minutes and miles and show as a single segment.

### 3.1 Rep ranges per lift

| Lift | Range | Why |
|---|---|---|
| Bench Press | 5 to 8 | Your strength goal lift. Heavier sets build strength best, and 5+ reps still builds muscle (evidence). |
| Lat Pulldown | 8 to 12 | A big muscle group, but a machine. Moderate reps grow muscle as well as heavy ones and are easier on joints (evidence). |
| Leg Press | 8 to 12 | Same reason. |
| Leg Extension | 8 to 14, with a 2-second hold at the top | A single-joint machine. Coaches favor higher reps to protect the knee (common practice). The wider range fits the 20 lb plates: 145 × 12 has about the same estimated max as 165 × 7, so reaching 14 at one plate means you can do about 8 at the next. The hold starts on a recorded date so the trend line does not read the rep drop as weakness. |
| Tricep Pushdown, both curls | 10 to 15 | Small muscles, single joint. |
| Calf Raise | 10 to 15 | |
| Hip Abduction, Hip Adduction | 12 to 20 | Kept for hip health. Higher reps suit mobility work. |

New ranges start on the switch date. Sessions before that keep the old rules, so past grades do not change.

### 3.2 Warm-ups: a fixed recipe, not learned from history

For Bench and Leg Press: 50% × 5, 70% × 3, 85% × 1 of the day's top-set weight. Every warm-up should feel easy, with no grinding. Isolation lifts get one light set at about 50%.

Why: a light-only warm-up underprepares you, but a heavy one (like 125 × 6 before 135) tires you out before the top set (evidence for the first part, judgment for the second). The app stops learning warm-up weights from your history, because that is how 125 × 6 became a "warm-up".

### 3.3 Effort: a one-tap rating on each working set

After each working set, tap how many reps you had left: **0, 1, 2, 3, 4+**. It takes one tap and you can skip it.

Why: this is the only way the app can tell a grinding 3 from an easy 3. Every serious app records it (common practice). Research shows people underestimate their reps left by about 1, and the app accounts for that (evidence).

Target: stop at 1 to 2 reps left on working sets. Going to failure adds little growth and costs recovery (evidence).

### 3.4 Progression: double progression with a +1 rep goal

Each session, every lift gets one of three instructions, always with a reason line:

1. **Add weight.** You reached the top of the range with 1 or more reps left. Next time: one increment up, start at the bottom of the range.
   - "Last time 125 × 8 with 2 left. Now 130 × 5."
2. **Beat your reps.** Same weight, aim for one more rep than last time.
   - "Last time 125 × 6. Aim for 7."
3. **Reset.** See 3.6.

This fixes the stuck loop: the target always moves forward by one rep, never repeats. Rep counts for back-offs follow the same rule.

For lifts where one increment is a big jump (dumbbells, light cable weights), the app asks for extra reps above the range before adding weight, so you never jump more than about 10% at once (common practice).

### 3.5 True level: the number that answers "am I getting stronger?"

- **How it is computed:** for each session, take the best e1RM from any working-weight set of 10 reps or fewer, whatever its label. This means your real heaviest set always counts. Your true level is the middle value of your last 3 sessions, so one great or bad day cannot move it much.
- **Formula:** Epley, weight × (1 + reps ÷ 30). It is reliable up to about 10 reps (evidence).
- **High-rep lifts** (hip machines, sets over 10 reps): no e1RM. Instead the app shows "best reps at this weight", which is more honest.
- **What you see on each lift card:**
  - "Level 146 lb, up 3 lb in 4 weeks", with a small trend line.
  - Rep records: your best weight at each rep count (best 5, best 8 and so on). These keep improving even when the top weight is stuck, which shows progress you would otherwise miss.
- **Bench goal tracker:** level against the 150 lb goal, plus level per pound of bodyweight. While you are bulking, rising bodyweight can hide a stall, so both numbers matter.

### 3.6 Stalls, regression, resets and deloads

Each rule is judgment: no study gives an exact number, so these are sensible defaults you can change.

| Situation | What the app sees | What it does |
|---|---|---|
| Normal | True level flat or rising, reps creeping up | Keep going. |
| Stall | 3 sessions in a row with no gain in weight or reps at similar effort | Retry once with a "beat 1 rep" target. If it still does not move, reset. |
| Regression | True level down 5% or more across 2 sessions | Flag it right away. Do not show an up arrow. |
| Reset (one lift) | A stall that survived a retry | Drop that lift about 10% and climb back with double progression. |
| Deload (whole body) | 3 or more lifts stalled or regressing at once, or 6 to 8 weeks of hard training | One easy week: half the sets, about 90% of the weight, 3 to 4 reps left. |

**Food and bodyweight check first.** Before calling a stall or regression real, the app checks your 7-day average bodyweight and calories. If weight is falling or you are well under your calorie target, it says "Probably food, not training: eat to target before changing anything" instead of cutting your weights. Deloading would not fix that.

Your "Feel weak" button stays. It now explains itself: one easier session, no change to your plan.

### 3.7 Grades: two separate questions

The single grade is replaced by two signals, because "followed the plan" and "got stronger" are different questions.

1. **Plan followed (this session).** Did you do the sets you planned, at the planned weight? Only lifts on today's actual list count. A lift you never planned does not count against you.
2. **Getting stronger (per lift and per week).** Is your true level rising, flat, or falling over the last 4 weeks? Shown as ↑, →, ↓ with the number.

The week view shows sessions done out of 4, plus how many lifts are rising, flat and falling.

**Grades are frozen.** When you finish a session, the app saves what it prescribed that day. Later grades compare against that saved plan, so rule changes never rewrite history.

### 3.8 Weekly volume per muscle

A bar per muscle: hard sets this week against the 10 to 20 target (evidence). A set counts for the muscle it targets, and half a set for a helper muscle (bench counts half for triceps), so you see the real picture.

With your current lift list, back gets only Lat Pulldown. The bar will show back is low, and you can decide whether to add a dumbbell row later.

### 3.9 Bodyweight and food panel

On the Workout tab: your 7-day average bodyweight, its trend in lb per week, and the target of +0.3 to +0.6 lb per week (evidence: 0.25 to 0.5% of bodyweight per week for a lean bulk). If the trend stays under +0.2 lb per week for 2 weeks, the app suggests adding about 200 calories a day.

### 3.10 Learning built in

- **"Why this number" line** under every prescription (common practice: the best apps do this). Example: "Hold 125: last time 6 reps, target 7."
- **Tap any term** (top set, RIR, e1RM, deload) to see its glossary entry from section 1.
- **A short "How it works" page** explaining the cycle: warm up, top set, back-offs, add reps, add weight, reset when stuck.

## 4. Build plan

Each phase ships separately, with tests and your approval before every commit.

| Phase | What | Size |
|---|---|---|
| 0. Routine and cardio | Full-body session with Home and Life Time blocks, A/B days on Sun, Mon, Wed, Thu, fixed location per lift, Leg Extension on 20 lb plates, three-block treadmill logging with a machine-time check and the jog progression | Medium |
| 1. Fix the rules | Rep ranges by lift (dated so history is untouched), Leg Extension as isolation, the +1 rep progression, warm-up recipe, today-only plan list, the new stall, regression and reset logic | Medium |
| 2. Show the truth | True level and trend on each card, rep records, bench goal tracker, e1RM chart replacing the max-weight chart, "why this number" lines, glossary taps | Medium |
| 3. Better inputs | One-tap RIR, heaviest set auto-counted whatever its label, weekly volume bars, bodyweight and food panel | Medium |
| 4. Honest grades | Two-signal grades, saved plan per session so grades never rewrite | Medium |

### Decisions only you can make

1. **Leg Extension stack.** Your logs (105, 125, 145, 165, 185, 205) show 20 lb plates, not the 15 lb stack the app assumes. What are the lowest and highest numbers printed on the stack?
2. **The 2026-10-15 sets.** Bench 125 × 3 then 125 × 6, and Tricep 35 × 8 then 35 × 10. Were the top sets mistyped?
3. **Rating each set.** One tap per working set, optional. Is that acceptable, or too much friction?
4. **Rep ranges.** Are the ranges in 3.1 acceptable, especially 12 to 20 on the hip machines?
5. **Bench frequency.** Decided: heavy on Day A, light on Day B (twice each a week).
6. **Build order.** Start with Phase 0 (routine and cardio), then Phase 1?

## Sources

- Rep ranges across loads: Lopez et al. 2021 network meta-analysis, https://jyx.jyu.fi/handle/123456789/75929
- Training to failure: Refalo et al. 2023, https://sportrxiv.org/index.php/server/preprint/view/67
- RIR accuracy: Halperin et al. 2022, https://openrepository.aut.ac.nz/items/efef3b25-6701-4fb5-bb82-55fcd2a26027/full
- e1RM accuracy up to 10 reps: Reynolds et al. 2006, https://www.unm.edu/~rrobergs/478RMStrengthPrediction.pdf
- Deload consensus: Bell et al. 2023, https://pmc.ncbi.nlm.nih.gov/articles/PMC10511399/
- Weekly volume: https://www.strongerbyscience.com/?p=56687 and Pelland et al. 2024, https://sportrxiv.org/index.php/server/preprint/view/537
- Warm-ups: Ribeiro et al. 2020, https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/
- Lean bulk rate: Iraki, Helms et al. 2019, https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/
- Frequency: https://pmc.ncbi.nlm.nih.gov/articles/PMC6724585
- Reset after repeated misses: https://startingstrength.com/article/the-reset-why-and-how and StrongLifts, https://support.stronglifts.com/article/71-increments
- "Why this number" explanations: MacroFactor, https://help.macrofactorapp.com/en/articles/373-why-does-the-app-sometimes-recommend-lowering-weight-or-reps
- RIR glossary: Alpha Progression, https://alphaprogression.com/en/glossary/reps-in-reserve
- Rep records per rep count: Boostcamp, https://www.boostcamp.app/features/personal-records
- e1RM limits shown to users: Strong, https://help.strongapp.io/article/133-1rm
