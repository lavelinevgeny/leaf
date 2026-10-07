// Frozen pending projection from f5e92abf7d2cb9655cfe11e6173f70ae375df857; server-only migration compatibility.
import type { FrozenPendingScheduleV2 as OptionalResult } from '../shared/contracts.js';
import {
  dateToIndex,
  indexToDate,
  isWorkingDay,
  nextWorkingDay,
  workingDaysInclusive,
} from './legacy-calendar.js';
import { realInterval, validateSourceInput } from './legacy-pending-source.js';
import type {
  ConditionalDisplay,
  LegacyPendingInput,
  OptionalTask,
  RealTask,
} from './legacy-pending-types.js';
import type {
  CalendarType,
  SchedulingDependency,
} from './legacy-pending-types.js';
import { DomainError } from '../domain/tree.js';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (ids: Iterable<string>): string[] =>
  [...new Set(ids)].sort(compare);
const blankReal = (): RealTask => ({
  startDate: null,
  finishDate: null,
  calendarSpanDays: null,
});

// This inactive validator replaces the legacy one at the Task 5 checkpoint.
// Its narrow inputs keep optional tasks independent of legacy planning fields.
export function validateOptionalDependency(
  tasks: readonly Pick<OptionalTask, 'id' | 'parentId'>[],
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
    for (const next of outgoing.get(current) ?? [])
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
  }
}

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

// Iterative Kosaraju traversal identifies actual cycles, excluding downstream
// leaves that would remain after an unsuccessful topological traversal.
function cyclicComponents(
  ids: string[],
  outgoing: Map<string, SchedulingDependency[]>,
  incoming: Map<string, SchedulingDependency[]>,
): string[][] {
  const visited = new Set<string>();
  const finish: string[] = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    const stack = [{ id, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      const edge = outgoing.get(frame.id)![frame.next++];
      if (!edge) {
        finish.push(frame.id);
        stack.pop();
      } else if (!visited.has(edge.successorId)) {
        visited.add(edge.successorId);
        stack.push({ id: edge.successorId, next: 0 });
      }
    }
  }
  visited.clear();
  const components: string[][] = [];
  for (let i = finish.length - 1; i >= 0; i--) {
    const id = finish[i]!;
    if (visited.has(id)) continue;
    const component: string[] = [];
    const stack = [id];
    visited.add(id);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const edge of incoming.get(current)!)
        if (!visited.has(edge.predecessorId)) {
          visited.add(edge.predecessorId);
          stack.push(edge.predecessorId);
        }
    }
    if (component.length > 1) components.push(sorted(component));
  }
  return components.sort((a, b) => compare(a[0]!, b[0]!));
}

interface Aggregate {
  knownLeafCount: number;
  totalLeafCount: number;
  realStartMin: string | null;
  realFinishMax: string | null;
}
const blankAggregate = (): Aggregate => ({
  knownLeafCount: 0,
  totalLeafCount: 0,
  realStartMin: null,
  realFinishMax: null,
});
const minimum = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : compare(a, b) < 0 ? a : b;
const maximum = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : compare(a, b) > 0 ? a : b;

export function projectLegacyPendingSchedule(
  input: LegacyPendingInput,
): OptionalResult {
  const tasks = [...input.tasks].sort((a, b) => compare(a.id, b.id));
  const dependencies = [...input.dependencies].sort(
    (a, b) =>
      compare(a.id, b.id) ||
      compare(a.predecessorId, b.predecessorId) ||
      compare(a.successorId, b.successorId),
  );
  const result: OptionalResult = {
    analysisStatus: 'pending-policy',
    feasibility: 'feasible',
    coverage: { knownLeafCount: 0, totalLeafCount: 0 },
    tasks: {},
    summaries: {},
    display: {},
    criticalTaskIds: [],
    criticalDependencyIds: [],
    diagnostics: [],
  };
  let infeasible = false;
  let incomplete = false;
  const diagnostic = (
    code: string,
    taskIds: Iterable<string> = [],
    dependencyIds: Iterable<string> = [],
    severity: 'error' | 'incomplete' = 'error',
  ): void => {
    result.diagnostics.push({
      code,
      taskIds: sorted(taskIds),
      dependencyIds: sorted(dependencyIds),
      messageKey: `scheduling.${code}`,
    });
    if (severity === 'error') infeasible = true;
    else incomplete = true;
  };
  const finishResult = (): OptionalResult => {
    // Pending feasibility checks source/FS only; Task 7 supplies C16 analysis.
    result.feasibility = infeasible
      ? 'infeasible'
      : incomplete
        ? 'incomplete'
        : 'feasible';
    result.diagnostics.sort(
      (a, b) =>
        compare(a.code, b.code) ||
        compare(JSON.stringify(a.taskIds), JSON.stringify(b.taskIds)) ||
        compare(
          JSON.stringify(a.dependencyIds),
          JSON.stringify(b.dependencyIds),
        ),
    );
    return result;
  };

  const taskMap = new Map<string, OptionalTask>();
  for (const task of tasks) {
    if (taskMap.has(task.id)) {
      diagnostic('DUPLICATE_TASK_ID', [task.id]);
      continue;
    }
    taskMap.set(task.id, task);
  }
  // Duplicate identities make hierarchy and leaf coverage ambiguous; fail
  // before any projection can depend on which duplicate appeared first.
  if (infeasible) return finishResult();
  const ids = [...taskMap.keys()];
  const children = new Map(ids.map((id) => [id, [] as string[]]));
  for (const task of taskMap.values())
    if (task.parentId !== null) {
      if (!taskMap.has(task.parentId))
        diagnostic('INVALID_PARENT', [task.id, task.parentId]);
      else children.get(task.parentId)!.push(task.id);
    }
  const leaves = ids.filter((id) => children.get(id)!.length === 0);
  const leafSet = new Set(leaves);
  result.coverage.totalLeafCount = leaves.length;
  result.tasks = Object.fromEntries(leaves.map((id) => [id, blankReal()]));
  result.summaries = Object.fromEntries(
    ids
      .filter((id) => !leafSet.has(id))
      .map((id) => [
        id,
        { ...blankReal(), knownLeafCount: 0, totalLeafCount: 0 },
      ]),
  );

  // A leaf-to-root queue validates and aggregates arbitrary-depth hierarchies.
  const pendingChildren = new Map(
    ids.map((id) => [id, children.get(id)!.length]),
  );
  const hierarchyOrder = [...leaves];
  for (let i = 0; i < hierarchyOrder.length; i++) {
    const parentId = taskMap.get(hierarchyOrder[i]!)!.parentId;
    if (parentId === null || !pendingChildren.has(parentId)) continue;
    const remaining = pendingChildren.get(parentId)! - 1;
    pendingChildren.set(parentId, remaining);
    if (remaining === 0) hierarchyOrder.push(parentId);
  }
  if (hierarchyOrder.length !== ids.length)
    diagnostic(
      'TREE_CYCLE',
      ids.filter((id) => pendingChildren.get(id)! > 0),
    );

  const outgoing = new Map(
    leaves.map((id) => [id, [] as SchedulingDependency[]]),
  );
  const incoming = new Map(
    leaves.map((id) => [id, [] as SchedulingDependency[]]),
  );
  const dependencyIds = new Set<string>();
  const pairIds = new Map<string, string>();
  for (const edge of dependencies) {
    if (dependencyIds.has(edge.id))
      diagnostic(
        'DUPLICATE_DEPENDENCY_ID',
        [edge.predecessorId, edge.successorId],
        [edge.id],
      );
    dependencyIds.add(edge.id);
    if (!taskMap.has(edge.predecessorId) || !taskMap.has(edge.successorId)) {
      diagnostic(
        'DEPENDENCY_TASK_NOT_FOUND',
        [edge.predecessorId, edge.successorId],
        [edge.id],
      );
      continue;
    }
    if (edge.predecessorId === edge.successorId) {
      diagnostic('SELF_DEPENDENCY', [edge.predecessorId], [edge.id]);
      continue;
    }
    if (!leafSet.has(edge.predecessorId) || !leafSet.has(edge.successorId)) {
      diagnostic(
        'DEPENDENCY_REQUIRES_LEAVES',
        [edge.predecessorId, edge.successorId],
        [edge.id],
      );
      continue;
    }
    const pair = JSON.stringify([edge.predecessorId, edge.successorId]);
    const previous = pairIds.get(pair);
    if (previous !== undefined) {
      diagnostic(
        'DUPLICATE_DEPENDENCY',
        [edge.predecessorId, edge.successorId],
        [previous, edge.id],
      );
      continue;
    }
    pairIds.set(pair, edge.id);
    outgoing.get(edge.predecessorId)!.push(edge);
    incoming.get(edge.successorId)!.push(edge);
  }
  for (const component of cyclicComponents(leaves, outgoing, incoming)) {
    const involved = new Set(component);
    const edges = component.flatMap((id) =>
      outgoing
        .get(id)!
        .filter((edge) => involved.has(edge.successorId))
        .map((edge) => edge.id),
    );
    diagnostic('DEPENDENCY_CYCLE', component, edges);
  }
  if (infeasible) return finishResult();

  try {
    isWorkingDay('0001-01-01', input.calendarType);
  } catch {
    diagnostic('INVALID_PROJECT_CALENDAR');
    return finishResult();
  }

  const unavailable = new Set(input.unavailableTaskIds ?? []);
  for (const id of unavailable)
    if (!taskMap.has(id)) diagnostic('INVALID_UNAVAILABLE_TASK', [id]);
  const unavailableLeaves = leaves.filter((id) => unavailable.has(id));
  if (unavailableLeaves.length)
    diagnostic(
      'LEGACY_INTERVAL_UNAVAILABLE',
      unavailableLeaves,
      [],
      'incomplete',
    );
  const aggregates = new Map(ids.map((id) => [id, blankAggregate()]));
  const knownStartMin = new Map<string, string | null>(
    ids.map((id) => [id, null]),
  );
  const invalidDisplay = new Set<string>();
  for (const id of leaves) {
    const task = taskMap.get(id)!;
    const aggregate = aggregates.get(id)!;
    aggregate.totalLeafCount = 1;
    try {
      // Source minima are independent of real intervals and other source fields.
      // Lone weekend dates remain source notes and valid display anchors.
      if (task.inputStart !== null) {
        isWorkingDay(task.inputStart, input.calendarType);
        knownStartMin.set(id, task.inputStart);
      }
    } catch {
      diagnostic('INVALID_INTERVAL', [id]);
      invalidDisplay.add(id);
      continue;
    }
    if (
      task.durationDays !== null &&
      (!Number.isSafeInteger(task.durationDays) || task.durationDays < 1)
    ) {
      diagnostic('INVALID_DURATION', [id]);
      invalidDisplay.add(id);
      continue;
    }
    try {
      if (task.inputFinish !== null)
        isWorkingDay(task.inputFinish, input.calendarType);
    } catch {
      diagnostic('INVALID_INTERVAL', [id]);
      invalidDisplay.add(id);
      continue;
    }
    const real = realInterval(task, input.calendarType);
    if (real !== null && !unavailable.has(id)) {
      result.tasks[id] = real;
      aggregate.realStartMin = real.startDate;
      aggregate.realFinishMax = real.finishDate;
      aggregate.knownLeafCount = 1;
      result.coverage.knownLeafCount++;
    } else if (task.inputStart !== null && task.inputFinish !== null) {
      try {
        validateSourceInput(task, input.calendarType);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        diagnostic(error.code, [id]);
      }
    }
  }

  for (const id of hierarchyOrder) {
    const aggregate = aggregates.get(id)!;
    if (!leafSet.has(id)) {
      const summary = result.summaries[id]!;
      summary.knownLeafCount = aggregate.knownLeafCount;
      summary.totalLeafCount = aggregate.totalLeafCount;
      if (
        aggregate.knownLeafCount === aggregate.totalLeafCount &&
        aggregate.realStartMin !== null &&
        aggregate.realFinishMax !== null
      ) {
        summary.startDate = aggregate.realStartMin;
        summary.finishDate = aggregate.realFinishMax;
        summary.calendarSpanDays = workingDaysInclusive(
          summary.startDate,
          summary.finishDate,
          input.calendarType,
        );
      }
    }
    const parentId = taskMap.get(id)!.parentId;
    if (parentId === null) continue;
    const parent = aggregates.get(parentId)!;
    parent.knownLeafCount += aggregate.knownLeafCount;
    parent.totalLeafCount += aggregate.totalLeafCount;
    parent.realStartMin = minimum(parent.realStartMin, aggregate.realStartMin);
    parent.realFinishMax = maximum(
      parent.realFinishMax,
      aggregate.realFinishMax,
    );
    knownStartMin.set(
      parentId,
      minimum(knownStartMin.get(parentId)!, knownStartMin.get(id)!),
    );
  }

  const displays = new Map<string, ConditionalDisplay>();
  for (const id of leaves) {
    const task = taskMap.get(id)!;
    if (
      task.inputStart !== null ||
      task.parentId === null ||
      invalidDisplay.has(id)
    )
      continue;
    const anchor = knownStartMin.get(task.parentId)!;
    if (anchor === null) continue;
    displays.set(id, {
      kind: 'conditional',
      startDate: anchor,
      ...conditionalFinish(anchor, task.durationDays, input.calendarType),
    });
  }
  result.display = Object.fromEntries(displays);

  for (const edge of dependencies) {
    const predecessor = taskMap.get(edge.predecessorId)!;
    const successor = taskMap.get(edge.successorId)!;
    const taskIds = [predecessor.id, successor.id];
    if (predecessor.inputFinish === null || successor.inputStart === null) {
      diagnostic('UNKNOWN_PRECEDENCE', taskIds, [edge.id], 'incomplete');
      continue;
    }
    try {
      if (
        !isWorkingDay(predecessor.inputFinish, input.calendarType) ||
        !isWorkingDay(successor.inputStart, input.calendarType)
      ) {
        diagnostic('NON_WORKING_DATE', taskIds, [edge.id]);
        continue;
      }
      // The technical origin is never a project input or a display anchor.
      const finishExclusive =
        dateToIndex(predecessor.inputFinish, '0001-01-01', input.calendarType) +
        1;
      const successorStart = dateToIndex(
        successor.inputStart,
        '0001-01-01',
        input.calendarType,
      );
      if (successorStart < finishExclusive)
        diagnostic('EXPLICIT_PRECEDENCE_CONFLICT', taskIds, [edge.id]);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      diagnostic('INVALID_INTERVAL', taskIds, [edge.id]);
    }
  }
  return finishResult();
}
