import type {
  SchedulingDependency,
  SchedulingTask,
} from '../domain/scheduling-types.js';

// Callers check that the target has no children before converting its own work.
export function requiresWorkPreservation(
  task: Pick<
    SchedulingTask,
    'id' | 'durationDays' | 'inputStart' | 'inputFinish' | 'status'
  >,
  dependencies: readonly Pick<
    SchedulingDependency,
    'predecessorId' | 'successorId'
  >[],
): boolean {
  return (
    task.durationDays !== null ||
    task.inputStart !== null ||
    task.inputFinish !== null ||
    task.status === 'done' ||
    dependencies.some(
      (edge) => edge.predecessorId === task.id || edge.successorId === task.id,
    )
  );
}
