# V-Taper Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build V-Taper Coach, an offline-first installable PWA (vanilla HTML/CSS/JS, no build step, no backend) that runs the user's 12-week V-Taper training + nutrition plan, logs workouts/diet/body metrics to IndexedDB, computes progression/phase/check-in guidance with pure functions, and deploys as static files to GitHub Pages.

**Architecture:** Two sources of truth — a static data module (`js/data/plan.js`) and an IndexedDB wrapper (`js/db.js`) — feed a set of pure calculation modules (`week.js`, `progression.js`, `nutrition.js`, `checkin.js`, `charts.js`, `timer.js`), which five tab UI modules render into a hash-routed, no-framework DOM shell. A versioned service worker precaches everything for full offline use.

**Tech Stack:** Plain HTML + CSS + vanilla JS ES modules. IndexedDB (native). Web Audio API, Screen Wake Lock API (feature-detected). No npm runtime dependencies; a one-off Node script generates icon PNGs at dev time only.

**Spec:** `docs/superpowers/specs/2026-11-14-v-taper-coach-design.md` (and its companion source extract `docs/superpowers/specs/plan-source-extract.txt`, the verbatim PDF text to transcribe into `js/data/plan.js`). Executors must read both.

## Global Constraints

- No build step, no npm runtime dependencies, no frameworks. Plain ES modules loaded via `<script type="module">`.
- All paths relative (app will be served from a GitHub Pages subpath, not domain root).
- All persistent data in IndexedDB only (no localStorage for app data; sessionStorage is allowed only for the ephemeral rest-timer end-timestamp, which is fine to lose on tab close).
- iOS Safari target: no `navigator.vibrate`; use Web Audio beep + full-screen visual flash for alerts. Feature-detect `navigator.wakeLock` before use — never assume it exists.
- Respect safe-area insets (`env(safe-area-inset-*)`), dark mode by default, minimum 44×44px tap targets, no horizontal scroll at 375px viewport width.
- Rest timer correctness after backgrounding: always compute remaining time from a stored absolute end timestamp (`Date.now()` arithmetic), never by counting elapsed ticks.
- Default profile values per the spec: height 173cm, weight 67kg, age 29 (editable), units metric (editable to imperial).
- Service worker cache name must be versioned (e.g. `vtaper-coach-v1`) and bump on every deploy; `activate` must delete caches that don't match the current version.
- Every working day in the plan has side-delt work targeting 4×/week and lat work 2×/week per the spec — this is a property of the transcribed data, not something to compute; it's listed here so a later reviewer checking `plan.js` has the invariant to check against.

## Review Focus

- **Plan runs past week 12** (user opens the app in week 13+): the spec says to start a new 12-week block, so `week.js` must return a distinct "plan complete" state rather than crashing or silently clamping to week 12's phase. Covered in Task 3.
- **"How to do it" links must stay tappable while offline-looking**: the Google/YouTube buttons are cosmetic-gated by `navigator.onLine` (show a "needs internet" note) but must remain real, clickable links regardless of that flag's value — a stale or wrongly-computed `onLine` reading must never disable the buttons themselves. Covered in Task 15.
- **Rest timer across app backgrounding**: iOS suspends tab JS timers, so resuming after the full rest duration has elapsed must show 0 remaining (not a timer that silently paused and resumes mid-count). Covered in Task 8.
- **Backup export/import must be a complete round trip**: every IndexedDB store existing at the time of export must come back identically after import into a fresh database — a store added later and forgotten in the export/import code is the realistic failure. Covered in Task 21.
- **Double progression only fires on a fully-clean top-of-range session**: if some working sets of an exercise hit the top of the rep range at target RIR but even one working set did not, the engine must return "beat last time," never "increase weight." Covered in Task 4.

---

## File Structure

```
index.html
manifest.webmanifest
sw.js
tests.html
css/styles.css
icons/                      (generated PNGs, committed; generator script is dev-only)
scripts/generate-icons.js   (Node, dev-time only, not loaded by the app)
js/
  data/plan.js
  db.js
  week.js
  progression.js
  nutrition.js
  checkin.js
  charts.js
  timer.js
  app.js
  ui/router.js
  ui/settings.js
  ui/today.js
  ui/diet.js
  ui/body.js
  ui/progress.js
README.md
```

## Build order / commit points

Tasks 1–11 (core: data, storage, today/logger/timer/progression, offline shell) → commit.
Task 12 (diet) → commit.
Task 13 (body + charts) → commit.
Tasks 14–16 (check-in wizard, extras, backup) → commit.
Tasks 17–19 (tests, README, manual offline verification) → commit.

---

### Task 1: Plan data module

**Files:**

- Create: `js/data/plan.js`
- Test: `tests.html` (inline assertions, see Step 2)

**Interfaces:**

- Consumes: nothing.
- Produces (consumed by `week.js`, `progression.js`, `nutrition.js`, `checkin.js`, UI tabs):
  - `export const DAY_ORDER = ['mon','tue','wed','thu','fri','sat','sun']`
  - `export const DAYS` — object keyed by day code, each value:
    `{ key, label, focus, isRestDay, warmup: string[], exercises: PlanExercise[], restDayInfo?: { steps: string, mobility: string } }`
    where `PlanExercise = { id, order, name, sets, repsLow, repsHigh, rest, rir: string, notes, incrementType: 'dumbbell'|'machine'|'legpress'|'hipthrust'|'cable', cue?: string, swaps?: string[] }`. `id` is a stable kebab-case slug (e.g. `incline-db-press`) reused as the IndexedDB key for exercise history — reuse the same `id` for an exercise and its Build-2 swap partner where the spec says they swap in place (incline DB press ↔ incline Smith press; T-bar row ↔ seal row) is NOT done — give each its own id and let `progression.js`/history track them separately, since the UI task (Task 7) looks up by whichever id is active for the current week.
  - `export const WARMUP_STEPS` — the 3 generic warm-up steps (bike/walk, McGill Big 3, ramp-up sets), shared text shown on every training day.
  - `export const BLOCK_STRUCTURE` — ordered array of 5 entries: `{ weeks: number[], phase: 'intro'|'build1'|'deload'|'build2'|'deload2', setMultiplier: number, rirOverride?: string, extraSets?: { exerciseIds: string[], amount: number }, swapPairs?: [string,string][], isolationLastSetRIR?: number }`. Values: intro `{weeks:[1], setMultiplier:1, rirOverride:'3'}`; build1 `{weeks:[2,3,4,5], setMultiplier:1}`; deload `{weeks:[6], setMultiplier:0.5, rirOverride:'3-4'}`; build2 `{weeks:[7,8,9,10,11], setMultiplier:1, extraSets:{exerciseIds:[/* all lateral-raise, lat-pulldown, single-arm-pulldown ids */], amount:1}, swapPairs:[['incline-db-press','incline-smith-press'],['t-bar-row','seal-row']], isolationLastSetRIR:0}`; deload2 `{weeks:[12], setMultiplier:0.5}`.
  - `export const INCREMENT_BY_TYPE = { dumbbell: 2.5, machine: 2.5, legpress: 5, hipthrust: 5, cable: '1 pin' }`
  - `export const NUTRITION_PHASES = { recomp: { weeks:[1,2,3,4], kcal:2500, protein:140, fat:65, carbs:340 }, leanGain: { weeks:[5,6,7,8,9,10,11,12], kcal:2850, protein:140, fat:75, carbs:405 } }`
  - `export const ADD_ONS` — array of 4 `{ id, label, kcal: 250 }` lean-gain add-ons, plus `export const PRE_TRAINING_BANANA = { label: '1 extra banana before training', kcal: 100 }`.
  - `export const MEAL_PLAN` — object keyed by day code, value `{ meals: [{ id, name, items, kcal, protein }], dayTotalKcal, dayTotalProtein }` for all 7 days exactly as in the source extract (Sunday's own distinct 4-meal menu, not a reuse of the "pre-workout snack as evening snack" rule — Sunday is the plan's only rest day and already has its own full menu).
  - `export const PROTEIN_SWAPS` — array of equivalence groups, e.g. `[{ grams: 150, food: 'chicken breast' }, { grams: 150, food: 'fish' }, { count: 5, food: 'whole eggs' }, { grams: 130, food: 'paneer' }, { grams: 60, food: 'soya chunks' }]`.
  - `export const SUPPLEMENTS` — array of `{ name, dose, why }` (4 entries).
  - `export const GROCERY_LIST` — array of `{ category, item, quantity }` (all rows from the source extract).
  - `export const SUNDAY_PREP_STEPS` — array of 5 strings.
  - `export const CHECKIN_TARGETS` — `{ recomp: { weightPerWeekKg: [-0.2, 0], waistPer4WeeksCm: [-2, -0.5] }, leanGain: { weightPerWeekKg: [0.2, 0.3], waistPer4WeeksCm: [0, 0.5] } }`.
  - `export const LOWER_BACK_TWINGE_SWAPS = { 'hack-squat': 'leg-press', 'hip-thrust': 'glute-bridge-machine', 'row': 'machine-row' }` (used by Task 11's swap UI).

- [ ] **Step 1: Write `js/data/plan.js`** transcribing every value above directly from `docs/superpowers/specs/plan-source-extract.txt`. Copy exercise names, set/rep/rest/RIR values, meal items/kcal/protein, and grocery quantities verbatim — do not round or paraphrase. Assign each exercise a stable kebab-case `id` and each `BLOCK_STRUCTURE` entry's `extraSets.exerciseIds` must list the ids of: machine lateral raise, single-arm cable lateral raise, cable lateral raise (Day 6), seated dumbbell lateral raise, lat pulldown, kneeling single-arm cable pulldown (every exercise whose name contains "lateral raise", "lat pulldown", or "single-arm...pulldown").
- [ ] **Step 2: Write a structural smoke test** in `tests.html` (create the file now with a minimal `<ul id="results"></ul>` and a `<script type="module">` that imports `js/data/plan.js` and asserts): `DAY_ORDER.length === 7`; every key in `DAY_ORDER` exists in `DAYS`; every non-rest day's `exercises.length >= 7`; every `PlanExercise.id` across all days is unique; `BLOCK_STRUCTURE` covers all 12 week numbers exactly once when flattened; `MEAL_PLAN` has all 7 day keys each with a `meals` array whose `kcal` sum matches `dayTotalKcal` within 5. Render pass/fail text into `#results`.
- [ ] **Step 3: Open `tests.html` in a browser (e.g. via `python3 -m http.server` from the project root) and confirm every assertion shows PASS.**
- [ ] **Step 4: Commit**

```bash
git add js/data/plan.js tests.html
git commit -m "feat: add transcribed plan data module with structural smoke test"
```

---

### Task 2: IndexedDB wrapper

**Files:**

- Create: `js/db.js`
- Test: append to `tests.html`

**Interfaces:**

- Consumes: nothing.
- Produces (consumed by `app.js` and every `ui/*.js`):
  - DB name `vtaper-coach-db`, version `1`. Object stores: `settings` (keyPath `id`, single record with `id:'app'`), `sessionLogs` (keyPath `id`, id format `${dateISO}_${dayKey}`), `exerciseHistory` (keyPath `exerciseId`, value `{ exerciseId, entries: ExercisePerformance[] }` where `ExercisePerformance = { date, weekNumber, sets: [{ weight, reps, rir, isWarmup }] }`), `bodyMetrics` (keyPath `date`), `dietLog` (keyPath `date`), `customFoods` (keyPath `id`, autoIncrement), `checkins` (keyPath `weekNumber`).
  - `export async function openDB(): Promise<IDBDatabase>`
  - `export async function getSetting(): Promise<Settings|null>`
  - `export async function putSetting(settings: Settings): Promise<void>`
  - `export async function getSessionLog(id: string): Promise<SessionLog|null>`
  - `export async function putSessionLog(log: SessionLog): Promise<void>`
  - `export async function getAllSessionLogs(): Promise<SessionLog[]>`
  - `export async function getExerciseHistory(exerciseId: string): Promise<ExercisePerformance[]>` (returns `[]` if none)
  - `export async function appendExercisePerformance(exerciseId: string, entry: ExercisePerformance): Promise<void>`
  - `export async function getBodyMetric(date: string): Promise<BodyMetric|null>`
  - `export async function putBodyMetric(metric: BodyMetric): Promise<void>`
  - `export async function getAllBodyMetrics(): Promise<BodyMetric[]>`
  - `export async function getDietLog(date: string): Promise<DietLog|null>`
  - `export async function putDietLog(log: DietLog): Promise<void>`
  - `export async function getAllCustomFoods(): Promise<CustomFood[]>`
  - `export async function addCustomFood(food: { name: string, kcal: number, protein: number }): Promise<number>` (returns new id)
  - `export async function getCheckin(weekNumber: number): Promise<Checkin|null>`
  - `export async function putCheckin(checkin: Checkin): Promise<void>`
  - `export async function exportAllData(): Promise<object>` — `{ settings, sessionLogs, exerciseHistory, bodyMetrics, dietLog, customFoods, checkins, exportedAt }`, dumping every record from every store above.
  - `export async function importAllData(data: object): Promise<void>` — clears each of the 7 stores and re-populates from `data`'s matching key; unknown/missing keys are skipped, not errors.

- [ ] **Step 1: Write `js/db.js`** implementing `openDB` with an `onupgradeneeded` handler that creates all 7 object stores, then the get/put/getAll/append functions above using promise-wrapped `IDBRequest` calls, then `exportAllData`/`importAllData` iterating the store list.
- [ ] **Step 2: Add assertions to `tests.html`** that: `putSetting({id:'app', weightKg:67}); getSetting()` round-trips the value; `appendExercisePerformance('incline-db-press', {date:'2026-01-01', weekNumber:1, sets:[{weight:20,reps:8,rir:2,isWarmup:false}]})` then `getExerciseHistory('incline-db-press')` returns an array of length 1 with that entry; calling `appendExercisePerformance` a second time for the same exercise appends (history length 2, does not overwrite); `exportAllData()` then `importAllData()` into the same DB reproduces identical `getAllBodyMetrics()` output after writing one `bodyMetrics` record pre-export (covers the Review Focus backup round-trip item at the data layer; the full cross-store round trip is asserted again in Task 21 once every store has real data flowing through the UI).
- [ ] **Step 3: Run `tests.html` in the browser (DevTools → Application → IndexedDB can verify store creation); confirm all new assertions PASS.** Clear the IndexedDB database between runs if re-running (stale `onupgradeneeded` won't rerun otherwise).
- [ ] **Step 4: Commit**

```bash
git add js/db.js tests.html
git commit -m "feat: add IndexedDB wrapper with export/import"
```

---

### Task 3: Week/phase pure functions

**Files:**

- Create: `js/week.js`
- Test: append to `tests.html`

**Interfaces:**

- Consumes: `BLOCK_STRUCTURE`, `DAY_ORDER` from `js/data/plan.js`.
- Produces (consumed by `ui/today.js`, `ui/progress.js`):
  - `export function getWeekNumber(startDateISO: string, todayISO: string): number | null` — `Math.floor((daysBetween)/7) + 1`, clamped: returns `null` if the result is `< 1` (today before start) or `> 12` (plan complete — the Review Focus case).
  - `export function getPhaseForWeek(weekNumber: number): { phase: string, setMultiplier: number, rirOverride?: string, extraSets?: object, swapPairs?: [string,string][], isolationLastSetRIR?: number } | null` — looks up `BLOCK_STRUCTURE`; returns `null` for `weekNumber` outside 1–12.
  - `export function getDayKeyForDate(todayISO: string): string` — `DAY_ORDER[new Date(todayISO+'T00:00:00').getDay() === 0 ? 6 : new Date(...).getDay()-1]` (JS `getDay()` is 0=Sunday; map to the plan's `mon..sun` order).
  - `export function isCheckinWeek(weekNumber: number): boolean` — `[4,8,12].includes(weekNumber)`.
  - `export function getWeekInfo(startDateISO: string, todayISO: string): { weekNumber: number|null, dayKey: string, phaseInfo: object|null, isCheckinWeek: boolean, isPlanComplete: boolean }` — composes the above; `isPlanComplete` is true when `weekNumber === null` because today is after week 12 ends.

- [ ] **Step 1: Write failing assertions in `tests.html`** for: `getWeekNumber('2026-01-05','2026-01-05') === 1`; `getWeekNumber('2026-01-05','2026-01-11') === 1`; `getWeekNumber('2026-01-05','2026-01-12') === 2`; `getPhaseForWeek(1).phase === 'intro'`; `getPhaseForWeek(6).setMultiplier === 0.5`; `getPhaseForWeek(13) === null`; `getDayKeyForDate('2026-01-05') === 'mon'` (confirm 2026-01-05 is a Monday first); `getWeekInfo('2026-01-05', '2027-06-01').isPlanComplete === true`.
- [ ] **Step 2: Run `tests.html`; confirm these new assertions FAIL** (module doesn't exist yet).
- [ ] **Step 3: Implement `js/week.js`** per the signatures above.
- [ ] **Step 4: Run `tests.html`; confirm all `week.js` assertions PASS.**
- [ ] **Step 5: Commit**

```bash
git add js/week.js tests.html
git commit -m "feat: add week/phase calculation module"
```

---

### Task 4: Double progression engine

**Files:**

- Create: `js/progression.js`
- Test: append to `tests.html`

**Interfaces:**

- Consumes: `INCREMENT_BY_TYPE` from `js/data/plan.js`; `ExercisePerformance[]` shape from Task 2.
- Produces (consumed by `ui/today.js`):
  - `export function getLastPerformance(history: ExercisePerformance[]): ExercisePerformance | null` — last element of `history` (entries are appended in chronological order), or `null` if empty.
  - `export function recommendNextSession(exercise: PlanExercise, history: ExercisePerformance[]): { type: 'increaseWeight', amount: number|string } | { type: 'beatLastTime', targetReps: number } | { type: 'noHistory' }`
    - `noHistory` if `history` is empty.
    - Otherwise, inspect the last performance's working sets (`isWarmup === false`). Parse `exercise.rir` (e.g. `'1-0'` or `'2'`) to a target RIR ceiling (the lower/stricter bound, e.g. `'1-0'` → `0`, `'2'` → `2`).
    - `increaseWeight` (amount from `INCREMENT_BY_TYPE[exercise.incrementType]`) only if **every** working set reached `reps >= exercise.repsHigh` **and** `rir <= targetRIR`. (Review Focus item: a single working set short of either threshold must fall through to `beatLastTime`.)
    - Otherwise `beatLastTime` with `targetReps = Math.min(exercise.repsHigh, maxRepsAcrossWorkingSets + 1)`.

- [ ] **Step 1: Write failing assertions** for: `recommendNextSession(ex, [])` returns `{type:'noHistory'}`; an exercise with `repsLow:8, repsHigh:12, rir:'2'` and last performance's 3 working sets all `{reps:12, rir:2}` → `{type:'increaseWeight', amount: INCREMENT_BY_TYPE[ex.incrementType]}`; the same exercise with one working set `{reps:12, rir:3}` (RIR too high, i.e. not pushed hard enough... wait — RIR higher than target means an easier set, still short of intensity) and the rest at target → `{type:'beatLastTime', targetReps:12}` (the Review Focus mixed-set case: one set not meeting the RIR bound must block the increase even though reps were fine); an exercise with sets `{reps:9,rir:2}`,`{reps:10,rir:2}` → `{type:'beatLastTime', targetReps:11}`.
- [ ] **Step 2: Run `tests.html`; confirm these assertions FAIL.**
- [ ] **Step 3: Implement `js/progression.js`** per the signatures above. One line on the approach: parse `exercise.rir` by splitting on `-` and taking the last (strictest) number as the target RIR ceiling.
- [ ] **Step 4: Run `tests.html`; confirm all `progression.js` assertions PASS.**
- [ ] **Step 5: Commit**

```bash
git add js/progression.js tests.html
git commit -m "feat: add double progression recommendation engine"
```

---

### Task 5: Rest timer pure functions

**Files:**

- Create: `js/timer.js`
- Test: append to `tests.html`

**Interfaces:**

- Consumes: `sessionStorage` (browser global, not injected — acceptable since `tests.html` runs in a real browser).
- Produces (consumed by `ui/today.js` for the floating timer UI):
  - `export function computeRemainingMs(endTimestampMs: number, nowMs = Date.now()): number` — `Math.max(0, endTimestampMs - nowMs)`.
  - `export function startRestTimer(durationMs: number): number` — computes `endTimestampMs = Date.now() + durationMs`, stores it under `sessionStorage['vtaper-rest-timer-end']`, returns it.
  - `export function getActiveRestTimer(): number | null` — reads and parses the stored value, or `null` if absent.
  - `export function clearRestTimer(): void` — removes the stored key.
  - `export function adjustRestTimer(deltaMs: number): number | null` — adds `deltaMs` to the stored end timestamp (clamped so the new remaining time is never negative), re-stores it, returns the new end timestamp, or `null` if no timer is active.

- [ ] **Step 1: Write failing assertions**: `computeRemainingMs(1000, 1000) === 0`; `computeRemainingMs(2000, 1000) === 1000`; `computeRemainingMs(500, 1000) === 0` (already elapsed, never negative); `startRestTimer(60000)` then `getActiveRestTimer()` returns the same timestamp; `clearRestTimer()` then `getActiveRestTimer() === null`; `startRestTimer(60000)` then `adjustRestTimer(15000)` increases the stored end by 15000; the Review Focus case — `startRestTimer(5000)` then `computeRemainingMs(getActiveRestTimer(), Date.now() + 10000) === 0` (simulating the app being backgrounded past the full rest duration must read as fully elapsed, not paused).
- [ ] **Step 2: Run `tests.html`; confirm these assertions FAIL.**
- [ ] **Step 3: Implement `js/timer.js`** per the signatures above.
- [ ] **Step 4: Run `tests.html`; confirm all `timer.js` assertions PASS.**
- [ ] **Step 5: Commit**

```bash
git add js/timer.js tests.html
git commit -m "feat: add rest timer timestamp logic"
```

---

### Task 6: App shell — HTML, CSS, router

**Files:**

- Create: `index.html`, `css/styles.css`, `js/ui/router.js`
- Manual verification only (DOM/visual — no unit test for this task; `tests.html` stays unit-test-only per the spec).

**Interfaces:**

- Consumes: nothing.
- Produces (consumed by `app.js` and every `ui/*.js`):
  - `index.html` contains `<div id="app"></div>` as the single mount point, a `<nav id="tabbar">` with 5 buttons (`data-tab="today|diet|body|progress|settings"`), and `<link rel="manifest" href="manifest.webmanifest">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<link rel="apple-touch-icon" href="icons/icon-180.png">`, viewport meta with `viewport-fit=cover`.
  - `export function initRouter(tabs: Record<string, (container: HTMLElement) => void>): void` — reads `location.hash` (default `#today`), shows the matching tab's container (`<section id="tab-today">` etc., all present in `index.html`, hidden via CSS `[hidden]` except the active one), calls the tab's render function, and listens for `hashchange` plus tabbar button clicks to switch.
  - `css/styles.css` defines CSS custom properties for the dark theme (background, surface, text, one accent color — pick a specific accent now, e.g. `--accent: #39ff8f` electric green, document the choice in a comment), `padding-bottom: env(safe-area-inset-bottom)` on the tabbar, `min-height: 44px` on all `button`/`input[type=checkbox]` tap targets, and a `body { overflow-x: hidden }` guard against the no-horizontal-scroll constraint.

- [ ] **Step 1: Write `index.html`** with the mount point, tabbar, 5 empty `<section>` containers, manifest/meta tags, and a `<script type="module" src="js/app.js"></script>`.
- [ ] **Step 2: Write `css/styles.css`** per the interface above — dark theme variables, safe-area padding, 44px minimum targets, no-horizontal-scroll guard, large-number utility class for stat displays.
- [ ] **Step 3: Write `js/ui/router.js`** implementing `initRouter` per the signature above.
- [ ] **Step 4: Serve the project with `python3 -m http.server` from the project root, open `index.html`, and manually confirm:** the 5 tabbar buttons are visible and tappable at a simulated 375px width (browser DevTools device toolbar), switching tabs updates the hash and toggles section visibility, and there is no horizontal scrollbar.
- [ ] **Step 5: Commit**

```bash
git add index.html css/styles.css js/ui/router.js
git commit -m "feat: add app shell with dark theme and tab router"
```

---

### Task 7: Settings module + first-run setup

**Files:**

- Create: `js/ui/settings.js`
- Modify: `index.html` (fill in `#tab-settings` content target, already present from Task 6)

**Interfaces:**

- Consumes: `getSetting`, `putSetting` from `js/db.js`.
- Produces (consumed by `app.js` for first-run gating, and registered as the `settings` tab):
  - `export function renderSettingsTab(container: HTMLElement): Promise<void>` — renders the profile form (start date picker defaulting to today, weight in kg/lb per units, height in cm/in, age input defaulting to `29`, units toggle metric/imperial) pre-filled from `getSetting()`, saves via `putSetting()` on submit. Also renders (stub containers, filled by Task 16): a "Backup" section and a "Last backup" line.
  - `export async function hasCompletedSetup(): Promise<boolean>` — `(await getSetting()) !== null`.
  - `export async function runFirstRunSetupIfNeeded(appRoot: HTMLElement): Promise<void>` — if `!(await hasCompletedSetup())`, renders the same form full-screen (reuses the form-building internals of `renderSettingsTab`, refactored into a shared private helper) and blocks until the user submits it, then resolves.

- [ ] **Step 1: Write `js/ui/settings.js`** per the signatures above. One line on the approach: extract the form-building DOM code into a private `buildProfileForm(onSave)` helper used by both `renderSettingsTab` and the first-run flow, so there is one source of truth for the fields.
- [ ] **Step 2: Manually verify** (served via `http.server`): on a fresh IndexedDB (clear it in DevTools), opening `index.html` directly with only `router.js`+`settings.js` wired in a temporary test harness is unnecessary — defer full manual verification to Task 8 once `app.js` exists and actually calls `runFirstRunSetupIfNeeded`.
- [ ] **Step 3: Commit**

```bash
git add js/ui/settings.js
git commit -m "feat: add settings tab and first-run setup form"
```

---

### Task 8: App bootstrap, offline shell, and PWA manifest

**Files:**

- Create: `js/app.js`, `manifest.webmanifest`, `sw.js`, `scripts/generate-icons.js`, `icons/icon-180.png`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/favicon.png`

**Interfaces:**

- Consumes: `openDB` from `js/db.js`; `runFirstRunSetupIfNeeded`, `renderSettingsTab` from `js/ui/settings.js`; `initRouter` from `js/ui/router.js`; render functions from `ui/today.js`, `ui/diet.js`, `ui/body.js`, `ui/progress.js` (all built in later tasks — `app.js` imports them, so this task's code will not fully run until those exist; the manual verification step below is deferred to the end of Task 11, noted there).
- Produces: the running app. No other module imports `app.js`.

- [ ] **Step 1: Write `scripts/generate-icons.js`** (Node, dev-only, run manually, never imported by the app): draws a simple inline SVG (e.g. a stylized "V" on the chosen accent color background) and rasterizes it to PNG at 180/192/512px plus a small favicon, writing into `icons/`. Use only Node built-ins or a one-time `npx` invocation of a rasterizer (e.g. `npx sharp-cli` or `npx svg2png-cli`) — this tool is a dev-time convenience, not a runtime dependency, so an `npx` one-off is acceptable even though the app itself ships with zero npm runtime dependencies.
- [ ] **Step 2: Run `node scripts/generate-icons.js`; confirm `icons/icon-180.png`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/favicon.png` are created and non-empty.**
- [ ] **Step 3: Write `manifest.webmanifest`** with `name`, `short_name`, `start_url: "."`, `display: "standalone"`, `background_color`/`theme_color` matching the CSS accent, and the three icon sizes.
- [ ] **Step 4: Write `sw.js`** with `const CACHE_NAME = 'vtaper-coach-v1'`, an explicit `PRECACHE_URLS` array listing every static file (`index.html`, `manifest.webmanifest`, `css/styles.css`, every `js/**/*.js`, every `icons/*.png`), an `install` handler that opens `CACHE_NAME` and adds all `PRECACHE_URLS`, an `activate` handler that deletes any cache key `!== CACHE_NAME`, and a `fetch` handler that responds cache-first (falls back to network, and on a successful network response for a precached URL, updates the cache).
- [ ] **Step 5: Write `js/app.js`**: on load, call `openDB()`, then `await runFirstRunSetupIfNeeded(document.getElementById('app'))`, then `initRouter({ today: renderTodayTab, diet: renderDietTab, body: renderBodyTab, progress: renderProgressTab, settings: renderSettingsTab })`, then if `navigator.storage?.persist` exists call it, then if `'serviceWorker' in navigator` register `sw.js`.
- [ ] **Step 6: Manually verify offline shell mechanics** (full end-to-end verification of all tabs is deferred to Task 17/18's final manual pass once every tab exists): serve via `http.server`, load the app once online, open DevTools → Application → Service Workers and confirm it's activated with the `vtaper-coach-v1` cache populated, then toggle "Offline" in DevTools and reload — confirm the shell (tabbar, whichever tabs are implemented so far) still loads.
- [ ] **Step 7: Commit**

```bash
git add js/app.js manifest.webmanifest sw.js scripts/generate-icons.js icons/
git commit -m "feat: add app bootstrap, service worker, and PWA manifest"
```

---

### Task 9: Today tab — session rendering

**Files:**

- Create: `js/ui/today.js`

**Interfaces:**

- Consumes: `DAYS`, `WARMUP_STEPS` from `js/data/plan.js`; `getWeekInfo` from `js/week.js`; `getSetting` from `js/db.js`.
- Produces (consumed by `app.js`'s router registration, and extended in Tasks 10/11/15 in this same file):
  - `export async function renderTodayTab(container: HTMLElement): Promise<void>` — reads settings (`startDate`), computes `getWeekInfo(startDate, todayISO)`, and:
    - if `isPlanComplete`, renders a "12 weeks complete — start a new block" message.
    - else if the day is `sun` (rest day), renders the rest-day view: steps target, mobility note, stomach-vacuum reminder, from `DAYS.sun.restDayInfo`.
    - else renders the warm-up checklist (`WARMUP_STEPS`) followed by the day's exercise list, applying the current week's `phaseInfo` (swap any exercise whose id appears in `phaseInfo.swapPairs`, add `phaseInfo.extraSets.amount` to `sets` for exercises in `phaseInfo.extraSets.exerciseIds`, multiply `sets` by `phaseInfo.setMultiplier` and round up, and for `phaseInfo.isolationLastSetRIR` weeks note the last working set's RIR override inline) — each exercise rendered as a collapsed row (name, adjusted sets×reps, rest, RIR) that expands into the logger (built in Task 10).
    - renders a banner at the top if `getWeekInfo(...).isCheckinWeek` or the phase is `deload`/`deload2` ("Check-in due this week" / "Deload week — half sets").

- [ ] **Step 1: Write `js/ui/today.js`** per the interface above.
- [ ] **Step 2: Manually verify** by temporarily setting a test start date via the Settings tab (now wired through `app.js` from Task 8) so "today" lands in week 1, 6, 7, and 13 in turn (change the stored `startDate` in DevTools → Application → IndexedDB, or via the Settings form), confirming the rest-day view, warm-up + exercise list, deload set-halving, Build-2 swap, and plan-complete message each render correctly.
- [ ] **Step 3: Commit**

```bash
git add js/ui/today.js
git commit -m "feat: render today's session with week/phase adjustments"
```

---

### Task 10: Workout logger

**Files:**

- Modify: `js/ui/today.js` (add logger UI to the exercise row built in Task 9)

**Interfaces:**

- Consumes: `recommendNextSession`, `getLastPerformance` from `js/progression.js`; `getExerciseHistory`, `appendExercisePerformance`, `getSessionLog`, `putSessionLog` from `js/db.js`; `startRestTimer` from `js/timer.js` (wired fully in Task 11; this task only calls it, doesn't render the floating UI yet).
- Produces (consumed by Task 11's timer UI and Task 15's swap/how-to-do-it panel, both extending the same exercise row element): each exercise row, when expanded, shows:
  - the last session's logged sets for this exercise (from `getExerciseHistory(exercise.id)`'s most recent entry) beside each target set;
  - the `recommendNextSession` result rendered as either "Increase weight next session: +Xkg" / "+1 pin" or "Beat last time: aim for X reps";
  - per working set: weight input with +/- 2.5kg buttons, reps input, RIR input, and a warm-up/working toggle;
  - a "log set" action per row that appends the set to an in-memory session draft, writes the whole draft to `sessionLogs` via `putSessionLog` keyed `${today}_${dayKey}`, and on the last working set of an exercise also calls `appendExercisePerformance(exercise.id, { date, weekNumber, sets })` and `startRestTimer(parseRestMs(exercise.rest))` (a small private helper parsing `"2-3 min"` / `"60-90 s"` strings to milliseconds, taking the upper bound).

- [ ] **Step 1: Extend `js/ui/today.js`** per the interface above, adding the logger markup/behavior inside each exercise row from Task 9.
- [ ] **Step 2: Manually verify**: log a full exercise's working sets, reload the page, confirm the exercise row now shows that session's data as "last time," and confirm the recommendation (increase weight vs. beat last time) matches the logged RIR/reps per the Task 4 rules.
- [ ] **Step 3: Commit**

```bash
git add js/ui/today.js
git commit -m "feat: add workout set logger with last-time display and progression hint"
```

---

### Task 11: Rest timer UI, "how to do it," and exercise swap

**Files:**

- Modify: `js/ui/today.js`

**Interfaces:**

- Consumes: `computeRemainingMs`, `getActiveRestTimer`, `clearRestTimer`, `adjustRestTimer` from `js/timer.js`; `exercise.cue` and `exercise.swaps`/`LOWER_BACK_TWINGE_SWAPS` from `js/data/plan.js`.
- Produces: a floating rest-timer widget and, per exercise, a "How to do it" expandable panel and a "Swap" control, both added to the rendering built in Tasks 9–10.

- [ ] **Step 1: Add the floating rest timer widget** to `js/ui/today.js`: on mount, if `getActiveRestTimer()` is non-null, show it; poll every 500ms via `setInterval` to update the displayed remaining time from `computeRemainingMs`; beep (short Web Audio oscillator burst) and flash (a full-screen CSS overlay toggled briefly) when remaining hits 0, then call `clearRestTimer()`; add `+15s`/`-15s` buttons calling `adjustRestTimer`; if `navigator.wakeLock` exists, request a wake lock while any timer is active and release it when cleared.
- [ ] **Step 2: Add the "How to do it" panel** per exercise: renders `exercise.cue` text (offline, always available) plus two `<a target="_blank">` buttons linking to `https://www.google.com/search?q=${encodeURIComponent(exercise.name + ' proper form')}` and `https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' form tutorial')}`; show a small "needs internet" note next to them when `navigator.onLine === false`, re-checked via the `online`/`offline` window events — but the links themselves are plain `<a href>` elements, never disabled, per the Review Focus item.
- [ ] **Step 3: Add the swap control** per exercise: a small menu of `exercise.swaps` (same-muscle alternatives) plus, if the exercise's id is a key in `LOWER_BACK_TWINGE_SWAPS`, that specific swap highlighted; choosing a swap re-renders the row using the swapped exercise's own `PlanExercise` data and reads/writes its own `exerciseHistory` entry (by the swapped exercise's `id`), keeping history separate per the spec.
- [ ] **Step 4: Manually verify**: log a set and confirm the floating timer appears, counts down, and beeps+flashes at zero; background the tab (switch away) past the rest duration and confirm on return the timer shows 0 rather than a stale count; toggle DevTools offline mode and confirm the "needs internet" note appears/disappears but the Google/YouTube buttons remain clickable in both states; swap an exercise and confirm its logger now tracks separately from the original.
- [ ] **Step 5: Commit**

```bash
git add js/ui/today.js
git commit -m "feat: add rest timer widget, how-to-do-it panel, and exercise swap"
```

---

### Task 12: Diet tab

**Files:**

- Create: `js/nutrition.js`, `js/ui/diet.js`
- Test: append `nutrition.js` assertions to `tests.html`

**Interfaces (`js/nutrition.js`, pure):**

- Consumes: `MEAL_PLAN`, `NUTRITION_PHASES`, `ADD_ONS`, `PRE_TRAINING_BANANA`, `PROTEIN_SWAPS` from `js/data/plan.js`.
- Produces (consumed by `ui/diet.js`):
  - `export function getMealsForDay(dayKey: string): Meal[]` — `MEAL_PLAN[dayKey].meals`.
  - `export function getTargetsForWeek(weekNumber: number): { kcal, protein, fat, carbs }` — looks up `NUTRITION_PHASES` by whether `weekNumber` is in `.recomp.weeks` or `.leanGain.weeks`.
  - `export function computeDayTotals(meals: Meal[], checkedMealIds: string[], addOnId: string|null, bananaChecked: boolean, customFoods: { kcal, protein }[]): { kcal: number, protein: number }` — sums `kcal`/`protein` of meals whose id is in `checkedMealIds`, plus the add-on's kcal (protein contribution of add-ons is 0 per the spec — they're carb/fat top-ups) if `addOnId` is set, plus `PRE_TRAINING_BANANA.kcal` if `bananaChecked`, plus the sum of `customFoods`.
  - `export function applyProteinSwap(mealItemText: string, fromFood: string, toFood: string): string` — simple case-insensitive substring replace of `fromFood` with `toFood` in the item text (kcal/protein unchanged, per the spec's "similar protein" framing).

- [ ] **Step 1: Write failing assertions** for: `getTargetsForWeek(2).kcal === 2500`; `getTargetsForWeek(7).kcal === 2850`; `computeDayTotals(meals, [meals[0].id], null, false, [])` equals that one meal's kcal/protein; adding the add-on and banana increases `kcal` by `250 + 100` with no protein change; `applyProteinSwap('chicken curry (150 g breast)', 'chicken', 'fish') === 'fish curry (150 g breast)'`.
- [ ] **Step 2: Run `tests.html`; confirm FAIL.**
- [ ] **Step 3: Implement `js/nutrition.js`** per the signatures above.
- [ ] **Step 4: Run `tests.html`; confirm PASS.**
- [ ] **Step 5: Write `js/ui/diet.js`**: `export async function renderDietTab(container: HTMLElement): Promise<void>` — reads today's `dietLog` (via `getDietLog`/`putDietLog` from `js/db.js`) and settings/week info (reusing `getWeekInfo`), renders today's meal checklist (checkbox per meal, persisted on toggle), running totals vs. `getTargetsForWeek` (including a protein progress ring toward 140g — an inline SVG `<circle>` with `stroke-dasharray` set from the percentage), the lean-gain add-on picker and pre-training-banana checkbox (hidden when `weekNumber < 5`), a protein-swap control per meal (lists `PROTEIN_SWAPS` options, calls `applyProteinSwap` and re-renders that meal's text — the swap choice itself is saved in the day's `dietLog` so it persists), and a custom-food quick-add form (name/kcal/protein) that calls `addCustomFood` then `putDietLog` to attach it to today.
- [ ] **Step 6: Manually verify**: check off meals and confirm totals/ring update and persist across reload; switch the stored `startDate` so today falls in week 6 and confirm the add-on picker appears; add a custom food and confirm it affects the totals.
- [ ] **Step 7: Commit**

```bash
git add js/nutrition.js js/ui/diet.js tests.html
git commit -m "feat: add diet tab with meal checklist, protein ring, and swaps"
```

---

### Task 13: Body tab + charts

**Files:**

- Create: `js/charts.js`, `js/ui/body.js`
- Test: append `charts.js` assertions to `tests.html`

**Interfaces (`js/charts.js`, pure):**

- Consumes: nothing (pure numeric/SVG string functions).
- Produces (consumed by `ui/body.js`):
  - `export function rollingAverage(values: number[], windowSize: number): number[]` — same-length output; each output[i] is the average of `values[max(0,i-windowSize+1)..i]` (partial window at the start, per the spec's 7-day rolling average over a history shorter than 7 days).
  - `export function buildSVGLineChart(points: { x: number, y: number }[], opts: { width: number, height: number, color: string, padding?: number }): string` — returns a complete `<svg>...</svg>` string with the data normalized into the viewbox and drawn as a single `<path>`, plus small `<circle>` markers per point.

- [ ] **Step 1: Write failing assertions** for: `rollingAverage([70,71,72], 7)` equals `[70, 70.5, 71]` (partial windows); `rollingAverage([1,2,3,4,5,6,7,8], 7)[7] === (2+3+4+5+6+7+8)/7`; `buildSVGLineChart([{x:0,y:0},{x:1,y:1}], {width:100,height:50,color:'#fff'})` is a string starting with `'<svg'` and containing `'<path'`.
- [ ] **Step 2: Run `tests.html`; confirm FAIL, then implement `js/charts.js`, then confirm PASS.**
- [ ] **Step 3: Write `js/ui/body.js`**: `export async function renderBodyTab(container: HTMLElement): Promise<void>` — entry forms for daily weight, weekly waist (only prompted on the stored day-of-week matching "Monday" per the spec, but always editable), every-4-weeks shoulder measurement, steps, sleep (all via `getBodyMetric`/`putBodyMetric`); computes and displays the 7-day rolling weight average and the shoulder÷waist V-taper ratio (most recent values); renders four charts via `buildSVGLineChart`: weight rolling average, waist, V-taper ratio, and one strength-trend chart (series built from `getExerciseHistory` for `incline-db-press`, `lat-pulldown`, `single-arm-cable-lateral-raise`, `leg-press` — plotting the heaviest working-set weight per session date for whichever of those four is selected via a small tab/select control).
- [ ] **Step 4: Manually verify**: enter several days of weight and confirm the rolling average chart updates; enter a waist and shoulder value and confirm the ratio and its chart render; log a few workout sessions for one of the four tracked lifts (via the Today tab) and confirm its strength-trend chart shows the logged weights.
- [ ] **Step 5: Commit**

```bash
git add js/charts.js js/ui/body.js tests.html
git commit -m "feat: add body tab with weight/waist/ratio/strength charts"
```

---

### Task 14: Check-in wizard logic

**Files:**

- Create: `js/checkin.js`
- Test: append to `tests.html`

**Interfaces (pure):**

- Consumes: `CHECKIN_TARGETS` from `js/data/plan.js`; `BodyMetric[]` shape from Task 2.
- Produces (consumed by `ui/progress.js`):
  - `export function computeWeekAverages(bodyMetrics: BodyMetric[], weekStartISO: string, weekEndISO: string): { avgWeight: number|null, avgWaist: number|null, avgSteps: number|null, avgSleep: number|null }` — averages whichever metric fields are present on records whose `date` falls in `[weekStartISO, weekEndISO]`; `null` for a field with no records.
  - `export function calorieDecision(input: { phase: 'recomp'|'leanGain', weightDelta4wk: number, waistDelta4wk: number, liftsTrend: 'up'|'flat'|'down', bloatPersisted: boolean }): { decision: string, action: string, kcalChange: number }` — implements, in order, the 6 PDF rows (first match wins):

    1. `weightDelta4wk` within target range AND `waistDelta4wk` within target range AND `liftsTrend === 'up'` → `{ decision: "It's working", action: 'Change nothing', kcalChange: 0 }`.
    2. `phase === 'leanGain' && weightDelta4wk < 0.5 && Math.abs(waistDelta4wk) < 0.5` → `{ decision: 'Surplus too small', action: '+150 kcal a day (≈ +35 g carbs)', kcalChange: 150 }`.
    3. `phase === 'leanGain' && (weightDelta4wk > 1.5 || waistDelta4wk > 1)` → `{ decision: 'Gaining too much fat', action: '-150 kcal a day (cut carbs), +2,000 steps a day', kcalChange: -150 }`.
    4. `phase === 'recomp' && weightDelta4wk < 0 && waistDelta4wk < 0 && liftsTrend === 'up'` → `{ decision: 'Recomp is working well', action: 'Stay at 2,500 kcal for 2–4 more weeks before starting the surplus', kcalChange: 0 }`.
    5. `phase === 'recomp' && weightDelta4wk < -1 && liftsTrend === 'down'` → `{ decision: 'Eating too little', action: '+150 kcal a day', kcalChange: 150 }`.
    6. `Math.abs(weightDelta4wk) < 0.2 && waistDelta4wk > 0` → `{ decision: 'Bloating or fat gain', action: bloatPersisted ? '-150 kcal a day' : 'Check oil, salt and late-night eating first', kcalChange: bloatPersisted ? -150 : 0 }`.

    - fallback (no row matches): `{ decision: 'No clear signal', action: 'Keep current calories 2 more weeks and re-check', kcalChange: 0 }`.
  - `export function volumeRule(signal: 'onTrack'|'shouldersLatsStalled'|'noProgress'|'jointsAchy'|'lowerBackTwinge'): { action: string }` — direct lookup of the 5 PDF rows' action text.
  - `export function vTaperRatio(shoulderCm: number, waistCm: number): number` — `shoulderCm / waistCm`.

- [ ] **Step 1: Write failing assertions** covering all 6 `calorieDecision` rows (one input example per row, matching the PDF's own numeric thresholds) plus the fallback, all 5 `volumeRule` signals, and `vTaperRatio(100, 71.4)` close to `1.4` (use `Math.abs(result - 1.4) < 0.01`).
- [ ] **Step 2: Run `tests.html`; confirm FAIL.**
- [ ] **Step 3: Implement `js/checkin.js`** per the signatures above.
- [ ] **Step 4: Run `tests.html`; confirm all `checkin.js` assertions PASS.**
- [ ] **Step 5: Commit**

```bash
git add js/checkin.js tests.html
git commit -m "feat: add check-in calorie decision and volume rule logic"
```

---

### Task 15: Progress tab — check-in wizard UI, banners, 12-week log

**Files:**

- Create: `js/ui/progress.js`
- Modify: `js/ui/diet.js` (calorie override, see Step 2)

**Interfaces:**

- Consumes: `computeWeekAverages`, `calorieDecision`, `volumeRule`, `vTaperRatio` from `js/checkin.js`; `getWeekInfo` from `js/week.js`; `getAllBodyMetrics`, `getExerciseHistory`, `getCheckin`, `putCheckin`, `getSetting` from `js/db.js`.
- Produces: `export async function renderProgressTab(container: HTMLElement): Promise<void>` — renders:
  - the 12-week log table (columns per the spec: week, avg weight, waist, shoulders, incline DB press, lat pulldown, cable lateral raise, leg press, avg steps, avg sleep, notes), one row per completed week, built from `getAllBodyMetrics()` + `getExerciseHistory()` for the four tracked lifts (heaviest working set per week) + any saved per-week notes (stored in a free-text field on the `checkins` record for that week, or a lightweight per-week note if the week isn't a checkin week — store these as `bodyMetrics` records' optional `notes` field to avoid adding a new store);
  - at `isCheckinWeek` weeks, a "Run check-in" button that, when pressed, calls `computeWeekAverages` for the prior 4 weeks, prompts for `liftsTrend` and (if relevant) `bloatPersisted` via simple select inputs (the rest of `calorieDecision`'s input is derived from the averages), shows the resulting decision/action, and on confirm calls `putCheckin({ weekNumber, ...result })` and updates `settings.calorieOverride` via `putSetting` so the Diet tab's `getTargetsForWeek` consumer (Task 12) can apply the override — **note:** since `getTargetsForWeek` in `nutrition.js` is pure and only reads `NUTRITION_PHASES`, add the override application in `renderDietTab` itself (reads `settings.calorieOverride` and adds it to the pure function's result), not inside `nutrition.js`.

- [ ] **Step 1: Write `js/ui/progress.js`** per the interface above.
- [ ] **Step 2: Modify `js/ui/diet.js`** (from Task 12) to read `settings.calorieOverride` (default 0) and add it to `getTargetsForWeek(...).kcal` before displaying/comparing totals.
- [ ] **Step 3: Manually verify**: log body metrics across a simulated 4-week span (adjust stored dates in DevTools or just log several days), set today's date into a checkin week, run the check-in wizard, confirm a decision renders and that the Diet tab's kcal target reflects the resulting override after confirming.
- [ ] **Step 4: Commit**

```bash
git add js/ui/progress.js js/ui/diet.js
git commit -m "feat: add check-in wizard UI, 12-week log table, and calorie override"
```

---

### Task 16: Extras — stomach vacuum timer, warm-up/grocery checklists

**Files:**

- Modify: `js/ui/today.js` (stomach vacuum timer reuses `js/timer.js`; warm-up checklist reuses `WARMUP_STEPS` already rendered in Task 9 — add checkbox persistence)
- Create: grocery checklist UI inside `js/ui/settings.js` (a natural home alongside backup, since it's a standalone weekly utility) backed by a new `groceryChecklist` field on the `settings` record (no new IndexedDB store needed: `{ weekOf: dateISO, checkedItems: string[] }`)

**Interfaces:**

- Consumes: `GROCERY_LIST` from `js/data/plan.js`; `startRestTimer`/`computeRemainingMs`/`clearRestTimer` from `js/timer.js` (same functions as the rest timer, reused for the stomach vacuum hold countdown); `getSetting`/`putSetting` from `js/db.js`.
- Produces: a stomach-vacuum hold timer button on the Today tab (starts a short `startRestTimer` cycle at 20–30s and reuses the existing floating-timer rendering from Task 11 rather than building a second widget); a persisted, checkbox-per-item grocery list in the Settings tab that auto-resets (`checkedItems: []`) whenever `weekOf` is more than 7 days old compared to `new Date().toISOString()`.

- [ ] **Step 1: Add the stomach vacuum timer trigger** to `js/ui/today.js`'s stomach-vacuum exercise row: a "Start hold" button calling `startRestTimer(25000)` (midpoint of 20–30s) and relying on the existing floating timer UI/beep/flash from Task 11.
- [ ] **Step 2: Add warm-up checklist persistence**: each `WARMUP_STEPS` item gets a checkbox; checked state is stored per-day in the existing `sessionLogs` record (`{ ..., warmupChecked: string[] }`) via `putSessionLog`, reset implicitly each new day since the key is date-scoped.
- [ ] **Step 3: Add the grocery checklist** to `js/ui/settings.js`: render `GROCERY_LIST` grouped by `category` with a checkbox per item; load/save `settings.groceryChecklist`; on render, if `groceryChecklist.weekOf` is absent or `>7` days old, reset `checkedItems` to `[]` and bump `weekOf` to today before rendering.
- [ ] **Step 4: Manually verify**: start a stomach-vacuum hold and confirm it uses the same floating timer; check warm-up items, reload, confirm they're unchecked the next calendar day; check grocery items, reload same day (still checked), then simulate >7 days by editing `weekOf` in DevTools and reload (confirm it resets).
- [ ] **Step 5: Commit**

```bash
git add js/ui/today.js js/ui/settings.js
git commit -m "feat: add stomach vacuum timer trigger, warm-up checklist, and weekly grocery checklist"
```

---

### Task 17: Backup export/import

**Files:**

- Modify: `js/ui/settings.js`
- Test: append a full round-trip assertion to `tests.html`

**Interfaces:**

- Consumes: `exportAllData`, `importAllData` from `js/db.js`.
- Produces: an "Export backup" button (builds a JSON blob from `exportAllData()`, triggers a download via a temporary `<a download>` + `URL.createObjectURL`, and updates `settings.lastBackupDate` to today via `putSetting`) and an "Import backup" file input (reads the selected `.json` file, shows a confirmation prompt with the file's `exportedAt` date, and on confirm calls `importAllData(parsed)` then reloads the page) in the Settings tab; a "Last backup: <date></date>" line that renders a nudge banner when `lastBackupDate` is absent or more than 7 days old.

- [ ] **Step 1: Write the Review Focus full round-trip assertion** in `tests.html`: populate at least one record in every one of the 7 stores (settings, a sessionLog, an exerciseHistory entry, a bodyMetric, a dietLog, a customFood, a checkin), call `exportAllData()`, call `importAllData()` with that result into the same DB, then re-fetch every store's contents and assert deep equality with what was written (confirms no store is silently dropped by export or import).
- [ ] **Step 2: Run `tests.html`; confirm this assertion FAILS if any store is missing from `exportAllData`/`importAllData`** (sanity-check by temporarily confirming it fails against an intentionally incomplete stub, then rely on Task 2's real implementation, which should already pass this — this step is a regression guard for the UI wiring added here, not new logic).
- [ ] **Step 3: Add the Export/Import/Last-backup UI** to `js/ui/settings.js` per the interface above.
- [ ] **Step 4: Manually verify**: export a backup with some logged data, clear IndexedDB entirely (DevTools), reload (first-run setup reappears), import the backup file, reload, confirm all previously logged data is back (Today tab last-time data, Diet tab history, Body tab charts).
- [ ] **Step 5: Commit**

```bash
git add js/ui/settings.js tests.html
git commit -m "feat: add JSON backup export/import with last-backup nudge"
```

---

### Task 18: Finish tests.html and run the full suite

**Files:**

- Modify: `tests.html` (no new product code — this task is strictly about completeness and a clean run of what Tasks 1–17 already added incrementally)

- [ ] **Step 1: Review `tests.html`** against every pure module (`week.js`, `progression.js`, `timer.js`, `nutrition.js`, `charts.js`, `checkin.js`, `db.js`) and confirm each has at least the assertions specified in its task above; add any missing ones found during review.
- [ ] **Step 2: Run the full `tests.html` suite in a browser** (fresh IndexedDB) and confirm every assertion PASSes, with a visible count of total/passed/failed rendered at the top of `#results`.
- [ ] **Step 3: Commit**

```bash
git add tests.html
git commit -m "test: complete and verify full pure-function test suite"
```

---

### Task 19: README and manual offline/deployment verification

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write `README.md`** with beginner-friendly steps: create a free GitHub account; create a new public repository; push this project to it (`git remote add origin <url>`, `git push -u origin main`) or upload the files via the GitHub web UI; enable GitHub Pages (Settings → Pages → Source: Deploy from a branch → branch `main`, folder `/ (root)`); wait for the Pages build and open the given `https://<user>.github.io/<repo>/` URL in Safari on iPhone → Share → Add to Home Screen. Include a short "Updating the app later" section: bump `CACHE_NAME` in `sw.js` (e.g. `v1` → `v2`) on every deploy so installed clients pick up new files, commit, push, and reopen the installed app (it will fetch the new service worker and recache automatically).
- [ ] **Step 2: Manual full-app offline verification pass**: serve the project with `python3 -m http.server` from the project root, load it once online, confirm the service worker activates (DevTools → Application → Service Workers, and Cache Storage shows `vtaper-coach-v1` with every static file listed), then: reload once and confirm data entered earlier (settings, a logged set, a diet check, a body metric) is all still present; enable DevTools "Offline" mode and reload — confirm the app still loads and every tab (Today, Diet, Body, Progress, Settings) still renders and accepts new input while offline; re-enable network and confirm no errors appear in the console from the offline round trip.
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add deployment and update instructions"
```
