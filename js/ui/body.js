// js/ui/body.js
// The Body tab — daily weight / steps / sleep entry, weekly waist (Monday-
// prompted, but always editable), every-4-weeks shoulder measurement, plus
// four plain-SVG charts (js/charts.js, no chart library): weight 7-day
// rolling average, waist, shoulder:waist V-taper ratio, and a strength-trend
// chart with a tab control to pick one of the four tracked lifts.
//
// Persistence shape (bodyMetrics store, keyPath 'date'):
//   {
//     date: 'YYYY-MM-DD',
//     weightKg: number|null,
//     waistCm: number|null,
//     shoulderCm: number|null,
//     steps: number|null,
//     sleepHours: number|null,
//   }
// All fields are optional per day — a day with only a weight entry (the
// common case) simply leaves the rest null. Saving the form with a field
// left blank stores null for that field (explicit clear), not "leave
// whatever was there before" — the form is always pre-filled from today's
// existing record, so clearing a box is a deliberate edit, not data loss.
//
// Missing-waist/shoulder fallback (not fully specified in the task brief):
// the V-taper ratio and its chart need SOME value for "shoulder" and
// "waist" even though shoulder is measured ~12x less often than waist. This
// forward-fills: scanning all bodyMetrics chronologically, every time a
// waistCm or shoulderCm value is seen it becomes the "last known" value for
// that measurement, and a ratio point is only emitted once BOTH a waist and
// a shoulder value have been seen at least once. Until then — e.g. a
// trainee who has logged a week of waist numbers but no shoulder measurement
// yet — the ratio stat and chart show an explicit "not enough data" message
// instead of crashing on a null/undefined divide.

import {
  getBodyMetric, putBodyMetric, getAllBodyMetrics, getExerciseHistory, getSetting,
} from '../db.js';
import { rollingAverage, buildSVGLineChart } from '../charts.js';
import { getWeekInfo, getDayKeyForDate, isCheckinWeek } from '../week.js';

const CHART_WIDTH = 320;
const CHART_HEIGHT = 120;
const CHART_COLOR = '#35e0a1'; // matches --accent in css/styles.css

const TRACKED_EXERCISES = [
  { id: 'incline-db-press', label: 'Incline DB press' },
  { id: 'lat-pulldown', label: 'Lat pulldown' },
  { id: 'single-arm-cable-lateral-raise', label: 'Cable lateral raise' },
  { id: 'leg-press', label: 'Leg press' },
];

// Which tracked lift the strength-trend chart currently shows. A single
// scalar that persists the trainee's last pick across re-renders/tab
// revisits (router.js re-invokes renderBodyTab on every activation) — this
// does NOT accumulate across renders the way a Set of DOM-node references
// would (the Task 11 bug this task was warned about): it's one string,
// always fully overwritten, never appended to or left pointing at detached
// nodes.
let selectedExerciseId = TRACKED_EXERCISES[0].id;

/** Local (not UTC) today as 'YYYY-MM-DD' — same convention as today.js/diet.js. */
function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultBodyMetric(date) {
  return {
    date, weightKg: null, waistCm: null, shoulderCm: null, steps: null, sleepHours: null,
  };
}

function parseOptionalNumber(value) {
  if (value === '' || value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Styles (injected once).
// ---------------------------------------------------------------------------

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || document.getElementById('body-styles')) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'body-styles';
  style.textContent = `
    .body-heading {
      margin: 0 0 4px;
      font-size: 1.1rem;
    }
    .body-note {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 0 0 16px;
    }
    .body-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 16px;
    }
    .body-section h3 {
      margin: 0 0 8px;
      font-size: 0.95rem;
    }
    .body-due-note {
      color: var(--accent);
      font-size: 0.78rem;
      margin: 0 0 6px;
      font-weight: 600;
    }
    .body-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .body-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .body-field label {
      font-size: 0.82rem;
      color: var(--text-dim);
    }
    .body-field input {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
      padding: 8px 10px;
      min-height: var(--tap-min);
      width: 100%;
      box-sizing: border-box;
    }
    .body-save-btn {
      min-height: var(--tap-min);
      border: none;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--accent-text);
      font-weight: 600;
      padding: 8px 12px;
    }
    .body-stats {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .body-stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
    }
    .body-stat-row .body-stat-value {
      font-weight: 600;
    }
    .body-stat-fallback {
      color: var(--text-dim);
      font-size: 0.8rem;
      font-style: italic;
    }
    .body-chart-caption {
      color: var(--text-dim);
      font-size: 0.75rem;
      margin: 4px 0 0;
    }
    .body-chart-empty {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 0;
    }
    .body-exercise-tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .body-exercise-tab {
      font-size: 0.82rem;
      padding: 6px 10px;
      min-height: var(--tap-min);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
    }
    .body-exercise-tab.is-active {
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .body-chart-svg {
      display: block;
      width: 100%;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Series helpers (pure, local to this module).
// ---------------------------------------------------------------------------

/**
 * Builds chart points from a chronologically-sorted list of
 * { date, value } pairs. x is days-since-the-series'-own-first-date (not a
 * plain index) so real gaps between entries are reflected in the chart's
 * spacing, scoped independently per chart/series. The original `date` is
 * kept alongside `x`/`y` (buildSVGLineChart only reads x/y and ignores the
 * extra key) so callers can still build date-based captions from the same
 * points array without a second parallel list.
 */
function toDayOffsetPoints(entries) {
  if (entries.length === 0) return [];
  const firstMs = Date.parse(entries[0].date);
  return entries.map((e) => ({
    x: Math.round((Date.parse(e.date) - firstMs) / 86400000),
    y: e.value,
    date: e.date,
  }));
}

/** Sorted (by date, ascending) { date, value } pairs for one body-metric field. */
function fieldSeries(allMetrics, field) {
  return allMetrics
    .filter((m) => m[field] != null)
    .map((m) => ({ date: m.date, value: m[field] }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Forward-filled V-taper ratio series: scanning all bodyMetrics
 * chronologically, tracks the last-seen waist and shoulder values, and
 * emits one ratio point each time EITHER value updates, once both have
 * been seen at least once. See the module-level comment above for the
 * rationale (shoulder is measured far less often than waist).
 */
function vTaperRatioSeries(allMetrics) {
  const sorted = [...allMetrics].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let lastWaist = null;
  let lastShoulder = null;
  const points = [];
  for (const m of sorted) {
    if (m.waistCm != null) lastWaist = m.waistCm;
    if (m.shoulderCm != null) lastShoulder = m.shoulderCm;
    if ((m.waistCm != null || m.shoulderCm != null) && lastWaist != null && lastShoulder != null) {
      points.push({ date: m.date, value: lastShoulder / lastWaist });
    }
  }
  return points;
}

/**
 * Heaviest WORKING (non-warm-up) set weight per logged session, in
 * chronological order, for one exercise's history
 * (ExercisePerformance[]: { date, weekNumber, sets: [{weight, reps, rir,
 * isWarmup}] } — see js/db.js getExerciseHistory). A session with sets
 * logged but every one of them marked warm-up contributes no point (there
 * is no working-set weight to plot for it) rather than a misleading 0 or a
 * warm-up weight.
 */
function strengthTrendSeries(history) {
  const points = [];
  for (const entry of history) {
    const workingWeights = (entry.sets ?? [])
      .filter((s) => !s.isWarmup)
      .map((s) => s.weight);
    if (workingWeights.length === 0) continue;
    points.push({ date: entry.date, value: Math.max(...workingWeights) });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

function renderChartSection(title, dueNote, points, captionFn) {
  const section = document.createElement('div');
  section.className = 'body-section';

  const heading = document.createElement('h3');
  heading.textContent = title;
  section.appendChild(heading);

  if (dueNote) {
    const note = document.createElement('p');
    note.className = 'body-due-note';
    note.textContent = dueNote;
    section.appendChild(note);
  }

  if (points.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'body-chart-empty';
    empty.textContent = 'Not enough data yet — log a few entries to see this chart.';
    section.appendChild(empty);
    return section;
  }

  const svgMarkup = buildSVGLineChart(
    points,
    { width: CHART_WIDTH, height: CHART_HEIGHT, color: CHART_COLOR, padding: 10 },
  );
  const wrap = document.createElement('div');
  wrap.className = 'body-chart-svg';
  wrap.innerHTML = svgMarkup;
  section.appendChild(wrap);

  if (captionFn) {
    const caption = document.createElement('p');
    caption.className = 'body-chart-caption';
    caption.textContent = captionFn(points);
    section.appendChild(caption);
  }

  return section;
}

function rangeCaption(points) {
  const first = points[0].date;
  const last = points[points.length - 1].date;
  return first === last ? first : `${first} → ${last}`;
}

function renderEntryForm(metric, onSave, isWaistDue, isShoulderDue) {
  const section = document.createElement('div');
  section.className = 'body-section';

  const heading = document.createElement('h3');
  heading.textContent = "Today's entry";
  section.appendChild(heading);

  const form = document.createElement('form');
  form.className = 'body-form';

  function field(name, labelText, value, step, dueNote) {
    const wrap = document.createElement('div');
    wrap.className = 'body-field';
    if (dueNote) {
      const note = document.createElement('p');
      note.className = 'body-due-note';
      note.textContent = dueNote;
      wrap.appendChild(note);
    }
    const label = document.createElement('label');
    label.textContent = labelText;
    label.setAttribute('for', `body-field-${name}`);
    const input = document.createElement('input');
    input.id = `body-field-${name}`;
    input.name = name;
    input.type = 'number';
    input.step = step;
    input.inputMode = 'decimal';
    if (value != null) input.value = String(value);
    wrap.append(label, input);
    return wrap;
  }

  form.appendChild(field('weightKg', 'Weight (kg)', metric.weightKg, '0.1'));
  form.appendChild(field(
    'waistCm',
    'Waist (cm) — weekly',
    metric.waistCm,
    '0.1',
    isWaistDue ? 'Waist check-in day (Monday) — log this week\'s measurement.' : null,
  ));
  form.appendChild(field(
    'shoulderCm',
    'Shoulders (cm) — every 4 weeks',
    metric.shoulderCm,
    '0.1',
    isShoulderDue ? 'Due this check-in week — log your shoulder measurement.' : null,
  ));
  form.appendChild(field('steps', 'Steps', metric.steps, '1'));
  form.appendChild(field('sleepHours', 'Sleep (hours)', metric.sleepHours, '0.1'));

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'body-save-btn';
  saveBtn.textContent = 'Save';
  form.appendChild(saveBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const updated = {
      ...metric,
      weightKg: parseOptionalNumber(formData.get('weightKg')),
      waistCm: parseOptionalNumber(formData.get('waistCm')),
      shoulderCm: parseOptionalNumber(formData.get('shoulderCm')),
      steps: parseOptionalNumber(formData.get('steps')),
      sleepHours: parseOptionalNumber(formData.get('sleepHours')),
    };
    await onSave(updated);
  });

  section.appendChild(form);
  return section;
}

function renderStatsSection(rollingAvgWeight, latestWaist, latestShoulder, currentRatio) {
  const section = document.createElement('div');
  section.className = 'body-section';

  const heading = document.createElement('h3');
  heading.textContent = 'Current stats';
  section.appendChild(heading);

  const stats = document.createElement('div');
  stats.className = 'body-stats';

  function row(label, value) {
    const r = document.createElement('div');
    r.className = 'body-stat-row';
    r.innerHTML = `<span>${label}</span><span class="body-stat-value">${value}</span>`;
    return r;
  }

  stats.appendChild(row(
    '7-day avg weight',
    rollingAvgWeight != null ? `${rollingAvgWeight.toFixed(1)} kg` : 'No weight entries yet',
  ));
  stats.appendChild(row('Latest waist', latestWaist != null ? `${latestWaist} cm` : 'Not logged yet'));
  stats.appendChild(row('Latest shoulders', latestShoulder != null ? `${latestShoulder} cm` : 'Not logged yet'));

  if (currentRatio != null) {
    stats.appendChild(row('V-taper ratio (shoulder ÷ waist)', currentRatio.toFixed(2)));
  } else {
    const fallback = document.createElement('p');
    fallback.className = 'body-stat-fallback';
    fallback.textContent = 'Log both a shoulder and a waist measurement to see your V-taper ratio.';
    stats.appendChild(fallback);
  }

  section.appendChild(stats);
  return section;
}

function renderStrengthSection(onSelect) {
  const section = document.createElement('div');
  section.className = 'body-section';

  const heading = document.createElement('h3');
  heading.textContent = 'Strength trend';
  section.appendChild(heading);

  const tabs = document.createElement('div');
  tabs.className = 'body-exercise-tabs';
  TRACKED_EXERCISES.forEach((ex) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = ex.id === selectedExerciseId ? 'body-exercise-tab is-active' : 'body-exercise-tab';
    btn.textContent = ex.label;
    btn.setAttribute('aria-pressed', String(ex.id === selectedExerciseId));
    btn.addEventListener('click', () => onSelect(ex.id));
    tabs.appendChild(btn);
  });
  section.appendChild(tabs);

  return section;
}

/**
 * @param {HTMLElement} container
 */
export async function renderBodyTab(container) {
  injectStyles();

  const today = todayISO();
  const settings = await getSetting();

  let weekNumber = null;
  let dayKey;
  if (settings?.startDate) {
    const info = getWeekInfo(settings.startDate, today);
    weekNumber = info.weekNumber;
    dayKey = info.dayKey;
  } else {
    dayKey = getDayKeyForDate(today);
  }

  const isWaistDue = dayKey === 'mon';
  // "Every 4 weeks" reuses the plan's existing check-in cadence (weeks 4, 8,
  // 12 — js/week.js isCheckinWeek) rather than a separate calendar rule: the
  // spec's 4-week check-ins are exactly where the shoulder measurement is
  // meant to be retaken, and that's the only "every 4 weeks" cadence this
  // app already defines. Before a start date is set (weekNumber === null)
  // there's no check-in schedule yet, so no "due" nudge is shown — the field
  // itself is still always there and editable regardless.
  const isShoulderDue = weekNumber !== null && isCheckinWeek(weekNumber);

  const [metric, allMetrics] = await Promise.all([
    getBodyMetric(today).then((m) => m ?? defaultBodyMetric(today)),
    getAllBodyMetrics(),
  ]);

  async function handleSave(updated) {
    await putBodyMetric(updated);
    await renderBodyTab(container);
  }

  async function handleSelectExercise(exerciseId) {
    selectedExerciseId = exerciseId;
    await renderBodyTab(container);
  }

  // --- Series for charts/stats ---------------------------------------------

  const weightEntries = fieldSeries(allMetrics, 'weightKg');
  const weightValues = weightEntries.map((e) => e.value);
  const weightRollingAvg = rollingAverage(weightValues, 7);
  const weightAvgEntries = weightEntries.map((e, i) => ({ date: e.date, value: weightRollingAvg[i] }));
  const weightPoints = toDayOffsetPoints(weightAvgEntries);
  const latestRollingAvgWeight = weightRollingAvg.length > 0
    ? weightRollingAvg[weightRollingAvg.length - 1]
    : null;

  const waistEntries = fieldSeries(allMetrics, 'waistCm');
  const waistPoints = toDayOffsetPoints(waistEntries);
  const latestWaist = waistEntries.length > 0 ? waistEntries[waistEntries.length - 1].value : null;

  const shoulderEntries = fieldSeries(allMetrics, 'shoulderCm');
  const latestShoulder = shoulderEntries.length > 0
    ? shoulderEntries[shoulderEntries.length - 1].value
    : null;

  const ratioEntries = vTaperRatioSeries(allMetrics);
  const ratioPoints = toDayOffsetPoints(ratioEntries);
  const currentRatio = ratioEntries.length > 0 ? ratioEntries[ratioEntries.length - 1].value : null;

  const exerciseHistory = await getExerciseHistory(selectedExerciseId);
  const strengthEntries = strengthTrendSeries(exerciseHistory);
  const strengthPoints = toDayOffsetPoints(strengthEntries);
  const selectedExerciseLabel = TRACKED_EXERCISES.find((e) => e.id === selectedExerciseId)?.label ?? '';

  // --- Build DOM -------------------------------------------------------------

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'body-tab';

  const heading = document.createElement('h1');
  heading.className = 'body-heading';
  heading.textContent = 'Body';
  root.appendChild(heading);

  const note = document.createElement('p');
  note.className = 'body-note';
  note.textContent = 'Track weight daily, waist weekly, shoulders every 4 weeks.';
  root.appendChild(note);

  root.appendChild(renderEntryForm(metric, handleSave, isWaistDue, isShoulderDue));
  root.appendChild(renderStatsSection(latestRollingAvgWeight, latestWaist, latestShoulder, currentRatio));

  root.appendChild(renderChartSection('Weight — 7-day rolling average', null, weightPoints, rangeCaption));
  root.appendChild(renderChartSection('Waist', null, waistPoints, rangeCaption));
  root.appendChild(renderChartSection('V-taper ratio (shoulder ÷ waist)', null, ratioPoints, rangeCaption));

  const strengthSection = renderStrengthSection(handleSelectExercise);
  if (strengthPoints.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'body-chart-empty';
    empty.textContent = `Not enough data yet for ${selectedExerciseLabel} — log a session on the Today tab.`;
    strengthSection.appendChild(empty);
  } else {
    const svgMarkup = buildSVGLineChart(
      strengthPoints,
      { width: CHART_WIDTH, height: CHART_HEIGHT, color: CHART_COLOR, padding: 10 },
    );
    const wrap = document.createElement('div');
    wrap.className = 'body-chart-svg';
    wrap.innerHTML = svgMarkup;
    strengthSection.appendChild(wrap);

    const caption = document.createElement('p');
    caption.className = 'body-chart-caption';
    caption.textContent = rangeCaption(strengthPoints);
    strengthSection.appendChild(caption);
  }
  root.appendChild(strengthSection);

  container.appendChild(root);
}
