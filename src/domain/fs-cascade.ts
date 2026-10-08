import { dateToIndex, indexToDate, workingDaysInclusive } from './calendar.js';
import { realInterval, validateSourceInput } from './planning.js';
import { DomainError } from './tree.js';
import type {
  CalendarType,
  OptionalInput,
  OptionalTask,
  SchedulingDependency,
} from './scheduling-types.js';

export interface FsCascadeIntent {
  changedSourceTaskIds: readonly string[];
  addedDependencyIds: readonly string[];
  explicitlyEditedTaskId: string | null;
}
export interface FsCascadeResult {
  tasks: OptionalTask[];
  changedTaskIds: string[];
}

const origin = '0001-01-01';
function sourceStart(
  task: OptionalTask | undefined,
  calendar: CalendarType,
): number | null {
  if (!task?.inputStart) return null;
  try {
    return dateToIndex(task.inputStart, origin, calendar);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}
function rawFinish(
  task: OptionalTask | undefined,
  calendar: CalendarType,
): number | null {
  if (!task?.inputFinish) return null;
  try {
    return dateToIndex(task.inputFinish, origin, calendar) + 1;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return null;
  }
}
function finishBoundary(
  task: OptionalTask | undefined,
  calendar: CalendarType,
  unavailable: ReadonlySet<string>,
): number | null {
  if (!task || unavailable.has(task.id)) return null;
  if (
    task.inputStart !== null &&
    task.inputFinish !== null &&
    realInterval(task, calendar) === null
  )
    return null;
  return rawFinish(task, calendar);
}
function maximum(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? Math.max(...known) : null;
}
function fail(code: string, ids: readonly string[], reason: string): never {
  throw new DomainError(code, `${ids.join(' → ')}: ${reason}`);
}
function incomingMap(
  input: OptionalInput,
): Map<string, SchedulingDependency[]> {
  const map = new Map(
    input.tasks.map((task) => [task.id, [] as SchedulingDependency[]]),
  );
  for (const edge of input.dependencies) map.get(edge.successorId)!.push(edge);
  return map;
}

// The caller validates the final DAG first. This pass only changes source dates
// on causally active nodes; analysis/reads never call it.
export function cascadeFs(
  before: OptionalInput,
  candidate: OptionalInput,
  intent: FsCascadeIntent,
): FsCascadeResult {
  const tasks = candidate.tasks.map((task) => ({ ...task }));
  const current = new Map(tasks.map((task) => [task.id, task]));
  const previous = new Map(before.tasks.map((task) => [task.id, task]));
  const oldUnavailable = new Set(before.unavailableTaskIds ?? []);
  const unavailable = new Set(candidate.unavailableTaskIds ?? []);
  const calendar = candidate.calendarType;
  const oldIncoming = incomingMap(before);
  const incoming = incomingMap(candidate);
  const outgoing = new Map(tasks.map((task) => [task.id, [] as string[]]));
  const indegree = new Map(tasks.map((task) => [task.id, 0]));
  for (const edge of candidate.dependencies) {
    outgoing.get(edge.predecessorId)!.push(edge.successorId);
    indegree.set(edge.successorId, indegree.get(edge.successorId)! + 1);
  }
  const order = tasks
    .filter((task) => indegree.get(task.id) === 0)
    .map((task) => task.id);
  for (let i = 0; i < order.length; i++)
    for (const id of outgoing.get(order[i]!)!) {
      const remaining = indegree.get(id)! - 1;
      indegree.set(id, remaining);
      if (remaining === 0) order.push(id);
    }
  if (order.length !== tasks.length)
    fail(
      'DEPENDENCY_CYCLE',
      tasks.map((task) => task.id),
      'Цикл зависимостей.',
    );

  const added = new Set(intent.addedDependencyIds);
  const changedSource = new Set(intent.changedSourceTaskIds);
  const active = new Set(
    candidate.dependencies
      .filter((edge) => added.has(edge.id))
      .map((edge) => edge.successorId),
  );
  for (const id of changedSource)
    if (
      finishBoundary(previous.get(id), before.calendarType, oldUnavailable) !==
      finishBoundary(current.get(id), calendar, unavailable)
    )
      for (const next of outgoing.get(id) ?? []) active.add(next);
  const changed = new Set<string>();

  for (const id of order) {
    const task = current.get(id)!;
    const edges = incoming.get(id)!;
    const oldEdges = oldIncoming.get(id) ?? [];
    const newFinishes = edges.map((edge) =>
      finishBoundary(current.get(edge.predecessorId), calendar, unavailable),
    );
    const oldFinishes = oldEdges.map((edge) =>
      finishBoundary(
        previous.get(edge.predecessorId),
        before.calendarType,
        oldUnavailable,
      ),
    );
    const newBound = maximum(newFinishes);
    const oldBound = maximum(oldFinishes);
    const currentStart = sourceStart(task, calendar);
    const addedIncoming = edges.some((edge) => added.has(edge.id));
    const chain = [
      ...edges
        .filter((edge, i) => newFinishes[i] === newBound)
        .map((edge) => edge.predecessorId),
      id,
    ];
    if (
      changedSource.has(id) &&
      intent.explicitlyEditedTaskId === id &&
      !addedIncoming &&
      currentStart !== null &&
      newBound !== null &&
      currentStart < newBound
    )
      fail(
        'EXPLICIT_PRECEDENCE_CONFLICT',
        chain,
        'Начало работы должно быть после окончания предшественника.',
      );

    if (!active.has(id)) continue;
    if (!addedIncoming && newBound === oldBound) continue;
    if (currentStart === null || newBound === null) continue;
    const oldStart = sourceStart(previous.get(id), before.calendarType);
    const oldEndpoints = new Set(oldEdges.map((edge) => edge.predecessorId));
    const endpointsUnchanged =
      edges.length === oldEndpoints.size &&
      edges.every((edge) => oldEndpoints.has(edge.predecessorId));
    const allOldAndNewFinishesKnown = [...oldFinishes, ...newFinishes].every(
      (finish) => finish !== null,
    );
    const needsLatePush = newBound > currentStart;
    const mayPullEarlier =
      currentStart > newBound &&
      oldStart === oldBound &&
      endpointsUnchanged &&
      allOldAndNewFinishesKnown &&
      intent.explicitlyEditedTaskId !== id;
    if (!needsLatePush && !mayPullEarlier) continue;
    // Provenance is never repaired indirectly. The raw diagnostic pass below
    // rejects only a new/increased conflict, allowing retained old conflicts.
    if (unavailable.has(id)) continue;
    if (task.status === 'done') {
      if (needsLatePush)
        fail(
          'DONE_PLAN_LOCKED',
          chain,
          'Завершённую работу нельзя перенести. Сначала верните её в работу.',
        );
      continue;
    }
    if (
      !needsLatePush &&
      task.inputFinish !== null &&
      realInterval(task, calendar) === null
    )
      continue;
    try {
      validateSourceInput(task, calendar);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      fail(error.code, chain, error.message);
    }
    const oldFinish = finishBoundary(task, calendar, unavailable);
    try {
      const span =
        task.inputFinish === null
          ? null
          : workingDaysInclusive(task.inputStart!, task.inputFinish, calendar);
      task.inputStart = indexToDate(newBound, origin, calendar);
      if (span !== null)
        task.inputFinish = indexToDate(newBound + span - 1, origin, calendar);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      fail(
        'CALENDAR_RANGE_EXCEEDED',
        chain,
        'Перенос выходит за допустимый диапазон дат.',
      );
    }
    changed.add(id);
    if (oldFinish !== finishBoundary(task, calendar, unavailable))
      for (const next of outgoing.get(id)!) active.add(next);
  }

  // Raw endpoints are diagnostic evidence only. Protected/invalid intervals
  // cannot supply bounds, but a newly provable or worsened conflict must reject.
  for (const edge of candidate.dependencies) {
    const pred = current.get(edge.predecessorId)!;
    const succ = current.get(edge.successorId)!;
    const protectedInterval =
      unavailable.has(pred.id) ||
      unavailable.has(succ.id) ||
      (pred.inputStart !== null &&
        pred.inputFinish !== null &&
        realInterval(pred, calendar) === null) ||
      (succ.inputStart !== null &&
        succ.inputFinish !== null &&
        realInterval(succ, calendar) === null);
    if (!protectedInterval) continue;
    const oldPred = previous.get(pred.id),
      oldSucc = previous.get(succ.id);
    if (
      !added.has(edge.id) &&
      pred.inputFinish === oldPred?.inputFinish &&
      succ.inputStart === oldSucc?.inputStart
    )
      continue;
    const f = rawFinish(pred, calendar),
      s = sourceStart(succ, calendar);
    if (f === null || s === null || f <= s) continue;
    const oldEdge = before.dependencies.find(
      (previousEdge) => previousEdge.id === edge.id,
    );
    const oldF = rawFinish(
        oldEdge ? previous.get(oldEdge.predecessorId) : undefined,
        before.calendarType,
      ),
      oldS = sourceStart(
        oldEdge ? previous.get(oldEdge.successorId) : undefined,
        before.calendarType,
      );
    const oldDistance =
      oldEdge && oldF !== null && oldS !== null ? Math.max(0, oldF - oldS) : 0;
    if (f - s > oldDistance)
      fail(
        'EXPLICIT_PRECEDENCE_CONFLICT',
        [pred.id, succ.id],
        'Связь конфликтует с неподтверждёнными или недопустимыми сроками.',
      );
  }
  return { tasks, changedTaskIds: [...changed].sort() };
}
