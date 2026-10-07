import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import * as scheduling from '../src/domain/scheduling.js';
import {
  projectTreeV2Schema,
  snapshotV2Schema,
  taskV2Schema,
  commandV2Schema,
  type ProjectTreeV2,
  type CommandV2,
} from '../src/shared/contracts.js';
import { privateSnapshotV2Schema } from '../src/server/optional-snapshot.js';
import Database from 'better-sqlite3';
import { canonical } from '../src/shared/canonical.js';
import { prepareOptionalMigration } from '../src/server/optional-migration.js';
let directory: string,
  path: string,
  db: ReturnType<typeof openDatabase>,
  repository: Repository;
const session = 'synthetic-explicit-cpm-session';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'leaf-explicit-cpm-'));
  path = join(directory, 'synthetic.sqlite');
  db = openDatabase(path);
  repository = new Repository(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});
function step(tree: ProjectTreeV2, command: CommandV2): ProjectTreeV2 {
  return repository.applyCommand(
    tree.project.id,
    {
      contractVersion: 2,
      expectedRevision: tree.project.revision,
      operationId: randomUUID(),
      command,
    },
    session,
  );
}
function ids(tree: ProjectTreeV2) {
  return Object.fromEntries(tree.tasks.map((t) => [t.title, t.id]));
}
function p04(): ProjectTreeV2 {
  const p = repository.createProject('Synthetic explicit CPM');
  let t = repository.getTree(p.id, session);
  t = step(t, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  for (const title of ['A', 'B', 'C', 'D'])
    t = step(t, { type: 'task.create', title, parentId: null });
  const by = ids(t);
  for (const [title, inputStart, inputFinish] of [
    ['A', '2026-10-05', '2026-10-06'],
    ['B', '2026-10-07', '2026-10-09'],
    ['C', '2026-10-05', '2026-10-07'],
    ['D', '2026-10-08', '2026-10-09'],
  ] as const)
    t = step(t, {
      type: 'task.edit',
      taskId: by[title]!,
      changes: { inputStart, inputFinish },
    });
  for (const [from, to] of [
    ['A', 'B'],
    ['C', 'D'],
  ] as const)
    t = step(t, {
      type: 'dependency.create',
      predecessorId: by[from]!,
      successorId: by[to]!,
    });
  return t;
}
function assertFloats(
  tree: ProjectTreeV2,
  expected: [string, number, number][],
) {
  if (tree.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  const by = ids(tree),
    s = tree.schedule;
  expect(expected.map(([name]) => by[name])).not.toContain(undefined);
  for (const [name, projectFloat, constraintFloat] of expected)
    expect(s.tasks[by[name]!]).toMatchObject({ projectFloat, constraintFloat });
}
it('P04/P05 changes critical branch, retries exact outcome, undoes once and survives restart', () => {
  const before = p04(),
    by = ids(before);
  assertFloats(before, [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 0, 0],
    ['D', 0, 0],
  ]);
  const envelope = {
    contractVersion: 2 as const,
    expectedRevision: before.project.revision,
    operationId: randomUUID(),
    command: {
      type: 'task.edit' as const,
      taskId: by.B!,
      changes: { inputFinish: '2026-10-11' },
    },
  };
  const after = repository.applyCommand(before.project.id, envelope, session);
  expect(after.project.revision).toBe(before.project.revision + 1);
  assertFloats(after, [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 2, 0],
    ['D', 2, 2],
  ]);
  expect(after.schedule.criticalTaskIds).toEqual([by.A!, by.B!].sort());
  const ab = after.dependencies.find(
    (e) => e.predecessorId === by.A && e.successorId === by.B,
  )!.id;
  expect(after.schedule.criticalDependencyIds).toEqual([ab]);
  const undone = step(after, { type: 'undo' });
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  const latestRevision = undone.project.revision;
  db.close();
  db = openDatabase(path);
  repository = new Repository(db);
  expect(repository.getTree(before.project.id, session).schedule).toEqual(
    before.schedule,
  );
  const spy = vi.spyOn(scheduling, 'calculateSchedule');
  const replay = repository.applyCommand(before.project.id, envelope, session);
  expect(replay).toEqual(after);
  expect(replay.project.revision).toBe(before.project.revision + 1);
  expect(spy).not.toHaveBeenCalled();
  expect(repository.getTree(before.project.id, session).project.revision).toBe(
    latestRevision,
  );
});
it('live calendar change preserves sources, recalculates P10 once and undoes once', () => {
  const project = repository.createProject('Synthetic calendar CPM');
  let before = repository.getTree(project.id, session);
  before = step(before, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays' },
  });
  for (const title of ['A', 'B'])
    before = step(before, { type: 'task.create', title, parentId: null });
  const by = ids(before);
  before = step(before, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { inputStart: '2026-10-09', inputFinish: '2026-10-09' },
  });
  before = step(before, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { inputStart: '2026-10-12', inputFinish: '2026-10-13' },
  });
  before = step(before, {
    type: 'dependency.create',
    predecessorId: by.A!,
    successorId: by.B!,
  });
  const ab = before.dependencies[0]!.id;
  assertFloats(before, [
    ['A', 0, 0],
    ['B', 0, 0],
  ]);
  expect(before.schedule.criticalTaskIds).toEqual([by.A!, by.B!].sort());
  expect(before.schedule.criticalDependencyIds).toEqual([ab]);
  const sources = before.tasks.map((t) => ({
    id: t.id,
    inputStart: t.inputStart,
    inputFinish: t.inputFinish,
    durationDays: t.durationDays,
    status: t.status,
  }));
  const after = step(before, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  expect(after.project.revision).toBe(before.project.revision + 1);
  expect(after.project.calendarType).toBe('all-days');
  expect(
    after.tasks.map((t) => ({
      id: t.id,
      inputStart: t.inputStart,
      inputFinish: t.inputFinish,
      durationDays: t.durationDays,
      status: t.status,
    })),
  ).toEqual(sources);
  assertFloats(after, [
    ['A', 2, 2],
    ['B', 0, 0],
  ]);
  expect(after.schedule.criticalTaskIds).toEqual([by.B!]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  const undone = step(after, { type: 'undo' });
  expect(undone.project.revision).toBe(after.project.revision + 1);
  expect(undone.project.calendarType).toBe('weekdays');
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  assertFloats(undone, [
    ['A', 0, 0],
    ['B', 0, 0],
  ]);
});

it('frozen pending target reply survives CPM wiring and restart unchanged', () => {
  const before = p04(),
    by = ids(before),
    operationId = randomUUID();
  const envelope = {
    contractVersion: 2 as const,
    expectedRevision: before.project.revision,
    operationId,
    command: {
      type: 'task.edit' as const,
      taskId: by.A!,
      changes: { title: 'A saved' },
    },
  };
  const response = repository.applyCommand(
    before.project.id,
    envelope,
    session,
  );
  // Synthetic existing Task5 operation: literal pending projection, exact stored JSON.
  const real = Object.fromEntries(
    response.tasks.map((t) => [
      t.id,
      {
        startDate: t.inputStart,
        finishDate: t.inputFinish,
        calendarSpanDays:
          t.title === 'A saved'
            ? 2
            : t.title === 'B'
              ? 3
              : t.title === 'C'
                ? 3
                : 2,
      },
    ]),
  );
  const frozen = projectTreeV2Schema.parse({
    ...response,
    schedule: {
      analysisStatus: 'pending-policy',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 4, totalLeafCount: 4 },
      tasks: real,
      summaries: {},
      display: {},
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [],
    },
  });
  const frozenText = JSON.stringify(frozen);
  const digest = createHash('sha256').update(frozenText).digest('hex');
  db.prepare(
    'UPDATE operations SET response=?,responseSha256=? WHERE operationId=?',
  ).run(frozenText, digest, operationId);
  const changed = step(response, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { inputFinish: '2026-10-11' },
  });
  db.close();
  db = openDatabase(path);
  repository = new Repository(db);
  const spy = vi.spyOn(scheduling, 'calculateSchedule');
  const replay = repository.applyCommand(before.project.id, envelope, session);
  expect(replay).toEqual(frozen);
  expect(replay.schedule.analysisStatus).toBe('pending-policy');
  expect(spy).not.toHaveBeenCalled();
  const stored = db
    .prepare('SELECT response FROM operations WHERE operationId=?')
    .get(operationId) as { response: string };
  expect(stored.response).toBe(frozenText);
  expect(repository.getTree(before.project.id, session).project.revision).toBe(
    changed.project.revision,
  );
});

function rawState(projectId: string) {
  return {
    counters: db
      .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
      .all(),
    project: db.prepare('SELECT * FROM projects WHERE id=?').get(projectId),
    tasks: db
      .prepare('SELECT * FROM tasks WHERE projectId=? ORDER BY id')
      .all(projectId),
    dependencies: db
      .prepare('SELECT * FROM dependencies WHERE projectId=? ORDER BY id')
      .all(projectId),
    operations: db
      .prepare(
        'SELECT * FROM operations WHERE projectId=? ORDER BY operationId',
      )
      .all(projectId),
    undo: db
      .prepare(
        'SELECT * FROM undo_snapshots WHERE projectId=? ORDER BY sequence',
      )
      .all(projectId),
    provenance: db
      .prepare(
        'SELECT p.taskId,p.reason FROM task_schedule_provenance p JOIN tasks t ON t.id=p.taskId WHERE t.projectId=? ORDER BY p.taskId',
      )
      .all(projectId),
  };
}
it.each([
  ['pending', 'before-save'],
  ['infeasible-with-partial', 'before-save'],
  ['pending', 'after-save'],
  ['infeasible-with-partial', 'after-save'],
] as const)('rolls back invalid fresh %s outcome at %s', (kind, stage) => {
  const before = p04(),
    by = ids(before),
    state = rawState(before.project.id);
  const injected =
    kind === 'pending'
      ? {
          analysisStatus: 'pending-policy',
          feasibility: 'feasible',
          coverage: { knownLeafCount: 0, totalLeafCount: 0 },
          tasks: {},
          summaries: {},
          display: {},
          criticalTaskIds: [],
          criticalDependencyIds: [],
          diagnostics: [],
        }
      : {
          analysisStatus: 'infeasible',
          feasibility: 'infeasible',
          coverage: { knownLeafCount: 0, totalLeafCount: 0 },
          tasks: {},
          summaries: {},
          display: {},
          horizonFinishDate: null,
          criticalTaskIds: [],
          criticalDependencyIds: [],
          diagnostics: [],
          partialAnalysis: {
            labelKey: 'scheduling.PARTIAL_ANALYSIS',
            knownHorizonFinishDate: '2026-10-11',
            coverage: { analyzedLeafCount: 0, blockedLeafCount: 0 },
            tasks: {},
            partialCriticalTaskIds: [],
            partialCriticalDependencyIds: [],
            partialCriticalSummaryIds: [],
          },
        };
  const calculate = scheduling.calculateSchedule;
  const spy = vi.spyOn(scheduling, 'calculateSchedule');
  if (stage === 'after-save') spy.mockImplementationOnce(calculate);
  spy.mockReturnValueOnce(
    injected as unknown as ReturnType<typeof scheduling.calculateSchedule>,
  );
  expect(() =>
    step(before, {
      type: 'task.edit',
      taskId: by.A!,
      changes: {
        title: 'Rejected synthetic edit',
        inputFinish: '2026-10-07',
      },
    }),
  ).toThrow('Invalid internal schedule response');
  spy.mockRestore();
  expect(rawState(before.project.id)).toEqual(state);
  expect(repository.getTree(before.project.id, session)).toEqual(before);
});
it('done keeps structural float and only explicit return permits source edit with undo', () => {
  const project = repository.createProject('Synthetic done CPM');
  let t = repository.getTree(project.id, session);
  t = step(t, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  for (const title of ['A', 'B', 'C'])
    t = step(t, { type: 'task.create', title, parentId: null });
  const by = ids(t);
  for (const [name, inputStart, inputFinish] of [
    ['A', '2026-10-05', '2026-10-06'],
    ['B', '2026-10-10', '2026-10-10'],
    ['C', '2026-10-05', '2026-10-14'],
  ] as const)
    t = step(t, {
      type: 'task.edit',
      taskId: by[name]!,
      changes: { inputStart, inputFinish },
    });
  t = step(t, {
    type: 'dependency.create',
    predecessorId: by.A!,
    successorId: by.B!,
  });
  const done = step(t, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { status: 'done' },
  });
  assertFloats(done, [
    ['A', 7, 3],
    ['B', 4, 0],
    ['C', 0, 0],
  ]);
  const state = rawState(project.id);
  expect(() =>
    step(done, {
      type: 'task.edit',
      taskId: by.B!,
      changes: { inputFinish: '2026-10-11' },
    }),
  ).toThrowError(expect.objectContaining({ code: 'DONE_PLAN_LOCKED' }));
  expect(rawState(project.id)).toEqual(state);
  const working = step(done, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { status: 'doing', inputFinish: '2026-10-11' },
  });
  expect(working.project.revision).toBe(done.project.revision + 1);
  assertFloats(working, [
    ['A', 6, 3],
    ['B', 3, 3],
    ['C', 0, 0],
  ]);
  const undone = step(working, { type: 'undo' });
  expect(undone.tasks).toEqual(done.tasks);
  expect(undone.schedule).toEqual(done.schedule);
});

function provenance(projectId: string) {
  return db
    .prepare(
      'SELECT p.taskId,p.reason FROM task_schedule_provenance p JOIN tasks t ON t.id=p.taskId WHERE t.projectId=? ORDER BY p.taskId',
    )
    .all(projectId);
}
function c17Stored() {
  const project = repository.createProject('Synthetic C17 provenance');
  let tree = repository.getTree(project.id, session);
  tree = step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  tree = step(tree, { type: 'task.create', title: 'P', parentId: null });
  const p = tree.tasks.find((t) => t.title === 'P')!.id;
  for (const [title, parentId] of [
    ['D', p],
    ['K', p],
    ['C', null],
  ] as const)
    tree = step(tree, { type: 'task.create', title, parentId });
  const by = ids(tree);
  tree = step(tree, {
    type: 'task.edit',
    taskId: by.D!,
    changes: {
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
      status: 'done',
    },
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: by.K!,
    changes: {
      inputStart: '2026-10-09',
      inputFinish: '2026-10-10',
    },
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: by.C!,
    changes: {
      inputStart: '2026-10-05',
      inputFinish: '2026-10-08',
    },
  });
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: by.D!,
    successorId: by.K!,
  });
  expect(tree.schedule.analysisStatus).toBe('ready'); // ordinary explicit done control
  db.prepare(
    "INSERT INTO task_schedule_provenance(taskId,reason) VALUES (?, 'legacy-interval-unavailable')",
  ).run(by.D!);
  return { tree: repository.getTree(project.id, session), by };
}
function assertC17Unknown(tree: ProjectTreeV2, by: Record<string, string>) {
  expect(tree.schedule.analysisStatus).toBe('incomplete');
  if (tree.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  expect(tree.schedule.coverage).toEqual({
    knownLeafCount: 2,
    totalLeafCount: 3,
  });
  expect(tree.schedule.tasks[by.D!]).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    projectFloat: null,
    constraintFloat: null,
  });
  expect(tree.schedule.summaries[by.P!]).toEqual({
    startDate: null,
    finishDate: null,
    calendarSpanDays: null,
    knownLeafCount: 1,
    totalLeafCount: 2,
    containsCritical: null,
  });
  expect(tree.schedule.partialAnalysis).toEqual({
    labelKey: 'scheduling.PARTIAL_ANALYSIS',
    knownHorizonFinishDate: '2026-10-10',
    coverage: { analyzedLeafCount: 1, blockedLeafCount: 2 },
    tasks: { [by.C!]: { knownHorizonFloat: 2 } },
    partialCriticalTaskIds: [],
    partialCriticalDependencyIds: [],
    partialCriticalSummaryIds: [],
  });
  expect(tree.schedule.diagnostics).toEqual([
    {
      code: 'LEGACY_INTERVAL_UNAVAILABLE',
      taskIds: [by.D!],
      dependencyIds: [],
      messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
    },
  ]);
  expect(tree.schedule.criticalTaskIds).toEqual([]);
  expect(tree.schedule.criticalDependencyIds).toEqual([]);
  expect(provenance(tree.project.id)).toEqual([
    { taskId: by.D!, reason: 'legacy-interval-unavailable' },
  ]);
  expect(tree).not.toHaveProperty('legacyIntervalUnavailable');
  expect(tree).not.toHaveProperty('unavailableTaskIds');
  expect(tree.tasks.find((t) => t.id === by.D!)).toMatchObject({
    inputStart: '2026-10-05',
    inputFinish: '2026-10-07',
    durationDays: 3,
  });
}
it('passes private provenance into every current pure calculation without public leakage', () => {
  const { tree: before, by } = c17Stored(),
    state = rawState(before.project.id);
  const spy = vi.spyOn(scheduling, 'calculateSchedule');
  const tree = repository.getTree(before.project.id, session);
  assertC17Unknown(tree, by);
  expect(repository.getSchedule(before.project.id).schedule).toEqual(
    tree.schedule,
  );
  const edited = step(tree, {
    type: 'task.edit',
    taskId: by.D!,
    changes: { description: 'Synthetic detail' },
  });
  expect(edited.project.revision).toBe(tree.project.revision + 1);
  assertC17Unknown(edited, by);
  expect(spy).toHaveBeenCalled();
  for (const [input] of spy.mock.calls) {
    expect(input.unavailableTaskIds).toEqual([by.D!]);
    expect(input.tasks.find((t) => t.id === by.D!)).toMatchObject({
      inputStart: '2026-10-05',
      inputFinish: '2026-10-07',
      durationDays: 3,
      status: 'done',
    });
  }
  expect(rawState(before.project.id).operations).toHaveLength(
    state.operations.length + 1,
  );
  spy.mockRestore();
  db.close();
  db = openDatabase(path);
  repository = new Repository(db);
  const reopened = repository.getTree(before.project.id, session);
  expect(reopened.schedule).toEqual(edited.schedule);
  assertC17Unknown(reopened, by);
});
it('validated equal source acknowledgement requires original done return and undo/reopen restores unknown', () => {
  const { tree: before, by } = c17Stored(),
    state = rawState(before.project.id);
  expect(() =>
    step(before, {
      type: 'task.edit',
      taskId: by.D!,
      changes: { inputStart: '2026-10-05' },
    }),
  ).toThrow();
  expect(rawState(before.project.id)).toEqual(state);
  expect(() =>
    step(before, {
      type: 'task.edit',
      taskId: by.D!,
      changes: {
        status: 'doing',
        title: 'Rejected invalid source',
        durationDays: 2,
      },
    }),
  ).toThrow();
  expect(rawState(before.project.id)).toEqual(state);
  const acknowledged = step(before, {
    type: 'task.edit',
    taskId: by.D!,
    changes: {
      status: 'doing',
      inputStart: '2026-10-05',
    },
  });
  expect(acknowledged.project.revision).toBe(before.project.revision + 1);
  expect(provenance(before.project.id)).toEqual([]);
  expect(acknowledged.tasks.find((t) => t.id === by.D!)).toMatchObject({
    status: 'doing',
    inputStart: '2026-10-05',
    inputFinish: '2026-10-07',
    durationDays: 3,
  });
  if (acknowledged.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(acknowledged.schedule.tasks[by.D!]).toMatchObject({
    projectFloat: 1,
    constraintFloat: 1,
  });
  expect(acknowledged.schedule.criticalTaskIds).toEqual([by.K!]);
  expect(acknowledged.schedule.criticalDependencyIds).toEqual([]);
  const row = db
    .prepare(
      'SELECT beforeSnapshot FROM undo_snapshots WHERE projectId=? ORDER BY sequence DESC LIMIT 1',
    )
    .get(before.project.id) as { beforeSnapshot: string };
  expect(
    privateSnapshotV2Schema.parse(JSON.parse(row.beforeSnapshot))
      .legacyIntervalUnavailable,
  ).toEqual([by.D!]);
  const undone = step(acknowledged, { type: 'undo' });
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  assertC17Unknown(undone, by);
  db.close();
  db = openDatabase(path);
  repository = new Repository(db);
  assertC17Unknown(repository.getTree(before.project.id, session), by);
});
it('status-only calendar and edge commands retain marker and source bytes', () => {
  const { tree: before, by } = c17Stored();
  const source = before.tasks.find((t) => t.id === by.D!)!;
  const status = step(before, {
    type: 'task.edit',
    taskId: by.D!,
    changes: { status: 'doing' },
  });
  assertC17Unknown(status, by);
  const calendar = step(status, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays' },
  });
  expect(provenance(before.project.id)).toEqual([
    { taskId: by.D!, reason: 'legacy-interval-unavailable' },
  ]);
  expect(calendar.tasks.find((t) => t.id === by.D!)).toMatchObject({
    inputStart: source.inputStart,
    inputFinish: source.inputFinish,
    durationDays: source.durationDays,
    status: 'doing',
  });
  expect(calendar.schedule.analysisStatus).toBe('incomplete');
  const deleted = step(calendar, {
    type: 'dependency.delete',
    dependencyId: calendar.dependencies[0]!.id,
  });
  const created = step(deleted, {
    type: 'dependency.create',
    predecessorId: by.D!,
    successorId: by.K!,
  });
  expect(provenance(before.project.id)).toEqual([
    { taskId: by.D!, reason: 'legacy-interval-unavailable' },
  ]);
  expect(
    created.schedule.diagnostics.some(
      (d) => d.code === 'LEGACY_INTERVAL_UNAVAILABLE',
    ),
  ).toBe(true);
  const weekdayUndo = step(created, { type: 'undo' });
  expect(provenance(before.project.id)).toEqual([
    { taskId: by.D!, reason: 'legacy-interval-unavailable' },
  ]);
  expect(weekdayUndo.tasks).toEqual(deleted.tasks);
});
it('marked raw FS conflict commits once, suppresses analysis and undo restores unknown partial', () => {
  const { tree: before, by } = c17Stored(),
    state = rawState(before.project.id);
  const after = step(before, {
    type: 'task.edit',
    taskId: by.K!,
    changes: { inputStart: '2026-10-07' },
  });
  expect(after.project.revision).toBe(before.project.revision + 1);
  expect(rawState(before.project.id).operations).toHaveLength(
    state.operations.length + 1,
  );
  expect(rawState(before.project.id).undo).toHaveLength(state.undo.length + 1);
  if (after.schedule.analysisStatus !== 'infeasible')
    throw new Error('Expected infeasible');
  expect(after.schedule.partialAnalysis).toBeNull();
  expect(after.schedule.criticalTaskIds).toEqual([]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  expect(after.schedule.diagnostics).toEqual([
    {
      code: 'EXPLICIT_PRECEDENCE_CONFLICT',
      taskIds: [by.D!, by.K!].sort(),
      dependencyIds: [before.dependencies[0]!.id],
      messageKey: 'scheduling.EXPLICIT_PRECEDENCE_CONFLICT',
    },
    {
      code: 'LEGACY_INTERVAL_UNAVAILABLE',
      taskIds: [by.D!],
      dependencyIds: [],
      messageKey: 'scheduling.LEGACY_INTERVAL_UNAVAILABLE',
    },
  ]);
  expect(provenance(before.project.id)).toEqual([
    { taskId: by.D!, reason: 'legacy-interval-unavailable' },
  ]);
  expect(after.tasks.find((t) => t.id === by.D!)).toEqual(
    before.tasks.find((t) => t.id === by.D!),
  );
  const undone = step(after, { type: 'undo' });
  expect(undone.schedule).toEqual(before.schedule);
  assertC17Unknown(undone, by);
});
it('preserveWork transfers marker to original work child and undo restores original marked leaf', () => {
  const { tree: before, by } = c17Stored(),
    original = before.tasks.find((t) => t.id === by.D!)!;
  const parent = step(before, {
    type: 'task.create',
    title: 'New child',
    parentId: by.D!,
    preserveWork: true,
  });
  const work = parent.tasks.find(
    (t) =>
      t.parentId === by.D &&
      t.status === 'done' &&
      t.inputStart === '2026-10-05',
  )!;
  expect(work).toBeDefined();
  expect(work).toMatchObject({
    inputStart: original.inputStart,
    inputFinish: original.inputFinish,
    durationDays: original.durationDays,
    status: 'done',
  });
  expect(provenance(before.project.id)).toEqual([
    { taskId: work.id, reason: 'legacy-interval-unavailable' },
  ]);
  expect(
    parent.dependencies.find((e) => e.id === before.dependencies[0]!.id),
  ).toMatchObject({ predecessorId: work.id, successorId: by.K! });
  expect(parent.schedule.tasks[work.id]).toMatchObject({
    startDate: null,
    finishDate: null,
  });
  const undone = step(parent, { type: 'undo' });
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  assertC17Unknown(undone, by);
});
it('private schema rejects duplicate foreign or cross-project markers and public schemas reject provenance', () => {
  const { tree, by } = c17Stored();
  const value = {
    project: tree.project,
    tasks: tree.tasks,
    dependencies: tree.dependencies,
    legacyIntervalUnavailable: [by.D!],
  };
  expect(privateSnapshotV2Schema.parse(value)).toEqual(value);
  expect(
    privateSnapshotV2Schema.safeParse({
      ...value,
      legacyIntervalUnavailable: [by.D!, by.D!],
    }).success,
  ).toBe(false);
  expect(
    privateSnapshotV2Schema.safeParse({
      ...value,
      legacyIntervalUnavailable: ['99999999-9999-4999-8999-999999999999'],
    }).success,
  ).toBe(false);
  expect(
    privateSnapshotV2Schema.safeParse({
      ...value,
      tasks: value.tasks.map((t) =>
        t.id === by.D
          ? { ...t, projectId: '99999999-9999-4999-8999-999999999999' }
          : t,
      ),
    }).success,
  ).toBe(false);
  expect(snapshotV2Schema.safeParse(value).success).toBe(false);
  expect(
    projectTreeV2Schema.safeParse({
      ...tree,
      legacyIntervalUnavailable: [by.D!],
    }).success,
  ).toBe(false);
  expect(
    taskV2Schema.safeParse({
      ...tree.tasks.find((t) => t.id === by.D),
      unavailable: true,
    }).success,
  ).toBe(false);
  expect(
    commandV2Schema.safeParse({
      type: 'task.edit',
      taskId: by.D!,
      changes: { unavailableTaskIds: [] },
    }).success,
  ).toBe(false);
});

it('frozen legacy revision9 remains pending after live revision10 and restart without solver', () => {
  db.close();
  const legacyPath = join(directory, 'legacy-synthetic.sqlite');
  db = new Database(legacyPath);
  db.pragma('foreign_keys=ON');
  db.exec('CREATE TABLE migrations(version INTEGER PRIMARY KEY) STRICT');
  for (const [file, version] of [
    ['001-initial.sql', 1],
    ['002-scheduling.sql', 2],
  ] as const) {
    db.exec(readFileSync('migrations/' + file, 'utf8'));
    db.prepare('INSERT INTO migrations(version) VALUES (?)').run(version);
  }
  const projectId = '11111111-1111-4111-8111-111111111111';
  const taskId = '22222222-2222-4222-8222-222222222222';
  const operationId = '33333333-3333-4333-8333-333333333333';
  const timestamp = '2026-10-07T00:00:00.000Z';
  const legacyProject = {
    id: projectId,
    title: 'Synthetic legacy CPM',
    revision: 9,
    startDate: '2026-10-05',
    calendarType: 'all-days',
    timezone: 'UTC',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const legacyTask = {
    id: taskId,
    projectId,
    parentId: null,
    title: 'Synthetic archived A',
    description: '',
    sortOrder: 0,
    status: 'todo',
    inputStart: null,
    inputFinish: '2026-10-06',
    createdAt: timestamp,
    updatedAt: timestamp,
    planMode: 'unscheduled',
    durationDays: null,
    notBefore: null,
    deadline: '2026-10-20',
    completedStart: null,
    completedFinish: null,
    completedStartIndex: null,
    completedFinishIndex: null,
  };
  for (const [table, row] of [
    ['projects', legacyProject],
    ['tasks', legacyTask],
  ] as const) {
    const fields = Object.keys(row);
    db.prepare(
      'INSERT INTO ' +
        table +
        ' (' +
        fields.join(',') +
        ') VALUES (' +
        fields.map(() => '?').join(',') +
        ')',
    ).run(...Object.values(row));
  }
  const originalBody = {
    expectedRevision: 8,
    operationId,
    command: {
      type: 'task.plan',
      taskId,
      plan: {
        mode: 'unscheduled',
        inputFinish: '2026-10-06',
        deadline: '2026-10-20',
      },
    },
  };
  const originalPayload = canonical(originalBody);
  const originalResponse = JSON.stringify({
    project: legacyProject,
    tasks: [legacyTask],
    dependencies: [],
    canUndo: false,
    schedule: {
      feasibility: 'feasible',
      originDate: '2026-10-05',
      projectFinishIndex: null,
      coverage: { knownLeafCount: 0, totalLeafCount: 1 },
      tasks: {
        [taskId]: {
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
  });
  db.prepare(
    'INSERT INTO operations(operationId,projectId,sessionId,payload,response) VALUES (?,?,?,?,?)',
  ).run(operationId, projectId, session, originalPayload, originalResponse);
  db.transaction(() => {
    prepareOptionalMigration(
      db,
      readFileSync('migrations/003-optional-scheduling.sql', 'utf8'),
      new Map(),
    );
    db.prepare('INSERT INTO migrations(version) VALUES (3)').run();
  }).immediate();
  const archived = db
    .prepare(
      'SELECT kind,recordKey,originalText,sha256 FROM scheduling_migration_archive WHERE projectId=? ORDER BY kind,recordKey',
    )
    .all(projectId) as {
    kind: string;
    recordKey: string;
    originalText: string;
    sha256: string;
  }[];
  expect(
    archived.find((x) => x.kind === 'operation-payload')?.originalText,
  ).toBe(originalPayload);
  expect(
    archived.find((x) => x.kind === 'operation-response')?.originalText,
  ).toBe(originalResponse);
  // Literal already accepted Task5 outcome; emulates persisted pre-CPM frozen reply.
  const frozen = projectTreeV2Schema.parse({
    contractVersion: 2,
    project: {
      id: projectId,
      title: 'Synthetic legacy CPM',
      revision: 9,
      calendarType: 'all-days',
      timezone: 'UTC',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    tasks: [
      {
        id: taskId,
        projectId,
        parentId: null,
        title: 'Synthetic archived A',
        description: '',
        sortOrder: 0,
        status: 'todo',
        inputStart: null,
        inputFinish: '2026-10-06',
        durationDays: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    dependencies: [],
    canUndo: false,
    schedule: {
      analysisStatus: 'pending-policy',
      feasibility: 'feasible',
      coverage: { knownLeafCount: 0, totalLeafCount: 1 },
      tasks: {
        [taskId]: { startDate: null, finishDate: null, calendarSpanDays: null },
      },
      summaries: {},
      display: {},
      criticalTaskIds: [],
      criticalDependencyIds: [],
      diagnostics: [],
    },
  });
  const frozenText = JSON.stringify(frozen),
    digest = createHash('sha256').update(frozenText).digest('hex');
  db.prepare(
    'UPDATE operations SET response=?,responseContractVersion=2,responseSha256=? WHERE operationId=?',
  ).run(frozenText, digest, operationId);
  db.close();
  db = openDatabase(legacyPath);
  repository = new Repository(db);
  const current = repository.getTree(projectId, session);
  const latest = step(current, {
    type: 'task.edit',
    taskId,
    changes: {
      title: 'Synthetic current A',
      inputStart: '2026-10-05',
      inputFinish: '2026-10-06',
    },
  });
  expect(latest.project.revision).toBe(10);
  expect(latest.schedule.analysisStatus).toBe('ready');
  db.close();
  db = openDatabase(legacyPath);
  repository = new Repository(db);
  const state = rawState(projectId),
    spy = vi.spyOn(scheduling, 'calculateSchedule');
  for (const [pid, sid, body] of [
    [projectId, 'synthetic-other-session', originalBody],
    ['99999999-9999-4999-8999-999999999999', session, originalBody],
    [projectId, session, { ...originalBody, expectedRevision: 7 }],
  ] as const) {
    expect(() => repository.replayLegacy(pid, body, sid)).toThrowError(
      expect.objectContaining({ code: 'OPERATION_REUSED' }),
    );
    expect(rawState(projectId)).toEqual(state);
    expect(spy).not.toHaveBeenCalled();
  }
  const replay = repository.replayLegacy(projectId, originalBody, session);
  expect(replay).toEqual(frozen);
  expect(replay.project.revision).toBe(9);
  expect(replay.schedule.analysisStatus).toBe('pending-policy');
  expect(spy).not.toHaveBeenCalled();
  expect(rawState(projectId)).toEqual(state);
  expect(
    db
      .prepare('SELECT payload FROM operations WHERE operationId=?')
      .get(operationId),
  ).toEqual({ payload: originalPayload });
  expect(
    db
      .prepare(
        'SELECT kind,recordKey,originalText,sha256 FROM scheduling_migration_archive WHERE projectId=? ORDER BY kind,recordKey',
      )
      .all(projectId),
  ).toEqual(archived);
  db.prepare('UPDATE operations SET responseSha256=? WHERE operationId=?').run(
    '0'.repeat(64),
    operationId,
  );
  const corruptedState = rawState(projectId);
  expect(() =>
    repository.replayLegacy(projectId, originalBody, session),
  ).toThrow(/Invalid/);
  expect(spy).not.toHaveBeenCalled();
  expect(rawState(projectId)).toEqual(corruptedState);
  spy.mockRestore();
});

it.each(['pending', 'malformed'] as const)(
  'current repository reads reject %s without changing stored state',
  (kind) => {
    const before = p04(),
      state = rawState(before.project.id);
    const injected =
      kind === 'pending'
        ? {
            analysisStatus: 'pending-policy',
            feasibility: 'feasible',
            coverage: { knownLeafCount: 0, totalLeafCount: 0 },
            tasks: {},
            summaries: {},
            display: {},
            criticalTaskIds: [],
            criticalDependencyIds: [],
            diagnostics: [],
          }
        : {
            analysisStatus: 'ready',
            feasibility: 'feasible',
            coverage: { knownLeafCount: 4, totalLeafCount: 4 },
            tasks: {},
            summaries: {},
            display: {},
            criticalTaskIds: [],
            criticalDependencyIds: [],
            diagnostics: [],
            horizonFinishDate: null,
            partialAnalysis: null,
          };
    const spy = vi.spyOn(scheduling, 'calculateSchedule');
    for (const read of [
      () => repository.getTree(before.project.id, session),
      () => repository.getSchedule(before.project.id),
    ]) {
      spy.mockReturnValueOnce(
        injected as unknown as ReturnType<typeof scheduling.calculateSchedule>,
      );
      expect(read).toThrow('Invalid internal schedule response');
      expect(rawState(before.project.id)).toEqual(state);
    }
    spy.mockRestore();
    expect(repository.getTree(before.project.id, session)).toEqual(before);
  },
);
