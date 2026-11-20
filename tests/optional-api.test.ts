import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { buildApp, type LeafApp } from '../src/server/app.js';
import { commandV2Schema, taskV2Schema } from '../src/shared/contracts.js';
import {
  rawSyntheticCountsAndRevision,
  validLegacyBodyForRoute,
} from './helpers/optional-api-fixtures.js';
let app: LeafApp;
let db: Database.Database;
let dir: string;
let projectId: string;
let cookie: string;
const origin = 'http://127.0.0.1:3000';
it('accepts optional create-only successors without changing old canonical commands or DTOs', () => {
  const old = { type: 'task.create', title: 'T', parentId: null };
  const id = '22222222-2222-4222-8222-222222222222';
  expect(commandV2Schema.parse(old)).not.toHaveProperty('successorIds');
  for (const successorIds of [[], [id]])
    expect(commandV2Schema.safeParse({ ...old, successorIds }).success).toBe(
      true,
    );
  for (const successorIds of [null, 'bad', ['bad'], [id, id]])
    expect(commandV2Schema.safeParse({ ...old, successorIds }).success).toBe(
      false,
    );
  expect(
    commandV2Schema.safeParse({
      type: 'task.edit',
      taskId: id,
      changes: { successorIds: [] },
    }).success,
  ).toBe(false);
  expect(taskV2Schema.shape).not.toHaveProperty('successorIds');
});

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
it('accepts command-only relations, rejecting duplicate IDs and DTO leakage', () => {
  const a = '22222222-2222-4222-8222-222222222222';
  const b = '22222222-2222-4222-8222-222222222223';
  expect(
    commandV2Schema.safeParse({
      type: 'task.create',
      title: 'B',
      parentId: null,
      predecessorIds: [a],
    }).success,
  ).toBe(true);
  expect(
    commandV2Schema.safeParse({
      type: 'task.edit',
      taskId: b,
      changes: { predecessorIds: [] },
    }).success,
  ).toBe(true);
  for (const changes of [
    { predecessorIds: [a, a] },
    { predecessorIds: ['invalid'] },
    {},
  ])
    expect(
      commandV2Schema.safeParse({ type: 'task.edit', taskId: b, changes })
        .success,
    ).toBe(false);
  expect(taskV2Schema.shape).not.toHaveProperty('predecessorIds');
});
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'leaf-optional-api-'));
  app = await buildApp({
    databasePath: join(dir, 'synthetic.sqlite'),
    publicOrigin: origin,
  });
  await app.auth.setup('Synthetic-test-only-passphrase');
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { origin },
    payload: { password: 'Synthetic-test-only-passphrase' },
  });
  cookie = `leaf_session=${login.cookies[0]!.value}`;
  projectId = app.repository.createProject('Synthetic').id;
  db = new Database(join(dir, 'synthetic.sqlite'));
});
afterEach(async () => {
  db.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

it.each(
  [
    null,
    'bad',
    ['bad'],
    [
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222',
    ],
  ].map((successorIds) => ({ successorIds })),
)(
  'strict HTTP create rejects malformed or duplicate successors %j without writes',
  async ({ successorIds }) => {
    const saved = rows();
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/commands`,
      headers: { origin, cookie, 'x-leaf-contract-version': '2' },
      payload: {
        contractVersion: 2,
        expectedRevision: 0,
        operationId: randomUUID(),
        command: {
          type: 'task.create',
          title: 'T',
          parentId: null,
          successorIds,
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(rows()).toEqual(saved);
  },
);

it.each(['absent', 'empty', 'mixed'] as const)(
  'HTTP %s create preserves canonical receipts across restart, rejects changed replay and undoes once',
  async (kind) => {
    const send = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/commands`,
        headers: { origin, cookie, 'x-leaf-contract-version': '2' },
        payload,
      });
    const first = await send({
      contractVersion: 2,
      expectedRevision: 0,
      operationId: randomUUID(),
      command: {
        type: 'task.create',
        title: 'A',
        parentId: null,
        inputStart: '2026-11-09',
        inputFinish: '2026-11-09',
      },
    });
    expect(first.statusCode).toBe(200);
    const a = first.json().tasks[0].id as string;
    const seed = await send({
      contractVersion: 2,
      expectedRevision: 1,
      operationId: randomUUID(),
      command: {
        type: 'task.create',
        title: 'B',
        parentId: null,
        inputStart: '2026-11-09',
        inputFinish: '2026-11-10',
      },
    });
    expect(seed.statusCode).toBe(200);
    const b = seed
      .json()
      .tasks.find((item: { title: string }) => item.title === 'B').id as string;
    const payload = {
      contractVersion: 2,
      expectedRevision: 2,
      operationId: randomUUID(),
      command: {
        type: 'task.create',
        title: 'T',
        parentId: null,
        inputStart: '2026-11-09',
        inputFinish: '2026-11-10',
        ...(kind === 'empty' ? { successorIds: [], predecessorIds: [] } : {}),
        ...(kind === 'mixed' ? { successorIds: [b], predecessorIds: [a] } : {}),
      },
    };
    const created = await send(payload);
    expect(created.statusCode).toBe(200);
    expect(created.json().dependencies).toHaveLength(kind === 'mixed' ? 2 : 0);
    const receipt = db
      .prepare('SELECT payload FROM operations WHERE operationId=?')
      .get(payload.operationId) as { payload: string };
    const stored = JSON.parse(receipt.payload).command;
    if (kind === 'absent') expect(stored).not.toHaveProperty('successorIds');
    else expect(stored.successorIds).toEqual(payload.command.successorIds);
    const saved = rows();
    expect((await send(payload)).body).toBe(created.body);
    await app.close();
    app = await buildApp({
      databasePath: join(dir, 'synthetic.sqlite'),
      publicOrigin: origin,
    });
    expect((await send(payload)).body).toBe(created.body);
    expect(rows()).toEqual(saved);
    const changed = await send({
      ...payload,
      command: {
        ...payload.command,
        successorIds: kind === 'mixed' ? [] : [b],
      },
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe('OPERATION_REUSED');
    if (kind === 'absent') {
      const explicitEmpty = await send({
        ...payload,
        command: { ...payload.command, successorIds: [] },
      });
      expect(explicitEmpty.statusCode).toBe(409);
      expect(explicitEmpty.json().code).toBe('OPERATION_REUSED');
    }
    const stale = await send({ ...payload, operationId: randomUUID() });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('REVISION_CONFLICT');
    expect(rows()).toEqual(saved);
    const undone = await send({
      contractVersion: 2,
      expectedRevision: 3,
      operationId: randomUUID(),
      command: { type: 'undo' },
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().tasks).toEqual(seed.json().tasks);
    expect(undone.json().dependencies).toEqual(seed.json().dependencies);
    expect(undone.json().schedule).toEqual(seed.json().schedule);
  },
);

it('creates explicit source atomically, retries exactly and undoes once', async () => {
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const payload = {
    contractVersion: 2,
    expectedRevision: 0,
    operationId: randomUUID(),
    command: {
      type: 'task.create',
      title: 'Synthetic dated work',
      parentId: null,
      inputStart: '2026-10-09',
      inputFinish: '2026-10-12',
      durationDays: 2,
    },
  };
  const request = {
    method: 'POST' as const,
    url: `/api/projects/${projectId}/commands`,
    headers: { origin, cookie, 'x-leaf-contract-version': '2' },
    payload,
  };
  const created = await app.inject(request);
  expect(created.statusCode).toBe(200);
  expect(created.json().tasks[0]).toMatchObject({
    title: 'Synthetic dated work',
    inputStart: '2026-10-09',
    inputFinish: '2026-10-12',
    durationDays: 2,
  });
  const after = rawSyntheticCountsAndRevision(db, projectId);
  expect(after.revision).toBe(1);
  expect(after.counts).toEqual(
    before.counts.map(
      (count, index) => count + ([1, 3, 4].includes(index) ? 1 : 0),
    ),
  );
  expect((await app.inject(request)).body).toBe(created.body);
  expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(after);
  const undone = await app.inject({
    ...request,
    payload: {
      contractVersion: 2,
      expectedRevision: 1,
      operationId: randomUUID(),
      command: { type: 'undo' },
    },
  });
  expect(undone.statusCode).toBe(200);
  expect(undone.json().tasks).toEqual([]);
});

it('HTTP command-only create and replacement return canonical sources; errors show safe titles and roll back', async () => {
  let revision = 0;
  const send = async (command: unknown) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/commands`,
      headers: { origin, cookie, 'x-leaf-contract-version': '2' },
      payload: {
        contractVersion: 2,
        expectedRevision: revision,
        operationId: randomUUID(),
        command,
      },
    });
    if (response.statusCode === 200)
      revision = response.json().project.revision;
    return response;
  };
  await send({
    type: 'project.schedule',
    changes: { calendarType: 'all-days' },
  });
  const aResponse = await send({
    type: 'task.create',
    title: 'Synthetic predecessor',
    parentId: null,
    inputStart: '2026-10-05',
    inputFinish: '2026-10-07',
  });
  const a = aResponse.json().tasks[0].id;
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const created = await send({
    type: 'task.create',
    title: 'Synthetic successor',
    parentId: null,
    inputStart: '2026-10-07',
    inputFinish: '2026-10-08',
    predecessorIds: [a],
  });
  expect(created.statusCode).toBe(200);
  const b = created
    .json()
    .tasks.find(
      (task: { title: string }) => task.title === 'Synthetic successor',
    );
  expect(b).toMatchObject({
    inputStart: '2026-10-08',
    inputFinish: '2026-10-09',
    durationDays: null,
  });
  expect(b).not.toHaveProperty('predecessorIds');
  expect(created.json().dependencies).toHaveLength(1);
  const after = rawSyntheticCountsAndRevision(db, projectId);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.counts).toEqual(
    before.counts.map(
      (count, index) => count + ([1, 2, 3, 4].includes(index) ? 1 : 0),
    ),
  );
  const removed = await send({
    type: 'task.edit',
    taskId: b.id,
    changes: { predecessorIds: [] },
  });
  expect(removed.statusCode).toBe(200);
  expect(removed.json().dependencies).toEqual([]);
  const replaced = await send({
    type: 'task.edit',
    taskId: b.id,
    changes: { predecessorIds: [a] },
  });
  expect(replaced.statusCode).toBe(200);
  expect(replaced.json().dependencies).toHaveLength(1);
  const stable = rawSyntheticCountsAndRevision(db, projectId);
  const duplicate = await send({
    type: 'task.edit',
    taskId: b.id,
    changes: { predecessorIds: [a, a] },
  });
  expect(duplicate.statusCode).toBe(400);
  expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(stable);
  const conflict = await send({
    type: 'task.edit',
    taskId: b.id,
    changes: { inputStart: '2026-10-07', inputFinish: '2026-10-08' },
  });
  expect(conflict.statusCode).toBe(400);
  expect(conflict.json()).toMatchObject({
    code: 'EXPLICIT_PRECEDENCE_CONFLICT',
    message: expect.stringContaining(
      'Synthetic predecessor → Synthetic successor',
    ),
  });
  expect(conflict.json().message).not.toContain(a);
  expect(conflict.json().message).not.toContain(b.id);
  expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(stable);
});

it.each([
  { inputStart: '2026-10-09', inputFinish: '2026-10-12', durationDays: 3 },
  { inputStart: '2026-10-12', inputFinish: '2026-10-09', durationDays: null },
  { inputStart: '2026-10-10', inputFinish: '2026-10-10', durationDays: 1 },
  { inputStart: null, inputFinish: null, durationDays: 0 },
])('rolls back invalid source in task.create %j', async (source) => {
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/commands`,
    headers: { origin, cookie, 'x-leaf-contract-version': '2' },
    payload: {
      contractVersion: 2,
      expectedRevision: 0,
      operationId: randomUUID(),
      command: {
        type: 'task.create',
        title: 'Synthetic invalid work',
        parentId: null,
        ...source,
      },
    },
  });
  expect(response.statusCode).toBe(400);
  expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(before);
});
it.each([
  'GET list',
  'POST list',
  'PATCH project',
  'GET tree',
  'GET schedule',
  'POST commands',
])('rejects legacy route %s before repository access', async (key) => {
  const [method, kind] = key.split(' ');
  const url =
    kind === 'list'
      ? '/api/projects'
      : `/api/projects/${projectId}${kind === 'project' ? '' : `/${kind}`}`;
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const spies = [
    'getTree',
    'getSchedule',
    'listProjects',
    'createProject',
    'renameProject',
    'applyCommand',
    'replayLegacy',
  ].map((name) => vi.spyOn(app.repository, name as 'getTree'));
  for (const version of [undefined, '1', '3']) {
    const response = await app.inject({
      method: method as 'GET' | 'POST' | 'PATCH',
      url,
      headers: {
        origin,
        cookie,
        'content-type': 'application/json',
        ...(version ? { 'x-leaf-contract-version': version } : {}),
      },
      ...(method === 'GET'
        ? {}
        : { payload: validLegacyBodyForRoute(method!, url) }),
    });
    expect(response.statusCode).toBe(426);
    expect(response.json()).toEqual({
      code: 'CONTRACT_VERSION_CONFLICT',
      message:
        'Версия приложения устарела. Обновите страницу для продолжения. Этот запрос не изменил данные.',
    });
    expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(before);
  }
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});

it('HTTP start-resize returns authoritative source, exact retry, strict errors and undo', async () => {
  const send = (payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/commands`,
      headers: { origin, cookie, 'x-leaf-contract-version': '2' },
      payload,
    });
  const created = await send({
    contractVersion: 2,
    expectedRevision: 0,
    operationId: randomUUID(),
    command: {
      type: 'task.create',
      title: 'B',
      parentId: null,
      inputStart: '2026-10-05',
      inputFinish: '2026-10-09',
    },
  });
  expect(created.statusCode).toBe(200);
  const payload = {
    contractVersion: 2,
    expectedRevision: 1,
    operationId: randomUUID(),
    command: {
      type: 'task.resizeStart',
      taskId: created.json().tasks[0].id,
      inputStart: '2026-10-02',
    },
  };
  const resized = await send(payload);
  expect(resized.statusCode).toBe(200);
  expect(resized.json().tasks[0]).toMatchObject({
    inputStart: '2026-10-02',
    inputFinish: '2026-10-09',
    durationDays: 6,
  });
  expect((await send(payload)).body).toBe(resized.body);
  const before = rawSyntheticCountsAndRevision(db, projectId);
  const reused = await send({
    ...payload,
    command: { ...payload.command, inputStart: '2026-10-09' },
  });
  expect(reused.statusCode).toBe(409);
  expect(reused.json().code).toBe('OPERATION_REUSED');
  expect(
    (await send({ ...payload, operationId: randomUUID() })).statusCode,
  ).toBe(409);
  const extra = await send({
    ...payload,
    expectedRevision: 2,
    operationId: randomUUID(),
    command: { ...payload.command, inputFinish: '2026-10-12' },
  });
  expect(extra.statusCode).toBe(400);
  const weekend = await send({
    ...payload,
    expectedRevision: 2,
    operationId: randomUUID(),
    command: { ...payload.command, inputStart: '2026-10-03' },
  });
  expect(weekend.statusCode).toBe(400);
  expect(weekend.json().code).toBe('INVALID_INTERVAL');
  expect(rawSyntheticCountsAndRevision(db, projectId)).toEqual(before);
  const undo = await send({
    contractVersion: 2,
    expectedRevision: 2,
    operationId: randomUUID(),
    command: { type: 'undo' },
  });
  expect(undo.statusCode).toBe(200);
  expect(undo.json().tasks).toEqual(created.json().tasks);
  expect(undo.json().schedule).toEqual(created.json().schedule);
});
