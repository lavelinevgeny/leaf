import type { CalendarType } from './scheduling-types.js';
import { DomainError } from './tree.js';
import { isWorkingDay, workingDaysInclusive } from './calendar.js';
import type {
  SourceFields,
  SourcePatch,
} from '../shared/optional-contracts.js';

export function validateSourceInput(
  source: SourceFields,
  calendar: CalendarType,
): void {
  if (source.inputStart === null || source.inputFinish === null) return;
  let span: number;
  try {
    if (
      !isWorkingDay(source.inputStart, calendar) ||
      !isWorkingDay(source.inputFinish, calendar)
    )
      throw new RangeError('NON_WORKING_DATE');
    span = workingDaysInclusive(
      source.inputStart,
      source.inputFinish,
      calendar,
    );
  } catch {
    throw new DomainError(
      'INVALID_INTERVAL',
      'Укажите допустимый полный интервал.',
    );
  }
  if (source.durationDays !== null && source.durationDays !== span)
    throw new DomainError(
      'DURATION_MISMATCH',
      'Длительность не совпадает с интервалом. Измените или очистите её.',
    );
}

export function applySourcePatch<T extends SourceFields>(
  task: T,
  patch: SourcePatch,
  calendar: CalendarType,
): T {
  const next = { ...task, ...patch };
  if (
    Object.keys(patch).some(
      (key) =>
        next[key as keyof SourceFields] !== task[key as keyof SourceFields],
    )
  )
    validateSourceInput(next, calendar);
  return next;
}

export function realInterval(
  source: SourceFields,
  calendar: CalendarType,
): { startDate: string; finishDate: string; calendarSpanDays: number } | null {
  if (source.inputStart === null || source.inputFinish === null) return null;
  try {
    validateSourceInput(source, calendar);
    return {
      startDate: source.inputStart,
      finishDate: source.inputFinish,
      calendarSpanDays: workingDaysInclusive(
        source.inputStart,
        source.inputFinish,
        calendar,
      ),
    };
  } catch {
    return null;
  }
}
