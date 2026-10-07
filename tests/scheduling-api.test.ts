import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp, type LeafApp } from '../src/server/app.js';
import type { Command, ProjectTree } from '../src/shared/contracts.js';
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
    schedule: { analysisStatus: 'pending-policy', criticalTaskIds: [] },
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
