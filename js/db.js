// js/db.js
// Single IndexedDB wrapper for V-Taper Coach. Storage access only — no business
// logic. Every other module reads/writes persisted data through these
// functions.

const DEFAULT_DB_NAME = 'vtaper-coach-db';
const TEST_DB_NAME = 'vtaper-coach-test-db';

/**
 * Picks the IndexedDB database name: the real app database, UNLESS this
 * page is tests.html (detected by pathname) or the page was explicitly
 * opted in via `?testdb=1` — in either case a completely separate database
 * is used instead. This is what keeps the dev-only pure-function/db test
 * suite (tests.html) from ever reading, writing, or clearing a real user's
 * data, even if tests.html ends up deployed alongside the real app at the
 * same origin (see README.md's note on this file being dev-only).
 * @returns {string}
 */
function resolveDbName() {
  try {
    if (typeof location !== 'undefined') {
      const isTestsPage = /\/tests\.html$/.test(location.pathname);
      const hasTestFlag = new URLSearchParams(location.search).get('testdb') === '1';
      if (isTestsPage || hasTestFlag) return TEST_DB_NAME;
    }
  } catch (err) {
    // No `location` (non-browser context) — fall through to the real name.
  }
  return DEFAULT_DB_NAME;
}

const DB_NAME = resolveDbName();
const DB_VERSION = 1;

/**
 * Store name -> keyPath config used in onupgradeneeded.
 * Also doubles as the canonical list of stores for export/import.
 */
const STORE_CONFIG = {
  settings: { keyPath: 'id' },
  sessionLogs: { keyPath: 'id' },
  exerciseHistory: { keyPath: 'exerciseId' },
  bodyMetrics: { keyPath: 'date' },
  dietLog: { keyPath: 'date' },
  customFoods: { keyPath: 'id', autoIncrement: true },
  checkins: { keyPath: 'weekNumber' },
};

const STORE_NAMES = Object.keys(STORE_CONFIG);

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * Wraps an IDBRequest in a promise that resolves with the request's result
 * on success and rejects with the request's error on failure.
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reads every record from a store via getAll().
 * @param {IDBDatabase} db
 * @param {string} storeName
 * @returns {Promise<any[]>}
 */
function getAllFromStore(db, storeName) {
  const tx = db.transaction(storeName, 'readonly');
  return requestToPromise(tx.objectStore(storeName).getAll());
}

/**
 * Opens (or returns the cached open connection to) the app database,
 * creating all object stores on first run.
 * @returns {Promise<IDBDatabase>}
 */
export async function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        for (const [storeName, config] of Object.entries(STORE_CONFIG)) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, config);
          }
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// settings (single record, id: 'app')
// ---------------------------------------------------------------------------

export async function getSetting() {
  const db = await openDB();
  const tx = db.transaction('settings', 'readonly');
  const result = await requestToPromise(tx.objectStore('settings').get('app'));
  return result ?? null;
}

export async function putSetting(settings) {
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  await requestToPromise(tx.objectStore('settings').put({ ...settings, id: 'app' }));
}

// ---------------------------------------------------------------------------
// sessionLogs (keyPath: id, format `${dateISO}_${dayKey}`)
// ---------------------------------------------------------------------------

export async function getSessionLog(id) {
  const db = await openDB();
  const tx = db.transaction('sessionLogs', 'readonly');
  const result = await requestToPromise(tx.objectStore('sessionLogs').get(id));
  return result ?? null;
}

export async function putSessionLog(log) {
  const db = await openDB();
  const tx = db.transaction('sessionLogs', 'readwrite');
  await requestToPromise(tx.objectStore('sessionLogs').put(log));
}

export async function getAllSessionLogs() {
  const db = await openDB();
  return getAllFromStore(db, 'sessionLogs');
}

// ---------------------------------------------------------------------------
// exerciseHistory (keyPath: exerciseId, value { exerciseId, entries: [] })
// ---------------------------------------------------------------------------

export async function getExerciseHistory(exerciseId) {
  const db = await openDB();
  const tx = db.transaction('exerciseHistory', 'readonly');
  const result = await requestToPromise(tx.objectStore('exerciseHistory').get(exerciseId));
  return result ? result.entries : [];
}

export async function appendExercisePerformance(exerciseId, entry) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('exerciseHistory', 'readwrite');
    const store = tx.objectStore('exerciseHistory');
    const getReq = store.get(exerciseId);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const entries = existing ? [...existing.entries, entry] : [entry];
      const putReq = store.put({ exerciseId, entries });
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Replaces the SAME-date entry in an exercise's history with `entry` (or
 * appends it if no entry for that date exists yet, defensively — the
 * expected call path always upserts a date that was already appended
 * once). Used when a trainee edits a logged set after the exercise was
 * already finalized this session, so the stored history is updated IN
 * PLACE and never ends up with two entries for the same date.
 * @param {string} exerciseId
 * @param {object} entry same shape as appendExercisePerformance's `entry`
 */
export async function upsertExercisePerformance(exerciseId, entry) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('exerciseHistory', 'readwrite');
    const store = tx.objectStore('exerciseHistory');
    const getReq = store.get(exerciseId);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      const entries = existing ? [...existing.entries] : [];
      const matchIndex = entries.findIndex((e) => e.date === entry.date);
      if (matchIndex === -1) {
        entries.push(entry);
      } else {
        entries[matchIndex] = entry;
      }
      const putReq = store.put({ exerciseId, entries });
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// bodyMetrics (keyPath: date)
// ---------------------------------------------------------------------------

export async function getBodyMetric(date) {
  const db = await openDB();
  const tx = db.transaction('bodyMetrics', 'readonly');
  const result = await requestToPromise(tx.objectStore('bodyMetrics').get(date));
  return result ?? null;
}

export async function putBodyMetric(metric) {
  const db = await openDB();
  const tx = db.transaction('bodyMetrics', 'readwrite');
  await requestToPromise(tx.objectStore('bodyMetrics').put(metric));
}

export async function getAllBodyMetrics() {
  const db = await openDB();
  return getAllFromStore(db, 'bodyMetrics');
}

// ---------------------------------------------------------------------------
// dietLog (keyPath: date)
// ---------------------------------------------------------------------------

export async function getDietLog(date) {
  const db = await openDB();
  const tx = db.transaction('dietLog', 'readonly');
  const result = await requestToPromise(tx.objectStore('dietLog').get(date));
  return result ?? null;
}

export async function putDietLog(log) {
  const db = await openDB();
  const tx = db.transaction('dietLog', 'readwrite');
  await requestToPromise(tx.objectStore('dietLog').put(log));
}

// ---------------------------------------------------------------------------
// customFoods (keyPath: id, autoIncrement)
// ---------------------------------------------------------------------------

export async function getAllCustomFoods() {
  const db = await openDB();
  return getAllFromStore(db, 'customFoods');
}

export async function addCustomFood(food) {
  const db = await openDB();
  const tx = db.transaction('customFoods', 'readwrite');
  return requestToPromise(tx.objectStore('customFoods').add(food));
}

// ---------------------------------------------------------------------------
// checkins (keyPath: weekNumber)
// ---------------------------------------------------------------------------

export async function getCheckin(weekNumber) {
  const db = await openDB();
  const tx = db.transaction('checkins', 'readonly');
  const result = await requestToPromise(tx.objectStore('checkins').get(weekNumber));
  return result ?? null;
}

export async function putCheckin(checkin) {
  const db = await openDB();
  const tx = db.transaction('checkins', 'readwrite');
  await requestToPromise(tx.objectStore('checkins').put(checkin));
}

/**
 * Clears every record from the `checkins` store only. Used when starting a
 * new 12-week block, so the new block's week-4/8/12 check-ins don't collide
 * with (and get mistaken for) the previous block's check-ins — `checkins` is
 * keyed solely by `weekNumber`, with no block/date dimension, so without
 * this the old block's record would still be returned for the same week
 * number in the new block. Deliberately scoped to this one store, not a
 * generic "clear any store" helper — `exerciseHistory` and `bodyMetrics`
 * must never be cleared by this or any future block-reset action.
 */
export async function clearCheckins() {
  const db = await openDB();
  const tx = db.transaction('checkins', 'readwrite');
  await requestToPromise(tx.objectStore('checkins').clear());
}

// ---------------------------------------------------------------------------
// export / import (backup)
// ---------------------------------------------------------------------------

/**
 * Dumps every store, looping the shared STORE_NAMES constant (the same one
 * importAllData loops) rather than hardcoding the 7 store names here too —
 * so a future 8th store can't be added to STORE_CONFIG/STORE_NAMES and
 * silently dropped from export while still being cleared by import.
 */
export async function exportAllData() {
  const db = await openDB();
  const result = { exportedAt: new Date().toISOString() };
  await Promise.all(
    STORE_NAMES.map(async (storeName) => {
      result[storeName] = storeName === 'settings'
        ? await getSetting()
        : await getAllFromStore(db, storeName);
    }),
  );
  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates a parsed backup object's shape BEFORE importAllData touches any
 * store — a wrong-shaped-but-valid JSON file (e.g. `{}`) must never clear
 * real data. Checks: a plain object, a string `exportedAt`, and each of the
 * 7 store keys either absent or an array (except `settings`, which must be
 * a plain object or absent).
 * @param {any} data
 * @returns {string|null} an error message, or null if the shape is valid.
 */
function validateBackupShape(data) {
  if (!isPlainObject(data)) {
    return 'This file is not a valid backup (expected a JSON object).';
  }
  if (typeof data.exportedAt !== 'string') {
    return "This file doesn't look like a V-Taper Coach backup (missing exportedAt).";
  }
  for (const storeName of STORE_NAMES) {
    const value = data[storeName];
    // A backup taken before any setting was ever saved has settings: null
    // (getSetting() returns null, not undefined, when the record is
    // absent) — treat that the same as an absent field, not invalid.
    if (value === undefined || value === null) continue;
    if (storeName === 'settings') {
      if (!isPlainObject(value)) {
        return "This backup's settings data is invalid.";
      }
    } else if (!Array.isArray(value)) {
      return `This backup's ${storeName} data is invalid (expected a list).`;
    }
  }
  return null;
}

export async function importAllData(data) {
  const validationError = validateBackupShape(data);
  if (validationError) {
    throw new Error(validationError);
  }

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    tx.oncomplete = () => resolve();
    // A request that fails (e.g. store.put() throwing synchronously below,
    // for a record missing its keyPath field) aborts the transaction —
    // onabort is the one place that matters: it means NOTHING in this
    // transaction was committed, so a partial clear-without-full-restore
    // can never happen.
    tx.onabort = () => reject(tx.error ?? new Error('Import failed — no data was changed.'));

    try {
      for (const storeName of STORE_NAMES) {
        const store = tx.objectStore(storeName);
        store.clear();

        if (storeName === 'settings') {
          if (data.settings) store.put({ ...data.settings, id: 'app' });
          continue;
        }

        const records = data[storeName];
        if (Array.isArray(records)) {
          for (const record of records) store.put(record);
        }
      }
    } catch (err) {
      tx.abort();
    }
  });
}
