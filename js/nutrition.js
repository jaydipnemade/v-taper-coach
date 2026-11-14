// js/nutrition.js
// Pure nutrition/diet helpers. No DOM, no IndexedDB — js/ui/diet.js is the
// only consumer and owns all persistence (dietLog) and rendering.

import { MEAL_PLAN, NUTRITION_PHASES, ADD_ONS, PRE_TRAINING_BANANA } from './data/plan.js';

/**
 * @param {string} dayKey one of js/data/plan.js's DAY_ORDER keys
 * @returns {Array<{id: string, name: string, items: string, kcal: number, protein: number}>}
 */
export function getMealsForDay(dayKey) {
  return MEAL_PLAN[dayKey]?.meals ?? [];
}

/**
 * Looks up NUTRITION_PHASES by which phase's `weeks` array contains
 * `weekNumber`.
 *
 * Fallback: `weekNumber` is `null` (plan not started yet, or plan already
 * complete — js/week.js's getWeekInfo returns null in both cases) or any
 * other value outside weeks 1-12. There is no real "current phase" in that
 * case, so this defaults to the stricter `recomp` targets rather than
 * throwing or returning nothing — a trainee who hasn't started (or has
 * finished) the program still eats today, and recomp is the safer default
 * of the two (lower kcal) to show until a real week number is known. The
 * UI layer (js/ui/diet.js) is responsible for telling the user this is a
 * default, not their actual current-week target.
 *
 * @param {number|null} weekNumber
 * @returns {{kcal: number, protein: number, fat: number, carbs: number}}
 */
export function getTargetsForWeek(weekNumber) {
  const { recomp, leanGain } = NUTRITION_PHASES;
  const phase = recomp.weeks.includes(weekNumber)
    ? recomp
    : leanGain.weeks.includes(weekNumber)
      ? leanGain
      : recomp;
  const { kcal, protein, fat, carbs } = phase;
  return { kcal, protein, fat, carbs };
}

/**
 * Sums kcal/protein for the day: checked meals' own kcal/protein, plus the
 * selected add-on's kcal (protein contribution is 0 — add-ons are carb/fat
 * top-ups per the spec), plus the pre-training banana's kcal if checked,
 * plus any custom foods logged for the day.
 *
 * @param {Array<{id: string, kcal: number, protein: number}>} meals
 * @param {string[]} checkedMealIds
 * @param {string|null} addOnId
 * @param {boolean} bananaChecked
 * @param {Array<{kcal: number, protein: number}>} customFoods
 * @returns {{kcal: number, protein: number}}
 */
export function computeDayTotals(meals, checkedMealIds, addOnId, bananaChecked, customFoods) {
  const checkedSet = new Set(checkedMealIds ?? []);
  let kcal = 0;
  let protein = 0;

  for (const meal of meals ?? []) {
    if (checkedSet.has(meal.id)) {
      kcal += meal.kcal;
      protein += meal.protein;
    }
  }

  if (addOnId) {
    const addOn = ADD_ONS.find((a) => a.id === addOnId);
    if (addOn) kcal += addOn.kcal;
  }

  if (bananaChecked) {
    kcal += PRE_TRAINING_BANANA.kcal;
  }

  for (const food of customFoods ?? []) {
    kcal += food.kcal;
    protein += food.protein;
  }

  return { kcal, protein };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Simple case-insensitive substring replace of `fromFood` with `toFood` in
 * `mealItemText`. kcal/protein are intentionally left unchanged by the
 * caller — the spec frames swaps as "similar protein" equivalents, not a
 * recalculation.
 *
 * If the matched text starts with an uppercase letter (e.g. `fromFood` is
 * the first word of a sentence, as in "Chicken tikka..."), the replacement
 * is capitalized to match, rather than silently lowercasing the start of
 * the sentence.
 *
 * @param {string} mealItemText
 * @param {string} fromFood
 * @param {string} toFood
 * @returns {string}
 */
export function applyProteinSwap(mealItemText, fromFood, toFood) {
  const pattern = new RegExp(escapeRegExp(fromFood), 'gi');
  return mealItemText.replace(pattern, (match) => {
    const firstChar = match.charAt(0);
    const wasCapitalized = firstChar !== firstChar.toLowerCase() && firstChar === firstChar.toUpperCase();
    return wasCapitalized ? toFood.charAt(0).toUpperCase() + toFood.slice(1) : toFood;
  });
}
