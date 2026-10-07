import {
  dateToIndex,
  indexToDate,
  isWorkingDay,
  nextWorkingDay,
  workingDaysInclusive,
} from './calendar.js';
import type {
  ScheduleInput,
  ScheduleResult,
  ScheduledTask,
  ScheduleSummary,
  SchedulingDependency,
  SchedulingTask,
} from './scheduling-types.js';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (ids: Iterable<string>): string[] =>
  [...new Set(ids)].sort(compare);
function blankTask(): ScheduledTask {
  return {
    ES: null,
    EF: null,
    LS: null,
    LF: null,
    projectFloat: null,
    constraintFloat: null,
    startDate: null,
    finishDate: null,
    blockedReason: null,
  };
}
function blankSummary(): ScheduleSummary {
  return {
    start: null,
    finish: null,
    startDate: null,
    finishDate: null,
    partial: false,
    containsCritical: false,
  };
}
interface Work {
  duration: number;
  release: number;
  lockedStart: number | null;
}

// Iterative Kosaraju traversal reports the actual cyclic components, excluding
// downstream tasks that a failed topological traversal would also leave behind.
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
      const edges = outgoing.get(frame.id)!;
      const edge = edges[frame.next++];
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

export function calculateSchedule(input: ScheduleInput): ScheduleResult {
  const tasks = [...input.tasks].sort((a, b) => compare(a.id, b.id));
  const dependencies = [...input.dependencies].sort(
    (a, b) =>
      compare(a.id, b.id) ||
      compare(a.predecessorId, b.predecessorId) ||
      compare(a.successorId, b.successorId),
  );
  const result: ScheduleResult = {
    feasibility: 'feasible',
    originDate: null,
    projectFinishIndex: null,
    coverage: { knownLeafCount: 0, totalLeafCount: 0 },
    tasks: {},
    summaries: {},
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
    severity: 'error' | 'incomplete' | 'warning' = 'error',
  ): void => {
    result.diagnostics.push({
      code,
      taskIds: sorted(taskIds),
      dependencyIds: sorted(dependencyIds),
      messageKey: `scheduling.${code}`,
    });
    if (severity === 'error') infeasible = true;
    if (severity === 'incomplete') incomplete = true;
  };
  const taskMap = new Map<string, SchedulingTask>();
  for (const task of tasks) {
    if (taskMap.has(task.id)) diagnostic('DUPLICATE_TASK_ID', [task.id]);
    taskMap.set(task.id, task);
  }
  const children = new Map<string, string[]>();
  for (const id of taskMap.keys()) children.set(id, []);
  for (const task of taskMap.values())
    if (task.parentId !== null) {
      if (!taskMap.has(task.parentId))
        diagnostic('INVALID_PARENT', [task.id, task.parentId]);
      else children.get(task.parentId)!.push(task.id);
    }
  const ids = [...taskMap.keys()];
  const leaves = ids.filter((id) => children.get(id)!.length === 0);
  const leafSet = new Set(leaves);
  result.coverage.totalLeafCount = leaves.length;
  result.tasks = Object.fromEntries(leaves.map((id) => [id, blankTask()]));
  result.summaries = Object.fromEntries(
    ids.filter((id) => !leafSet.has(id)).map((id) => [id, blankSummary()]),
  );

  // Leaf-to-root ordering validates the hierarchy and also drives aggregation.
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

  const finishResult = (): ScheduleResult => {
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
  if (infeasible) {
    for (const scheduled of Object.values(result.tasks))
      scheduled.blockedReason = 'INVALID_GRAPH';
    for (const summary of Object.values(result.summaries))
      summary.partial = true;
    return finishResult();
  }

  try {
    if (input.startDate !== null)
      result.originDate = nextWorkingDay(input.startDate, input.calendarType);
    else isWorkingDay('0001-01-01', input.calendarType);
  } catch {
    diagnostic('INVALID_PROJECT_CALENDAR');
    for (const scheduled of Object.values(result.tasks))
      scheduled.blockedReason = 'INVALID_PROJECT_CALENDAR';
    for (const summary of Object.values(result.summaries))
      summary.partial = true;
    return finishResult();
  }
  const origin = result.originDate;
  const work = new Map<string, Work>();
  const unknown = new Set<string>();
  const missingOrigin = new Set<string>();
  for (const id of leaves) {
    const task = taskMap.get(id)!;
    try {
      if (task.deadline !== null)
        isWorkingDay(task.deadline, input.calendarType);
      if (task.planMode === 'unscheduled') {
        unknown.add(id);
        if (origin === null && task.deadline !== null) {
          missingOrigin.add(id);
          result.tasks[id]!.blockedReason = 'MISSING_PROJECT_START';
        }
        continue;
      }
      const completedDates =
        task.status === 'done' &&
        (task.completedStart !== null || task.completedFinish !== null);
      const completedIndexes =
        task.status === 'done' &&
        (task.completedStartIndex !== null ||
          task.completedFinishIndex !== null);
      const absolute =
        task.planMode === 'fixed' ||
        task.notBefore !== null ||
        task.deadline !== null ||
        completedDates;
      if (origin === null && absolute) {
        missingOrigin.add(id);
        result.tasks[id]!.blockedReason = 'MISSING_PROJECT_START';
        continue;
      }
      let duration: number;
      let lockedStart: number | null = null;
      let release = 0;
      if (task.notBefore !== null)
        release = dateToIndex(
          nextWorkingDay(task.notBefore, input.calendarType),
          origin!,
          input.calendarType,
        );
      if (completedDates || task.planMode === 'fixed') {
        const start = completedDates ? task.completedStart : task.inputStart;
        const finish = completedDates ? task.completedFinish : task.inputFinish;
        if (start === null || finish === null)
          throw new RangeError(
            completedDates
              ? 'INVALID_COMPLETED_INTERVAL'
              : 'INVALID_FIXED_INTERVAL',
          );
        lockedStart = dateToIndex(start, origin!, input.calendarType);
        duration = workingDaysInclusive(start, finish, input.calendarType);
      } else if (completedIndexes) {
        const start = task.completedStartIndex;
        const finish = task.completedFinishIndex;
        if (
          start === null ||
          finish === null ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(finish) ||
          finish <= start
        )
          throw new RangeError('INVALID_COMPLETED_INTERVAL');
        lockedStart = start;
        duration = finish - start;
      } else {
        if (task.status === 'done')
          throw new RangeError('INVALID_COMPLETED_INTERVAL');
        duration = task.durationDays!;
        if (!Number.isSafeInteger(duration) || duration < 1)
          throw new RangeError('INVALID_DURATION');
      }
      if (lockedStart !== null && lockedStart < 0)
        throw new RangeError('FIXED_BEFORE_PROJECT_START');
      if (lockedStart !== null && lockedStart < release)
        diagnostic('FIXED_RELEASE_CONFLICT', [id]);
      work.set(id, { duration, release, lockedStart });
    } catch (error) {
      const code =
        error instanceof RangeError ? error.message : 'INVALID_TASK_SCHEDULE';
      diagnostic(code, [id]);
      result.tasks[id]!.blockedReason = code;
    }
  }
  if (missingOrigin.size)
    diagnostic('MISSING_PROJECT_START', missingOrigin, [], 'incomplete');

  // Unknown work blocks its entire downstream graph. Include incoming context
  // in the diagnostic, so an unknown terminal work is never silently ignored.
  const unknownLinked = [...unknown].filter(
    (id) => incoming.get(id)!.length || outgoing.get(id)!.length,
  );
  const downstream = (roots: Iterable<string>): Set<string> => {
    const reached = new Set(roots);
    const queue = [...reached];
    for (let i = 0; i < queue.length; i++)
      for (const edge of outgoing.get(queue[i]!)!)
        if (!reached.has(edge.successorId)) {
          reached.add(edge.successorId);
          queue.push(edge.successorId);
        }
    return reached;
  };
  const unknownBlocked = downstream(unknownLinked);
  const originBlocked = downstream(missingOrigin);
  const blocked = new Set([...unknownBlocked, ...originBlocked]);
  if (unknownLinked.length) {
    const context = new Set<string>(unknownLinked);
    const contextQueue = [...unknownLinked];
    for (let i = 0; i < contextQueue.length; i++) {
      const id = contextQueue[i]!;
      for (const edge of [...incoming.get(id)!, ...outgoing.get(id)!]) {
        const other =
          edge.predecessorId === id ? edge.successorId : edge.predecessorId;
        if (!context.has(other)) {
          context.add(other);
          contextQueue.push(other);
        }
      }
    }
    const edges = dependencies.filter(
      (edge) =>
        context.has(edge.predecessorId) && context.has(edge.successorId),
    );
    diagnostic(
      'BLOCKED_BY_UNKNOWN',
      context,
      edges.map((edge) => edge.id),
      'incomplete',
    );
  }
  for (const id of originBlocked)
    if (!missingOrigin.has(id))
      result.tasks[id]!.blockedReason = 'BLOCKED_BY_MISSING_PROJECT_START';
  for (const id of unknownBlocked)
    result.tasks[id]!.blockedReason = 'BLOCKED_BY_UNKNOWN';

  const pending = new Map(leaves.map((id) => [id, incoming.get(id)!.length]));
  const order = leaves.filter((id) => pending.get(id) === 0);
  for (let i = 0; i < order.length; i++)
    for (const edge of outgoing.get(order[i]!)!) {
      const count = pending.get(edge.successorId)! - 1;
      pending.set(edge.successorId, count);
      if (count === 0) order.push(edge.successorId);
    }
  for (const id of order) {
    const definition = work.get(id);
    const scheduled = result.tasks[id]!;
    if (!definition || blocked.has(id)) continue;
    let earliest = Math.max(0, definition.release);
    let predecessorMissing = false;
    const conflictingEdges: SchedulingDependency[] = [];
    for (const edge of incoming.get(id)!) {
      const predecessor = result.tasks[edge.predecessorId]!;
      if (predecessor.EF === null) predecessorMissing = true;
      else {
        earliest = Math.max(earliest, predecessor.EF);
        if (
          definition.lockedStart !== null &&
          predecessor.EF > definition.lockedStart
        )
          conflictingEdges.push(edge);
      }
    }
    if (predecessorMissing) {
      scheduled.blockedReason = 'BLOCKED_BY_INVALID_PREDECESSOR';
      continue;
    }
    if (conflictingEdges.length)
      diagnostic(
        'FIXED_PRECEDENCE_CONFLICT',
        [id, ...conflictingEdges.map((edge) => edge.predecessorId)],
        conflictingEdges.map((edge) => edge.id),
      );
    const start = definition.lockedStart ?? earliest;
    const finish = start + definition.duration;
    if (!Number.isSafeInteger(finish)) {
      scheduled.blockedReason = 'CALENDAR_RANGE_EXCEEDED';
      diagnostic('CALENDAR_RANGE_EXCEEDED', [id]);
      continue;
    }
    scheduled.ES = start;
    scheduled.EF = finish;
    if (origin !== null) {
      try {
        scheduled.startDate = indexToDate(start, origin, input.calendarType);
        scheduled.finishDate = indexToDate(
          finish - 1,
          origin,
          input.calendarType,
        );
      } catch {
        scheduled.startDate = null;
        scheduled.finishDate = null;
        scheduled.blockedReason = 'CALENDAR_RANGE_EXCEEDED';
        diagnostic('CALENDAR_RANGE_EXCEEDED', [id]);
      }
    }
    result.coverage.knownLeafCount++;
    result.projectFinishIndex = Math.max(
      result.projectFinishIndex ?? finish,
      finish,
    );
    const deadline = taskMap.get(id)!.deadline;
    if (
      deadline !== null &&
      scheduled.finishDate !== null &&
      scheduled.finishDate > deadline
    )
      diagnostic('DEADLINE_EXCEEDED', [id], [], 'warning');
  }

  const constrainedStarts = new Map<string, number>();
  const finish = result.projectFinishIndex;
  if (finish !== null)
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i]!;
      const scheduled = result.tasks[id]!;
      if (scheduled.ES === null || scheduled.EF === null) continue;
      const definition = work.get(id)!;
      let latestFinish = finish;
      let constrainedFinish = finish;
      for (const edge of outgoing.get(id)!) {
        const successor = result.tasks[edge.successorId]!;
        if (successor.LS !== null)
          latestFinish = Math.min(latestFinish, successor.LS);
        const constrainedStart = constrainedStarts.get(edge.successorId);
        if (constrainedStart !== undefined)
          constrainedFinish = Math.min(constrainedFinish, constrainedStart);
      }
      scheduled.LF = latestFinish;
      scheduled.LS = latestFinish - definition.duration;
      scheduled.projectFloat = scheduled.LS - scheduled.ES;
      const constrainedStart =
        definition.lockedStart ?? constrainedFinish - definition.duration;
      constrainedStarts.set(id, constrainedStart);
      scheduled.constraintFloat = constrainedStart - scheduled.ES;
    }
  if (!infeasible) {
    result.criticalTaskIds = leaves.filter(
      (id) => result.tasks[id]!.projectFloat === 0,
    );
    const critical = new Set(result.criticalTaskIds);
    result.criticalDependencyIds = dependencies
      .filter(
        (edge) =>
          critical.has(edge.predecessorId) &&
          critical.has(edge.successorId) &&
          result.tasks[edge.predecessorId]!.EF ===
            result.tasks[edge.successorId]!.ES,
      )
      .map((edge) => edge.id);
  }
  const critical = new Set(result.criticalTaskIds);
  for (const id of hierarchyOrder) {
    const parentId = taskMap.get(id)!.parentId;
    if (parentId === null) continue;
    const parent = result.summaries[parentId]!;
    const leaf = leafSet.has(id) ? result.tasks[id] : undefined;
    const summary = leafSet.has(id) ? undefined : result.summaries[id];
    const start = leaf ? leaf.ES : summary!.start;
    const finish = leaf ? leaf.EF : summary!.finish;
    const startDate = leaf ? leaf.startDate : summary!.startDate;
    const finishDate = leaf ? leaf.finishDate : summary!.finishDate;
    parent.partial ||= leaf
      ? start === null || leaf.blockedReason !== null
      : summary!.partial;
    parent.containsCritical ||= leaf
      ? critical.has(id)
      : summary!.containsCritical;
    if (start !== null && (parent.start === null || start < parent.start)) {
      parent.start = start;
      parent.startDate = startDate;
    }
    if (finish !== null && (parent.finish === null || finish > parent.finish)) {
      parent.finish = finish;
      parent.finishDate = finishDate;
    }
  }
  return finishResult();
}
