// js/progression.js
// Double progression recommendation engine. Pure functions only — no DOM, no
// storage access. Given a PlanExercise (js/data/plan.js) and its logged
// history (ExercisePerformance[] from js/db.js), decide whether to recommend
// increasing the weight next session or beating last time's reps.

import { INCREMENT_BY_TYPE } from './data/plan.js';

/**
 * Returns the most recent logged performance for an exercise, or null if
 * there is no history yet. History entries are appended in chronological
 * order (see js/db.js appendExercisePerformance), so the last element is the
 * most recent session.
 * @param {Array} history
 * @returns {object|null}
 */
export function getLastPerformance(history) {
  if (!history || history.length === 0) return null;
  return history[history.length - 1];
}

/**
 * Parses a PlanExercise RIR string (e.g. '2', '1-0', '0-1') to the target RIR
 * ceiling used to judge whether a set was taken hard enough: the string is
 * split on '-' and the minimum of the resulting numbers is taken as the
 * strictest bound. Using the minimum (rather than, say, the last token) makes
 * this order-independent: the plan data is inconsistent about whether a range
 * is written high-to-low ('1-0') or low-to-high ('0-1'), and both must yield
 * the same stricter target RIR of 0.
 * @param {string} rirString
 * @returns {number}
 */
function parseTargetRIR(rirString) {
  const numbers = String(rirString).split('-').map((part) => parseFloat(part));
  return Math.min(...numbers);
}

/**
 * Decides the next-session recommendation for an exercise based on its last
 * logged performance.
 * @param {object} exercise PlanExercise (needs repsHigh, rir, incrementType)
 * @param {Array} history ExercisePerformance[]
 * @returns {{type:'noHistory'}|{type:'increaseWeight', amount:number|string}|{type:'beatLastTime', targetReps:number}}
 */
export function recommendNextSession(exercise, history) {
  if (!history || history.length === 0) return { type: 'noHistory' };

  const last = getLastPerformance(history);
  const workingSets = (last.sets || []).filter((set) => set.isWarmup === false);
  // A session with zero working sets (every logged set marked warm-up) has
  // no performance to compare against — Math.max on an empty array would
  // yield -Infinity and corrupt both branches below.
  if (workingSets.length === 0) return { type: 'noHistory' };
  const maxReps = Math.max(...workingSets.map((set) => set.reps));
  const targetReps = Math.min(exercise.repsHigh, maxReps + 1);

  // Bodyweight/isometric exercises (INCREMENT_BY_TYPE.bodyweight is null) have
  // no weight-based progression path in this app: never recommend
  // increaseWeight for them, regardless of how clean the sets were. Hold at
  // the top of the rep range instead (the formula above already yields
  // targetReps === repsHigh once maxReps reaches repsHigh).
  if (exercise.incrementType !== 'bodyweight') {
    const targetRIR = parseTargetRIR(exercise.rir);
    // workingSets.length > 0 guards against .every()'s vacuous "true" on an
    // empty array (e.g. a session where every logged set was marked
    // warm-up) — with zero real working sets, there is nothing clean to
    // recommend a weight increase off of.
    const allSetsClean = workingSets.length > 0 && workingSets.every(
      (set) => set.reps >= exercise.repsHigh && set.rir <= targetRIR,
    );
    if (allSetsClean) {
      return { type: 'increaseWeight', amount: INCREMENT_BY_TYPE[exercise.incrementType] };
    }
  }

  return { type: 'beatLastTime', targetReps };
}
