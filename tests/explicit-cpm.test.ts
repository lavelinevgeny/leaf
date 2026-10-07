import { expect, it, vi } from 'vitest';
import {
  calculateSchedule,
  projectExplicitSchedule,
} from '../src/domain/scheduling.js';
import {
  analyzeExplicitDates,
  buildCpmGraph,
  analyzeDatedGraph,
  toWorkingInterval,
} from '../src/domain/explicit-cpm.js';
import { validateDependencies } from '../src/domain/planning.js';
import type { OptionalInput } from '../src/domain/scheduling-types.js';
import { leaf, edge, readyFixtures } from './helpers/explicit-cpm-fixtures.js';
function validatedGraph(input: OptionalInput, originDate?: string) {
  validateDependencies(input.tasks, input.dependencies);
  return buildCpmGraph(input, originDate);
}

it.each(readyFixtures)(
  '$id literal observed intervals',
  ({ input, horizon, floats, critical, criticalEdges }) => {
    const before = structuredClone(input);
    const result = calculateSchedule(input);
    expect(result.analysisStatus).toBe('ready');
    if (result.analysisStatus !== 'ready') throw new Error('Expected ready');
    expect(result.feasibility).toBe('feasible');
    expect(result.horizonFinishDate).toBe(horizon);
    expect(
      Object.entries(result.tasks)
        .map(([id, t]) => [id, t.projectFloat, t.constraintFloat])
        .sort(),
    ).toEqual(floats);
    expect(result.criticalTaskIds).toEqual(critical);
    expect(result.criticalDependencyIds).toEqual(criticalEdges);
    expect(result.partialAnalysis).toBeNull();
    expect(result.diagnostics).toEqual([]);
    expect(input).toEqual(before);
    const reversed = {
      ...input,
      tasks: [...input.tasks].reverse(),
      dependencies: [...input.dependencies].reverse(),
    };
    expect(calculateSchedule(reversed)).toEqual(result);
    expect(
      analyzeExplicitDates(input, projectExplicitSchedule(input), '2026-10-05'),
    ).toEqual(
      analyzeExplicitDates(input, projectExplicitSchedule(input), '2026-10-20'),
    );
  },
);

it('P07 uses a single Hknown and no ordinary/global analysis', () => {
  const input: OptionalInput = {
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', '2026-10-09'),
      leaf('C', '2026-10-05', '2026-10-14'),
      leaf('U', null, null),
    ],
    dependencies: [edge('AB', 'A', 'B')],
  };
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({ knownLeafCount: 3, totalLeafCount: 4 });
  expect(r.horizonFinishDate).toBeNull();
  expect(
    Object.values(r.tasks).map((t) => [t.projectFloat, t.constraintFloat]),
  ).toEqual([
    [null, null],
    [null, null],
    [null, null],
    [null, null],
  ]);
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
  expect(r.partialAnalysis).toEqual({
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-14',
    coverage: { analyzedLeafCount: 3, blockedLeafCount: 1 },
    tasks: {
      A: { knownHorizonFloat: 5 },
      B: { knownHorizonFloat: 5 },
      C: { knownHorizonFloat: 0 },
    },
    partialCriticalTaskIds: ['C'],
    partialCriticalDependencyIds: [],
    partialCriticalSummaryIds: [],
  });
  expect(r.diagnostics).toEqual([
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['U'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
});

it.each([
  ['P08', '2026-10-09', '2026-10-14', 0, ['C']],
  ['Hknown-blocked-late', '2026-10-16', '2026-10-16', 2, []],
] as const)(
  '%s never bypasses unknown and includes blocked known leaves in Hknown',
  (_name, bFinish, horizon, cFloat, partialIds) => {
    const input: OptionalInput = {
      calendarType: 'all-days',
      tasks: [
        leaf('A', '2026-10-05', '2026-10-06'),
        leaf('U', null, null),
        leaf('B', '2026-10-07', bFinish),
        leaf('C', '2026-10-05', '2026-10-14'),
      ],
      dependencies: [edge('AU', 'A', 'U'), edge('UB', 'U', 'B')],
    };
    const r = calculateSchedule(input);
    expect(r.analysisStatus).toBe('incomplete');
    if (r.analysisStatus !== 'incomplete')
      throw new Error('Expected incomplete');
    expect(r.coverage).toEqual({ knownLeafCount: 3, totalLeafCount: 4 });
    expect(r.partialAnalysis).toEqual({
      labelKey: 'scheduling.PARTIAL_ANALYSIS',
      knownHorizonFinishDate: horizon,
      coverage: { analyzedLeafCount: 1, blockedLeafCount: 3 },
      tasks: { C: { knownHorizonFloat: cFloat } },
      partialCriticalTaskIds: [...partialIds],
      partialCriticalDependencyIds: [],
      partialCriticalSummaryIds: [],
    });
    expect(r.diagnostics).toEqual([
      {
        code: 'UNKNOWN_INTERVAL',
        taskIds: ['U'],
        dependencyIds: [],
        messageKey: 'scheduling.UNKNOWN_INTERVAL',
      },
      {
        code: 'UNKNOWN_PRECEDENCE',
        taskIds: ['A', 'U'],
        dependencyIds: ['AU'],
        messageKey: 'scheduling.UNKNOWN_PRECEDENCE',
      },
      {
        code: 'UNKNOWN_PRECEDENCE',
        taskIds: ['B', 'U'],
        dependencyIds: ['UB'],
        messageKey: 'scheduling.UNKNOWN_PRECEDENCE',
      },
    ]);
    expect(r.criticalTaskIds).toEqual([]);
    expect(r.criticalDependencyIds).toEqual([]);
  },
);

it('F03 plus unknown U publishes tight partial edges without global criticality', () => {
  const input: OptionalInput = {
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('B', '2026-10-07', '2026-10-09'),
      leaf('C', '2026-10-10', '2026-10-11'),
      leaf('U', null, null),
    ],
    dependencies: [
      edge('AB', 'A', 'B'),
      edge('BC', 'B', 'C'),
      edge('AC', 'A', 'C'),
    ],
  };
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({ knownLeafCount: 3, totalLeafCount: 4 });
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
  expect(r.partialAnalysis).toEqual({
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-11',
    coverage: { analyzedLeafCount: 3, blockedLeafCount: 1 },
    tasks: {
      A: { knownHorizonFloat: 0 },
      B: { knownHorizonFloat: 0 },
      C: { knownHorizonFloat: 0 },
    },
    partialCriticalTaskIds: ['A', 'B', 'C'],
    partialCriticalDependencyIds: ['AB', 'BC'],
    partialCriticalSummaryIds: [],
  });
  expect(
    Object.values(r.tasks).every(
      (t) => t.projectFloat === null && t.constraintFloat === null,
    ),
  ).toBe(true);
  expect(r.diagnostics).toEqual([
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['U'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
});

it('wide unknown leaves use bounded diagnostic lookup work without timing assertions', () => {
  const n = 10000;
  const tasks = Array.from({ length: n }, (_, i) =>
    leaf('U' + String(i).padStart(5, '0'), null, null),
  );
  const input: OptionalInput = {
    calendarType: 'all-days',
    tasks,
    dependencies: [],
  };
  const projection = {
    feasibility: 'incomplete' as const,
    coverage: { knownLeafCount: 0, totalLeafCount: n },
    tasks: Object.fromEntries(
      tasks.map((t) => [
        t.id,
        { startDate: null, finishDate: null, calendarSpanDays: null },
      ]),
    ),
    summaries: {},
    display: {},
    diagnostics: tasks.map((t) => ({
      code: 'UNKNOWN_INTERVAL',
      taskIds: [t.id],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    })),
  };
  const originalSome = Array.prototype.some;
  let inspections = 0;
  const spy = vi.spyOn(Array.prototype, 'some').mockImplementation(function (
    this: unknown[],
    predicate: (value: unknown, index: number, array: unknown[]) => unknown,
    thisArg?: unknown,
  ) {
    return originalSome.call(this, (value, index, array) => {
      inspections++;
      return predicate.call(thisArg, value, index, array);
    });
  });
  let r: ReturnType<typeof analyzeExplicitDates>;
  try {
    r = analyzeExplicitDates(input, projection);
  } finally {
    spy.mockRestore();
  }
  expect(inspections).toBeLessThanOrEqual(20 * n);
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.diagnostics).toEqual(projection.diagnostics);
  expect(Object.keys(r.tasks)).toHaveLength(n);
  expect(r.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: n });
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toBeNull();
});

it('P09 conflict plus unknown suppresses all floats and partial IDs', () => {
  const r = calculateSchedule({
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-05', '2026-10-07'),
      leaf('B', '2026-10-07', '2026-10-09'),
      leaf('U', null, null),
    ],
    dependencies: [edge('AB', 'A', 'B'), edge('BU', 'B', 'U')],
  });
  expect(r.analysisStatus).toBe('infeasible');
  if (r.analysisStatus !== 'infeasible') throw new Error('Expected infeasible');
  expect(r.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 3 });
  expect(r.tasks.A).toEqual({
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    calendarSpanDays: 3,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(r.partialAnalysis).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
  expect(
    Object.values(r.tasks).every(
      (t) => t.projectFloat === null && t.constraintFloat === null,
    ),
  ).toBe(true);
  expect(r.diagnostics).toEqual([
    {
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: ['A', 'B'],
      dependencyIds: ['AB'],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['U'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
    {
      code: 'UNKNOWN_PRECEDENCE',
      taskIds: ['B', 'U'],
      dependencyIds: ['BU'],
      messageKey: 'scheduling.UNKNOWN_PRECEDENCE',
    },
  ]);
});

it.each([
  [null, null, 3],
  ['2026-10-09', null, 3],
  [null, '2026-10-13', 3],
] as const)('P11 keeps %s/%s/%s unknown', (start, finish, duration) => {
  const input: OptionalInput = {
    calendarType: 'weekdays',
    tasks: [leaf('U', start, finish, duration)],
    dependencies: [],
  };
  expect(toWorkingInterval(input.tasks[0]!, 'weekdays')).toBeNull();
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.tasks.U).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(r.partialAnalysis).toBeNull();
  expect(r.display).toEqual({});
  expect(input.tasks[0]).toEqual(leaf('U', start, finish, duration));
});

const c17Input = (): OptionalInput => ({
  calendarType: 'all-days',
  unavailableTaskIds: ['D'],
  tasks: [
    leaf('P', null, null),
    leaf('D', '2026-10-05', '2026-10-07', 3, 'done', 'P'),
    leaf('K', '2026-10-09', '2026-10-10', null, 'todo', 'P'),
    leaf('U', null, null, 3, 'todo', 'P'),
    leaf('C', '2026-10-05', '2026-10-08'),
  ],
  dependencies: [edge('DK', 'D', 'K')],
});
it('C17 valid retained done source stays unknown and blocks its whole weak component', () => {
  const input = c17Input(),
    before = structuredClone(input),
    r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.feasibility).toBe('incomplete');
  expect(r.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 4 });
  expect(r.tasks.D).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(r.summaries.P).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    knownLeafCount: 1,
    totalLeafCount: 3,
    containsCritical: null,
  });
  expect(r.display.U).toEqual({
    kind: 'conditional',
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    clipped: false,
  });
  expect(r.diagnostics).toEqual([
    {
      code: 'LEGACY_INTERVAL_UNAVAILABLE',
      taskIds: ['D'],
      dependencyIds: [],
      messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['U'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toEqual({
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-10',
    coverage: { analyzedLeafCount: 1, blockedLeafCount: 3 },
    tasks: { C: { knownHorizonFloat: 2 } },
    partialCriticalTaskIds: [],
    partialCriticalDependencyIds: [],
    partialCriticalSummaryIds: [],
  });
  const graph = validatedGraph(input, '2026-10-05');
  expect([...graph.vertices.keys()]).toEqual(['C', 'K']);
  expect(graph.leafIds).toEqual(['C', 'D', 'K', 'U']);
  expect(graph.weakComponents).toEqual([['C'], ['D', 'K'], ['U']]);
  expect(graph.dependencies).toEqual([edge('DK', 'D', 'K')]);
  expect(input).toEqual(before);
  expect(
    analyzeExplicitDates(input, projectExplicitSchedule(input), '2026-10-20'),
  ).toEqual(r);
});
it('C17 excludes marked late finish from Hknown while preserving source minima', () => {
  const input = c17Input();
  input.tasks = input.tasks.map((t) =>
    t.id === 'D' ? { ...t, inputFinish: '2026-10-20', durationDays: 16 } : t,
  );
  input.dependencies = [];
  const r = calculateSchedule(input);
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toEqual({
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-10',
    coverage: { analyzedLeafCount: 2, blockedLeafCount: 2 },
    tasks: { C: { knownHorizonFloat: 2 }, K: { knownHorizonFloat: 0 } },
    partialCriticalTaskIds: ['K'],
    partialCriticalDependencyIds: [],
    partialCriticalSummaryIds: ['P'],
  });
  expect(input.tasks.find((t) => t.id === 'D')).toMatchObject({
    inputStart: '2026-10-05',
    inputFinish: '2026-10-20',
    durationDays: 16,
    status: 'done',
  });
  expect(r.display.U).toEqual({
    kind: 'conditional',
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    clipped: false,
  });
});
it('marked source still proves raw FS conflict and preserves unavailable plus unknown diagnostics', () => {
  const input = c17Input();
  input.tasks = input.tasks.map((t) =>
    t.id === 'K' ? { ...t, inputStart: '2026-10-07' } : t,
  );
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('infeasible');
  expect(r.feasibility).toBe('infeasible');
  if (r.analysisStatus !== 'infeasible') throw new Error('Expected infeasible');
  expect(r.coverage).toEqual({ knownLeafCount: 2, totalLeafCount: 4 });
  expect(r.partialAnalysis).toBeNull();
  expect(r.horizonFinishDate).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
  expect(r.diagnostics).toEqual([
    {
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: ['D', 'K'],
      dependencyIds: ['DK'],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    },
    {
      code: 'LEGACY_INTERVAL_UNAVAILABLE',
      taskIds: ['D'],
      dependencyIds: [],
      messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['U'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
  expect(r.tasks.D).toMatchObject({ startDate: null, finishDate: null });
  expect(r.tasks.K).toMatchObject({
    startDate: '2026-10-07',
    finishDate: '2026-10-10',
    projectFloat: null,
    constraintFloat: null,
  });
  expect(input.dependencies).toEqual([edge('DK', 'D', 'K')]);
});
it('ordinary unmarked explicit done retains real pair and structural float', () => {
  const marked = c17Input();
  const input: OptionalInput = {
    calendarType: marked.calendarType,
    tasks: marked.tasks.filter((t) => t.id !== 'U'),
    dependencies: marked.dependencies,
  };
  const r = calculateSchedule(input);
  if (r.analysisStatus !== 'ready') throw new Error('Expected ready');
  expect(r.coverage).toEqual({ knownLeafCount: 3, totalLeafCount: 3 });
  expect(r.tasks.D).toEqual({
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    calendarSpanDays: 3,
    projectFloat: 1,
    constraintFloat: 0,
  });
  expect(r.tasks.K).toMatchObject({ projectFloat: 0, constraintFloat: 0 });
  expect(r.tasks.C).toMatchObject({ projectFloat: 2, constraintFloat: 2 });
  expect(r.criticalTaskIds).toEqual(['K']);
  expect(r.criticalDependencyIds).toEqual([]);
  expect(r.diagnostics).toEqual([]);
});
it('only marked and missing leaves have no Hknown but keep retained-start conditional anchor', () => {
  const original = c17Input();
  const input: OptionalInput = {
    ...original,
    tasks: original.tasks.filter((t) => ['P', 'D', 'U'].includes(t.id)),
    dependencies: [],
  };
  const r = calculateSchedule(input);
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: 2 });
  expect(r.partialAnalysis).toBeNull();
  expect(r.horizonFinishDate).toBeNull();
  expect(r.summaries.P).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    knownLeafCount: 0,
    totalLeafCount: 2,
    containsCritical: null,
  });
  expect(r.display.U).toEqual({
    kind: 'conditional',
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    clipped: false,
  });
});
it('foreign unavailable ID fails closed before analysis', () => {
  const input: OptionalInput = {
    ...c17Input(),
    unavailableTaskIds: ['foreign'],
  };
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('infeasible');
  expect(r.diagnostics).toEqual([
    {
      code: 'INVALID_UNAVAILABLE_TASK',
      taskIds: ['foreign'],
      dependencyIds: [],
      messageKey: 'scheduling.INVALID_UNAVAILABLE_TASK',
    },
  ]);
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
});

it('keeps unknown standalone leaves incomplete and empty project ready', () => {
  const empty = calculateSchedule({
    calendarType: 'weekdays',
    tasks: [],
    dependencies: [],
  });
  expect(empty).toEqual({
    analysisStatus: 'ready',
    feasibility: 'feasible',
    coverage: { knownLeafCount: 0, totalLeafCount: 0 },
    tasks: {},
    summaries: {},
    display: {},
    horizonFinishDate: null,
    partialAnalysis: null,
    criticalTaskIds: [],
    criticalDependencyIds: [],
    diagnostics: [],
  });
  const unknown = calculateSchedule({
    calendarType: 'all-days',
    tasks: [leaf('U', null, null, null, 'done')],
    dependencies: [],
  });
  expect(unknown.analysisStatus).toBe('incomplete');
  expect(unknown.tasks.U).toMatchObject({
    calendarSpanDays: null,
    projectFloat: null,
    constraintFloat: null,
  });
});

it('FS can be known while both intervals remain unknown', () => {
  const r = calculateSchedule({
    calendarType: 'weekdays',
    tasks: [leaf('A', null, '2026-10-09'), leaf('B', '2026-10-12', null)],
    dependencies: [edge('AB', 'A', 'B')],
  });
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: 2 });
  expect(r.diagnostics).toEqual([
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['A'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['B'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
  const conflict = calculateSchedule({
    calendarType: 'weekdays',
    tasks: [leaf('A', null, '2026-10-09'), leaf('B', '2026-10-09', null)],
    dependencies: [edge('AB', 'A', 'B')],
  });
  expect(conflict.analysisStatus).toBe('infeasible');
  expect(conflict.criticalTaskIds).toEqual([]);
});

it.each([
  [
    'calendar-invalid',
    leaf('U', '2026-10-10', '2026-10-12'),
    'INVALID_INTERVAL',
  ],
  [
    'duration-mismatch',
    leaf('U', '2026-10-09', '2026-10-12', 3),
    'DURATION_MISMATCH',
  ],
  ['reversed', leaf('U', '2026-10-13', '2026-10-12'), 'INVALID_INTERVAL'],
] as const)(
  '%s saved source is incomplete without a proved FS conflict',
  (_name, u, code) => {
    const r = calculateSchedule({
      calendarType: 'weekdays',
      tasks: [u, leaf('C', '2026-10-12', '2026-10-13')],
      dependencies: [],
    });
    expect(r.analysisStatus).toBe('incomplete');
    expect(r.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 2 });
    expect(r.diagnostics).toEqual([
      {
        code,
        taskIds: ['U'],
        dependencyIds: [],
        messageKey: 'scheduling.' + code,
      },
    ]);
    if (r.analysisStatus !== 'incomplete')
      throw new Error('Expected incomplete');
    expect(r.partialAnalysis?.tasks).toEqual({ C: { knownHorizonFloat: 0 } });
  },
);

it('known leaves in an entirely blocked graph yield an empty partial set', () => {
  const r = calculateSchedule({
    calendarType: 'all-days',
    tasks: [leaf('A', '2026-10-05', '2026-10-06'), leaf('U', null, null)],
    dependencies: [edge('AU', 'A', 'U')],
  });
  if (r.analysisStatus !== 'incomplete') throw new Error('Expected incomplete');
  expect(r.partialAnalysis).toEqual({
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-06',
    coverage: { analyzedLeafCount: 0, blockedLeafCount: 2 },
    tasks: {},
    partialCriticalTaskIds: [],
    partialCriticalDependencyIds: [],
    partialCriticalSummaryIds: [],
  });
});

it.each([
  ['all-days', 3652059],
  ['weekdays', 2608615],
] as const)(
  '%s handles full range without iterating days',
  (calendarType, span) => {
    const input: OptionalInput = {
      calendarType,
      tasks: [leaf('A', '0001-01-01', '9999-12-31')],
      dependencies: [],
    };
    const r = calculateSchedule(input);
    expect(r.analysisStatus).toBe('ready');
    expect(r.tasks.A).toEqual({
      startDate: '0001-01-01',
      finishDate: '9999-12-31',
      calendarSpanDays: span,
      projectFloat: 0,
      constraintFloat: 0,
    });
    if (r.analysisStatus !== 'ready') throw new Error('Expected ready');
    expect(r.horizonFinishDate).toBe('9999-12-31');
    expect(r.criticalTaskIds).toEqual(['A']);
    expect(
      toWorkingInterval(input.tasks[0]!, calendarType, '0001-01-01'),
    ).toEqual({ s: 0, f: span, d: span });
  },
);
it('last representable day does not require a date for exclusive f', () => {
  const r = calculateSchedule({
    calendarType: 'weekdays',
    tasks: [leaf('A', '9999-12-31', '9999-12-31')],
    dependencies: [],
  });
  expect(r.tasks.A).toMatchObject({
    calendarSpanDays: 1,
    projectFloat: 0,
    constraintFloat: 0,
  });
});
it('coordinate translation moves s/f/LS/LF only', () => {
  const f = readyFixtures.find((f) => f.id === 'N06')!;
  const g0 = validatedGraph(f.input, '2026-10-05');
  const g1 = validatedGraph(f.input, '2026-10-20');
  const a0 = analyzeDatedGraph(g0, new Set(['A', 'B', 'C']), 10);
  const a1 = analyzeDatedGraph(g1, new Set(['A', 'B', 'C']), -5);
  expect(g0.vertices.get('A')).toEqual({
    id: 'A',
    status: 'todo',
    s: 0,
    f: 2,
    d: 2,
  });
  expect(g1.vertices.get('A')).toEqual({
    id: 'A',
    status: 'todo',
    s: -15,
    f: -13,
    d: 2,
  });
  expect(a0.values.get('A')).toEqual({
    LS: 7,
    LF: 9,
    projectFloat: 7,
    constraintFloat: 3,
  });
  expect(a1.values.get('A')).toEqual({
    LS: -8,
    LF: -6,
    projectFloat: 7,
    constraintFloat: 3,
  });
  expect(a0.criticalTaskIds).toEqual(['C']);
  expect(a1.criticalTaskIds).toEqual(['C']);
  expect(() => analyzeDatedGraph(g0, new Set(['A']), 10)).toThrow(
    'INVALID_ANALYSIS_COMPONENT',
  );
});

it('deep summaries aggregate leaf criticality, never become CPM vertices', () => {
  const parents = Array.from({ length: 40 }, (_, i) =>
    leaf(
      'P' + String(i).padStart(2, '0'),
      null,
      null,
      null,
      'todo',
      i === 0 ? null : 'P' + String(i - 1).padStart(2, '0'),
    ),
  );
  const input: OptionalInput = {
    calendarType: 'all-days',
    tasks: [
      ...parents,
      leaf('A', '2026-10-05', '2026-10-06', null, 'todo', 'P39'),
      leaf('B', '2026-10-07', '2026-10-09', null, 'todo', 'P39'),
      leaf('C', '2026-10-05', '2026-10-14', null, 'todo', 'P39'),
    ],
    dependencies: [edge('AB', 'A', 'B')],
  };
  const r = calculateSchedule(input);
  expect(r.criticalTaskIds).toEqual(['C']);
  expect(Object.keys(r.tasks)).toEqual(['A', 'B', 'C']);
  for (const p of parents)
    expect(r.summaries[p.id]).toEqual({
      startDate: '2026-10-05',
      finishDate: '2026-10-14',
      calendarSpanDays: 10,
      knownLeafCount: 3,
      totalLeafCount: 3,
      containsCritical: true,
    });
  const unknown = {
    ...input,
    tasks: [...input.tasks, leaf('U', null, null, 3, 'todo', 'P39')],
  };
  const partial = calculateSchedule(unknown);
  if (partial.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  for (const p of parents)
    expect(partial.summaries[p.id]).toEqual({
      startDate: null,
      finishDate: null,
      calendarSpanDays: null,
      knownLeafCount: 3,
      totalLeafCount: 4,
      containsCritical: null,
    });
  expect(partial.partialAnalysis?.partialCriticalSummaryIds).toEqual(
    parents.map((p) => p.id),
  );
  expect(partial.display.U).toEqual({
    kind: 'conditional',
    startDate: '2026-10-05',
    finishDate: '2026-10-07',
    clipped: false,
  });
  expect(partial.tasks.U).toMatchObject({
    startDate: null,
    finishDate: null,
    projectFloat: null,
  });
  const noDuration = {
    ...unknown,
    tasks: unknown.tasks.map((t) =>
      t.id === 'U' ? { ...t, durationDays: null } : t,
    ),
  };
  const oneDay = calculateSchedule(noDuration);
  expect(oneDay.analysisStatus).toBe('incomplete');
  expect(oneDay.criticalTaskIds).toEqual([]);
  if (oneDay.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  expect(oneDay.partialAnalysis).toEqual(partial.partialAnalysis);
  expect(oneDay.display.U).toEqual({
    kind: 'conditional',
    startDate: '2026-10-05',
    finishDate: '2026-10-05',
    clipped: false,
  });
});

it('10000-level hierarchy is iterative and ignores parent source values', () => {
  const tasks = Array.from({ length: 10000 }, (_, i) =>
    leaf(
      'P' + String(i).padStart(5, '0'),
      '2026-10-01',
      '2026-10-31',
      31,
      'todo',
      i === 0 ? null : 'P' + String(i - 1).padStart(5, '0'),
    ),
  );
  tasks.push(leaf('A', '2026-10-05', '2026-10-05', null, 'todo', 'P09999'));
  const r = calculateSchedule({
    calendarType: 'all-days',
    tasks,
    dependencies: [],
  });
  expect(r.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 1 });
  expect(r.criticalTaskIds).toEqual(['A']);
  expect(Object.keys(r.summaries)).toHaveLength(10000);
  expect(r.summaries.P00000).toEqual({
    startDate: '2026-10-05',
    finishDate: '2026-10-05',
    calendarSpanDays: 1,
    knownLeafCount: 1,
    totalLeafCount: 1,
    containsCritical: true,
  });
});

// 30 two-vertex layers represent 2^30 equal combinations; output is only sets.
// Literal dates repeat twice per layer; no production calendar/solver helper.
it('returns all equal critical IDs in O(V+E) space', () => {
  const dates = [
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
    '17',
    '18',
    '19',
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '28',
    '29',
    '30',
  ];
  const tasks = dates.flatMap((day, i) =>
    ['a', 'b'].map((suffix) =>
      leaf(
        'L' + String(i).padStart(2, '0') + suffix,
        '2026-10-' + day,
        '2026-10-' + day,
      ),
    ),
  );
  const dependencies = dates
    .slice(1)
    .flatMap((_day, i) =>
      ['a', 'b'].flatMap((from) =>
        ['a', 'b'].map((to) =>
          edge(
            'E' + String(i).padStart(2, '0') + from + to,
            'L' + String(i).padStart(2, '0') + from,
            'L' + String(i + 1).padStart(2, '0') + to,
          ),
        ),
      ),
    );
  const r = calculateSchedule({
    calendarType: 'all-days',
    tasks,
    dependencies,
  });
  expect(r.analysisStatus).toBe('ready');
  expect(r.criticalTaskIds).toEqual(tasks.map((t) => t.id));
  expect(r.criticalDependencyIds).toEqual(dependencies.map((e) => e.id));
  expect(r.criticalTaskIds).toHaveLength(60);
  expect(r.criticalDependencyIds).toHaveLength(116);
  expect(
    Object.values(r.tasks).every(
      (t) => t.projectFloat === 0 && t.constraintFloat === 0,
    ),
  ).toBe(true);
});

it('P09 known conflict alone suppresses normal and partial analysis', () => {
  const r = calculateSchedule({
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-05', '2026-10-07'),
      leaf('B', '2026-10-07', '2026-10-09'),
    ],
    dependencies: [edge('AB', 'A', 'B')],
  });
  expect(r.analysisStatus).toBe('infeasible');
  expect(r.diagnostics).toEqual([
    {
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: ['A', 'B'],
      dependencyIds: ['AB'],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    },
  ]);
  expect(r.horizonFinishDate).toBeNull();
  expect(r.partialAnalysis).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
  expect(r.tasks).toEqual({
    A: {
      startDate: '2026-10-05',
      finishDate: '2026-10-07',
      calendarSpanDays: 3,
      projectFloat: null,
      constraintFloat: null,
    },
    B: {
      startDate: '2026-10-07',
      finishDate: '2026-10-09',
      calendarSpanDays: 3,
      projectFloat: null,
      constraintFloat: null,
    },
  });
});
it('weekday nonworking required bound is unknown alongside the two missing pairs', () => {
  const r = calculateSchedule({
    calendarType: 'weekdays',
    tasks: [leaf('A', null, '2026-10-09'), leaf('B', '2026-10-10', null)],
    dependencies: [edge('AB', 'A', 'B')],
  });
  expect(r.analysisStatus).toBe('incomplete');
  expect(r.coverage).toEqual({ knownLeafCount: 0, totalLeafCount: 2 });
  expect(r.diagnostics).toEqual([
    {
      code: 'INVALID_PRECEDENCE_BOUNDARY',
      taskIds: ['A', 'B'],
      dependencyIds: ['AB'],
      messageKey: 'scheduling.INVALID_PRECEDENCE_BOUNDARY',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['A'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: ['B'],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
  ]);
  expect(r.partialAnalysis).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);
});
it('all-days Friday to Saturday has literal zero floats and a tight critical edge', () => {
  const r = calculateSchedule({
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-09', '2026-10-09'),
      leaf('B', '2026-10-10', '2026-10-10'),
    ],
    dependencies: [edge('AB', 'A', 'B')],
  });
  expect(r.analysisStatus).toBe('ready');
  expect(r.tasks).toEqual({
    A: {
      startDate: '2026-10-09',
      finishDate: '2026-10-09',
      calendarSpanDays: 1,
      projectFloat: 0,
      constraintFloat: 0,
    },
    B: {
      startDate: '2026-10-10',
      finishDate: '2026-10-10',
      calendarSpanDays: 1,
      projectFloat: 0,
      constraintFloat: 0,
    },
  });
  expect(r.criticalTaskIds).toEqual(['A', 'B']);
  expect(r.criticalDependencyIds).toEqual(['AB']);
});
it('a deep C finish change switches to AB and updates all forty full summaries', () => {
  const parents = Array.from({ length: 40 }, (_, i) =>
    leaf(
      'P' + String(i).padStart(2, '0'),
      null,
      null,
      null,
      'todo',
      i === 0 ? null : 'P' + String(i - 1).padStart(2, '0'),
    ),
  );
  const input: OptionalInput = {
    calendarType: 'all-days',
    tasks: [
      ...parents,
      leaf('A', '2026-10-05', '2026-10-06', null, 'todo', 'P39'),
      leaf('B', '2026-10-07', '2026-10-09', null, 'todo', 'P39'),
      leaf('C', '2026-10-05', '2026-10-14', null, 'todo', 'P39'),
    ],
    dependencies: [edge('AB', 'A', 'B')],
  };
  const before = structuredClone(input);
  expect(calculateSchedule(input).criticalTaskIds).toEqual(['C']);
  const r = calculateSchedule({
    ...input,
    tasks: input.tasks.map((t) =>
      t.id === 'C' ? { ...t, inputFinish: '2026-10-08' } : t,
    ),
  });
  if (r.analysisStatus !== 'ready') throw new Error('Expected ready');
  expect(r.horizonFinishDate).toBe('2026-10-09');
  expect(r.coverage).toEqual({ knownLeafCount: 3, totalLeafCount: 3 });
  expect(
    Object.entries(r.tasks).map(([id, t]) => [
      id,
      t.projectFloat,
      t.constraintFloat,
    ]),
  ).toEqual([
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 1, 1],
  ]);
  expect(r.criticalTaskIds).toEqual(['A', 'B']);
  expect(r.criticalDependencyIds).toEqual(['AB']);
  for (const p of parents)
    expect(r.summaries[p.id]).toEqual({
      startDate: '2026-10-05',
      finishDate: '2026-10-09',
      calendarSpanDays: 5,
      knownLeafCount: 3,
      totalLeafCount: 3,
      containsCritical: true,
    });
  expect(input).toEqual(before);
});
it('a marked parent never excludes its unmarked known children', () => {
  const initial = c17Input();
  const input: OptionalInput = {
    ...initial,
    unavailableTaskIds: ['P'],
    tasks: initial.tasks.filter((t) => t.id !== 'U'),
  };
  const r = calculateSchedule(input);
  if (r.analysisStatus !== 'ready') throw new Error('Expected ready');
  expect(r.coverage).toEqual({ knownLeafCount: 3, totalLeafCount: 3 });
  expect(r.tasks.D).toMatchObject({ projectFloat: 1, constraintFloat: 0 });
  expect(r.criticalTaskIds).toEqual(['K']);
  expect(r.diagnostics).toEqual([]);
  expect(r.summaries.P?.containsCritical).toBe(true);
});
it('direct graph retains unknown vertices and validates analysis component and horizon boundaries', () => {
  const input: OptionalInput = {
    calendarType: 'all-days',
    tasks: [
      leaf('A', '2026-10-05', '2026-10-06'),
      leaf('U', null, null),
      leaf('B', '2026-10-07', '2026-10-09'),
    ],
    dependencies: [edge('AU', 'A', 'U'), edge('UB', 'U', 'B')],
  };
  const graph = validatedGraph(input, '2026-10-05');
  expect(graph.leafIds).toEqual(['A', 'B', 'U']);
  expect(graph.topoIds).toEqual(['A', 'U', 'B']);
  expect(graph.weakComponents).toEqual([['A', 'B', 'U']]);
  expect([...graph.vertices.keys()]).toEqual(['A', 'B']);
  expect(graph.dependencies).toEqual(input.dependencies);
  expect(() => analyzeDatedGraph(graph, new Set(['A', 'B']), 5)).toThrow(
    'INVALID_ANALYSIS_COMPONENT',
  );
  expect(() => analyzeDatedGraph(graph, new Set(['U']), 5)).toThrow(
    'INVALID_ANALYSIS_COMPONENT',
  );
  expect(() => analyzeDatedGraph(graph, new Set(['A']), null)).toThrow(
    'INVALID_ANALYSIS_COMPONENT',
  );
  expect(() => analyzeDatedGraph(graph, new Set(), Infinity)).toThrow(
    'INVALID_ANALYSIS_HORIZON',
  );
  expect(analyzeDatedGraph(graph, new Set(), 5)).toEqual({
    horizon: 5,
    values: new Map(),
    criticalTaskIds: [],
    criticalDependencyIds: [],
  });
});
it('invalid saved interval still proves FS conflict from its independently known source finish', () => {
  const r = calculateSchedule({
    calendarType: 'weekdays',
    tasks: [
      leaf('A', '2026-10-13', '2026-10-12'),
      leaf('B', '2026-10-12', '2026-10-14'),
    ],
    dependencies: [edge('AB', 'A', 'B')],
  });
  expect(r.analysisStatus).toBe('infeasible');
  expect(r.coverage).toEqual({ knownLeafCount: 1, totalLeafCount: 2 });
  expect(r.diagnostics).toEqual([
    {
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: ['A', 'B'],
      dependencyIds: ['AB'],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    },
    {
      code: 'INVALID_INTERVAL',
      taskIds: ['A'],
      dependencyIds: [],
      messageKey: 'scheduling.INVALID_INTERVAL',
    },
  ]);
  expect(r.partialAnalysis).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.tasks.A).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(r.tasks.B).toEqual({
    startDate: '2026-10-12',
    finishDate: '2026-10-14',
    calendarSpanDays: 3,
    projectFloat: null,
    constraintFloat: null,
  });
});
it('malformed saved calendar fails closed before source arithmetic or either analysis', () => {
  const input: OptionalInput = JSON.parse(
    '{"calendarType":"unsupported","tasks":[{"id":"A","parentId":null,"status":"todo","inputStart":"2026-10-05","inputFinish":"2026-10-06","durationDays":null}],"dependencies":[]}',
  );
  const r = calculateSchedule(input);
  expect(r.analysisStatus).toBe('infeasible');
  expect(r.tasks.A).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(r.diagnostics).toEqual([
    {
      code: 'INVALID_PROJECT_CALENDAR',
      taskIds: [],
      dependencyIds: [],
      messageKey: 'scheduling.INVALID_PROJECT_CALENDAR',
    },
  ]);
  expect(r.partialAnalysis).toBeNull();
  expect(r.horizonFinishDate).toBeNull();
  expect(r.criticalTaskIds).toEqual([]);
  expect(r.criticalDependencyIds).toEqual([]);
});
