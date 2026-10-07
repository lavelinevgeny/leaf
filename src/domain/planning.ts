import type { CalendarType } from './scheduling-types.js';
import { DomainError } from './tree.js';
import { isWorkingDay, workingDaysInclusive } from './calendar.js';
import type { SourceFields, SourcePatch } from '../shared/contracts.js';

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

import type {
  SchedulingTask,
  SchedulingDependency,
} from './scheduling-types.js';
export const emptyPlanning = {
  inputStart: null,
  inputFinish: null,
  durationDays: null,
};
export function validateDependency(
  tasks: readonly Pick<SchedulingTask, 'id' | 'parentId'>[],
  dependencies: readonly SchedulingDependency[],
  predecessorId: string,
  successorId: string,
): void {
  const ids = new Set(tasks.map((task) => task.id));
  if (!ids.has(predecessorId) || !ids.has(successorId))
    throw new DomainError(
      'INVALID_DEPENDENCY_ENDPOINT',
      'Обе работы должны принадлежать проекту.',
    );
  if (predecessorId === successorId)
    throw new DomainError(
      'DEPENDENCY_SELF',
      'Работа не может зависеть от самой себя.',
    );
  if (
    tasks.some(
      (task) =>
        task.parentId === predecessorId || task.parentId === successorId,
    )
  )
    throw new DomainError(
      'DEPENDENCY_SUMMARY',
      'Связи разрешены только между конечными работами.',
    );
  if (
    dependencies.some(
      (edge) =>
        edge.predecessorId === predecessorId &&
        edge.successorId === successorId,
    )
  )
    throw new DomainError('DEPENDENCY_DUPLICATE', 'Связь уже существует.');
  const outgoing = new Map<string, string[]>();
  for (const edge of dependencies) {
    const next = outgoing.get(edge.predecessorId) ?? [];
    next.push(edge.successorId);
    outgoing.set(edge.predecessorId, next);
  }
  const previous = new Map<string, string | null>([[successorId, null]]);
  const queue = [successorId];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!;
    if (current === predecessorId) {
      const path = [current];
      let cursor = previous.get(current);
      while (cursor != null) {
        path.push(cursor);
        cursor = previous.get(cursor);
      }
      path.reverse();
      throw new DomainError(
        'DEPENDENCY_CYCLE',
        `Цикл зависимостей: ${[predecessorId, ...path].join(' → ')}`,
      );
    }
    for (const next of outgoing.get(current) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
}
export function validateDependencies(
  tasks: readonly Pick<SchedulingTask, 'id' | 'parentId'>[],
  dependencies: readonly SchedulingDependency[],
): void {
  const accepted: SchedulingDependency[] = [];
  for (const edge of dependencies) {
    validateDependency(tasks, accepted, edge.predecessorId, edge.successorId);
    accepted.push(edge);
  }
}
