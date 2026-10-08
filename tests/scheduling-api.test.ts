import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
import type { Command, ProjectTree } from '../src/shared/contracts.js';
import * as scheduling from '../src/domain/scheduling.js';
import Database from 'better-sqlite3';
import {
  projectTreeV2Schema,
  scheduleResponseV2Schema,
} from '../src/shared/contracts.js';
let dir: string;
let app: LeafApp;
let tree: ProjectTree;
let cookie: string;
const origin = 'http://127.0.0.1:3000';
const headers = () => ({ origin, cookie, 'x-leaf-contract-version': '2' });
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-schedule-api-'));
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  await app.auth.setup('Synthetic-test-only-passphrase');
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password: 'Synthetic-test-only-passphrase' },
  });
  cookie = `leaf_session=${response.cookies[0]!.value}`;
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: headers(),
    payload: { title: 'Synthetic' },
  });
  const loaded = await app.inject({
    url: `/api/projects/${created.json().id}/tree`,
    headers: headers(),
  });
  tree = loaded.json();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});
async function send(command: Command) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${tree.project.id}/commands`,
    headers: headers(),
    payload: {
      contractVersion: 2,
      expectedRevision: tree.project.revision,
      operationId: randomUUID(),
      command,
    },
  });
  if (response.statusCode === 200) tree = response.json();
  return response;
}
it('returns strict target projection and atomically rejects mismatched source alongside details', async () => {
  expect(
    (await send({ type: 'task.create', title: 'A', parentId: null }))
      .statusCode,
  ).toBe(200);
  const id = tree.tasks[0]!.id;
  expect(
    (
      await send({
        type: 'task.edit',
        taskId: id,
        changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
      })
    ).statusCode,
  ).toBe(200);
  const before = structuredClone(tree);
  const bad = await send({
    type: 'task.edit',
    taskId: id,
    changes: { title: 'Changed', status: 'done', durationDays: 3 },
  });
  expect(bad.statusCode).toBe(400);
  expect(bad.json().code).toBe('DURATION_MISMATCH');
  const loaded = await app.inject({
    url: `/api/projects/${tree.project.id}/tree`,
    headers: headers(),
  });
  expect(loaded.json()).toEqual(before);
  const schedule = await app.inject({
    url: `/api/projects/${tree.project.id}/schedule`,
    headers: headers(),
  });
  expect(schedule.json()).toMatchObject({
    contractVersion: 2,
    revision: tree.project.revision,
    schedule: {
      analysisStatus: 'ready',
      criticalTaskIds: [id],
      criticalDependencyIds: [],
      horizonFinishDate: '2026-10-06',
      partialAnalysis: null,
      tasks: {
        [id]: {
          startDate: '2026-10-05',
          finishDate: '2026-10-06',
          calendarSpanDays: 2,
          projectFloat: 0,
          constraintFloat: 0,
        },
      },
    },
  });
  for (const field of ['deadline', 'notBefore', 'planMode', 'completedStart'])
    expect(loaded.body).not.toContain(field);
  expect(
    (
      await send({
        type: 'task.edit',
        taskId: id,
        changes: { inputFinish: null, status: 'done' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await send({
        type: 'task.edit',
        taskId: id,
        changes: { inputStart: null },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await send({
        type: 'task.edit',
        taskId: id,
        changes: { status: 'doing', inputStart: null },
      })
    ).statusCode,
  ).toBe(200);
});
it('rejects body version mismatch, forbidden legacy fields and unknown replay without mutation', async () => {
  const url = `/api/projects/${tree.project.id}/commands`;
  const before = structuredClone(tree);
  for (const payload of [
    {
      expectedRevision: 0,
      operationId: randomUUID(),
      command: { type: 'undo' },
    },
    {
      contractVersion: 2,
      expectedRevision: 0,
      operationId: randomUUID(),
      command: {
        type: 'project.schedule',
        changes: { startDate: '2026-10-05' },
      },
    },
  ])
    expect(
      (await app.inject({ method: 'POST', url, headers: headers(), payload }))
        .statusCode,
    ).toBe(400);
  const replay = await app.inject({
    method: 'POST',
    url,
    headers: { ...headers(), 'x-leaf-legacy-replay': '1' },
    payload: {
      expectedRevision: 0,
      operationId: randomUUID(),
      command: { type: 'task.create', title: 'Old', parentId: null },
    },
  });
  expect(replay.statusCode).toBe(409);
  expect(replay.json().code).toBe('LEGACY_REPLAY_NOT_FOUND');
  expect(
    (
      await app.inject({
        url: `/api/projects/${tree.project.id}/tree`,
        headers: headers(),
      })
    ).json(),
  ).toEqual(before);
});
it('auth/origin take priority, unexpected replay fails and auth remains unversioned', async () => {
  expect((await app.inject('/api/projects')).statusCode).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { origin: 'http://example.test', cookie },
        payload: { title: 'Synthetic' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url: '/api/auth/session', headers: { cookie } }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        url: '/api/projects',
        headers: { ...headers(), 'x-leaf-legacy-replay': '1' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/projects/${tree.project.id}/commands`,
        headers: { ...headers(), 'x-leaf-legacy-replay': '2' },
        payload: {},
      })
    ).statusCode,
  ).toBe(400);
});

async function sendFrom(before: ProjectTree, command: Command) {
  tree = before;
  return send(command);
}
async function step(
  before: ProjectTree,
  command: Command,
): Promise<ProjectTree> {
  const response = await sendFrom(before, command);
  expect(response.statusCode).toBe(200);
  return projectTreeV2Schema.parse(response.json());
}
function apiState(projectId: string) {
  const read = new Database(join(dir, 'synthetic.sqlite'), { readonly: true });
  try {
    return {
      counters: read
        .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
        .all(),
      provenance: read
        .prepare(
          'SELECT p.taskId,p.reason FROM task_schedule_provenance p JOIN tasks t ON t.id=p.taskId WHERE t.projectId=? ORDER BY p.taskId',
        )
        .all(projectId),
      project: read.prepare('SELECT * FROM projects WHERE id=?').get(projectId),
      tasks: read
        .prepare('SELECT * FROM tasks WHERE projectId=? ORDER BY id')
        .all(projectId),
      dependencies: read
        .prepare('SELECT * FROM dependencies WHERE projectId=? ORDER BY id')
        .all(projectId),
      operations: read
        .prepare(
          'SELECT * FROM operations WHERE projectId=? ORDER BY operationId',
        )
        .all(projectId),
      undo: read
        .prepare(
          'SELECT * FROM undo_snapshots WHERE projectId=? ORDER BY sequence',
        )
        .all(projectId),
    };
  } finally {
    read.close();
  }
}
async function httpP10() {
  let t = await step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'weekdays' },
  });
  for (const title of ['A', 'B'])
    t = await step(t, { type: 'task.create', title, parentId: null });
  const by = Object.fromEntries(t.tasks.map((x) => [x.title, x.id]));
  t = await step(t, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { inputStart: '2026-10-09', inputFinish: '2026-10-09' },
  });
  t = await step(t, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { inputStart: '2026-10-12', inputFinish: '2026-10-13' },
  });
  t = await step(t, {
    type: 'dependency.create',
    predecessorId: by.A!,
    successorId: by.B!,
  });
  return { t, by };
}
it('HTTP calendar command recalculates P10 in one revision and undo restores it', async () => {
  const { t: before, by } = await httpP10(),
    ab = before.dependencies[0]!.id;
  if (before.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(before.schedule.tasks[by.A!]).toMatchObject({
    projectFloat: 0,
    constraintFloat: 0,
  });
  expect(before.schedule.tasks[by.B!]).toMatchObject({
    projectFloat: 0,
    constraintFloat: 0,
  });
  expect(before.schedule.criticalTaskIds).toEqual([by.A!, by.B!].sort());
  expect(before.schedule.criticalDependencyIds).toEqual([ab]);
  const after = await step(before, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  expect(after.project.revision).toBe(before.project.revision + 1);
  expect(after.tasks).toEqual(before.tasks);
  if (after.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  expect(after.schedule.tasks[by.A!]).toMatchObject({
    projectFloat: 2,
    constraintFloat: 2,
  });
  expect(after.schedule.tasks[by.B!]).toMatchObject({
    projectFloat: 0,
    constraintFloat: 0,
  });
  expect(after.schedule.criticalTaskIds).toEqual([by.B!]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  const get = await app.inject({
    url: '/api/projects/' + after.project.id + '/schedule',
    headers: headers(),
  });
  expect(get.statusCode).toBe(200);
  expect(scheduleResponseV2Schema.parse(get.json()).schedule).toEqual(
    after.schedule,
  );
  const undone = await step(after, { type: 'undo' });
  expect(undone.project.revision).toBe(after.project.revision + 1);
  expect(undone.project.calendarType).toBe('weekdays');
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.schedule).toEqual(before.schedule);
});
it('fresh pending injection gives internal500 and rolls back HTTP mutation and GETs', async () => {
  const { t: before, by } = await httpP10(),
    state = apiState(before.project.id);
  const injected = {
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
  const spy = vi.spyOn(scheduling, 'calculateSchedule');
  spy.mockReturnValueOnce(
    injected as unknown as ReturnType<typeof scheduling.calculateSchedule>,
  );
  const response = await sendFrom(before, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { title: 'Rejected internal edit' },
  });
  expect(response.statusCode).toBe(500);
  expect(response.json()).toEqual({
    code: 'INTERNAL_ERROR',
    message: 'Не удалось выполнить запрос.',
  });
  expect(apiState(before.project.id)).toEqual(state);
  for (const route of ['tree', 'schedule']) {
    spy.mockReturnValueOnce(
      injected as unknown as ReturnType<typeof scheduling.calculateSchedule>,
    );
    const get = await app.inject({
      url: '/api/projects/' + before.project.id + '/' + route,
      headers: headers(),
    });
    expect(get.statusCode).toBe(500);
    expect(get.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Не удалось выполнить запрос.',
    });
    expect(apiState(before.project.id)).toEqual(state);
  }
  spy.mockRestore();
});
it('HTTP predecessor delay cascades once with unknown work while invalid user triple rolls back', async () => {
  let t = await step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  for (const title of ['A', 'B', 'U'])
    t = await step(t, { type: 'task.create', title, parentId: null });
  const by = Object.fromEntries(t.tasks.map((x) => [x.title, x.id]));
  t = await step(t, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { inputStart: '2026-10-05', inputFinish: '2026-10-06' },
  });
  t = await step(t, {
    type: 'task.edit',
    taskId: by.B!,
    changes: { inputStart: '2026-10-07', inputFinish: '2026-10-09' },
  });
  t = await step(t, {
    type: 'dependency.create',
    predecessorId: by.A!,
    successorId: by.B!,
  });
  t = await step(t, {
    type: 'dependency.create',
    predecessorId: by.B!,
    successorId: by.U!,
  });
  const previous = apiState(t.project.id);
  const after = await step(t, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { inputFinish: '2026-10-07' },
  });
  const bu = after.dependencies.find(
    (e) => e.predecessorId === by.B && e.successorId === by.U,
  )!.id;
  expect(after.project.revision).toBe(t.project.revision + 1);
  expect(apiState(t.project.id).operations).toHaveLength(
    previous.operations.length + 1,
  );
  expect(apiState(t.project.id).undo).toHaveLength(previous.undo.length + 1);
  expect(after.tasks.find((task) => task.id === by.B)).toMatchObject({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-10',
    durationDays: null,
  });
  expect(after.schedule.analysisStatus).toBe('incomplete');
  if (after.schedule.analysisStatus !== 'incomplete')
    throw new Error('Expected incomplete');
  expect(after.schedule.partialAnalysis).toMatchObject({
    knownHorizonFinishDate: '2026-10-10',
    coverage: { analyzedLeafCount: 0, blockedLeafCount: 3 },
    tasks: {},
    partialCriticalTaskIds: [],
  });
  expect(after.schedule.criticalTaskIds).toEqual([]);
  expect(after.schedule.criticalDependencyIds).toEqual([]);
  expect(after.schedule.diagnostics).toEqual([
    {
      code: 'UNKNOWN_INTERVAL',
      taskIds: [by.U!],
      dependencyIds: [],
      messageKey: 'scheduling.UNKNOWN_INTERVAL',
    },
    {
      code: 'UNKNOWN_PRECEDENCE',
      taskIds: [by.B!, by.U!].sort(),
      dependencyIds: [bu],
      messageKey: 'scheduling.UNKNOWN_PRECEDENCE',
    },
  ]);
  const state = apiState(t.project.id);
  const rejected = await sendFrom(after, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { title: 'Rejected user edit', durationDays: 9 },
  });
  expect(rejected.statusCode).toBe(400);
  expect(apiState(t.project.id)).toEqual(state);
});

it('HTTP P04/P05 switches the critical branch, undoes once and replays the exact saved reply after restart', async () => {
  let before = await step(tree, {
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  for (const title of ['A', 'B', 'C', 'D'])
    before = await step(before, { type: 'task.create', title, parentId: null });
  const by = Object.fromEntries(before.tasks.map((t) => [t.title, t.id]));
  for (const [name, inputStart, inputFinish] of [
    ['A', '2026-10-05', '2026-10-06'],
    ['B', '2026-10-07', '2026-10-09'],
    ['C', '2026-10-05', '2026-10-07'],
    ['D', '2026-10-08', '2026-10-09'],
  ] as const)
    before = await step(before, {
      type: 'task.edit',
      taskId: by[name]!,
      changes: { inputStart, inputFinish },
    });
  for (const [from, to] of [
    ['A', 'B'],
    ['C', 'D'],
  ] as const)
    before = await step(before, {
      type: 'dependency.create',
      predecessorId: by[from]!,
      successorId: by[to]!,
    });
  expect(before.schedule.analysisStatus).toBe('ready');
  expect(before.schedule.criticalTaskIds).toEqual(
    [by.A!, by.B!, by.C!, by.D!].sort(),
  );
  const beforeState = apiState(before.project.id);
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
  const changed = await app.inject({
    method: 'POST',
    url: '/api/projects/' + before.project.id + '/commands',
    headers: headers(),
    payload: envelope,
  });
  expect(changed.statusCode).toBe(200);
  const after = projectTreeV2Schema.parse(changed.json());
  expect(after.project.revision).toBe(before.project.revision + 1);
  if (after.schedule.analysisStatus !== 'ready')
    throw new Error('Expected ready');
  for (const [name, projectFloat, constraintFloat] of [
    ['A', 0, 0],
    ['B', 0, 0],
    ['C', 2, 0],
    ['D', 2, 2],
  ] as const)
    expect(after.schedule.tasks[by[name]!]).toMatchObject({
      projectFloat,
      constraintFloat,
    });
  const ab = before.dependencies.find(
    (e) => e.predecessorId === by.A && e.successorId === by.B,
  )!.id;
  expect(after.schedule.criticalTaskIds).toEqual([by.A!, by.B!].sort());
  expect(after.schedule.criticalDependencyIds).toEqual([ab]);
  expect(apiState(before.project.id).operations).toHaveLength(
    beforeState.operations.length + 1,
  );
  expect(apiState(before.project.id).undo).toHaveLength(
    beforeState.undo.length + 1,
  );
  const undone = await step(after, { type: 'undo' });
  expect(undone.project.revision).toBe(after.project.revision + 1);
  expect(undone.tasks).toEqual(before.tasks);
  expect(undone.dependencies).toEqual(before.dependencies);
  expect(undone.schedule).toEqual(before.schedule);
  await app.close();
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  const state = apiState(before.project.id),
    spy = vi.spyOn(scheduling, 'calculateSchedule');
  const replay = await app.inject({
    method: 'POST',
    url: '/api/projects/' + before.project.id + '/commands',
    headers: headers(),
    payload: envelope,
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json()).toEqual(after);
  expect(replay.body).toBe(changed.body);
  expect(spy).not.toHaveBeenCalled();
  expect(apiState(before.project.id)).toEqual(state);
  const current = await app.inject({
    url: '/api/projects/' + before.project.id + '/tree',
    headers: headers(),
  });
  expect(current.statusCode).toBe(200);
  expect(current.json()).toEqual(undone);
});
it('malformed fresh HTTP result rejects reads and rolls back mutation after save', async () => {
  const { t: before, by } = await httpP10(),
    state = apiState(before.project.id);
  const injected = {
    analysisStatus: 'ready',
    feasibility: 'feasible',
    coverage: { knownLeafCount: 2, totalLeafCount: 2 },
    tasks: {},
    summaries: {},
    display: {},
    criticalTaskIds: [],
    criticalDependencyIds: [],
    diagnostics: [],
    horizonFinishDate: null,
    partialAnalysis: null,
  };
  const calculate = scheduling.calculateSchedule,
    spy = vi.spyOn(scheduling, 'calculateSchedule');
  spy
    .mockImplementationOnce(calculate)
    .mockReturnValueOnce(injected as unknown as ReturnType<typeof calculate>);
  const edit = await sendFrom(before, {
    type: 'task.edit',
    taskId: by.A!,
    changes: { title: 'Rejected after save' },
  });
  expect(edit.statusCode).toBe(500);
  expect(edit.json()).toEqual({
    code: 'INTERNAL_ERROR',
    message: 'Не удалось выполнить запрос.',
  });
  expect(apiState(before.project.id)).toEqual(state);
  for (const route of ['tree', 'schedule']) {
    spy.mockReturnValueOnce(
      injected as unknown as ReturnType<typeof calculate>,
    );
    const get = await app.inject({
      url: '/api/projects/' + before.project.id + '/' + route,
      headers: headers(),
    });
    expect(get.statusCode).toBe(500);
    expect(get.json()).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Не удалось выполнить запрос.',
    });
    expect(apiState(before.project.id)).toEqual(state);
  }
});
