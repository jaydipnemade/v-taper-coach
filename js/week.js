// Pure week/phase helpers. No DOM, no IndexedDB.
// All date math is done in UTC on 'YYYY-MM-DD' strings so DST never shifts a day.

import { BLOCK_STRUCTURE, DAY_ORDER } from './data/plan.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PLAN_WEEKS = 12;
const PLAN_DAYS = PLAN_WEEKS * 7;
const CHECKIN_WEEKS = [4, 8, 12];

function parseISODateUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(startDateISO, todayISO) {
  return Math.round((parseISODateUTC(todayISO) - parseISODateUTC(startDateISO)) / MS_PER_DAY);
}

// Returns 1-12 for dates inside the plan. Returns null before the start date
// (days < 0) and after week 12 ends (plan complete), never a clamped value.
export function getWeekNumber(startDateISO, todayISO) {
  const week = Math.floor(daysBetween(startDateISO, todayISO) / 7) + 1;
  if (week < 1 || week > PLAN_WEEKS) return null;
  return week;
}

export function getPhaseForWeek(weekNumber) {
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > PLAN_WEEKS) return null;
  return BLOCK_STRUCTURE.find((block) => block.weeks.includes(weekNumber)) ?? null;
}

// JS getDay(): 0=Sunday..6=Saturday. DAY_ORDER starts on Monday.
export function getDayKeyForDate(todayISO) {
  const jsDay = new Date(parseISODateUTC(todayISO)).getUTCDay();
  return DAY_ORDER[(jsDay + 6) % 7];
}

export function isCheckinWeek(weekNumber) {
  return CHECKIN_WEEKS.includes(weekNumber);
}

export function getWeekInfo(startDateISO, todayISO) {
  const weekNumber = getWeekNumber(startDateISO, todayISO);
  return {
    weekNumber,
    dayKey: getDayKeyForDate(todayISO),
    phaseInfo: weekNumber === null ? null : getPhaseForWeek(weekNumber),
    isCheckinWeek: weekNumber !== null && isCheckinWeek(weekNumber),
    // True only after week 12 ends, not before the start date.
    isPlanComplete: daysBetween(startDateISO, todayISO) > PLAN_DAYS - 1,
  };
}
