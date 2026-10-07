import { dateToIndex, indexToDate, isWorkingDay } from '../domain/calendar.js';
import type { ProjectTree, Task } from '../shared/contracts.js';
import { monthLabels } from './strings.js';
export type Scale = 'days' | 'weeks' | 'months';
export const ROW_HEIGHT = 38;
export const HEADER_HEIGHT = 58;
export function shiftDate(date: string, days: number): string {
  const index = dateToIndex(date, '0001-01-01', 'all-days');
  return indexToDate(
    Math.max(0, Math.min(3652058, index + days)),
    '0001-01-01',
    'all-days',
  );
}
export function todayInZone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
export function windowFor(start: string, scale: Scale) {
  const days = { days: 90, weeks: 180, months: 366 }[scale];
  const dayWidth = { days: 30, weeks: 14, months: 6 }[scale];
  const remaining = dateToIndex('9999-12-31', start, 'all-days') + 1;
  const count = Math.min(days, remaining);
  return { start, days: count, dayWidth, width: count * dayWidth };
}
export type TimelineInterval = {
  start: string;
  finish: string | null;
  kind: 'work' | 'summary' | 'note';
};
export function intervalOf(
  task: Task,
  schedule: ProjectTree['schedule'],
): TimelineInterval | null {
  const summary = schedule.summaries[task.id];
  if (summary)
    return summary.startDate && summary.finishDate
      ? {
          start: summary.startDate,
          finish: summary.finishDate,
          kind: 'summary',
        }
      : null;
  const computed = schedule.tasks[task.id];
  if (task.planMode !== 'unscheduled')
    return computed?.startDate && computed.finishDate
      ? { start: computed.startDate, finish: computed.finishDate, kind: 'work' }
      : null;
  const note = task.inputStart ?? task.inputFinish;
  return note
    ? {
        start: note,
        finish: task.inputStart && task.inputFinish ? task.inputFinish : null,
        kind: 'note',
      }
    : null;
}
export function computedDateLabel(
  task: Task,
  schedule?: ProjectTree['schedule'],
) {
  const interval = schedule ? intervalOf(task, schedule) : null;
  if (interval)
    return interval.finish && interval.finish !== interval.start
      ? `${interval.start} – ${interval.finish}`
      : interval.start;
  return [task.inputStart, task.inputFinish].filter(Boolean).join(' – ');
}
export function compactDateLabel(
  task: Task,
  schedule?: ProjectTree['schedule'],
) {
  const interval = schedule ? intervalOf(task, schedule) : null;
  const start = interval?.start ?? task.inputStart ?? task.inputFinish;
  const finish =
    interval?.finish ??
    (task.inputStart && task.inputFinish ? task.inputFinish : null);
  if (!start) return '';
  const day = (date: string) => Number(date.slice(8));
  const month = (date: string) => monthLabels[Number(date.slice(5, 7)) - 1];
  if (!finish || finish === start) return `${day(start)} ${month(start)}`;
  if (start.slice(0, 7) === finish.slice(0, 7))
    return `${day(start)}–${day(finish)} ${month(finish)}`;
  const year = start.slice(0, 4) !== finish.slice(0, 4);
  return `${day(start)} ${month(start)}${year ? ` ${start.slice(0, 4)}` : ''} – ${day(finish)} ${month(finish)}${year ? ` ${finish.slice(0, 4)}` : ''}`;
}
export function calendarDays(start: string, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = shiftDate(start, index);
    return { date, weekend: !isWorkingDay(date, 'weekdays'), x: index };
  });
}
export const dateX = (date: string, start: string, dayWidth: number) =>
  dateToIndex(date, start, 'all-days') * dayWidth;
