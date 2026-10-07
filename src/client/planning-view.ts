import {
  indexToDate,
  nextWorkingDay,
  workingDaysInclusive,
} from '../domain/calendar.js';
import type {
  Project,
  ProjectTree,
  Task,
  TaskPlan,
} from '../shared/contracts.js';
export function planOf(task: Task): TaskPlan {
  const deadline = task.deadline;
  if (task.planMode === 'auto')
    return {
      mode: 'auto',
      durationDays: task.durationDays ?? 0,
      notBefore: task.notBefore,
      deadline,
    };
  if (task.planMode === 'fixed')
    return {
      mode: 'fixed',
      inputStart: task.inputStart ?? '',
      inputFinish: task.inputFinish ?? '',
      deadline,
    };
  return {
    mode: 'unscheduled',
    inputStart: task.inputStart,
    inputFinish: task.inputFinish,
    deadline,
  };
}
export function durationForFinish(
  start: string,
  finish: string,
  calendar: Project['calendarType'],
): number {
  return workingDaysInclusive(start, finish, calendar);
}
export function planForGesture(
  task: Task,
  computed: ProjectTree['schedule']['tasks'][string] | undefined,
  project: Project,
  kind: 'move' | 'resize',
  target: string,
): TaskPlan {
  if (
    task.status === 'done' ||
    task.planMode === 'unscheduled' ||
    !computed?.startDate ||
    !computed.finishDate ||
    computed.blockedReason
  )
    throw new RangeError('LOCKED_PLAN');
  const deadline = task.deadline;
  if (task.planMode === 'auto') {
    if (kind === 'move')
      return {
        mode: 'auto',
        durationDays: task.durationDays!,
        notBefore: nextWorkingDay(target, project.calendarType),
        deadline,
      };
    return {
      mode: 'auto',
      durationDays: durationForFinish(
        computed.startDate,
        nextWorkingDay(target, project.calendarType),
        project.calendarType,
      ),
      notBefore: task.notBefore,
      deadline,
    };
  }
  if (kind === 'resize') {
    durationForFinish(computed.startDate, target, project.calendarType);
    return {
      mode: 'fixed',
      inputStart: computed.startDate,
      inputFinish: target,
      deadline,
    };
  }
  // Fixed boundaries are validated rather than silently normalized.
  durationForFinish(target, target, project.calendarType);
  return {
    mode: 'fixed',
    inputStart: target,
    inputFinish: indexToDate(
      task.durationDays! - 1,
      target,
      project.calendarType,
    ),
    deadline,
  };
}
