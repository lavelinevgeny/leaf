import { createHash } from 'node:crypto';
import { expect, expectTypeOf, it } from 'vitest';
import {
  frozenPendingScheduleV2Schema,
  scheduleResultV2Schema,
  liveScheduleResultV2Schema,
  liveProjectTreeV2Schema,
  liveScheduleResponseV2Schema,
  projectTreeV2Schema,
  scheduleResponseV2Schema,
  type FrozenPendingScheduleV2,
  type ScheduleResultV2,
  type LiveScheduleResultV2,
} from '../src/shared/contracts.js';
import type {
  OptionalResult,
  LiveResult,
} from '../src/domain/scheduling-types.js';
const A = '22222222-2222-4222-8222-222222222222';
const U = '22222222-2222-4222-8222-222222222223';
const pending = {
  analysisStatus: 'pending-policy',
  feasibility: 'feasible',
  coverage: { knownLeafCount: 1, totalLeafCount: 2 },
  tasks: {
    [A]: {
      startDate: '2026-10-05',
      finishDate: '2026-10-06',
      calendarSpanDays: 2,
    },
    [U]: { startDate: null, finishDate: null, calendarSpanDays: null },
  },
  summaries: {},
  display: {},
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics: [],
};
const ready = {
  analysisStatus: 'ready',
  feasibility: 'feasible',
  coverage: { knownLeafCount: 1, totalLeafCount: 1 },
  tasks: {
    [A]: {
      startDate: '2026-10-05',
      finishDate: '2026-10-06',
      calendarSpanDays: 2,
      projectFloat: 0,
      constraintFloat: 0,
    },
  },
  summaries: {},
  display: {},
  horizonFinishDate: '2026-10-06',
  partialAnalysis: null,
  criticalTaskIds: [A],
  criticalDependencyIds: [],
  diagnostics: [],
};
const incomplete = {
  analysisStatus: 'incomplete',
  feasibility: 'incomplete',
  coverage: { knownLeafCount: 1, totalLeafCount: 2 },
  tasks: {
    [A]: {
      startDate: '2026-10-05',
      finishDate: '2026-10-06',
      calendarSpanDays: 2,
      projectFloat: null,
      constraintFloat: null,
    },
    [U]: {
      startDate: null,
      finishDate: null,
      calendarSpanDays: null,
      projectFloat: null,
      constraintFloat: null,
    },
  },
  summaries: {},
  display: {},
  horizonFinishDate: null,
  criticalTaskIds: [],
  criticalDependencyIds: [],
  diagnostics: [],
  partialAnalysis: {
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-06',
    coverage: { analyzedLeafCount: 1, blockedLeafCount: 1 },
    tasks: { [A]: { knownHorizonFloat: 0 } },
    partialCriticalTaskIds: [A],
    partialCriticalDependencyIds: [],
    partialCriticalSummaryIds: [],
  },
};
it('preserves exact frozen pending and admits only live forms to the live parser', () => {
  expectTypeOf<OptionalResult>().toEqualTypeOf<ScheduleResultV2>();
  expectTypeOf<LiveResult>().toEqualTypeOf<LiveScheduleResultV2>();
  const domain: OptionalResult = scheduleResultV2Schema.parse(pending);
  const shared: ScheduleResultV2 = domain;
  expect(shared).toEqual(pending);
  expect(frozenPendingScheduleV2Schema.parse(pending)).toEqual(pending);
  expect(liveScheduleResultV2Schema.safeParse(pending).success).toBe(false);
  const live: LiveResult = liveScheduleResultV2Schema.parse(ready);
  const assignment: LiveScheduleResultV2 = live;
  expect(assignment).toEqual(ready);
  expect(scheduleResultV2Schema.parse(incomplete)).toEqual(incomplete);
});
it.each([
  { ...pending, horizonFinishDate: null },
  { ...ready, deadline: '2026-10-20' },
  { ...ready, originDate: '2026-10-05' },
  { ...ready, criticalTaskIds: [A, A] },
  { ...ready, tasks: { [A]: { ...ready.tasks[A], projectFloat: -1 } } },
  { ...incomplete, criticalTaskIds: [A] },
  {
    ...incomplete,
    tasks: {
      ...incomplete.tasks,
      [A]: { ...incomplete.tasks[A], projectFloat: 0 },
    },
  },
  {
    ...incomplete,
    partialAnalysis: {
      ...incomplete.partialAnalysis,
      tasks: { [A]: { knownHorizonFloat: 0, projectFloat: 0 } },
    },
  },
  { ...incomplete, analysisStatus: 'infeasible', feasibility: 'infeasible' },
])('rejects cross-status/unknown fields', (value) => {
  expect(scheduleResultV2Schema.safeParse(value).success).toBe(false);
});
it('infeasible strictly suppresses partial and accepts null ordinary floats', () => {
  const value = {
    ...incomplete,
    analysisStatus: 'infeasible',
    feasibility: 'infeasible',
    partialAnalysis: null,
  };
  expect(scheduleResultV2Schema.parse(value)).toEqual(value);
});

it.each([
  { ...ready, tasks: { bad: { ...ready.tasks[A] } } },
  { ...ready, tasks: { [A]: { ...ready.tasks[A], projectFloat: null } } },
  {
    ...incomplete,
    summaries: {
      [A]: {
        startDate: null,
        finishDate: null,
        calendarSpanDays: null,
        knownLeafCount: 1,
        totalLeafCount: 2,
        containsCritical: true,
      },
    },
  },
  {
    ...incomplete,
    partialAnalysis: {
      ...incomplete.partialAnalysis,
      coverage: { analyzedLeafCount: 2, blockedLeafCount: 0 },
    },
  },
  {
    ...incomplete,
    partialAnalysis: {
      ...incomplete.partialAnalysis,
      partialCriticalTaskIds: [U],
    },
  },
])(
  'rejects malformed record keys and incompatible live analysis fields',
  (value) => {
    expect(scheduleResultV2Schema.safeParse(value).success).toBe(false);
  },
);

it('preserves frozen JSON bytes and digest without adding live fields or validations', () => {
  // These combinations were accepted by Task 5; only LIVE enforces coherence.
  const frozen = {
    ...pending,
    coverage: { knownLeafCount: 3, totalLeafCount: 2 },
    tasks: {
      ...pending.tasks,
      [A]: { startDate: '2026-10-05', finishDate: null, calendarSpanDays: 2 },
    },
    summaries: {
      [U]: {
        startDate: null,
        finishDate: '2026-10-06',
        calendarSpanDays: null,
        knownLeafCount: 2,
        totalLeafCount: 1,
      },
    },
  };
  const original = JSON.stringify(frozen);
  const parsed: FrozenPendingScheduleV2 = frozenPendingScheduleV2Schema.parse(
    JSON.parse(original),
  );
  const bytes = JSON.stringify(scheduleResultV2Schema.parse(parsed));
  expect(bytes).toBe(original);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    createHash('sha256').update(original).digest('hex'),
  );
});

it.each([
  { ...pending, partialAnalysis: null },
  { ...pending, tasks: { [A]: { ...pending.tasks[A], projectFloat: null } } },
  { ...pending, criticalTaskIds: [A] },
  { ...ready, coverage: { knownLeafCount: 2, totalLeafCount: 1 } },
  { ...ready, tasks: {} },
  { ...ready, horizonFinishDate: null },
  { ...ready, feasibility: 'incomplete' },
  { ...ready, tasks: { [A]: { ...ready.tasks[A], constraintFloat: 1 } } },
  { ...ready, tasks: { [A]: { ...ready.tasks[A], projectFloat: 0.5 } } },
  {
    ...ready,
    coverage: { knownLeafCount: 2, totalLeafCount: 2 },
    tasks: { ...ready.tasks, [U]: ready.tasks[A] },
    criticalTaskIds: [U, A],
  },
  {
    ...ready,
    summaries: {
      [U]: {
        startDate: '2026-10-05',
        finishDate: '2026-10-06',
        calendarSpanDays: 2,
        knownLeafCount: 1,
        totalLeafCount: 2,
        containsCritical: false,
      },
    },
  },
  { ...incomplete, partialAnalysis: null },
  {
    ...incomplete,
    tasks: {
      ...incomplete.tasks,
      [U]: { ...incomplete.tasks[U], startDate: '2026-10-05' },
    },
  },
])('rejects invalid LIVE coherence and frozen decorations', (value) => {
  expect(scheduleResultV2Schema.safeParse(value).success).toBe(false);
});

it('separates client/cache envelopes from future current LIVE-only envelopes', () => {
  const project = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Synthetic contracts',
    revision: 1,
    calendarType: 'all-days',
    timezone: 'UTC',
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  };
  const tree = {
    project,
    tasks: [],
    dependencies: [],
    contractVersion: 2,
    canUndo: false,
    schedule: pending,
  };
  const response = {
    contractVersion: 2,
    projectId: project.id,
    revision: 1,
    schedule: pending,
  };
  expect(projectTreeV2Schema.parse(tree)).toEqual(tree);
  expect(scheduleResponseV2Schema.parse(response)).toEqual(response);
  expect(liveProjectTreeV2Schema.safeParse(tree).success).toBe(false);
  expect(liveScheduleResponseV2Schema.safeParse(response).success).toBe(false);
  expect(
    liveProjectTreeV2Schema.parse({ ...tree, schedule: ready }).schedule,
  ).toEqual(ready);
  expect(
    liveScheduleResponseV2Schema.parse({ ...response, schedule: ready })
      .schedule,
  ).toEqual(ready);
});

it('admits empty ready and entirely unknown incomplete LIVE shapes', () => {
  const empty = {
    ...ready,
    coverage: { knownLeafCount: 0, totalLeafCount: 0 },
    tasks: {},
    horizonFinishDate: null,
    criticalTaskIds: [],
  };
  expect(liveScheduleResultV2Schema.parse(empty)).toEqual(empty);
  const unknown = {
    ...incomplete,
    coverage: { knownLeafCount: 0, totalLeafCount: 1 },
    tasks: { [U]: incomplete.tasks[U] },
    partialAnalysis: null,
  };
  expect(liveScheduleResultV2Schema.parse(unknown)).toEqual(unknown);
});
