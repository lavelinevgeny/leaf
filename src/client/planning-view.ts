import {
  dateToIndex,
  indexToDate,
  workingDaysInclusive,
} from '../domain/calendar.js';
import { realInterval } from '../domain/planning.js';
import type { CalendarType } from '../domain/scheduling-types.js';
import type { Task, SourceFields, SourcePatch } from '../shared/contracts.js';
export type PlanGestureKind = 'move' | 'resize' | 'resize-start';

// Only validates the display intent; the server computes and stores duration.
export function validateStartResize(
  task: Task,
  calendar: CalendarType,
  target: string,
): void {
  const interval = realInterval(task, calendar);
  if (task.status === 'done' || !interval) throw new RangeError('LOCKED_PLAN');
  if (workingDaysInclusive(target, interval.finishDate, calendar) > 1_000_000)
    throw new RangeError('DURATION_RANGE_EXCEEDED');
}

export function sourceOf(task: Task): SourceFields {
  return {
    inputStart: task.inputStart,
    inputFinish: task.inputFinish,
    durationDays: task.durationDays,
  };
}
export function gesturePatch(
  task: Task,
  calendar: CalendarType,
  kind: 'move' | 'resize',
  target: string,
): { patch: SourcePatch; requiresDurationChoice: boolean } {
  const interval = realInterval(task, calendar);
  if (task.status === 'done' || !interval) throw new RangeError('LOCKED_PLAN');
  if (kind === 'resize') {
    const span = workingDaysInclusive(interval.startDate, target, calendar);
    return {
      patch: { inputFinish: target },
      requiresDurationChoice:
        task.durationDays !== null && task.durationDays !== span,
    };
  }
  workingDaysInclusive(target, target, calendar);
  const shift = dateToIndex(target, interval.startDate, calendar);
  return {
    patch: {
      inputStart: target,
      inputFinish: indexToDate(shift, interval.finishDate, calendar),
    },
    requiresDurationChoice: false,
  };
}
export function newTaskPlan(): import('../shared/contracts.js').SourceFields {
  return { inputStart: null, inputFinish: null, durationDays: 1 };
}
