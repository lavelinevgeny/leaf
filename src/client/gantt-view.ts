import { dateToIndex, indexToDate, isWorkingDay } from '../domain/calendar.js';
import type { ProjectTree, Task } from '../shared/contracts.js';
import { monthLabels } from './strings.js';
import { conditionalDisplay } from '../domain/conditional-display.js';
import type { CalendarType } from '../domain/scheduling-types.js';
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
  finish: string;
  kind: 'work' | 'summary' | 'conditional';
  clipped: boolean;
};
export function ganttInterval(
  task: Task,
  schedule: ProjectTree['schedule'],
  context?: { today: string; calendar: CalendarType },
): TimelineInterval | null {
  const summary = schedule.summaries[task.id];
  if (summary)
    return summary.startDate && summary.finishDate
      ? {
          start: summary.startDate,
          finish: summary.finishDate,
          kind: 'summary',
          clipped: false,
        }
      : null;
  const real = schedule.tasks[task.id];
  if (real?.startDate && real.finishDate)
    return {
      start: real.startDate,
      finish: real.finishDate,
      kind: 'work',
      clipped: false,
    };
  const savedDisplay = schedule.display[task.id];
  const display = context
    ? conditionalDisplay(
        task,
        task.parentId === null ? null : (savedDisplay?.startDate ?? null),
        context.today,
        context.calendar,
      )
    : savedDisplay;
  return display
    ? {
        start: display.startDate,
        finish: display.finishDate,
        kind: 'conditional',
        clipped: display.clipped,
      }
    : null;
}
export type SourceMarker = {
  taskId: string;
  kind: 'source-start' | 'source-finish';
  date: string;
};
export function sourceMarkers(
  task: Task,
  schedule: ProjectTree['schedule'],
): SourceMarker[] {
  if (schedule.summaries[task.id]) return [];
  const real = schedule.tasks[task.id];
  if (real?.startDate && real.finishDate) return [];
  const markers: SourceMarker[] = [];
  if (task.inputStart !== null)
    markers.push({
      taskId: task.id,
      kind: 'source-start',
      date: task.inputStart,
    });
  if (task.inputFinish !== null)
    markers.push({
      taskId: task.id,
      kind: 'source-finish',
      date: task.inputFinish,
    });
  return markers;
}
function realDates(task: Task, schedule?: ProjectTree['schedule']) {
  const summary = schedule?.summaries[task.id];
  if (summary) return [summary.startDate, summary.finishDate];
  const real = schedule?.tasks[task.id];
  if (real?.startDate && real.finishDate)
    return [real.startDate, real.finishDate];
  return [task.inputStart, task.inputFinish];
}
export function realLabel(
  task: Task,
  schedule: ProjectTree['schedule'],
): string {
  return computedDateLabel(task, schedule);
}
export function computedDateLabel(
  task: Task,
  schedule?: ProjectTree['schedule'],
) {
  const [start, finish] = realDates(task, schedule);
  if (start && finish) {
    if (
      schedule &&
      !schedule.summaries[task.id] &&
      !schedule.tasks[task.id]?.startDate
    )
      return `Исходное начало: ${start}; исходное окончание: ${finish}`;
    return start === finish ? start : `${start} – ${finish}`;
  }
  return start ? `Начало: ${start}` : finish ? `Окончание: ${finish}` : '';
}
export function compactDateLabel(
  task: Task,
  schedule?: ProjectTree['schedule'],
) {
  const [sourceStart, sourceFinish] = realDates(task, schedule);
  const start = sourceStart ?? sourceFinish;
  const finish = sourceStart && sourceFinish ? sourceFinish : null;
  if (!start) return '';
  const day = (date: string) => Number(date.slice(8));
  const month = (date: string) => monthLabels[Number(date.slice(5, 7)) - 1];
  if (
    schedule &&
    finish &&
    !schedule.summaries[task.id] &&
    !schedule.tasks[task.id]?.startDate
  )
    return `${day(start)} ${month(start)} / ${day(finish)} ${month(finish)}`;
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
