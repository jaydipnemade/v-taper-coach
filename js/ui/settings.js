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
//     lastBackupAt?: string,   // ISO timestamp — set by Task 16, read here defensively
//   }
//
// Height/weight are always persisted in metric regardless of the `units`
// chosen; the imperial unit is purely a display/input convenience converted
// at the form boundary.

import { getSetting, putSetting } from '../db.js';

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

/**
 * Renders the Settings tab into `container`: the profile form (pre-filled
 * from `getSetting()`, saved via `putSetting()` on submit) plus stub
 * "Backup" / "Last backup" containers that Task 16 fills in.
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

  // --- Backup section (stub; filled in by Task 16) -------------------------
  const backupCard = document.createElement('section');
  backupCard.className = 'settings-card';
  backupCard.setAttribute('data-settings-section', 'backup');

  const backupHeading = document.createElement('h2');
  backupHeading.textContent = 'Backup';
  backupCard.appendChild(backupHeading);

  const lastBackupLine = document.createElement('p');
  lastBackupLine.className = 'settings-last-backup';
  lastBackupLine.setAttribute('data-settings-field', 'last-backup');
  lastBackupLine.textContent = settings?.lastBackupAt
    ? `Last backup: ${new Date(settings.lastBackupAt).toLocaleString()}`
    : 'Last backup: never';
  backupCard.appendChild(lastBackupLine);

  container.appendChild(backupCard);
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
