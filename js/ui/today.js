// js/ui/today.js
// The Today tab — renders the current day's session (warm-up + exercise
// list) or the rest-day view, adjusted for the current week's phase
// (set multiplier, extra sets, RIR overrides, Build 2 exercise swaps).
//
// Tasks 10/11/15 extend this same file with the set logger, rest timer,
// how-to-do-it panel, swap-choice UI, stomach-vacuum timer trigger, and
// warm-up checklist persistence — this task only builds the read-only
// session/exercise-list structure those features hang off of.
//
// Final-review batch B adds three static/informational pieces: a "plan
// notes" block (extra-cardio session text + daily-steps reminder + the
// early-deload-trigger reminder) under the day header, and the physio pain
// warning alongside each exercise's swap-menu UI (renderSwapControl).

import {
  DAYS,
  WARMUP_STEPS,
  LOWER_BACK_TWINGE_SWAPS,
  EXTRA_CARDIO,
  PHYSIO_WARNING,
  EARLY_DELOAD_TRIGGER,
} from '../data/plan.js';
import { getWeekInfo } from '../week.js';
import {
  getSetting,
  getExerciseHistory,
  appendExercisePerformance,
  upsertExercisePerformance,
  getSessionLog,
  putSessionLog,
} from '../db.js';
import { recommendNextSession, getLastPerformance } from '../progression.js';
import {
  computeRemainingMs,
  getActiveRestTimer,
  clearRestTimer,
  adjustRestTimer,
  startRestTimer,
} from '../timer.js';

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

    // An exercise can have MORE THAN ONE same-day swap-only alternate now
    // (e.g. t-bar-row's `swaps` lists both seal-row — the Build-2
    // auto-swap — and machine-row — a lower-back-twinge-only manual swap),
    // so this collects every same-day match, not just the first: all of
    // them get excluded from standalone rendering (added to skipIds)
    // below, and whichever one (if any) is this week's ACTIVE
    // BLOCK_STRUCTURE pair supplies the slot's data; otherwise the
    // exercise's own data is shown, same as before.
    const intraPartnerIds = (exercise.swaps ?? []).filter((id) => dayIds.has(id));

    if (intraPartnerIds.length > 0) {
      // Both sides of this pair live on today's day — only ever render one
      // row for the pair, at this (first-encountered, lower-order) slot.
      intraPartnerIds.forEach((id) => skipIds.add(id));
      const activeIntraPartnerId = intraPartnerIds.find(
        (id) => activePartnerOf.get(exercise.id) === id,
      );
      const data = activeIntraPartnerId ? EXERCISE_BY_ID[activeIntraPartnerId] : exercise;
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

/**
 * The session-draft / exerciseHistory key to use for a given slot's
 * CURRENT exercise — normally just `exercise.id`, except when a manual
 * swap (via the lower-back-twinge swap control) resolves to an id that's
 * ALREADY the (native, unswapped) id of some OTHER slot in today's list —
 * e.g. swapping Tuesday's hack-squat to leg-press, which collides with
 * Tuesday's own native leg-press row. Without this, both rows would read
 * and write the exact same sessionCtx.draft.exercises[...] object and the
 * exact same exerciseHistory record, corrupting whichever one logs/renders
 * last.
 *
 * `dayIdsBySlot` is the day's NATIVE (pre-swap) slotOrder -> id map, built
 * once in renderTrainingDay from resolveDayExercises' own output — i.e.
 * collision is detected against what today's OTHER slots actually are,
 * never against this slot's own (possibly-swapped) history, so a slot's
 * key is stable regardless of what it itself gets swapped to.
 * @param {{id: string, slotOrder: number}} exercise
 * @param {Map<number, string>} dayIdsBySlot
 * @returns {string}
 */
function computeHistoryKey(exercise, dayIdsBySlot) {
  for (const [slotOrder, id] of dayIdsBySlot) {
    if (slotOrder !== exercise.slotOrder && id === exercise.id) {
      return `${exercise.id}__slot${exercise.slotOrder}`;
    }
  }
  return exercise.id;
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
// Set logger helpers.
// ---------------------------------------------------------------------------

/**
 * Parses a PlanExercise `rest` string ('2-3 min', '60-90 s', '2 min', '30 s',
 * or '—' for exercises with no set-based rest, e.g. a timed cardio block)
 * into a millisecond duration for the rest timer, taking the UPPER bound of
 * a range. Exercises with no numeric rest at all resolve to 0ms rather than
 * throwing, so the (rare) bodyweight/cardio rows with rest '—' never crash
 * the logger — there's simply nothing meaningful to time.
 * @param {string} restString
 * @returns {number}
 */
function parseRestMs(restString) {
  const numbers = String(restString).match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return 0;
  const upperBound = Math.max(...numbers.map(Number));
  const isMinutes = /min/i.test(restString);
  return upperBound * (isMinutes ? 60000 : 1000);
}

/** Rounds to the nearest 0.5 — guards against float drift from repeated ±2.5 taps. */
function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

/** Renders one logged set as e.g. "40kg × 8 @ RIR 1 (warm-up)". */
function formatSetSummary(set) {
  if (!set) return '—';
  const warmupTag = set.isWarmup ? ' (warm-up)' : '';
  return `${set.weight}kg × ${set.reps} @ RIR ${set.rir}${warmupTag}`;
}

/** Renders a recommendNextSession() result as the brief's exact phrasing. */
function formatRecommendation(rec) {
  if (rec.type === 'noHistory') {
    return 'No history yet — log your first set to get a recommendation.';
  }
  if (rec.type === 'increaseWeight') {
    const amountText = typeof rec.amount === 'number' ? `+${rec.amount}kg` : `+${rec.amount}`;
    return `Increase weight next session: ${amountText}`;
  }
  return `Beat last time: aim for ${rec.targetReps} reps`;
}

/**
 * (Re)renders the full set-logger section for one exercise into `details`,
 * re-reading exercise history fresh each time so "last time" and the
 * recommendation immediately reflect a just-finalized session (no reload
 * needed — though a reload shows the same thing, since it's all read from
 * IndexedDB).
 * @param {HTMLElement} details
 * @param {object} exercise resolved PlanExercise (already swap-resolved by resolveDayExercises)
 * @param {object|null} phaseInfo
 * @param {{draft: object}} sessionCtx
 * @param {string} historyKey session-draft/exerciseHistory key for this
 *   slot — `exercise.id`, unless computeHistoryKey() detected a same-day
 *   collision (see its own doc comment).
 */
async function renderLoggerSection(details, exercise, phaseInfo, sessionCtx, historyKey) {
  const history = await getExerciseHistory(historyKey);
  const last = getLastPerformance(history);
  const rec = recommendNextSession(exercise, history);
  const targetSets = adjustedSets(exercise, phaseInfo);

  const exState = sessionCtx.draft.exercises[historyKey]
    ?? (sessionCtx.draft.exercises[historyKey] = { sets: [], finalized: false });

  details.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'set-logger';

  const recEl = document.createElement('p');
  recEl.className = rec.type === 'increaseWeight'
    ? 'set-logger-recommendation is-pr'
    : 'set-logger-recommendation';
  recEl.textContent = formatRecommendation(rec);
  wrapper.appendChild(recEl);

  for (let index = 0; index < targetSets; index += 1) {
    wrapper.appendChild(
      renderSetRow(index, exercise, phaseInfo, sessionCtx, last, exState, details, historyKey),
    );
  }

  details.appendChild(wrapper);
}

/**
 * Renders a single target-set row: last time's data for this slot, weight
 * (+/- 2.5kg) / reps / RIR inputs, a warm-up/working toggle, and a log-set
 * action. On log, this is the ONLY place exState.sets is mutated and the
 * ONLY place that decides whether this was the exercise's last working set
 * (the highest-index row — among ALL target rows, not just logged ones —
 * currently toggled "working" in the UI right now).
 * @param {string} historyKey session-draft/exerciseHistory key (see
 *   computeHistoryKey) — used instead of exercise.id so a manual swap that
 *   collides with another slot's native id can't corrupt either row.
 */
function renderSetRow(index, exercise, phaseInfo, sessionCtx, last, exState, details, historyKey) {
  const row = document.createElement('div');
  row.className = 'set-row';

  const existing = exState.sets[index];

  const badge = document.createElement('span');
  badge.className = `set-badge ${existing ? 'is-done' : 'is-pending'}`;
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = existing ? '✓' : String(index + 1);
  row.appendChild(badge);

  const label = document.createElement('span');
  label.className = 'set-row-label';
  label.textContent = `Set ${index + 1}`;
  row.appendChild(label);

  const lastEl = document.createElement('span');
  lastEl.className = 'set-row-lasttime';
  lastEl.textContent = `Last time: ${formatSetSummary(last?.sets?.[index])}`;
  row.appendChild(lastEl);

  const weightInput = document.createElement('input');
  weightInput.type = 'number';
  weightInput.step = '2.5';
  weightInput.inputMode = 'decimal';
  weightInput.className = 'set-input weight-input';
  weightInput.placeholder = 'kg';
  weightInput.setAttribute('aria-label', `Set ${index + 1} weight (kg)`);
  if (existing) weightInput.value = String(existing.weight);

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'weight-btn';
  minusBtn.textContent = '−2.5';
  minusBtn.setAttribute('aria-label', `Decrease set ${index + 1} weight by 2.5kg`);
  minusBtn.addEventListener('click', () => {
    const current = parseFloat(weightInput.value) || 0;
    weightInput.value = String(Math.max(0, roundToHalf(current - 2.5)));
  });

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'weight-btn';
  plusBtn.textContent = '+2.5';
  plusBtn.setAttribute('aria-label', `Increase set ${index + 1} weight by 2.5kg`);
  plusBtn.addEventListener('click', () => {
    const current = parseFloat(weightInput.value) || 0;
    weightInput.value = String(roundToHalf(current + 2.5));
  });

  const weightControl = document.createElement('div');
  weightControl.className = 'weight-control';
  weightControl.append(minusBtn, weightInput, plusBtn);
  row.appendChild(weightControl);

  const repsInput = document.createElement('input');
  repsInput.type = 'number';
  repsInput.className = 'set-input reps-input';
  repsInput.placeholder = 'reps';
  repsInput.setAttribute('aria-label', `Set ${index + 1} reps`);
  if (existing) repsInput.value = String(existing.reps);
  row.appendChild(repsInput);

  const rirInput = document.createElement('input');
  rirInput.type = 'number';
  rirInput.className = 'set-input rir-input';
  rirInput.placeholder = 'RIR';
  rirInput.setAttribute('aria-label', `Set ${index + 1} RIR`);
  if (existing) rirInput.value = String(existing.rir);
  row.appendChild(rirInput);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'set-row-toggle';
  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = existing ? Boolean(existing.isWarmup) : false;
  toggleLabel.append(toggleInput, document.createTextNode('Warm-up'));
  row.appendChild(toggleLabel);

  const logBtn = document.createElement('button');
  logBtn.type = 'button';
  logBtn.className = 'log-set-btn';
  logBtn.textContent = existing ? 'Update set' : 'Log set';
  logBtn.addEventListener('click', async () => {
    const weight = parseFloat(weightInput.value);
    const reps = parseFloat(repsInput.value);
    const rir = rirInput.value === '' ? 0 : parseFloat(rirInput.value);
    if (!Number.isFinite(weight) || !Number.isFinite(reps)) return;

    const setEntry = {
      weight,
      reps,
      rir: Number.isFinite(rir) ? rir : 0,
      isWarmup: toggleInput.checked,
    };
    // Captured BEFORE this click's mutation, so the branches below can tell
    // "this is the click that finalizes the exercise" apart from "this
    // exercise was already finalized (earlier this session, or in a
    // previous session restored on reload) and is now being edited".
    const wasAlreadyFinalized = exState.finalized;
    exState.sets[index] = setEntry;
    await putSessionLog(sessionCtx.draft);

    // The last working set = the highest-index target row CURRENTLY toggled
    // "working" (unchecked) in the UI, not merely the highest-index row
    // logged so far — this keeps the trigger correct even if the trainee
    // marks a later row as warm-up.
    const toggleInputs = Array.from(details.querySelectorAll('.set-row-toggle input'));
    let lastWorkingIndex = -1;
    toggleInputs.forEach((input, i) => {
      if (!input.checked) lastWorkingIndex = i;
    });

    const historyEntry = {
      date: sessionCtx.draft.date,
      weekNumber: sessionCtx.draft.weekNumber,
      sets: exState.sets.filter(Boolean),
    };

    if (!wasAlreadyFinalized && !setEntry.isWarmup && index === lastWorkingIndex) {
      // First time this exercise is finalized this session: append the one
      // new exerciseHistory entry for today and flip the flag.
      await appendExercisePerformance(historyKey, historyEntry);
      exState.finalized = true;
      await putSessionLog(sessionCtx.draft);
    } else if (wasAlreadyFinalized) {
      // Editing ANY set (not just the last working one) after the exercise
      // was already finalized — e.g. correcting a logged 10 reps down to 8
      // — must update the SAME-date exerciseHistory entry in place, never
      // leave the original (now-stale) append untouched and never add a
      // second entry for the same date. Otherwise progression.js's "only
      // recommend a weight increase on a fully clean top-of-range session"
      // guarantee could be defeated by stale, pre-edit history data.
      await upsertExercisePerformance(historyKey, historyEntry);
    }

    // Rest timer: starts after EVERY logged/updated working set (not just
    // the exercise's last one), using this exercise's own rest duration —
    // deliberately independent of the history/finalized bookkeeping above.
    // The spec calls for a rest timer between SETS, not just between
    // exercises.
    if (!setEntry.isWarmup) {
      const restMs = parseRestMs(exercise.rest);
      if (restMs > 0) {
        // rest === '—' (the single-block cardio exercise, e.g.
        // incline-treadmill-walk) parses to 0ms — skip starting a rest
        // timer entirely rather than create one that's already expired the
        // instant it exists, which would otherwise instantly beep/flash the
        // new floating widget for what is really a 20-minute cardio block.
        primeRestTimerAudio();
        setRestTimerKind('rest');
        try {
          startRestTimer(restMs);
        } catch (err) {
          // sessionStorage blocked — no rest timer this session, non-fatal.
        }
        pollRestTimer();
      }
    }

    await renderLoggerSection(details, exercise, phaseInfo, sessionCtx, historyKey);

    // renderLoggerSection just rebuilt every row from scratch, so the flash
    // targets the FRESH node at this same index, not the (now-detached) one
    // this handler closed over. The transition in .set-row's CSS rule
    // carries it back to transparent on its own — removing the class after
    // one beat is enough, no animationend listener needed.
    const freshRow = details.querySelectorAll('.set-row')[index];
    if (freshRow) {
      freshRow.classList.add('is-just-logged');
      setTimeout(() => freshRow.classList.remove('is-just-logged'), 600);
    }
  });
  row.appendChild(logBtn);

  return row;
}

// ---------------------------------------------------------------------------
// "How to do it" panel — exercise.cue text (always available offline) plus
// Google/YouTube search links. The links are real <a href> elements at all
// times (never disabled); only a small "needs internet" note next to them
// toggles with navigator.onLine, re-checked live via the online/offline
// window events.
// ---------------------------------------------------------------------------

// A single pair of window-level online/offline listeners keeps every
// "needs internet" note in sync, instead of each exercise row wiring its
// own listener. This queries the live DOM each time rather than keeping a
// Set of element references: renderTodayTab wipes and rebuilds the whole
// Today tab on every tab activation, and a manual swap wipes/rebuilds one
// exercise row's `details` on every swap, so a persistent Set would just
// accumulate references to detached (removed) notes forever over a long
// session. A live querySelectorAll has no such leak — it only ever sees
// notes that are actually still in the document.
function syncOfflineNote(el) {
  el.hidden = navigator.onLine !== false;
}

function syncAllOfflineNotes() {
  document.querySelectorAll('.how-to-offline-note').forEach(syncOfflineNote);
}

window.addEventListener('online', syncAllOfflineNotes);
window.addEventListener('offline', syncAllOfflineNotes);

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A small looping "rep" motion cue — a barbell silhouette that bobs up and
 * down via the `.motion-icon-bar` CSS animation. Purely decorative
 * (aria-hidden): a lightweight stand-in for a real exercise-demo video,
 * which this offline, no-asset-pipeline app has no way to source or ship.
 * @returns {SVGSVGElement}
 */
function renderMotionIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'motion-icon');
  svg.setAttribute('viewBox', '0 0 48 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'motion-icon-bar');

  const bar = document.createElementNS(SVG_NS, 'rect');
  bar.setAttribute('x', '8');
  bar.setAttribute('y', '10');
  bar.setAttribute('width', '32');
  bar.setAttribute('height', '4');
  bar.setAttribute('rx', '2');
  group.appendChild(bar);

  for (const cx of [8, 40]) {
    const plate = document.createElementNS(SVG_NS, 'circle');
    plate.setAttribute('cx', String(cx));
    plate.setAttribute('cy', '12');
    plate.setAttribute('r', '7');
    group.appendChild(plate);
  }

  svg.appendChild(group);
  return svg;
}

function renderHowToPanel(exercise) {
  const panel = document.createElement('div');
  panel.className = 'how-to-panel';

  const titleRow = document.createElement('div');
  titleRow.className = 'how-to-title-row';

  const title = document.createElement('h4');
  title.className = 'how-to-title';
  title.textContent = 'How to do it';
  titleRow.append(title, renderMotionIcon());
  panel.appendChild(titleRow);

  const cueEl = document.createElement('p');
  cueEl.className = 'how-to-cue';
  cueEl.textContent = exercise.cue || 'No form cue recorded for this exercise yet.';
  panel.appendChild(cueEl);

  const linksRow = document.createElement('div');
  linksRow.className = 'how-to-links';

  const googleLink = document.createElement('a');
  googleLink.className = 'how-to-link';
  googleLink.href = `https://www.google.com/search?q=${encodeURIComponent(`${exercise.name} proper form`)}`;
  googleLink.target = '_blank';
  googleLink.rel = 'noopener noreferrer';
  googleLink.textContent = 'Google: proper form';

  const youtubeLink = document.createElement('a');
  youtubeLink.className = 'how-to-link';
  youtubeLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} form tutorial`)}`;
  youtubeLink.target = '_blank';
  youtubeLink.rel = 'noopener noreferrer';
  youtubeLink.textContent = 'YouTube: form tutorial';

  linksRow.append(googleLink, youtubeLink);
  panel.appendChild(linksRow);

  const offlineNote = document.createElement('p');
  offlineNote.className = 'how-to-offline-note';
  offlineNote.textContent = 'These links need an internet connection.';
  syncOfflineNote(offlineNote);
  panel.appendChild(offlineNote);

  return panel;
}

// ---------------------------------------------------------------------------
// Stomach-vacuum hold timer trigger.
//
// Deliberately scoped to the dedicated 'stomach-vacuum' exercise id only,
// NOT the combined 'front-plank-stomach-vacuum' exercise that also appears
// elsewhere in plan.js: that combined exercise's notes describe a plank
// hold followed by a separate "3 × 20 s stomach vacuum" block, so a single
// 25 s "Start hold" button there would be ambiguous about which phase it's
// timing. The dedicated 'stomach-vacuum' exercise, by contrast, IS a single
// 20-30 s vacuum hold (its own notes/cue describe exactly that one motion),
// which this fixed 25 s (midpoint) button cleanly models. Giving the
// combined exercise its own correct trigger would need a second button or
// some other disambiguating UI — out of this task's scope.
//
// Reuses the exact same startRestTimer()/primeRestTimerAudio()/
// pollRestTimer() mechanism the "Log set" flow uses to hand off to the
// floating rest-timer widget below, rather than building any new timer UI.
// ---------------------------------------------------------------------------

const STOMACH_VACUUM_HOLD_MS = 25000;

function renderStomachVacuumHoldButton(exercise) {
  if (exercise.id !== 'stomach-vacuum') return null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stomach-vacuum-hold-btn';
  btn.textContent = 'Start hold (25s)';
  btn.addEventListener('click', () => {
    primeRestTimerAudio();
    setRestTimerKind('hold');
    try {
      startRestTimer(STOMACH_VACUUM_HOLD_MS);
    } catch (err) {
      // sessionStorage blocked — no timer this session, non-fatal.
    }
    pollRestTimer();
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Swap control — a menu of exercise.swaps alternatives, with the
// LOWER_BACK_TWINGE_SWAPS entry (if any, and if it resolves to real
// PlanExercise data) highlighted as the back-friendly pick. Picking an
// option hands the chosen id back to the caller, which re-renders the row
// with the swapped exercise's own full data — the same "whatever exercise
// object is attached to this slot is the source of truth" pattern
// resolveDayExercises already uses for the automatic phase-triggered swaps.
//
// Note: two of the three LOWER_BACK_TWINGE_SWAPS targets ('glute-bridge-machine'
// for hip-thrust, 'machine-row' for t-bar-row) have no corresponding
// PlanExercise entry anywhere in plan.js as of this task — a data gap in
// that (reviewed/approved, out of this task's scope) file. Those are
// filtered out defensively rather than offered as a broken option; see the
// task report for detail.
// ---------------------------------------------------------------------------

function getSwapOptions(exercise) {
  const ids = new Set(exercise.swaps ?? []);
  const backFriendlyId = LOWER_BACK_TWINGE_SWAPS[exercise.id];
  if (backFriendlyId) ids.add(backFriendlyId);

  return Array.from(ids)
    .filter((id) => Boolean(EXERCISE_BY_ID[id]))
    .map((id) => ({
      id,
      name: EXERCISE_BY_ID[id].name,
      isBackFriendly: id === backFriendlyId,
    }));
}

function renderSwapControl(exercise, onSwap) {
  const wrap = document.createElement('div');
  wrap.className = 'swap-control';

  const title = document.createElement('h4');
  title.className = 'swap-title';
  title.textContent = 'Swap exercise';
  wrap.appendChild(title);

  const options = getSwapOptions(exercise);

  if (options.length === 0) {
    const none = document.createElement('p');
    none.className = 'swap-none';
    none.textContent = 'No alternatives available for this exercise.';
    wrap.appendChild(none);
  } else {
    const optionsRow = document.createElement('div');
    optionsRow.className = 'swap-options';
    options.forEach((option) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = option.isBackFriendly
        ? 'swap-option-btn swap-option-recommended'
        : 'swap-option-btn';
      btn.textContent = option.isBackFriendly
        ? `${option.name} (lower-back friendly)`
        : option.name;
      btn.addEventListener('click', () => onSwap(option.id));
      optionsRow.appendChild(btn);
    });
    wrap.appendChild(optionsRow);
  }

  // Physio pain warning (final-review batch B) — static text alongside the
  // swap menu, since both are about in-session pain response: a twinge is
  // what the swap menu above is for, but sharp/radiating/week-plus pain
  // means stop and see a physio instead of swapping exercises.
  const physioNote = document.createElement('p');
  physioNote.className = 'swap-physio-warning';
  physioNote.textContent = PHYSIO_WARNING;
  wrap.appendChild(physioNote);

  return wrap;
}

// ---------------------------------------------------------------------------
// Floating rest-timer widget.
//
// A page-level singleton living in document.body (not inside the Today
// tab's own container, which gets wiped and rebuilt every time the tab is
// re-rendered) so it keeps counting down and stays visible even if the
// trainee switches to another tab mid-rest. The timer's actual state lives
// in sessionStorage via js/timer.js (computeRemainingMs/getActiveRestTimer/
// clearRestTimer/adjustRestTimer) — this widget only polls and displays it,
// and every call that touches that sessionStorage-backed state is wrapped
// in try/catch here, since some browser privacy modes throw on storage
// access and that must not crash the whole Today tab.
//
// Remaining time is always recomputed from the stored end timestamp (never
// from counting ticks), so backgrounding the tab past the rest duration and
// returning shows 0 immediately rather than a stale/negative count.
// ---------------------------------------------------------------------------

const REST_TIMER_POLL_MS = 500;
const REST_TIMER_FLASH_MS = 600;
const REST_TIMER_BEEP_SECONDS = 0.18;

let restTimerWidgetEl = null;
let restTimerLabelEl = null;
let restTimerTimeEl = null;
let restTimerFlashEl = null;
let restTimerWakeLock = null;
let restTimerAudioCtx = null;

// Which of the two use cases the CURRENTLY active timer represents —
// "resting between sets" (the default) vs. the stomach-vacuum "hold". Kept
// in sessionStorage (not just a module-level var) alongside the timer's own
// end-timestamp key so it survives a page reload the same way the timer
// itself does, and so it's never ambiguous which label a freshly-built
// widget instance should show on first poll. Always set explicitly right
// before each startRestTimer() call (both call sites below) rather than
// relying on this defaulting correctly, so a stale 'hold' from a previous,
// never-completed hold can't leak into the next ordinary rest timer.
const REST_TIMER_KIND_KEY = 'vtaper-rest-timer-kind';

function setRestTimerKind(kind) {
  try {
    sessionStorage.setItem(REST_TIMER_KIND_KEY, kind);
  } catch (err) {
    // sessionStorage blocked — the widget will just default to "Rest".
  }
}

function getRestTimerKind() {
  try {
    return sessionStorage.getItem(REST_TIMER_KIND_KEY) === 'hold' ? 'hold' : 'rest';
  } catch (err) {
    return 'rest';
  }
}

// The end timestamp this widget instance is currently tracking, and whether
// it has ever observed that timer with remaining > 0. A fresh 0ms timer (or
// one that had already fully elapsed before this widget instance first saw
// it — e.g. after a page reload) is never observed positive, so it's
// cleared silently with no beep/flash instead of looking like it "just
// finished" the instant it appears. (Belt-and-suspenders: the logger below
// also skips starting a rest timer at all when the parsed rest duration is
// 0, which is the actual fix for the '—'-rest cardio-exercise case from the
// Task 10 handoff — this is just a second line of defense.)
let restTimerTrackedEnd = null;
let restTimerObservedPositive = false;

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getRestTimerAudioCtx() {
  if (restTimerAudioCtx) return restTimerAudioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    restTimerAudioCtx = new Ctor();
  } catch (err) {
    restTimerAudioCtx = null;
  }
  return restTimerAudioCtx;
}

/**
 * Called from inside the "Log set" click handler — a genuine user gesture —
 * so the AudioContext gets created/resumed while gesture-triggered autoplay
 * restrictions still allow it. By the time the timer actually hits 0 (from
 * an async setInterval callback, not a gesture), it's already running.
 */
function primeRestTimerAudio() {
  try {
    const ctx = getRestTimerAudioCtx();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  } catch (err) {
    // Web Audio unavailable/blocked — the timer still works, just silently.
  }
}

function playRestTimerBeep() {
  try {
    const ctx = getRestTimerAudioCtx();
    if (!ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + REST_TIMER_BEEP_SECONDS);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + REST_TIMER_BEEP_SECONDS + 0.02);
  } catch (err) {
    // Non-fatal — a silent timer is still a working timer.
  }
}

function flashRestTimerOverlay() {
  if (!restTimerFlashEl) return;
  restTimerFlashEl.classList.add('is-active');
  setTimeout(() => {
    restTimerFlashEl.classList.remove('is-active');
  }, REST_TIMER_FLASH_MS);
}

async function requestRestTimerWakeLock() {
  if (restTimerWakeLock || !('wakeLock' in navigator)) return;
  try {
    restTimerWakeLock = await navigator.wakeLock.request('screen');
    restTimerWakeLock.addEventListener('release', () => {
      restTimerWakeLock = null;
    });
  } catch (err) {
    // Permission denied, page not visible, unsupported, etc — non-fatal.
    restTimerWakeLock = null;
  }
}

async function releaseRestTimerWakeLock() {
  const lock = restTimerWakeLock;
  restTimerWakeLock = null;
  if (!lock) return;
  try {
    await lock.release();
  } catch (err) {
    // Already released / unsupported — ignore.
  }
}

function showRestTimerWidget() {
  if (restTimerWidgetEl) restTimerWidgetEl.hidden = false;
  // Re-read the kind on every show (not just once at start) so the single
  // widget instance's label always matches whichever timer is actually
  // active right now, including across a reload that restored an
  // in-progress timer from sessionStorage.
  if (restTimerLabelEl) {
    restTimerLabelEl.textContent = getRestTimerKind() === 'hold' ? 'Hold' : 'Rest';
  }
}

function hideRestTimerWidget() {
  if (restTimerWidgetEl) restTimerWidgetEl.hidden = true;
  // Clear the kind once the widget is actually hidden (timer gone/finished)
  // so a lingering 'hold' can never bleed into the next timer's first poll
  // before its own call site re-sets it.
  try {
    sessionStorage.removeItem(REST_TIMER_KIND_KEY);
  } catch (err) {
    // Non-fatal — the next explicit setRestTimerKind() call still wins.
  }
}

function pollRestTimer() {
  let end;
  try {
    end = getActiveRestTimer();
  } catch (err) {
    // sessionStorage blocked — fail closed: no timer UI, no crash.
    return;
  }

  if (end === null) {
    if (restTimerTrackedEnd !== null) {
      restTimerTrackedEnd = null;
      restTimerObservedPositive = false;
      hideRestTimerWidget();
      releaseRestTimerWakeLock();
    }
    return;
  }

  if (end !== restTimerTrackedEnd) {
    restTimerTrackedEnd = end;
    restTimerObservedPositive = false;
  }

  const remaining = computeRemainingMs(end);

  if (remaining > 0) {
    restTimerObservedPositive = true;
    showRestTimerWidget();
    if (restTimerTimeEl) restTimerTimeEl.textContent = formatRemaining(remaining);
    requestRestTimerWakeLock();
    return;
  }

  // remaining === 0: only beep/flash if this widget instance actually
  // watched it count down from > 0 at an earlier poll.
  if (restTimerObservedPositive) {
    if (restTimerTimeEl) restTimerTimeEl.textContent = formatRemaining(0);
    showRestTimerWidget();
    playRestTimerBeep();
    flashRestTimerOverlay();
  }

  try {
    clearRestTimer();
  } catch (err) {
    // Non-fatal — the next poll will just see the same stale end again.
  }
  restTimerTrackedEnd = null;
  restTimerObservedPositive = false;
  hideRestTimerWidget();
  releaseRestTimerWakeLock();
}

function adjustAndRefreshRestTimer(deltaMs) {
  try {
    adjustRestTimer(deltaMs);
  } catch (err) {
    // sessionStorage blocked — nothing to adjust.
  }
  pollRestTimer();
}

function buildRestTimerWidget() {
  const widget = document.createElement('div');
  widget.id = 'rest-timer-widget';
  widget.className = 'rest-timer-widget';
  widget.hidden = true;

  const label = document.createElement('span');
  label.className = 'rest-timer-label';
  label.textContent = 'Rest';
  restTimerLabelEl = label;

  const time = document.createElement('span');
  time.className = 'rest-timer-time';
  time.textContent = '0:00';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'rest-timer-btn';
  minusBtn.textContent = '−15s';
  minusBtn.setAttribute('aria-label', 'Subtract 15 seconds from rest timer');
  minusBtn.addEventListener('click', () => adjustAndRefreshRestTimer(-15000));

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'rest-timer-btn';
  plusBtn.textContent = '+15s';
  plusBtn.setAttribute('aria-label', 'Add 15 seconds to rest timer');
  plusBtn.addEventListener('click', () => adjustAndRefreshRestTimer(15000));

  widget.append(label, time, minusBtn, plusBtn);

  restTimerWidgetEl = widget;
  restTimerTimeEl = time;

  const flash = document.createElement('div');
  flash.id = 'rest-timer-flash';
  flash.className = 'rest-timer-flash';
  restTimerFlashEl = flash;

  document.body.append(widget, flash);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pollRestTimer();
    }
  });
}

/**
 * Idempotent setup, called every time the Today tab renders. Builds the
 * widget and starts the poll loop once; on subsequent calls (navigating
 * back to Today) it just does an immediate sync.
 */
function ensureRestTimerWidget() {
  if (restTimerWidgetEl) {
    pollRestTimer();
    return;
  }
  buildRestTimerWidget();
  pollRestTimer();
  setInterval(pollRestTimer, REST_TIMER_POLL_MS);
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
      margin: 0 0 16px;
    }
    .plan-notes {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 16px;
    }
    .plan-notes p {
      margin: 0;
      font-size: 0.82rem;
      color: var(--text-dim);
    }
    .plan-notes-cardio {
      color: var(--accent);
      font-weight: 600;
    }
    .warmup-checklist {
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--card-shadow);
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
      box-shadow: var(--card-shadow);
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
      box-shadow: var(--card-shadow);
      border-radius: var(--radius);
      padding: 16px;
    }
    .rest-day-card p {
      margin: 0 0 10px;
    }
    .stomach-vacuum-reminder {
      color: var(--accent);
    }
    .set-logger {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .set-logger-recommendation {
      margin: 0;
      font-weight: 600;
      color: var(--accent);
    }
    /* A weight-increase recommendation is the one moment worth calling out
       — a brief amber pulse, not a permanent color change (recEl still
       reads --accent at rest; this only draws the eye on first render of a
       fresh "increaseWeight" recommendation). */
    .set-logger-recommendation.is-pr {
      color: var(--highlight);
      animation: pr-pulse 1.4s ease-out 2;
    }
    @keyframes pr-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.55; }
    }
    .set-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      border-top: 1px solid var(--border);
      padding-top: 8px;
      border-radius: var(--radius);
      transition: background-color 0.3s ease;
    }
    .set-row:first-of-type {
      border-top: none;
      padding-top: 0;
    }
    /* Freshly logged/updated set: a quick success flash, then fades back to
       transparent over the same transition — no JS cleanup needed beyond
       removing the class (see the "Log set" handler), since the color
       itself settles back to nothing on its own. */
    .set-row.is-just-logged {
      background-color: rgba(53, 224, 161, 0.18); /* --success at ~18% — fallback if color-mix() is unsupported */
      background-color: color-mix(in srgb, var(--success) 22%, transparent);
    }
    .set-row-label {
      font-weight: 600;
      min-width: 44px;
    }
    .set-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-size: 0.72rem;
      font-weight: 700;
      flex: 0 0 auto;
    }
    .set-badge.is-pending {
      border: 1.5px solid var(--border);
      color: var(--text-dim);
    }
    .set-badge.is-done {
      background: var(--success);
      color: var(--success-text);
    }
    .set-row-lasttime {
      color: var(--text-dim);
      font-size: 0.8rem;
      flex: 1 1 100%;
    }
    .set-input {
      width: 56px;
      min-height: var(--tap-min);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface);
      color: inherit;
      padding: 4px 6px;
    }
    .weight-control {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .weight-btn {
      min-height: var(--tap-min);
      min-width: var(--tap-min);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
    }
    .set-row-toggle {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.8rem;
      color: var(--text-dim);
    }
    .log-set-btn {
      min-height: var(--tap-min);
      border: none;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--surface);
      padding: 4px 10px;
      font-weight: 600;
    }
    .how-to-panel {
      border-top: 1px solid var(--border);
      padding-top: 10px;
      margin-bottom: 10px;
    }
    .stomach-vacuum-hold-btn {
      min-height: var(--tap-min);
      border: none;
      border-radius: var(--radius);
      background: var(--accent);
      color: var(--surface);
      padding: 4px 10px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .how-to-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 6px;
    }
    .how-to-title,
    .swap-title {
      margin: 0;
      font-size: 0.9rem;
    }
    /* A small looping "rep" motion cue next to the how-to-do-it title —
       pure CSS/SVG, no video/image assets, degrades to a static icon under
       prefers-reduced-motion (handled globally above). */
    .motion-icon {
      width: 30px;
      height: 16px;
      flex: 0 0 auto;
    }
    .motion-icon-bar {
      fill: var(--accent);
      transform-box: fill-box;
      transform-origin: center;
      animation: motion-bounce 1.1s ease-in-out infinite;
    }
    @keyframes motion-bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-3px); }
    }
    .how-to-cue {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 0 0 8px;
    }
    .how-to-links {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .how-to-link {
      min-height: var(--tap-min);
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 4px 10px;
      color: var(--accent);
      text-decoration: none;
      font-size: 0.85rem;
    }
    .how-to-offline-note {
      margin: 6px 0 0;
      font-size: 0.75rem;
      color: var(--text-dim);
      font-style: italic;
    }
    .swap-control {
      border-top: 1px solid var(--border);
      padding-top: 10px;
      margin-bottom: 10px;
    }
    .swap-options {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .swap-option-btn {
      min-height: var(--tap-min);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
      padding: 4px 10px;
      font-size: 0.85rem;
    }
    .swap-option-recommended {
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .swap-none {
      color: var(--text-dim);
      font-size: 0.8rem;
      margin: 0;
    }
    .swap-physio-warning {
      color: var(--text-dim);
      font-size: 0.78rem;
      font-style: italic;
      margin: 8px 0 0;
    }
    .rest-timer-widget {
      position: fixed;
      left: 50%;
      bottom: calc(var(--tap-min) + env(safe-area-inset-bottom) + 16px);
      transform: translateX(-50%);
      z-index: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      background: var(--surface);
      border: 1px solid var(--accent);
      border-radius: var(--radius);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
      padding: 8px 14px;
    }
    .rest-timer-widget[hidden] {
      display: none;
    }
    .rest-timer-label {
      font-weight: 600;
      color: var(--accent);
    }
    .rest-timer-time {
      font-size: 1.3rem;
      font-weight: 700;
      min-width: 52px;
      text-align: center;
      animation: rest-timer-pulse 1s ease-in-out infinite;
    }
    @keyframes rest-timer-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .rest-timer-btn {
      min-height: var(--tap-min);
      min-width: var(--tap-min);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
    }
    .rest-timer-flash {
      position: fixed;
      inset: 0;
      background: var(--accent);
      opacity: 0;
      pointer-events: none;
      z-index: 600;
      transition: opacity 0.15s ease;
    }
    .rest-timer-flash.is-active {
      opacity: 0.35;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

function renderExerciseRow(initialExercise, phaseInfo, sessionCtx, dayIdsBySlot) {
  const row = document.createElement('div');
  row.className = 'exercise-row';

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'exercise-row-header';
  header.setAttribute('aria-expanded', 'false');

  const nameEl = document.createElement('span');
  nameEl.className = 'exercise-name';

  const metaEl = document.createElement('span');
  metaEl.className = 'exercise-meta';

  const notesEl = document.createElement('span');
  notesEl.className = 'exercise-notes';
  notesEl.hidden = true;

  header.append(nameEl, metaEl, notesEl);

  const details = document.createElement('div');
  details.className = 'exercise-details';
  details.hidden = true;

  // currentExercise tracks whichever PlanExercise data this slot is showing
  // right now — the row's own exercise.id, or a manually swapped-in
  // alternative's own id/data after the trainee picks one from the swap
  // control below. Everything downstream (header text, the how-to-do-it
  // cue/links, the swap menu's own options, and the set logger's history
  // reads/writes) is driven off whatever currentExercise currently is, the
  // same "whatever data is attached to this slot is the source of truth"
  // pattern resolveDayExercises already uses for the automatic phase swaps.
  let currentExercise = initialExercise;
  let loggerLoaded = false;
  let loggerContainer = null;

  function updateHeader() {
    const sets = adjustedSets(currentExercise, phaseInfo);
    const reps = formatReps(currentExercise);
    const rir = displayRir(currentExercise, phaseInfo);
    nameEl.textContent = currentExercise.name;
    metaEl.textContent = `${sets} × ${reps} · Rest ${currentExercise.rest} · RIR ${rir}${lastSetRirNote(currentExercise, phaseInfo)}`;
    if (currentExercise.notes) {
      notesEl.textContent = currentExercise.notes;
      notesEl.hidden = false;
    } else {
      notesEl.hidden = true;
    }
    details.dataset.exerciseId = currentExercise.id;
  }

  function loadLoggerIfNeeded() {
    if (loggerLoaded) return;
    loggerLoaded = true;
    const historyKey = computeHistoryKey(currentExercise, dayIdsBySlot);
    renderLoggerSection(loggerContainer, currentExercise, phaseInfo, sessionCtx, historyKey);
  }

  function handleSwap(newExerciseId) {
    const newData = EXERCISE_BY_ID[newExerciseId];
    if (!newData) return; // defensive: orphan id, nothing to swap to
    currentExercise = { ...newData, slotOrder: initialExercise.slotOrder };
    updateHeader();
    rebuildDetailsContents();
    if (!details.hidden) loadLoggerIfNeeded();
  }

  function rebuildDetailsContents() {
    details.innerHTML = '';
    details.appendChild(renderHowToPanel(currentExercise));
    const vacuumHoldBtn = renderStomachVacuumHoldButton(currentExercise);
    if (vacuumHoldBtn) details.appendChild(vacuumHoldBtn);
    details.appendChild(renderSwapControl(currentExercise, handleSwap));
    loggerContainer = document.createElement('div');
    loggerContainer.className = 'logger-container';
    details.appendChild(loggerContainer);
    loggerLoaded = false;
  }

  // Lazily build the set logger the first time this row is expanded, per
  // the brief's "when expanded, shows..." — avoids an upfront
  // getExerciseHistory() round-trip per exercise on every tab render. The
  // how-to-do-it panel and swap control are cheap synchronous DOM (no
  // IndexedDB reads), so those are built eagerly below instead.
  header.addEventListener('click', () => {
    const expanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!expanded));
    details.hidden = expanded;
    if (!expanded) loadLoggerIfNeeded();
  });

  updateHeader();
  rebuildDetailsContents();

  row.append(header, details);
  return row;
}

// ---------------------------------------------------------------------------
// Plan notes (final-review batch B): extra-cardio session/steps reminder
// and the early-deload-trigger reminder. Purely informational, always
// visible — no automated detection of the deload trigger's own signals
// (strength drops, worse sleep, joint ache, dread) from stored data; that's
// explicitly out of scope (see brief). The check-in-table's own, separate
// missed-progress signal is already implemented in js/checkin.js.
// ---------------------------------------------------------------------------

/**
 * Returns the EXTRA_CARDIO session text for today's week/day, if any of its
 * weeks1to4/weeks5to12 blocks apply, else null.
 * @param {number|null} weekNumber
 * @param {string} dayKey
 * @returns {string|null}
 */
function matchingExtraCardioSession(weekNumber, dayKey) {
  if (weekNumber === null) return null;
  const { weeks1to4, weeks5to12 } = EXTRA_CARDIO;
  if (weeks1to4.weeks.includes(weekNumber) && weeks1to4.afterDays.includes(dayKey)) {
    return weeks1to4.session;
  }
  if (weeks5to12.weeks.includes(weekNumber) && weeks5to12.afterDays.includes(dayKey)) {
    return weeks5to12.session;
  }
  return null;
}

function renderPlanNotes(weekNumber, dayKey) {
  const section = document.createElement('div');
  section.className = 'plan-notes';

  const cardioSession = matchingExtraCardioSession(weekNumber, dayKey);
  if (cardioSession) {
    const cardioNote = document.createElement('p');
    cardioNote.className = 'plan-notes-cardio';
    cardioNote.textContent = cardioSession;
    section.appendChild(cardioNote);
  }

  const stepsNote = document.createElement('p');
  stepsNote.className = 'plan-notes-steps';
  stepsNote.textContent = EXTRA_CARDIO.dailySteps;
  section.appendChild(stepsNote);

  const deloadNote = document.createElement('p');
  deloadNote.className = 'plan-notes-deload';
  deloadNote.textContent = EARLY_DELOAD_TRIGGER;
  section.appendChild(deloadNote);

  return section;
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

function renderTrainingDay(root, day, dayKey, phaseInfo, sessionCtx) {
  const warmup = document.createElement('div');
  warmup.className = 'warmup-checklist';

  const warmupTitle = document.createElement('h3');
  warmupTitle.textContent = 'Warm-up';
  warmup.appendChild(warmupTitle);

  // Checked state persists per-day on sessionCtx.draft.warmupChecked (an
  // array of WARMUP_STEPS indices — these items have no id of their own, so
  // array position is the identity). sessionCtx.draft is the SAME object the
  // set logger reads/mutates/writes via putSessionLog elsewhere in this
  // file, so setting one field on it here and persisting it is a
  // read(already in memory)-merge(add warmupChecked)-write, never a blind
  // overwrite of whatever sets have already been logged today. The record
  // is keyed by `${dateISO}_${dayKey}` (see renderTodayTab), so this resets
  // implicitly on any new calendar day with no explicit cleanup needed.
  const warmupList = document.createElement('ul');
  const warmupCheckedIndices = new Set(
    Array.isArray(sessionCtx.draft.warmupChecked) ? sessionCtx.draft.warmupChecked : []
  );

  async function persistWarmupChecked() {
    const checkedIndices = Array.from(
      warmupList.querySelectorAll('input[data-warmup-index]')
    )
      .filter((input) => input.checked)
      .map((input) => Number(input.dataset.warmupIndex));
    sessionCtx.draft.warmupChecked = checkedIndices;
    await putSessionLog(sessionCtx.draft);
  }

  WARMUP_STEPS.forEach((step, index) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.warmupIndex = String(index);
    checkbox.checked = warmupCheckedIndices.has(index);
    checkbox.addEventListener('change', persistWarmupChecked);
    label.append(checkbox, document.createTextNode(step));
    li.appendChild(label);
    warmupList.appendChild(li);
  });
  warmup.appendChild(warmupList);
  root.appendChild(warmup);

  const list = document.createElement('div');
  list.className = 'exercise-list';
  const exercises = resolveDayExercises(dayKey, phaseInfo);
  // Today's NATIVE (pre-manual-swap) slotOrder -> id map, built once here
  // and handed to every row so a manual swap that resolves to an id
  // already used by some OTHER slot today (see computeHistoryKey) can be
  // detected and kept from corrupting either slot's data.
  const dayIdsBySlot = new Map(exercises.map((e) => [e.slotOrder, e.id]));
  exercises.forEach((exercise) => {
    list.appendChild(renderExerciseRow(exercise, phaseInfo, sessionCtx, dayIdsBySlot));
  });
  root.appendChild(list);
}

/**
 * @param {HTMLElement} container
 */
export async function renderTodayTab(container) {
  injectStyles();
  ensureRestTimerWidget();
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
  const blockNumber = settings?.blockNumber ?? 1;
  const weekLabel = blockNumber > 1 ? `Block ${blockNumber} · Week ${weekNumber}` : `Week ${weekNumber}`;
  heading.textContent = `${day.label} — ${weekLabel}`;
  root.appendChild(heading);

  const focus = document.createElement('div');
  focus.className = 'today-focus pill-row';
  // day.focus is a short comma-separated phrase (e.g. "Quads, calves, core"
  // or, for rest days, "Full rest, 8k steps, mobility") — rendered as
  // individual pills rather than one run of text, echoing how muscle-group
  // tags read in other training apps' day-list UI.
  day.focus.split(',').forEach((part) => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = part.trim();
    focus.appendChild(pill);
  });
  root.appendChild(focus);

  root.appendChild(renderPlanNotes(weekNumber, dayKey));

  if (day.isRestDay) {
    renderRestDay(root, day);
  } else {
    // The session draft is keyed by date+day (not week number) so logging
    // against "today" is unambiguous even across plan restarts. Loaded (not
    // recreated) if a log already exists for today, so a mid-session reload
    // doesn't lose sets already logged before the page was reloaded.
    const sessionId = `${todayISO()}_${dayKey}`;
    const existingLog = await getSessionLog(sessionId);
    const draft = existingLog ?? {
      id: sessionId,
      date: todayISO(),
      dayKey,
      weekNumber,
      exercises: {},
    };
    const sessionCtx = { draft };
    renderTrainingDay(root, day, dayKey, phaseInfo, sessionCtx);
  }

  container.appendChild(root);
}
