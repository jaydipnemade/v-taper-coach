// js/ui/diet.js
// The Diet tab — today's meal checklist (persisted), running kcal/protein
// totals with a protein progress ring, the lean-gain add-on picker +
// pre-training-banana checkbox (gated on week >= 5), a protein-swap control
// per meal, and a custom-food quick-add.
//
// Persistence shape (dietLog store, keyPath 'date'):
//   {
//     date: 'YYYY-MM-DD',
//     checkedMealIds: string[],       // meal.id values checked off today
//     addOnId: string|null,           // selected ADD_ONS id, or null
//     bananaChecked: boolean,
//     mealSwaps: { [mealId]: string }, // mealId -> target PROTEIN keyword
//     customFoodIds: number[],         // ids (into the global customFoods
//                                       // store) attached to today
//   }
//
// customFoods themselves are a global, reusable store (js/db.js
// getAllCustomFoods/addCustomFood) — a custom food entered once could in
// principle be logged again on another day, so dietLog only references ids
// into it rather than embedding the food data.

import { ADD_ONS, PRE_TRAINING_BANANA, PROTEIN_SWAPS } from '../data/plan.js';
import { getMealsForDay, getTargetsForWeek, computeDayTotals, applyProteinSwap } from '../nutrition.js';
import { getDietLog, putDietLog, getAllCustomFoods, addCustomFood, getSetting } from '../db.js';
import { getWeekInfo, getDayKeyForDate } from '../week.js';

const ADD_ON_GATE_WEEK = 5;
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Local (not UTC) today as 'YYYY-MM-DD' — same convention as today.js/settings.js. */
function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Protein-swap keyword matching.
//
// PROTEIN_SWAPS entries are phrased as a whole food ("chicken breast",
// "whole eggs", "soya chunks"), but MEAL_PLAN item text never contains that
// exact phrase verbatim (e.g. "chicken curry (150 g breast, 2 tsp oil)") —
// only a single recognizable word from it. So matching/swapping is done on
// a single canonical keyword per protein family, independent of exactly how
// MEAL_PLAN or PROTEIN_SWAPS happens to phrase the rest of the item text.
// This is also what makes applyProteinSwap's brief-specified example work:
// fromFood is 'chicken', not 'chicken breast'.
// ---------------------------------------------------------------------------

const PROTEIN_KEYWORDS = ['chicken', 'fish', 'egg', 'paneer', 'soya'];

/** Maps a PROTEIN_SWAPS entry's `food` string to its canonical keyword. */
function keywordForSwapFood(food) {
  const lower = food.toLowerCase();
  return PROTEIN_KEYWORDS.find((kw) => lower.includes(kw)) ?? null;
}

const SWAP_OPTIONS = PROTEIN_SWAPS
  .map((swap) => ({ swap, keyword: keywordForSwapFood(swap.food) }))
  .filter((entry) => entry.keyword !== null);

function swapOptionLabel(swap) {
  const amount = swap.grams != null ? `${swap.grams}g` : swap.count != null ? `${swap.count}` : '';
  return `${amount} ${swap.food}`.trim();
}

/** Finds which PROTEIN_KEYWORDS word is present (case-insensitively) in a meal's item text, if any. */
function findMealProteinKeyword(itemsText) {
  const lower = itemsText.toLowerCase();
  return PROTEIN_KEYWORDS.find((kw) => lower.includes(kw)) ?? null;
}

/**
 * Computes the item text actually displayed for a meal today: the
 * original plan text, with a stored swap choice (if any) re-applied fresh
 * each render. Always derives from the ORIGINAL text (never a previously
 * swapped one) so repeated swaps/reloads never compound.
 */
function displayedMealItems(meal, dietLog) {
  const matchedKeyword = findMealProteinKeyword(meal.items);
  const chosenKeyword = dietLog.mealSwaps?.[meal.id];
  if (!matchedKeyword || !chosenKeyword || chosenKeyword === matchedKeyword) {
    return meal.items;
  }
  return applyProteinSwap(meal.items, matchedKeyword, chosenKeyword);
}

// ---------------------------------------------------------------------------
// Styles (injected once).
// ---------------------------------------------------------------------------

let stylesInjected = false;

function injectStyles() {
  if (stylesInjected || document.getElementById('diet-styles')) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'diet-styles';
  style.textContent = `
    .diet-heading {
      margin: 0 0 4px;
      font-size: 1.1rem;
    }
    .diet-note {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 0 0 16px;
    }
    .diet-summary {
      display: flex;
      align-items: center;
      gap: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      margin-bottom: 16px;
    }
    .protein-ring-wrap {
      position: relative;
      width: 120px;
      height: 120px;
      flex: 0 0 auto;
    }
    .protein-ring-wrap svg {
      width: 120px;
      height: 120px;
      transform: rotate(-90deg);
    }
    .protein-ring-track {
      fill: none;
      stroke: var(--border);
      stroke-width: 10;
    }
    .protein-ring-fill {
      fill: none;
      stroke: var(--accent);
      stroke-width: 10;
      stroke-linecap: round;
      transition: stroke-dasharray 0.2s ease;
    }
    .protein-ring-label {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .protein-ring-label .stat-number {
      font-size: 1.4rem;
    }
    .diet-stats {
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .diet-stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
    }
    .diet-stat-row .diet-stat-value {
      font-weight: 600;
    }
    .meal-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }
    .meal-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
    }
    .meal-card-header {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .meal-card-header input[type="checkbox"] {
      margin-top: 2px;
      flex: 0 0 auto;
    }
    .meal-card-title-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
      flex: 1 1 auto;
    }
    .meal-card-name {
      font-weight: 600;
    }
    .meal-card-macros {
      color: var(--text-dim);
      font-size: 0.8rem;
      white-space: nowrap;
    }
    .meal-card-items {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 4px 0 0;
    }
    .meal-swap {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
    .meal-swap-label {
      font-size: 0.78rem;
      color: var(--text-dim);
      margin: 0 0 6px;
    }
    .meal-swap-options {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .meal-swap-btn {
      font-size: 0.78rem;
      padding: 4px 8px;
      min-height: var(--tap-min);
    }
    .meal-swap-btn.is-active {
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .diet-section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      margin-bottom: 16px;
    }
    .diet-section h3 {
      margin: 0 0 8px;
      font-size: 0.95rem;
    }
    .addon-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .addon-option {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
    }
    .banana-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
    }
    .custom-food-list {
      list-style: none;
      margin: 0 0 10px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .custom-food-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
    }
    .custom-food-remove {
      font-size: 0.75rem;
      padding: 2px 8px;
      min-height: var(--tap-min);
    }
    .custom-food-form {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .custom-food-form input {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--surface-alt);
      color: inherit;
      padding: 8px 10px;
      min-height: var(--tap-min);
    }
    .custom-food-form input[name="name"] {
      flex: 1 1 140px;
    }
    .custom-food-form input[name="kcal"],
    .custom-food-form input[name="protein"] {
      flex: 0 1 80px;
    }
    .custom-food-form button {
      flex: 0 0 auto;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Persistence helpers.
// ---------------------------------------------------------------------------

function defaultDietLog(date) {
  return {
    date,
    checkedMealIds: [],
    addOnId: null,
    bananaChecked: false,
    mealSwaps: {},
    customFoodIds: [],
  };
}

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

function renderProteinRing(protein, proteinTarget) {
  const wrap = document.createElement('div');
  wrap.className = 'protein-ring-wrap';

  const pct = proteinTarget > 0 ? Math.min(1, protein / proteinTarget) : 0;
  const filled = RING_CIRCUMFERENCE * pct;

  wrap.innerHTML = `
    <svg viewBox="0 0 120 120">
      <circle class="protein-ring-track" cx="60" cy="60" r="${RING_RADIUS}"></circle>
      <circle class="protein-ring-fill" cx="60" cy="60" r="${RING_RADIUS}"
        stroke-dasharray="${filled} ${RING_CIRCUMFERENCE}"></circle>
    </svg>
    <div class="protein-ring-label">
      <span class="stat-number">${Math.round(protein)}</span>
      <span class="stat-label">of ${proteinTarget}g protein</span>
    </div>
  `;
  return wrap;
}

function renderSummary(totals, targets) {
  const summary = document.createElement('div');
  summary.className = 'diet-summary';
  summary.appendChild(renderProteinRing(totals.protein, targets.protein));

  const stats = document.createElement('div');
  stats.className = 'diet-stats';

  const kcalRow = document.createElement('div');
  kcalRow.className = 'diet-stat-row';
  kcalRow.innerHTML = `<span>Calories</span><span class="diet-stat-value">${Math.round(totals.kcal)} / ${targets.kcal} kcal</span>`;

  const fatRow = document.createElement('div');
  fatRow.className = 'diet-stat-row';
  fatRow.innerHTML = `<span>Fat target</span><span class="diet-stat-value">${targets.fat} g</span>`;

  const carbsRow = document.createElement('div');
  carbsRow.className = 'diet-stat-row';
  carbsRow.innerHTML = `<span>Carbs target</span><span class="diet-stat-value">${targets.carbs} g</span>`;

  stats.append(kcalRow, fatRow, carbsRow);
  summary.appendChild(stats);
  return summary;
}

/**
 * @param {object} meal
 * @param {object} dietLog
 * @param {() => Promise<void>} onChange persists dietLog and re-renders the tab
 */
function renderMealCard(meal, dietLog, onChange) {
  const card = document.createElement('div');
  card.className = 'meal-card';

  const header = document.createElement('div');
  header.className = 'meal-card-header';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = dietLog.checkedMealIds.includes(meal.id);
  checkbox.setAttribute('aria-label', `Mark ${meal.name} eaten`);
  checkbox.addEventListener('change', async () => {
    const idx = dietLog.checkedMealIds.indexOf(meal.id);
    if (checkbox.checked && idx === -1) {
      dietLog.checkedMealIds.push(meal.id);
    } else if (!checkbox.checked && idx !== -1) {
      dietLog.checkedMealIds.splice(idx, 1);
    }
    await onChange();
  });

  const titleBlock = document.createElement('div');
  titleBlock.style.flex = '1 1 auto';

  const titleRow = document.createElement('div');
  titleRow.className = 'meal-card-title-row';
  const nameEl = document.createElement('span');
  nameEl.className = 'meal-card-name';
  nameEl.textContent = meal.name;
  const macrosEl = document.createElement('span');
  macrosEl.className = 'meal-card-macros';
  macrosEl.textContent = `${meal.kcal} kcal · ${meal.protein}g protein`;
  titleRow.append(nameEl, macrosEl);

  const itemsEl = document.createElement('p');
  itemsEl.className = 'meal-card-items';
  itemsEl.textContent = displayedMealItems(meal, dietLog);

  titleBlock.append(titleRow, itemsEl);
  header.append(checkbox, titleBlock);
  card.appendChild(header);

  const matchedKeyword = findMealProteinKeyword(meal.items);
  const swapTargets = SWAP_OPTIONS.filter((opt) => opt.keyword !== matchedKeyword);
  if (matchedKeyword && swapTargets.length > 0) {
    const swapWrap = document.createElement('div');
    swapWrap.className = 'meal-swap';

    const label = document.createElement('p');
    label.className = 'meal-swap-label';
    label.textContent = 'Swap protein source:';
    swapWrap.appendChild(label);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'meal-swap-options';

    const currentChoice = dietLog.mealSwaps?.[meal.id] ?? matchedKeyword;

    swapTargets.forEach(({ swap, keyword }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = currentChoice === keyword ? 'meal-swap-btn is-active' : 'meal-swap-btn';
      btn.textContent = swapOptionLabel(swap);
      btn.addEventListener('click', async () => {
        dietLog.mealSwaps[meal.id] = keyword;
        await onChange();
      });
      optionsRow.appendChild(btn);
    });

    // "Revert to original" only shown once a swap has actually been chosen.
    if (dietLog.mealSwaps?.[meal.id] && dietLog.mealSwaps[meal.id] !== matchedKeyword) {
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'meal-swap-btn';
      resetBtn.textContent = 'Original';
      resetBtn.addEventListener('click', async () => {
        delete dietLog.mealSwaps[meal.id];
        await onChange();
      });
      optionsRow.appendChild(resetBtn);
    }

    swapWrap.appendChild(optionsRow);
    card.appendChild(swapWrap);
  }

  return card;
}

function renderAddOnSection(dietLog, onChange) {
  const section = document.createElement('div');
  section.className = 'diet-section';

  const title = document.createElement('h3');
  title.textContent = 'Lean-gain add-on (week 5+)';
  section.appendChild(title);

  const optionsWrap = document.createElement('div');
  optionsWrap.className = 'addon-options';

  const noneLabel = document.createElement('label');
  noneLabel.className = 'addon-option';
  const noneRadio = document.createElement('input');
  noneRadio.type = 'radio';
  noneRadio.name = 'diet-addon';
  noneRadio.checked = !dietLog.addOnId;
  noneRadio.addEventListener('change', async () => {
    dietLog.addOnId = null;
    await onChange();
  });
  noneLabel.append(noneRadio, document.createTextNode('None'));
  optionsWrap.appendChild(noneLabel);

  ADD_ONS.forEach((addOn) => {
    const label = document.createElement('label');
    label.className = 'addon-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'diet-addon';
    radio.checked = dietLog.addOnId === addOn.id;
    radio.addEventListener('change', async () => {
      dietLog.addOnId = addOn.id;
      await onChange();
    });
    label.append(radio, document.createTextNode(`${addOn.label} (+${addOn.kcal} kcal)`));
    optionsWrap.appendChild(label);
  });

  section.appendChild(optionsWrap);

  const bananaRow = document.createElement('label');
  bananaRow.className = 'banana-row';
  const bananaCheckbox = document.createElement('input');
  bananaCheckbox.type = 'checkbox';
  bananaCheckbox.checked = Boolean(dietLog.bananaChecked);
  bananaCheckbox.addEventListener('change', async () => {
    dietLog.bananaChecked = bananaCheckbox.checked;
    await onChange();
  });
  bananaRow.append(bananaCheckbox, document.createTextNode(`${PRE_TRAINING_BANANA.label} (+${PRE_TRAINING_BANANA.kcal} kcal)`));
  section.appendChild(bananaRow);

  return section;
}

function renderCustomFoodSection(dietLog, todayCustomFoods, onChange) {
  const section = document.createElement('div');
  section.className = 'diet-section';

  const title = document.createElement('h3');
  title.textContent = 'Custom food';
  section.appendChild(title);

  if (todayCustomFoods.length > 0) {
    const list = document.createElement('ul');
    list.className = 'custom-food-list';
    todayCustomFoods.forEach((food) => {
      const li = document.createElement('li');
      li.className = 'custom-food-row';
      const text = document.createElement('span');
      text.textContent = `${food.name} — ${food.kcal} kcal · ${food.protein}g protein`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'custom-food-remove';
      removeBtn.textContent = 'Remove';
      removeBtn.setAttribute('aria-label', `Remove ${food.name} from today`);
      removeBtn.addEventListener('click', async () => {
        dietLog.customFoodIds = dietLog.customFoodIds.filter((id) => id !== food.id);
        await onChange();
      });
      li.append(text, removeBtn);
      list.appendChild(li);
    });
    section.appendChild(list);
  }

  const form = document.createElement('form');
  form.className = 'custom-food-form';

  const nameInput = document.createElement('input');
  nameInput.name = 'name';
  nameInput.type = 'text';
  nameInput.placeholder = 'Food name';
  nameInput.required = true;

  const kcalInput = document.createElement('input');
  kcalInput.name = 'kcal';
  kcalInput.type = 'number';
  kcalInput.placeholder = 'kcal';
  kcalInput.min = '0';
  kcalInput.required = true;

  const proteinInput = document.createElement('input');
  proteinInput.name = 'protein';
  proteinInput.type = 'number';
  proteinInput.placeholder = 'protein (g)';
  proteinInput.min = '0';
  proteinInput.required = true;

  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.textContent = 'Add';

  form.append(nameInput, kcalInput, proteinInput, addBtn);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const kcal = parseFloat(kcalInput.value);
    const protein = parseFloat(proteinInput.value);
    if (!name || !Number.isFinite(kcal) || !Number.isFinite(protein)) return;

    const newId = await addCustomFood({ name, kcal, protein });
    dietLog.customFoodIds.push(newId);
    await onChange();
  });

  section.appendChild(form);
  return section;
}

/**
 * @param {HTMLElement} container
 */
export async function renderDietTab(container) {
  injectStyles();

  const settings = await getSetting();
  const today = todayISO();

  let weekNumber = null;
  let dayKey;
  if (settings?.startDate) {
    const info = getWeekInfo(settings.startDate, today);
    weekNumber = info.weekNumber;
    dayKey = info.dayKey;
  } else {
    // No start date set yet — training week is unknown, but the trainee
    // still eats today, so fall back to today's actual weekday for the
    // meal plan and let getTargetsForWeek(null) supply its documented
    // recomp-phase default for macros.
    dayKey = getDayKeyForDate(today);
  }

  const [dietLog, allCustomFoods] = await Promise.all([
    getDietLog(today),
    getAllCustomFoods(),
  ]);
  const log = dietLog ?? defaultDietLog(today);
  if (!log.mealSwaps) log.mealSwaps = {};
  if (!log.customFoodIds) log.customFoodIds = [];
  if (!log.checkedMealIds) log.checkedMealIds = [];

  const meals = getMealsForDay(dayKey);
  // getTargetsForWeek is pure and only reads NUTRITION_PHASES (js/nutrition.js) —
  // it knows nothing about check-ins, so the Progress tab's check-in-wizard
  // kcal adjustment (js/ui/progress.js, settings.calorieOverride) is applied
  // here instead, on top of the pure function's result.
  const calorieOverride = settings?.calorieOverride ?? 0;
  const baseTargets = getTargetsForWeek(weekNumber);
  const targets = { ...baseTargets, kcal: baseTargets.kcal + calorieOverride };
  const todayCustomFoods = allCustomFoods.filter((f) => log.customFoodIds.includes(f.id));
  const totals = computeDayTotals(meals, log.checkedMealIds, log.addOnId, log.bananaChecked, todayCustomFoods);
  const showAddOns = weekNumber !== null && weekNumber >= ADD_ON_GATE_WEEK;

  async function persistAndRerender() {
    log.date = today;
    await putDietLog(log);
    await renderDietTab(container);
  }

  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'diet-tab';

  const heading = document.createElement('h1');
  heading.className = 'diet-heading';
  heading.textContent = weekNumber !== null ? `Diet — Week ${weekNumber}` : 'Diet';
  root.appendChild(heading);

  if (weekNumber === null) {
    const note = document.createElement('p');
    note.className = 'diet-note';
    note.textContent = settings?.startDate
      ? "Your 12-week plan hasn't started yet (or is complete) — showing default recomp-phase targets."
      : 'Set your start date in Settings for week-specific macros — showing default recomp-phase targets for now.';
    root.appendChild(note);
  }

  if (calorieOverride !== 0) {
    const overrideNote = document.createElement('p');
    overrideNote.className = 'diet-note';
    overrideNote.textContent = `Calorie target includes a ${calorieOverride > 0 ? '+' : ''}${calorieOverride} kcal/day check-in adjustment.`;
    root.appendChild(overrideNote);
  }

  root.appendChild(renderSummary(totals, targets));

  const mealList = document.createElement('div');
  mealList.className = 'meal-list';
  meals.forEach((meal) => {
    mealList.appendChild(renderMealCard(meal, log, persistAndRerender));
  });
  root.appendChild(mealList);

  if (showAddOns) {
    root.appendChild(renderAddOnSection(log, persistAndRerender));
  }

  root.appendChild(renderCustomFoodSection(log, todayCustomFoods, persistAndRerender));

  container.appendChild(root);
}
