import { indexToDate, isWorkingDay, nextWorkingDay } from './calendar.js';
import type { SourceFields } from '../shared/contracts.js';
import type { CalendarType, ConditionalDisplay } from './scheduling-types.js';

export function conditionalFinish(
  anchor: string,
  duration: number | null,
  calendar: CalendarType,
): { finishDate: string; clipped: boolean } {
  const count = duration ?? 1;
  if (count === 1) return { finishDate: anchor, clipped: false };
  try {
    const base = nextWorkingDay(anchor, calendar);
    const offset = isWorkingDay(anchor, calendar) ? count - 1 : count - 2;
    return { finishDate: indexToDate(offset, base, calendar), clipped: false };
  } catch (error) {
    if (
      !(error instanceof RangeError) ||
      error.message !== 'CALENDAR_RANGE_EXCEEDED'
    )
      throw error;
    return { finishDate: '9999-12-31', clipped: true };
  }
}

function conditionalStart(
  anchor: string,
  duration: number | null,
  calendar: CalendarType,
) {
  const count = duration ?? 1;
  if (count === 1) return { startDate: anchor, clipped: false };
  try {
    let base = anchor;
    while (!isWorkingDay(base, calendar))
      base = indexToDate(-1, base, 'all-days');
    const offset = isWorkingDay(anchor, calendar) ? count - 1 : count - 2;
    return { startDate: indexToDate(-offset, base, calendar), clipped: false };
  } catch (error) {
    if (
      !(error instanceof RangeError) ||
      error.message !== 'CALENDAR_RANGE_EXCEEDED'
    )
      throw error;
    return { startDate: '0001-01-01', clipped: true };
  }
}

// Presentation only. No clock, writes, FS edges, summary values or CPM inputs.
export function conditionalDisplay(
  source: SourceFields,
  groupStart: string | null,
  today: string | null,
  calendar: CalendarType,
): ConditionalDisplay | null {
  if (source.inputStart !== null && source.inputFinish !== null) return null;
  if (
    source.durationDays !== null &&
    (!Number.isSafeInteger(source.durationDays) || source.durationDays < 1)
  )
    return null;
  try {
    const anchor =
      source.inputStart ?? source.inputFinish ?? groupStart ?? today;
    if (anchor === null) return null;
    isWorkingDay(anchor, calendar); // Validate civil date, including weekend notes.
    if (source.inputStart === null && source.inputFinish !== null)
      return {
        kind: 'conditional',
        finishDate: anchor,
        ...conditionalStart(anchor, source.durationDays, calendar),
      };
    return {
      kind: 'conditional',
      startDate: anchor,
      ...conditionalFinish(anchor, source.durationDays, calendar),
    };
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
