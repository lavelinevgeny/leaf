import type { CalendarType } from './scheduling-types.js';

// Civil-day ordinal 0 is Monday, 0001-01-01 in the proleptic Gregorian calendar.
const LAST_DAY = 3652058;
function leap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function months(year: number): number[] {
  return [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
}
function yearStart(year: number): number {
  const previous = year - 1;
  return (
    previous * 365 +
    Math.floor(previous / 4) -
    Math.floor(previous / 100) +
    Math.floor(previous / 400)
  );
}
function ordinal(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new RangeError('INVALID_CALENDAR_DATE');
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const lengths = months(year);
  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > lengths[month - 1]!
  )
    throw new RangeError('INVALID_CALENDAR_DATE');
  return (
    yearStart(year) +
    lengths.slice(0, month - 1).reduce((sum, length) => sum + length, 0) +
    day -
    1
  );
}
function civilDate(day: number): string {
  if (!Number.isSafeInteger(day) || day < 0 || day > LAST_DAY)
    throw new RangeError('CALENDAR_RANGE_EXCEEDED');
  let low = 1;
  let high = 10000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (yearStart(middle) <= day) low = middle;
    else high = middle;
  }
  let remaining = day - yearStart(low);
  const lengths = months(low);
  let month = 0;
  while (remaining >= lengths[month]!) remaining -= lengths[month++]!;
  return `${String(low).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(remaining + 1).padStart(2, '0')}`;
}
function calendarValid(calendar: CalendarType): void {
  if (calendar !== 'all-days' && calendar !== 'weekdays')
    throw new RangeError('INVALID_CALENDAR_TYPE');
}
function workingOrdinal(date: string, calendar: CalendarType): number {
  calendarValid(calendar);
  const day = ordinal(date);
  if (calendar === 'all-days') return day;
  if (day % 7 >= 5) throw new RangeError('NON_WORKING_DATE');
  return Math.floor(day / 7) * 5 + (day % 7);
}
export function isWorkingDay(
  date: string,
  calendarType: CalendarType,
): boolean {
  calendarValid(calendarType);
  const day = ordinal(date);
  return calendarType === 'all-days' || day % 7 < 5;
}
export function nextWorkingDay(
  date: string,
  calendarType: CalendarType,
): string {
  calendarValid(calendarType);
  const day = ordinal(date);
  return civilDate(
    calendarType === 'weekdays' && day % 7 >= 5 ? day + 7 - (day % 7) : day,
  );
}
export function dateToIndex(
  date: string,
  originDate: string,
  calendarType: CalendarType,
): number {
  return (
    workingOrdinal(date, calendarType) -
    workingOrdinal(originDate, calendarType)
  );
}
export function indexToDate(
  index: number,
  originDate: string,
  calendarType: CalendarType,
): string {
  if (!Number.isSafeInteger(index))
    throw new RangeError('INVALID_WORKING_DAY_INDEX');
  const position = workingOrdinal(originDate, calendarType) + index;
  if (!Number.isSafeInteger(position))
    throw new RangeError('CALENDAR_RANGE_EXCEEDED');
  return civilDate(
    calendarType === 'all-days'
      ? position
      : Math.floor(position / 5) * 7 + (position % 5),
  );
}
export function workingDaysInclusive(
  start: string,
  finish: string,
  calendarType: CalendarType,
): number {
  const difference = dateToIndex(finish, start, calendarType);
  if (difference < 0) throw new RangeError('REVERSED_CALENDAR_INTERVAL');
  return difference + 1;
}
