import type { SourceFields } from '../shared/contracts.js';
import type {
  OptionalInput,
  WorkingInterval,
  CpmGraph,
  CpmVertex,
  BackwardAnalysis,
  BackwardValue,
  ExplicitProjection,
  LiveResult,
  CalendarType,
} from './scheduling-types.js';
import { realInterval, validateSourceInput } from './planning.js';
import { dateToIndex, indexToDate } from './calendar.js';
import { DomainError } from './tree.js';
export function toWorkingInterval(
  task: SourceFields,
  calendar: CalendarType,
  originDate = '0001-01-01',
): WorkingInterval | null {
  const real = realInterval(task, calendar);
  if (real === null) return null;
  const s = dateToIndex(real.startDate, originDate, calendar);
  const f = dateToIndex(real.finishDate, originDate, calendar) + 1;
  return { s, f, d: f - s };
}

export function buildCpmGraph(
  input: OptionalInput,
  originDate = '0001-01-01',
): CpmGraph {
  const unavailable = new Set(input.unavailableTaskIds ?? []);
  const parents = new Set(
    input.tasks.flatMap((t) => (t.parentId === null ? [] : [t.parentId])),
  );
  const leaves = input.tasks
    .filter((t) => !parents.has(t.id))
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const leafIds = leaves.map((t) => t.id);
  const vertices = new Map<string, CpmVertex>();
  for (const t of leaves) {
    if (unavailable.has(t.id)) continue;
    const w = toWorkingInterval(t, input.calendarType, originDate);
    if (w) vertices.set(t.id, { id: t.id, status: t.status, ...w });
  }
  const dependencies = [...input.dependencies].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const outgoing = new Map(leafIds.map((id) => [id, [] as string[]]));
  const neighbors = new Map(leafIds.map((id) => [id, [] as string[]]));
  const indegree = new Map(leafIds.map((id) => [id, 0]));
  for (const e of dependencies) {
    if (!outgoing.has(e.predecessorId) || !outgoing.has(e.successorId))
      throw new RangeError('INVALID_ANALYSIS_GRAPH');
    outgoing.get(e.predecessorId)!.push(e.successorId);
    neighbors.get(e.predecessorId)!.push(e.successorId);
    neighbors.get(e.successorId)!.push(e.predecessorId);
    indegree.set(e.successorId, indegree.get(e.successorId)! + 1);
  }
  const topoIds = leafIds.filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < topoIds.length; i++) {
    for (const next of outgoing.get(topoIds[i]!)!) {
      const n = indegree.get(next)! - 1;
      indegree.set(next, n);
      if (n === 0) topoIds.push(next);
    }
  }
  if (topoIds.length !== leafIds.length)
    throw new RangeError('INVALID_ANALYSIS_GRAPH');
  const visited = new Set<string>(),
    weakComponents: string[][] = [];
  for (const id of leafIds) {
    if (visited.has(id)) continue;
    const queue = [id];
    visited.add(id);
    for (let i = 0; i < queue.length; i++)
      for (const next of neighbors.get(queue[i]!)!)
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
    weakComponents.push(queue.sort());
  }
  return {
    vertices,
    leafIds,
    dependencies,
    topoIds,
    weakComponents,
    originDate,
    calendarType: input.calendarType,
  };
}
export function analyzeDatedGraph(
  graph: CpmGraph,
  analyzedIds: ReadonlySet<string>,
  horizon: number | null,
): BackwardAnalysis {
  const values = new Map<string, BackwardValue>();
  if (horizon === null) {
    if (analyzedIds.size) throw new RangeError('INVALID_ANALYSIS_COMPONENT');
    return { horizon, values, criticalTaskIds: [], criticalDependencyIds: [] };
  }
  if (!Number.isSafeInteger(horizon))
    throw new RangeError('INVALID_ANALYSIS_HORIZON');
  for (const id of analyzedIds)
    if (!graph.vertices.has(id))
      throw new RangeError('INVALID_ANALYSIS_COMPONENT');
  const outgoing = new Map([...analyzedIds].map((id) => [id, [] as string[]]));
  for (const e of graph.dependencies) {
    const p = analyzedIds.has(e.predecessorId),
      s = analyzedIds.has(e.successorId);
    if (p !== s) throw new RangeError('INVALID_ANALYSIS_COMPONENT');
    if (p) outgoing.get(e.predecessorId)!.push(e.successorId);
  }
  for (let i = graph.topoIds.length - 1; i >= 0; i--) {
    const id = graph.topoIds[i]!;
    if (!analyzedIds.has(id)) continue;
    const v = graph.vertices.get(id)!,
      successors = outgoing.get(id)!;
    let LF = horizon,
      constraintFloat = horizon - v.f;
    for (const next of successors) {
      const later = values.get(next);
      if (!later) throw new RangeError('INVALID_ANALYSIS_GRAPH');
      LF = Math.min(LF, later.LS);
      constraintFloat = Math.min(
        constraintFloat,
        graph.vertices.get(next)!.s - v.f,
      );
    }
    const LS = LF - v.d,
      projectFloat = LS - v.s;
    if (v.status === 'done') constraintFloat = 0;
    if (
      projectFloat < 0 ||
      constraintFloat < 0 ||
      constraintFloat > projectFloat
    )
      throw new RangeError('INVALID_ANALYSIS_FLOAT');
    values.set(id, { LS, LF, projectFloat, constraintFloat });
  }
  const criticalTaskIds = [...values]
    .filter(([, v]) => v.projectFloat === 0)
    .map(([id]) => id)
    .sort();
  const criticalDependencyIds = graph.dependencies
    .filter(
      (e) =>
        values.get(e.predecessorId)?.projectFloat === 0 &&
        values.get(e.successorId)?.projectFloat === 0 &&
        graph.vertices.get(e.predecessorId)!.f ===
          graph.vertices.get(e.successorId)!.s,
    )
    .map((e) => e.id)
    .sort();
  return { horizon, values, criticalTaskIds, criticalDependencyIds };
}

const graphErrors = new Set([
  'DUPLICATE_TASK_ID',
  'INVALID_PARENT',
  'TREE_CYCLE',
  'DUPLICATE_DEPENDENCY_ID',
  'DEPENDENCY_TASK_NOT_FOUND',
  'SELF_DEPENDENCY',
  'DEPENDENCY_REQUIRES_LEAVES',
  'DUPLICATE_DEPENDENCY',
  'DEPENDENCY_CYCLE',
  'INVALID_PROJECT_CALENDAR',
  'INVALID_UNAVAILABLE_TASK',
]);
function criticalSummaryIds(
  input: OptionalInput,
  criticalIds: readonly string[],
): string[] {
  const map = new Map(input.tasks.map((t) => [t.id, t]));
  const counts = new Map(input.tasks.map((t) => [t.id, 0]));
  for (const t of input.tasks)
    if (t.parentId !== null && counts.has(t.parentId))
      counts.set(t.parentId, counts.get(t.parentId)! + 1);
  const isSummary = new Set(
    [...counts].filter(([, n]) => n > 0).map(([id]) => id),
  );
  const flagged = new Set(criticalIds);
  const queue = [...counts].filter(([, n]) => n === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!,
      parent = map.get(id)!.parentId;
    if (parent === null || !counts.has(parent)) continue;
    if (flagged.has(id)) flagged.add(parent);
    const n = counts.get(parent)! - 1;
    counts.set(parent, n);
    if (n === 0) queue.push(parent);
  }
  return [...isSummary].filter((id) => flagged.has(id)).sort();
}
export function analyzeExplicitDates(
  input: OptionalInput,
  projection: ExplicitProjection,
  originDate = '0001-01-01',
): LiveResult {
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const unavailable = new Set(input.unavailableTaskIds ?? []);
  const diagnostics = projection.diagnostics.map((d) => ({
    ...d,
    taskIds: [...d.taskIds].sort(),
    dependencyIds: [...d.dependencyIds].sort(),
  }));
  const diagnosticKeys = new Set(
    diagnostics.map((d) =>
      JSON.stringify([d.code, d.taskIds, d.dependencyIds]),
    ),
  );
  const sourceErrorIds = new Set(
    diagnostics
      .filter(
        (d) =>
          [
            'INVALID_INTERVAL',
            'DURATION_MISMATCH',
            'INVALID_DURATION',
          ].includes(d.code) &&
          d.taskIds.length === 1 &&
          d.dependencyIds.length === 0,
      )
      .map((d) => d.taskIds[0]!),
  );
  const add = (code: string, id: string) => {
    const key = JSON.stringify([code, [id], []]);
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push({
      code,
      taskIds: [id],
      dependencyIds: [],
      messageKey: 'scheduling.' + code,
    });
  };
  const unavailableLeaves = Object.keys(projection.tasks)
    .filter((id) => unavailable.has(id))
    .sort();
  if (
    unavailableLeaves.length &&
    !diagnostics.some((d) => graphErrors.has(d.code))
  ) {
    const key = JSON.stringify([
      'LEGACY_INTERVAL_UNAVAILABLE',
      unavailableLeaves,
      [],
    ]);
    if (!diagnosticKeys.has(key)) {
      diagnosticKeys.add(key);
      diagnostics.push({
        code: 'LEGACY_INTERVAL_UNAVAILABLE',
        taskIds: unavailableLeaves,
        dependencyIds: [],
        messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
      });
    }
  }
  if (!diagnostics.some((d) => graphErrors.has(d.code)))
    for (const id of Object.keys(projection.tasks).sort()) {
      if (unavailable.has(id) || sourceErrorIds.has(id)) continue;
      const t = taskById.get(id)!;
      if (realInterval(t, input.calendarType) !== null) continue;
      if (t.inputStart === null || t.inputFinish === null) {
        add('UNKNOWN_INTERVAL', id);
      } else {
        try {
          validateSourceInput(t, input.calendarType);
        } catch (error) {
          add(
            error instanceof DomainError && error.code === 'DURATION_MISMATCH'
              ? 'DURATION_MISMATCH'
              : 'INVALID_INTERVAL',
            id,
          );
        }
      }
    }
  diagnostics.sort((a, b) =>
    a.code < b.code
      ? -1
      : a.code > b.code
        ? 1
        : JSON.stringify(a.taskIds) < JSON.stringify(b.taskIds)
          ? -1
          : JSON.stringify(a.taskIds) > JSON.stringify(b.taskIds)
            ? 1
            : JSON.stringify(a.dependencyIds) < JSON.stringify(b.dependencyIds)
              ? -1
              : JSON.stringify(a.dependencyIds) >
                  JSON.stringify(b.dependencyIds)
                ? 1
                : 0,
  );
  const tasks = Object.fromEntries(
    Object.entries(projection.tasks).map(([id, t]) => [
      id,
      { ...t, projectFloat: null, constraintFloat: null },
    ]),
  );
  const summaries = Object.fromEntries(
    Object.entries(projection.summaries).map(([id, s]) => [
      id,
      { ...s, containsCritical: null },
    ]),
  );
  const common = {
    coverage: projection.coverage,
    display: projection.display,
    diagnostics,
  };
  if (
    diagnostics.some(
      (d) =>
        graphErrors.has(d.code) || d.code === 'EXPLICIT_PRECEDENCE_CONFLICT',
    )
  )
    return {
      ...common,
      analysisStatus: 'infeasible',
      feasibility: 'infeasible',
      tasks,
      summaries,
      horizonFinishDate: null,
      partialAnalysis: null,
      criticalTaskIds: [],
      criticalDependencyIds: [],
    };
  const graph = buildCpmGraph(input, originDate);
  let H: number | null = null;
  for (const v of graph.vertices.values())
    H = H === null ? v.f : Math.max(H, v.f);
  const complete = graph.vertices.size === graph.leafIds.length;
  if (!complete) {
    const analyzedIds = new Set(
      graph.weakComponents
        .filter((component) => component.every((id) => graph.vertices.has(id)))
        .flat(),
    );
    const a = analyzeDatedGraph(graph, analyzedIds, H);
    return {
      ...common,
      analysisStatus: 'incomplete',
      feasibility: 'incomplete',
      tasks,
      summaries,
      horizonFinishDate: null,
      criticalTaskIds: [],
      criticalDependencyIds: [],
      partialAnalysis:
        H === null
          ? null
          : {
              labelKey: 'scheduling.PARTIAL_ANALYSIS',
              knownHorizonFinishDate: indexToDate(
                H - 1,
                originDate,
                input.calendarType,
              ),
              coverage: {
                analyzedLeafCount: analyzedIds.size,
                blockedLeafCount: graph.leafIds.length - analyzedIds.size,
              },
              tasks: Object.fromEntries(
                [...a.values]
                  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                  .map(([id, v]) => [
                    id,
                    { knownHorizonFloat: v.projectFloat },
                  ]),
              ),
              partialCriticalTaskIds: a.criticalTaskIds,
              partialCriticalDependencyIds: a.criticalDependencyIds,
              partialCriticalSummaryIds: criticalSummaryIds(
                input,
                a.criticalTaskIds,
              ),
            },
    };
  }
  const a = analyzeDatedGraph(graph, new Set(graph.leafIds), H);
  const criticalSummaries = new Set(
    criticalSummaryIds(input, a.criticalTaskIds),
  );
  const readyTasks = Object.fromEntries(
    graph.leafIds.map((id) => {
      const real = realInterval(taskById.get(id)!, input.calendarType);
      if (real === null) throw new RangeError('INVALID_ANALYSIS_INTERVAL');
      const v = a.values.get(id)!;
      return [
        id,
        {
          ...real,
          projectFloat: v.projectFloat,
          constraintFloat: v.constraintFloat,
        },
      ];
    }),
  );
  const readySummaries = Object.fromEntries(
    Object.entries(projection.summaries).map(([id, s]) => {
      const { startDate, finishDate, calendarSpanDays } = s;
      if (
        startDate === null ||
        finishDate === null ||
        calendarSpanDays === null
      )
        throw new RangeError('INVALID_ANALYSIS_SUMMARY');
      return [
        id,
        {
          ...s,
          startDate,
          finishDate,
          calendarSpanDays,
          containsCritical: criticalSummaries.has(id),
        },
      ];
    }),
  );
  return {
    ...common,
    analysisStatus: 'ready',
    feasibility: 'feasible',
    tasks: readyTasks,
    summaries: readySummaries,
    horizonFinishDate:
      H === null ? null : indexToDate(H - 1, originDate, input.calendarType),
    partialAnalysis: null,
    criticalTaskIds: a.criticalTaskIds,
    criticalDependencyIds: a.criticalDependencyIds,
  };
}
