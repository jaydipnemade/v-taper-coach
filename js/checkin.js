// Check-in wizard logic (Task 14). Pure functions only: no DOM and no
// IndexedDB access, so tests.html can import and assert on them directly.

import { CHECKIN_TARGETS } from './data/plan.js';

const avg = (values) => (values.length === 0
  ? null
  : values.reduce((sum, v) => sum + v, 0) / values.length);

/**
 * Averages each body-metric field over the records whose date falls in
 * [weekStartISO, weekEndISO]. A field with no matching values is null.
 * @param {Array<object>} bodyMetrics
 * @param {string} weekStartISO
 * @param {string} weekEndISO
 */
export function computeWeekAverages(bodyMetrics, weekStartISO, weekEndISO) {
  const inWeek = bodyMetrics.filter((m) => m.date >= weekStartISO && m.date <= weekEndISO);
  const collect = (field) => inWeek
    .map((m) => m[field])
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  return {
    avgWeight: avg(collect('weightKg')),
    avgWaist: avg(collect('waistCm')),
    avgSteps: avg(collect('steps')),
    avgSleep: avg(collect('sleepHours')),
  };
}

const inRange = (value, [low, high]) => value >= low && value <= high;

/**
 * Calorie decision for a 4-week check-in. Rows are checked in order and the
 * first match wins; the fallback applies only when no row matches.
 * @param {{ phase: 'recomp'|'leanGain', weightDelta4wk: number, waistDelta4wk: number,
 *           liftsTrend: 'up'|'flat'|'down', bloatPersisted: boolean }} input
 */
export function calorieDecision(input) {
  const { phase, weightDelta4wk: w, waistDelta4wk: waist, liftsTrend, bloatPersisted } = input;
  const targets = CHECKIN_TARGETS[phase];
  // weightPerWeekKg is a per-week range; a 4-week check-in uses bounds x 4.
  const weightRange4wk = targets.weightPerWeekKg.map((b) => b * 4);

  if (inRange(w, weightRange4wk) && inRange(waist, targets.waistPer4WeeksCm) && liftsTrend === 'up') {
    return { decision: "It's working", action: 'Change nothing', kcalChange: 0 };
  }
  if (phase === 'leanGain' && w < 0.5 && Math.abs(waist) < 0.5) {
    return { decision: 'Surplus too small', action: '+150 kcal a day (≈ +35 g carbs)', kcalChange: 150 };
  }
  if (phase === 'leanGain' && (w > 1.5 || waist > 1)) {
    return { decision: 'Gaining too much fat', action: '-150 kcal a day (cut carbs), +2,000 steps a day', kcalChange: -150 };
  }
  if (phase === 'recomp' && w < 0 && waist < 0 && liftsTrend === 'up') {
    return {
      decision: 'Recomp is working well',
      action: 'Stay at 2,500 kcal for 2–4 more weeks before starting the surplus',
      kcalChange: 0,
    };
  }
  if (phase === 'recomp' && w < -1 && liftsTrend === 'down') {
    return { decision: 'Eating too little', action: '+150 kcal a day', kcalChange: 150 };
  }
  if (Math.abs(w) < 0.2 && waist > 0) {
    return {
      decision: 'Bloating or fat gain',
      action: bloatPersisted ? '-150 kcal a day' : 'Check oil, salt and late-night eating first',
      kcalChange: bloatPersisted ? -150 : 0,
    };
  }
  return { decision: 'No clear signal', action: 'Keep current calories 2 more weeks and re-check', kcalChange: 0 };
}

const VOLUME_ACTIONS = {
  onTrack: 'Keep the plan as written',
  shouldersLatsStalled: '+2 sets a week of lateral raises and +2 sets a week of pulldowns',
  noProgress: 'Check sleep and protein first, then take the deload a week early',
  jointsAchy: 'Remove 1 set from every exercise for 2 weeks',
  lowerBackTwinge: "Drop that exercise's load 20%. If it persists, swap it: hack squat → leg press, hip thrust → glute bridge machine, row → machine row",
};

/** @param {'onTrack'|'shouldersLatsStalled'|'noProgress'|'jointsAchy'|'lowerBackTwinge'} signal */
export function volumeRule(signal) {
  return { action: VOLUME_ACTIONS[signal] };
}

/** Shoulder-to-waist ratio. */
export function vTaperRatio(shoulderCm, waistCm) {
  return shoulderCm / waistCm;
}
