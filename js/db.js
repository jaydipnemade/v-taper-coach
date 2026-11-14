// js/db.js
// Single IndexedDB wrapper for V-Taper Coach. Storage access only — no business
// logic. Every other module reads/writes persisted data through these
// functions.

const DB_NAME = 'vtaper-coach-db';
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

// ---------------------------------------------------------------------------
// export / import (backup)
// ---------------------------------------------------------------------------

export async function exportAllData() {
  const db = await openDB();
  const [
    settings,
    sessionLogs,
    exerciseHistory,
    bodyMetrics,
    dietLog,
    customFoods,
    checkins,
  ] = await Promise.all([
    getSetting(),
    getAllFromStore(db, 'sessionLogs'),
    getAllFromStore(db, 'exerciseHistory'),
    getAllFromStore(db, 'bodyMetrics'),
    getAllFromStore(db, 'dietLog'),
    getAllFromStore(db, 'customFoods'),
    getAllFromStore(db, 'checkins'),
  ]);

  return {
    settings,
    sessionLogs,
    exerciseHistory,
    bodyMetrics,
    dietLog,
    customFoods,
    checkins,
    exportedAt: new Date().toISOString(),
  };
}

export async function importAllData(data) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAMES, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

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
  });
}
