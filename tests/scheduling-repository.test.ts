import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/server/database.js';
import { Repository } from '../src/server/repository.js';
import {
  liveProjectTreeV2Schema,
  type Command,
  type ProjectTree,
} from '../src/shared/contracts.js';
let dir: string;
let db: ReturnType<typeof openDatabase>;
let repository: Repository;
const session = 'synthetic-session';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-schedule-repository-'));
  db = openDatabase(join(dir, 'synthetic.sqlite'));
  repository = new Repository(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});
function step(tree: ProjectTree, command: Command, sessionId = session) {
  return repository.applyCommand(
    tree.project.id,
    {
      contractVersion: 2,
      expectedRevision: tree.project.revision,
      operationId: randomUUID(),
      command,
    },
    sessionId,
  );
}
function fresh() {
  return repository.getTree(repository.createProject('Synthetic').id, session);
}
function create(
  tree: ProjectTree,
  title: string,
  parentId: string | null = null,
) {
  return step(tree, { type: 'task.create', title, parentId });
}
function state() {
  return [
    'projects',
    'tasks',
    'dependencies',
    'operations',
    'undo_snapshots',
    'task_schedule_provenance',
  ].map((table) => db.prepare(`SELECT * FROM ${table}`).all());
}
it('rolls back a mismatching triple together with title/status and all history', () => {
  let tree = create(fresh(), 'A');
  const id = tree.tasks[0]!.id;
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
  });
  const before = state();
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: id,
      changes: { title: 'Changed', status: 'doing', durationDays: 3 },
    }),
  ).toThrow(/Длительность/);
  expect(state()).toEqual(before);
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { inputStart: null, durationDays: 3 },
  });
  expect(tree.tasks[0]).toMatchObject({
    inputStart: null,
    inputFinish: '2026-10-06',
    durationDays: 3,
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { inputStart: '2026-10-02' },
  });
  expect(tree.tasks[0]!.durationDays).toBe(3);
});
it('retains source after calendar changes and allows incomplete done without materialized dates', () => {
  let tree = create(fresh(), 'A');
  const id = tree.tasks[0]!.id;
  tree = step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: {
      inputStart: '2026-10-10',
      inputFinish: '2026-10-11',
      durationDays: 2,
    },
  });
  tree = step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays' },
  });
  expect(tree.tasks[0]!.inputStart).toBe('2026-10-10');
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
  const before = state();
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: id,
      changes: { inputFinish: '2026-10-12' },
    }),
  ).toThrow();
  expect(state()).toEqual(before);
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { inputStart: null, inputFinish: null, status: 'done' },
  });
  expect(tree.tasks[0]).toMatchObject({
    status: 'done',
    inputStart: null,
    inputFinish: null,
    durationDays: 2,
  });
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: id,
      changes: { durationDays: null },
    }),
  ).toThrow(/работ/);
  const done = tree;
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { status: 'doing', durationDays: null },
  });
  expect(tree.project.revision).toBe(done.project.revision + 1);
  tree = step(tree, { type: 'undo' });
  expect(tree.tasks).toEqual(done.tasks);
});
it('preserves duration-only own work and both endpoints in a child, clears parent and undoes deletion', () => {
  let tree = create(create(create(fresh(), 'P'), 'A'), 'B');
  const [p, a, b] = ['P', 'A', 'B'].map(
    (title) => tree.tasks.find((t) => t.title === title)!.id,
  );
  tree = step(tree, {
    type: 'task.edit',
    taskId: p!,
    changes: { durationDays: 3 },
  });
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: a!,
    successorId: p!,
  });
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: p!,
    successorId: b!,
  });
  expect(() => create(tree, 'Child', p)).toThrow(/Подтвердите/);
  tree = step(tree, {
    type: 'task.create',
    title: 'Child',
    parentId: p!,
    preserveWork: true,
  });
  const own = tree.tasks.find((t) => t.parentId === p && t.title === 'P')!;
  expect(own.durationDays).toBe(3);
  expect(tree.tasks.find((t) => t.id === p)).toMatchObject({
    inputStart: null,
    inputFinish: null,
    durationDays: null,
  });
  expect(
    tree.dependencies.map((e) => [e.predecessorId, e.successorId]),
  ).toEqual(
    expect.arrayContaining([
      [a, own.id],
      [own.id, b],
    ]),
  );
  const before = tree;
  tree = step(tree, { type: 'task.delete', taskId: own.id });
  tree = step(tree, { type: 'undo' });
  expect(tree.tasks).toEqual(before.tasks);
  expect(tree.dependencies).toEqual(before.dependencies);
  for (const child of tree.tasks.filter((t) => t.parentId === p))
    tree = step(tree, { type: 'task.delete', taskId: child.id });
  expect(tree.tasks.find((t) => t.id === p)).toMatchObject({
    inputStart: null,
    inputFinish: null,
    durationDays: null,
  });
});
it('validates leaf-only DAG and keeps hierarchy out of precedence', () => {
  let tree = create(create(fresh(), 'A'), 'B');
  const [a, b] = tree.tasks;
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: a!.id,
    successorId: b!.id,
  });
  for (const pair of [
    [a!.id, a!.id],
    [b!.id, a!.id],
    [a!.id, b!.id],
    [randomUUID(), a!.id],
  ]) {
    const before = state();
    expect(() =>
      step(tree, {
        type: 'dependency.create',
        predecessorId: pair[0]!,
        successorId: pair[1]!,
      }),
    ).toThrow();
    expect(state()).toEqual(before);
  }
  tree = create(tree, 'P');
  const p = tree.tasks.find((t) => t.title === 'P')!.id;
  tree = create(tree, 'C', p);
  expect(() =>
    step(tree, {
      type: 'dependency.create',
      predecessorId: p,
      successorId: a!.id,
    }),
  ).toThrow(/конечн/);
  expect(tree.dependencies).toHaveLength(1);
});
it('retains private unavailable provenance across reopen/status/calendar, transfers and restores, then explicitly adopts equal source', () => {
  let tree = create(fresh(), 'A');
  const id = tree.tasks[0]!.id;
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
  });
  db.prepare(
    "INSERT INTO task_schedule_provenance VALUES (?, 'legacy-interval-unavailable')",
  ).run(id);
  tree = repository.getTree(tree.project.id, session);
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
  expect(JSON.stringify(tree)).not.toContain('legacyIntervalUnavailable');
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { status: 'done', title: 'Renamed' },
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { status: 'doing' },
  });
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
  tree = step(tree, {
    type: 'project.schedule',
    changes: { timezone: 'Europe/Moscow' },
  });
  db.close();
  db = openDatabase(join(dir, 'synthetic.sqlite'));
  repository = new Repository(db);
  tree = repository.getTree(tree.project.id, session);
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
  tree = step(tree, {
    type: 'task.create',
    title: 'Child',
    parentId: id,
    preserveWork: true,
  });
  const own = tree.tasks.find(
    (t) => t.parentId === id && t.title === 'Renamed',
  )!;
  expect(tree.schedule.tasks[own.id]!.startDate).toBeNull();
  expect(
    db.prepare('SELECT taskId FROM task_schedule_provenance').get(),
  ).toEqual({ taskId: own.id });
  tree = step(tree, { type: 'undo' });
  const before = tree;
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
  });
  expect(tree.schedule.tasks[id]!.startDate).toBe('2026-10-05');
  expect(db.prepare('SELECT * FROM task_schedule_provenance').all()).toEqual(
    [],
  );
  tree = step(tree, { type: 'undo' });
  expect(tree.schedule).toEqual(before.schedule);
  tree = step(tree, { type: 'task.delete', taskId: id });
  expect(db.prepare('SELECT * FROM task_schedule_provenance').all()).toEqual(
    [],
  );
  tree = step(tree, { type: 'undo' });
  expect(tree.schedule.tasks[id]!.startDate).toBeNull();
});
it('validates equal source before adoption and requires an explicit original-done reopen', () => {
  let tree = create(fresh(), 'A');
  const id = tree.tasks[0]!.id;
  db.prepare(
    "UPDATE tasks SET inputStart='2026-10-10', inputFinish='2026-10-11', status='done' WHERE id=?",
  ).run(id);
  db.prepare(
    "INSERT INTO task_schedule_provenance VALUES (?, 'legacy-interval-unavailable')",
  ).run(id);
  tree = repository.getTree(tree.project.id, session);
  const before = state();
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: id,
      changes: {
        status: 'doing',
        inputStart: '2026-10-10',
        inputFinish: '2026-10-11',
      },
    }),
  ).toThrow(/интервал/);
  expect(state()).toEqual(before);
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: id,
      changes: { inputStart: null },
    }),
  ).toThrow(/работ/);
  expect(state()).toEqual(before);
  tree = step(tree, {
    type: 'task.edit',
    taskId: id,
    changes: {
      status: 'doing',
      inputStart: '2026-10-12',
      inputFinish: '2026-10-13',
    },
  });
  expect(tree.schedule.coverage.knownLeafCount).toBe(1);
});
it('freezes exact target retry after later writes and rolls back response-schema/save failures', () => {
  let tree = create(fresh(), 'A');
  const envelope = {
    contractVersion: 2 as const,
    expectedRevision: tree.project.revision,
    operationId: randomUUID(),
    command: {
      type: 'task.edit' as const,
      taskId: tree.tasks[0]!.id,
      changes: { title: 'B' },
    },
  };
  const frozen = repository.applyCommand(tree.project.id, envelope, session);
  tree = step(frozen, {
    type: 'task.edit',
    taskId: tree.tasks[0]!.id,
    changes: { title: 'C' },
  });
  const before = state();
  expect(repository.applyCommand(tree.project.id, envelope, session)).toEqual(
    frozen,
  );
  expect(state()).toEqual(before);
  const spy = vi
    .spyOn(liveProjectTreeV2Schema, 'safeParse')
    .mockImplementation(() => {
      throw new Error('Synthetic response failure');
    });
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: tree.tasks[0]!.id,
      changes: { title: 'D' },
    }),
  ).toThrow();
  expect(state()).toEqual(before);
  spy.mockRestore();
  db.exec(
    "CREATE TRIGGER synthetic_fail BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END",
  );
  expect(() =>
    step(tree, {
      type: 'task.edit',
      taskId: tree.tasks[0]!.id,
      changes: { title: 'D' },
    }),
  ).toThrow();
  expect(state()).toEqual(before);
});
it('rejects stale undo after another session and raw known FS remains checked', () => {
  let tree = create(create(fresh(), 'A'), 'B');
  const a = tree.tasks[0]!,
    b = tree.tasks[1]!;
  tree = step(tree, {
    type: 'task.edit',
    taskId: a.id,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
  });
  tree = step(tree, {
    type: 'task.edit',
    taskId: b.id,
    changes: { inputStart: '2026-10-06', inputFinish: '2026-10-07' },
  });
  db.prepare(
    "INSERT INTO task_schedule_provenance VALUES (?, 'legacy-interval-unavailable')",
  ).run(a.id);
  tree = step(tree, {
    type: 'dependency.create',
    predecessorId: a.id,
    successorId: b.id,
  });
  expect(
    tree.schedule.diagnostics.some(
      (d) => d.code === 'EXPLICIT_PRECEDENCE_CONFLICT',
    ),
  ).toBe(true);
  tree = step(
    tree,
    { type: 'task.edit', taskId: b.id, changes: { title: 'Other' } },
    'other-session',
  );
  const before = state();
  expect(() => step(tree, { type: 'undo' })).toThrow(/Отмена/);
  expect(state()).toEqual(before);
});
