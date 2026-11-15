// js/ui/settings.js
// Profile/settings form — used both as the ongoing "Settings" tab and as a
// full-screen first-run setup gate (before any `settings` record exists).
//
// Settings record shape (stored via `putSetting`, keyPath 'id' = 'app'):
//   {
//     id: 'app',          // added by putSetting itself
//     startDate: 'YYYY-MM-DD',   // ISO date string, local
//     units: 'metric' | 'imperial',
//     heightCm: number,   // always stored canonically in metric
//     weightKg: number,   // always stored canonically in metric
//     age: number,
//     lastBackupDate?: string,  // 'YYYY-MM-DD' — set by the Export backup
//       button (Task 17), read here for the last-backup line/nudge banner.
//     groceryChecklist?: {     // weekly grocery checklist (Task 16) — no
//       weekOf: 'YYYY-MM-DD',  // separate IndexedDB store; just a field here
//       checkedItems: string[],  // GROCERY_LIST item strings (no id field
//     },                         // on GROCERY_LIST entries, so the item
//                                 // text itself is the checklist identity)
//     sundayPrepChecklist?: {  // weekly Sunday-prep checklist (final-review
//       weekOf: 'YYYY-MM-DD',  // batch B) — same shape/staleness logic as
//       checkedItems: string[], // groceryChecklist above; SUNDAY_PREP_STEPS
//     },                        // strings (no id field) are the identity.
//     trainsInMorning?: boolean,  // final-review batch B — true = trains in
//       // the morning (default false/absent = evening training, the plan's
//       // default assumption). Read by diet.js to relabel the breakfast/
//       // dinner meal names (MEAL_PLAN itself is never mutated).
//     calorieOverride?: number,  // cumulative kcal/day adjustment from
//       // confirmed check-in decisions (js/ui/progress.js), applied on top
//       // of NUTRITION_PHASES[phase].kcal (js/ui/diet.js). Defaults to 0
//       // when absent (`settings?.calorieOverride ?? 0` at every read site).
//       // Reset to 0 by the "Start new block" action (final-review batch C)
//       // so a new block doesn't inherit the old block's adjustment.
//     blockNumber?: number,  // final-review batch C — which 12-week block
//       // this is, starting at 1. Absent on every settings record created
//       // before this field existed; every read site treats that the same
//       // as 1 (`settings?.blockNumber ?? 1`). Incremented by the "Start new
//       // block" action each time startDate is moved forward.
//   }
//
// Height/weight are always persisted in metric regardless of the `units`
// chosen; the imperial unit is purely a display/input convenience converted
// at the form boundary.

import { getSetting, putSetting, exportAllData, importAllData, clearCheckins } from '../db.js';
import { GROCERY_LIST, SUPPLEMENTS, SUNDAY_PREP_STEPS, MORNING_TRAINING_NOTE } from '../data/plan.js';
import { getWeekInfo } from '../week.js';

const DEFAULT_HEIGHT_CM = 173;
const DEFAULT_WEIGHT_KG = 67;
const DEFAULT_AGE = 29;
const DEFAULT_UNITS = 'metric';

const CM_PER_IN = 2.54;
const KG_PER_LB = 0.45359237;

function cmToIn(cm) {
  return cm / CM_PER_IN;
}

function inToCm(inches) {
  return inches * CM_PER_IN;
}

function kgToLb(kg) {
  return kg / KG_PER_LB;
}

function lbToKg(lb) {
  return lb * KG_PER_LB;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Local (not UTC) today as 'YYYY-MM-DD', suitable for <input type="date">. */
function todayISO() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

let stylesInjected = false;

/**
 * Injects the (small) layout CSS this module needs, once. Reuses the
 * existing theme's CSS custom properties / tap-target rules from
 * css/styles.css rather than hardcoding colors or sizes.
 */
function injectStyles() {
  if (stylesInjected || document.getElementById('settings-styles')) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'settings-styles';
  style.textContent = `
    .settings-form {
      display: flex;
      flex-direction: column;
    }
    .settings-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 16px;
    }
    .settings-field label {
      font-size: 0.85rem;
      color: var(--text-dim);
    }
    .settings-field input,
    .settings-field select {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 8px 10px;
      min-height: var(--tap-min);
      font-size: 1rem;
    }
    .settings-checkbox-field {
      margin-top: -4px;
    }
    .settings-checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: var(--tap-min);
      color: var(--text);
      font-size: 1rem;
    }
    .settings-checkbox-help {
      color: var(--text-dim);
      font-size: 0.8rem;
      margin: 4px 0 0;
    }
    .settings-actions {
      display: flex;
      gap: 12px;
      margin-top: 8px;
    }
    .settings-actions button[type="submit"] {
      flex: 1 1 auto;
      background: var(--accent);
      color: var(--accent-text);
      border-color: var(--accent);
      font-weight: 600;
      min-height: var(--tap-min);
    }
    .settings-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      margin-top: 24px;
    }
    .settings-card h2 {
      margin-top: 0;
      font-size: 1rem;
    }
    .settings-last-backup {
      color: var(--text-dim);
      font-size: 0.9rem;
      margin: 0;
    }
    .settings-backup-nudge {
      color: var(--danger);
      font-size: 0.9rem;
      margin: 6px 0 0;
      font-weight: 600;
    }
    .settings-backup-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
    }
    .settings-backup-actions button,
    .settings-backup-actions label {
      min-height: var(--tap-min);
    }
    .settings-import-label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0 12px;
      font-size: 1rem;
      cursor: pointer;
    }
    .settings-import-label input[type="file"] {
      display: none;
    }
    .settings-backup-actions button[type="button"] {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: 1rem;
      padding: 0 12px;
    }
    .grocery-week-of {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 0 0 12px;
    }
    .grocery-category {
      margin: 16px 0 6px;
      font-size: 0.9rem;
    }
    .grocery-category:first-of-type {
      margin-top: 8px;
    }
    .grocery-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .grocery-list li {
      margin-bottom: 8px;
    }
    .grocery-list label {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-height: var(--tap-min);
    }
    .supplements-list {
      margin: 0;
    }
    .supplements-list dt {
      font-weight: 600;
      margin-top: 10px;
    }
    .supplements-list dt:first-child {
      margin-top: 0;
    }
    .supplements-list dd {
      color: var(--text-dim);
      font-size: 0.85rem;
      margin: 2px 0 0;
    }
    .settings-firstrun-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: var(--bg);
      overflow-y: auto;
      padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
    }
    .settings-firstrun-overlay h1 {
      font-size: 1.3rem;
      margin-top: 0;
    }
    .settings-firstrun-intro {
      color: var(--text-dim);
      margin-top: 0;
      margin-bottom: 24px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Builds one labeled form-field (wrapper div + label + control), wiring up
 * a stable id/for pair.
 * @param {string} labelText
 * @param {'input'|'select'} tag
 * @param {string} id
 */
function createField(labelText, tag, id) {
  const wrapper = document.createElement('div');
  wrapper.className = 'settings-field';

  const label = document.createElement('label');
  label.setAttribute('for', id);
  label.textContent = labelText;

  const control = document.createElement(tag);
  control.id = id;

  wrapper.append(label, control);
  return { wrapper, control, labelEl: label };
}

/**
 * Shared form-building helper used by both `renderSettingsTab` (ongoing
 * Settings tab) and `runFirstRunSetupIfNeeded` (first-run gate) — the one
 * source of truth for the profile fields, defaults, and unit conversion.
 *
 * @param {object|null} settings - existing settings record, or null/undefined
 *   when none exists yet (first run) — in which case spec defaults are used.
 * @param {(saved: object) => void|Promise<void>} onSaved - called after
 *   `putSetting` has successfully persisted the new record.
 * @returns {HTMLFormElement}
 */
function buildProfileForm(settings, onSaved) {
  // Canonical (metric) working copy of height/weight, kept in sync as the
  // user edits fields or flips the units toggle, independent of whatever
  // unit the visible inputs currently display.
  const model = {
    heightCm: typeof settings?.heightCm === 'number' ? settings.heightCm : DEFAULT_HEIGHT_CM,
    weightKg: typeof settings?.weightKg === 'number' ? settings.weightKg : DEFAULT_WEIGHT_KG,
    units: settings?.units === 'imperial' ? 'imperial' : DEFAULT_UNITS,
  };

  const form = document.createElement('form');
  form.className = 'settings-form';
  form.noValidate = true;

  const unitsField = createField('Units', 'select', 'settings-units');
  const unitsSelect = unitsField.control;
  for (const [value, label] of [
    ['metric', 'Metric (cm / kg)'],
    ['imperial', 'Imperial (in / lb)'],
  ]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    unitsSelect.appendChild(opt);
  }
  unitsSelect.value = model.units;

  const dateField = createField('Start date', 'input', 'settings-start-date');
  const dateInput = dateField.control;
  dateInput.type = 'date';
  dateInput.required = true;
  dateInput.value = settings?.startDate || todayISO();

  const heightField = createField('Height', 'input', 'settings-height');
  const heightInput = heightField.control;
  heightInput.type = 'number';
  heightInput.required = true;
  heightInput.step = '0.1';
  heightInput.min = '0';

  const weightField = createField('Weight', 'input', 'settings-weight');
  const weightInput = weightField.control;
  weightInput.type = 'number';
  weightInput.required = true;
  weightInput.step = '0.1';
  weightInput.min = '0';

  const ageField = createField('Age', 'input', 'settings-age');
  const ageInput = ageField.control;
  ageInput.type = 'number';
  ageInput.required = true;
  ageInput.step = '1';
  ageInput.min = '1';
  ageInput.value = String(typeof settings?.age === 'number' ? settings.age : DEFAULT_AGE);

  // Morning-training toggle (final-review batch B) — a genuine persisted
  // setting (settings.trainsInMorning), not hardcoded into the meal data;
  // read by diet.js at render time to relabel breakfast/dinner meal names.
  const morningField = document.createElement('div');
  morningField.className = 'settings-field settings-checkbox-field';

  const morningLabel = document.createElement('label');
  morningLabel.className = 'settings-checkbox-label';
  const morningCheckbox = document.createElement('input');
  morningCheckbox.type = 'checkbox';
  morningCheckbox.id = 'settings-trains-in-morning';
  morningCheckbox.checked = Boolean(settings?.trainsInMorning);
  morningLabel.append(morningCheckbox, document.createTextNode(' I train in the morning'));

  const morningHelp = document.createElement('p');
  morningHelp.className = 'settings-checkbox-help';
  morningHelp.textContent = MORNING_TRAINING_NOTE;

  morningField.append(morningLabel, morningHelp);

  /** Re-renders height/weight inputs + labels for the given units, from `model`. */
  function applyUnitsToInputs(units) {
    if (units === 'imperial') {
      heightField.labelEl.textContent = 'Height (in)';
      weightField.labelEl.textContent = 'Weight (lb)';
      heightInput.value = String(round1(cmToIn(model.heightCm)));
      weightInput.value = String(round1(kgToLb(model.weightKg)));
    } else {
      heightField.labelEl.textContent = 'Height (cm)';
      weightField.labelEl.textContent = 'Weight (kg)';
      heightInput.value = String(round1(model.heightCm));
      weightInput.value = String(round1(model.weightKg));
    }
  }

  applyUnitsToInputs(model.units);

  unitsSelect.addEventListener('change', () => {
    // Capture whatever the user currently has typed (in the OLD units)
    // into the canonical metric model before switching the displayed units,
    // so toggling back and forth doesn't silently discard edits.
    const previousUnits = model.units;
    const heightTyped = parseFloat(heightInput.value);
    const weightTyped = parseFloat(weightInput.value);
    if (!Number.isNaN(heightTyped)) {
      model.heightCm = previousUnits === 'imperial' ? inToCm(heightTyped) : heightTyped;
    }
    if (!Number.isNaN(weightTyped)) {
      model.weightKg = previousUnits === 'imperial' ? lbToKg(weightTyped) : weightTyped;
    }
    model.units = unitsSelect.value;
    applyUnitsToInputs(model.units);
  });

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = settings ? 'Save' : 'Get started';

  const actions = document.createElement('div');
  actions.className = 'settings-actions';
  actions.appendChild(submitBtn);

  form.append(
    unitsField.wrapper,
    dateField.wrapper,
    heightField.wrapper,
    weightField.wrapper,
    ageField.wrapper,
    morningField,
    actions
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const units = unitsSelect.value === 'imperial' ? 'imperial' : 'metric';
    const heightRaw = parseFloat(heightInput.value);
    const weightRaw = parseFloat(weightInput.value);
    const age = parseInt(ageInput.value, 10);
    const startDate = dateInput.value;

    if (Number.isNaN(heightRaw) || Number.isNaN(weightRaw) || Number.isNaN(age) || !startDate) {
      // Native required/number validity should normally catch this first;
      // this is just a defensive guard against writing a malformed record.
      return;
    }

    const heightCm = units === 'imperial' ? inToCm(heightRaw) : heightRaw;
    const weightKg = units === 'imperial' ? lbToKg(weightRaw) : weightRaw;

    const saved = {
      ...(settings || {}),
      startDate,
      units,
      heightCm,
      weightKg,
      age,
      trainsInMorning: morningCheckbox.checked,
    };

    submitBtn.disabled = true;
    try {
      await putSetting(saved);
      if (typeof onSaved === 'function') {
        await onSaved(saved);
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  return form;
}

// ---------------------------------------------------------------------------
// Grocery checklist (Task 16) — GROCERY_LIST grouped by category, backed by
// `settings.groceryChecklist = { weekOf, checkedItems }`. No new IndexedDB
// store: it's just a field merged into the existing single `settings`
// record via the same getSetting()/putSetting() pair the profile form uses.
//
// The Sunday-prep checklist (final-review batch B, below) is structurally
// identical — same shape, same staleness rule — just on a different
// settings field and a flat (uncategorized) item list, so both share the
// CHECKLIST_STALE_AFTER_DAYS constant and resolveChecklist() helper here.
// ---------------------------------------------------------------------------

const CHECKLIST_STALE_AFTER_DAYS = 7;

/** Whole-day difference between two 'YYYY-MM-DD' strings, both parsed as
 * local midnight. Math.round (not Math.floor) because a DST transition
 * between the two dates shifts the actual elapsed-ms difference by about
 * an hour either way, so the raw division can land on e.g. 6.958 or 7.042
 * instead of exactly 7 — rounding absorbs that without needing a
 * timezone-aware date library. */
function daysBetweenISO(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00`);
  const to = new Date(`${toISO}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Returns the checklist stored at `settings[fieldKey]` to render, resetting
 * it (and persisting that reset via putSetting, merged into the existing
 * settings record) if it's absent or more than CHECKLIST_STALE_AFTER_DAYS
 * days old. Shared by both the grocery checklist (fieldKey
 * 'groceryChecklist') and the Sunday-prep checklist (fieldKey
 * 'sundayPrepChecklist') below — same shape, same staleness rule.
 * @param {object|null} settings
 * @param {string} fieldKey
 * @returns {Promise<{weekOf: string, checkedItems: string[]}>}
 */
async function resolveChecklist(settings, fieldKey) {
  const today = todayISO();
  const existing = settings?.[fieldKey];
  const isStale =
    !existing?.weekOf || daysBetweenISO(existing.weekOf, today) > CHECKLIST_STALE_AFTER_DAYS;

  if (!isStale) {
    return {
      weekOf: existing.weekOf,
      checkedItems: Array.isArray(existing.checkedItems) ? existing.checkedItems : [],
    };
  }

  const resetChecklist = { weekOf: today, checkedItems: [] };
  // Re-read immediately before writing (rather than merging from the
  // `settings` snapshot passed in) so that two resolveChecklist() calls in
  // the same render — grocery then Sunday-prep — don't clobber each other's
  // resets: without this, the second call's merge-from-stale-snapshot write
  // would silently overwrite the first call's freshly-reset field.
  const current = await getSetting();
  await putSetting({ ...(current || {}), [fieldKey]: resetChecklist });
  return resetChecklist;
}

/**
 * Builds the grocery checklist card, grouped by GROCERY_LIST's `category`.
 * Each checkbox toggle re-reads the current settings record immediately
 * before writing, so it never clobbers fields changed elsewhere (e.g. the
 * profile form, or a backup timestamp) since this card was rendered.
 * @param {{weekOf: string, checkedItems: string[]}} checklist
 * @returns {HTMLElement}
 */
function renderGroceryChecklist(checklist) {
  const card = document.createElement('section');
  card.className = 'settings-card';
  card.setAttribute('data-settings-section', 'grocery');

  const heading = document.createElement('h2');
  heading.textContent = 'Weekly grocery list';
  card.appendChild(heading);

  const weekOfLine = document.createElement('p');
  weekOfLine.className = 'grocery-week-of';
  weekOfLine.textContent = `Week of ${checklist.weekOf}`;
  card.appendChild(weekOfLine);

  // Identity here is the raw `item` string (GROCERY_LIST entries have no
  // id field). Safe today because GROCERY_LIST has no duplicate item names
  // across categories — if a future data edit adds one, switch this (and
  // the data-read in the checkbox below) to a `${category}::${item}`
  // composite key instead.
  const checkedItems = new Set(checklist.checkedItems);

  async function persistCheckedItems() {
    const current = await getSetting();
    await putSetting({
      ...(current || {}),
      groceryChecklist: { weekOf: checklist.weekOf, checkedItems: Array.from(checkedItems) },
    });
  }

  const categories = new Map();
  for (const entry of GROCERY_LIST) {
    if (!categories.has(entry.category)) categories.set(entry.category, []);
    categories.get(entry.category).push(entry);
  }

  for (const [category, items] of categories) {
    const categoryHeading = document.createElement('h3');
    categoryHeading.className = 'grocery-category';
    categoryHeading.textContent = category;
    card.appendChild(categoryHeading);

    const list = document.createElement('ul');
    list.className = 'grocery-list';
    items.forEach((entry) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checkedItems.has(entry.item);
      checkbox.addEventListener('change', async () => {
        if (checkbox.checked) checkedItems.add(entry.item);
        else checkedItems.delete(entry.item);
        await persistCheckedItems();
      });
      label.append(checkbox, document.createTextNode(`${entry.item} — ${entry.quantity}`));
      li.appendChild(label);
      list.appendChild(li);
    });
    card.appendChild(list);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Sunday-prep checklist (final-review batch B) — structurally identical to
// the grocery checklist above (shared resolveChecklist()/
// CHECKLIST_STALE_AFTER_DAYS), backed by `settings.sundayPrepChecklist =
// { weekOf, checkedItems }`. SUNDAY_PREP_STEPS is a flat array of plain
// strings (no categories, no id field), so checked-item identity is the
// step string itself — same caveat as the grocery list's.
// ---------------------------------------------------------------------------

/**
 * Builds the Sunday-prep checklist card, rendering SUNDAY_PREP_STEPS as a
 * flat checklist. Each checkbox toggle re-reads the current settings record
 * immediately before writing (same read-merge-write pattern as
 * renderGroceryChecklist above).
 * @param {{weekOf: string, checkedItems: string[]}} checklist
 * @returns {HTMLElement}
 */
function renderSundayPrepChecklist(checklist) {
  const card = document.createElement('section');
  card.className = 'settings-card';
  card.setAttribute('data-settings-section', 'sunday-prep');

  const heading = document.createElement('h2');
  heading.textContent = 'Sunday prep checklist';
  card.appendChild(heading);

  const weekOfLine = document.createElement('p');
  weekOfLine.className = 'grocery-week-of';
  weekOfLine.textContent = `Week of ${checklist.weekOf}`;
  card.appendChild(weekOfLine);

  const checkedItems = new Set(checklist.checkedItems);

  async function persistCheckedItems() {
    const current = await getSetting();
    await putSetting({
      ...(current || {}),
      sundayPrepChecklist: { weekOf: checklist.weekOf, checkedItems: Array.from(checkedItems) },
    });
  }

  const list = document.createElement('ul');
  list.className = 'grocery-list';
  SUNDAY_PREP_STEPS.forEach((step) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checkedItems.has(step);
    checkbox.addEventListener('change', async () => {
      if (checkbox.checked) checkedItems.add(step);
      else checkedItems.delete(step);
      await persistCheckedItems();
    });
    label.append(checkbox, document.createTextNode(step));
    li.appendChild(label);
    list.appendChild(li);
  });
  card.appendChild(list);

  return card;
}

// ---------------------------------------------------------------------------
// Supplements (final-review batch B) — read-only reference display of
// SUPPLEMENTS ({name, dose, why}). No checklist/settings state: this is
// reference info, not a weekly task.
// ---------------------------------------------------------------------------

function renderSupplementsCard() {
  const card = document.createElement('section');
  card.className = 'settings-card';
  card.setAttribute('data-settings-section', 'supplements');

  const heading = document.createElement('h2');
  heading.textContent = 'Supplements';
  card.appendChild(heading);

  const list = document.createElement('dl');
  list.className = 'supplements-list';
  SUPPLEMENTS.forEach((supplement) => {
    const nameEl = document.createElement('dt');
    nameEl.textContent = `${supplement.name} — ${supplement.dose}`;
    const whyEl = document.createElement('dd');
    whyEl.textContent = supplement.why;
    list.append(nameEl, whyEl);
  });
  card.appendChild(list);

  return card;
}

// ---------------------------------------------------------------------------
// Backup export/import (Task 17) — JSON dump of exportAllData()/importAllData()
// (Task 2, js/db.js) wired to a download link and a file input. The
// "last backup" staleness check reuses the same daysBetweenISO() helper the
// grocery checklist (Task 16) uses above, on a separate `lastBackupDate`
// field ('YYYY-MM-DD', stored the same read-merge-write way via putSetting).
// ---------------------------------------------------------------------------

const BACKUP_STALE_AFTER_DAYS = 7;

/**
 * Whether the stored backup date is missing or more than
 * BACKUP_STALE_AFTER_DAYS days old.
 * @param {string|undefined|null} lastBackupDate - 'YYYY-MM-DD', or absent.
 * @param {string} today - 'YYYY-MM-DD'.
 * @returns {boolean}
 */
function isBackupStale(lastBackupDate, today) {
  return !lastBackupDate || daysBetweenISO(lastBackupDate, today) > BACKUP_STALE_AFTER_DAYS;
}

/**
 * Builds the Backup card: an "Export backup" button (downloads a JSON dump
 * of `exportAllData()` and stamps `settings.lastBackupDate`), an "Import
 * backup" file input (confirms against the file's `exportedAt`, then calls
 * `importAllData()` and reloads), and a "Last backup" line with a
 * staleness nudge banner.
 * @param {object|null} settings
 * @param {HTMLElement} container - the Settings tab root; re-rendered after
 *   a successful export so the last-backup line/nudge reflect the new date,
 *   the same way the profile form's onSaved re-renders after a save.
 * @returns {HTMLElement}
 */
function renderBackupCard(settings, container) {
  const card = document.createElement('section');
  card.className = 'settings-card';
  card.setAttribute('data-settings-section', 'backup');

  const heading = document.createElement('h2');
  heading.textContent = 'Backup';
  card.appendChild(heading);

  const lastBackupLine = document.createElement('p');
  lastBackupLine.className = 'settings-last-backup';
  lastBackupLine.setAttribute('data-settings-field', 'last-backup');
  lastBackupLine.textContent = settings?.lastBackupDate
    ? `Last backup: ${settings.lastBackupDate}`
    : 'Last backup: never';
  card.appendChild(lastBackupLine);

  if (isBackupStale(settings?.lastBackupDate, todayISO())) {
    const nudge = document.createElement('p');
    nudge.className = 'settings-backup-nudge';
    nudge.setAttribute('data-settings-field', 'backup-nudge');
    nudge.textContent = settings?.lastBackupDate
      ? 'Your last backup is more than a week old — export a fresh one.'
      : "You haven't backed up yet — export a backup so you don't lose your data.";
    card.appendChild(nudge);
  }

  const actions = document.createElement('div');
  actions.className = 'settings-backup-actions';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export backup';
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    try {
      const dump = await exportAllData();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `vtaper-backup-${todayISO()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoke right after triggering the download (the click synchronously
      // starts the download), so the blob URL doesn't leak.
      URL.revokeObjectURL(url);

      // Read-merge-write (same pattern as persistCheckedItems above) so this
      // doesn't clobber fields changed elsewhere since `settings` was read.
      const current = await getSetting();
      await putSetting({ ...(current || {}), lastBackupDate: todayISO() });
      await renderSettingsTab(container);
    } finally {
      exportBtn.disabled = false;
    }
  });
  actions.appendChild(exportBtn);

  const importLabel = document.createElement('label');
  importLabel.className = 'settings-import-label';
  importLabel.textContent = 'Import backup';

  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    // Reset immediately so re-selecting the same file still fires 'change'.
    importInput.value = '';
    if (!file) return;

    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      window.alert(`Could not read that backup file: ${err.message}`);
      return;
    }

    const exportedAt = parsed?.exportedAt
      ? new Date(parsed.exportedAt).toLocaleString()
      : 'an unknown date';
    const confirmed = window.confirm(
      `Import backup from ${exportedAt}? This replaces all current data on this device.`
    );
    if (!confirmed) return;

    try {
      await importAllData(parsed);
    } catch (err) {
      window.alert(`Could not import that backup: ${err.message}\n\nYour existing data was not changed.`);
      return;
    }
    location.reload();
  });
  importLabel.appendChild(importInput);
  actions.appendChild(importLabel);

  card.appendChild(actions);

  return card;
}

/**
 * Builds the "Start new block" card (final-review batch C) — only when the
 * 12-week plan is actually complete for the *current* `settings.startDate`
 * (mirrors today.js's own isPlanComplete gating, see js/ui/today.js around
 * line 1623). Returns null (nothing to append) when `startDate` is absent or
 * the plan isn't complete yet, so this never fires mid-block by accident.
 *
 * On confirm: clears the `checkins` store (so the new block's week-4/8/12
 * check-ins don't collide with the old block's stale records — `checkins`
 * is keyed only by `weekNumber`, see js/db.js's clearCheckins()), resets
 * `calorieOverride` to 0, bumps `blockNumber`, and moves `startDate` to
 * today.
 * @param {object|null} settings
 * @param {string} today - todayISO(), read once per render pass by the
 *   caller and threaded through here, rather than called again inside this
 *   function — avoids a theoretical midnight-boundary mismatch between two
 *   separate `todayISO()` calls in the same render.
 * @param {HTMLElement} container - the Settings tab root; re-rendered after
 *   a successful "Start new block" the same way renderBackupCard re-renders
 *   after an export.
 * @returns {HTMLElement|null}
 */
function renderStartNewBlockCard(settings, today, container) {
  if (!settings?.startDate) return null;
  const weekInfo = getWeekInfo(settings.startDate, today);
  if (!weekInfo.isPlanComplete) return null;

  const card = document.createElement('section');
  card.className = 'settings-card';
  card.setAttribute('data-settings-section', 'start-new-block');

  const heading = document.createElement('h2');
  heading.textContent = 'Start new block';
  card.appendChild(heading);

  const intro = document.createElement('p');
  intro.textContent =
    'Your 12-week block is complete. Starting a new block clears the saved ' +
    'week-4/8/12 check-ins (so they don’t collide with the new block’s ' +
    'check-ins) and resets the calorie check-in adjustment to 0. Export a ' +
    'backup above first if you want to keep a record of this block.';
  card.appendChild(intro);

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.textContent = 'Start new block';
  startBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Start a new 12-week block? This clears the 3 saved check-ins (weeks ' +
      '4, 8, 12) and resets your calorie check-in adjustment to 0. Your ' +
      'exercise history and body-metric logs (weight/waist/steps/sleep) are ' +
      'kept.'
    );
    if (!confirmed) return;

    startBtn.disabled = true;
    try {
      await clearCheckins();
      // Read-merge-write (same pattern as persistCheckedItems/renderBackupCard
      // above) so this doesn't clobber fields changed elsewhere since
      // `settings` was read.
      const current = await getSetting();
      await putSetting({
        ...(current || {}),
        startDate: today,
        calorieOverride: 0,
        blockNumber: (current?.blockNumber ?? 1) + 1,
      });
      await renderSettingsTab(container);
    } finally {
      startBtn.disabled = false;
    }
  });
  card.appendChild(startBtn);

  return card;
}

/**
 * Renders the Settings tab into `container`: the profile form (pre-filled
 * from `getSetting()`, saved via `putSetting()` on submit), the Backup card
 * (export/import + last-backup nudge, Task 17), and the weekly grocery
 * checklist (Task 16).
 * @param {HTMLElement} container
 * @returns {Promise<void>}
 */
export async function renderSettingsTab(container) {
  injectStyles();

  const settings = await getSetting();

  container.innerHTML = '';

  const heading = document.createElement('h1');
  heading.textContent = 'Settings';
  container.appendChild(heading);

  const form = buildProfileForm(settings, async () => {
    // Re-render from the freshly-persisted record so the form reflects
    // exactly what was saved (and confirms the write).
    await renderSettingsTab(container);
  });
  container.appendChild(form);

  // --- Backup section -------------------------------------------------------
  container.appendChild(renderBackupCard(settings, container));

  // --- Start new block (final-review batch C) -------------------------------
  // `today` is read once here (not inside renderStartNewBlockCard) so this
  // render pass can't straddle a midnight boundary between two separate
  // todayISO() calls.
  const startNewBlockCard = renderStartNewBlockCard(settings, todayISO(), container);
  if (startNewBlockCard) container.appendChild(startNewBlockCard);

  // --- Supplements (reference, read-only) ----------------------------------
  container.appendChild(renderSupplementsCard());

  // --- Weekly grocery checklist -------------------------------------------
  const groceryChecklist = await resolveChecklist(settings, 'groceryChecklist');
  container.appendChild(renderGroceryChecklist(groceryChecklist));

  // --- Sunday prep checklist -----------------------------------------------
  const sundayPrepChecklist = await resolveChecklist(settings, 'sundayPrepChecklist');
  container.appendChild(renderSundayPrepChecklist(sundayPrepChecklist));
}

/**
 * Whether first-run setup has already been completed, i.e. whether a
 * `settings` record exists at all.
 * @returns {Promise<boolean>}
 */
export async function hasCompletedSetup() {
  return (await getSetting()) !== null;
}

/**
 * If setup hasn't been completed yet, renders the same profile form
 * full-screen inside `appRoot` and blocks (via the returned promise) until
 * the user submits it. Resolves immediately, without rendering anything, if
 * setup was already completed.
 * @param {HTMLElement} appRoot
 * @returns {Promise<void>}
 */
export async function runFirstRunSetupIfNeeded(appRoot) {
  if (await hasCompletedSetup()) return;

  injectStyles();

  await new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-firstrun-overlay';

    const heading = document.createElement('h1');
    heading.textContent = 'Welcome to V-Taper Coach';
    overlay.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'settings-firstrun-intro';
    intro.textContent = 'Set up your profile to get started. You can change these anytime in Settings.';
    overlay.appendChild(intro);

    const form = buildProfileForm(null, () => {
      overlay.remove();
      resolve();
    });
    overlay.appendChild(form);

    appRoot.appendChild(overlay);
  });
}
