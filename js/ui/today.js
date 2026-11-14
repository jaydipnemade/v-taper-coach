// js/ui/today.js
// The Today tab — renders the current day's session (warm-up + exercise
// list) or the rest-day view, adjusted for the current week's phase
// (set multiplier, extra sets, RIR overrides, Build 2 exercise swaps).
//
// Tasks 10/11/15 extend this same file with the set logger, rest timer,
// how-to-do-it panel, swap-choice UI, stomach-vacuum timer trigger, and
// warm-up checklist persistence — this task only builds the read-only
// session/exercise-list structure those features hang off of.

import { DAYS, WARMUP_STEPS } from '../data/plan.js';
import { getWeekInfo } from '../week.js';
import { getSetting } from '../db.js';

// ---------------------------------------------------------------------------
// Global exercise-by-id lookup, built once across ALL days (not just
// today's day) — needed to resolve swap pairs where the "other side" of a
// pair lives on a different day entirely (e.g. incline-db-press on Monday
// swaps with incline-smith-press on Thursday).
// ---------------------------------------------------------------------------

const EXERCISE_BY_ID = {};
for (const day of Object.values(DAYS)) {
  for (const exercise of day.exercises) {
    EXERCISE_BY_ID[exercise.id] = exercise;
  }
}

/** Local (not UTC) today as 'YYYY-MM-DD' — matches the format `startDate` is stored in. */
function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Swap resolution.
//
// Two distinct shapes exist in DAYS:
//  - Cross-day pair (incline-db-press / incline-smith-press): each is a
//    full, independent exercise living on its OWN day. Resolving this needs
//    no exclusion logic — we only ever iterate one day's own list at a time,
//    and the partner simply isn't in it, so we just substitute its data in
//    at the active side's slot.
//  - Intra-day pair (t-bar-row / seal-row): BOTH sides live on the SAME
//    day's list. seal-row is a swap-only addition appended at the end
//    (order 9) purely so it has a real PlanExercise to swap in; it must
//    never be rendered at its own slot, in any week — only ever as the
//    substitute at t-bar-row's slot (order 2) during weeks 7-11.
//
// Rather than hand-classify which ids are "swap-only" (seal-row has the
// same kind of `swaps` back-reference as incline-smith-press/incline-db-press,
// so that alone doesn't distinguish them), this resolves generically: when
// an exercise's swap partner is ALSO present in this same day's own list,
// the first one encountered (in slot order) becomes the canonical slot for
// the pair, and the other member is skipped entirely wherever it appears.
// ---------------------------------------------------------------------------

function resolveDayExercises(dayKey, phaseInfo) {
  const day = DAYS[dayKey];
  const dayIds = new Set(day.exercises.map((e) => e.id));

  const activePairs = phaseInfo?.swapPairs ?? [];
  const activePartnerOf = new Map();
  for (const [a, b] of activePairs) {
    activePartnerOf.set(a, b);
    activePartnerOf.set(b, a);
  }

  const skipIds = new Set();
  const resolved = [];

  for (const exercise of day.exercises) {
    if (skipIds.has(exercise.id)) continue;

    const intraPartnerId = (exercise.swaps ?? []).find((id) => dayIds.has(id));

    if (intraPartnerId) {
      // Both sides of this pair live on today's day — only ever render one
      // row for the pair, at this (first-encountered, lower-order) slot.
      skipIds.add(intraPartnerId);
      const isActive = activePartnerOf.get(exercise.id) === intraPartnerId;
      const data = isActive ? EXERCISE_BY_ID[intraPartnerId] : exercise;
      resolved.push({ ...data, slotOrder: exercise.order });
      continue;
    }

    const crossPartnerId = activePartnerOf.get(exercise.id);
    if (crossPartnerId && !dayIds.has(crossPartnerId)) {
      // Cross-day pair, active this week — substitute the other day's
      // exercise data in at this slot.
      resolved.push({ ...EXERCISE_BY_ID[crossPartnerId], slotOrder: exercise.order });
    } else {
      resolved.push({ ...exercise, slotOrder: exercise.order });
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Set-count adjustment: add extraSets.amount (for listed exercise ids),
// then multiply by setMultiplier and round UP (never down — a deload at
// 0.5x on an odd set count should give the trainee the extra set, not take
// one away).
// ---------------------------------------------------------------------------

function adjustedSets(exercise, phaseInfo) {
  let sets = Number(exercise.sets);
  if (phaseInfo?.extraSets?.exerciseIds?.includes(exercise.id)) {
    sets += phaseInfo.extraSets.amount;
  }
  if (typeof phaseInfo?.setMultiplier === 'number') {
    sets = Math.ceil(sets * phaseInfo.setMultiplier);
  }
  return sets;
}

function formatReps(exercise) {
  return exercise.repsLow === exercise.repsHigh
    ? exercise.repsLow
    : `${exercise.repsLow}-${exercise.repsHigh}`;
}

// ---------------------------------------------------------------------------
// RIR adjustments.
//
// Two distinct phase-level RIR fields exist in BLOCK_STRUCTURE, and each one
// only makes sense for a subset of exercises:
//
//  - `rirOverride` (intro week 1 -> '3', deload weeks 6/12 -> '3-4') replaces
//    the exercise's own RIR target for the week. It only applies to
//    exercises that HAVE a real RIR target to begin with — an exercise whose
//    own `rir` is '—' (bodyweight/isometric/cardio work with no RIR concept,
//    e.g. stomach vacuum, dead bug, plank) stays '—' regardless of phase.
//
//  - `isolationLastSetRIR` (Build 2, weeks 7-11 -> 0) is the source plan's
//    "push the last set of ISOLATION exercises to RIR 0" instruction. It
//    must NOT apply to compound/multi-joint lifts (leg press, hip thrust,
//    incline press, hack squat, the primary lat pulldown / chest-supported
//    row, pull-ups, dips, lunges/split squats) — training those to true
//    failure on every set is exactly the kind of risk the plan's exercise
//    selection is designed to avoid. It also never applies to anything with
//    `incrementType: 'bodyweight'` (no RIR target at all) or to an exercise
//    whose own `rir` is '—'.
// ---------------------------------------------------------------------------

// Single-joint / isolation exercise ids that get the Build 2 last-set-RIR-0
// note. Classified by hand against js/data/plan.js's exercise names — see
// the Task 9 fix report for the full rationale and the borderline calls
// (seated-cable-row, kneeling-single-arm-cable-pulldown, kneeling-cable-crunch).
const ISOLATION_EXERCISE_IDS = new Set([
  // Monday
  'single-arm-cable-lateral-raise',
  'low-to-high-cable-fly',
  'overhead-cable-triceps-extension',
  'rope-pushdown',
  // Tuesday
  'leg-extension',
  'seated-leg-curl',
  'standing-calf-raise',
  // Wednesday
  'kneeling-single-arm-cable-pulldown',
  'straight-arm-cable-pulldown',
  'reverse-pec-deck',
  'incline-db-curl',
  'hammer-curl',
  // Thursday
  'machine-lateral-raise',
  'cable-y-raise',
  'face-pull',
  'ez-curl-skull-crusher-superset',
  'close-neutral-grip-lat-pulldown',
  // Friday
  'lying-leg-curl',
  'leg-extension-lower-b',
  'seated-calf-raise',
  'kneeling-cable-crunch',
  // Saturday
  'cable-lateral-raise-both-arms',
  'seated-db-lateral-raise',
  'rear-delt-cable-fly',
  'bayesian-cable-curl',
  'preacher-curl',
  'single-arm-cable-pushdown',
]);

function hasRealRir(exercise) {
  return exercise.rir !== '—';
}

function displayRir(exercise, phaseInfo) {
  if (phaseInfo?.rirOverride && hasRealRir(exercise)) {
    return phaseInfo.rirOverride;
  }
  return exercise.rir;
}

function lastSetRirNote(exercise, phaseInfo) {
  if (phaseInfo?.isolationLastSetRIR === undefined || phaseInfo?.isolationLastSetRIR === null) {
    return '';
  }
  if (exercise.incrementType === 'bodyweight' || !hasRealRir(exercise)) return '';
  if (!ISOLATION_EXERCISE_IDS.has(exercise.id)) return '';
  return ` (last set RIR ${phaseInfo.isolationLastSetRIR})`;
}

// ---------------------------------------------------------------------------
// Styles (injected once, reusing the shared theme's custom properties).
// ---------------------------------------------------------------------------

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || document.getElementById('today-styles')) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'today-styles';
  style.textContent = `
    .today-message {
      color: var(--text-dim);
      margin-top: 32px;
      text-align: center;
    }
    .today-banner {
      background: var(--surface-alt);
      border: 1px solid var(--accent);
      color: var(--accent);
      border-radius: var(--radius);
      padding: 10px 12px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .today-heading {
      margin: 0 0 4px;
      font-size: 1.1rem;
    }
    .today-focus {
      color: var(--text-dim);
      margin: 0 0 16px;
      font-size: 0.9rem;
    }
    .warmup-checklist {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 16px;
      margin-bottom: 16px;
    }
    .warmup-checklist h3 {
      margin: 0 0 8px;
      font-size: 0.95rem;
    }
    .warmup-checklist ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .warmup-checklist li {
      margin-bottom: 8px;
    }
    .warmup-checklist label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }
    .exercise-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .exercise-row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .exercise-row-header {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      text-align: left;
      background: none;
      border: none;
      border-radius: 0;
      padding: 12px 14px;
      min-height: var(--tap-min);
    }
    .exercise-name {
      font-weight: 600;
    }
    .exercise-meta {
      color: var(--text-dim);
      font-size: 0.85rem;
    }
    .exercise-notes {
      color: var(--text-dim);
      font-size: 0.8rem;
      font-style: italic;
    }
    .exercise-details {
      border-top: 1px solid var(--border);
      padding: 12px 14px;
    }
    .rest-day-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
    }
    .rest-day-card p {
      margin: 0 0 10px;
    }
    .stomach-vacuum-reminder {
      color: var(--accent);
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

function renderExerciseRow(exercise, phaseInfo) {
  const row = document.createElement('div');
  row.className = 'exercise-row';

  const sets = adjustedSets(exercise, phaseInfo);
  const reps = formatReps(exercise);
  const rir = displayRir(exercise, phaseInfo);

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'exercise-row-header';
  header.setAttribute('aria-expanded', 'false');

  const nameEl = document.createElement('span');
  nameEl.className = 'exercise-name';
  nameEl.textContent = exercise.name;

  const metaEl = document.createElement('span');
  metaEl.className = 'exercise-meta';
  const metaText = `${sets} × ${reps} · Rest ${exercise.rest} · RIR ${rir}${lastSetRirNote(exercise, phaseInfo)}`;
  metaEl.textContent = metaText;

  header.append(nameEl, metaEl);

  if (exercise.notes) {
    const notesEl = document.createElement('span');
    notesEl.className = 'exercise-notes';
    notesEl.textContent = exercise.notes;
    header.appendChild(notesEl);
  }

  // Empty placeholder — Task 10 fills this in with the set logger.
  const details = document.createElement('div');
  details.className = 'exercise-details';
  details.hidden = true;
  details.dataset.exerciseId = exercise.id;

  header.addEventListener('click', () => {
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    details.hidden = expanded;
  });

  row.append(header, details);
  return row;
}

function renderRestDay(root, day) {
  const card = document.createElement('div');
  card.className = 'rest-day-card';

  const steps = document.createElement('p');
  steps.innerHTML = `<strong>Steps target:</strong> ${day.restDayInfo.steps}`;

  const mobility = document.createElement('p');
  mobility.innerHTML = `<strong>Mobility:</strong> ${day.restDayInfo.mobility}`;

  const vacuum = document.createElement('p');
  vacuum.className = 'stomach-vacuum-reminder';
  vacuum.textContent = "Don't forget your stomach vacuum practice today.";

  card.append(steps, mobility, vacuum);
  root.appendChild(card);
}

function renderTrainingDay(root, day, dayKey, phaseInfo) {
  const warmup = document.createElement('div');
  warmup.className = 'warmup-checklist';

  const warmupTitle = document.createElement('h3');
  warmupTitle.textContent = 'Warm-up';
  warmup.appendChild(warmupTitle);

  const warmupList = document.createElement('ul');
  WARMUP_STEPS.forEach((step, index) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.warmupIndex = String(index);
    label.append(checkbox, document.createTextNode(step));
    li.appendChild(label);
    warmupList.appendChild(li);
  });
  warmup.appendChild(warmupList);
  root.appendChild(warmup);

  const list = document.createElement('div');
  list.className = 'exercise-list';
  const exercises = resolveDayExercises(dayKey, phaseInfo);
  exercises.forEach((exercise) => {
    list.appendChild(renderExerciseRow(exercise, phaseInfo));
  });
  root.appendChild(list);
}

/**
 * @param {HTMLElement} container
 */
export async function renderTodayTab(container) {
  injectStyles();
  container.innerHTML = '';

  const settings = await getSetting();
  const root = document.createElement('div');
  root.className = 'today-tab';

  if (!settings?.startDate) {
    const message = document.createElement('p');
    message.className = 'today-message';
    message.textContent = 'Set your start date in Settings to begin the plan.';
    root.appendChild(message);
    container.appendChild(root);
    return;
  }

  const weekInfo = getWeekInfo(settings.startDate, todayISO());
  const { weekNumber, dayKey, phaseInfo, isCheckinWeek, isPlanComplete } = weekInfo;

  // getWeekInfo returns phaseInfo: null for BOTH a pre-start date and a
  // plan-complete date — isPlanComplete is the only field that tells them
  // apart, so it must be checked before anything reads phaseInfo.
  if (isPlanComplete) {
    const message = document.createElement('p');
    message.className = 'today-message';
    message.textContent = '12 weeks complete — start a new block in Settings.';
    root.appendChild(message);
    container.appendChild(root);
    return;
  }

  if (weekNumber === null) {
    const message = document.createElement('p');
    message.className = 'today-message';
    message.textContent = `Your plan hasn't started yet — it starts on ${settings.startDate}.`;
    root.appendChild(message);
    container.appendChild(root);
    return;
  }

  const bannerParts = [];
  if (isCheckinWeek) bannerParts.push('Check-in due this week');
  if (phaseInfo?.phase === 'deload' || phaseInfo?.phase === 'deload2') {
    bannerParts.push('Deload week — half sets');
  }
  if (bannerParts.length) {
    const banner = document.createElement('div');
    banner.className = 'today-banner';
    banner.textContent = bannerParts.join(' · ');
    root.appendChild(banner);
  }

  const day = DAYS[dayKey];

  const heading = document.createElement('h2');
  heading.className = 'today-heading';
  heading.textContent = `${day.label} — Week ${weekNumber}`;
  root.appendChild(heading);

  const focus = document.createElement('p');
  focus.className = 'today-focus';
  focus.textContent = day.focus;
  root.appendChild(focus);

  if (day.isRestDay) {
    renderRestDay(root, day);
  } else {
    renderTrainingDay(root, day, dayKey, phaseInfo);
  }

  container.appendChild(root);
}
