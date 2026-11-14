# V-Taper Coach — Design Spec

## Purpose

A personal, offline-first PWA that runs the user's 12-week V-Taper training +
nutrition plan (source: `plan.pdf`, extracted into `js/data/plan.js`). Installed
on iPhone via Safari → Add to Home Screen. Hosted free on GitHub Pages. No
backend, no accounts, no paid services, no analytics. Success = the user can
open the app in a gym with no signal, see today's exact session or meals,
log sets/weights/meals/body stats, and get correct progression/calorie/deload
guidance automatically as weeks pass — with zero data loss across reloads and
app updates.

## Source of truth: extracted plan data

The full 18-page PDF was read in full. Everything below must land in
`js/data/plan.js` as plain data (no logic):

- **Profile defaults:** 173cm / 67kg / age 29 (editable) / intermediate /
  6 days/week / lower-back-sensitive / non-veg no beef.
- **Weekly split:** Mon Push, Tue Lower A, Wed Pull, Thu Upper V-Taper,
  Fri Lower B, Sat Arms & Delts (~60 min pump day), Sun Rest.
- **Warm-up routine** (every session): 5 min bike/incline walk → McGill Big 3
  (curl-up 3×8s, side plank 2×20s/side, bird-dog 2×6/side) → ramp-up sets on
  first exercise (50%×10, 70%×5, 85%×2).
- **Per-day exercise tables**, each entry: order, name, sets×reps, rest,
  target RIR, and any notes (e.g. "chest support", "lateral burnout moved to
  Day 6"). All 6 days' full tables from the PDF, verbatim.
- **12-week block structure:**
  - Week 1: Intro — every set RIR 3.
  - Weeks 2–5: Build 1 — target RIR as listed, double progression weekly.
  - Week 6: Deload — same exercises/weights, **half the sets**, RIR 3–4.
  - Weeks 7–11: Build 2 — **+1 set** on all lateral raises, lat pulldown, and
    single-arm pulldown; **swap** incline DB press ↔ incline Smith press and
    T-bar row ↔ seal row; isolation exercises' **last set to RIR 0**.
  - Week 12: Deload + re-test — half the sets, retake photos/measurements.
  - Early-deload trigger: 2+ of {strength drop 2 sessions running, worse
    sleep, joint ache, dread of training}.
- **Double progression rule:** bottom of rep range at target RIR → add reps
  weekly → top of range at target RIR → add weight next session (+2.5kg
  dumbbell/machine, +5kg leg press/hip thrust, +1 pin cable) → reps reset
  toward bottom of range.
- **Form cues** (verbatim) for: lat pulldown, single-arm cable lateral raise,
  incline DB press (30°), chest-supported row, leg press, hip thrust, stomach
  vacuum.
- **Waist rules:** no weighted side bends/Russian twists/heavy oblique work;
  anti-movement + front-only core (dead bug, Pallof, plank, cable crunch, knee
  raise); stomach vacuum 4–5×/week.
- **Lower-back swap table:** leg press/hack squat instead of back squat, hip
  thrust/leg curl instead of deadlifts, chest-supported rows instead of
  bent-over rows; twinge protocol (drop load 20%, or swap per the table on
  p.17: hack squat→leg press, hip thrust→glute bridge machine, row→machine
  row); sharp/radiating/>1-week pain → stop and see a physio (shown as a
  static warning, not a feature).
- **Cardio rules:** 8,000–10,000 steps/day always; weeks 1–4 add 2×20min
  incline walk (8–10%, 5–5.5km/h) after Day 1 & Day 3; weeks 5–12 only the
  20min Day 6 walk.
- **Nutrition phases:** weeks 1–4 2,500kcal/140g protein/65g fat/340g carbs
  (recomp, flat-to−0.2kg/wk); weeks 5–12 2,850kcal/140g/75g/405g (lean gain,
  +0.2–0.3kg/wk). TDEE shown (BMR Mifflin-St Jeor × 1.6 ≈ 2,600kcal) for
  reference/display only, not recomputed live.
- **Lean-gain add-ons** (weeks 5+, pick one/day, ≈+250kcal, plus +1 banana
  pre-workout ≈+100kcal): banana+PB; extra roti+curd; extra rice+ghee; milk+
  almonds.
- **Full 7-day meal plan**, verbatim, every meal's items/kcal/protein, for
  Mon–Sun — **including that Sunday is a distinct flexible-day menu**, not a
  reuse of the weekday pre-workout-snack-as-evening-snack rule (that rule only
  applies Mon–Sat on rest days, which doesn't occur in this split since Sunday
  is the only rest day and has its own menu). Morning-training swap note
  (pre-workout snack moves before gym, breakfast becomes the post-workout
  meal) stored as a flag/toggle, not hardcoded into the meal data.
- **Protein-swap equivalents:** 150g chicken ≈ 150g fish ≈ 5 whole eggs ≈
  130g paneer ≈ 60g soya chunks.
- **Supplements table:** whey, creatine monohydrate (3–5g), vitamin D3
  (conditional), omega-3 (1–2g EPA+DHA) — shown as reference info only.
- **Weekly grocery list** (full table, all categories/items/quantities) +
  Sunday prep checklist (5 steps).
- **Check-in rulebook:**
  - Tracking table: what/when/how for weight, waist, shoulders, photos,
    strength, steps/sleep.
  - Per-phase targets table (recomp vs lean gain).
  - Full calorie decision table (6 rows, condition → action) — used by the
    check-in wizard.
  - Training volume rules (5 rows, condition → action).
  - V-taper ratio = shoulder ÷ waist; ~1.4 average, 1.5–1.6 = clear V-taper.
  - 12-week log table columns (week, avg weight, waist, shoulders, incline DB
    press, lat pulldown, cable lateral raise, leg press, avg steps, avg
    sleep, notes) — becomes the Progress tab's log table.

If anything above conflicts with the original prompt's phrasing, this
extraction (sourced from the PDF) wins, per the user's instruction.

## Hard constraints (unchanged from request)

Static HTML/CSS/vanilla JS (ES modules), no build step, no npm runtime deps,
relative paths only (deploys under `https://<user>.github.io/<repo>/`),
installable PWA with full offline support after first load, all data in
IndexedDB, iPhone-first (safe-area insets, dark mode default, ≥44px targets,
no horizontal scroll at 375px), no `navigator.vibrate` (use Web Audio beep +
screen flash), Wake Lock API feature-detected during workouts.

## Architecture

```
index.html, manifest.webmanifest, sw.js, tests.html
css/
icons/            (generated 180/192/512 PNG + favicon, via a one-off Node script)
js/
  data/plan.js    static plan data only, no logic
  db.js           IndexedDB wrapper: settings, sessionLogs, exerciseHistory,
                  bodyMetrics, dietLog, customFoods, checkins object stores
  week.js         pure: date+settings -> {week number 1-12, phase, is-deload,
                  is-intro, is-build2}
  progression.js  pure: exercise history -> next-session recommendation
                  (increase weight / beat-last-time target)
  nutrition.js    pure: day's meals + phase -> targets, totals, swap logic
  checkin.js      pure: 4-week averages -> calorie decision + volume-rule output
  charts.js       pure: series data -> SVG path strings (no chart library)
  timer.js        rest timer: stores end-timestamp in memory + sessionStorage,
                  recomputes remaining time from Date.now() on resume/foreground
  ui/today.js, ui/diet.js, ui/body.js, ui/progress.js, ui/settings.js
  ui/router.js    bottom tab bar, hash-based, no framework
  app.js          bootstraps db, service worker registration, first-run setup,
                  storage persistence request
```

`week.js`, `progression.js`, `nutrition.js`, `checkin.js`, `charts.js` are
pure functions with no DOM/IndexedDB access, so `tests.html` can import and
assert on them directly in-browser.

**Data flow:** `js/data/plan.js` (static) and `db.js` (user history) are the
only sources of truth. Each `ui/*.js` render function takes
`(date, settings, history)`, calls the pure functions to compute what to
display, and renders DOM. No hidden UI-layer state — the same pure functions
back both the live UI and the test page.

**Offline/PWA:** `sw.js` precaches every static file under a versioned cache
name (cache-first for app files), deletes stale caches on `activate`. Cache
version is a single constant bumped on each deploy (documented in README).
Icons generated once by a small Node script (inline SVG → PNG raster), not a
runtime dependency.

**Visual design:** dark background by default, single accent color (chosen
during the implementation/visual-design pass, not pre-specified), large
numbers, ≥44px tap targets, bottom tab bar: Today · Diet · Body · Progress ·
Settings.

## Feature-to-module mapping

1. **Setup (first launch)** → `app.js` first-run flow + `db.js` settings store.
2. **Today tab** → `ui/today.js` + `week.js` (week/phase/deload/build-2 calc)
   + `data/plan.js` (exercise tables, swaps). Rest day shows steps/mobility/
   stomach-vacuum from plan data.
3. **Workout logger** → `ui/today.js` + `db.js` (sessionLogs, exerciseHistory)
   + `progression.js` for "last time" display and quick +/- 2.5kg buttons.
4. **Double progression engine** → `progression.js`, pure function tested in
   `tests.html`.
5. **Rest timer** → `timer.js`, end-timestamp based (not tick-counted), Web
   Audio beep + full-screen flash, +15s/−15s controls, Wake Lock during
   workout.
6. **"How to do it"** → form cues from `data/plan.js` rendered inline, plus
   Google/YouTube search links (`navigator.onLine` gates a "needs internet"
   note).
7. **Exercise swap** → swap tables in `data/plan.js`; `db.js` keys exercise
   history by exercise id so swaps keep separate histories.
8. **Diet tab** → `ui/diet.js` + `nutrition.js` + `db.js` (dietLog,
   customFoods). Protein ring toward 140g, lean-gain add-on picker (weeks 5+),
   protein-swap picker, custom food quick-add.
9. **Body tab** → `ui/body.js` + `db.js` (bodyMetrics) + `charts.js` (plain
   SVG: weight 7-day rolling average, waist, shoulder:waist ratio, strength
   trend for incline DB press / lat pulldown / cable lateral raise / leg
   press).
10. **4-week check-in wizard** → `ui/progress.js` + `checkin.js` (calorie
    decision table + volume rules as pure functions) + `db.js` (checkins).
    Banner logic for due check-ins/deload weeks lives in `week.js`.
11. **Extras** → stomach vacuum timer (reuses `timer.js`), warm-up checklist
    and grocery checklist (static data + a `db.js`-backed weekly reset flag),
    12-week log table (`ui/progress.js` reading `db.js` history).
12. **Backup** → export/import JSON of all `db.js` stores; "last backup" date
    stored in settings, nudge banner if >7 days old.

## Testing

`tests.html`: a static page, no framework, that imports the pure-function
modules directly and runs in-browser assertions (pass/fail list) for:
`week.js` (week/phase boundaries, deload/build-2 detection),
`progression.js` (top-of-range detection, increment selection per equipment
type), `nutrition.js` (totals, add-on application), `checkin.js` (all 6 rows
of the calorie decision table, all 5 volume rules, V-taper ratio calc),
`charts.js` (rolling average correctness).

## Build order (commit after each)

1. Setup → Today tab → logger → timer → progression → `db.js` → offline
   shell (manifest, service worker, icons).
2. Diet tab.
3. Body tab + charts.
4. Check-in wizard + extras (stomach vacuum timer, warm-up/grocery
   checklists, 12-week log table) + backup/export-import.
5. `tests.html` + README + manual offline verification pass (local static
   server, reload persistence check, airplane-mode check with service worker
   active).

## Known gaps from the PDF

- The PDF's TDEE calculation is shown for context only; the app does not
  recompute TDEE live from live weight/age — it only applies the two fixed
  calorie phases and the check-in wizard's ± adjustments, matching the PDF's
  own "use the Part 3 rules, not the formula, to correct it" guidance.
- "Sharp pain / pain down the leg / pain lasting >1 week → see a
  physiotherapist" is shown as static text in the swap/twinge UI, not an
  interactive feature (nothing to compute).
