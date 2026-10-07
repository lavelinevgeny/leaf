import { describe, expect, it } from 'vitest';
import fixtures from '../fixtures/scheduling/calendar-cases.json';
import {
  dateToIndex,
  indexToDate,
  isWorkingDay,
  nextWorkingDay,
  workingDaysInclusive,
} from '../src/domain/calendar.js';
import type { CalendarType } from '../src/domain/scheduling-types.js';

describe('pure calendar', () => {
  for (const fixture of fixtures.cases)
    it(fixture.id, () => {
      const calendar = fixture.calendar as CalendarType;
      expect(indexToDate(fixture.duration - 1, fixture.start, calendar)).toBe(
        fixture.finishInclusive,
      );
      expect(indexToDate(fixture.duration, fixture.start, calendar)).toBe(
        fixture.nextFSStart,
      );
      expect(
        workingDaysInclusive(fixture.start, fixture.finishInclusive, calendar),
      ).toBe(fixture.duration);
    });
  it('counts same days and normalizes only automatic weekend dates', () => {
    expect(workingDaysInclusive('2026-10-09', '2026-10-09', 'weekdays')).toBe(
      1,
    );
    expect(nextWorkingDay('2026-10-10', 'weekdays')).toBe('2026-10-12');
    expect(nextWorkingDay('2026-10-09', 'weekdays')).toBe('2026-10-09');
    expect(isWorkingDay('2026-10-11', 'weekdays')).toBe(false);
    expect(isWorkingDay('2026-10-11', 'all-days')).toBe(true);
    expect(() => dateToIndex('2026-10-10', '2026-10-09', 'weekdays')).toThrow();
    expect(() => indexToDate(0, '2026-10-10', 'weekdays')).toThrow();
    expect(() =>
      workingDaysInclusive('2026-10-09', '2026-10-10', 'weekdays'),
    ).toThrow();
  });
  it('uses civil dates across leap, month, year and DST boundaries', () => {
    expect(indexToDate(1, '2024-02-28', 'all-days')).toBe('2024-02-29');
    expect(indexToDate(1, '2026-04-30', 'all-days')).toBe('2026-05-01');
    expect(indexToDate(1, '2026-12-31', 'all-days')).toBe('2027-01-01');
    expect(workingDaysInclusive('2026-03-27', '2026-03-30', 'weekdays')).toBe(
      2,
    );
    expect(workingDaysInclusive('2026-10-23', '2026-10-26', 'all-days')).toBe(
      4,
    );
    expect(indexToDate(-1, '2026-10-12', 'weekdays')).toBe('2026-10-09');
  });
  it('supports explicit civil-year limits and rejects overflow', () => {
    expect(indexToDate(0, '0001-01-01', 'all-days')).toBe('0001-01-01');
    expect(indexToDate(0, '9999-12-31', 'all-days')).toBe('9999-12-31');
    expect(dateToIndex('9999-12-31', '0001-01-01', 'all-days')).toBe(3652058);
    expect(() => indexToDate(-1, '0001-01-01', 'all-days')).toThrow();
    expect(() => indexToDate(1, '9999-12-31', 'all-days')).toThrow();
    expect(() => indexToDate(1, '9999-12-31', 'weekdays')).toThrow();
    for (const date of [
      '0000-01-01',
      '10000-01-01',
      '2026-02-29',
      '1900-02-29',
      '2026-1-01',
    ])
      expect(() => isWorkingDay(date, 'all-days')).toThrow();
    for (const index of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      expect(() => indexToDate(index, '2026-10-07', 'all-days')).toThrow();
    expect(() =>
      workingDaysInclusive('2026-10-08', '2026-10-07', 'all-days'),
    ).toThrow();
  });
  it('round trips both directions, including negative working-day indexes', () => {
    for (const calendar of ['all-days', 'weekdays'] as const)
      for (let i = -900; i <= 900; i += 7) {
        const date = indexToDate(i, '2026-10-07', calendar);
        expect(dateToIndex(date, '2026-10-07', calendar)).toBe(i);
      }
    expect(dateToIndex('0001-01-01', '9999-12-31', 'weekdays')).toBe(-2608614);
  });
});
