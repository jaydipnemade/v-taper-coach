// js/ui/progress.js
// The Progress tab — 12-week log table plus the 4-week check-in wizard at
// weeks 4, 8 and 12.
//
// --- Judgment calls made in this module (see task-15-report.md for the full
// write-up) --------------------------------------------------------------
//
// 1. "Completed week" / table rows: the table always shows all 12 rows
//    (weeks 1-12), with blank ('—') cells for a week that hasn't been
//    reached yet or has no data — rather than only rendering rows for
//    weeks strictly before the current week. This keeps the table's shape
//    stable across the whole program (no rows appearing/disappearing week
//    to week) and means a fresh install with zero data renders a full,
//    non-crashing 12-blank-row table instead of an empty table or a
//    conditional "no rows yet" branch.
//
// 2. Per-week date -> week-number mapping reuses js/week.js's own exported
//    `getWeekNumber(startDateISO, dateISO)` for every bodyMetrics record's
//    date, rather than re-deriving week boundaries locally. That function
//    is already reviewed/approved (Task 3) and is the single source of
//    truth for "which week is this date in", so this module never computes
//    week boundaries itself for that purpose. (It only computes the inverse
//    operation — "what is week N's start/end date" — locally via
//    `weekStartISO`/`weekEndISO`, which is plain date arithmetic needed for
//    `computeWeekAverages`' range arguments and has no existing exported
//    helper to reuse.)
//
// 3. The four tracked-lift columns use each exerciseHistory entry's own
//    `weekNumber` field (set by js/ui/today.js from the same getWeekInfo()
//    call that logged the session) rather than re-deriving a week number
//    from the entry's `date` — this is the exact week number the app
//    already assigned that session, so re-deriving independently from the
//    date could only ever introduce a second, possibly-inconsistent source
//    of truth for the same fact.
//
// 4. Per-week notes: stored on the `bodyMetrics` record for that week's
//    Monday (the date `weekStartISO(startDate, weekNumber)`), in an
//    optional `notes` field. A free-text input is always available per row
//    (not just on checkin weeks) and merges into whatever bodyMetrics
//    record already exists for that date (read-then-put) so it never
//    clobbers a weight/waist/etc. entry already logged for that Monday.
//
// 5. Check-in wizard inputs: `liftsTrend` and `bloatPersisted` are ALWAYS
//    both asked (one small form, shown together) rather than conditionally
//    showing `bloatPersisted` only when the "bloating or fat gain" branch
//    of calorieDecision is about to match — determining that in advance
//    would mean re-implementing calorieDecision's own priority-ordered
//    branch logic here just to decide what to ask, which duplicates the
//    pure function this module is supposed to treat as a black box. Asking
//    both unconditionally is simpler, always correct, and the unused input
//    (bloatPersisted when that branch doesn't match) is simply ignored by
//    calorieDecision itself.
//
// 6. `phase` for calorieDecision is derived with the exact same membership
//    check js/nutrition.js's `getTargetsForWeek` uses against
//    NUTRITION_PHASES (recomp vs leanGain), re-reading NUTRITION_PHASES
//    directly from js/data/plan.js — NOT from BLOCK_STRUCTURE's training-
//    block `phase` field (intro/build1/deload/build2/deload2), which uses
//    different week boundaries entirely (e.g. week 5 is BLOCK_STRUCTURE's
//    `build1` but NUTRITION_PHASES' `leanGain`) and is not the recomp/
//    leanGain axis calorieDecision expects. This reuses the single existing
//    "which nutrition phase is this week" source of truth instead of
//    inventing a second one.
//
// 7. weightDelta4wk / waistDelta4wk (calorieDecision's inputs) are computed
//    as (avg over the check-in week's own 7 days) minus (avg over the first
//    of the four weeks' own 7 days) — i.e. the two single-week endpoints of
//    the 4-week window — using `computeWeekAverages` for each endpoint
//    week. CHECKIN_TARGETS' ranges (e.g. `waistPer4WeeksCm`) are framed as
//    a change over the review period, which this matches; a single call
//    spanning the whole 4-week range would only give a blended average, not
//    a delta. If EITHER endpoint's own average is unavailable (no data
//    logged that week), that delta (weight's or waist's — checked
//    independently, not both-or-nothing) is forced to exactly 0 rather than
//    computed by defaulting just the missing side to 0 before subtracting
//    (which would manufacture a fake delta out of the one side that does
//    have data). The wizard shows an explicit warning naming which of the
//    two is affected whenever this happens.
//
// 8. Confirming a check-in updates `settings.calorieOverride` by REMOVING
//    this week's previous checkin's kcalChange (if re-running a check-in
//    already done for this week) and ADDING the new one — i.e. each
//    distinct check-in week (4, 8, 12) contributes its own kcalChange once,
//    cumulatively, and re-running the same week's check-in replaces rather
//    than double-applies its contribution.

import { computeWeekAverages, calorieDecision } from '../checkin.js';
import { getWeekInfo, getWeekNumber } from '../week.js';
import {
  getAllBodyMetrics, getExerciseHistory, getBodyMetric, putBodyMetric,
  getCheckin, putCheckin, getSetting, putSetting,
} from '../db.js';
import { NUTRITION_PHASES } from '../data/plan.js';

const PLAN_WEEKS = 12;

const TRACKED_LIFTS = [
  { id: 'incline-db-press', label: 'Incline DB press' },
  { id: 'lat-pulldown', label: 'Lat pulldown' },
  { id: 'single-arm-cable-lateral-raise', label: 'Cable lateral raise' },
  { id: 'leg-press', label: 'Leg press' },
];

// Transient check-in-wizard UI state. A single plain object, always fully
// overwritten (never appended to, never holding a DOM node reference), so
// it cannot leak/accumulate across repeated renderProgressTab calls — the
// same safe pattern js/ui/body.js's module-level `selectedExerciseId`
// already uses for the same reason (router.js re-invokes the render
// function on every tab activation, not just once).
let checkinWizardState = null; // null | { weekNumber, step: 'form'|'result', liftsTrend, bloatPersisted, result, warning }

/** Local (not UTC) today as 'YYYY-MM-DD' — same convention as diet.js/body.js. */
function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Start (Monday-equivalent, day 0 of the week) ISO date of plan week `weekNumber`. */
function weekStartISO(startDateISO, weekNumber) {
  return addDaysISO(startDateISO, (weekNumber - 1) * 7);
}

/** End (last day) ISO date of plan week `weekNumber`. */
function weekEndISO(startDateISO, weekNumber) {
  return addDaysISO(startDateISO, weekNumber * 7 - 1);
}

function average(values) {
  const finite = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return finite.length === 0 ? null : finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

/**
 * Mirrors js/nutrition.js's getTargetsForWeek phase-selection logic exactly
 * (same NUTRITION_PHASES source) — see judgment call 6 above.
 */
function getNutritionPhaseForWeek(weekNumber) {
  return NUTRITION_PHASES.recomp.weeks.includes(weekNumber) ? 'recomp' : 'leanGain';
}

function fmt(value, digits, suffix) {
  return value == null ? '—' : `${value.toFixed(digits)}${suffix ?? ''}`;
}

// ---------------------------------------------------------------------------
// Styles (injected once).
// ---------------------------------------------------------------------------

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || document.getElementById('progress-styles')) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'progress-styles';
  style.textContent = `
    .progress-heading {
      margin: 0 0 4px;
      font-size: 1.1rem;
    }
    .progress-note {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 0 0 16px;
    }
    .progress-section {
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--card-shadow);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 16px;
    }
    .progress-section h3 {
      margin: 0 0 8px;
      font-size: 0.95rem;
    }
    .progress-table-wrap {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .progress-table {
      border-collapse: collapse;
      width: 100%;
      min-width: 820px;
      font-size: 0.8rem;
    }
    .progress-table th,
    .progress-table td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      text-align: center;
      white-space: nowrap;
    }
    .progress-table th {
      color: var(--text-dim);
      font-weight: 600;
      background: var(--surface-alt);
    }
    .progress-table tr.is-current-week td {
      border-top: 1px solid var(--accent);
      border-bottom: 1px solid var(--accent);
    }
    .progress-note-input {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
      padding: 4px 6px;
      min-width: 110px;
      min-height: var(--tap-min);
      box-sizing: border-box;
      font-size: 0.78rem;
    }
    .checkin-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 10px;
    }
    .checkin-field label {
      font-size: 0.82rem;
      color: var(--text-dim);
    }
    .checkin-field select {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
      padding: 8px 10px;
      min-height: var(--tap-min);
    }
    .checkin-lift-hint {
      list-style: none;
      margin: 0 0 10px;
      padding: 0;
      font-size: 0.78rem;
      color: var(--text-dim);
    }
    .checkin-lift-hint li {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .checkin-btn {
      min-height: var(--tap-min);
      border: none;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--accent-text);
      font-weight: 600;
      padding: 8px 14px;
      margin-right: 8px;
    }
    .checkin-btn.is-secondary {
      background: var(--surface-alt);
      color: inherit;
      border: 1px solid var(--border);
    }
    .checkin-warning {
      color: var(--danger);
      font-size: 0.8rem;
      margin: 0 0 10px;
    }
    .checkin-result {
      background: var(--surface-alt);
      border-radius: var(--radius);
      padding: 10px 12px;
      margin: 10px 0;
    }
    .checkin-result p {
      margin: 0 0 4px;
      font-size: 0.9rem;
    }
    .checkin-result .checkin-decision {
      font-weight: 700;
      color: var(--accent);
    }
    .checkin-done-note {
      font-size: 0.85rem;
      color: var(--text-dim);
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Data shaping.
// ---------------------------------------------------------------------------

/**
 * Builds a Map<'YYYY-MM-DD', bodyMetric> for O(1) lookups of a given week's
 * canonical note-date record.
 */
function buildDateMap(allMetrics) {
  const map = new Map();
  for (const m of allMetrics) map.set(m.date, m);
  return map;
}

/**
 * Per-week (1-12) averaged body-metric stats, built by mapping every
 * bodyMetrics record's date to a week number via js/week.js's
 * `getWeekNumber` (see judgment call 2). Records outside the 12-week plan
 * (before the start date, or null `startDateISO`) contribute nothing — the
 * returned array always has exactly 12 entries, with null fields for a week
 * with no matching data.
 */
function buildWeeklyBodyStats(allMetrics, startDateISO) {
  const buckets = Array.from({ length: PLAN_WEEKS }, () => ({
    weight: [], waist: [], shoulder: [], steps: [], sleep: [],
  }));

  if (startDateISO) {
    for (const m of allMetrics) {
      const wn = getWeekNumber(startDateISO, m.date);
      if (wn == null) continue;
      const bucket = buckets[wn - 1];
      if (typeof m.weightKg === 'number') bucket.weight.push(m.weightKg);
      if (typeof m.waistCm === 'number') bucket.waist.push(m.waistCm);
      if (typeof m.shoulderCm === 'number') bucket.shoulder.push(m.shoulderCm);
      if (typeof m.steps === 'number') bucket.steps.push(m.steps);
      if (typeof m.sleepHours === 'number') bucket.sleep.push(m.sleepHours);
    }
  }

  return buckets.map((b) => ({
    avgWeight: average(b.weight),
    avgWaist: average(b.waist),
    avgShoulder: average(b.shoulder),
    avgSteps: average(b.steps),
    avgSleep: average(b.sleep),
  }));
}

/**
 * Per-week (1-12) heaviest-working-set weight for each tracked lift (see
 * judgment call 3). Returns { [exerciseId]: Array<number|null> } (length 12).
 *
 * Buckets by `getWeekNumber(startDateISO, entry.date)` — i.e. the CURRENT
 * block's week for that calendar date — rather than the entry's own stored
 * `weekNumber` field. The stored field is whatever block was active when the
 * set was logged, so using it directly would let a prior block's lift data
 * bleed into a new block's log table and check-in lift-trend hints once
 * `startDate` moves forward (final-review batch C follow-up).
 * @param {string|null} startDateISO
 */
async function buildWeeklyLiftStats(startDateISO) {
  const histories = await Promise.all(TRACKED_LIFTS.map((l) => getExerciseHistory(l.id)));
  const result = {};
  TRACKED_LIFTS.forEach((lift, idx) => {
    const perWeek = Array(PLAN_WEEKS).fill(null);
    if (!startDateISO) {
      result[lift.id] = perWeek;
      return;
    }
    for (const entry of histories[idx]) {
      const wn = getWeekNumber(startDateISO, entry.date);
      if (!Number.isInteger(wn) || wn < 1 || wn > PLAN_WEEKS) continue;
      const workingWeights = (entry.sets ?? [])
        .filter((s) => !s.isWarmup)
        .map((s) => s.weight);
      if (workingWeights.length === 0) continue;
      const heaviest = Math.max(...workingWeights);
      if (perWeek[wn - 1] == null || heaviest > perWeek[wn - 1]) {
        perWeek[wn - 1] = heaviest;
      }
    }
    result[lift.id] = perWeek;
  });
  return result;
}

// ---------------------------------------------------------------------------
// 12-week log table.
// ---------------------------------------------------------------------------

function renderLogTable(bodyStats, liftStats, dateMap, startDateISO, currentWeekNumber, onNoteSaved) {
  const section = document.createElement('div');
  section.className = 'progress-section';

  const heading = document.createElement('h3');
  heading.textContent = '12-week log';
  section.appendChild(heading);

  if (!startDateISO) {
    const note = document.createElement('p');
    note.className = 'progress-note';
    note.textContent = 'Set your start date in Settings to see week-by-week progress.';
    section.appendChild(note);
  }

  const wrap = document.createElement('div');
  wrap.className = 'progress-table-wrap';

  const table = document.createElement('table');
  table.className = 'progress-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Week</th>
      <th>Weight</th>
      <th>Waist</th>
      <th>Shoulders</th>
      <th>Incline DB press</th>
      <th>Lat pulldown</th>
      <th>Cable lateral raise</th>
      <th>Leg press</th>
      <th>Steps</th>
      <th>Sleep</th>
      <th>Notes</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let weekNumber = 1; weekNumber <= PLAN_WEEKS; weekNumber += 1) {
    const stats = bodyStats[weekNumber - 1];
    const tr = document.createElement('tr');
    if (weekNumber === currentWeekNumber) tr.className = 'is-current-week';

    const cell = (text) => {
      const td = document.createElement('td');
      td.textContent = text;
      return td;
    };

    tr.appendChild(cell(String(weekNumber)));
    tr.appendChild(cell(fmt(stats.avgWeight, 1, ' kg')));
    tr.appendChild(cell(fmt(stats.avgWaist, 1, ' cm')));
    tr.appendChild(cell(fmt(stats.avgShoulder, 1, ' cm')));
    TRACKED_LIFTS.forEach((lift) => {
      const weight = liftStats[lift.id][weekNumber - 1];
      tr.appendChild(cell(weight == null ? '—' : `${weight} kg`));
    });
    tr.appendChild(cell(stats.avgSteps == null ? '—' : String(Math.round(stats.avgSteps))));
    tr.appendChild(cell(fmt(stats.avgSleep, 1, ' h')));

    const notesTd = document.createElement('td');
    const noteDate = startDateISO ? weekStartISO(startDateISO, weekNumber) : null;
    const existingNote = noteDate ? (dateMap.get(noteDate)?.notes ?? '') : '';
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.className = 'progress-note-input';
    noteInput.value = existingNote;
    noteInput.placeholder = 'Note';
    noteInput.disabled = !startDateISO;
    noteInput.setAttribute('aria-label', `Note for week ${weekNumber}`);
    noteInput.addEventListener('change', async () => {
      await onNoteSaved(noteDate, noteInput.value);
    });
    notesTd.appendChild(noteInput);
    tr.appendChild(notesTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

// ---------------------------------------------------------------------------
// Check-in wizard.
// ---------------------------------------------------------------------------

// checkin.decision/checkin.action originate from IndexedDB (a `checkins`
// record), which an imported backup file could have populated with
// arbitrary strings — rendered via textContent (never innerHTML) below as
// defense in depth against a crafted backup injecting markup.
function renderCheckinSummary(checkin) {
  const wrap = document.createElement('div');
  wrap.className = 'checkin-result';

  const decisionEl = document.createElement('p');
  decisionEl.className = 'checkin-decision';
  decisionEl.textContent = checkin.decision;

  const actionEl = document.createElement('p');
  actionEl.textContent = checkin.action;

  const noteEl = document.createElement('p');
  noteEl.className = 'checkin-done-note';
  noteEl.textContent = `Applied ${checkin.kcalChange >= 0 ? '+' : ''}${checkin.kcalChange} kcal/day to your calorie target.`;

  wrap.append(decisionEl, actionEl, noteEl);
  return wrap;
}

/**
 * @param {object} args
 * @param {number} args.weekNumber current (checkin) week
 * @param {string} args.startDateISO
 * @param {Array<object>} args.allMetrics
 * @param {object} args.liftStats per-lift per-week heaviest-set array (see buildWeeklyLiftStats)
 * @param {object|null} args.existingCheckin saved checkins record for this week, if any
 * @param {() => Promise<void>} args.rerender
 */
function renderCheckinSection({
  weekNumber, startDateISO, allMetrics, liftStats, existingCheckin, rerender,
}) {
  const section = document.createElement('div');
  section.className = 'progress-section';

  const heading = document.createElement('h3');
  heading.textContent = `Week ${weekNumber} check-in`;
  section.appendChild(heading);

  if (existingCheckin && checkinWizardState?.weekNumber !== weekNumber) {
    const note = document.createElement('p');
    note.className = 'progress-note';
    note.textContent = 'Already checked in for this week.';
    section.appendChild(note);
    section.appendChild(renderCheckinSummary(existingCheckin));

    const rerunBtn = document.createElement('button');
    rerunBtn.type = 'button';
    rerunBtn.className = 'checkin-btn is-secondary';
    rerunBtn.textContent = 'Re-run check-in';
    rerunBtn.addEventListener('click', async () => {
      checkinWizardState = { weekNumber, step: 'form', liftsTrend: 'flat', bloatPersisted: false };
      await rerender();
    });
    section.appendChild(rerunBtn);
    return section;
  }

  if (!checkinWizardState || checkinWizardState.weekNumber !== weekNumber) {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'checkin-btn';
    startBtn.textContent = 'Run check-in';
    startBtn.addEventListener('click', async () => {
      checkinWizardState = { weekNumber, step: 'form', liftsTrend: 'flat', bloatPersisted: false };
      await rerender();
    });
    section.appendChild(startBtn);
    return section;
  }

  // --- Wizard is open for this week -----------------------------------

  const firstWeek = weekNumber - 3;
  const firstAvg = computeWeekAverages(
    allMetrics, weekStartISO(startDateISO, firstWeek), weekEndISO(startDateISO, firstWeek),
  );
  const lastAvg = computeWeekAverages(
    allMetrics, weekStartISO(startDateISO, weekNumber), weekEndISO(startDateISO, weekNumber),
  );
  // Each delta is forced to 0 only when EITHER of its own two endpoints is
  // missing (not by independently defaulting each operand to 0 before
  // subtracting, which would silently manufacture a fake delta whenever
  // only one side had data — e.g. firstAvg null, lastAvg = 80 would wrongly
  // yield a "-80kg lost" or "+80kg gained" delta instead of "unknown").
  const weightMissing = firstAvg.avgWeight == null || lastAvg.avgWeight == null;
  const waistMissing = firstAvg.avgWaist == null || lastAvg.avgWaist == null;
  const missingData = weightMissing || waistMissing;

  // A missing endpoint forces that delta to exactly 0 (see the comment
  // above) — but 0 is ALSO a real, meaningful value calorieDecision checks
  // for (row 2's "surplus too small" match, among others). Calling
  // calorieDecision at all here would let a manufactured "0 change" (really
  // "unknown", not a measured plateau) drive a real, applicable calorie
  // override. So with missing data, this never even offers the decision —
  // no form, no "See decision", no "Confirm & apply" — only a message
  // telling the trainee to log more data first.
  if (missingData) {
    const missingWhich = [
      weightMissing ? 'weight' : null,
      waistMissing ? 'waist' : null,
    ].filter(Boolean).join(' and ');
    const warning = document.createElement('p');
    warning.className = 'checkin-warning';
    warning.textContent = `Not enough data — log more ${missingWhich} entries before this check-in `
      + `(need an average for both week ${firstWeek} and week ${weekNumber}).`;
    section.appendChild(warning);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'checkin-btn is-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', async () => {
      checkinWizardState = null;
      await rerender();
    });
    section.appendChild(cancelBtn);

    return section;
  }

  const liftHints = document.createElement('ul');
  liftHints.className = 'checkin-lift-hint';
  TRACKED_LIFTS.forEach((lift) => {
    const before = liftStats[lift.id][firstWeek - 1];
    const after = liftStats[lift.id][weekNumber - 1];
    const li = document.createElement('li');
    const beforeText = before == null ? '—' : `${before} kg`;
    const afterText = after == null ? '—' : `${after} kg`;
    li.innerHTML = `<span>${lift.label}</span><span>${beforeText} → ${afterText}</span>`;
    liftHints.appendChild(li);
  });
  section.appendChild(liftHints);

  const form = document.createElement('form');

  const liftsField = document.createElement('div');
  liftsField.className = 'checkin-field';
  const liftsLabel = document.createElement('label');
  liftsLabel.textContent = 'How are your lifts trending? (see table above)';
  liftsLabel.setAttribute('for', 'checkin-lifts-trend');
  const liftsSelect = document.createElement('select');
  liftsSelect.id = 'checkin-lifts-trend';
  [['up', 'Going up'], ['flat', 'Flat'], ['down', 'Going down']].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = checkinWizardState.liftsTrend === value;
    liftsSelect.appendChild(opt);
  });
  liftsSelect.addEventListener('change', () => {
    checkinWizardState.liftsTrend = liftsSelect.value;
  });
  liftsField.append(liftsLabel, liftsSelect);
  form.appendChild(liftsField);

  const bloatField = document.createElement('div');
  bloatField.className = 'checkin-field';
  const bloatLabel = document.createElement('label');
  bloatLabel.textContent = 'If weight/waist are flat-but-up: has that persisted for days (not just today)?';
  bloatLabel.setAttribute('for', 'checkin-bloat-persisted');
  const bloatSelect = document.createElement('select');
  bloatSelect.id = 'checkin-bloat-persisted';
  [['false', "No — probably just water/bloat"], ['true', "Yes — it's persisted"]].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    opt.selected = String(checkinWizardState.bloatPersisted) === value;
    bloatSelect.appendChild(opt);
  });
  bloatSelect.addEventListener('change', () => {
    checkinWizardState.bloatPersisted = bloatSelect.value === 'true';
  });
  bloatField.append(bloatLabel, bloatSelect);
  form.appendChild(bloatField);

  section.appendChild(form);

  if (checkinWizardState.step === 'result' && checkinWizardState.result) {
    section.appendChild(renderCheckinSummary(checkinWizardState.result));

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'checkin-btn';
    confirmBtn.textContent = 'Confirm & apply';
    confirmBtn.addEventListener('click', async () => {
      const { result, liftsTrend, bloatPersisted } = checkinWizardState;
      const previous = await getCheckin(weekNumber);
      const previousKcalChange = previous?.kcalChange ?? 0;

      await putCheckin({
        weekNumber,
        decision: result.decision,
        action: result.action,
        kcalChange: result.kcalChange,
        liftsTrend,
        bloatPersisted,
        weightDelta4wk: result.weightDelta4wk,
        waistDelta4wk: result.waistDelta4wk,
        computedAt: todayISO(),
      });

      const settings = await getSetting();
      const newOverride = (settings?.calorieOverride ?? 0) - previousKcalChange + result.kcalChange;
      await putSetting({ ...settings, calorieOverride: newOverride });

      checkinWizardState = null;
      await rerender();
    });
    section.appendChild(confirmBtn);
  } else {
    const computeBtn = document.createElement('button');
    computeBtn.type = 'button';
    computeBtn.className = 'checkin-btn';
    computeBtn.textContent = 'See decision';
    computeBtn.addEventListener('click', async () => {
      const weightDelta4wk = weightMissing ? 0 : lastAvg.avgWeight - firstAvg.avgWeight;
      const waistDelta4wk = waistMissing ? 0 : lastAvg.avgWaist - firstAvg.avgWaist;
      const phase = getNutritionPhaseForWeek(weekNumber);
      const decision = calorieDecision({
        phase,
        weightDelta4wk,
        waistDelta4wk,
        liftsTrend: checkinWizardState.liftsTrend,
        bloatPersisted: checkinWizardState.bloatPersisted,
      });
      checkinWizardState.step = 'result';
      checkinWizardState.result = { ...decision, weightDelta4wk, waistDelta4wk };
      await rerender();
    });
    section.appendChild(computeBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'checkin-btn is-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', async () => {
    checkinWizardState = null;
    await rerender();
  });
  section.appendChild(cancelBtn);

  return section;
}

// ---------------------------------------------------------------------------
// Top-level render.
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 */
export async function renderProgressTab(container) {
  injectStyles();

  const today = todayISO();
  const [settings, allMetrics] = await Promise.all([getSetting(), getAllBodyMetrics()]);
  const startDateISO = settings?.startDate ?? null;

  const weekInfo = startDateISO
    ? getWeekInfo(startDateISO, today)
    : { weekNumber: null, isCheckinWeek: false, isPlanComplete: false };
  const currentWeekNumber = weekInfo.weekNumber;

  // Stale wizard state from a previous week (or from before a start date
  // existed) is discarded rather than shown against the wrong week.
  if (checkinWizardState && checkinWizardState.weekNumber !== currentWeekNumber) {
    checkinWizardState = null;
  }

  const [bodyStats, liftStats, existingCheckin] = await Promise.all([
    Promise.resolve(buildWeeklyBodyStats(allMetrics, startDateISO)),
    buildWeeklyLiftStats(startDateISO),
    currentWeekNumber != null ? getCheckin(currentWeekNumber) : Promise.resolve(null),
  ]);
  const dateMap = buildDateMap(allMetrics);

  async function rerender() {
    await renderProgressTab(container);
  }

  async function handleNoteSaved(noteDate, noteText) {
    if (!noteDate) return;
    const existing = await getBodyMetric(noteDate);
    const base = existing ?? {
      date: noteDate, weightKg: null, waistCm: null, shoulderCm: null, steps: null, sleepHours: null,
    };
    await putBodyMetric({ ...base, notes: noteText });
    await rerender();
  }

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'progress-tab';

  const heading = document.createElement('h1');
  heading.className = 'progress-heading';
  heading.textContent = currentWeekNumber != null ? `Progress — Week ${currentWeekNumber}` : 'Progress';
  root.appendChild(heading);

  if (!startDateISO) {
    const note = document.createElement('p');
    note.className = 'progress-note';
    note.textContent = 'Set your start date in Settings to unlock week-by-week tracking and check-ins.';
    root.appendChild(note);
  }

  // isCheckinWeek is read straight off getWeekInfo()'s result (js/week.js,
  // Task 3) — never a hardcoded [4, 8, 12] check written in this module.
  if (startDateISO && currentWeekNumber != null && weekInfo.isCheckinWeek) {
    root.appendChild(renderCheckinSection({
      weekNumber: currentWeekNumber,
      startDateISO,
      allMetrics,
      liftStats,
      existingCheckin,
      rerender,
    }));
  }

  root.appendChild(renderLogTable(bodyStats, liftStats, dateMap, startDateISO, currentWeekNumber, handleNoteSaved));

  container.appendChild(root);
}
