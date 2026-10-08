import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import type { Command, ProjectTree, Task } from '../src/shared/contracts.js';
import * as cascade from '../src/domain/fs-cascade.js';
import * as scheduling from '../src/domain/scheduling.js';
import { rawSyntheticCountsAndRevision } from './helpers/optional-api-fixtures.js';

let directory: string,
  path: string,
  db: ReturnType<typeof openDatabase>,
  repository: Repository;
let clock = Date.parse('2026-10-05T00:00:00Z');
const session = 'synthetic-cascade-session';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'leaf-fs-cascade-'));
  path = join(directory, 'synthetic.sqlite');
  db = openDatabase(path);
  clock = Date.parse('2026-10-05T00:00:00Z');
  repository = new Repository(db, () => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
  rmSync(directory, { recursive: true, force: true });
});
function step(tree: ProjectTree, command: Command) {
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
function fresh() {
  let tree = repository.getTree(
    repository.createProject('Synthetic cascade').id,
    session,
  );
  tree = step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  return tree;
}
function task(tree: ProjectTree, title: string): Task {
  return tree.tasks.find((item) => item.title === title)!;
}
function create(
  tree: ProjectTree,
  title: string,
  inputStart: string | null,
  inputFinish: string | null,
  predecessorIds?: string[],
  parentId: string | null = null,
) {
  return step(tree, {
    type: 'task.create',
    title,
    parentId,
    inputStart,
    inputFinish,
    ...(predecessorIds ? { predecessorIds } : {}),
  });
}
function rows() {
  return [
    'projects',
    'tasks',
    'dependencies',
    'task_schedule_provenance',
    'undo_snapshots',
    'operations',
  ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}
function mark(id: string) {
  db.prepare(
    "INSERT INTO task_schedule_provenance(taskId,reason) VALUES (?, 'legacy-interval-unavailable')",
  ).run(id);
}
function historicalEdge(tree: ProjectTree, from: string, to: string) {
  db.prepare(
    'INSERT INTO dependencies(id,projectId,predecessorId,successorId) VALUES (?,?,?,?)',
  ).run(randomUUID(), tree.project.id, task(tree, from).id, task(tree, to).id);
  return repository.getTree(tree.project.id, session);
}

it('create with predecessors cascades once without DTO leakage, and undoes one complete command', () => {
  const before = create(fresh(), 'A', '2026-10-05', '2026-10-07');
  const counts = rawSyntheticCountsAndRevision(db, before.project.id);
  const after = create(before, 'B', '2026-10-07', '2026-10-08', [
    task(before, 'A').id,
  ]);
  expect(task(after, 'B')).toMatchObject({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: null,
  });
  expect(task(after, 'B')).not.toHaveProperty('predecessorIds');
  expect(after.dependencies).toHaveLength(1);
  const changed = rawSyntheticCountsAndRevision(db, before.project.id);
  expect(changed.revision).toBe(counts.revision + 1);
  expect(changed.counts).toEqual(
    counts.counts.map(
      (count, index) => count + ([1, 2, 3, 4].includes(index) ? 1 : 0),
    ),
  );
  const undo = step(after, { type: 'undo' });
  expect(undo.tasks).toEqual(before.tasks);
  expect(undo.dependencies).toEqual(before.dependencies);
  expect(undo.schedule).toEqual(before.schedule);
});
it('replaces only incoming endpoints, retains stable edge IDs, omission preserves and empty removes without pull', () => {
  let tree = create(
    create(
      create(create(fresh(), 'A', '2026-10-05', '2026-10-07'), 'X', null, null),
      'B',
      '2026-10-07',
      '2026-10-08',
    ),
    'C',
    null,
    null,
  );
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: task(tree, 'B').id,
    successorId: task(tree, 'C').id,
  });
  const outgoing = tree.dependencies[0];
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'B').id,
    changes: { predecessorIds: [task(tree, 'A').id] },
  });
  const incoming = tree.dependencies.find(
    (edge) => edge.predecessorId === task(tree, 'A').id,
  )!;
  expect(task(tree, 'B')).toMatchObject({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: null,
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'B').id,
    changes: { predecessorIds: [task(tree, 'X').id, task(tree, 'A').id] },
  });
  expect(tree.dependencies).toContainEqual(incoming);
  expect(tree.dependencies).toContainEqual(outgoing);
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'B').id,
    changes: { title: 'B renamed' },
  });
  expect(tree.dependencies).toHaveLength(3);
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'B renamed').id,
    changes: { predecessorIds: [] },
  });
  expect(tree.dependencies).toEqual([outgoing]);
  expect(task(tree, 'B renamed').inputStart).toBe('2026-10-08');
});
it.each([
  'self',
  'duplicate',
  'foreign',
  'summary',
  'cycle',
  'done',
  'direct',
  'overflow',
] as const)('atomic %s rejection restores every synthetic row', (kind) => {
  let tree = create(
    create(
      create(fresh(), 'A', '2026-10-05', '2026-10-07'),
      'B',
      '2026-10-07',
      '2026-10-08',
    ),
    'Summary',
    null,
    null,
  );
  tree = create(tree, 'Child', null, null, undefined, task(tree, 'Summary').id);
  const a = task(tree, 'A').id,
    b = task(tree, 'B').id;
  if (kind === 'cycle')
    tree = step(tree, {
      type: 'dependency.create',
      predecessorId: b,
      successorId: a,
    });
  if (kind === 'done')
    tree = step(tree, {
      type: 'task.edit',
      taskId: b,
      changes: { status: 'done' },
    });
  if (kind === 'direct') {
    tree = step(tree, {
      type: 'dependency.create',
      predecessorId: a,
      successorId: b,
    });
  }
  if (kind === 'overflow')
    tree = step(tree, {
      type: 'task.edit',
      taskId: a,
      changes: { inputStart: null, inputFinish: '9999-12-31' },
    });
  const predecessors =
    kind === 'self'
      ? [b]
      : kind === 'duplicate'
        ? [a, a]
        : kind === 'foreign'
          ? [randomUUID()]
          : kind === 'summary'
            ? [task(tree, 'Summary').id]
            : [a];
  const command: Command =
    kind === 'direct'
      ? {
          type: 'task.edit',
          taskId: b,
          changes: {
            inputStart: '2026-10-07',
            inputFinish: '2026-10-08',
            title: 'Synthetic changed',
          },
        }
      : {
          type: 'task.edit',
          taskId: b,
          changes: { predecessorIds: predecessors, title: 'Synthetic changed' },
        };
  const before = rows();
  expect(() => step(tree, command)).toThrow();
  expect(rows()).toEqual(before);
});
it('preserveWork converts source, edges and marker first; selecting converted parent rejects atomically', () => {
  let tree = create(
    create(fresh(), 'P', '2026-10-05', '2026-10-07'),
    'B',
    '2026-10-08',
    '2026-10-09',
  );
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: task(tree, 'P').id,
    successorId: task(tree, 'B').id,
  });
  const p = task(tree, 'P').id;
  mark(p);
  const before = rows();
  expect(() =>
    step(tree, {
      type: 'task.create',
      title: 'Child',
      parentId: p,
      preserveWork: true,
      predecessorIds: [p],
    }),
  ).toThrow(/конечными/);
  expect(rows()).toEqual(before);
  const after = step(tree, {
    type: 'task.create',
    title: 'Child',
    parentId: p,
    preserveWork: true,
    predecessorIds: [task(tree, 'B').id],
  });
  const own = after.tasks.find(
    (item) => item.parentId === p && item.title === 'P',
  )!;
  expect(own).toMatchObject({
    inputStart: '2026-10-05',
    inputFinish: '2026-10-07',
    durationDays: null,
  });
  expect(after.dependencies).toContainEqual({
    ...tree.dependencies[0],
    predecessorId: own.id,
  });
  expect(
    db.prepare('SELECT taskId FROM task_schedule_provenance').all(),
  ).toEqual([{ taskId: own.id }]);
});
it('preserveWork retains historical raw conflict on its stable edge while new child gets an unrelated predecessor', () => {
  let tree = create(
    create(
      create(fresh(), 'P', '2026-10-05', '2026-10-07'),
      'B',
      '2026-10-07',
      '2026-10-08',
    ),
    'X',
    null,
    null,
  );
  mark(task(tree, 'P').id);
  tree = historicalEdge(tree, 'P', 'B');
  const p = task(tree, 'P').id;
  const after = step(tree, {
    type: 'task.create',
    title: 'Child',
    parentId: p,
    preserveWork: true,
    predecessorIds: [task(tree, 'X').id],
  });
  expect(task(after, 'B')).toEqual(task(tree, 'B'));
  expect(after.schedule.analysisStatus).toBe('infeasible');
});
it('cascades parent CPM in one revision, updates only moved timestamps, undoes exactly, restarts and retries without analysis', () => {
  let before = create(fresh(), 'R', null, null);
  before = create(before, 'P', null, null, undefined, task(before, 'R').id);
  before = create(before, 'Q', null, null, undefined, task(before, 'R').id);
  before = create(
    before,
    'A',
    '2026-10-05',
    '2026-10-06',
    undefined,
    task(before, 'P').id,
  );
  before = create(
    before,
    'B',
    '2026-10-07',
    '2026-10-09',
    [task(before, 'A').id],
    task(before, 'P').id,
  );
  before = create(
    before,
    'C',
    '2026-10-05',
    '2026-10-07',
    undefined,
    task(before, 'Q').id,
  );
  before = create(
    before,
    'D',
    '2026-10-08',
    '2026-10-09',
    [task(before, 'C').id],
    task(before, 'Q').id,
  );
  const by = Object.fromEntries(
    before.tasks.map((item) => [item.title, item.id]),
  );
  expect(before.schedule.criticalTaskIds).toEqual(
    [by.A, by.B, by.C, by.D].sort(),
  );
  expect(before.schedule.summaries[by.P!]!).toMatchObject({
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
    containsCritical: true,
  });
  expect(before.schedule.summaries[by.Q!]!).toMatchObject({
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
    containsCritical: true,
  });
  const envelope = {
    contractVersion: 2 as const,
    expectedRevision: before.project.revision,
    operationId: randomUUID(),
    command: {
      type: 'task.edit' as const,
      taskId: by.A!,
      changes: { inputStart: '2026-10-07', inputFinish: '2026-10-08' },
    },
  };
  clock += 1000;
  const after = repository.applyCommand(before.project.id, envelope, session);
  expect(after.project.revision).toBe(before.project.revision + 1);
  expect(task(after, 'B')).toMatchObject({
    inputStart: '2026-10-09',
    inputFinish: '2026-10-11',
    durationDays: null,
    updatedAt: '2026-10-05T00:00:01.000Z',
  });
  for (const title of ['R', 'P', 'Q', 'C', 'D'])
    expect(task(after, title)).toEqual(task(before, title));
  expect(after.schedule.analysisStatus).toBe('ready');
  for (const [title, projectFloat, constraintFloat] of [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 2, 0],
    ['D', 2, 2],
  ] as const)
    expect(after.schedule.tasks[by[title]!]!).toMatchObject({
      projectFloat,
      constraintFloat,
    });
  expect(after.schedule.criticalTaskIds).toEqual([by.A, by.B].sort());
  expect(after.schedule.criticalDependencyIds).toEqual([
    before.dependencies.find((edge) => edge.predecessorId === by.A)!.id,
  ]);
  expect(after.schedule.summaries[by.P!]!).toMatchObject({
    startDate: '2026-10-07',
    finishDate: '2026-10-11',
    containsCritical: true,
  });
  expect(after.schedule.summaries[by.Q!]!).toMatchObject({
    startDate: '2026-10-05',
    finishDate: '2026-10-09',
    containsCritical: false,
  });
  expect(after.schedule.summaries[by.R!]!).toMatchObject({
    startDate: '2026-10-05',
    finishDate: '2026-10-11',
    containsCritical: true,
  });
  db.close();
  db = openDatabase(path);
  repository = new Repository(db, () => clock);
  expect(repository.getTree(after.project.id, session)).toEqual(after);
  const undone = step(after, { type: 'undo' });
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  const cascadeSpy = vi.spyOn(cascade, 'cascadeFs'),
    cpmSpy = vi.spyOn(scheduling, 'calculateSchedule');
  expect(repository.applyCommand(before.project.id, envelope, session)).toEqual(
    after,
  );
  expect(cascadeSpy).not.toHaveBeenCalled();
  expect(cpmSpy).not.toHaveBeenCalled();
  const state = rows();
  expect(() =>
    repository.applyCommand(
      before.project.id,
      {
        ...envelope,
        command: { ...envelope.command, changes: { inputStart: '2026-10-06' } },
      },
      session,
    ),
  ).toThrow(expect.objectContaining({ code: 'OPERATION_REUSED' }));
  expect(() =>
    repository.applyCommand(
      before.project.id,
      { ...envelope, operationId: randomUUID() },
      session,
    ),
  ).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(rows()).toEqual(state);
  expect(cascadeSpy).not.toHaveBeenCalled();
  expect(cpmSpy).not.toHaveBeenCalled();
});
it('reads, equal source, private acknowledgement, details/status, move, calendar, removal and undo never repair', () => {
  let tree = create(
    create(fresh(), 'A', '2026-10-05', '2026-10-07'),
    'B',
    '2026-10-07',
    '2026-10-08',
  );
  mark(task(tree, 'A').id);
  tree = historicalEdge(tree, 'A', 'B');
  const spy = vi.spyOn(cascade, 'cascadeFs');
  repository.getTree(tree.project.id, session);
  repository.getSchedule(tree.project.id);
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'A').id,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-07' },
  });
  expect(db.prepare('SELECT * FROM task_schedule_provenance').all()).toEqual(
    [],
  );
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'A').id,
    changes: { title: 'A renamed', status: 'doing' },
  });
  tree = step(tree, {
    type: 'task.move',
    taskId: task(tree, 'B').id,
    parentId: null,
    position: 0,
  });
  tree = step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays' },
  });
  tree = step(tree, {
    type: 'dependency.delete',
    dependencyId: tree.dependencies[0]!.id,
  });
  tree = step(tree, { type: 'undo' });
  expect(spy).not.toHaveBeenCalled();
  expect(task(tree, 'B')).toMatchObject({
    inputStart: '2026-10-07',
    inputFinish: '2026-10-08',
  });
});
it.each([
  'F14-todo',
  'F14-done',
  'F15-todo',
  'F15-done-B',
  'F15-done-C',
  'F16',
] as const)(
  '%s historical infeasible snapshot remains untouched outside actual finish propagation',
  (vector) => {
    let tree = create(
      fresh(),
      'A',
      '2026-10-05',
      vector.startsWith('F14') ? '2026-10-07' : '2026-10-06',
    );
    tree = create(
      tree,
      'B',
      vector.startsWith('F14')
        ? '2026-10-07'
        : vector === 'F16'
          ? '2026-10-10'
          : '2026-10-09',
      vector.startsWith('F14')
        ? '2026-10-08'
        : vector === 'F16'
          ? '2026-10-11'
          : '2026-10-10',
    );
    tree = create(
      tree,
      'C',
      vector === 'F16' ? '2026-10-11' : '2026-10-10',
      vector === 'F16' ? '2026-10-12' : '2026-10-11',
    );
    tree = create(tree, 'X', '2026-10-05', '2026-10-09');
    if (vector.includes('done'))
      tree = step(tree, {
        type: 'task.edit',
        taskId: task(tree, vector.endsWith('C') ? 'C' : 'B').id,
        changes: { status: 'done' },
      });
    tree = historicalEdge(tree, 'A', 'B');
    if (!vector.startsWith('F14')) tree = historicalEdge(tree, 'B', 'C');
    if (vector.startsWith('F15')) tree = historicalEdge(tree, 'X', 'B');
    const before = tree;
    clock += 1000;
    tree = step(tree, {
      type: 'task.edit',
      taskId: task(tree, 'A').id,
      changes: { inputStart: '2026-10-06', inputFinish: '2026-10-07' },
    });
    expect(tree.project.revision).toBe(before.project.revision + 1);
    for (const title of ['B', 'C', 'X'])
      expect(task(tree, title)).toEqual(task(before, title));
    expect(tree.schedule.analysisStatus).toBe('infeasible');
  },
);
it('raw unavailable conflict rejects new/worsened edges, while unrelated old conflict survives and undo restores provenance', () => {
  let tree = create(
    create(
      create(fresh(), 'A', '2026-10-05', '2026-10-07'),
      'B',
      '2026-10-07',
      '2026-10-08',
    ),
    'X',
    null,
    null,
  );
  mark(task(tree, 'B').id);
  let before = rows();
  expect(() =>
    step(tree, {
      type: 'dependency.create',
      predecessorId: task(tree, 'A').id,
      successorId: task(tree, 'B').id,
    }),
  ).toThrow();
  expect(rows()).toEqual(before);
  tree = historicalEdge(tree, 'A', 'B');
  before = rows();
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: task(tree, 'A').id,
      changes: { inputFinish: '2026-10-08' },
    }),
  ).toThrow();
  expect(rows()).toEqual(before);
  const previous = tree;
  const after = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'X').id,
    changes: { inputFinish: '2026-10-09' },
  });
  expect(task(after, 'B')).toEqual(task(previous, 'B'));
  const undo = step(after, { type: 'undo' });
  expect(undo.tasks).toEqual(previous.tasks);
  expect(undo.dependencies).toEqual(previous.dependencies);
  expect(
    db.prepare('SELECT taskId FROM task_schedule_provenance').all(),
  ).toEqual([{ taskId: task(tree, 'B').id }]);
});
it('a late done node rolls back the predecessor and already shifted intermediate node', () => {
  let tree = create(fresh(), 'A', '2026-10-05', '2026-10-06');
  tree = create(tree, 'B', '2026-10-07', '2026-10-08', [task(tree, 'A').id]);
  tree = create(tree, 'C', '2026-10-09', '2026-10-10', [task(tree, 'B').id]);
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'C').id,
    changes: { status: 'done' },
  });
  const before = rows();
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: task(tree, 'A').id,
      changes: {
        inputStart: '2026-10-07',
        inputFinish: '2026-10-08',
        title: 'Synthetic changed',
      },
    }),
  ).toThrow(
    expect.objectContaining({
      code: 'DONE_PLAN_LOCKED',
      message: expect.stringContaining('B → C'),
    }),
  );
  expect(rows()).toEqual(before);
});
it('C25 source edit and new incoming relation normalize atomically with exact retry and undo', () => {
  let tree = create(
    create(fresh(), 'A', '2026-10-05', '2026-10-07'),
    'B',
    '2026-10-06',
    '2026-10-07',
  );
  const a = task(tree, 'A').id,
    b = task(tree, 'B').id,
    before = rows();
  const original = tree;
  const envelope = {
    contractVersion: 2 as const,
    expectedRevision: tree.project.revision,
    operationId: randomUUID(),
    command: {
      type: 'task.edit',
      taskId: b,
      changes: {
        inputStart: '2026-10-07',
        inputFinish: '2026-10-08',
        predecessorIds: [a],
      },
    } satisfies Command,
  };
  tree = repository.applyCommand(tree.project.id, envelope, session);
  expect(tree.project.revision).toBe(original.project.revision + 1);
  expect(task(tree, 'B')).toMatchObject({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: null,
  });
  const saved = rows();
  expect(repository.applyCommand(tree.project.id, envelope, session)).toEqual(
    tree,
  );
  expect(rows()).toEqual(saved);
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: b,
      changes: {
        inputStart: '2026-10-07',
        inputFinish: '2026-10-08',
        predecessorIds: [a],
      },
    }),
  ).toThrow(expect.objectContaining({ code: 'EXPLICIT_PRECEDENCE_CONFLICT' }));
  expect(rows()).toEqual(saved);
  const undone = step(tree, { type: 'undo' });
  expect(undone.tasks).toEqual(original.tasks);
  expect(undone.dependencies).toEqual(original.dependencies);
  expect(undone.schedule).toEqual(original.schedule);
  expect(before).not.toEqual(saved);
});

it('equal supplied source remains relation-only and receives the new incoming bound', () => {
  let tree = create(
    create(fresh(), 'A', '2026-10-05', '2026-10-07'),
    'B',
    '2026-10-06',
    '2026-10-07',
  );
  tree = step(tree, {
    type: 'task.edit',
    taskId: task(tree, 'B').id,
    changes: {
      inputStart: '2026-10-06',
      inputFinish: '2026-10-07',
      predecessorIds: [task(tree, 'A').id],
    },
  });
  expect(task(tree, 'B')).toMatchObject({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: null,
  });
});
