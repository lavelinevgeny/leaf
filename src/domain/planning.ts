import type {
  CalendarType,
  ScheduledTask,
  SchedulingTask,
  SchedulingDependency,
} from './scheduling-types.js';
import type { TaskPlan } from '../shared/contracts.js';
import { workingDaysInclusive } from './calendar.js';
import { DomainError } from './tree.js';

export const emptyPlanning = {
  planMode: 'unscheduled' as const,
  durationDays: null,
  inputStart: null,
  inputFinish: null,
  notBefore: null,
  deadline: null,
  completedStart: null,
  completedFinish: null,
  completedStartIndex: null,
  completedFinishIndex: null,
};
export function applyTaskPlan<T extends SchedulingTask>(
  task: T,
  plan: TaskPlan,
  calendarType: CalendarType,
): T {
  if (task.status === 'done')
    throw new DomainError(
      'DONE_PLANNING',
      'Верните завершённую задачу в работу перед планированием.',
    );
  const result: T = {
    ...task,
    ...emptyPlanning,
    deadline: plan.deadline === undefined ? task.deadline : plan.deadline,
  };
  if (plan.mode === 'unscheduled') {
    result.inputStart = plan.inputStart ?? null;
    result.inputFinish = plan.inputFinish ?? null;
  } else if (plan.mode === 'auto') {
    result.planMode = 'auto';
    result.durationDays = plan.durationDays;
    result.notBefore =
      plan.notBefore === undefined
        ? task.planMode === 'auto'
          ? task.notBefore
          : null
        : plan.notBefore;
  } else {
    result.planMode = 'fixed';
    result.inputStart = plan.inputStart;
    result.inputFinish = plan.inputFinish;
    try {
      result.durationDays = workingDaysInclusive(
        plan.inputStart,
        plan.inputFinish,
        calendarType,
      );
    } catch {
      throw new DomainError(
        'INVALID_FIXED_INTERVAL',
        'Закреплённый интервал должен иметь рабочие границы и допустимую длительность.',
      );
    }
  }
  return result;
}
export function completedInterval(
  task: SchedulingTask,
  computed: ScheduledTask | undefined,
): Pick<
  SchedulingTask,
  | 'completedStart'
  | 'completedFinish'
  | 'completedStartIndex'
  | 'completedFinishIndex'
> {
  if (task.planMode === 'unscheduled')
    return {
      completedStart: null,
      completedFinish: null,
      completedStartIndex: null,
      completedFinishIndex: null,
    };
  if (
    !computed ||
    computed.ES === null ||
    computed.EF === null ||
    computed.blockedReason !== null ||
    computed.EF <= computed.ES
  )
    throw new DomainError(
      'INCOMPLETE_COMPLETION',
      'Нельзя завершить запланированную работу без рассчитанного интервала.',
    );
  return computed.startDate !== null && computed.finishDate !== null
    ? {
        completedStart: computed.startDate,
        completedFinish: computed.finishDate,
        completedStartIndex: null,
        completedFinishIndex: null,
      }
    : {
        completedStart: null,
        completedFinish: null,
        completedStartIndex: computed.ES,
        completedFinishIndex: computed.EF,
      };
}
export function fixedDuration(
  task: SchedulingTask,
  calendarType: CalendarType,
): number | null {
  if (
    task.planMode !== 'fixed' ||
    task.inputStart === null ||
    task.inputFinish === null
  )
    return task.durationDays;
  try {
    const duration = workingDaysInclusive(
      task.inputStart,
      task.inputFinish,
      calendarType,
    );
    return duration;
  } catch {
    return task.durationDays;
  }
}
export function validateDependency(
  tasks: readonly SchedulingTask[],
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
  tasks: readonly SchedulingTask[],
  dependencies: readonly SchedulingDependency[],
): void {
  const accepted: SchedulingDependency[] = [];
  for (const edge of dependencies) {
    validateDependency(tasks, accepted, edge.predecessorId, edge.successorId);
    accepted.push(edge);
  }
}
