import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonical } from '../src/shared/canonical.js';
import {
  LegacySnapshotSchema,
  LegacyTreeSchema,
  LegacyOperationPayloadSchema,
} from '../src/server/legacy-contracts.js';
import {
  adaptLegacyTree,
  projectLegacySnapshot,
  resolutionKey,
  type LegacyResolution,
  type SnapshotContext,
} from '../src/server/legacy-compatibility.js';
import { projectTreeV2Schema } from '../src/shared/contracts.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const aId = '22222222-2222-4222-8222-222222222222';
const bId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-10-07T00:00:00.000Z';
const task = {
  id: aId,
  projectId,
  parentId: null,
  title: 'Synthetic A',
  description: '',
  sortOrder: 0,
  status: 'todo' as const,
  planMode: 'unscheduled' as const,
  inputStart: null,
  inputFinish: '2026-10-06',
  durationDays: null,
  notBefore: null,
  deadline: '2026-10-20',
  completedStart: null,
  completedFinish: null,
  completedStartIndex: null,
  completedFinishIndex: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const snapshot = {
  project: {
    id: projectId,
    title: 'Synthetic project',
    revision: 9,
    startDate: '2026-10-05',
    calendarType: 'all-days' as const,
    timezone: 'UTC',
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  tasks: [task],
  dependencies: [],
};
const tree = {
  ...snapshot,
  canUndo: true,
  schedule: {
    feasibility: 'feasible' as const,
    originDate: '2026-10-05',
    projectFinishIndex: null,
    coverage: { knownLeafCount: 0, totalLeafCount: 1 },
    tasks: {
      [aId]: {
        ES: null,
        EF: null,
        LS: null,
        LF: null,
        projectFloat: null,
        constraintFloat: null,
        startDate: null,
        finishDate: null,
        blockedReason: null,
      },
    },
    summaries: {},
    criticalTaskIds: [],
    criticalDependencyIds: [],
    diagnostics: [],
  },
};
const active: SnapshotContext = { kind: 'active', key: projectId };
const operation: SnapshotContext = {
  kind: 'operation',
  key: '33333333-3333-4333-8333-333333333333',
};
function resolve(
  context: SnapshotContext,
  legacyTask: object,
  source: LegacyResolution['source'],
  ownSnapshot: object = { ...snapshot, tasks: [legacyTask] },
) {
  return new Map([
    [
      resolutionKey(context, aId),
      {
        context,
        taskId: aId,
        legacyDigest: createHash('sha256')
          .update(canonical(legacyTask))
          .digest('hex'),
        contextDigest: createHash('sha256')
          .update(canonical(ownSnapshot))
          .digest('hex'),
        source,
        outcome:
          source.inputStart === null || source.inputFinish === null
            ? ('unavailable' as const)
            : ('materialized-done' as const),
      },
    ],
  ]);
}

describe('frozen legacy compatibility', () => {
  it.each([
    {
      type: 'task.edit',
      taskId: aId,
      changes: {
        title: ' Synthetic edit ',
        status: 'doing',
        description: ' Synthetic description ',
      },
    },
    {
      type: 'task.edit',
      taskId: aId,
      changes: {},
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
      },
    },
    {
      type: 'project.schedule',
      changes: { startDate: null, calendarType: 'weekdays', timezone: 'UTC' },
    },
    {
      type: 'task.plan',
      taskId: aId,
      plan: {
        mode: 'unscheduled',
        inputStart: null,
        inputFinish: '2026-10-06',
        deadline: '2026-10-20',
      },
    },
    {
      type: 'task.plan',
      taskId: aId,
      plan: {
        mode: 'auto',
        durationDays: 3,
        notBefore: '2026-10-05',
        deadline: null,
      },
    },
    {
      type: 'task.plan',
      taskId: aId,
      plan: {
        mode: 'fixed',
        inputStart: '2026-10-05',
        inputFinish: '2026-10-07',
        deadline: '2026-10-20',
      },
    },
    { type: 'dependency.create', predecessorId: aId, successorId: bId },
    { type: 'dependency.delete', dependencyId: bId },
    {
      type: 'task.create',
      title: ' Synthetic create ',
      parentId: null,
      afterId: bId,
      preserveWork: true,
    },
    {
      type: 'task.update',
      taskId: aId,
      changes: {
        title: ' Synthetic update ',
        description: ' Synthetic description ',
        status: 'todo',
        inputStart: '2026-10-05',
        inputFinish: null,
      },
    },
    {
      type: 'task.move',
      taskId: aId,
      parentId: bId,
      position: 1,
      preserveWork: false,
    },
    { type: 'task.delete', taskId: aId },
    { type: 'undo' },
  ])('validates frozen command $type without normalization', (command) => {
    const body = { expectedRevision: 8, operationId: operation.key, command };
    const parsed = LegacyOperationPayloadSchema.parse(body);
    expect(parsed).toEqual(body);
    expect(canonical(parsed)).toBe(canonical(body));
  });
  it('validates raw rename without normalization and rejects empty legacy changes/plans', () => {
    const rename = {
      title: ' Synthetic rename ',
      expectedRevision: 8,
      operationId: operation.key,
    };
    expect(LegacyOperationPayloadSchema.parse(rename)).toEqual(rename);
    expect(rename.title).toBe(' Synthetic rename ');
    for (const command of [
      { type: 'task.edit', taskId: aId, changes: {} },
      { type: 'task.update', taskId: aId, changes: {} },
      { type: 'project.schedule', changes: {} },
      {
        type: 'task.plan',
        taskId: aId,
        plan: { mode: 'fixed', inputStart: '2026-10-05' },
      },
      {
        type: 'task.plan',
        taskId: aId,
        plan: { mode: 'auto', durationDays: 1000001 },
      },
      { type: 'task.create', title: ' ', parentId: null },
    ])
      expect(
        LegacyOperationPayloadSchema.safeParse({
          expectedRevision: 8,
          operationId: operation.key,
          command,
        }).success,
      ).toBe(false);
  });
  it('keeps canonical payload bytes, nested ordering, arrays, null and transport version', () => {
    expect(canonical({ z: [null, { z: 1, a: 'Synthetic' }], a: false })).toBe(
      '{"a":false,"z":[null,{"a":"Synthetic","z":1}]}',
    );
    expect(canonical({ expectedRevision: 8, operationId: aId })).toBe(
      `{"expectedRevision":8,"operationId":"${aId}"}`,
    );
    expect(canonical({ operationId: aId, contractVersion: 2 })).toBe(
      `{"contractVersion":2,"operationId":"${aId}"}`,
    );
    expect(resolutionKey({ kind: 'undo', key: 'a:b' }, aId)).not.toBe(
      resolutionKey({ kind: 'undo', key: 'a' }, `b:${aId}`),
    );
  });
  it('freezes S2 schemas independently and rejects unknown fields and versions', () => {
    expect(LegacySnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(LegacyTreeSchema.safeParse(tree).success).toBe(true);
    for (const value of [
      null,
      { ...snapshot, contractVersion: 2 },
      { ...snapshot, tasks: [{ ...task, extra: true }] },
    ]) {
      expect(() =>
        projectLegacySnapshot(value, active, new Map()),
      ).toThrowError('Неверный прежний снимок плана.');
    }
    expect(() =>
      adaptLegacyTree(
        { ...tree, schedule: { ...tree.schedule, analysisStatus: 'ready' } },
        operation,
        new Map(),
      ),
    ).toThrowError('Неверный прежний снимок плана.');
  });
  it('M06 preserves finish, never derives dates from deadline, notBefore or project origin', () => {
    const result = projectLegacySnapshot(
      {
        ...snapshot,
        tasks: [
          task,
          { ...task, id: bId, inputFinish: null, notBefore: '2026-10-05' },
        ],
      },
      active,
      new Map(),
    );
    expect(
      result.tasks.map(({ inputStart, inputFinish, durationDays }) => ({
        inputStart,
        inputFinish,
        durationDays,
      })),
    ).toEqual([
      { inputStart: null, inputFinish: '2026-10-06', durationDays: null },
      { inputStart: null, inputFinish: null, durationDays: null },
    ]);
    expect(Object.keys(result.project).sort()).toEqual([
      'calendarType',
      'createdAt',
      'id',
      'revision',
      'timezone',
      'title',
      'updatedAt',
    ]);
    expect(Object.keys(result.tasks[0]!).sort()).toEqual([
      'createdAt',
      'description',
      'durationDays',
      'id',
      'inputFinish',
      'inputStart',
      'parentId',
      'projectId',
      'sortOrder',
      'status',
      'title',
      'updatedAt',
    ]);
    const response = adaptLegacyTree(tree, operation, new Map());
    expect(projectTreeV2Schema.safeParse(response).success).toBe(true);
    expect(response).toMatchObject({
      contractVersion: 2,
      canUndo: true,
      project: { revision: 9 },
      schedule: {
        analysisStatus: 'pending-policy',
        criticalTaskIds: [],
        criticalDependencyIds: [],
      },
    });
    expect(response.schedule.coverage).toEqual({
      knownLeafCount: 0,
      totalLeafCount: 1,
    });
    expect(response.schedule.tasks[aId]).toEqual({
      startDate: null,
      finishDate: null,
      calendarSpanDays: null,
    });
  });
  it('keeps done without locks and invalid saved source without input rejection', () => {
    const done = {
      ...task,
      status: 'done',
      inputStart: '2026-10-08',
      inputFinish: '2026-10-06',
    };
    const result = adaptLegacyTree(
      { ...tree, tasks: [done] },
      operation,
      new Map(),
    );
    expect(result.tasks[0]).toMatchObject({
      status: 'done',
      inputStart: '2026-10-08',
      inputFinish: '2026-10-06',
    });
    expect(result.schedule.diagnostics.map((item) => item.code)).toContain(
      'INVALID_INTERVAL',
    );
  });
  it.each([
    { ...task, planMode: 'auto', durationDays: 3, inputFinish: null },
    {
      ...task,
      status: 'done',
      completedStart: '2026-10-05',
      completedFinish: '2026-10-07',
    },
    {
      ...task,
      status: 'done',
      completedStartIndex: 0,
      completedFinishIndex: 3,
    },
  ])(
    'fails closed without a resolution for every Auto or done lock',
    (legacyTask) => {
      expect(() =>
        projectLegacySnapshot(
          { ...snapshot, tasks: [legacyTask] },
          active,
          new Map(),
        ),
      ).toThrowError(
        'Требуется согласованная политика переноса прежнего плана.',
      );
    },
  );
  it('M01/M07 binds selected source to the exact task and historical context', () => {
    const current = {
      ...task,
      status: 'done',
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
      completedStart: '2026-10-06',
      completedFinish: '2026-10-08',
    };
    const previous = {
      ...current,
      completedStart: '2026-10-05',
      completedFinish: '2026-10-07',
    };
    const currentResolution = resolve(active, current, {
      inputStart: '2026-10-06',
      inputFinish: '2026-10-08',
      durationDays: 3,
    });
    const oldResolution = resolve(operation, previous, {
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
    });
    const resolutions = new Map([...currentResolution, ...oldResolution]);
    expect(
      projectLegacySnapshot(
        { ...snapshot, tasks: [current] },
        active,
        resolutions,
      ).tasks[0],
    ).toMatchObject({
      inputStart: '2026-10-06',
      inputFinish: '2026-10-08',
      status: 'done',
    });
    expect(
      projectLegacySnapshot(
        { ...snapshot, tasks: [previous] },
        operation,
        resolutions,
      ).tasks[0],
    ).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      status: 'done',
    });
    expect(() =>
      projectLegacySnapshot(
        { ...snapshot, tasks: [previous] },
        operation,
        currentResolution,
      ),
    ).toThrowError('Требуется согласованная политика переноса прежнего плана.');
    const valid = oldResolution.get(resolutionKey(operation, aId))!;
    for (const changed of [
      { ...valid, legacyDigest: '0'.repeat(64) },
      { ...valid, context: active },
      { ...valid, taskId: bId },
      { ...valid, source: { ...valid.source, durationDays: 0 } },
    ]) {
      expect(() =>
        projectLegacySnapshot(
          { ...snapshot, tasks: [previous] },
          operation,
          new Map([[resolutionKey(operation, aId), changed]]),
        ),
      ).toThrowError(
        'Требуется согласованная политика переноса прежнего плана.',
      );
    }
  });
  it.each([
    { ...task, planMode: 'auto', inputFinish: null, durationDays: 3 },
    {
      ...task,
      status: 'done',
      inputFinish: null,
      completedStartIndex: 0,
      completedFinishIndex: 3,
      durationDays: 3,
    },
  ])(
    'M02/M05 accepts explicit source-preserving unknown resolution',
    (legacyTask) => {
      const source = { inputStart: null, inputFinish: null, durationDays: 3 };
      const result = adaptLegacyTree(
        {
          ...tree,
          tasks: [legacyTask],
          project: { ...tree.project, startDate: null },
        },
        operation,
        resolve(operation, legacyTask, source, {
          ...snapshot,
          tasks: [legacyTask],
          project: { ...snapshot.project, startDate: null },
        }),
      );
      expect(result.tasks[0]).toMatchObject(source);
      expect(result.schedule).toMatchObject({
        feasibility: 'incomplete',
        criticalTaskIds: [],
        criticalDependencyIds: [],
      });
      expect(result.schedule.diagnostics.map((item) => item.code)).toContain(
        'LEGACY_INTERVAL_UNAVAILABLE',
      );
    },
  );
  it('M04 accepts independent relative-lock projection without using latest origin', () => {
    const relative = {
      ...task,
      status: 'done',
      inputFinish: null,
      completedStartIndex: 0,
      completedFinishIndex: 3,
      durationDays: 3,
    };
    const result = projectLegacySnapshot(
      {
        ...snapshot,
        project: {
          ...snapshot.project,
          calendarType: 'weekdays',
          startDate: '2026-10-09',
        },
        tasks: [relative],
      },
      operation,
      resolve(
        operation,
        relative,
        {
          inputStart: '2026-10-09',
          inputFinish: '2026-10-13',
          durationDays: 3,
        },
        {
          ...snapshot,
          tasks: [relative],
          project: {
            ...snapshot.project,
            calendarType: 'weekdays',
            startDate: '2026-10-09',
          },
        },
      ),
    );
    expect(result.tasks[0]).toMatchObject({
      inputStart: '2026-10-09',
      inputFinish: '2026-10-13',
      status: 'done',
      durationDays: 3,
    });
  });
  it('preserves stored scalar duration beyond the new-input limit', () => {
    const legacyTask = {
      ...task,
      planMode: 'auto',
      inputFinish: null,
      durationDays: 1000001,
    };
    const source = {
      inputStart: null,
      inputFinish: null,
      durationDays: 1000001,
    };
    expect(
      projectLegacySnapshot(
        { ...snapshot, tasks: [legacyTask] },
        active,
        resolve(active, legacyTask, source),
      ).tasks[0],
    ).toMatchObject(source);
  });
  it('rejects resolutions that alter duration or ordinary unambiguous source', () => {
    const auto = {
      ...task,
      planMode: 'auto',
      inputFinish: null,
      durationDays: 3,
    };
    expect(() =>
      projectLegacySnapshot(
        { ...snapshot, tasks: [auto] },
        active,
        resolve(active, auto, {
          inputStart: '2026-10-05',
          inputFinish: '2026-10-07',
          durationDays: 4,
        }),
      ),
    ).toThrowError('Требуется согласованная политика переноса прежнего плана.');
    expect(() =>
      projectLegacySnapshot(
        snapshot,
        active,
        resolve(active, task, {
          inputStart: null,
          inputFinish: '2026-10-20',
          durationDays: null,
        }),
      ),
    ).toThrowError('Требуется согласованная политика переноса прежнего плана.');
  });
  it('M03/M10 preserves materialized done interval and a known FS conflict', () => {
    const done = {
      ...task,
      status: 'done',
      planMode: 'auto',
      inputStart: null,
      inputFinish: null,
      durationDays: 3,
      completedStart: '2026-10-05',
      completedFinish: '2026-10-07',
    };
    const following = {
      ...task,
      id: bId,
      title: 'Synthetic B',
      inputStart: '2026-10-06',
      inputFinish: '2026-10-08',
      durationDays: 3,
    };
    const edge = {
      id: '77777777-7777-4777-8777-777777777777',
      projectId,
      predecessorId: aId,
      successorId: bId,
    };
    const result = adaptLegacyTree(
      { ...tree, tasks: [done, following], dependencies: [edge] },
      operation,
      resolve(
        operation,
        done,
        {
          inputStart: '2026-10-05',
          inputFinish: '2026-10-07',
          durationDays: 3,
        },
        { ...snapshot, tasks: [done, following], dependencies: [edge] },
      ),
    );
    expect(
      result.tasks.map(({ inputStart, inputFinish }) => [
        inputStart,
        inputFinish,
      ]),
    ).toEqual([
      ['2026-10-05', '2026-10-07'],
      ['2026-10-06', '2026-10-08'],
    ]);
    expect(result.tasks[0]!.status).toBe('done');
    expect(result.schedule).toMatchObject({
      feasibility: 'infeasible',
      criticalTaskIds: [],
      criticalDependencyIds: [],
    });
    expect(result.schedule.diagnostics).toContainEqual({
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: [aId, bId],
      dependencyIds: [edge.id],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    });
  });
  it('preserves calendar-invalid completed boundaries and mismatched duration', () => {
    const done = {
      ...task,
      status: 'done',
      inputFinish: null,
      durationDays: 3,
      completedStart: '2026-10-10',
      completedFinish: '2026-10-12',
    };
    const source = {
      inputStart: '2026-10-10',
      inputFinish: '2026-10-12',
      durationDays: 3,
    };
    const result = adaptLegacyTree(
      {
        ...tree,
        project: { ...tree.project, calendarType: 'weekdays' },
        tasks: [done],
      },
      operation,
      resolve(operation, done, source, {
        ...snapshot,
        tasks: [done],
        project: { ...snapshot.project, calendarType: 'weekdays' },
      }),
    );
    expect(result.tasks[0]).toMatchObject(source);
    expect(result.schedule.diagnostics.map((item) => item.code)).toContain(
      'INVALID_INTERVAL',
    );
    const mismatch = {
      ...done,
      completedStart: '2026-10-05',
      completedFinish: '2026-10-06',
    };
    const mismatchSource = {
      inputStart: '2026-10-05',
      inputFinish: '2026-10-06',
      durationDays: 3,
    };
    expect(
      adaptLegacyTree(
        { ...tree, tasks: [mismatch] },
        operation,
        resolve(operation, mismatch, mismatchSource),
      ).schedule.diagnostics.map((item) => item.code),
    ).toContain('DURATION_MISMATCH');
  });
});
